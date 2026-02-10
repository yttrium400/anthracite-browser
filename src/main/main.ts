import { app, BrowserWindow, BrowserView, ipcMain, session, Menu } from 'electron'
import path from 'node:path'

// Enable CDP remote debugging so the AI agent can connect to Poseidon's browser
const CDP_PORT = 9222
app.commandLine.appendSwitch('remote-debugging-port', String(CDP_PORT))
import { spawn, ChildProcess } from 'node:child_process'
import { ElectronBlocker, Request } from '@ghostery/adblocker-electron'
import fetch from 'cross-fetch'
import {
    addHistoryEntry,
    updateHistoryEntry,
    searchHistory,
    getTopSites,
    getRecentHistory,
    clearHistory,
    closeDatabase,
    migrateFromJson,
    deleteOldHistory,
    getHistoryCount
} from './history'
import {
    // Realm operations
    getRealms,
    getRealm,
    getActiveRealmId,
    setActiveRealmId,
    createRealmFromParams,
    updateRealm,
    deleteRealm,
    reorderRealms,
    // Dock operations
    getDocks,
    getDock,
    createDockFromParams,
    updateDock,
    toggleDockCollapse,
    deleteDock,
    reorderDocks,
    moveDockToRealm,
    // Tab organization
    getTabOrganization,
    assignTabToActiveRealm,
    moveTabToDock,
    moveTabToLoose,
    moveTabToRealm,
    pinTab,
    unpinTab,
    reorderTabsInDock,
    reorderLooseTabs,
    removeTabOrganization,
    // State
    getFullState,
    getAllTabOrganizations,
    closeStore,
} from './store'
import { settingsStore, type AppSettings } from './settings'
import type { ThemeColor, IconName } from '../shared/types'

// ============================================
// Types
// ============================================

// Add web-contents-created handler to capture swipe gestures from webviews
app.on('web-contents-created', (_event, contents) => {
    // We only care about guest webcontents (webviews), but checking type won't hurt
    // This allows us to detect the "finger lift" (gestureScrollEnd) which is not available via wheel events
    contents.on('input-event', (_event, input) => {
        if (input.type === 'gestureScrollBegin') {
            if (win && !win.isDestroyed()) {
                win.webContents.send('scroll-touch-begin')
            }
        } else if (input.type === 'gestureScrollEnd' || input.type === 'gestureFlingStart') {
            if (win && !win.isDestroyed()) {
                win.webContents.send('scroll-touch-end')
            }
        }
    })
})

interface Tab {
    id: string
    view: BrowserView
    title: string
    url: string
    favicon: string
    isLoading: boolean
}

// ============================================
// State
// ============================================

let win: BrowserWindow | null = null
let pythonProcess: ChildProcess | null = null
let blocker: ElectronBlocker | null = null
let blockedCount = 0
let httpsUpgradeCount = 0
let adBlockEnabled = true
let httpsUpgradeEnabled = true

// Tab management
const tabs: Map<string, Tab> = new Map()
let activeTabId: string | null = null
let tabIdCounter = 0

// UI bounds configuration
const UI_TOP_HEIGHT = 52 // URL bar height
const UI_SIDEBAR_WIDTH = 296 // Sidebar width (280px) + padding (16px)
const UI_TRIGGER_WIDTH = 16 // Always visible trigger zone for sidebar hover

// Sidebar state
let sidebarOpen = false

// ============================================
// Utility Functions
// ============================================

function generateTabId(): string {
    return `tab-${++tabIdCounter}-${Date.now()}`
}

function getBrowserViewBounds(): Electron.Rectangle {
    if (!win) return { x: 0, y: 0, width: 800, height: 600 }
    const { width, height } = win.getContentBounds()
    // Always leave 16px trigger zone on left for sidebar hover
    return {
        x: UI_TRIGGER_WIDTH,
        y: UI_TOP_HEIGHT,
        width: width - UI_TRIGGER_WIDTH,
        height: height - UI_TOP_HEIGHT
    }
}

function normalizeUrl(input: string): string {
    let url = input.trim()

    // Check if it looks like a URL
    const urlPattern = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/
    const localhostPattern = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/
    const internalPattern = /^poseidon:\/\//
    const aboutPattern = /^about:/

    if (urlPattern.test(url) || localhostPattern.test(url) || internalPattern.test(url) || aboutPattern.test(url)) {
        if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('poseidon://') && !url.startsWith('about:')) {
            url = 'https://' + url
        }
        return url
    }

    // Treat as search query
    const engine = settingsStore.get('defaultSearchEngine')
    return getSearchUrl(url, engine)
}

function getSearchUrl(query: string, engine: string): string {
    const encoded = encodeURIComponent(query)
    switch (engine) {
        case 'duckduckgo':
            return `https://duckduckgo.com/?q=${encoded}`
        case 'bing':
            return `https://www.bing.com/search?q=${encoded}`
        case 'brave':
            return `https://search.brave.com/search?q=${encoded}`
        case 'google':
        default:
            return `https://www.google.com/search?q=${encoded}`
    }
}

// ============================================
// Tab Management
// ============================================

