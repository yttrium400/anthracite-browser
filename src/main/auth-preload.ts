/**
 * Minimal preload for the Google auth popup.
 *
 * contextIsolation is false so this script runs in the page's main world —
 * the only reliable way to override navigator properties before Google's
 * scripts read them.
 *
 * Two signals suppressed here:
 *   1. navigator.webdriver — set by --remote-debugging-port; we force it to false.
 *   2. navigator.userAgentData — Electron brands leak "Electron"; we replace with
 *      Chrome brands to match what the HTTP Sec-CH-UA header now sends.
 */

// 1. Suppress navigator.webdriver
try {
    Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
        configurable: true,
    })
} catch (_) {
    try {
        Object.defineProperty(navigator, 'webdriver', {
            value: false,
            writable: false,
            configurable: true,
        })
    } catch (_) { /* ignore */ }
}

// 2. Override navigator.userAgentData so JS-side brand checks match the HTTP headers
const chromeBrands = [
    { brand: 'Not A(Brand', version: '99' },
    { brand: 'Google Chrome', version: '131' },
    { brand: 'Chromium', version: '131' },
]
const chromeBrandsFull = [
    { brand: 'Not A(Brand', version: '99.0.0.0' },
    { brand: 'Google Chrome', version: '131.0.0.0' },
    { brand: 'Chromium', version: '131.0.0.0' },
]
const fakeUAData = {
    brands: chromeBrands,
    mobile: false,
    platform: 'macOS',
    getHighEntropyValues: async (hints: string[]) => {
        const r: Record<string, unknown> = {}
        if (hints.includes('brands')) r.brands = chromeBrands
        if (hints.includes('mobile')) r.mobile = false
        if (hints.includes('platform')) r.platform = 'macOS'
        if (hints.includes('platformVersion')) r.platformVersion = '14.0.0'
        if (hints.includes('architecture')) r.architecture = 'arm'
        if (hints.includes('model')) r.model = ''
        if (hints.includes('bitness')) r.bitness = '64'
        if (hints.includes('uaFullVersion')) r.uaFullVersion = '131.0.0.0'
        if (hints.includes('fullVersionList')) r.fullVersionList = chromeBrandsFull
        return r
    },
    toJSON: () => ({ brands: chromeBrands, mobile: false, platform: 'macOS' }),
}
try {
    Object.defineProperty(navigator, 'userAgentData', {
        get: () => fakeUAData,
        configurable: true,
    })
} catch (_) { /* ignore */ }
