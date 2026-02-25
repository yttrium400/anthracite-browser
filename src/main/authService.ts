/**
 * AuthService — Supabase-backed user authentication for Anthracite.
 *
 * Sign-in flow (PKCE via local HTTP callback server):
 *   1. Email magic link  → user clicks link in email → system browser opens
 *      → Supabase verifies → redirects to http://127.0.0.1:7777/auth/callback?code=...
 *      → local server exchanges code for session
 *   2. OAuth (Google / GitHub) → shell.openExternal(supabase_url) → system browser handles OAuth
 *      → Supabase redirects to http://127.0.0.1:7777/auth/callback?code=...
 *      → local server exchanges code for session
 *
 * Using localhost (not anthracite://) avoids the need for OS-level protocol registration,
 * which is unreliable in development mode on macOS.
 *
 * Session is encrypted at rest via Electron safeStorage and written to userData/auth-session.bin
 *
 * SECURITY: raw tokens are never sent to the renderer. Only AuthUser metadata is exposed.
 */

import { safeStorage, BrowserWindow, app } from 'electron'
import { createClient, SupabaseClient, Session } from '@supabase/supabase-js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as http from 'node:http'

export interface AuthUser {
    id: string
    email: string | null
    name: string | null
    avatarUrl: string | null
    plan: 'free' | 'pro'
}

const CALLBACK_PORT = 7777
const SESSION_FILE = () => path.join(app.getPath('userData'), 'auth-session.bin')

// In-memory storage so the PKCE code verifier survives across the sign-in round-trip
// within the same process instance (the main process is long-running).
const memoryStorage = (() => {
    const store: Record<string, string> = {}
    return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value },
        removeItem: (key: string) => { delete store[key] },
    }
})()

class AuthService {
    private client: SupabaseClient | null = null
    private session: Session | null = null
    private user: AuthUser | null = null
    private callbackServer: http.Server | null = null

    // Must be called after app is ready (safeStorage requires ready state)
    init(supabaseUrl: string, supabaseAnonKey: string): void {
        // Always start the callback server regardless of whether credentials are set,
        // so the server is ready before the user even sends a magic link.
        this.startCallbackServer()

        if (!supabaseUrl || !supabaseAnonKey) return

        this.client = createClient(supabaseUrl, supabaseAnonKey, {
            auth: {
                persistSession: false,   // we handle persistence ourselves
                flowType: 'pkce',        // PKCE sends ?code= in query string (not hash fragment)
                storage: memoryStorage,  // store PKCE verifier in memory
            },
        })

        this.loadSession()
    }

    // ── Local HTTP callback server ───────────────────────────────────────────