function createTab(url: string = 'poseidon://newtab', options?: { realmId?: string; dockId?: string }): Tab {
    const id = generateTabId()

    const view = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
        }
    })

    // Assign tab to realm/dock
    if (options?.dockId) {
        moveTabToDock(id, options.dockId)
    } else if (options?.realmId) {
        moveTabToRealm(id, options.realmId)
    } else {
        // Default: assign to active realm as loose tab
        assignTabToActiveRealm(id)
    }

    // Notify renderer of tab organization
    const org = getTabOrganization(id)
    if (org && win && !win.isDestroyed()) {
        win.webContents.send('tab-organization-changed', { tabId: id, ...org })
    }

    // Enable ad-blocker on this view
    // Enable ad-blocker on this view if enabled in settings
    if (blocker && adBlockEnabled) {
        // We need to enable it on the session
        safeEnableBlocking(view.webContents.session)
    }

    const tab: Tab = {
        id,
        view,
        title: 'New Tab',
        url: url,
        favicon: '',
        isLoading: false
    }

    // Set up event listeners
    view.webContents.on('did-start-loading', () => {
        tab.isLoading = true
        sendTabUpdate(tab)
    })

    view.webContents.on('did-stop-loading', () => {
        tab.isLoading = false
        sendTabUpdate(tab)
    })

    // Main navigation event - fires for full page loads
    view.webContents.on('did-navigate', (_, url) => {
        // Don't overwrite poseidon:// URL when BrowserView loads about:blank for CDP
        if (!(tab as any)._isInternalPage || !url.startsWith('about:')) {
            tab.url = url
            sendTabUpdate(tab)
            addHistoryEntry(url, tab.title, tab.favicon)
        }
    })

    // In-page navigation (hash changes, pushState)
    view.webContents.on('did-navigate-in-page', (_, url) => {
        if (!(tab as any)._isInternalPage || !url.startsWith('about:')) {
            tab.url = url
            sendTabUpdate(tab)
            addHistoryEntry(url, tab.title, tab.favicon)
        }
    })

    // Frame navigation - catches navigations in sub-frames
    view.webContents.on('did-frame-navigate', (_, url, httpResponseCode, httpStatusText, isMainFrame) => {
        if (isMainFrame) {
            // Don't overwrite poseidon:// URL when BrowserView loads about:blank for CDP
            if (!(tab as any)._isInternalPage || !url.startsWith('about:')) {
                ; (tab as any)._isInternalPage = false
                tab.url = url
                sendTabUpdate(tab)
                addHistoryEntry(url, tab.title, tab.favicon)
            }
        }
    })

    // Also update URL after page finishes loading (fallback)
    view.webContents.on('did-finish-load', () => {
        const currentUrl = view.webContents.getURL()
        // Don't overwrite poseidon:// URL when BrowserView loads about:blank for CDP
        if (currentUrl && currentUrl !== tab.url && !((tab as any)._isInternalPage && currentUrl.startsWith('about:'))) {
            tab.url = currentUrl
            sendTabUpdate(tab)
        }
    })

    view.webContents.on('page-title-updated', (_, title) => {
        // Don't overwrite title for internal pages (BrowserView loads about:blank for CDP)
        if ((tab as any)._isInternalPage) return
        tab.title = title || 'Untitled'
        sendTabUpdate(tab)
        // Update history with new title
        updateHistoryEntry(tab.url, tab.title, tab.favicon)
    })

    view.webContents.on('page-favicon-updated', (_, favicons) => {
        if (favicons.length > 0) {
            tab.favicon = favicons[0]
            sendTabUpdate(tab)
            // Update history with new favicon
            updateHistoryEntry(tab.url, tab.title, tab.favicon)
        }
    })

    // Handle new window requests (open in new tab)
    view.webContents.setWindowOpenHandler(({ url }) => {
        createTab(url)
        switchToTab(tabs.get(Array.from(tabs.keys()).pop()!)!.id)
        return { action: 'deny' }
    })

    tabs.set(id, tab)

    // Attach BrowserView to window so it has a rendering surface.
    // This is required for CDP commands (DOM extraction, screenshots, accessibility tree)
    // to work properly. The view is positioned off-screen; the <webview> in React
    // handles the user-visible display.
    if (win && !win.isDestroyed()) {
        win.addBrowserView(view)
        view.setBounds({ x: 0, y: -10000, width: 1280, height: 720 })
        view.webContents.setAudioMuted(true)
    }

    // Navigate to URL
    // Internal pages (poseidon://) are rendered by the React webview, not the BrowserView.
    // But we still load about:blank into the BrowserView so it has a JS runtime
    // (required for CDP's Runtime.runIfWaitingForDebugger to not hang).
    if (url === 'poseidon://newtab' || url === 'poseidon://settings') {
        // Mark as internal so nav events don't overwrite the poseidon:// URL
        ; (tab as any)._isInternalPage = true
        view.webContents.loadURL('about:blank')
    } else {
        view.webContents.loadURL(normalizeUrl(url))
    }

    // Send tab created event
    sendTabsUpdate()

    return tab
}

