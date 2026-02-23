/**
 * Minimal preload for the Google auth popup.
 *
 * contextIsolation is set to false for this window so this script runs in
 * the page's main world — the only way to suppress navigator.webdriver
 * before Google's scripts read it, without using the debugger API.
 */

try {
    Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
        configurable: true,
    })
} catch (_) {
    // Property may already be defined as non-configurable; try value override
    try {
        Object.defineProperty(navigator, 'webdriver', {
            value: false,
            writable: false,
            configurable: true,
        })
    } catch (_) { /* ignore */ }
}
