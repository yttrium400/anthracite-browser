/**
 * Preload script for <webview> tags.
 * Runs in the webview's isolated context.
 * Forwards horizontal wheel events to the host page for swipe navigation.
 */

import { ipcRenderer, webFrame } from 'electron';

// Cosmetic CSS injection handled below. Native scriptlet injection 
// is no longer used here; JSON payloads are now scrubbed natively via CDP Fetch domains.


// CSS Cosmetic Filtering (runs when DOM is ready to parse classes/IDs)
async function injectCosmeticCSS(url: string = window.location.href) {
    try {
        const classSet = new Set<string>();
        const idSet = new Set<string>();
        document.querySelectorAll('[class], [id]').forEach((el) => {
            if (el.id) idSet.add(el.id);
            if (el.classList.length) el.classList.forEach(c => classSet.add(c));
        });

        const { styles } = await ipcRenderer.invoke(
            'get-cosmetic-rules',
            window.location.href,
            Array.from(classSet),
            Array.from(idSet)
        );

        if (styles) {
            const style = document.createElement('style');
            style.textContent = styles;
            (document.head || document.documentElement).appendChild(style);
        }
    } catch (e) {
        // console.error('[AdBlock] Failed to inject cosmetic CSS:', e);
    }
}

// Inject CSS immediately if document is ready, or on DOMContentLoaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => injectCosmeticCSS(window.location.href));
} else {
    injectCosmeticCSS(window.location.href);
}

// Handle SPA navigations (Single Page Applications like YouTube)
ipcRenderer.on('spa-navigate', (_, url: string) => {
    ipcRenderer.send('adblock-log', `SPA Navigation detected to ${url}, re-injecting...`);
    injectCosmeticCSS(url);
});

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
