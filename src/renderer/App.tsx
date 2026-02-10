import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { HomePage } from './components/HomePage';
import { SettingsPage } from './components/SettingsPage';
import { RealmSearch } from './components/RealmSearch';
import { SwipeNavigator, type SwipeNavigatorHandle } from './components/SwipeNavigator';
import { cn } from './lib/utils';

interface Tab {
    id: string;
    url: string;
    title: string;
    favicon: string;
    isLoading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
}

// Webview wrapper to handle event listeners and refs properly
interface WebviewControllerProps {
    tab: Tab;
    isActive: boolean;
    lastWebUrl?: string; // Last web URL for preserving history when on internal page
    onUpdate: (tabId: string, data: Partial<Tab>) => void;
    onMount: (tabId: string, element: Electron.WebviewTag) => void;
    onSwipeWheel: (deltaX: number) => void;
    preloadPath: string;
    webviewPreloadPath: string;
}

const WebviewController = React.memo(({ tab, isActive, lastWebUrl, onUpdate, onMount, onSwipeWheel, preloadPath, webviewPreloadPath }: WebviewControllerProps) => {
    const webviewRef = useRef<Electron.WebviewTag | null>(null);

    useEffect(() => {
        const element = webviewRef.current;
        if (!element) return;

        // Notify parent of mount
        onMount(tab.id, element);

        const checkNavigationState = () => {
            if (element) {
                onUpdate(tab.id, {
                    canGoBack: element.canGoBack(),
                    canGoForward: element.canGoForward()
                });
            }
        };

        const handleNavigate = (e: any) => {
            onUpdate(tab.id, { url: e.url });
            checkNavigationState();
        };
        const handleNavigateInPage = (e: any) => {
            onUpdate(tab.id, { url: e.url });
            checkNavigationState();
        };
        const handleTitleUpdated = (e: any) => onUpdate(tab.id, { title: e.title });
        const handleFaviconUpdated = (e: any) => {
            if (e.favicons && e.favicons.length > 0) {
                onUpdate(tab.id, { favicon: e.favicons[0] });
            }
        };
        const handleStartLoading = () => onUpdate(tab.id, { isLoading: true });
        const handleStopLoading = () => {
            onUpdate(tab.id, { isLoading: false });
            checkNavigationState();
        };

        // Handle IPC messages from webview preload (swipe wheel events)
        const handleIpcMessage = (e: any) => {
            if (!isActive) return;
            if (e.channel === 'swipe-wheel') {
                const { deltaX } = e.args[0];
                onSwipeWheel(deltaX);
            }
        };

        // Add listeners
        element.addEventListener('did-navigate', handleNavigate);
        element.addEventListener('did-navigate-in-page', handleNavigateInPage);
        element.addEventListener('page-title-updated', handleTitleUpdated);
        element.addEventListener('page-favicon-updated', handleFaviconUpdated);
        element.addEventListener('did-start-loading', handleStartLoading);
        element.addEventListener('did-stop-loading', handleStopLoading);
        element.addEventListener('ipc-message', handleIpcMessage);

        // cleanup
        return () => {
            element.removeEventListener('did-navigate', handleNavigate);
            element.removeEventListener('did-navigate-in-page', handleNavigateInPage);
            element.removeEventListener('page-title-updated', handleTitleUpdated);
            element.removeEventListener('page-favicon-updated', handleFaviconUpdated);
            element.removeEventListener('did-start-loading', handleStartLoading);
            element.removeEventListener('did-stop-loading', handleStopLoading);
            element.removeEventListener('ipc-message', handleIpcMessage);
        };
    }, [tab.id, isActive, onUpdate, onMount, onSwipeWheel]);

    // Determine the URL for the webview.
    // If on an internal page but we have a lastWebUrl, keep using that to preserve history.
    // Otherwise, use about:blank for internal pages.
    const isInternalUrl = tab.url.startsWith('poseidon://');
    const webviewSrc = isInternalUrl
        ? (lastWebUrl || 'about:blank') // Preserve last web URL for history, fallback to about:blank
        : tab.url;

    return (
        <div
            className={cn(
                "absolute inset-0 bg-white",
                isActive ? "z-10" : "z-0 pointer-events-none opacity-0"
            )}
        >
            <webview
                ref={webviewRef}
                src={webviewSrc}
                className="h-full w-full"
                webpreferences="contextIsolation=yes, nodeIntegration=no"
                partition="persist:poseidon"
                preload={webviewPreloadPath}
                // @ts-ignore
                allowpopups="true"
            />
        </div>
    );
});

