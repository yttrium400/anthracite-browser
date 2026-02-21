import { app, session, ipcMain, WebContents, webContents } from 'electron';
import { Engine, FilterSet } from 'adblock-rs';
import fs from 'fs';
import path from 'path';
import fetch from 'cross-fetch';
// @ts-ignore
import CDP from 'chrome-remote-interface';

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
    // Use string IDs for CDP targets since they are GUIDs, not numbers
    private attachedCDPTargets = new Set<string>();

    constructor() {
        this.setupIPC();
        this.init();

        // Polling raw Chromium JSON endpoints via websockets ensures we discover all dynamic targets
        // including Service Workers and nested IFrames.
        setInterval(async () => {
            if (!this.isEnabled) return;
            try {
                const res = await fetch('http://127.0.0.1:9222/json');
                const targets = (await res.json()) as any[];

                for (const target of targets) {
                    if (target.type !== 'browser' && !target.url?.startsWith('devtools://') && !this.attachedCDPTargets.has(target.id)) {
                        console.log(`[AdBlock] Discovered unattached target: ${target.type} (ID: ${target.id.substring(0, 8)}) - URL: ${target.url || 'none'}`);
                        this.attachCRI(target);
                    }
                }
            } catch (err: any) {
                console.error('[AdBlock] Polling /json error:', err.message);
            }
        }, 1000);
    }

    private async attachCRI(target: any) {
        if (target.url && (target.url.startsWith('devtools://') || target.url.startsWith('chrome-extension://'))) return;
        this.attachedCDPTargets.add(target.id);

        try {
            const client = await CDP({ target: target.webSocketDebuggerUrl || target });
            console.log(`[AdBlock] Auto-attached RAW WebSocket CDP to ${target.type} (ID: ${target.id.substring(0, 8)}...)`);

            client.on('disconnect', () => {
                this.attachedCDPTargets.delete(target.id);
                console.log(`[AdBlock] RAW CDP detached from ${target.type} (ID: ${target.id.substring(0, 8)}...)`);
            });

            client.Fetch.requestPaused(async (params: any) => {
                const { requestId, request, responseStatusCode } = params;
                const responseHeaders = params.responseHeaders ? params.responseHeaders.map((h: any) => ({ name: h.name, value: String(h.value) })) : [];
                const encodingHeader = responseHeaders.find((h: any) => h.name.toLowerCase() === 'content-encoding');
                const contentTypeHeader = responseHeaders.find((h: any) => h.name.toLowerCase() === 'content-type');

                // 1) Handle Embedded HTML Ad Payloads (ytInitialPlayerResponse)
                if ((request.url.includes('youtube.com/watch') || request.url.includes('youtube.com/')) && params.resourceType === 'Document') {
                    console.log(`[AdBlock CDP] Caught HTML Document: ${request.url}`);
                    try {
                        const response = await client.Fetch.getResponseBody({ requestId });
                        let body = response.base64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : response.body;

                        console.log(`[AdBlock CDP] HTML Document Enc: ${encodingHeader?.value || 'none'}, base64: ${response.base64Encoded}, Preview: ${body.substring(0, 50).replace(/\n/g, ' ')}`);

                        // Force YouTube to abandon the embedded payload and fetch it via API
                        const scrubbedBody = body.replace(/ytInitialPlayerResponse\s*=\s*\{.*?\};/s, 'ytInitialPlayerResponse = null;');

                        if (scrubbedBody !== body) {
                            console.log(`[AdBlock] CDP: Natively scrubbed HTML embedded ad payload for ${request.url}`);
                            const responseHeaders = params.responseHeaders ? params.responseHeaders.map((h: any) => ({ name: h.name, value: String(h.value) })) : [];
                            await client.Fetch.fulfillRequest({
                                requestId,
                                responseCode: responseStatusCode || 200,
                                responseHeaders,
                                body: Buffer.from(scrubbedBody).toString('base64')
                            });
                            return;
                        }
                    } catch (e) {
                        console.error('[AdBlock] HTML Scrubbing Error:', e);
                    }
                }

                // 2) Handle JSON API Ad Payloads
                if (request.url.includes('/youtubei/v1/player') || request.url.includes('/youtubei/v1/next') || request.url.includes('/youtubei/v1/get_watch')) {
                    console.log(`[AdBlock Tracker] Caught API Payload: ${request.url.split('?')[0]}`);
                    console.log(`[AdBlock Tracker] Encoding: ${encodingHeader?.value || 'none'}, Content-Type: ${contentTypeHeader?.value || 'none'}`);
                    try {
                        const response = await client.Fetch.getResponseBody({ requestId });
                        let body = response.base64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : response.body;

                        console.log(`[AdBlock Tracker] Body Preview: ${body.substring(0, 100).replace(/\n/g, ' ')}`);

                        let modified = false;

                        // Deep search and destroy array payloads commonly used for ads
                        try {
                            const parsed = JSON.parse(body);

                            // A generic traverser to destroy ad placements reliably
                            const scrubAds = (obj: any): boolean => {
                                let changed = false;
                                if (!obj || typeof obj !== 'object') return false;

                                const adKeywords = ['adPlacements', 'playerAds', 'adSlots'];
                                for (const key of adKeywords) {
                                    if (obj[key] !== undefined) {
                                        obj[key] = []; // Nullify the array
                                        changed = true;
                                        console.log(`[AdBlock Tracker] Annihilated targeted ad array: ${key}`);
                                    }
                                }

                                for (const key in obj) {
                                    if (obj[key] && typeof obj[key] === 'object') {
                                        if (scrubAds(obj[key])) changed = true;
                                    }
                                }
                                return changed;
                            };

                            if (scrubAds(parsed)) {
                                body = JSON.stringify(parsed);
                                modified = true;
                            } else {
                                console.log('[AdBlock Tracker] No ad arrays found in JSON.');
                            }
                        } catch (e: any) {
                            console.log('[AdBlock Tracker] JSON Parse Error (likely compressed binary):', e.message);
                            // Fallback Regex for broken JSON responses
                            const original = body;
                            body = body.replace(/"adPlacements"\s*:\s*\[[^\]]*\]/g, '"adPlacements":[]')
                                .replace(/"adSlots"\s*:\s*\[[^\]]*\]/g, '"adSlots":[]')
                                .replace(/"playerAds"\s*:\s*\[[^\]]*\]/g, '"playerAds":[]');
                            if (original !== body) modified = true;
                        }

                        if (modified) {
                            console.log(`[AdBlock Tracker] Successfully delivered scrubbed API response for ${request.url.split('?')[0]}`);
                            await client.Fetch.fulfillRequest({
                                requestId,
                                responseCode: responseStatusCode || 200,
                                responseHeaders,
                                body: Buffer.from(body).toString('base64')
                            });
                            return;
                        } else {
                            console.log(`[AdBlock Tracker] API payload left unmodified.`);
                        }
                    } catch (e) {
                        console.error('[AdBlock Tracker] API Scrubbing Error:', e);
                    }
                }

                // Let uninteresting requests continue normally
                try {
                    await client.Fetch.continueRequest({ requestId });
                } catch (e) { }
            });

            // Pause ONLY YouTube HTML documents and specific JSON APIs to achieve zero-latency page loads.
            // If we don't specify patterns, CDP pauses every single image, script, and font globally, causing 5-7s delays.
            await client.Fetch.enable({
                patterns: [
                    { urlPattern: '*youtube.com/watch*', requestStage: 'Response', resourceType: 'Document' },
                    { urlPattern: '*youtube.com/', requestStage: 'Response', resourceType: 'Document' }, // Homepage
                    { urlPattern: '*youtubei/v1/player*', requestStage: 'Response' },
                    { urlPattern: '*youtubei/v1/next*', requestStage: 'Response' },
                    { urlPattern: '*youtubei/v1/get_watch*', requestStage: 'Response' }
                ]
            });
            console.log(`[AdBlock] Fetch.enable SUCCESS for target ${target.id.substring(0, 8)}... (${target.url || 'unknown'})`);
        } catch (err) {
            // Failed to attach, remove from set so we can retry next tick
            this.attachedCDPTargets.delete(target.id);
            console.error(`[AdBlock] Failed to attach RAW WebSocket CDP to ${target.type} ${target.id.substring(0, 8)} (will retry):`, err);
        }
    }

    private async init() {
        try {
            // Try loading from cache
            if (fs.existsSync(CACHE_PATH)) {
                console.log('[AdBlock] Loading engine from cache...');
                const buffer = fs.readFileSync(CACHE_PATH);
                try {
                    this.engine = Engine.deserialize(buffer);
                } catch (e) {
                    console.error('[AdBlock] Cache corrupted, rebuilding...');
                }
            }

            if (!this.engine) {
                console.log('[AdBlock] Building engine from filter lists...');
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

            console.log('[AdBlock] Engine ready! Network Domain Intercept Active.');
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

                const isMatched = this.engine!.check(
                    details.url,
                    details.webContents?.getURL() || '',
                    rType,
                    false // debug
                );

                if (isMatched) {
                    this.blockedCount++;
                    console.log(`[AdBlock] Blocked (${rType}): ${details.url}`);
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
                    css += `${simpleSelectors.join(', ')} { display: none !important; } \n`;
                }
            } catch (e) {
                console.error('[AdBlockService] Error getting hiddenClassIdSelectors:', e);
            }

            // urlCosmeticResources might return more complex rules
            if (resources && resources.hide_selectors) {
                css += `${resources.hide_selectors.join(', ')} { display: none !important; } \n`;
            }

            if (resources && resources.style_selectors) {
                css += `${resources.style_selectors.join(', ')} { display: none !important; } \n`;
            }

            if (resources.injected_script) {
                if (url.includes('youtube.com')) {
                    console.log(`[AdBlockService] Injecting scriptlet payload to YouTube: ${resources.injected_script.substring(0, 500)}...`);
                }
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
