import { app, BrowserWindow, BrowserView, ipcMain, session } from 'electron'
import path from 'node:path'
import { spawn, ChildProcess } from 'node:child_process'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import fetch from 'cross-fetch'

// ============================================
// Types
// ============================================

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
let adBlockEnabled = true

// Tab management
const tabs: Map<string, Tab> = new Map()
let activeTabId: string | null = null
let tabIdCounter = 0

// UI bounds configuration
const UI_TOP_HEIGHT = 52 // URL bar height
const UI_SIDEBAR_WIDTH = 0 // Sidebar is floating, doesn't take space

// ============================================
// Utility Functions
// ============================================

function generateTabId(): string {
    return `tab-${++tabIdCounter}-${Date.now()}`
}

function getBrowserViewBounds(): Electron.Rectangle {
    if (!win) return { x: 0, y: 0, width: 800, height: 600 }
    const { width, height } = win.getContentBounds()
    return {
        x: UI_SIDEBAR_WIDTH,
        y: UI_TOP_HEIGHT,
        width: width - UI_SIDEBAR_WIDTH,
        height: height - UI_TOP_HEIGHT
    }
}

function normalizeUrl(input: string): string {
    let url = input.trim()

    // Check if it looks like a URL
    const urlPattern = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/
    const localhostPattern = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/
    const internalPattern = /^poseidon:\/\//

    if (urlPattern.test(url) || localhostPattern.test(url) || internalPattern.test(url)) {
        if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('poseidon://')) {
            url = 'https://' + url
        }
        return url
    }

    // Treat as search query
    return `https://www.google.com/search?q=${encodeURIComponent(url)}`
}

// ============================================
// Tab Management
// ============================================

function createTab(url: string = 'poseidon://newtab'): Tab {
    const id = generateTabId()

    const view = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
        }
    })

    // Enable ad-blocker on this view
    if (blocker && adBlockEnabled) {
        blocker.enableBlockingInSession(view.webContents.session)
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

    view.webContents.on('did-navigate', (_, url) => {
        tab.url = url
        sendTabUpdate(tab)
    })

    view.webContents.on('did-navigate-in-page', (_, url) => {
        tab.url = url
        sendTabUpdate(tab)
    })

    view.webContents.on('page-title-updated', (_, title) => {
        tab.title = title || 'Untitled'
        sendTabUpdate(tab)
    })

    view.webContents.on('page-favicon-updated', (_, favicons) => {
        if (favicons.length > 0) {
            tab.favicon = favicons[0]
            sendTabUpdate(tab)
        }
    })

    // Handle new window requests (open in new tab)
    view.webContents.setWindowOpenHandler(({ url }) => {
        createTab(url)
        switchToTab(tabs.get(Array.from(tabs.keys()).pop()!)!.id)
        return { action: 'deny' }
    })

    tabs.set(id, tab)

    // Navigate to URL
    if (url !== 'poseidon://newtab') {
        view.webContents.loadURL(normalizeUrl(url))
    }

    // Send tab created event
    sendTabsUpdate()

    return tab
}

function switchToTab(tabId: string): void {
    const tab = tabs.get(tabId)
    if (!tab || !win) return

    // Remove current view
    if (activeTabId) {
        const currentTab = tabs.get(activeTabId)
        if (currentTab) {
            win.removeBrowserView(currentTab.view)
        }
    }

    // Add new view
    // Add new view ONLY if it's not the internal new tab page
    if (tab.url !== 'poseidon://newtab') {
        win.addBrowserView(tab.view)
        tab.view.setBounds(getBrowserViewBounds())
        tab.view.setAutoResize({ width: true, height: true })
    }

    activeTabId = tabId

    // Send updates
    sendActiveTabUpdate()
    sendTabUpdate(tab)
}

function closeTab(tabId: string): void {
    const tab = tabs.get(tabId)
    if (!tab || !win) return

    // Remove from window if active
    if (activeTabId === tabId) {
        win.removeBrowserView(tab.view)
    }

    // Destroy the view
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

    // If we are navigating FROM internal page TO a web page, we need to attach the view
    if (tab.url === 'poseidon://newtab' && normalizedUrl !== 'poseidon://newtab') {
        if (win && activeTabId === tabId) {
            win.addBrowserView(tab.view)
            tab.view.setBounds(getBrowserViewBounds())
            tab.view.setAutoResize({ width: true, height: true })
        }
    }

    tab.view.webContents.loadURL(normalizedUrl)
}

// ============================================
// IPC Communication
// ============================================

function sendTabUpdate(tab: Tab): void {
    if (!win || win.isDestroyed()) return
    win.webContents.send('tab-updated', {
        id: tab.id,
        title: tab.title,
        url: tab.url,
        favicon: tab.favicon,
        isLoading: tab.isLoading
    })
}

function sendTabsUpdate(): void {
    if (!win || win.isDestroyed()) return
    const tabList = Array.from(tabs.values()).map(tab => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        favicon: tab.favicon,
        isLoading: tab.isLoading
    }))
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

async function initAdBlocker(): Promise<void> {
    try {
        console.log('Initializing ad blocker...')

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

        // Enable on default session
        if (adBlockEnabled) {
            blocker.enableBlockingInSession(session.defaultSession)
        }

        console.log('Ad blocker initialized')
    } catch (error) {
        console.error('Failed to initialize ad blocker:', error)
    }
}

function toggleAdBlocker(enabled: boolean): void {
    adBlockEnabled = enabled
    if (blocker) {
        // Toggle on default session
        if (enabled) {
            blocker.enableBlockingInSession(session.defaultSession)
        } else {
            blocker.disableBlockingInSession(session.defaultSession)
        }

        // Toggle on all tab sessions
        tabs.forEach(tab => {
            if (enabled) {
                blocker!.enableBlockingInSession(tab.view.webContents.session)
            } else {
                blocker!.disableBlockingInSession(tab.view.webContents.session)
            }
        })
    }
}

// ============================================
// IPC Handlers
// ============================================

function setupIPC(): void {
    // Tab management
    ipcMain.handle('create-tab', (_, url?: string) => {
        const tab = createTab(url || 'about:blank')
        switchToTab(tab.id)
        return { id: tab.id }
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
        return Array.from(tabs.values()).map(tab => ({
            id: tab.id,
            title: tab.title,
            url: tab.url,
            favicon: tab.favicon,
            isLoading: tab.isLoading
        }))
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
        return { enabled: adBlockEnabled, count: blockedCount }
    })

    ipcMain.handle('reset-blocked-count', () => {
        blockedCount = 0
        return { count: blockedCount }
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

    // Handle resize to update BrowserView bounds
    win.on('resize', () => {
        if (activeTabId) {
            const tab = tabs.get(activeTabId)
            if (tab) {
                tab.view.setBounds(getBrowserViewBounds())
            }
        }
    })

    // Load the UI
    win.loadURL('http://127.0.0.1:5173')

    // Open DevTools in development
    if (!app.isPackaged) {
        win.webContents.openDevTools({ mode: 'detach' })
    }

    // When UI is loaded, create initial tab
    win.webContents.on('did-finish-load', () => {
        // Create initial tab
        const tab = createTab('poseidon://newtab')
        switchToTab(tab.id)

        // Send initial ad block status
        win?.webContents.send('ad-block-status', {
            enabled: adBlockEnabled,
            count: blockedCount
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
        '--reload'
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
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

app.whenReady().then(async () => {
    setupIPC()
    await initAdBlocker()
    startPythonBackend()
    createWindow()
})
