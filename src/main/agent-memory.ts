/**
 * Agent Memory — lightweight user profile the AI agent references on every run.
 *
 * Stored as a plain JSON file in userData so it persists across app restarts.
 * Values here are injected into the agent's system message, so they influence
 * how the agent behaves and what services it prefers.
 */

import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentMemory {
    /** User's first name or preferred name the agent can address them by. */
    userName: string

    /**
     * Service preferences — maps task category to preferred URL/service.
     * e.g. { flights: "google.com/flights", email: "gmail.com" }
     */
    preferredServices: Record<string, string>

    /**
     * Free-form notes the user can add — dietary restrictions, time zone,
     * default city for travel, etc. Included verbatim in the system prompt.
     */
    customNotes: string

    /** Auto-detected: top domains from browsing history (updated on read). */
    topDomains: string[]

    /** ISO timestamp of last update */
    updatedAt: string
}

const MEMORY_FILE = 'agent-memory.json'

const DEFAULT_MEMORY: AgentMemory = {
    userName: '',
    preferredServices: {
        flights: 'google.com/flights',
        hotels: 'booking.com',
        shopping: 'amazon.com',
        email: 'gmail.com',
        maps: 'google.com/maps',
    },
    customNotes: '',
    topDomains: [],
    updatedAt: new Date().toISOString(),
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function getMemoryPath(): string {
    return path.join(app.getPath('userData'), MEMORY_FILE)
}

export function loadAgentMemory(): AgentMemory {
    try {
        const raw = fs.readFileSync(getMemoryPath(), 'utf-8')
        return { ...DEFAULT_MEMORY, ...JSON.parse(raw) }
    } catch {
        return { ...DEFAULT_MEMORY }
    }
}

export function saveAgentMemory(updates: Partial<AgentMemory>): AgentMemory {
    const current = loadAgentMemory()
    const next: AgentMemory = {
        ...current,
        ...updates,
        updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(getMemoryPath(), JSON.stringify(next, null, 2))
    return next
}

/**
 * Build a compact string representation for injection into the agent's system
 * message. Only includes non-empty fields to keep the prompt lean.
 */
export function buildMemoryPrompt(memory: AgentMemory): string {
    const lines: string[] = []

    if (memory.userName) {
        lines.push(`User's name: ${memory.userName}`)
    }

    const services = Object.entries(memory.preferredServices).filter(([, v]) => v)
    if (services.length) {
        lines.push(
            'Preferred services:\n' +
            services.map(([k, v]) => `  - ${k}: ${v}`).join('\n')
        )
    }

    if (memory.topDomains.length) {
        lines.push(`Frequently visited sites: ${memory.topDomains.slice(0, 8).join(', ')}`)
    }

    if (memory.customNotes) {
        lines.push(`User notes: ${memory.customNotes}`)
    }

    if (lines.length === 0) return ''

    return (
        'User context (use this to personalise your actions — do NOT share raw values with third-party sites):\n' +
        lines.join('\n')
    )
}
