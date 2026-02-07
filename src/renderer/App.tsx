import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { HomePage } from './components/HomePage';
import { SettingsPage } from './components/SettingsPage';
import { RealmSearch } from './components/RealmSearch';
import { cn } from './lib/utils';

interface Tab {
    id: string;
    url: string;
    title: string;
    favicon: string;
    isLoading: boolean;
}

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
    const [showRealmSearch, setShowRealmSearch] = useState(false);
    const webviewRefs = useRef<Map<string, Electron.WebviewTag>>(new Map());

    // Persist sidebar pinned state
    useEffect(() => {
        localStorage.setItem('sidebar-pinned', isSidebarPinned.toString());
    }, [isSidebarPinned]);

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

            // Fetch ad blocker preload path
            window.electron.adBlock.getPreloadPath().then(path => {
                if (path) {
                    console.log('Ad blocker preload path:', path);
                    setPreloadPath(`file://${path}`);
                }
            });

            // Get initial tabs
            window.electron.tabs.getAll().then((initialTabs: Tab[]) => {
                setTabs(initialTabs);
            });

            // Get active tab
            window.electron.tabs.getActive().then((tab: Tab | null) => {
                if (tab) setActiveTabId(tab.id);
            });

            // Listen for tab updates
            const unsubscribeTabs = window.electron.tabs.onTabsUpdated((updatedTabs: Tab[]) => {
                setTabs(updatedTabs);
            });

            const unsubscribeActive = window.electron.tabs.onActiveTabChanged((tab: Tab | null) => {
                if (tab) setActiveTabId(tab.id);
            });

            const unsubscribeUpdate = window.electron.tabs.onTabUpdated((updatedTab: Tab) => {
                setTabs(prev => prev.map(t => t.id === updatedTab.id ? updatedTab : t));
            });

            return () => {
                unsubscribeTabs();
                unsubscribeActive();
                unsubscribeUpdate();
            };
        }
    }, []);

    // Get or create webview ref
    const getWebviewRef = useCallback((tabId: string) => {
        return (element: Electron.WebviewTag | null) => {
            if (element) {
                webviewRefs.current.set(tabId, element);

                // Attach event listeners to sync state with main process
                const updateState = (data: Partial<Tab>) => {
                    window.electron.tabs.update(tabId, data);
                };

                // Remove existing listeners if any (to prevent duplicates if ref is called again)
                // Note: In React refs, if the element persists, ref isn't called again. 
                // If it's recreated, it's a new element.
                // We'll rely on the fact that these are new elements or we're overwriting.

                element.addEventListener('did-navigate', (e: any) => {
                    updateState({ url: e.url });
                    console.log('[Webview] did-navigate', e.url);
                });

                element.addEventListener('did-navigate-in-page', (e: any) => {
                    updateState({ url: e.url });
                    console.log('[Webview] did-navigate-in-page', e.url);
                });

                element.addEventListener('page-title-updated', (e: any) => {
                    updateState({ title: e.title });
                });

                element.addEventListener('page-favicon-updated', (e: any) => {
                    if (e.favicons && e.favicons.length > 0) {
                        updateState({ favicon: e.favicons[0] });
                    }
                });

                element.addEventListener('did-start-loading', () => {
                    updateState({ isLoading: true });
                });

                element.addEventListener('did-stop-loading', () => {
                    updateState({ isLoading: false });
                });

            } else {
                webviewRefs.current.delete(tabId);
            }
        };
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

    return (
        <div className="h-screen w-full bg-surface overflow-hidden font-sans flex flex-col">
            {/* Top Navigation Bar */}
            <TopBar isSidebarPinned={isSidebarPinned} />

            {/* Floating Sidebar - z-index ensures it's above webview */}
            <Sidebar isPinned={isSidebarPinned} onPinnedChange={setIsSidebarPinned} />

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
                ) : isSettingsPage ? (
                    /* Settings Page - shown when on poseidon://settings */
                    <SettingsPage />
                ) : isHomePage || isInternalPage ? (
                    /* Home Page - shown when on poseidon://newtab or other internal pages */
                    <HomePage />
                ) : (
                    /* Webview Container - renders web content */
                    <div className="absolute inset-0">
                        {tabs.map(tab => {
                            const isInternal = tab.url.startsWith('poseidon://');
                            if (isInternal) return null;

                            return (
                                <webview
                                    key={tab.id}
                                    ref={getWebviewRef(tab.id)}
                                    src={tab.url}
                                    preload={preloadPath}
                                    partition="persist:poseidon"
                                    className={cn(
                                        "absolute inset-0 w-full h-full",
                                        tab.id !== activeTabId && "hidden"
                                    )}
                                    // @ts-ignore
                                    allowpopups="true"
                                />
                            );
                        })}
                    </div>
                )}
            </main>

            {/* Realm Search Modal */}
            <RealmSearch
                isOpen={showRealmSearch}
                onClose={() => setShowRealmSearch(false)}
            />
        </div>
    );
}

export default App;