function switchToTab(tabId: string): void {
    const tab = tabs.get(tabId)
    if (!tab) return

    // Just update active tab - webview in renderer handles display
    activeTabId = tabId

    // Send updates to renderer
    sendActiveTabUpdate()
    sendTabUpdate(tab)
}

function closeTab(tabId: string): void {
    const tab = tabs.get(tabId)
    if (!tab) return

    // Remove tab organization
    removeTabOrganization(tabId)

    // Remove BrowserView from window and destroy
    if (win && !win.isDestroyed()) {
        win.removeBrowserView(tab.view)
    }
    ; (tab.view.webContents as any).destroy()
    tabs.delete(tabId)

    // If this was the active tab, switch to another
    if (activeTabId === tabId) {
        const remainingTabs = Array.from(tabs.keys())
        if (remainingTabs.length > 0) {
            switchToTab(remainingTabs[remainingTabs.length - 1])
        } else {
            activeTabId = null
            // Create a new tab if all closed
            const newTab = createTab()
            switchToTab(newTab.id)
        }
    }

    sendTabsUpdate()
}

function navigateTab(tabId: string, url: string): void {
    const tab = tabs.get(tabId)
    if (!tab) return

    const normalizedUrl = normalizeUrl(url)

    // Update tab URL
    tab.url = normalizedUrl
    sendTabUpdate(tab)

    // Tell the renderer to navigate the webview explicitly
    if (win && !win.isDestroyed()) {
        win.webContents.send('navigate-to-url', { tabId, url: normalizedUrl })
    }
}

// ============================================
// IPC Communication
// ============================================

function sendTabUpdate(tab: Tab): void {
    if (!win || win.isDestroyed()) return
    const org = getTabOrganization(tab.id)
    win.webContents.send('tab-updated', {
        id: tab.id,
        title: tab.title,
        url: tab.url,
        favicon: tab.favicon,
        isLoading: tab.isLoading,
        realmId: org?.realmId,
        dockId: org?.dockId,
        order: org?.order,
        isPinned: org?.isPinned,
    })
}

function sendTabsUpdate(): void {
    if (!win || win.isDestroyed()) return
    const tabList = Array.from(tabs.values()).map(tab => {
        const org = getTabOrganization(tab.id)
        return {
            id: tab.id,
            title: tab.title,
            url: tab.url,
            favicon: tab.favicon,
            isLoading: tab.isLoading,
            realmId: org?.realmId,
            dockId: org?.dockId,
            order: org?.order,
            isPinned: org?.isPinned,
        }
    })
    win.webContents.send('tabs-updated', tabList)
}

function sendActiveTabUpdate(): void {
    if (!win || win.isDestroyed()) return
    const tab = activeTabId ? tabs.get(activeTabId) : null
    win.webContents.send('active-tab-changed', tab ? {
        id: tab.id,
        title: tab.title,
        url: tab.url,
        favicon: tab.favicon,
        isLoading: tab.isLoading,
        canGoBack: tab.view.webContents.canGoBack(),
        canGoForward: tab.view.webContents.canGoForward()
    } : null)
}

// ============================================
// Ad Blocker
// ============================================

// Helper to safely enable blocking (shims removed Electron APIs)
function safeEnableBlocking(sess: Electron.Session) {
    if (!sess || !blocker) return

    // Shim registerPreloadScript if missing (Electron 20+)
    // @ts-ignore
    if (!sess.registerPreloadScript) {
        // @ts-ignore
        sess.registerPreloadScript = (_: any) => {
            return () => { }
        }
    }

    blocker.enableBlockingInSession(sess)
}

const isLocal = (url: string) => {
    return url.includes('localhost') || url.includes('127.0.0.1') || url.startsWith('file:') || url.startsWith('poseidon:')
}

function setupRequestInterceptor(sess: Electron.Session): void {
    // We attach a single listener that handles both HTTPS Upgrade and Ad Blocking
    // because Electron only allows one listener per event type.

    // First, remove any existing listener to prevent duplicates
    sess.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
        // console.log('[Interceptor] Request:', details.url, 'HTTPS Upgrade Enabled:', httpsUpgradeEnabled)

        // 1. HTTPS Upgrade
        if (httpsUpgradeEnabled && details.url.startsWith('http://') && !isLocal(details.url)) {
            const httpsUrl = details.url.replace('http:', 'https:')
            return callback({ redirectURL: httpsUrl })
        }

        // 2. Ad Blocking
        if (adBlockEnabled && blocker) {
            // Delegate to ad blocker, but spy on the result
            return blocker.onBeforeRequest(details, (response) => {
                callback(response)
            })
        }

        // 3. Default (Allow)
        callback({})
    })
}


