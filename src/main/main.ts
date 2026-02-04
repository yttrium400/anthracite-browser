import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { spawn, ChildProcess } from 'node:child_process'

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null
let pythonProcess: ChildProcess | null = null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

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
        backgroundColor: '#FFFFFF', // Premium light theme
        titleBarStyle: 'hiddenInset', // macOS native title bar with traffic lights
        trafficLightPosition: { x: 16, y: 18 }, // Position traffic lights
    })

    // Open DevTools for debugging
    win.webContents.openDevTools()

    // Test active push message to Renderer-process.
    win.webContents.on('did-finish-load', () => {
        win?.webContents.send('main-process-message', (new Date).toLocaleString())
    })

    // Force load local dev server
    win.loadURL('http://127.0.0.1:5173')

    // Original logic commented out for debug
    // if (VITE_DEV_SERVER_URL) {
    //    win.loadURL(VITE_DEV_SERVER_URL)
    // } else {
    //    win.loadFile(path.join(process.env.DIST || '', 'index.html'))
    // }
}

// Spawn Python Backend
function startPythonBackend() {
    const isDev = !app.isPackaged
    const pythonPath = isDev
        ? path.join(__dirname, '../venv/bin/python3')
        : path.join(process.resourcesPath, 'backend/venv/bin/python3') // Todo: fix for prod

    const serverPath = path.join(__dirname, '../backend/server.py')

    console.log('Starting Python Backend:', pythonPath, serverPath)

    pythonProcess = spawn(pythonPath, ['-m', 'uvicorn', 'backend.server:app', '--host', '127.0.0.1', '--port', '8000', '--reload'], {
        cwd: path.join(__dirname, '../'),
        stdio: 'inherit' // Pipe output to console
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

app.whenReady().then(() => {
    startPythonBackend()
    createWindow()
})
