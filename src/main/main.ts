import { app, BrowserWindow, ipcMain, session } from 'electron'
import path from 'node:path'
import { spawn, ChildProcess } from 'node:child_process'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import fetch from 'cross-fetch'

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null
let pythonProcess: ChildProcess | null = null
let blocker: ElectronBlocker | null = null
let blockedCount = 0
let adBlockEnabled = true

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

// Initialize Ad Blocker
async function initAdBlocker() {
    try {
        console.log('Initializing ad blocker...')

        blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
            enableCompression: true,
        })

        // Track blocked requests
        blocker.on('request-blocked', (request) => {
            blockedCount++
            // Send count to renderer
            if (win && !win.isDestroyed()) {
                win.webContents.send('ad-blocked', {
                    count: blockedCount,
                    url: request.url
                })
            }
        })

        blocker.on('request-redirected', () => {
            blockedCount++
            if (win && !win.isDestroyed()) {
                win.webContents.send('ad-blocked', { count: blockedCount })
            }
        })

        // Enable blocker on default session
        if (adBlockEnabled) {
            blocker.enableBlockingInSession(session.defaultSession)
        }

        console.log('Ad blocker initialized successfully')
    } catch (error) {
        console.error('Failed to initialize ad blocker:', error)
    }
}

// Toggle ad blocker on/off
function toggleAdBlocker(enabled: boolean) {
    adBlockEnabled = enabled
    if (blocker) {
        if (enabled) {
            blocker.enableBlockingInSession(session.defaultSession)
            console.log('Ad blocker enabled')
        } else {
            blocker.disableBlockingInSession(session.defaultSession)
            console.log('Ad blocker disabled')
        }
    }
}

function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        vibrancy: undefined,
        visualEffectState: 'active',
        transparent: false,
        backgroundColor: '#FFFFFF',
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 18 },
    })

    // Open DevTools for debugging (remove in production)
    win.webContents.openDevTools()

    win.webContents.on('did-finish-load', () => {
        win?.webContents.send('main-process-message', (new Date).toLocaleString())
        // Send initial ad block state
        win?.webContents.send('ad-block-status', {
            enabled: adBlockEnabled,
            count: blockedCount
        })
    })

    // Force load local dev server
    win.loadURL('http://127.0.0.1:5173')
}

// IPC Handlers
function setupIPC() {
    // Toggle ad blocker
    ipcMain.handle('toggle-ad-block', (_, enabled: boolean) => {
        toggleAdBlocker(enabled)
        return { enabled: adBlockEnabled }
    })

    // Get ad block status
    ipcMain.handle('get-ad-block-status', () => {
        return { enabled: adBlockEnabled, count: blockedCount }
    })

    // Reset blocked count
    ipcMain.handle('reset-blocked-count', () => {
        blockedCount = 0
        return { count: blockedCount }
    })
}

// Spawn Python Backend
function startPythonBackend() {
    const isDev = !app.isPackaged
    const pythonPath = isDev
        ? path.join(__dirname, '../venv/bin/python3')
        : path.join(process.resourcesPath, 'backend/venv/bin/python3')

    const serverPath = path.join(__dirname, '../backend/server.py')

    console.log('Starting Python Backend:', pythonPath, serverPath)

    pythonProcess = spawn(pythonPath, ['-m', 'uvicorn', 'backend.server:app', '--host', '127.0.0.1', '--port', '8000', '--reload'], {
        cwd: path.join(__dirname, '../'),
        stdio: 'inherit'
    })

    pythonProcess.on('close', (code) => {
        console.log(`Python process exited with code ${code}`)
    })

    pythonProcess.on('error', (err) => {
        console.error('Failed to start python process', err)
    })
}

function killPythonBackend() {
    if (pythonProcess) {
        console.log('Killing Python Backend...')
        pythonProcess.kill()
        pythonProcess = null
    }
}

app.on('window-all-closed', () => {
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