async function initAdBlocker(): Promise<void> {
    try {
        httpsUpgradeEnabled = settingsStore.get('httpsUpgradeEnabled')
        blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch)

        blocker.on('request-blocked', (request) => {
            blockedCount++
            if (win && !win.isDestroyed()) {
                win.webContents.send('ad-blocked', { count: blockedCount, url: request.url })
            }
        })

        blocker.on('request-redirected', () => {
            blockedCount++
            if (win && !win.isDestroyed()) {
                win.webContents.send('ad-blocked', { count: blockedCount })
            }
        })

        // Enable on default session if enabled
        if (adBlockEnabled) {
            safeEnableBlocking(session.defaultSession)
        }

        // Always setup interceptor (handles HTTPS upgrade even if ad block is off)
        setupRequestInterceptor(session.defaultSession)

    } catch (error) {
        console.error('Failed to initialize ad blocker:', error)
    }
}

function toggleAdBlocker(enabled: boolean): void {
    adBlockEnabled = enabled

    if (blocker) {
        const sess = session.defaultSession

        if (enabled) {
            if (!blocker.isBlockingEnabled(sess)) {
                safeEnableBlocking(sess)
            }
        } else {
            if (blocker.isBlockingEnabled(sess)) {
                // Polyfill unregisterPreloadScript if missing (Electron 28+ removed it)
                // @ts-ignore
                if (typeof sess.unregisterPreloadScript !== 'function') {
                    // @ts-ignore
                    sess.unregisterPreloadScript = () => { }
                }

                try {
                    blocker.disableBlockingInSession(sess)
                } catch (e) {
                    console.error('[AdBlock] Error disabling blocking:', e)
                }
            }
        }

        // Re-apply our interceptor to ensure HTTPS upgrade persists or AdBlock is hooked up
        // (disableBlockingInSession removes the listener, so we MUST re-add ours)
        setupRequestInterceptor(sess)
    }
}

function toggleHttpsUpgrade(enabled: boolean): void {
    httpsUpgradeEnabled = enabled
    setupRequestInterceptor(session.defaultSession)
}

// ============================================
// IPC Handlers

