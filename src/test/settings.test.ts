/**
 * Tests for SettingsStore (src/main/settings.ts).
 * The `electron` module is mocked in src/test/setup.ts so no Electron runtime is needed.
 */
import { describe, it, expect, beforeEach } from 'vitest'

// settingsStore is a singleton; the Electron mock from setup.ts is active before this import.
import { settingsStore } from '../main/settings'

describe('SettingsStore', () => {
    beforeEach(() => {
        // Reset between tests so state doesn't bleed
        settingsStore.reset()
    })

    it('returns defaults when freshly reset', () => {
        const all = settingsStore.getAll()
        expect(all.adBlockerEnabled).toBe(true)
        expect(all.theme).toBe('dark')
        expect(all.defaultSearchEngine).toBe('google')
        expect(all.historyEnabled).toBe(true)
        expect(all.hasCompletedOnboarding).toBe(false)
    })

    it('get() returns individual settings', () => {
        expect(settingsStore.get('theme')).toBe('dark')
        expect(settingsStore.get('compactMode')).toBe(false)
        expect(settingsStore.get('uiScale')).toBe('small')
    })

    it('set() updates a single setting in memory', () => {
        settingsStore.set('theme', 'light')
        expect(settingsStore.get('theme')).toBe('light')
    })

    it('set() does not affect other settings', () => {
        settingsStore.set('theme', 'light')
        expect(settingsStore.get('adBlockerEnabled')).toBe(true)
        expect(settingsStore.get('defaultSearchEngine')).toBe('google')
    })

    it('set() returns the updated settings object', () => {
        const result = settingsStore.set('hasCompletedOnboarding', true)
        expect(result.hasCompletedOnboarding).toBe(true)
    })

    it('update() applies a partial patch', () => {
        settingsStore.update({ compactMode: true, uiScale: 'large' })
        expect(settingsStore.get('compactMode')).toBe(true)
        expect(settingsStore.get('uiScale')).toBe('large')
        expect(settingsStore.get('theme')).toBe('dark') // untouched
    })

    it('update() returns the full updated settings', () => {
        const result = settingsStore.update({ theme: 'light' })
        expect(result.theme).toBe('light')
        expect(result.adBlockerEnabled).toBe(true) // default preserved
    })

    it('reset() restores all defaults', () => {
        settingsStore.set('theme', 'light')
        settingsStore.set('adBlockerEnabled', false)
        settingsStore.reset()
        expect(settingsStore.get('theme')).toBe('dark')
        expect(settingsStore.get('adBlockerEnabled')).toBe(true)
    })

    it('resetKey() restores only one key', () => {
        settingsStore.set('theme', 'light')
        settingsStore.set('compactMode', true)
        settingsStore.resetKey('theme')
        expect(settingsStore.get('theme')).toBe('dark')
        expect(settingsStore.get('compactMode')).toBe(true) // untouched
    })

    it('getAll() returns a copy, not the internal reference', () => {
        const snapshot = settingsStore.getAll()
        settingsStore.set('theme', 'light')
        // Snapshot captured before set() should not reflect new value
        expect(snapshot.theme).toBe('dark')
        expect(settingsStore.get('theme')).toBe('light')
    })

    it('multiple set() calls accumulate correctly', () => {
        settingsStore.set('theme', 'light')
        settingsStore.set('compactMode', true)
        settingsStore.set('uiScale', 'large')
        expect(settingsStore.get('theme')).toBe('light')
        expect(settingsStore.get('compactMode')).toBe(true)
        expect(settingsStore.get('uiScale')).toBe('large')
    })
})
