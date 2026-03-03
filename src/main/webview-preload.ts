/**
 * Preload script for <webview> tags.
 * Runs in the webview's isolated context.
 * Forwards horizontal wheel events to the host page for swipe navigation.
 */

import { ipcRenderer, webFrame } from 'electron';

// Remove navigator.webdriver so sites like Google don't block login.
// The remote-debugging-port flag sets this to true; we undo it here.
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

// ── YouTube Ad Scrubber (non-blocking, runs in page's main world) ────────
// Patches fetch() to strip ad metadata from YouTube API responses client-side.
// This replaces the old CDP Fetch approach which blocked the response pipeline.
if (window.location.hostname.includes('youtube.com')) {
    webFrame.executeJavaScript(`(function() {
        'use strict';

        // Recursively strip ad-related keys from YouTube API response objects
        function scrubAds(obj) {
            if (!obj || typeof obj !== 'object') return false;
            var changed = false;
            var adKeys = ['adPlacements', 'playerAds', 'adSlots', 'adBreakParams'];
            for (var i = 0; i < adKeys.length; i++) {
                var key = adKeys[i];
                if (obj[key] !== undefined) {
                    if (Array.isArray(obj[key])) { obj[key] = []; changed = true; }
                    else { delete obj[key]; changed = true; }
                }
            }
            var keys = Array.isArray(obj) ? obj : Object.values(obj);
            for (var j = 0; j < keys.length; j++) {
                if (keys[j] && typeof keys[j] === 'object') {
                    if (scrubAds(keys[j])) changed = true;
                }
            }
            return changed;
        }

        // Patch fetch() to intercept YouTube API responses
        var origFetch = window.fetch;
        window.fetch = function() {
            var url = arguments[0];
            if (typeof url === 'string' &&
                (url.includes('/youtubei/v1/player') ||
                 url.includes('/youtubei/v1/next') ||
                 url.includes('/youtubei/v1/get_watch'))) {
                return origFetch.apply(this, arguments).then(function(response) {
                    var clone = response.clone();
                    return clone.text().then(function(body) {
                        try {
                            var data = JSON.parse(body);
                            if (scrubAds(data)) {
                                return new Response(JSON.stringify(data), {
                                    status: response.status,
                                    statusText: response.statusText,
                                    headers: response.headers
                                });
                            }
                        } catch(e) {}
                        return response;
                    });
                });
            }
            return origFetch.apply(this, arguments);
        };

        // Also patch XMLHttpRequest for older YouTube API calls
        var origXHROpen = XMLHttpRequest.prototype.open;
        var origXHRSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url) {
            this._ytAdScrubUrl = (typeof url === 'string' &&
                (url.includes('/youtubei/v1/player') ||
                 url.includes('/youtubei/v1/next') ||
                 url.includes('/youtubei/v1/get_watch')));
            return origXHROpen.apply(this, arguments);
        };

        // Clean ytInitialPlayerResponse and ytInitialData after DOM loads
        function scrubInitialData() {
            try {
                if (window.ytInitialPlayerResponse) scrubAds(window.ytInitialPlayerResponse);
                if (window.ytInitialData) scrubAds(window.ytInitialData);
            } catch(e) {}
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', scrubInitialData);
        } else {
            scrubInitialData();
        }
    })();`);
}



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