function setupIPC(): void {
    // Tab management
    ipcMain.handle('create-tab', (_, url?: string, options?: { realmId?: string; dockId?: string }) => {
        // Use createTab's default (poseidon://newtab) when no URL provided
        const tab = url ? createTab(url, options) : createTab(undefined, options)
        switchToTab(tab.id)
        return { id: tab.id, realmId: getTabOrganization(tab.id)?.realmId }
    })

    // Agent tab: create a tab and return CDP connection info including target ID
    ipcMain.handle('create-agent-tab', async () => {
        // Snapshot existing targets before creating the tab
        let existingTargetIds = new Set<string>()
        try {
            const beforeRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json`)
            const before = await beforeRes.json() as Array<{ id: string }>
            existingTargetIds = new Set(before.map((t: any) => t.id))
        } catch { /* ignore */ }

        const tab = createTab('about:blank')
        switchToTab(tab.id)

        // Find the new CDP target by diffing before/after
        try {
            // Small delay to let the target register
            await new Promise(r => setTimeout(r, 200))
            const afterRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json`)
            const after = await afterRes.json() as Array<{ id: string; type: string; url: string }>
            const newTarget = after.find((t: any) => t.type === 'page' && !existingTargetIds.has(t.id))

            console.log('[Agent] New agent tab target:', newTarget?.id, newTarget?.url)

            return {
                tabId: tab.id,
                cdpUrl: `http://127.0.0.1:${CDP_PORT}`,
                targetId: newTarget?.id || null,
            }
        } catch (err) {
            console.error('[Agent] Failed to query CDP endpoint:', err)
            return {
                tabId: tab.id,
                cdpUrl: `http://127.0.0.1:${CDP_PORT}`,
                targetId: null,
            }
        }
    })

    ipcMain.handle('close-tab', (_, tabId: string) => {
        closeTab(tabId)
        return { success: true }
    })

    ipcMain.handle('switch-tab', (_, tabId: string) => {
        switchToTab(tabId)
        return { success: true }
    })

    ipcMain.handle('get-tabs', () => {
        return Array.from(tabs.values()).map(tab => {
            const org = getTabOrganization(tab.id)
            return {
                id: tab.id,
                title: tab.title,
                url: tab.url,
                favicon: tab.favicon,
                isLoading: tab.isLoading,
                realmId: org?.realmId,
                dockId: org?.dockId,
                order: org?.order,
                isPinned: org?.isPinned,
            }
        })
    })

    ipcMain.handle('get-active-tab', () => {
        if (!activeTabId) return null
        const tab = tabs.get(activeTabId)
        if (!tab) return null
        return {
            id: tab.id,
            title: tab.title,
            url: tab.url,
            favicon: tab.favicon,
            isLoading: tab.isLoading,
            canGoBack: tab.view.webContents.canGoBack(),
            canGoForward: tab.view.webContents.canGoForward()
        }
    })

    ipcMain.handle('update-tab-state', (_, tabId: string, data: Partial<Tab>) => {
        const tab = tabs.get(tabId)
        if (!tab) return { success: false }

        // Update fields
        if (data.url !== undefined) tab.url = data.url
        if (data.title !== undefined) tab.title = data.title
        if (data.favicon !== undefined) tab.favicon = data.favicon
        if (data.isLoading !== undefined) tab.isLoading = data.isLoading

        // Handle URL update - add to history
        if (data.url) {
            addHistoryEntry(data.url, tab.title, tab.favicon)
        }

        // Handle title/favicon update - update history
        if (data.title || data.favicon) {
            updateHistoryEntry(tab.url, tab.title, tab.favicon)
        }

        // Notify renderer
        sendTabUpdate(tab)

        return { success: true }
    })

    // Navigation
    ipcMain.handle('navigate', (_, url: string) => {
        if (activeTabId) {
            navigateTab(activeTabId, url)
        }
        return { success: true }
    })

    ipcMain.handle('go-back', () => {
        if (activeTabId) {
            const tab = tabs.get(activeTabId)
            if (tab?.view.webContents.canGoBack()) {
                tab.view.webContents.goBack()
            }
        }
        return { success: true }
    })

    ipcMain.handle('go-forward', () => {
        if (activeTabId) {
            const tab = tabs.get(activeTabId)
            if (tab?.view.webContents.canGoForward()) {
                tab.view.webContents.goForward()
            }
        }
        return { success: true }
    })

    ipcMain.handle('reload', () => {
        if (activeTabId) {
            const tab = tabs.get(activeTabId)
            tab?.view.webContents.reload()
        }
        return { success: true }
    })

    ipcMain.handle('stop', () => {
        if (activeTabId) {
            const tab = tabs.get(activeTabId)
            tab?.view.webContents.stop()
        }
        return { success: true }
    })

    // Ad blocker
    ipcMain.handle('toggle-ad-block', (_, enabled: boolean) => {
        toggleAdBlocker(enabled)
        return { enabled: adBlockEnabled }
    })

    ipcMain.handle('get-ad-block-status', () => {
        return {
            enabled: adBlockEnabled,
            blockedCount,
            httpsUpgradeCount
        }
    })

    ipcMain.handle('reset-blocked-count', () => {
        blockedCount = 0
        httpsUpgradeCount = 0
        return { blockedCount, httpsUpgradeCount }
    })

    ipcMain.handle('get-adblock-preload-path', () => {
        try {
            // Resolve the path to the adblocker's preload script
            // This script handles cosmetic filtering (hiding ads) in the renderer
            return require.resolve('@ghostery/adblocker-electron-preload')
        } catch (error) {
            console.error('Failed to resolve adblock preload path:', error)
            return ''
        }
    })

    ipcMain.handle('get-webview-preload-path', () => {
        return path.join(__dirname, 'webview-preload.js')
    })

    // Settings
    ipcMain.handle('get-settings', () => {
        return settingsStore.getAll()
    })

    ipcMain.handle('get-setting', (_, key: keyof AppSettings) => {
        return settingsStore.get(key)
    })

    ipcMain.handle('set-setting', (_, key: keyof AppSettings, value: any) => {
        const settings = settingsStore.set(key, value)

        // Handle side effects
        if (key === 'adBlockerEnabled') {
            toggleAdBlocker(value)
        } else if (key === 'httpsUpgradeEnabled') {
            toggleHttpsUpgrade(value)
        }

        // Notify renderer of settings change
        if (win && !win.isDestroyed()) {
            win.webContents.send('settings-changed', { key, value, settings })
        }

        // Apply setting immediately if it affects the main process
        if (key === 'adBlockerEnabled') {
            toggleAdBlocker(value as boolean)
        }

        return settings
    })

    ipcMain.handle('update-settings', (_, updates: Partial<AppSettings>) => {
        const settings = settingsStore.update(updates)
        if (win && !win.isDestroyed()) {
            win.webContents.send('settings-changed', { settings })
        }

        // Apply ad blocker setting if included
        if ('adBlockerEnabled' in updates) {
            toggleAdBlocker(updates.adBlockerEnabled as boolean)
        }

        return settings
    })

    ipcMain.handle('reset-settings', () => {
        const settings = settingsStore.reset()
        if (win && !win.isDestroyed()) {
            win.webContents.send('settings-changed', { settings })
        }
        toggleAdBlocker(settings.adBlockerEnabled)
        return settings
    })

    // Sidebar state tracking (no bounds adjustment - sidebar floats over)
    ipcMain.handle('sidebar-set-open', (_, isOpen: boolean) => {
        sidebarOpen = isOpen
        // Note: We don't resize BrowserView - the sidebar floats over the content
        // The 16px trigger zone is always visible for hover detection
    })

    // History
    ipcMain.handle('history-search', (_, query: string, limit?: number) => {
        return searchHistory(query, limit || 10)
    })

    ipcMain.handle('history-top-sites', (_, limit?: number) => {
        return getTopSites(limit || 8)
    })

    ipcMain.handle('history-recent', (_, limit?: number) => {
        return getRecentHistory(limit || 20)
    })

    ipcMain.handle('history-clear', () => {
        clearHistory()
        return { success: true }
    })

    // Google search suggestions (proxy to avoid CORS in renderer)
    ipcMain.handle('search-suggestions', async (_, query: string) => {
        if (!query || query.length < 1) {
            return []
        }
        try {
            const response = await fetch(
                `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`
            )
            const data = await response.json()
            return data[1] as string[] // The suggestions array
        } catch (err) {
            console.error('Failed to fetch search suggestions:', err)
            return []
        }
    })

    // ============================================
    // Realm Management
    // ============================================

    ipcMain.handle('get-realms', () => {
        return getRealms()
    })

    ipcMain.handle('get-realm', (_, realmId: string) => {
        return getRealm(realmId)
    })

    ipcMain.handle('get-active-realm-id', () => {
        return getActiveRealmId()
    })

    ipcMain.handle('set-active-realm', (_, realmId: string) => {
        const success = setActiveRealmId(realmId)
        if (success && win && !win.isDestroyed()) {
            win.webContents.send('active-realm-changed', { realmId })
        }
        return { success }
    })

    ipcMain.handle('create-realm', (_, name: string, icon?: IconName, color?: ThemeColor) => {
        const realm = createRealmFromParams(name, icon, color)
        if (win && !win.isDestroyed()) {
            win.webContents.send('realm-created', realm)
        }
        return realm
    })

    ipcMain.handle('update-realm', (_, realmId: string, updates: { name?: string; icon?: IconName; color?: ThemeColor }) => {
        const realm = updateRealm(realmId, updates)
        if (realm && win && !win.isDestroyed()) {
            win.webContents.send('realm-updated', realm)
        }
        return realm
    })

    ipcMain.handle('delete-realm', (_, realmId: string) => {
        const success = deleteRealm(realmId)
        if (success && win && !win.isDestroyed()) {
            win.webContents.send('realm-deleted', { realmId })
        }
        return { success }
    })

    ipcMain.handle('reorder-realms', (_, realmIds: string[]) => {
        const success = reorderRealms(realmIds)
        if (success && win && !win.isDestroyed()) {
            win.webContents.send('realms-reordered', { realmIds })
        }
        return { success }
    })

    // ============================================
    // Dock Management
    // ============================================

    ipcMain.handle('get-docks', (_, realmId?: string) => {
        return getDocks(realmId)
    })

    ipcMain.handle('get-dock', (_, dockId: string) => {
        return getDock(dockId)
    })

    ipcMain.handle('create-dock', (_, name: string, realmId: string, icon?: IconName, color?: ThemeColor) => {
        const dock = createDockFromParams(name, realmId, icon, color)
        if (dock && win && !win.isDestroyed()) {
            win.webContents.send('dock-created', dock)
        }
        return dock
    })

    ipcMain.handle('update-dock', (_, dockId: string, updates: { name?: string; icon?: IconName; color?: ThemeColor; isCollapsed?: boolean }) => {
        const dock = updateDock(dockId, updates)
        if (dock && win && !win.isDestroyed()) {
            win.webContents.send('dock-updated', dock)
        }
        return dock
    })

    ipcMain.handle('toggle-dock-collapse', (_, dockId: string) => {
        const dock = toggleDockCollapse(dockId)
        if (dock && win && !win.isDestroyed()) {
            win.webContents.send('dock-updated', dock)
        }
        return dock
    })

    ipcMain.handle('delete-dock', (_, dockId: string) => {
        const success = deleteDock(dockId)
        if (success && win && !win.isDestroyed()) {
            win.webContents.send('dock-deleted', { dockId })
        }
        return { success }
    })

    ipcMain.handle('reorder-docks', (_, realmId: string, dockIds: string[]) => {
        const success = reorderDocks(realmId, dockIds)
        if (success && win && !win.isDestroyed()) {
            win.webContents.send('docks-reordered', { realmId, dockIds })
        }
        return { success }
    })

    ipcMain.handle('move-dock-to-realm', (_, dockId: string, newRealmId: string) => {
        const success = moveDockToRealm(dockId, newRealmId)
        if (success && win && !win.isDestroyed()) {
            win.webContents.send('dock-moved', { dockId, newRealmId })
        }
        return { success }
    })

    // ============================================
    // Tab Organization
    // ============================================

    ipcMain.handle('get-tab-organization', (_, tabId: string) => {
        return getTabOrganization(tabId)
    })

    ipcMain.handle('get-all-tab-organizations', () => {
        return getAllTabOrganizations()
    })

    ipcMain.handle('move-tab-to-dock', (_, tabId: string, dockId: string) => {
        const success = moveTabToDock(tabId, dockId)
        if (success && win && !win.isDestroyed()) {
            const org = getTabOrganization(tabId)
            win.webContents.send('tab-organization-changed', { tabId, ...org })
        }
        return { success }
    })

    ipcMain.handle('move-tab-to-loose', (_, tabId: string, realmId?: string) => {
        const success = moveTabToLoose(tabId, realmId)
        if (success && win && !win.isDestroyed()) {
            const org = getTabOrganization(tabId)
            win.webContents.send('tab-organization-changed', { tabId, ...org })
        }
        return { success }
    })

    ipcMain.handle('move-tab-to-realm', (_, tabId: string, realmId: string) => {
        const success = moveTabToRealm(tabId, realmId)
        if (success && win && !win.isDestroyed()) {
            const org = getTabOrganization(tabId)
            win.webContents.send('tab-organization-changed', { tabId, ...org })
        }
        return { success }
    })

    ipcMain.handle('pin-tab', (_, tabId: string) => {
        const success = pinTab(tabId)
        if (success && win && !win.isDestroyed()) {
            const org = getTabOrganization(tabId)
            win.webContents.send('tab-organization-changed', { tabId, ...org })
        }
        return { success }
    })

    ipcMain.handle('unpin-tab', (_, tabId: string) => {
        const success = unpinTab(tabId)
        if (success && win && !win.isDestroyed()) {
            const org = getTabOrganization(tabId)
            win.webContents.send('tab-organization-changed', { tabId, ...org })
        }
        return { success }
    })

    ipcMain.handle('reorder-tabs-in-dock', (_, dockId: string, tabIds: string[]) => {
        const success = reorderTabsInDock(dockId, tabIds)
        // Emit events for each reordered tab so frontend updates
        if (success && win && !win.isDestroyed()) {
            tabIds.forEach(tabId => {
                const org = getTabOrganization(tabId)
                if (org) {
                    win!.webContents.send('tab-organization-changed', { tabId, ...org })
                }
            })
        }
        return { success }
    })

    ipcMain.handle('reorder-loose-tabs', (_, realmId: string, tabIds: string[]) => {
        const success = reorderLooseTabs(realmId, tabIds)
        // Emit events for each reordered tab so frontend updates
        if (success && win && !win.isDestroyed()) {
            tabIds.forEach(tabId => {
                const org = getTabOrganization(tabId)
                if (org) {
                    win!.webContents.send('tab-organization-changed', { tabId, ...org })
                }
            })
        }
        return { success }
    })

    // ============================================
    // Sidebar State
    // ============================================

    ipcMain.handle('get-sidebar-state', () => {
        const state = getFullState()
        const organizations = getAllTabOrganizations()

        // Build tab info with organization data
        const tabsWithOrg = Array.from(tabs.values()).map(tab => {
            const org = organizations[tab.id] || {
                realmId: state.activeRealmId,
                dockId: null,
                order: 0,
                isPinned: false,
            }
            return {
                id: tab.id,
                title: tab.title,
                url: tab.url,
                favicon: tab.favicon,
                isLoading: tab.isLoading,
                realmId: org.realmId,
                dockId: org.dockId,
                order: org.order,
                isPinned: org.isPinned,
            }
        })

        return {
            ...state,
            tabs: tabsWithOrg,
        }
    })
}

