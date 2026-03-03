/**
 * Preload script for <webview> tags.
 * Runs in the webview's isolated context.
 * Forwards horizontal wheel events to the host page for swipe navigation.
 */

import { ipcRenderer, webFrame } from 'electron';

// Remove navigator.webdriver so sites like Google don't block login.
// The remote-debugging-port flag sets this to true; we undo it here.
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

// ── YouTube Ad Scrubber (non-blocking, injected BEFORE page scripts) ─────
// Injects a <script> element from the preload that runs in the main world
// BEFORE YouTube's own scripts execute. Uses Object.defineProperty to trap
// ytInitialPlayerResponse/ytInitialData assignments, and patches fetch()
// for SPA navigations. This is how Tampermonkey/uBlock scriptlets work.
if (window.location.hostname.includes('youtube.com')) {
    const script = document.createElement('script');
    script.textContent = `(function() {
        'use strict';

        // Recursively strip ad-related keys from YouTube API response objects
        function scrubAds(obj) {
            if (!obj || typeof obj !== 'object') return false;
            var changed = false;
            var adKeys = ['adPlacements', 'playerAds', 'adSlots', 'adBreakParams',
                          'adBreakHeartbeatParams', 'playerLegacyDesktopWatchAdsRenderer'];
            for (var i = 0; i < adKeys.length; i++) {
                if (obj[adKeys[i]] !== undefined) {
                    if (Array.isArray(obj[adKeys[i]])) { obj[adKeys[i]] = []; }
                    else { delete obj[adKeys[i]]; }
                    changed = true;
                }
            }
            if (Array.isArray(obj)) {
                for (var j = 0; j < obj.length; j++) {
                    if (obj[j] && typeof obj[j] === 'object' && scrubAds(obj[j])) changed = true;
                }
            } else {
                var vals = Object.keys(obj);
                for (var k = 0; k < vals.length; k++) {
                    if (obj[vals[k]] && typeof obj[vals[k]] === 'object' && scrubAds(obj[vals[k]])) changed = true;
                }
            }
            return changed;
        }

        // Trap ytInitialPlayerResponse — YouTube sets this via inline <script>;
        // our defineProperty setter fires BEFORE their code continues
        var _ytPlayerResp = undefined;
        try {
            Object.defineProperty(window, 'ytInitialPlayerResponse', {
                configurable: true,
                get: function() { return _ytPlayerResp; },
                set: function(val) { if (val && typeof val === 'object') scrubAds(val); _ytPlayerResp = val; }
            });
        } catch(e) {}

        var _ytInitData = undefined;
        try {
            Object.defineProperty(window, 'ytInitialData', {
                configurable: true,
                get: function() { return _ytInitData; },
                set: function(val) { if (val && typeof val === 'object') scrubAds(val); _ytInitData = val; }
            });
        } catch(e) {}

        // Patch fetch() to intercept YouTube API responses (SPA navigations)
        var origFetch = window.fetch;
        window.fetch = function() {
            var url = (typeof arguments[0] === 'string') ? arguments[0] :
                      (arguments[0] && arguments[0].url) ? arguments[0].url : '';
            if (url.includes('/youtubei/v1/player') ||
                url.includes('/youtubei/v1/next') ||
                url.includes('/youtubei/v1/get_watch')) {
                return origFetch.apply(this, arguments).then(function(response) {
                    return response.clone().text().then(function(body) {
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

        // Patch XMLHttpRequest for any XHR-based API calls
        var origXHROpen = XMLHttpRequest.prototype.open;
        var origXHRSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function() {
            var url = arguments[1];
            this._anthraciteAdScrub = (typeof url === 'string' &&
                (url.includes('/youtubei/v1/player') ||
                 url.includes('/youtubei/v1/next') ||
                 url.includes('/youtubei/v1/get_watch')));
            return origXHROpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function() {
            if (this._anthraciteAdScrub) {
                this.addEventListener('readystatechange', function() {
                    if (this.readyState === 4 && this.status === 200) {
                        try {
                            var data = JSON.parse(this.responseText);
                            if (scrubAds(data)) {
                                Object.defineProperty(this, 'responseText', { value: JSON.stringify(data) });
                                Object.defineProperty(this, 'response', { value: JSON.stringify(data) });
                            }
                        } catch(e) {}
                    }
                });
            }
            return origXHRSend.apply(this, arguments);
        };
    })();`;
    // Inject at the very top of <html> so it runs before any YouTube script
    (document.head || document.documentElement).prepend(script);
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
