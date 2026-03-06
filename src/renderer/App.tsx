import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from './components/Sidebar';
import { HomePage } from './components/HomePage';
import { SettingsPage } from './components/SettingsPage';
import { RealmSearch } from './components/RealmSearch';
import { SwipeNavigator, type SwipeNavigatorHandle } from './components/SwipeNavigator';
import { AgentPanel, type AgentStatus, type AgentStep } from './components/AgentPanel';
import { CommandPalette } from './components/CommandPalette';
import { NavigationOverlay } from './components/NavigationOverlay';
import OnboardingWizard from './components/OnboardingWizard';
import { useAdaptiveTheme } from './hooks/useAdaptiveTheme';
import { cn } from './lib/utils';

const BACKEND_URL = 'http://127.0.0.1:8000';

// Simple heuristic: is this a URL or search query (not an agent instruction)?
function isSimpleNavigation(input: string): boolean {
    const trimmed = input.trim();
    // Explicit URL
    if (/^https?:\/\//i.test(trimmed)) return true;
    // www. prefix
    if (/^www\./i.test(trimmed)) return true;
    // Looks like a hostname/domain (no spaces, has a dot)
    if (!trimmed.includes(' ') && /\.[a-z]{2,}(\/|$)/i.test(trimmed)) return true;
    return false;
}

interface Tab {
    id: string;
    url: string;
    title: string;
    favicon: string;
    isLoading: boolean;
    isArchived?: boolean;
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
    webviewPreloadPath: string;
}

const WebviewController = React.memo(({ tab, isActive, lastWebUrl, onUpdate, onMount, onSwipeWheel, webviewPreloadPath }: WebviewControllerProps) => {
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

            // Trigger SPA injection in preload script
            if (element) {
                element.send('spa-navigate', e.url);
            }
        };
        const handleTitleUpdated = (e: any) => onUpdate(tab.id, { title: e.title });
        const handleFaviconUpdated = (e: any) => {
            if (e.favicons && e.favicons.length > 0) {
                onUpdate(tab.id, { favicon: e.favicons[0] });
            }
        };

        const handleStartLoading = () => {
            onUpdate(tab.id, { isLoading: true });
        }

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

        // Handle new window requests
        const handleNewWindow = (e: any) => {
            e.preventDefault();
            window.electron?.tabs.create(e.url);
        };

        // Add listeners
        element.addEventListener('did-navigate', handleNavigate);
        element.addEventListener('did-navigate-in-page', handleNavigateInPage);
        element.addEventListener('page-title-updated', handleTitleUpdated);
        element.addEventListener('page-favicon-updated', handleFaviconUpdated);
        element.addEventListener('did-start-loading', handleStartLoading);
        element.addEventListener('did-stop-loading', handleStopLoading);
        element.addEventListener('ipc-message', handleIpcMessage);
        element.addEventListener('new-window', handleNewWindow);

        // cleanup
        return () => {
            element.removeEventListener('did-navigate', handleNavigate);
            element.removeEventListener('did-navigate-in-page', handleNavigateInPage);
            element.removeEventListener('page-title-updated', handleTitleUpdated);
            element.removeEventListener('page-favicon-updated', handleFaviconUpdated);
            element.removeEventListener('did-start-loading', handleStartLoading);
            element.removeEventListener('did-stop-loading', handleStopLoading);
            element.removeEventListener('ipc-message', handleIpcMessage);
            element.removeEventListener('new-window', handleNewWindow);
        };
    }, [tab.id, isActive, onUpdate, onMount, onSwipeWheel]);

    // Determine the initial URL for the webview.
    // If on an internal page but we have a lastWebUrl, keep using that to preserve history.
    // Otherwise, use about:blank for internal pages.
    const isInternalUrl = tab.url.startsWith('anthracite://');
    const initialSrc = useRef(isInternalUrl
        ? (lastWebUrl || 'about:blank') // Preserve last web URL for history, fallback to about:blank
        : tab.url);

    return (
        <div
            className={cn(
                "absolute inset-0 bg-[#0A0A0B]", // Reverted to app background color
                isActive ? "z-10 opacity-100" : "z-0 pointer-events-none opacity-0"
            )}
        >
            <webview
                ref={webviewRef}
                src={initialSrc.current}
                className="h-full w-full"
                webpreferences="contextIsolation=yes, nodeIntegration=no"
                partition="persist:anthracite"
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
    const [webviewPreloadPath, setWebviewPreloadPath] = useState<string>('');
    const [showRealmSearch, setShowRealmSearch] = useState(false);
    const [showCommandPalette, setShowCommandPalette] = useState(false);
    const [adBlockEnabled, setAdBlockEnabled] = useState(true);

    // Navigation overlay state (Arc-style centered URL bar)
    const [showNavigationOverlay, setShowNavigationOverlay] = useState(false);
    const [navigationOverlayMode, setNavigationOverlayMode] = useState<'new-tab' | 'edit-url'>('new-tab');

    // Onboarding wizard
    const [showOnboarding, setShowOnboarding] = useState(false);

    // Agent state
    const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
    const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
    const [agentInstruction, setAgentInstruction] = useState('');
    const [agentResult, setAgentResult] = useState<string | undefined>();
    const [agentAuthService, setAgentAuthService] = useState<string | undefined>();
    const [agentAuthUrl, setAgentAuthUrl] = useState<string | undefined>();
    const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(false);
    const agentAbortRef = useRef<AbortController | null>(null);

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
    const isHomePage = activeTab?.url === 'anthracite://newtab';
    const isSettingsPage = activeTab?.url === 'anthracite://settings';
    const isInternalPage = activeTab?.url?.startsWith('anthracite://');
    // Agent tabs are bootstrapped with 'data:text/html,' until the agent navigates to a real URL.
    // Show the home page overlay during this window so the user doesn't see a black screen.
    const isAgentStartingPage = activeTab?.url === 'data:text/html,';

    // Adaptive brand color — shifts accent to match the active site's palette
    useAdaptiveTheme(activeTab?.url);

    // Custom keybindings — loaded once and kept in a ref so the handler closure
    // always reads the latest value without needing to re-register.
    const keybindingsRef = useRef({ commandPalette: 'k', realmSearch: 'K', sidebar: '\\' });
    useEffect(() => {
        window.electron?.settings.getAll().then((s: any) => {
            if (s) {
                keybindingsRef.current = {
                    commandPalette: s.keybindingCommandPalette ?? 'k',
                    realmSearch: s.keybindingRealmSearch ?? 'K',
                    sidebar: s.keybindingSidebar ?? '\\',
                };
            }
        }).catch(() => { });
        // Re-read on settings changes
        const unsub = window.electron?.settings.onChanged((data: any) => {
            if (data?.settings) {
                keybindingsRef.current = {
                    commandPalette: data.settings.keybindingCommandPalette ?? keybindingsRef.current.commandPalette,
                    realmSearch: data.settings.keybindingRealmSearch ?? keybindingsRef.current.realmSearch,
                    sidebar: data.settings.keybindingSidebar ?? keybindingsRef.current.sidebar,
                };
            }
        });
        return () => unsub?.();
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const { commandPalette, realmSearch } = keybindingsRef.current;
            // Uppercase binding key means Shift is required
            const cpShift = commandPalette !== commandPalette.toLowerCase();
            const rsShift = realmSearch !== realmSearch.toLowerCase();
            if ((e.metaKey || e.ctrlKey) && e.shiftKey === rsShift && e.key === (rsShift ? realmSearch : realmSearch.toLowerCase())) {
                e.preventDefault();
                setShowRealmSearch(prev => !prev);
                return;
            }
            if ((e.metaKey || e.ctrlKey) && e.shiftKey === cpShift && e.key === (cpShift ? commandPalette : commandPalette.toLowerCase())) {
                e.preventDefault();
                setShowCommandPalette(prev => !prev);
                return;
            }
            // Cmd+L — open navigation overlay to edit current URL
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'l') {
                e.preventDefault();
                setNavigationOverlayMode('edit-url');
                setShowNavigationOverlay(true);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    useEffect(() => {
        if (typeof window !== 'undefined' && window.electron) {
            setIsReady(true);

            // Check first-run onboarding
            window.electron.onboarding?.isFirstRun().then((isFirst: boolean) => {
                if (isFirst) setShowOnboarding(true);
            }).catch(() => { });

            // Fetch preload paths
            window.electron.getWebviewPreloadPath().then(path => {
                if (path) {
                    setWebviewPreloadPath(`file://${path}`);
                }
            });

            // Sync adBlock status for command palette
            window.electron.adBlock?.getStatus().then((s: any) => {
                if (s) setAdBlockEnabled(s.enabled);
            });
            window.electron.adBlock?.onStatusChange((s: any) => {
                setAdBlockEnabled(s.enabled);
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

            const previousTabIds = new Set(tabs.map(t => t.id));
            const isInitialLoad = { current: true };

            const unsubscribeActive = window.electron.tabs.onActiveTabChanged((tab: any | null) => {
                if (tab) {
                    setActiveTabId(tab.id);
                    // Auto-open navigation overlay only when a genuinely NEW tab is created (Cmd+T)
                    // Skip initial load and switching between existing tabs
                    if (!isInitialLoad.current && tab.url === 'anthracite://newtab' && !previousTabIds.has(tab.id)) {
                        setNavigationOverlayMode('new-tab');
                        setShowNavigationOverlay(true);
                    }
                    previousTabIds.add(tab.id);
                }
                isInitialLoad.current = false;
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
        if (data.url && !data.url.startsWith('anthracite://')) {
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
        if (webview && !url.startsWith('anthracite://')) {
            webview.src = url;
        }
        // Also notify main process
        window.electron?.navigation.navigate(url);
    }, [activeTabId]);

    // Run an agent task — opens panel, streams SSE from backend
    const handleRunAgent = useCallback(async (instruction: string) => {
        const input = instruction.trim();
        if (!input) return;

        // Debug: log immediately (before any async work)
        console.log('[Agent Debug] handleRunAgent called with:', input);
        window.electron?.log?.(`[Agent Debug] handleRunAgent called with: ${input}`);

        // Fast path: URL or short search query
        if (isSimpleNavigation(input)) {
            console.log('[Agent Debug] isSimpleNavigation=true, navigating directly');
            window.electron?.log?.(`[Agent Debug] isSimpleNavigation=true, navigating directly`);
            window.electron?.navigation.navigate(input);
            return;
        }
        console.log('[Agent Debug] isSimpleNavigation=false, proceeding to agent');
        window.electron?.log?.(`[Agent Debug] isSimpleNavigation=false, proceeding to agent`);

        // Abort any running agent
        agentAbortRef.current?.abort();

        const taskStartedAt = Date.now();

        // Reset agent state
        setAgentInstruction(input);
        setAgentSteps([]);
        setAgentResult(undefined);
        setAgentAuthService(undefined);
        setAgentAuthUrl(undefined);
        setAgentStatus('thinking');
        setIsAgentPanelOpen(true);

        // Get API keys from settings
        let anthropicKey = '';
        let openaiKey = '';
        let googleKey = '';
        let selectedModel = '';
        try {
            const settings = await window.electron?.settings.getAll();
            anthropicKey = settings?.anthropicApiKey || '';
            openaiKey = settings?.openaiApiKey || '';
            googleKey = settings?.googleApiKey || '';
            selectedModel = settings?.selectedModel || '';
            const keyMsg = `[Agent Debug] Keys loaded — anthropic: ${anthropicKey ? `SET (${anthropicKey.length} chars)` : 'EMPTY'} | openai: ${openaiKey ? 'SET' : 'EMPTY'} | google: ${googleKey ? 'SET' : 'EMPTY'} | model: ${selectedModel || 'none'}`;
            console.log(keyMsg);
            window.electron?.log?.(keyMsg);
        } catch (e) {
            console.error('[Agent Debug] Failed to load settings:', e);
            window.electron?.log?.(`[Agent Debug] Failed to load settings: ${e}`);
        }

        // Session health check (Task 5.5): if instruction mentions a service that
        // needs auth, verify the user has an active session in Anthracite's browser.
        // We only warn — never block — so the agent can still attempt the task.
        const AUTH_KEYWORDS: Array<{ patterns: string[]; service: string }> = [
            { patterns: ['gmail', 'my email', 'my inbox', 'google mail'], service: 'Google' },
            { patterns: ['my calendar', 'google calendar', 'gcal'], service: 'Google' },
            { patterns: ['my drive', 'google drive'], service: 'Google' },
            { patterns: ['github', 'my repo', 'my pull request'], service: 'GitHub' },
            { patterns: ['my amazon', 'my orders', 'amazon order'], service: 'Amazon' },
            { patterns: ['linkedin', 'my linkedin'], service: 'LinkedIn' },
            { patterns: ['my microsoft', 'outlook', 'teams'], service: 'Microsoft' },
        ];
        const lowerInput = input.toLowerCase();
        const matchedService = AUTH_KEYWORDS.find(({ patterns }) =>
            patterns.some(p => lowerInput.includes(p))
        );
        if (matchedService) {
            try {
                const accounts = await window.electron?.accounts?.getConnected() || [];
                const hasSession = accounts.some(
                    (a: any) => a.service === matchedService.service && a.isActive
                );
                if (!hasSession) {
                    // Inject a warning step so the user sees it in the panel
                    const warningStep = {
                        step: 0,
                        action: 'session_warning',
                        goal: `No active ${matchedService.service} session detected. The agent may hit a login page — you can sign in when prompted.`,
                    };
                    setAgentSteps([warningStep]);
                }
            } catch { /* non-fatal */ }
        }

        // Create agent tab so the backend has a CDP target to control
        let targetId = '';
        try {
            const agentTab = await window.electron?.agent.createAgentTab();
            targetId = agentTab?.targetId || '';
        } catch (err) {
            console.error('Failed to create agent tab:', err);
            setAgentStatus('error');
            setAgentResult('Could not create browser tab for agent.');
            return;
        }

        const abort = new AbortController();
        agentAbortRef.current = abort;

        // Collect steps locally so we can persist them to SQLite on task end
        const collectedSteps: Array<{ step: number; action: string; goal: string }> = [];

        try {
            // Fetch user memory prompt to personalise the agent run
            const memoryPrompt = await window.electron?.agentMemory?.getPrompt().catch(() => '') || '';

            console.log('[Agent Debug] Fetching /agent/stream with target_id:', targetId);
            window.electron?.log?.(`[Agent Debug] Fetching /agent/stream with target_id: ${targetId}`);
            const response = await fetch(`${BACKEND_URL}/agent/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instruction: input,
                    cdp_url: 'http://127.0.0.1:9222',
                    target_id: targetId,
                    anthropic_api_key: anthropicKey || undefined,
                    api_key: openaiKey || undefined,
                    google_api_key: googleKey || undefined,
                    model: selectedModel || undefined,
                    memory_prompt: memoryPrompt || undefined,
                }),
                signal: abort.signal,
            });
            const resMsg = `[Agent Debug] Response status: ${response.status} ok: ${response.ok} body: ${!!response.body}`;
            console.log(resMsg);
            window.electron?.log?.(resMsg);

            if (!response.ok || !response.body) {
                setAgentStatus('error');
                setAgentResult(`Server error: ${response.status}`);
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const event = JSON.parse(line.slice(6));
                        switch (event.type) {
                            case 'classifying':
                                setAgentStatus('thinking');
                                break;
                            case 'classified':
                                if (event.action !== 'fast_navigate') setAgentStatus('running');
                                break;
                            case 'fast_action':
                                if (event.action === 'navigate' && event.url) {
                                    window.electron?.navigation.navigate(event.url);
                                }
                                break;
                            case 'agent_starting':
                                setAgentStatus('running');
                                break;
                            case 'step': {
                                const newStep = {
                                    step: event.step,
                                    action: event.actions?.[0]?.action || 'action',
                                    goal: event.next_goal || '',
                                };
                                collectedSteps.push(newStep);
                                setAgentSteps(prev => {
                                    if (prev.some(s => s.step === event.step)) return prev;
                                    return [...prev, newStep];
                                });
                                break;
                            }
                            case 'auth_required':
                                setAgentStatus('auth');
                                setAgentAuthService(event.service);
                                setAgentAuthUrl(event.url);
                                break;
                            case 'captcha_required':
                                setAgentStatus('auth');
                                setAgentAuthService('CAPTCHA');
                                setAgentAuthUrl(event.url);
                                break;
                            case 'done': {
                                const finalResult = event.result || 'Task completed.';
                                setAgentStatus('done');
                                setAgentResult(finalResult);
                                const now = Date.now();
                                window.electron?.agentHistory?.save({
                                    instruction: input,
                                    status: 'done',
                                    steps: JSON.stringify(collectedSteps),
                                    result: finalResult,
                                    stepCount: collectedSteps.length,
                                    startedAt: taskStartedAt,
                                    completedAt: now,
                                    durationMs: now - taskStartedAt,
                                }).catch(() => { });
                                break;
                            }
                            case 'stopped': {
                                const finalResult = event.result || 'Agent stopped.';
                                setAgentStatus('stopped');
                                setAgentResult(finalResult);
                                const now = Date.now();
                                window.electron?.agentHistory?.save({
                                    instruction: input,
                                    status: 'stopped',
                                    steps: JSON.stringify(collectedSteps),
                                    result: finalResult,
                                    stepCount: collectedSteps.length,
                                    startedAt: taskStartedAt,
                                    completedAt: now,
                                    durationMs: now - taskStartedAt,
                                }).catch(() => { });
                                break;
                            }
                            case 'error': {
                                const finalResult = event.message || 'An error occurred.';
                                setAgentStatus('error');
                                setAgentResult(finalResult);
                                const now = Date.now();
                                window.electron?.agentHistory?.save({
                                    instruction: input,
                                    status: 'error',
                                    steps: JSON.stringify(collectedSteps),
                                    result: finalResult,
                                    stepCount: collectedSteps.length,
                                    startedAt: taskStartedAt,
                                    completedAt: now,
                                    durationMs: now - taskStartedAt,
                                }).catch(() => { });
                                break;
                            }
                        }
                    } catch { /* malformed SSE line */ }
                }
            }
        } catch (err: any) {
            if (err?.name === 'AbortError') return;
            const errMsg = `[Agent Debug] Fetch/stream error: ${err?.name} ${err?.message}`;
            console.error(errMsg, err);
            window.electron?.log?.(errMsg);
            setAgentStatus('error');
            setAgentResult('Could not connect to the AI backend. Make sure the server is running.');
        }
    }, []);

    const handleStopAgent = useCallback(async () => {
        agentAbortRef.current?.abort();
        try {
            await fetch(`${BACKEND_URL}/agent/stop`, { method: 'POST' });
        } catch { /* ignore */ }
        setAgentStatus('stopped');
        setAgentResult('Agent stopped by user.');
    }, []);

    const handleResumeAgent = useCallback(async () => {
        try {
            await fetch(`${BACKEND_URL}/agent/resume`, { method: 'POST' });
            setAgentStatus('running');
            setAgentAuthUrl(undefined);
        } catch { /* ignore */ }
    }, []);

    const handleClearAgent = useCallback(() => {
        setAgentInstruction('');
        setAgentSteps([]);
        setAgentResult(undefined);
        setAgentAuthService(undefined);
        setAgentAuthUrl(undefined);
        setAgentStatus('idle');
    }, []);

    // Navigation handlers
    const handleBack = useCallback(() => {
        if (!activeTabId) return;
        const tab = tabs.find(t => t.id === activeTabId);
        const webview = webviewRefs.current.get(activeTabId);

        if (webview && webview.canGoBack()) {
            webview.goBack();
        } else if (tab && !tab.url.startsWith('anthracite://')) {
            // Webview can't go back further — return to home page
            // Update tab URL to home page (webview stays alive but hidden)
            window.electron?.navigation.navigate('anthracite://newtab');
            setTabs(prev => prev.map(t =>
                t.id === activeTabId ? { ...t, url: 'anthracite://newtab', title: 'New Tab', canGoBack: false, canGoForward: true } : t
            ));
        }
    }, [activeTabId, tabs]);

    const handleForward = useCallback(() => {
        if (!activeTabId) return;
        const tab = tabs.find(t => t.id === activeTabId);
        const webview = webviewRefs.current.get(activeTabId);

        if (tab?.url.startsWith('anthracite://') && webview) {
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

    // Listen for back/forward from native menu
    useEffect(() => {
        const handler = () => handleBack();
        // @ts-expect-error — channel not in preload yet; kept as placeholder
        window.electron?.ipc?.on('go-back-active-tab', handler);
        return () => { /* listener cleanup handled by preload */ };
    }, [handleBack]);

    useEffect(() => {
        const handler = () => handleForward();
        // @ts-expect-error — channel not in preload yet; kept as placeholder
        window.electron?.ipc?.on('go-forward-active-tab', handler);
        return () => { /* listener cleanup handled by preload */ };
    }, [handleForward]);

    // Listen for run-workflow events from Settings page
    useEffect(() => {
        const handler = (e: Event) => {
            const { instruction } = (e as CustomEvent).detail;
            if (instruction) handleRunAgent(instruction);
        };
        window.addEventListener('run-workflow', handler);
        return () => window.removeEventListener('run-workflow', handler);
    }, [handleRunAgent]);

    // Listen for navigate-to-url from main process (triggered by TopBar URL bar)
    useEffect(() => {
        if (window.electron?.navigation?.onNavigateToUrl) {
            const unsubscribe = window.electron.navigation.onNavigateToUrl(({ tabId, url }) => {
                if (url.startsWith('anthracite://')) return;
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
        <div className="h-screen w-full bg-[#0A0A0B] overflow-hidden font-sans">
            {/* Floating Sidebar - z-index ensures it's above webview */}
            <Sidebar
                isPinned={isSidebarPinned}
                onPinnedChange={setIsSidebarPinned}
                tabs={tabs}
                activeTabId={activeTabId}
                onNewTabWithOverlay={() => {
                    window.electron?.tabs.create();
                    setNavigationOverlayMode('new-tab');
                    setShowNavigationOverlay(true);
                }}
                onBack={handleBack}
                onForward={handleForward}
                onReload={handleReload}
                canGoBack={activeTab?.canGoBack || (!!activeTabId && !isHomePage && tabsWithWebview.has(activeTabId))}
                canGoForward={activeTab?.canGoForward || (isHomePage && !!activeTabId && tabsWithWebview.has(activeTabId))}
                isLoading={activeTab?.isLoading}
                onEditUrl={() => {
                    setNavigationOverlayMode('edit-url');
                    setShowNavigationOverlay(true);
                }}
                onToggleAgentPanel={() => setIsAgentPanelOpen(prev => !prev)}
                currentUrl={activeTab?.url}
            />

            {/* Main Content Area — full screen, no top bar */}
            <motion.main
                className="h-full relative"
                animate={{
                    marginLeft: isSidebarPinned ? 340 : 0,
                }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
                {/* Transparent drag strip for macOS traffic lights */}
                <div
                    className="absolute top-0 left-0 right-0 h-[38px] z-[50]"
                    style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
                />
                {/* Loading state */}
                {!isReady ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#0A0A0B] z-10">
                        <div className="flex flex-col items-center gap-4">
                            <div className="loading-spinner w-8 h-8" />
                            <p className="text-sm text-text-tertiary">Loading...</p>
                        </div>
                    </div>
                ) : (
                    /* Webviews and Internal Pages Container */
                    <div className="relative w-full h-full">
                        {/* Internal Pages - z-20 to render above hidden webviews */}
                        <AnimatePresence mode="wait">
                            {isSettingsPage && (
                                <motion.div
                                    key="settings"
                                    className="absolute inset-0 z-20"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    <SettingsPage />
                                </motion.div>
                            )}
                            {(isHomePage || isAgentStartingPage) && (
                                <motion.div
                                    key="home"
                                    className="absolute inset-0 z-20"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    <HomePage
                                        onRun={handleRunAgent}
                                        agentStatus={agentStatus}
                                    />
                                </motion.div>
                            )}
                            {isInternalPage && !isHomePage && !isSettingsPage && (
                                <motion.div
                                    key="internal"
                                    className="absolute inset-0 z-20"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    <HomePage
                                        onRun={handleRunAgent}
                                        agentStatus={agentStatus}
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Browser Views */}
                        {tabs.map(tab => {
                            const hasWebContent = !tab.url.startsWith('anthracite://');
                            const hadWebContent = tabsWithWebview.has(tab.id);
                            if (!hasWebContent && !hadWebContent) return null;

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
                                    webviewPreloadPath={webviewPreloadPath}
                                />
                            );
                        })}
                    </div>
                )}
            </motion.main>

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

            {/* Command Palette */}
            <CommandPalette
                isOpen={showCommandPalette}
                onClose={() => setShowCommandPalette(false)}
                tabs={tabs}
                activeTabId={activeTabId}
                canGoBack={activeTab?.canGoBack || (!!activeTabId && !isHomePage && tabsWithWebview.has(activeTabId))}
                canGoForward={activeTab?.canGoForward || (isHomePage && !!activeTabId && tabsWithWebview.has(activeTabId))}
                isSidebarPinned={isSidebarPinned}
                adBlockEnabled={adBlockEnabled}
                onNewTab={() => window.electron?.tabs.create()}
                onCloseTab={(tabId) => window.electron?.tabs.close(tabId)}
                onSwitchTab={(tabId) => window.electron?.tabs.switch(tabId)}
                onBack={handleBack}
                onForward={handleForward}
                onReload={handleReload}
                onNavigate={handleNavigate}
                onToggleSidebarPin={() => setIsSidebarPinned(p => !p)}
                onToggleAdBlock={async () => {
                    const result = await window.electron?.adBlock.toggle(!adBlockEnabled);
                    if (result) setAdBlockEnabled(result.enabled);
                }}
            />

            {/* Agent Activity Panel */}
            <AgentPanel
                isOpen={isAgentPanelOpen}
                onClose={() => setIsAgentPanelOpen(false)}
                status={agentStatus}
                instruction={agentInstruction}
                steps={agentSteps}
                result={agentResult}
                authService={agentAuthService}
                authUrl={agentAuthUrl}
                onStop={handleStopAgent}
                onResume={handleResumeAgent}
                onFollowUp={handleRunAgent}
                onClear={handleClearAgent}
            />

            {/* Arc-Style Navigation Overlay */}
            <NavigationOverlay
                isOpen={showNavigationOverlay}
                onClose={() => setShowNavigationOverlay(false)}
                onNavigate={(url) => {
                    if (activeTabId) {
                        handleTabUpdate(activeTabId, { isLoading: true });
                        handleNavigate(url);
                    }
                }}
                currentUrl={activeTab?.url}
                mode={navigationOverlayMode}
            />

            {/* First-run onboarding wizard */}
            {showOnboarding && (
                <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
            )}
        </div>
    );
}

export default App;