function App() {
    const [isSidebarPinned, setIsSidebarPinned] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('sidebar-pinned') === 'true';
        }
        return false;
    });
    const [isReady, setIsReady] = useState(false);
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    const [preloadPath, setPreloadPath] = useState<string>('');
    const [webviewPreloadPath, setWebviewPreloadPath] = useState<string>('');
    const [showRealmSearch, setShowRealmSearch] = useState(false);

    // Swipe gesture state
    const swipeAccumulated = useRef(0);
    const swipeActive = useRef(false);
    const webviewRefs = useRef<Map<string, Electron.WebviewTag>>(new Map());
    const pendingNavigation = useRef<{ tabId: string; url: string } | null>(null);
    // Track tabs that have loaded web content (to preserve webview even when showing home page)
    const [tabsWithWebview, setTabsWithWebview] = useState<Set<string>>(new Set());
    // Track last web URL for each tab (to preserve webview src when on internal page)
    const [lastWebUrls, setLastWebUrls] = useState<Map<string, string>>(new Map());

    // Persist sidebar pinned state
    useEffect(() => {
        localStorage.setItem('sidebar-pinned', isSidebarPinned.toString());
    }, [isSidebarPinned]);

    // Theme handling
    useEffect(() => {
        const applyTheme = (theme: 'light' | 'dark' | 'system') => {
            const root = window.document.documentElement;
            root.classList.remove('light', 'dark');

            if (theme === 'system') {
                const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
                    ? 'dark'
                    : 'light';
                root.classList.add(systemTheme);
            } else {
                root.classList.add(theme);
            }
        };

        // Initial theme load
        window.electron?.settings.getAll().then((settings: any) => {
            if (settings?.theme) {
                applyTheme(settings.theme);
            }
        });

        // Listen for settings changes
        const unsubscribeSettings = window.electron?.settings.onChanged((data: any) => {
            if (data.settings?.theme) {
                applyTheme(data.settings.theme);
            }
        });

        // Listen for system theme changes
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleSystemChange = () => {
            window.electron?.settings.get('theme').then((currentTheme: any) => {
                if (currentTheme === 'system') {
                    applyTheme('system');
                }
            });
        };
        mediaQuery.addEventListener('change', handleSystemChange);

        return () => {
            unsubscribeSettings?.();
            mediaQuery.removeEventListener('change', handleSystemChange);
        };
    }, []);

    const activeTab = tabs.find(t => t.id === activeTabId);
    const isHomePage = activeTab?.url === 'poseidon://newtab';
    const isSettingsPage = activeTab?.url === 'poseidon://settings';
    const isInternalPage = activeTab?.url?.startsWith('poseidon://');

    // ... existing keyboard shortcut ...
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setShowRealmSearch(prev => !prev);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    useEffect(() => {
        if (typeof window !== 'undefined' && window.electron) {
            setIsReady(true);

            // Fetch preload paths
            window.electron.adBlock.getPreloadPath().then(path => {
                if (path) {
                    setPreloadPath(`file://${path}`);
                }
            });
            window.electron.getWebviewPreloadPath().then(path => {
                if (path) {
                    setWebviewPreloadPath(`file://${path}`);
                }
            });

            // Get initial tabs
            window.electron.tabs.getAll().then((initialTabs: any[]) => {
                setTabs(initialTabs.map(t => ({
                    ...t,
                    canGoBack: false,
                    canGoForward: false
                })));
            });

            // Get active tab
            window.electron.tabs.getActive().then((tab: any | null) => {
                if (tab) setActiveTabId(tab.id);
            });

            // Listen for tab updates
            const unsubscribeTabs = window.electron.tabs.onTabsUpdated((updatedTabs: any[]) => {
                setTabs(prev => {
                    // Create a map of existing states for O(1) lookup
                    const existingState = new Map(prev.map(t => [t.id, {
                        canGoBack: t.canGoBack,
                        canGoForward: t.canGoForward
                    }]));

                    return updatedTabs.map(t => {
                        const existing = existingState.get(t.id);
                        return {
                            ...t,
                            canGoBack: existing?.canGoBack ?? false,
                            canGoForward: existing?.canGoForward ?? false
                        };
                    });
                });
            });

            const unsubscribeActive = window.electron.tabs.onActiveTabChanged((tab: any | null) => {
                if (tab) setActiveTabId(tab.id);
            });

            const unsubscribeUpdate = window.electron.tabs.onTabUpdated((updatedTab: any) => {
                setTabs(prev => prev.map(t => {
                    if (t.id === updatedTab.id) {
                        return {
                            ...updatedTab,
                            // Preserve local state
                            canGoBack: t.canGoBack,
                            canGoForward: t.canGoForward
                        };
                    }
                    return t;
                }));
            });

            return () => {
                unsubscribeTabs();
                unsubscribeActive();
                unsubscribeUpdate();
            };
        }
    }, []);

    // Callback to update tab state
    const handleTabUpdate = useCallback((tabId: string, data: Partial<Tab>) => {
        // 1. Optimistic update
        setTabs(prev => prev.map(t =>
            t.id === tabId ? { ...t, ...data } : t
        ));
        // 2. Track web content for back/forward navigation
        if (data.url && !data.url.startsWith('poseidon://')) {
            setTabsWithWebview(prev => {
                if (prev.has(tabId)) return prev;
                const next = new Set(prev);
                next.add(tabId);
                return next;
            });
            setLastWebUrls(prev => {
                const next = new Map(prev);
                next.set(tabId, data.url!);
                return next;
            });
        }
        // 3. Sync with main process
        window.electron.tabs.update(tabId, data);
    }, []);

    const handleWebviewMount = useCallback((tabId: string, element: Electron.WebviewTag) => {
        webviewRefs.current.set(tabId, element);
        // If there's a pending navigation for this tab, execute it now
        const pending = pendingNavigation.current;
        if (pending && pending.tabId === tabId) {
            pendingNavigation.current = null;
            element.src = pending.url;
        }
    }, []);

    // Navigate in active webview
    const handleNavigate = useCallback((url: string) => {
        if (!activeTabId) return;
        const webview = webviewRefs.current.get(activeTabId);
        if (webview && !url.startsWith('poseidon://')) {
            webview.src = url;
        }
        // Also notify main process
        window.electron?.navigation.navigate(url);
    }, [activeTabId]);

    // Navigation handlers
    const handleBack = useCallback(() => {
        if (!activeTabId) return;
        const tab = tabs.find(t => t.id === activeTabId);
        const webview = webviewRefs.current.get(activeTabId);

        if (webview && webview.canGoBack()) {
            webview.goBack();
        } else if (tab && !tab.url.startsWith('poseidon://')) {
            // Webview can't go back further — return to home page
            // Update tab URL to home page (webview stays alive but hidden)
            window.electron?.navigation.navigate('poseidon://newtab');
            setTabs(prev => prev.map(t =>
                t.id === activeTabId ? { ...t, url: 'poseidon://newtab', title: 'New Tab', canGoBack: false, canGoForward: true } : t
            ));
        }
    }, [activeTabId, tabs]);

    const handleForward = useCallback(() => {
        if (!activeTabId) return;
        const tab = tabs.find(t => t.id === activeTabId);
        const webview = webviewRefs.current.get(activeTabId);

        if (tab?.url.startsWith('poseidon://') && webview) {
            // On an internal page with a preserved webview — restore the web URL.
            // The webview still has the page loaded (we just overlaid the home page on top).
            // Update tab URL to show the webview again.
            const lastUrl = lastWebUrls.get(activeTabId);
            const webviewUrl = lastUrl || webview.getURL();
            if (webviewUrl && webviewUrl !== 'about:blank') {
                // Update local state immediately (removes internal page overlay)
                setTabs(prev => prev.map(t =>
                    t.id === activeTabId ? { ...t, url: webviewUrl, canGoForward: webview.canGoForward() } : t
                ));
                // Sync with main process
                window.electron?.tabs.update(activeTabId, { url: webviewUrl });
            }
        } else if (webview && webview.canGoForward()) {
            webview.goForward();
        }
    }, [activeTabId, tabs, lastWebUrls]);

    const handleReload = useCallback(() => {
        if (activeTabId) {
            const webview = webviewRefs.current.get(activeTabId);
            if (webview) {
                if (webview.isLoading()) {
                    webview.stop();
                } else {
                    webview.reload();
                }
            }
        }
    }, [activeTabId]);

    // Swipe gesture handlers (called by WebviewController via ipc-message from webview-preload)
    const swipeNavigatorRef = useRef<SwipeNavigatorHandle | null>(null);

    const handleSwipeWheel = useCallback((deltaX: number) => {
        swipeNavigatorRef.current?.onWheel(deltaX);
    }, []);

    // Listen for Cmd+R reload from main process menu
    useEffect(() => {
        if (window.electron?.navigation?.onReloadActiveTab) {
            const unsubscribe = window.electron.navigation.onReloadActiveTab(() => {
                handleReload();
            });
            return unsubscribe;
        }
    }, [handleReload]);

    // Listen for navigate-to-url from main process (triggered by TopBar URL bar)
    useEffect(() => {
        if (window.electron?.navigation?.onNavigateToUrl) {
            const unsubscribe = window.electron.navigation.onNavigateToUrl(({ tabId, url }) => {
                if (url.startsWith('poseidon://')) return;
                // Mark this tab as having web content (keep webview alive)
                setTabsWithWebview(prev => {
                    if (prev.has(tabId)) return prev;
                    const next = new Set(prev);
                    next.add(tabId);
                    return next;
                });
                // Track the last web URL for this tab (for preserving history)
                setLastWebUrls(prev => {
                    const next = new Map(prev);
                    next.set(tabId, url);
                    return next;
                });
                const webview = webviewRefs.current.get(tabId);
                if (webview) {
                    webview.src = url;
                } else {
                    // Webview doesn't exist yet (e.g., transitioning from home page)
                    // Queue navigation for when WebviewController mounts
                    pendingNavigation.current = { tabId, url };
                }
            });
            return unsubscribe;
        }
    }, []);

    return (
        <div className="h-screen w-full bg-surface overflow-hidden font-sans flex flex-col">
            {/* Top Navigation Bar */}
            <TopBar
                isSidebarPinned={isSidebarPinned}
                onBack={handleBack}
                onForward={handleForward}
                onReload={handleReload}
                canGoBack={activeTab?.canGoBack || (!!activeTabId && !isHomePage && tabsWithWebview.has(activeTabId))}
                canGoForward={activeTab?.canGoForward || (isHomePage && !!activeTabId && tabsWithWebview.has(activeTabId))}
                isLoading={activeTab?.isLoading}
            />

            {/* Floating Sidebar - z-index ensures it's above webview */}
            <Sidebar
                isPinned={isSidebarPinned}
                onPinnedChange={setIsSidebarPinned}
                tabs={tabs}
                activeTabId={activeTabId}
            />

            {/* Main Content Area */}
            <main className={cn(
                "flex-1 relative transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                isSidebarPinned && "ml-[300px]" // 280px sidebar + 20px gap
            )}>

                {/* Loading state */}
                {!isReady ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-surface z-10">
                        <div className="flex flex-col items-center gap-4">
                            <div className="loading-spinner w-8 h-8" />
                            <p className="text-sm text-text-tertiary">Loading...</p>
                        </div>
                    </div>
                ) : (
                    /* Webviews and Internal Pages Container */
                    <div className="relative w-full h-full">
                        {/* Internal Pages - z-20 to render above hidden webviews */}
                        {isSettingsPage && <div className="absolute inset-0 z-20"><SettingsPage /></div>}
                        {isHomePage && <div className="absolute inset-0 z-20"><HomePage /></div>}
                        {isInternalPage && !isHomePage && !isSettingsPage && <div className="absolute inset-0 z-20"><HomePage /></div>}

                        {/* Browser Views */}
                        {tabs.map(tab => {
                            // Render WebviewController for tabs with web content,
                            // OR tabs that previously had web content (to preserve history for back/forward)
                            const hasWebContent = !tab.url.startsWith('poseidon://');
                            const hadWebContent = tabsWithWebview.has(tab.id);
                            if (!hasWebContent && !hadWebContent) return null;

                            // isActive: only show webview when it's the active tab AND not on an internal page
                            const isWebviewActive = activeTabId === tab.id && hasWebContent;

                            return (
                                <WebviewController
                                    key={tab.id}
                                    tab={tab}
                                    isActive={isWebviewActive}
                                    lastWebUrl={lastWebUrls.get(tab.id)}
                                    onUpdate={handleTabUpdate}
                                    onMount={handleWebviewMount}
                                    onSwipeWheel={handleSwipeWheel}
                                    preloadPath={preloadPath}
                                    webviewPreloadPath={webviewPreloadPath}
                                />
                            );
                        })}
                    </div>
                )}
            </main>

            {/* Swipe Navigation */}
            <SwipeNavigator
                ref={swipeNavigatorRef}
                onBack={handleBack}
                onForward={handleForward}
                canGoBack={activeTab?.canGoBack || (!!activeTabId && !isHomePage && tabsWithWebview.has(activeTabId))}
                canGoForward={activeTab?.canGoForward || (isHomePage && !!activeTabId && tabsWithWebview.has(activeTabId))}
                isInternalPage={isInternalPage || false}
            />

            {/* Realm Search Modal */}
            <RealmSearch
                isOpen={showRealmSearch}
                onClose={() => setShowRealmSearch(false)}
            />
        </div>
    );
}

export default App;
