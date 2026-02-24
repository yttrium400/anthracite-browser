import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '../lib/utils';
import {
    ArrowLeft,
    ArrowRight,
    RotateCw,
    X,
    Lock,
    Unlock,
    Sparkles,
    Globe,
    Loader2,
    History,
    Search,
    Square,
    Pause,
    Play,
} from 'lucide-react';

interface TopBarProps {
    className?: string;
    isSidebarPinned?: boolean;
    onBack?: () => void;
    onForward?: () => void;
    onReload?: () => void;
    canGoBack?: boolean;
    canGoForward?: boolean;
    isLoading?: boolean;
    onNavigate?: (url: string) => void;
}

// ... existing interfaces ...

// ... existing interfaces ...

interface Suggestion {
    type: 'history' | 'search';
    url?: string;
    title: string;
    favicon?: string;
    visitCount?: number;
}

interface ActiveTab {
    id: string;
    title: string;
    url: string;
    favicon: string;
    isLoading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
}

// ── Draft text helpers (sessionStorage) ──────────────────────────────────────
// Using sessionStorage instead of a React ref so the draft survives component
// remounts (e.g. panel CSS toggling that unmounts/remounts the tree).
const draftKey = (tabId: string) => `topbar_draft_${tabId}`;
const getDraft = (tabId: string): string | null =>
    sessionStorage.getItem(draftKey(tabId));
const saveDraft = (tabId: string, text: string): void =>
    sessionStorage.setItem(draftKey(tabId), text);
const clearDraft = (tabId: string): void =>
    sessionStorage.removeItem(draftKey(tabId));