// ============================================
// Window Management
// ============================================

function createWindow(): void {
    win = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webviewTag: true, // Enable <webview> tag for proper z-index layering
        },
        backgroundColor: '#FFFFFF',
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 14 },
        show: false, // Show when ready
    })

    // Show when ready to prevent flash
    win.once('ready-to-show', () => {
        win?.show()
    })

    // macOS native swipe gesture for back/forward navigation
    // Fires on finger lift after a two/three-finger swipe (based on System Preferences)
    win.on('swipe', (_event, direction) => {
        if (!win || win.isDestroyed()) return
        win.webContents.send('swipe-navigate', direction)
    })

    // macOS trackpad scroll phase detection on ALL webContents (including webview guests).
    // scroll-touch-begin/end are macOS-only webContents events that fire when fingers
    // touch/leave the trackpad — the same signal browsers use to distinguish direct
    // manipulation from momentum/inertia scrolling.
    app.on('web-contents-created', (_event, contents) => {
        ; (contents as any).on('scroll-touch-begin', () => {
            if (!win || win.isDestroyed()) return
            win.webContents.send('scroll-touch-begin')
        })
            ; (contents as any).on('scroll-touch-end', () => {
                if (!win || win.isDestroyed()) return
                win.webContents.send('scroll-touch-end')
            })
    })

    // Set up custom menu to prevent Cmd+R from reloading the main window
    // Instead, Cmd+R reloads the active tab's webview content
    const menu = Menu.buildFromTemplate([
        {
            label: 'Poseidon',
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
            ],
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
            ],
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Reload Page',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        if (activeTabId) {
                            const tab = tabs.get(activeTabId)
                            if (tab) {
                                // Reload the webview in the renderer via IPC
                                win?.webContents.send('reload-active-tab')
                            }
                        }
                    },
                },
                {
                    label: 'Force Reload Page',
                    accelerator: 'CmdOrCtrl+Shift+R',
                    click: () => {
                        if (activeTabId) {
                            win?.webContents.send('reload-active-tab')
                        }
                    },
                },
                { type: 'separator' },
                {
                    label: 'Toggle Developer Tools',
                    accelerator: 'CmdOrCtrl+Alt+I',
                    click: () => {
                        win?.webContents.toggleDevTools()
                    },
                },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                { role: 'close' },
            ],
        },
    ])
    Menu.setApplicationMenu(menu)

    // Load the UI
    win.loadURL('http://127.0.0.1:5173')

    // DevTools: don't auto-open — it creates a devtools:// CDP target that
    // hangs browser-use's session initialization. Open manually with Cmd+Option+I.

    // When UI is loaded, create initial tab (only if no tabs exist yet)
    win.webContents.on('did-finish-load', () => {
        // Guard: only create a tab on first load, not on renderer reload
        if (tabs.size === 0) {
            const tab = createTab('poseidon://newtab')
            switchToTab(tab.id)
        } else {
            // Renderer reloaded - resync existing tabs
            sendTabsUpdate()
            if (activeTabId) {
                const tab = tabs.get(activeTabId)
                if (tab) sendTabUpdate(tab)
                sendActiveTabUpdate()
            }
        }

        // Send initial ad block status
        win?.webContents.send('ad-block-status', {
            enabled: adBlockEnabled,
            count: blockedCount
        })
    })

    // Enable ad-blocking on webview tags when they are attached
    win.webContents.on('did-attach-webview', (_, webContents) => {
        // Enable ad-blocker on this webview's session
        if (blocker && adBlockEnabled && !blocker.isBlockingEnabled(webContents.session)) {
            try {
                safeEnableBlocking(webContents.session)
            } catch (err) {
                console.error('Failed to enable ad-blocker for webview session:', err)
            }
        }

        // HTTPS Upgrade: Intercept HTTP requests and upgrade to HTTPS
        webContents.session.webRequest.onBeforeRequest(
            { urls: ['http://*/*'] },
            (details, callback) => {
                // Skip localhost and local network
                const url = new URL(details.url)
                const isLocal = url.hostname === 'localhost' ||
                    url.hostname === '127.0.0.1' ||
                    url.hostname.endsWith('.local')

                if (!isLocal && adBlockEnabled) {
                    const httpsUrl = details.url.replace('http://', 'https://')
                    httpsUpgradeCount++

                    // Notify renderer of the upgrade
                    if (win && !win.isDestroyed()) {
                        win.webContents.send('https-upgraded', { count: httpsUpgradeCount })
                    }
                    callback({ redirectURL: httpsUrl })
                } else {
                    callback({})
                }
            }
        )

        // Cookie listener removed to prevent MaxListenersExceededWarning on shared session

        // Aggressive Popup Blocking
        webContents.setWindowOpenHandler((details) => {
            const { url, disposition, features } = details

            // Allow if opened by user gesture (often indicated by features or timing)
            // But strict ad blockers often block even these if the URL matches an ad pattern

            // Check against ad blocker
            if (blocker && adBlockEnabled) {
                // Check if the URL is an ad/tracker
                const request = Request.fromRawDetails({
                    url: url,
                    type: 'popup' as any,
                    requestId: Date.now().toString(), // Dummy ID
                    sourceUrl: webContents.getURL()
                })

                const { match } = blocker.match(request)

                if (match) {
                    blockedCount++
                    if (win && !win.isDestroyed()) {
                        win.webContents.send('ad-blocked', { count: blockedCount, url })
                    }
                    return { action: 'deny' }
                }
            }

            // If it's a known streaming site popup pattern (often blank or unrelated domain)
            const currentUrl = webContents.getURL()
            const isStreamingSite = /footybite|totalsportek|soccerstreams/i.test(currentUrl)

            if (isStreamingSite) {
                blockedCount++
                if (win && !win.isDestroyed()) {
                    win.webContents.send('ad-blocked', { count: blockedCount, url })
                }
                return { action: 'deny' }
            }

            // Normal behavior: Open in new tab
            createTab(url)
            return { action: 'deny' }
        })
    })
}

