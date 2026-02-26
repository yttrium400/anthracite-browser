/**
 * History Storage Module
 *
 * Manages browsing history with SQLite database using better-sqlite3.
 * Provides fast indexed search and unlimited history storage.
 */

import { app } from 'electron'
import path from 'node:path'
import Database from 'better-sqlite3'

// ============================================
// Types
// ============================================

export interface AgentTaskRecord {
    id: number
    instruction: string
    status: 'done' | 'error' | 'stopped'
    steps: string           // JSON array of {step, action, goal}
    result: string
    stepCount: number
    startedAt: number       // ms timestamp
    completedAt: number     // ms timestamp
    durationMs: number
}

export interface HistoryEntry {
    id: number
    url: string
    title: string
    favicon: string
    visitCount: number
    lastVisited: number
}

// ============================================
// Database Setup
// ============================================

let db: Database.Database | null = null

function getDatabase(): Database.Database {
    if (db) return db

    const userDataPath = app.getPath('userData')
    const dbPath = path.join(userDataPath, 'history.db')

    db = new Database(dbPath)

    // Enable WAL mode for better performance
    db.pragma('journal_mode = WAL')

    // Create tables if they don't exist
    db.exec(`
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            favicon TEXT NOT NULL DEFAULT '',
            visit_count INTEGER NOT NULL DEFAULT 1,
            last_visited INTEGER NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
        );

        -- Index for fast URL lookups
        CREATE INDEX IF NOT EXISTS idx_history_url ON history(url);

        -- Index for fast search (title and URL)
        CREATE INDEX IF NOT EXISTS idx_history_title ON history(title COLLATE NOCASE);

        -- Index for sorting by visit count (top sites)
        CREATE INDEX IF NOT EXISTS idx_history_visit_count ON history(visit_count DESC);

        -- Index for sorting by last visited (recent history)
        CREATE INDEX IF NOT EXISTS idx_history_last_visited ON history(last_visited DESC);

        -- Agent task history
        CREATE TABLE IF NOT EXISTS agent_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            instruction TEXT NOT NULL,
            status TEXT NOT NULL,
            steps TEXT NOT NULL DEFAULT '[]',
            result TEXT NOT NULL DEFAULT '',
            step_count INTEGER NOT NULL DEFAULT 0,
            started_at INTEGER NOT NULL,
            completed_at INTEGER NOT NULL,
            duration_ms INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_agent_tasks_completed ON agent_tasks(completed_at DESC);
    `)

    return db
}

// Prepared statements for performance
let stmtSelectByUrl: Database.Statement | null = null
let stmtInsert: Database.Statement | null = null
let stmtUpdate: Database.Statement | null = null
let stmtUpdateMeta: Database.Statement | null = null
let stmtSearch: Database.Statement | null = null
let stmtTopSites: Database.Statement | null = null
let stmtRecent: Database.Statement | null = null
let stmtClear: Database.Statement | null = null

function prepareStatements(): void {
    const database = getDatabase()

    stmtSelectByUrl = database.prepare(`
        SELECT id, url, title, favicon, visit_count as visitCount, last_visited as lastVisited
        FROM history WHERE url = ?
    `)

    stmtInsert = database.prepare(`
        INSERT INTO history (url, title, favicon, visit_count, last_visited)
        VALUES (?, ?, ?, 1, ?)
    `)

    stmtUpdate = database.prepare(`
        UPDATE history
        SET visit_count = visit_count + 1,
            last_visited = ?,
            title = CASE WHEN ? != '' AND ? != 'Untitled' THEN ? ELSE title END,
            favicon = CASE WHEN ? != '' THEN ? ELSE favicon END
        WHERE url = ?
    `)

    stmtUpdateMeta = database.prepare(`
        UPDATE history
        SET title = CASE WHEN ? != '' AND ? != 'Untitled' THEN ? ELSE title END,
            favicon = CASE WHEN ? != '' THEN ? ELSE favicon END
        WHERE url = ?
    `)

    stmtSearch = database.prepare(`
        SELECT id, url, title, favicon, visit_count as visitCount, last_visited as lastVisited
        FROM history
        WHERE url LIKE ? OR title LIKE ?
        ORDER BY visit_count DESC, last_visited DESC
        LIMIT ?
    `)

    stmtTopSites = database.prepare(`
        SELECT id, url, title, favicon, visit_count as visitCount, last_visited as lastVisited
        FROM history
        ORDER BY visit_count DESC
        LIMIT ?
    `)

    stmtRecent = database.prepare(`
        SELECT id, url, title, favicon, visit_count as visitCount, last_visited as lastVisited
        FROM history
        ORDER BY last_visited DESC
        LIMIT ?
    `)

    stmtClear = database.prepare(`DELETE FROM history`)
}

// ============================================
// Public API
// ============================================

/**
 * Add or update a history entry
 */
export function addHistoryEntry(url: string, title?: string, favicon?: string): void {
    // Skip internal URLs
    if (url.startsWith('anthracite://') || url.startsWith('about:') || url.startsWith('chrome:')) {
        return
    }

    if (!stmtSelectByUrl) prepareStatements()

    const now = Date.now()
    const titleValue = title || ''
    const faviconValue = favicon || ''

    try {
        // Check if URL exists
        const existing = stmtSelectByUrl!.get(url) as HistoryEntry | undefined

        if (existing) {
            // Update existing entry
            stmtUpdate!.run(
                now,
                titleValue, titleValue, titleValue,
                faviconValue, faviconValue,
                url
            )
        } else {
            // Insert new entry
            stmtInsert!.run(url, titleValue || url, faviconValue, now)
        }
    } catch (err) {
        console.error('Failed to add history entry:', err)
    }
}

