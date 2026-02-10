/**
 * Preload script for <webview> tags.
 * Runs in the webview's isolated context with access to ipcRenderer.
 * Forwards horizontal wheel events to the host page for swipe navigation.
 *
 * NOTE: Gesture lifecycle (begin/end) is NOT detected here.
 * macOS scroll-touch-begin/end events on BrowserWindow handle that reliably.
 */
import { ipcRenderer } from 'electron'

let lastSendTime = 0

window.addEventListener('wheel', (e: WheelEvent) => {
    const absX = Math.abs(e.deltaX)
    const absY = Math.abs(e.deltaY)

    // Only forward horizontal-dominant events (trackpad swipes, not vertical scrolls)
    if (absX < 3 || absY > absX * 2) return

    // Throttle to ~60fps to avoid flooding IPC
    const now = Date.now()
    if (now - lastSendTime < 16) return
    lastSendTime = now

    ipcRenderer.sendToHost('swipe-wheel', { deltaX: e.deltaX, deltaY: e.deltaY })
}, { passive: true })
