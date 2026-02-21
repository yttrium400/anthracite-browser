import { app, BrowserWindow, BrowserView, ipcMain, session, Menu, webContents } from 'electron'
import path from 'node:path'

import { autoUpdater } from 'electron-updater'

// Enable CDP remote debugging so the AI agent can connect to Anthracite's browser
const CDP_PORT = 9222
app.commandLine.appendSwitch('remote-debugging-port', String(CDP_PORT))
import { spawn, ChildProcess } from 'node:child_process'

import fetch from 'cross-fetch'


// Auto-updater logging
autoUpdater.logger = require("electron-log")
    ; (autoUpdater.logger as any).transports.file.level = "info"

app.on('ready', () => {
    // Check for updates after a short delay
    setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify()
    }, 2000)
})




app.on('web-contents-created', (_, contents) => {
    // console.log('[App] web-contents-created', contents.id, contents.getType())

    // Intercept window open requests from any web contents (including <webview>)
    contents.setWindowOpenHandler((details) => {
        // Check if this is a real navigation request
        if (details.url && details.url !== 'about:blank') {

            // Create tab via main process function
            // We need to resolve the realm/dock from the source contents if possible,
            // but for now let's just create it in the active context.
            // Since we can't easily map contents -> tab ID here without a lookup,
            // we'll let createTab handle default assignment.

            // We need to ensure we don't block internal popups if any, but for a browser,
            // almost all window.opens should be tabs.

            // Use setImmediate to avoid blocking the handler
            setImmediate(() => {
                const tab = createTab(details.url)
                switchToTab(tab.id)
            })

            return { action: 'deny' }
        }
        return { action: 'allow' }
    })
})

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

let blockedCount = 0
let httpsUpgradeCount = 0
let adBlockEnabled = false // Temporarily disabled for performance testing
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

// UI Scale → Electron zoom level mapping
const UI_SCALE_ZOOM: Record<string, number> = {
    'extra-small': -2,
    'small': -1,
    'medium': 0,
    'large': 1,
    'extra-large': 2,
}