/**
 * Update an existing history entry (for title/favicon updates without incrementing visit count)
 */
export function updateHistoryEntry(url: string, title?: string, favicon?: string): void {
    if (!stmtUpdateMeta) prepareStatements()

    const titleValue = title || ''
    const faviconValue = favicon || ''

    try {
        stmtUpdateMeta!.run(
            titleValue, titleValue, titleValue,
            faviconValue, faviconValue,
            url
        )
    } catch (err) {
        console.error('Failed to update history entry:', err)
    }
}

/**
 * Search history entries by query (matches URL and title)
 */
export function searchHistory(query: string, limit: number = 10): HistoryEntry[] {
    if (!stmtSearch) prepareStatements()

    try {
        const pattern = `%${query}%`
        return stmtSearch!.all(pattern, pattern, limit) as HistoryEntry[]
    } catch (err) {
        console.error('Failed to search history:', err)
        return []
    }
}

/**
 * Get top visited sites
 */
export function getTopSites(limit: number = 8): HistoryEntry[] {
    if (!stmtTopSites) prepareStatements()

    try {
        return stmtTopSites!.all(limit) as HistoryEntry[]
    } catch (err) {
        console.error('Failed to get top sites:', err)
        return []
    }
}

/**
 * Get recent history
 */
export function getRecentHistory(limit: number = 20): HistoryEntry[] {
    if (!stmtRecent) prepareStatements()

    try {
        return stmtRecent!.all(limit) as HistoryEntry[]
    } catch (err) {
        console.error('Failed to get recent history:', err)
        return []
    }
}

/**
 * Clear all history
 */
export function clearHistory(): void {
    if (!stmtClear) prepareStatements()

    try {
        stmtClear!.run()
    } catch (err) {
        console.error('Failed to clear history:', err)
    }
}

/**
 * Delete history entries older than specified days
 */
export function deleteOldHistory(retentionDays: number): number {
    if (retentionDays < 0) return 0 // -1 means keep forever

    const database = getDatabase()
    const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000)

    try {
        const result = database.prepare(`
            DELETE FROM history WHERE last_visited < ?
        `).run(cutoffTime)

        return result.changes
    } catch (err) {
        console.error('Failed to delete old history:', err)
        return 0
    }
}

/**
 * Get total history count
 */
export function getHistoryCount(): number {
    const database = getDatabase()

    try {
        const result = database.prepare(`SELECT COUNT(*) as count FROM history`).get() as { count: number }
        return result.count
    } catch (err) {
        console.error('Failed to get history count:', err)
        return 0
    }
}

// ============================================
// Agent Task History
// ============================================

/**
 * Save a completed agent task to SQLite.
 */
export function saveAgentTask(task: Omit<AgentTaskRecord, 'id'>): number {
    const database = getDatabase()
    try {
        const result = database.prepare(`
            INSERT INTO agent_tasks
                (instruction, status, steps, result, step_count, started_at, completed_at, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            task.instruction,
            task.status,
            task.steps,
            task.result,
            task.stepCount,
            task.startedAt,
            task.completedAt,
            task.durationMs,
        )
        return result.lastInsertRowid as number
    } catch (err) {
        console.error('Failed to save agent task:', err)
        return -1
    }
}

/**
 * Get recent agent task records, newest first.
 */
export function getAgentTasks(limit: number = 50): AgentTaskRecord[] {
    const database = getDatabase()
    try {
        return database.prepare(`
            SELECT id, instruction, status, steps, result,
                   step_count as stepCount,
                   started_at as startedAt,
                   completed_at as completedAt,
                   duration_ms as durationMs
            FROM agent_tasks
            ORDER BY completed_at DESC
            LIMIT ?
        `).all(limit) as AgentTaskRecord[]
    } catch (err) {
        console.error('Failed to get agent tasks:', err)
        return []
    }
}

/**
 * Clear all agent task history.
 */
export function clearAgentTasks(): void {
    const database = getDatabase()
    try {
        database.prepare(`DELETE FROM agent_tasks`).run()
    } catch (err) {
        console.error('Failed to clear agent tasks:', err)
    }
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
    if (db) {
        db.close()
        db = null
        stmtSelectByUrl = null
        stmtInsert = null
        stmtUpdate = null
        stmtUpdateMeta = null
        stmtSearch = null
        stmtTopSites = null
        stmtRecent = null
        stmtClear = null
    }
}

/**
 * Migrate from JSON history file (one-time migration)
 */
export function migrateFromJson(): void {
    const fs = require('fs')
    const userDataPath = app.getPath('userData')
    const jsonPath = path.join(userDataPath, 'browsing-history.json')

    if (!fs.existsSync(jsonPath)) {
        return
    }

    try {
        const data = fs.readFileSync(jsonPath, 'utf-8')
        const jsonHistory = JSON.parse(data) as { entries: any[], nextId: number }

        if (!jsonHistory.entries || jsonHistory.entries.length === 0) {
            return
        }

        const database = getDatabase()
        const insertStmt = database.prepare(`
            INSERT OR IGNORE INTO history (url, title, favicon, visit_count, last_visited)
            VALUES (?, ?, ?, ?, ?)
        `)

        const insertMany = database.transaction((entries: any[]) => {
            for (const entry of entries) {
                insertStmt.run(
                    entry.url,
                    entry.title || entry.url,
                    entry.favicon || '',
                    entry.visitCount || 1,
                    entry.lastVisited || Date.now()
                )
            }
        })

        insertMany(jsonHistory.entries)

        // Rename old file to indicate migration completed
        fs.renameSync(jsonPath, jsonPath + '.migrated')
    } catch (err) {
        console.error('Failed to migrate JSON history:', err)
    }
}
