import { app, session, ipcMain, WebContents, webContents } from 'electron';
import { Engine, FilterSet } from 'adblock-rs';
import fs from 'fs';
import path from 'path';
import fetch from 'cross-fetch';

const FILTER_LISTS = [
    'https://easylist.to/easylist/easylist.txt',
    'https://easylist.to/easylist/easyprivacy.txt',
    'https://ublockorigin.pages.dev/thirdparties/easylist-cookie.txt',
    'https://ublockorigin.pages.dev/thirdparties/ublock-filters.txt',
    'https://ublockorigin.pages.dev/thirdparties/ublock-badware.txt',
    'https://ublockorigin.pages.dev/thirdparties/ublock-privacy.txt',
    'https://ublockorigin.pages.dev/thirdparties/ublock-quick-fixes.txt',
    'https://ublockorigin.pages.dev/thirdparties/ublock-unbreak.txt',
    'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
    'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters-2024.txt',
];

const CACHE_PATH = path.join(app.getPath('userData'), 'adblock-engine-rs.bin');

export class AdBlockService {
    private engine: Engine | null = null;
    private isEnabled = true;
    private blockedCount = 0;

    constructor() {
        this.setupIPC();
        this.init();
    }

    private async init() {
        try {
            // Try loading from cache
            if (fs.existsSync(CACHE_PATH)) {
                const buffer = fs.readFileSync(CACHE_PATH);
                try {
                    this.engine = Engine.deserialize(buffer);
                } catch (e) {
                    console.error('[AdBlock] Cache corrupted, rebuilding...');
                }
            }

            if (!this.engine) {
                const filterSet = new FilterSet(true);

                // Fetch all lists in parallel
                const listContents = await Promise.all(
                    FILTER_LISTS.map(async (url) => {
                        try {
                            const res = await fetch(url);
                            return await res.text();
                        } catch (e) {
                            console.error(`[AdBlock] Failed to fetch ${url}`, e);
                            return '';
                        }
                    })
                );

                listContents.forEach(content => {
                    if (content) filterSet.addFilters(content.split('\n'));
                });

                this.engine = new Engine(filterSet, true);

                // Serialize and cache (serialize returns an ArrayBuffer, convert to Buffer)
                const serialized = this.engine.serialize();
                fs.writeFileSync(CACHE_PATH, Buffer.from(serialized));
            }

            this.setupInterceptors();

        } catch (error) {
            console.error('[AdBlock] Initialization failed:', error);
        }
    }

    private setupInterceptors() {
        const attachToSession = (ses: Electron.Session) => {
            // Network Blocking
            ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
                if (!this.isEnabled || !this.engine || details.url.startsWith('file:') || details.url.startsWith('anthracite:') || details.url.includes('localhost')) {
                    return callback({ cancel: false });
                }

                // check(url, sourceUrl, resourceType, debug)
                // Map Electron resource type to adblock-rs
                // adblock-rs expects resource types like 'script', 'image', 'stylesheet', 'sub_frame', 'main_frame'
                let rType = details.resourceType as string;
                if (rType === 'mainFrame') rType = 'main_frame';
                else if (rType === 'subFrame') rType = 'sub_frame';
                else if (rType === 'xhr' || rType === 'fetch') rType = 'xmlhttprequest';
                else if (rType === 'webSocket') rType = 'websocket';

                // adblock-rs cannot parse hostnames from non-HTTP source URLs
                // (data:, about:, blob:) and throws an uncaught exception.
                // Skip the check entirely for requests originating from those contexts.
                const sourceUrl = details.webContents?.getURL() || '';
                if (sourceUrl && !sourceUrl.startsWith('http')) {
                    return callback({ cancel: false });
                }

                let isMatched = false;
                try {
                    isMatched = this.engine!.check(
                        details.url,
                        sourceUrl,
                        rType,
                        false // debug
                    );
                } catch {
                    // Hostname parse failure — let the request through
                    return callback({ cancel: false });
                }

                if (isMatched) {
                    this.blockedCount++;
                    if (details.webContents) {
                        details.webContents.send('ad-blocked', { count: this.blockedCount });
                    }
                    return callback({ cancel: true });
                }

                callback({ cancel: false });
            });
        };

        attachToSession(session.defaultSession);
        attachToSession(session.fromPartition('persist:anthracite'));
    }

    private setupIPC() {
        // Return cosmetic rules for a specific URL related to the webview
        ipcMain.handle('get-cosmetic-rules', (event, url: string, classes: string[] = [], ids: string[] = []) => {
            return this.getCosmeticRules(url, classes, ids);
        });

        // Synchronous handler for scriptlet injection
        ipcMain.on('get-cosmetic-rules-sync', (event, url: string) => {
            const rules = this.getCosmeticRules(url);
            event.returnValue = rules.scripts || '';
        });

        ipcMain.handle('get-ad-block-status', () => {
            return { enabled: this.isEnabled, blockedCount: this.blockedCount, httpsUpgradeCount: 0 };
        });

        ipcMain.handle('toggle-ad-block', (event, enabled: boolean) => {
            this.toggle(enabled);
            return { enabled: this.isEnabled };
        });
    }

    // Public API for cosmetic filtering (called from preload via IPC)
    public getCosmeticRules(url: string, classes: string[] = [], ids: string[] = []) {
        if (!this.isEnabled || !this.engine) return { styles: '', scripts: '' };

        try {
            const resources = this.engine.urlCosmeticResources(url);

            // Convert resources to CSS string
            let css = '';

            // hiddenClassIdSelectors returns simple selectors like #ad, .banner
            // Passing the collected classes and IDs from the DOM
            try {
                const simpleSelectors = this.engine.hiddenClassIdSelectors(classes, ids, []);
                if (simpleSelectors && simpleSelectors.length > 0) {
                    css += `${simpleSelectors.join(', ')} { display: none!important; } \n`;
                }
            } catch (e) {
                console.error('[AdBlockService] Error getting hiddenClassIdSelectors:', e);
            }

            // urlCosmeticResources might return more complex rules
            if (resources && resources.hide_selectors) {
                css += `${resources.hide_selectors.join(', ')} { display: none!important; } \n`;
            }

            if (resources && resources.style_selectors) {
                css += `${resources.style_selectors.join(', ')} { display: none!important; } \n`;
            }

            if (resources.injected_script) {
            }
            return { styles: css, scripts: resources.injected_script || '' };
        } catch (e) {
            console.error('[AdBlockService] Error getting cosmetic rules:', e);
            return { styles: '', scripts: '' };
        }
    }

    public getBlockedCount(): number {
        return this.blockedCount;
    }

    public toggle(enabled: boolean) {
        this.isEnabled = enabled;
    }
}