    private startCallbackServer(): void {
        if (this.callbackServer) return

        this.callbackServer = http.createServer((req, res) => {
            if (!req.url) { res.writeHead(400); res.end(); return }

            const url = new URL(req.url, `http://127.0.0.1:${CALLBACK_PORT}`)

            // Step 1: Supabase redirects here with ?code=...
            if (url.pathname === '/auth/callback') {
                const code = url.searchParams.get('code')
                const error = url.searchParams.get('error')
                const errorDesc = url.searchParams.get('error_description')

                if (error) {
                    res.writeHead(200, { 'Content-Type': 'text/html' })
                    res.end(this.htmlPage(`Sign in failed: ${errorDesc ?? error}`))
                    return
                }

                if (code) {
                    this.handleCode(code)
                    res.writeHead(200, { 'Content-Type': 'text/html' })
                    res.end(this.htmlPage('Signed in successfully! You can close this tab.'))
                    return
                }

                // Fallback: implicit flow — tokens are in the URL hash fragment.
                // The browser never sends the hash to the server, so we return an HTML
                // page that reads it via JS and posts it to /auth/tokens.
                res.writeHead(200, { 'Content-Type': 'text/html' })
                res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<p style="font-family:sans-serif;text-align:center;margin-top:100px">Completing sign in…</p>
<script>
var p=new URLSearchParams(location.hash.slice(1));
var at=p.get('access_token'),rt=p.get('refresh_token');
if(at&&rt){
  fetch('/auth/tokens?access_token='+encodeURIComponent(at)+'&refresh_token='+encodeURIComponent(rt))
    .then(function(){document.querySelector('p').textContent='Signed in! You can close this tab.';});
}else{
  document.querySelector('p').textContent='Sign in failed. You can close this tab.';
}
</script></body></html>`)
                return
            }

            // Step 2 (implicit fallback): JS posts tokens here as query params
            if (url.pathname === '/auth/tokens') {
                const access_token = url.searchParams.get('access_token')
                const refresh_token = url.searchParams.get('refresh_token')
                res.writeHead(200)
                res.end('ok')
                if (access_token && refresh_token) {
                    this.handleTokens(access_token, refresh_token)
                }
                return
            }

            res.writeHead(404); res.end()
        })

        this.callbackServer.listen(CALLBACK_PORT, '127.0.0.1', () => {
            console.log(`[auth] callback server listening on http://127.0.0.1:${CALLBACK_PORT}`)
        })
        this.callbackServer.on('error', (err: NodeJS.ErrnoException) => {
            console.error(`[auth] callback server error: ${err.code} ${err.message}`)
        })
    }

    private htmlPage(message: string): string {
        return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<p style="font-family:sans-serif;text-align:center;margin-top:100px">${message}</p>
</body></html>`
    }

    getCallbackUrl(): string {
        return `http://127.0.0.1:${CALLBACK_PORT}/auth/callback`
    }

    // ── Session persistence via safeStorage ─────────────────────────────────

    private loadSession(): void {
        const file = SESSION_FILE()
        if (!fs.existsSync(file)) return
        try {
            const encrypted = fs.readFileSync(file)
            const json = safeStorage.decryptString(encrypted)
            const session = JSON.parse(json) as Session
            this.session = session
            this.user = this.buildUser(session)
        } catch {
            // Corrupted or keychain unavailable — start fresh
            try { fs.unlinkSync(file) } catch { /* ignore */ }
        }
    }

    private saveSession(session: Session | null): void {
        const file = SESSION_FILE()
        if (!session) {
            try { fs.unlinkSync(file) } catch { /* ignore */ }
            return
        }
        if (!safeStorage.isEncryptionAvailable()) return
        try {
            const encrypted = safeStorage.encryptString(JSON.stringify(session))
            fs.writeFileSync(file, encrypted)
        } catch { /* ignore */ }
    }

    // ── User extraction ──────────────────────────────────────────────────────

    private buildUser(session: Session): AuthUser {
        const u = session.user
        return {
            id: u.id,
            email: u.email ?? null,
            name: u.user_metadata?.full_name ?? u.user_metadata?.name ?? null,
            avatarUrl: u.user_metadata?.avatar_url ?? u.user_metadata?.picture ?? null,
            plan: 'free', // future: read from Supabase subscriptions table
        }
    }

    // ── Public API ───────────────────────────────────────────────────────────

    getUser(): AuthUser | null {
        return this.user
    }

    /** Returns the Supabase-hosted OAuth URL to open in the system browser. */
    async getOAuthUrl(provider: 'google' | 'github'): Promise<string | null> {
        if (!this.client) return null
        const { data, error } = await this.client.auth.signInWithOAuth({
            provider,
            options: {
                redirectTo: this.getCallbackUrl(),
                skipBrowserRedirect: true, // we open manually with shell.openExternal
            },
        })
        if (error || !data.url) return null
        return data.url
    }

    /**
     * Sends a sign-in email containing a 6-digit OTP code.
     * The user reads the code from their email (on any device) and types it into the app.
     * No link-clicking or protocol registration needed.
     */
    async signInWithEmail(email: string): Promise<{ success: boolean; error?: string }> {
        if (!this.client) return { success: false, error: 'Auth not configured' }
        const { error } = await this.client.auth.signInWithOtp({ email })
        if (error) return { success: false, error: error.message }
        return { success: true }
    }

    /** Verifies the 6-digit OTP code the user received by email. */
    async verifyOtp(email: string, token: string): Promise<{ success: boolean; error?: string }> {
        if (!this.client) return { success: false, error: 'Auth not configured' }
        const { data, error } = await this.client.auth.verifyOtp({ email, token, type: 'email' })
        if (error) return { success: false, error: error.message }
        if (!data.session) return { success: false, error: 'No session returned' }
        this.session = data.session
        this.user = this.buildUser(data.session)
        this.saveSession(data.session)
        this.broadcast()
        return { success: true }
    }

    // ── Token exchange ───────────────────────────────────────────────────────

    /** PKCE: exchange auth code for session (called by local server callback). */
    private async handleCode(code: string): Promise<void> {
        if (!this.client) return
        const { data, error } = await this.client.auth.exchangeCodeForSession(code)
        if (error || !data.session) return
        this.session = data.session
        this.user = this.buildUser(data.session)
        this.saveSession(data.session)
        this.broadcast()
    }

    /** Implicit fallback: set session directly from access + refresh tokens. */
    private async handleTokens(access_token: string, refresh_token: string): Promise<void> {
        if (!this.client) return
        const { data, error } = await this.client.auth.setSession({ access_token, refresh_token })
        if (error || !data.session) return
        this.session = data.session
        this.user = this.buildUser(data.session)
        this.saveSession(data.session)
        this.broadcast()
    }

    /**
     * Deep-link fallback for production packaged builds.
     * Called when the OS fires an anthracite://auth/callback deep link.
     */
    async handleCallback(url: string): Promise<void> {
        if (!this.client) return

        const normalized = url.replace(/^anthracite:\/\//, 'https://anthracite.internal/')
        let params: URLSearchParams
        try {
            const parsed = new URL(normalized)
            params = new URLSearchParams(parsed.hash.slice(1) || parsed.search)
        } catch { return }

        const code = params.get('code')
        if (code) { await this.handleCode(code); return }

        const access_token = params.get('access_token')
        const refresh_token = params.get('refresh_token')
        if (access_token && refresh_token) { await this.handleTokens(access_token, refresh_token) }
    }

    async signOut(): Promise<void> {
        await this.client?.auth.signOut()
        this.session = null
        this.user = null
        this.saveSession(null)
        this.broadcast()
    }

    // ── Broadcast to renderer ────────────────────────────────────────────────

    private broadcast(): void {
        const user = this.user
        BrowserWindow.getAllWindows().forEach(w => {
            if (!w.isDestroyed()) w.webContents.send('auth-state-changed', { user })
        })
    }

    /** Called on app startup to push current auth state to the renderer. */
    broadcastInitial(): void {
        this.broadcast()
    }
}

export const authService = new AuthService()