function applyUiScale(scale: string): void {
    if (!win || win.isDestroyed()) return
    const zoomLevel = UI_SCALE_ZOOM[scale] ?? -2
    win.webContents.setZoomLevel(zoomLevel)
    // Also apply to all webview guests
    for (const [, tab] of tabs) {
        try {
            tab.view.webContents.setZoomLevel(zoomLevel)
        } catch { }
    }
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
    const internalPattern = /^anthracite:\/\//
    const aboutPattern = /^about:/

    const filePattern = /^file:\/\//

    if (urlPattern.test(url) || localhostPattern.test(url) || internalPattern.test(url) || aboutPattern.test(url) || filePattern.test(url)) {
        if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('anthracite://') && !url.startsWith('about:') && !url.startsWith('file:')) {
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

function createTab(url: string = 'anthracite://newtab', options?: { realmId?: string; dockId?: string }): Tab {
    const id = generateTabId()

    const view = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join(__dirname, 'webview-preload.js'), // Inject cosmetic filtering script + swipe gestures
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

    // Apply current UI scale to new tab
    const currentScale = settingsStore.get('uiScale')
    const zoomLevel = UI_SCALE_ZOOM[currentScale] ?? -2
    view.webContents.setZoomLevel(zoomLevel)

    // Notify renderer of tab organization
    const org = getTabOrganization(id)
    if (org && win && !win.isDestroyed()) {
        win.webContents.send('tab-organization-changed', { tabId: id, ...org })
    }

    // Enable ad-blocker on this view
    // Enable ad-blocker on this view if enabled in settings
    // Enable ad-blocker on this view
    // Note: We don't need to call safeEnableBlocking here because we enabled it on the session
    // globally in initAdBlocker, and the session is persistent.
    // Calling it here would reset the webRequest listeners, breaking our HTTPS upgrade interceptor.

    const tab: Tab = {
        id,
        view,
        title: 'New Tab',
        url: url,
        favicon: '',
        isLoading: false
    }

    // Set up event listeners
    // Navigation state tracking for performance logging
    const navStartTimes = new Map<string, number>()

    view.webContents.on('did-start-loading', () => {
        // Ignore non-main-frame loads (e.g. iframes, in-page nav) to prevent UI flicker
        // if (!view.webContents.isLoadingMainFrame()) return

        // Only log if not already loading to avoid noise
        if (!tab.isLoading) {
            // console.log(`[Perf] [${id}] did-start-loading`)
            navStartTimes.set(id, performance.now())
        }

        tab.isLoading = true
        sendTabUpdate(tab)
    })

    view.webContents.on('did-stop-loading', () => {
        const startTime = navStartTimes.get(id)
        // const duration = startTime ? (performance.now() - startTime).toFixed(2) : '?'

        tab.isLoading = false
        sendTabUpdate(tab)
    })

    // Main navigation event - fires for full page loads
    view.webContents.on('did-navigate', (event, url) => {
        const currentTab = tabs.get(id)
        if (currentTab) {
            // BrowserView only loads about:blank?browserview=1 marker — never real URLs.
            // Skip all about: navigations; real URL updates come from the webview in renderer.
            if (url.startsWith('about:')) return

            currentTab.url = url
            sendActiveTabUpdate()
            sendTabsUpdate()

            // Add to history (deferred to unblock navigation)
            setTimeout(() => {
                addHistoryEntry(url, currentTab.title, currentTab.favicon)
            }, 500)
        }
    })

    view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        // console.error(`[Perf] [${id}] did-fail-load: ${errorCode} ${errorDescription} (${validatedURL})`)
    })

    // In-page navigation (hash changes, pushState)
    view.webContents.on('did-navigate-in-page', (_, url) => {
        if (!(tab as any)._isInternalPage || !url.startsWith('about:')) {
            tab.url = url
            sendTabUpdate(tab)
            addHistoryEntry(url, tab.title, tab.favicon)

            // Trigger SPA injection in preload script
            view.webContents.send('spa-navigate', url)
        }
    })

    // Frame navigation - catches navigations in sub-frames
    view.webContents.on('did-frame-navigate', (_, url, httpResponseCode, httpStatusText, isMainFrame) => {
        if (isMainFrame) {
            // BrowserView only ever loads about:blank?browserview=1 (marker URL for CDP target
            // identification). Never update tab URL from about: navigations — they're always
            // the BrowserView marker, not real page navigations.
            if (!url.startsWith('about:')) {
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
        // BrowserView only loads the about:blank?browserview=1 marker — skip about: URLs always
        if (currentUrl && !currentUrl.startsWith('about:') && currentUrl !== tab.url) {
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
    // This blocks new Electron windows and keeps everything in-app, maintaining Realm/Dock context.
    view.webContents.setWindowOpenHandler((details) => {
        console.log('[WindowOpen] Request:', details)
        // Inherit parent's organization (Realm/Dock)
        const parentOrg = getTabOrganization(id)

        // Create new tab in the same context
        const newTab = createTab(details.url, {
            realmId: parentOrg?.realmId,
            dockId: parentOrg?.dockId || undefined
        })

        switchToTab(newTab.id)
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
    // Internal pages (anthracite://) are rendered by the React webview, not the BrowserView.
    // BrowserView gets a marker URL so it can be identified (and excluded) in CDP /json targets.
    if (url === 'anthracite://newtab' || url === 'anthracite://settings') {
        // Mark as internal so nav events don't overwrite the anthracite:// URL
        ; (tab as any)._isInternalPage = true
    } else {
        // Shadow View Disconnect: Only load about:blank to prevent double-loading
        tab.url = normalizeUrl(url)
    }
    // Load marker URL into BrowserView so it's identifiable in CDP /json target list.
    // The webview (on-screen, persist:anthracite) starts at about:blank — distinct from this marker.
    view.webContents.loadURL('about:blank?browserview=1')

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

    // Shadow View Disconnect: Delegate navigation to Renderer
    if (win && !win.isDestroyed()) {
        win.webContents.send('navigate-to-url', { tabId, url: normalizedUrl })
    }

    // Optimistically update state
    tab.url = normalizedUrl
    sendTabUpdate(tab)
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

import { AdBlockService } from './services/AdBlockService'

let adBlockService: AdBlockService | null = null;

function initAdBlocker(): void {
    adBlockService = new AdBlockService();
}

function toggleAdBlocker(enabled: boolean): void {
    adBlockEnabled = enabled
    if (adBlockService) {
        adBlockService.toggle(enabled)
    }
}

function toggleHttpsUpgrade(enabled: boolean): void {
    httpsUpgradeEnabled = enabled
    // AdBlockService doesn't support HTTPS upgrade yet
}

// ============================================
// IPC Handlers

function setupIPC(): void {
    // Tab management
    ipcMain.handle('create-tab', (_, url?: string, options?: { realmId?: string; dockId?: string }) => {
        // Use createTab's default (anthracite://newtab) when no URL provided
        const tab = url ? createTab(url, options) : createTab(undefined, options)
        switchToTab(tab.id)
        return { id: tab.id, realmId: getTabOrganization(tab.id)?.realmId }
    })

    // AdBlock Preload Debugging


    // Agent tab: create a tab and return CDP connection info including target ID
    ipcMain.handle('get-active-webview-target', async () => {
        // Query the CDP endpoint and filter to real page targets.
        // BrowserViews load about:blank?browserview=1 — exclude those.
        // The React renderer loads localhost:5173 (dev) or file:// (prod) — exclude those.
        // Anything left is a webview showing a real page.
        try {
            const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`)
            const targets = await res.json() as Array<{ id: string; type: string; url: string }>

            // <webview> elements in Electron appear as type "webview" in CDP /json
            // BrowserViews appear as type "page" — exclude those
            const realTargets = targets.filter(t =>
                t.type === 'webview' &&
                !t.url.startsWith('about:') &&
                !t.url.startsWith('devtools://') &&
                !t.url.startsWith('chrome://') &&
                !t.url.startsWith('anthracite://') &&
                !t.url.includes('localhost:') &&
                !t.url.includes('127.0.0.1:') &&
                !t.url.startsWith('file://')
            )

            if (realTargets.length === 0) {
                console.log('[Agent] No real page targets found — user may be on new tab page')
                return null
            }

            // Prefer the target matching the active tab's URL
            const activeTab = activeTabId ? tabs.get(activeTabId) : null
            const match = (activeTab
                ? realTargets.find(t => t.url === activeTab.url)
                : null) ?? realTargets[realTargets.length - 1]

            console.log('[Agent] Active webview target:', match.id, match.url)
            return { targetId: match.id, cdpUrl: `http://127.0.0.1:${CDP_PORT}` }
        } catch (err) {
            console.error('[Agent] get-active-webview-target failed:', err)
            return null
        }
    })

    ipcMain.handle('create-agent-tab', async () => {
        // Snapshot existing targets before creating the tab
        let existingTargetIds = new Set<string>()
        try {
            const beforeRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json`)
            const before = await beforeRes.json() as Array<{ id: string }>
            existingTargetIds = new Set(before.map((t: any) => t.id))
        } catch { /* ignore */ }

        const tab = createTab('anthracite://newtab')
        switchToTab(tab.id)

        // Bootstrap the webview: override tab URL to a data URI so the renderer
        // mounts the WebviewController (which only renders for non-anthracite:// URLs).
        // The agent will navigate away to its actual target on the first step.
        tab.url = 'data:text/html,'
            ; (tab as any)._isInternalPage = false
        sendTabsUpdate()

        // Find the new CDP target by diffing before/after.
        // Webviews appear as type "webview" in CDP /json; BrowserViews as type "page".
        const findWebviewTarget = (targets: Array<{ id: string; type: string; url: string }>) => {
            const newTargets = targets.filter(t => !existingTargetIds.has(t.id))
            console.log('[Agent] All new targets after tab creation:', newTargets.map(t => `${t.type}:${t.url}`).join(' | '))
            // <webview> elements appear as type "webview" in CDP /json
            // BrowserViews appear as type "page" — look for webview type only
            const eligible = newTargets.filter(t =>
                t.type === 'webview' &&
                !t.url.includes('127.0.0.1:') &&
                !t.url.includes('localhost:') &&
                !t.url.startsWith('file://')
            )
            // Return the first webview (most recently created = the new agent tab's webview)
            return eligible[0]
        }

        try {
            // Poll for the new webview CDP target (webview process startup takes variable time)
            let newTarget: { id: string; type: string; url: string } | undefined
            const delays = [400, 600, 1000]  // cumulative: 400ms, 1s, 2s
            for (const delay of delays) {
                await new Promise(r => setTimeout(r, delay))
                const after = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json() as Array<{ id: string; type: string; url: string }>
                newTarget = findWebviewTarget(after)
                if (newTarget) break
            }

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
        }
    })



    // Renderer Logging
    ipcMain.on('renderer-log', (event, message) => {
        console.log(message)
    })

    const historyDebounceTimers = new Map<string, NodeJS.Timeout>()

    ipcMain.handle('update-tab-state', (event, { tabId, state }) => {
        try {
            const tab = tabs.get(tabId)
            if (!tab) return

            // Update local state
            if (state.url) tab.url = state.url
            if (state.title) tab.title = state.title
            if (state.favicon) tab.favicon = state.favicon
            if (state.isLoading !== undefined) tab.isLoading = state.isLoading
            if (state.canGoBack !== undefined) tab.view.webContents.setVisualZoomLevelLimits(1, 1) // Dummy op to access webContents if needed

            // Broadcast to other windows/renderers if needed
            sendTabUpdate(tab)

            // Debounce History Updates (URL/Title/Favicon)
            // Clear existing timer for this tab
            if (historyDebounceTimers.has(tabId)) {
                clearTimeout(historyDebounceTimers.get(tabId)!)
            }

            // Schedule new write
            const timer = setTimeout(() => {
                // historyDebounceTimers.delete(tabId) // Cleanup
                if (tab.url && !tab.url.startsWith('anthracite://') && !tab.url.startsWith('about:')) {
                    console.log(`[History] Writing: ${tab.url}`)
                    if (state.url) {
                        addHistoryEntry(tab.url, tab.title, tab.favicon)
                    } else {
                        updateHistoryEntry(tab.url, tab.title, tab.favicon)
                    }
                }
            }, 800) // 800ms debounce
            historyDebounceTimers.set(tabId, timer)

            return true
        } catch (err) {
            console.error('Failed to update tab state:', err)
            return false
        }
    })

    // Navigation
    ipcMain.handle('navigate', (_, url: string) => {
        if (activeTabId) {
            // Call navigateTab to update state and trigger renderer navigation event
            // (Note: navigateTab has been modified to NOT double-load the background view)
            navigateTab(activeTabId, url)
        }
        return { success: true }
    })

    ipcMain.on('adblock-log', (event, message: string) => {
        console.log(`[AdBlock Preload] ${message}`);
    });

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

    // Ad blocker handlers have been moved to AdBlockService

    ipcMain.handle('reset-blocked-count', () => {
        blockedCount = 0
        httpsUpgradeCount = 0
        return { blockedCount, httpsUpgradeCount }
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
        } else if (key === 'uiScale') {
            applyUiScale(value as string)
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

    ipcMain.handle('create-realm', (_, name: string, icon?: IconName, color?: ThemeColor, template?: any) => {
        const realm = createRealmFromParams(name, icon, color, template)

        if (win && !win.isDestroyed()) {
            win.webContents.send('realm-created', realm)

            // If template was used, docks were created in the store but no events were emitted.
            // We need to fetch them and notify the renderer.
            if (template?.docks) {
                const allDocks = getDocks()
                const newDocks = allDocks.filter(d => d.realmId === realm.id)
                newDocks.forEach(dock => {
                    win?.webContents.send('dock-created', dock)
                })
            }

            // Auto-select the new realm
            setActiveRealmId(realm.id)
            win.webContents.send('active-realm-changed', { realmId: realm.id })
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

    // App Info
    ipcMain.handle('get-app-version', () => {
        return app.getVersion()
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
        backgroundColor: '#0A0A0B',
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 14 },
        show: false, // Show when ready
    })

    // Show when ready to prevent flash, and apply saved UI scale
    win.once('ready-to-show', () => {
        applyUiScale(settingsStore.get('uiScale'))
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
            label: 'Anthracite',
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
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
    if (app.isPackaged) {
        win.loadFile(path.join(__dirname, '../dist/index.html'))
    } else {
        win.loadURL('http://127.0.0.1:5173')
    }

    // DevTools: don't auto-open — it creates a devtools:// CDP target that
    // hangs browser-use's session initialization. Open manually with Cmd+Option+I.

    // When UI is loaded, create initial tab (only if no tabs exist yet)
    win.webContents.on('did-finish-load', () => {
        // Guard: only create a tab on first load, not on renderer reload
        if (tabs.size === 0) {
            const tab = createTab('anthracite://newtab')
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
            count: adBlockService ? adBlockService.getBlockedCount() : 0
        })
    })

    // Enable ad-blocking on webview tags when they are attached
    // Aggressive Popup Blocking for webviews logic removed to prevent "second handler" crash.
    // Internal pages (persist:anthracite) do not need ad/popup blocking.
}

// ============================================
// Python Backend
// ============================================

function startPythonBackend(): void {
    const isDev = !app.isPackaged
    // console.log('Starting Python Backend...', isDev ? '(Dev)' : '(Prod)')

    // Get API key from settings
    const apiKey = settingsStore.get('openaiApiKey') || process.env.OPENAI_API_KEY || ''

    // Prepare environment variables
    const env = {
        ...process.env,
        OPENAI_API_KEY: apiKey
    }

    if (isDev) {
        // Development: Run from venv
        const pythonPath = path.join(__dirname, '../venv/bin/python3')
        pythonProcess = spawn(pythonPath, [
            '-m', 'uvicorn', 'backend.server:app',
            '--host', '127.0.0.1',
            '--port', '8000',
            '--reload',
            '--log-level', 'error'
        ], {
            cwd: path.join(__dirname, '../'),
            stdio: 'inherit',
            env
        })
    } else {
        // Production: Run bundled executable (PyInstaller)
        // The executable is copied to resources/backend/anthracite-server
        // (nested folder due to --onedir)
        const executableName = process.platform === 'win32' ? 'anthracite-server.exe' : 'anthracite-server'
        // Simplified path: resources/backend/anthracite-server (executable)
        const backendPath = path.join(process.resourcesPath, 'backend', executableName)

        // console.log('Backend executable path:', backendPath)

        pythonProcess = spawn(backendPath, [], {
            // No CWD needed as PyInstaller handles paths internally usually, 
            // but setting it to the exe dir doesn't hurt.
            cwd: path.dirname(backendPath),
            stdio: 'inherit',
            env
        })
    }

    if (pythonProcess) {
        pythonProcess.on('close', (code) => {
            console.log(`Python process exited with code ${code}`)
        })

        pythonProcess.on('error', (err) => {
            console.error('Failed to start Python process:', err)
        })
    }
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
    const webviewSession = session.fromPartition('persist:anthracite')
    webviewSession.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    )

    // Migrate history from JSON to SQLite (one-time)
    migrateFromJson()

    await initAdBlocker()
    startPythonBackend()
    createWindow()
})
