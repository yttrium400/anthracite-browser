/**
 * Browser Data Importer
 *
 * Reads browsing history and bookmarks from Chrome, Brave, Edge, Firefox, and Safari,
 * then imports them into Anthracite's SQLite database.
 *
 * Chrome/Brave/Edge: ~/.../Application Support/<Browser>/Default/History (SQLite)
 * Firefox:           ~/.../Firefox/Profiles/<profile>/places.sqlite
 * Safari:            ~/Library/Safari/History.db
 *
 * SECURITY: We copy the source file to a temp location before opening (source DB
 * may be locked by the running browser) and never expose raw cookie or password data.
 */

import { app } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { addHistoryEntry } from './history'

// ============================================
// Browser Definitions
// ============================================

export interface BrowserProfile {
    browser: string
    profileName: string
    historyPath: string
    bookmarksPath?: string
    type: 'chromium' | 'firefox' | 'safari'
}

function expandHome(p: string): string {
    return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
}

const CHROMIUM_BROWSERS = [
    { browser: 'Google Chrome', dir: '~/Library/Application Support/Google/Chrome' },
    { browser: 'Brave', dir: '~/Library/Application Support/BraveSoftware/Brave-Browser' },
    { browser: 'Microsoft Edge', dir: '~/Library/Application Support/Microsoft Edge' },
    { browser: 'Chromium', dir: '~/Library/Application Support/Chromium' },
    { browser: 'Arc', dir: '~/Library/Application Support/Arc/User Data' },
]

/**
 * Detect all installed browsers with readable History files.
 */
export function detectBrowsers(): BrowserProfile[] {
    const profiles: BrowserProfile[] = []

    // Chromium family
    for (const { browser, dir } of CHROMIUM_BROWSERS) {
        const base = expandHome(dir)
        if (!fs.existsSync(base)) continue

        // Standard "Default" profile + numbered profiles
        const profileDirs = ['Default', 'Profile 1', 'Profile 2', 'Profile 3']
        for (const profileDir of profileDirs) {
            const historyPath = path.join(base, profileDir, 'History')
            const bookmarksPath = path.join(base, profileDir, 'Bookmarks')
            if (fs.existsSync(historyPath)) {
                profiles.push({
                    browser,
                    profileName: profileDir === 'Default' ? 'Default' : profileDir,
                    historyPath,
                    bookmarksPath: fs.existsSync(bookmarksPath) ? bookmarksPath : undefined,
                    type: 'chromium',
                })
            }
        }
    }

    // Firefox
    const ffBase = expandHome('~/Library/Application Support/Firefox/Profiles')
    if (fs.existsSync(ffBase)) {
        const ffProfiles = fs.readdirSync(ffBase)
        for (const p of ffProfiles) {
            const placesPath = path.join(ffBase, p, 'places.sqlite')
            if (fs.existsSync(placesPath)) {
                profiles.push({
                    browser: 'Firefox',
                    profileName: p,
                    historyPath: placesPath,
                    type: 'firefox',
                })
            }
        }
    }

    // Safari
    const safariHistory = expandHome('~/Library/Safari/History.db')
    if (fs.existsSync(safariHistory)) {
        profiles.push({
            browser: 'Safari',
            profileName: 'Default',
            historyPath: safariHistory,
            type: 'safari',
        })
    }

    return profiles
}

// ============================================
// Import Logic
// ============================================

export interface ImportResult {
    imported: number
    skipped: number
    errors: string[]
}

/**
 * Copy source DB to a temp file (avoids locking conflicts with running browsers).
 */
function copyToTemp(sourcePath: string): string {
    const tmpPath = path.join(app.getPath('temp'), `anthracite-import-${Date.now()}.db`)
    fs.copyFileSync(sourcePath, tmpPath)
    return tmpPath
}

function cleanupTemp(tmpPath: string): void {
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
    // Also remove WAL/SHM files if they exist
    try { fs.unlinkSync(tmpPath + '-wal') } catch { /* ignore */ }
    try { fs.unlinkSync(tmpPath + '-shm') } catch { /* ignore */ }
}

/**
 * Import history from a Chromium-based browser.
 * Chrome timestamps are microseconds since Jan 1, 1601.
 */
function importChromiumHistory(historyPath: string): ImportResult {
    const result: ImportResult = { imported: 0, skipped: 0, errors: [] }
    let tmpPath = ''
    let db: Database.Database | null = null

    try {
        tmpPath = copyToTemp(historyPath)
        db = new Database(tmpPath, { readonly: true, fileMustExist: true })

        // Chrome's urls table: id, url, title, visit_count, last_visit_time (microseconds since 1601-01-01)
        const rows = db.prepare(`
            SELECT url, title, visit_count, last_visit_time
            FROM urls
            WHERE url NOT LIKE 'chrome://%'
              AND url NOT LIKE 'chrome-extension://%'
              AND url NOT LIKE 'about:%'
              AND visit_count > 0
            ORDER BY last_visit_time DESC
            LIMIT 5000
        `).all() as Array<{ url: string; title: string; visit_count: number; last_visit_time: number }>

        for (const row of rows) {
            try {
                // Convert Chrome microsecond timestamp to Unix ms
                // Chrome epoch: Jan 1, 1601 = -11644473600 seconds from Unix epoch
                const unixMs = Math.floor(row.last_visit_time / 1000) - 11644473600000
                addHistoryEntry(row.url, row.title || '', '')
                result.imported++
            } catch (err: any) {
                result.skipped++
            }
        }
    } catch (err: any) {
        result.errors.push(`Failed to read history: ${err.message}`)
    } finally {
        try { db?.close() } catch { /* ignore */ }
        if (tmpPath) cleanupTemp(tmpPath)
    }

    return result
}