// ============================================
// Python Backend
// ============================================

function startPythonBackend(): void {
    const isDev = !app.isPackaged
    const pythonPath = isDev
        ? path.join(__dirname, '../venv/bin/python3')
        : path.join(process.resourcesPath, 'backend/venv/bin/python3')

    console.log('Starting Python Backend...')

    pythonProcess = spawn(pythonPath, [
        '-m', 'uvicorn', 'backend.server:app',
        '--host', '127.0.0.1',
        '--port', '8000',
        '--reload',
        '--log-level', 'warning'
    ], {
        cwd: path.join(__dirname, '../'),
        stdio: 'inherit'
    })

    pythonProcess.on('close', (code) => {
        console.log(`Python process exited with code ${code}`)
    })

    pythonProcess.on('error', (err) => {
        console.error('Failed to start Python process:', err)
    })
}

function killPythonBackend(): void {
    if (pythonProcess) {
        console.log('Stopping Python Backend...')
        pythonProcess.kill()
        pythonProcess = null
    }
}

// ============================================
// App Lifecycle
// ============================================

app.on('window-all-closed', () => {
    // Clean up all tabs
    tabs.forEach(tab => {
        ; (tab.view.webContents as any).destroy()
    })
    tabs.clear()

    killPythonBackend()
    win = null

    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('before-quit', () => {
    killPythonBackend()
    closeDatabase()
    closeStore()
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

app.whenReady().then(async () => {
    setupIPC()

    // Set Chrome user agent for the webview partition to ensure websites
    // (like YouTube) serve the full desktop version, not simplified layouts
    const webviewSession = session.fromPartition('persist:poseidon')
    webviewSession.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    )

    // Migrate history from JSON to SQLite (one-time)
    migrateFromJson()

    await initAdBlocker()
    startPythonBackend()
    createWindow()
})
