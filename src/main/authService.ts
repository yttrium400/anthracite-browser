/**
 * AuthService — Supabase-backed user authentication for Anthracite.
 *
 * Sign-in flow:
 *   1. Email magic link  → user clicks link in email → deep link anthracite://auth/callback#... fires
 *   2. OAuth (Google / GitHub) → shell.openExternal(supabase_url) → system browser handles OAuth
 *      → Supabase redirects to anthracite://auth/callback#access_token=...
 *
 * Session is encrypted at rest via Electron safeStorage and written to userData/auth-session.bin
 *
 * SECURITY: raw tokens are never sent to the renderer. Only AuthUser metadata is exposed.
 */

import { safeStorage, BrowserWindow } from 'electron'
import { createClient, SupabaseClient, Session } from '@supabase/supabase-js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'

export interface AuthUser {
    id: string
    email: string | null
    name: string | null
    avatarUrl: string | null
    plan: 'free' | 'pro'
}

const SESSION_FILE = () => path.join(app.getPath('userData'), 'auth-session.bin')

class AuthService {
    private client: SupabaseClient | null = null
    private session: Session | null = null
    private user: AuthUser | null = null

    // Must be called after app is ready (safeStorage requires ready state)
    init(supabaseUrl: string, supabaseAnonKey: string): void {
        if (!supabaseUrl || !supabaseAnonKey) return

        this.client = createClient(supabaseUrl, supabaseAnonKey, {
            auth: { persistSession: false }, // we handle persistence ourselves
        })

        this.loadSession()
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
                redirectTo: 'anthracite://auth/callback',
                skipBrowserRedirect: true, // we open manually with shell.openExternal
            },
        })
        if (error || !data.url) return null
        return data.url
    }

    /** Sends a magic-link email. Returns true on success. */
    async signInWithEmail(email: string): Promise<{ success: boolean; error?: string }> {
        if (!this.client) return { success: false, error: 'Auth not configured' }
        const { error } = await this.client.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: 'anthracite://auth/callback' },
        })
        if (error) return { success: false, error: error.message }
        return { success: true }
    }

    /**
     * Called when the OS fires an anthracite://auth/callback deep link.
     * Extracts access_token + refresh_token from the URL hash and establishes
     * a Supabase session, then broadcasts the updated AuthUser to all windows.
     */
    async handleCallback(url: string): Promise<void> {
        if (!this.client) return

        // anthracite://auth/callback#access_token=...&refresh_token=...
        // Normalize to a parseable URL by replacing the custom scheme
        const normalized = url.replace(/^anthracite:\/\//, 'https://anthracite.app/')
        let params: URLSearchParams
        try {
            const parsed = new URL(normalized)
            // Supabase puts tokens in the hash fragment
            params = new URLSearchParams(parsed.hash.slice(1) || parsed.search)
        } catch {
            return
        }

        const access_token = params.get('access_token')
        const refresh_token = params.get('refresh_token')

        if (!access_token || !refresh_token) return

        const { data, error } = await this.client.auth.setSession({ access_token, refresh_token })
        if (error || !data.session) return

        this.session = data.session
        this.user = this.buildUser(data.session)
        this.saveSession(data.session)
        this.broadcast()
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