/**
 * Import history from Firefox (places.sqlite).
 */
function importFirefoxHistory(historyPath: string): ImportResult {
    const result: ImportResult = { imported: 0, skipped: 0, errors: [] }
    let tmpPath = ''
    let db: Database.Database | null = null

    try {
        tmpPath = copyToTemp(historyPath)
        db = new Database(tmpPath, { readonly: true, fileMustExist: true })

        // Firefox: moz_places joined with moz_historyvisits
        const rows = db.prepare(`
            SELECT p.url, p.title, p.visit_count,
                   MAX(v.visit_date) as last_visit_date
            FROM moz_places p
            JOIN moz_historyvisits v ON p.id = v.place_id
            WHERE p.url NOT LIKE 'about:%'
              AND p.url NOT LIKE 'moz-extension://%'
              AND p.visit_count > 0
            GROUP BY p.id
            ORDER BY last_visit_date DESC
            LIMIT 5000
        `).all() as Array<{ url: string; title: string; visit_count: number; last_visit_date: number }>

        for (const row of rows) {
            try {
                addHistoryEntry(row.url, row.title || '', '')
                result.imported++
            } catch {
                result.skipped++
            }
        }
    } catch (err: any) {
        result.errors.push(`Failed to read Firefox history: ${err.message}`)
    } finally {
        try { db?.close() } catch { /* ignore */ }
        if (tmpPath) cleanupTemp(tmpPath)
    }

    return result
}

/**
 * Import history from Safari (History.db).
 */
function importSafariHistory(historyPath: string): ImportResult {
    const result: ImportResult = { imported: 0, skipped: 0, errors: [] }
    let tmpPath = ''
    let db: Database.Database | null = null

    try {
        tmpPath = copyToTemp(historyPath)
        db = new Database(tmpPath, { readonly: true, fileMustExist: true })

        // Safari: history_items + history_visits
        const rows = db.prepare(`
            SELECT i.url, i.visit_count,
                   MAX(v.visit_time) as last_visit_time,
                   v.title
            FROM history_items i
            JOIN history_visits v ON i.id = v.history_item
            GROUP BY i.id
            ORDER BY last_visit_time DESC
            LIMIT 5000
        `).all() as Array<{ url: string; visit_count: number; last_visit_time: number; title: string }>

        for (const row of rows) {
            try {
                addHistoryEntry(row.url, row.title || '', '')
                result.imported++
            } catch {
                result.skipped++
            }
        }
    } catch (err: any) {
        result.errors.push(`Failed to read Safari history: ${err.message}`)
    } finally {
        try { db?.close() } catch { /* ignore */ }
        if (tmpPath) cleanupTemp(tmpPath)
    }

    return result
}

/**
 * Import bookmarks from a Chromium browser's Bookmarks JSON file.
 * Returns a flat list of {url, title} entries.
 */
export interface BookmarkEntry {
    url: string
    title: string
    folder: string
}

export function importChromiumBookmarks(bookmarksPath: string): BookmarkEntry[] {
    const entries: BookmarkEntry[] = []

    try {
        const raw = fs.readFileSync(bookmarksPath, 'utf-8')
        const data = JSON.parse(raw)

        function walk(node: any, folder: string): void {
            if (node.type === 'url' && node.url) {
                entries.push({ url: node.url, title: node.name || '', folder })
            } else if (node.children) {
                const nextFolder = node.name ? (folder ? `${folder} / ${node.name}` : node.name) : folder
                for (const child of node.children) {
                    walk(child, nextFolder)
                }
            }
        }

        // Chrome bookmarks root
        const roots = data.roots || {}
        for (const rootKey of ['bookmark_bar', 'other', 'synced']) {
            if (roots[rootKey]) walk(roots[rootKey], '')
        }
    } catch (err: any) {
        // Non-fatal — return empty
    }

    return entries
}

/**
 * Main import entry point — routes to the correct importer based on profile type.
 */
export function importBrowserHistory(profile: BrowserProfile): ImportResult {
    switch (profile.type) {
        case 'chromium': return importChromiumHistory(profile.historyPath)
        case 'firefox': return importFirefoxHistory(profile.historyPath)
        case 'safari': return importSafariHistory(profile.historyPath)
        default: return { imported: 0, skipped: 0, errors: ['Unknown browser type'] }
    }
}