export function TopBar({
    className,
    isSidebarPinned,
    onBack,
    onForward,
    onReload,
    canGoBack,
    canGoForward,
    isLoading,
    onNavigate
}: TopBarProps) {
    const [activeTab, setActiveTab] = useState<ActiveTab | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [isFocused, setIsFocused] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [isAIProcessing, setIsAIProcessing] = useState(false);
    const [agentStatus, setAgentStatus] = useState<string>('');
    const [isAgentPaused, setIsAgentPaused] = useState(false);
    const [authRequired, setAuthRequired] = useState<{ service: string; url: string } | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Autocomplete state
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [showSuggestions, setShowSuggestions] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<NodeJS.Timeout>();
    const activeTabIdRef = useRef<string | null>(null);
    // Ref mirror of isAIProcessing so the tab-update listener (stale closure) can
    // check it without needing to be recreated on every state change.
    const isAIProcessingRef = useRef(false);
    // Tracks the last URL we've seen for the current tab.
    // onTabUpdated fires for loading state / title / favicon changes too — we only
    // want to reset the input when the URL itself has changed (a real navigation).
    const activeTabUrlRef = useRef<string>('');

    // Keep ref in sync with activeTab
    useEffect(() => {
        activeTabIdRef.current = activeTab?.id || null;
    }, [activeTab]);

    // Subscribe to active tab changes
    useEffect(() => {
        if (typeof window !== 'undefined' && window.electron?.tabs) {
            // Get initial active tab
            window.electron.tabs.getActive().then(tab => {
                setActiveTab(tab);
                activeTabIdRef.current = tab?.id || null;
                activeTabUrlRef.current = tab?.url || '';
                const isInternalUrl = tab?.url.startsWith('anthracite://') || tab?.url.startsWith('about:') || tab?.url.startsWith('data:');
                if (tab) {
                    const draft = getDraft(tab.id);
                    if (draft !== null) {
                        setInputValue(draft);
                    } else if (!isInternalUrl) {
                        setInputValue(tab.url);
                    }
                }
            });

            // Listen for active tab changes
            const unsubscribe = window.electron.tabs.onActiveTabChanged((tab) => {
                const draft = tab?.id ? getDraft(tab.id) : null;
                setActiveTab(tab);
                activeTabIdRef.current = tab?.id || null;
                activeTabUrlRef.current = tab?.url || '';
                const isInternalUrl = tab?.url.startsWith('anthracite://') || tab?.url.startsWith('about:') || tab?.url.startsWith('data:');
                if (tab) {
                    if (draft !== null) {
                        setInputValue(draft);
                    } else if (!isInternalUrl) {
                        setInputValue(tab.url);
                    } else if (!isAIProcessingRef.current) {
                        // Only blank the bar for internal pages (newtab) when the
                        // agent is NOT running.  When the agent creates a fresh tab
                        // it fires onActiveTabChanged with an internal URL — without
                        // this guard that would immediately wipe the command text.
                        setInputValue('');
                    }
                }
            });

            // Listen for tab updates (loading state, URL, title, etc.)
            const unsubscribeUpdate = window.electron.tabs.onTabUpdated((tab) => {
                if (activeTabIdRef.current && tab.id === activeTabIdRef.current) {
                    // Only reset inputValue when the URL itself changes (real navigation).
                    // onTabUpdated also fires for loading-state / title / favicon changes
                    // with the same URL — those must not overwrite a pending draft.
                    const urlChanged = tab.url !== activeTabUrlRef.current;

                    setActiveTab(prev => prev ? { ...prev, ...tab } : null);

                    const isInternalUrl = tab.url.startsWith('anthracite://') || tab.url.startsWith('about:') || tab.url.startsWith('data:');
                    if (!isInternalUrl) {
                        if (urlChanged) {
                            activeTabUrlRef.current = tab.url;
                        }
                        setInputValue(prevInput => {
                            const isFocused = inputRef.current === document.activeElement;
                            // When the URL changes to a real site, always sync the bar
                            // (even while the agent is running — this is exactly when we
                            // WANT to show the URL the agent just navigated to).
                            // The agent-running guard lives only in the internal-URL branch
                            // below, to prevent the new-tab creation event from wiping
                            // the command before the agent opens anything.
                            if (urlChanged && !isFocused) {
                                clearDraft(tab.id);
                                return tab.url;
                            }
                            return prevInput;
                        });
                    } else if (!isAIProcessingRef.current) {
                        setInputValue('');
                    }
                }
            });

            return () => {
                unsubscribe();
                unsubscribeUpdate();
            };
        }
    }, []);

    // Fetch suggestions when input changes
    const fetchSuggestions = useCallback(async (query: string) => {
        if (!query || query.length < 1) {
            setSuggestions([]);
            setShowSuggestions(false);
            return;
        }

        const results: Suggestion[] = [];

        // Fetch from history
        try {
            if (window.electron?.history) {
                const historyResults = await window.electron.history.search(query, 5);
                historyResults.forEach((entry: any) => {
                    results.push({
                        type: 'history',
                        url: entry.url,
                        title: entry.title || entry.url,
                        favicon: entry.favicon,
                        visitCount: entry.visitCount,
                    });
                });
            }
        } catch (err) {
            console.error('Failed to fetch history:', err);
        }

        // Fetch Google search suggestions via IPC (avoids CORS)
        try {
            if (window.electron?.searchSuggestions) {
                const searchSuggestions = await window.electron.searchSuggestions(query);

                // Add up to 4 search suggestions
                searchSuggestions.slice(0, 4).forEach((term: string) => {
                    // Don't duplicate if already in history results
                    if (!results.some(r => r.title.toLowerCase() === term.toLowerCase())) {
                        results.push({
                            type: 'search',
                            title: term,
                        });
                    }
                });
            }
        } catch (err) {
            console.error('Failed to fetch search suggestions:', err);
        }

        // Only show suggestions if input is still focused
        if (document.activeElement === inputRef.current) {
            setSuggestions(results);
            setShowSuggestions(results.length > 0);
            setSelectedIndex(-1);
        }
    }, []);

    // Debounced input handler
    const handleInputChange = (value: string) => {
        setInputValue(value);
        // Persist to sessionStorage so the text survives panel switches and remounts.
        if (activeTab?.id) {
            saveDraft(activeTab.id, value);
        }

        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        debounceRef.current = setTimeout(() => {
            fetchSuggestions(value);
        }, 300); // 300ms debounce to prevent blocking main process with history search
    };

    const handleNavigate = (e: React.FormEvent) => {
        e.preventDefault();
        if (inputValue.trim() && window.electron?.navigation) {
            setShowSuggestions(false);

            const input = inputValue.trim();
            // Submitted — discard the saved draft for this tab.
            if (activeTab?.id) clearDraft(activeTab.id);

            if (onNavigate) {
                onNavigate(input);
            } else {
                window.electron.navigation.navigate(input);
            }

            setIsEditing(false);
            inputRef.current?.blur();
        }
    };

    const handleSelectSuggestion = (suggestion: Suggestion) => {
        setShowSuggestions(false);
        // Navigating via suggestion — discard any pending draft for this tab.
        if (activeTab?.id) clearDraft(activeTab.id);

        if (suggestion.type === 'history' && suggestion.url) {
            // Navigate directly to URL from history
            setInputValue(suggestion.url);

            if (onNavigate) {
                onNavigate(suggestion.url);
            } else {
                window.electron?.navigation.navigate(suggestion.url);
            }
        } else {
            // Search suggestion - let main process handle the search
            setInputValue(suggestion.title);

            if (onNavigate) {
                onNavigate(suggestion.title);
            } else {
                window.electron?.navigation.navigate(suggestion.title);
            }
        }

        setIsEditing(false);
        inputRef.current?.blur();
    };


    const handleStopAgent = async () => {
        try {
            await fetch('http://127.0.0.1:8000/agent/stop', { method: 'POST' });
            abortControllerRef.current?.abort();
        } catch (err) {
            console.error('Failed to stop agent:', err);
        }
    };

    const handlePauseResumeAgent = async () => {
        try {
            if (isAgentPaused) {
                await fetch('http://127.0.0.1:8000/agent/resume', { method: 'POST' });
                setIsAgentPaused(false);
                setAgentStatus(prev => prev.replace(' (Paused)', '') || 'Resuming...');
            } else {
                await fetch('http://127.0.0.1:8000/agent/pause', { method: 'POST' });
                setIsAgentPaused(true);
                setAgentStatus(prev => prev ? `${prev} (Paused)` : 'Paused');
            }
        } catch (err) {
            console.error('Failed to pause/resume agent:', err);
        }
    };

    const handleRunAgent = async () => {
        if (!inputValue.trim()) return;

        const controller = new AbortController();
        abortControllerRef.current = controller;

        setIsAIProcessing(true);
        isAIProcessingRef.current = true;
        setAgentStatus('Starting...');
        setIsAgentPaused(false);
        try {
            // 1. Get CDP target — prefer current page, fall back to new agent tab
            let activeTarget = await (window as any).electron.agent.getActiveWebviewTarget();
            if (!activeTarget) {
                // On new tab page or internal page — open a fresh tab for the agent
                activeTarget = await (window as any).electron.agent.createAgentTab();
            }

            // Get keys + selected model from settings
            const settings = await window.electron?.settings.getAll();

            // 2. Stream agent task via SSE
            const response = await fetch('http://127.0.0.1:8000/agent/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instruction: inputValue.trim(),
                    cdp_url: activeTarget?.cdpUrl || 'http://127.0.0.1:9222',
                    target_id: activeTarget?.targetId || null,
                    api_key: settings?.openaiApiKey || null,
                    anthropic_api_key: settings?.anthropicApiKey || null,
                    google_api_key: settings?.googleApiKey || null,
                    model: settings?.selectedModel || null,
                }),
                signal: controller.signal,
            });

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (reader) {
                let buffer = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        try {
                            const event = JSON.parse(line.slice(6));
                            switch (event.type) {
                                case 'classifying':
                                    setAgentStatus('Classifying...');
                                    break;
                                case 'classified':
                                    setAgentStatus(event.action === 'fast_navigate' ? 'Fast navigate' : 'Thinking...');
                                    break;
                                case 'fast_action':
                                    setAgentStatus(`Navigating to ${event.url}`);
                                    if (event.url) {
                                        window.electron.navigation.navigate(event.url);
                                    }
                                    break;
                                case 'agent_starting':
                                    setAgentStatus('Agent starting...');
                                    break;
                                case 'step':
                                    setAgentStatus(event.next_goal || `Step ${event.step}...`);
                                    break;
                                case 'auth_required':
                                    setAuthRequired({ service: event.service, url: event.url });
                                    setAgentStatus(`Sign in to ${event.service} to continue`);
                                    setIsAgentPaused(true);
                                    break;
                                case 'done':
                                    setAgentStatus('');
                                    setAuthRequired(null);
                                    break;
                                case 'stopped':
                                    setAgentStatus('Stopped');
                                    setAuthRequired(null);
                                    break;
                                case 'error':
                                    setAgentStatus(`Error: ${event.message}`);
                                    setAuthRequired(null);
                                    console.error('Agent error:', event.message);
                                    setTimeout(() => setAgentStatus(''), 4000);
                                    break;
                            }
                        } catch { /* skip malformed lines */ }
                    }
                }
            }
        } catch (error: any) {
            if (error?.name !== 'AbortError') {
                console.error('Failed to run agent:', error);
            }
        } finally {
            isAIProcessingRef.current = false;
            setIsAIProcessing(false);
            setAgentStatus('');
            setIsAgentPaused(false);
            setAuthRequired(null);
            abortControllerRef.current = null;
            // Sync the URL bar to wherever the agent landed.
            window.electron?.tabs.getActive().then(tab => {
                if (tab && tab.id === activeTabIdRef.current && !tab.url.startsWith('anthracite://')) {
                    clearDraft(tab.id);
                    setInputValue(tab.url);
                }
            });
        }
    };

    const handleFocus = () => {
        setIsFocused(true);
        setIsEditing(true);
        const isInternalPage = activeTab?.url.startsWith('anthracite://') || activeTab?.url.startsWith('about:');
        if (!isInternalPage) {
            // Real page: seed the bar with the URL only if it is currently empty.
            // If the user has a draft ("visit yt"), inputValue is non-empty so we
            // leave it alone.
            if (!inputValue) {
                setInputValue(activeTab?.url || '');
            }
            setTimeout(() => inputRef.current?.select(), 0);
        }
        // Internal pages (newtab, etc.): do NOT touch inputValue here.
        // It is either '' (no draft) or holds the draft the user typed —
        // both are already correct; clearing it was the bug.
        if (inputValue) {
            fetchSuggestions(inputValue);
        }
    };

    const handleBlur = () => {
        // Delay to allow clicking on suggestions
        setTimeout(() => {
            setIsFocused(false);
            setIsEditing(false);
            setShowSuggestions(false);
            // Do NOT reset inputValue here — preserving it means that if the user typed
            // something and then swiped away (blur without submit), clicking the URL bar
            // again will show their typed text rather than the current page URL.
            // onTabUpdated already syncs inputValue when the page actually navigates.
        }, 200);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (showSuggestions && suggestions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) => Math.max(prev - 1, -1));
            } else if (e.key === 'Enter' && selectedIndex >= 0) {
                e.preventDefault();
                handleSelectSuggestion(suggestions[selectedIndex]);
                return;
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setShowSuggestions(false);
                setSelectedIndex(-1);
                return;
            }
        }

        if (e.key === 'Escape') {
            setIsEditing(false);
            setShowSuggestions(false);
            if (activeTab) {
                // Explicit cancel — discard draft and revert to the live page URL.
                if (activeTab.id) clearDraft(activeTab.id);
                setInputValue(activeTab.url);
            }
            inputRef.current?.blur();
        }
    };

    const isSecure = activeTab?.url.startsWith('https://');
    const displayUrl = isEditing ? inputValue : (activeTab?.url || '');

    // Extract domain for display when not editing
    const getDomain = (url: string) => {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch {
            return url;
        }
    };

    return (
        <header
            className={cn(
                "h-[52px] bg-[#0A0A0B]/90 backdrop-blur-xl border-b border-white/[0.06] flex items-center gap-2 px-3",
                "select-none relative z-[100]",
                className
            )}
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
            {/* Traffic Light Spacer (macOS) - Expands when sidebar is pinned */}
            <div
                className={cn(
                    "shrink-0 transition-all duration-300 ease-ios",
                    isSidebarPinned ? "w-[300px]" : "w-[68px]"
                )}
            />

            {/* URL / Search Bar */}
            <form
                onSubmit={handleNavigate}
                className="flex-1 max-w-3xl mx-auto relative"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
                <div
                    className={cn(
                        "relative flex items-center h-9 rounded-xl",
                        "bg-white/[0.05] border",
                        "transition-all duration-200",
                        isFocused
                            ? "border-brand/40 ring-1 ring-brand/30 bg-white/[0.08]"
                            : "border-white/[0.08] hover:border-white/[0.12]",
                        showSuggestions && "rounded-b-none"
                    )}
                >
                    {/* Icon */}
                    <div className="flex items-center justify-center w-9 h-full shrink-0">
                        {isLoading ? (
                            <Loader2 className="h-4 w-4 text-brand animate-spin" />
                        ) : isSecure ? (
                            <Lock className="h-3.5 w-3.5 text-success" />
                        ) : activeTab?.url && !activeTab.url.startsWith('about:') ? (
                            <Unlock className="h-3.5 w-3.5 text-text-tertiary" />
                        ) : (
                            <Globe className="h-4 w-4 text-text-tertiary" />
                        )}
                    </div>

                    {/* Input */}
                    <input
                        ref={inputRef}
                        type="text"
                        value={
                            // Show the raw input when:
                            //   (a) user is actively editing,
                            //   (b) agent is running (keep the command visible), or
                            //   (c) user typed something that doesn't match the live URL
                            //       (pending draft survived a panel/tab switch).
                            isEditing || isAIProcessing || (inputValue !== '' && inputValue !== (activeTab?.url || ''))
                                ? inputValue
                                : activeTab?.url === 'anthracite://newtab' ? '' : getDomain(activeTab?.url || '')
                        }
                        onChange={(e) => handleInputChange(e.target.value)}
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        placeholder="Search or enter URL"
                        className={cn(
                            "flex-1 h-full bg-transparent text-sm",
                            "text-text-primary placeholder:text-text-tertiary",
                            "focus:outline-none",
                            "pr-3",
                            !isEditing && "text-text-secondary"
                        )}
                    />

                    {/* Navigation Controls */}
                    <div className="flex items-center gap-1 text-text-secondary no-drag-region">
                        <button
                            type="button"
                            onClick={onBack}
                            disabled={!canGoBack}
                            className="p-1.5 hover:bg-white/5 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                            <ArrowLeft size={18} />
                        </button>
                        <button
                            type="button"
                            onClick={onForward}
                            disabled={!canGoForward}
                            className="p-1.5 hover:bg-white/5 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                            <ArrowRight size={18} />
                        </button>
                        <button
                            type="button"
                            onClick={onReload}
                            className="p-1.5 hover:bg-white/5 rounded-lg transition-colors"
                        >
                            {isLoading ? <X size={18} /> : <RotateCw size={18} />}
                        </button>
                    </div>
                    {/* AI Indicator + Controls */}
                    <div className="flex items-center gap-1 pr-3">
                        <div className="h-5 w-px bg-white/[0.08] mr-1" />
                        <button
                            type="button"
                            onClick={handleRunAgent}
                            disabled={isAIProcessing}
                            className={cn(
                                "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors",
                                isAIProcessing
                                    ? "bg-brand/15 text-brand cursor-wait animate-glow-pulse"
                                    : "text-text-secondary hover:bg-white/[0.06] hover:text-text-primary"
                            )}
                            title="Run AI Agent"
                        >
                            {isAIProcessing ? (
                                <Loader2 className="h-3.5 w-3.5 text-brand animate-spin" />
                            ) : (
                                <Sparkles className="h-3.5 w-3.5 text-brand" />
                            )}
                            <span className="hidden sm:inline">{isAIProcessing ? (agentStatus || 'Running...') : 'AI'}</span>
                        </button>
                        {/* Pause/Play + Stop buttons — only visible when agent is running */}
                        {isAIProcessing && (
                            <>
                                <button
                                    type="button"
                                    onClick={handlePauseResumeAgent}
                                    className="p-1 rounded-md text-text-secondary hover:bg-surface-tertiary hover:text-text-primary transition-colors"
                                    title={isAgentPaused ? "Resume agent" : "Pause agent"}
                                >
                                    {isAgentPaused ? (
                                        <Play className="h-3.5 w-3.5 text-success" />
                                    ) : (
                                        <Pause className="h-3.5 w-3.5 text-warning" />
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleStopAgent}
                                    className="p-1 rounded-md text-text-secondary hover:bg-error/10 hover:text-error transition-colors"
                                    title="Stop agent"
                                >
                                    <Square className="h-3.5 w-3.5 text-error" />
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Autocomplete Suggestions Dropdown */}
                {showSuggestions && suggestions.length > 0 && (
                    <div
                        ref={suggestionsRef}
                        className="absolute z-[9999] w-full bg-[#1A1A1D]/95 backdrop-blur-xl border border-t-0 border-white/[0.08] rounded-b-xl shadow-lg overflow-hidden"
                    >
                        {suggestions.map((suggestion, index) => (
                            <button
                                key={`${suggestion.type}-${suggestion.url || suggestion.title}-${index}`}
                                type="button"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    handleSelectSuggestion(suggestion);
                                }}
                                className={cn(
                                    "flex items-center gap-3 w-full px-3 py-2.5 text-left transition-colors",
                                    "hover:bg-white/[0.06]",
                                    index === selectedIndex && "bg-white/[0.06]"
                                )}
                            >
                                {/* Icon */}
                                <div className="flex items-center justify-center h-7 w-7 rounded-md bg-white/[0.06] shrink-0">
                                    {suggestion.type === 'history' && suggestion.favicon ? (
                                        <img
                                            src={suggestion.favicon}
                                            alt=""
                                            className="h-4 w-4 rounded"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                            }}
                                        />
                                    ) : suggestion.type === 'history' ? (
                                        <History className="h-3.5 w-3.5 text-text-tertiary" />
                                    ) : (
                                        <Search className="h-3.5 w-3.5 text-text-tertiary" />
                                    )}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm text-text-primary truncate">
                                        {suggestion.title}
                                    </div>
                                    {suggestion.type === 'history' && suggestion.url && (
                                        <div className="text-xs text-text-tertiary truncate">
                                            {suggestion.url}
                                        </div>
                                    )}
                                </div>

                                {/* Type Badge */}
                                {suggestion.type === 'search' && (
                                    <span className="text-[10px] text-brand bg-brand/15 px-1.5 py-0.5 rounded shrink-0">
                                        Search
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                )}
            </form>

            {/* Right Spacer */}
            <div className="w-20 shrink-0" />

            {/* Takeover Banner — shown when agent hits a login/auth page */}
            {authRequired && (
                <div
                    className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-[9999] flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/25 backdrop-blur-xl shadow-large text-sm"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                    <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                    <span className="text-amber-200 font-medium">
                        Sign in to <span className="font-semibold">{authRequired.service}</span> to continue
                    </span>
                    <span className="text-amber-400/60 text-xs">Agent paused</span>
                    <div className="flex items-center gap-1 ml-1">
                        <button
                            onClick={handlePauseResumeAgent}
                            className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-medium transition-colors"
                        >
                            Resume
                        </button>
                        <button
                            onClick={handleStopAgent}
                            className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-text-tertiary text-xs font-medium transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </header>
    );
}
