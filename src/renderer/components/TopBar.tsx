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
    activeTabId?: string | null;
    getWebviewId?: (tabId: string) => number | null;
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

export function TopBar({
    className,
    isSidebarPinned,
    onBack,
    onForward,
    onReload,
    canGoBack,
    canGoForward,
    isLoading,
    activeTabId: activeTabIdProp,
    getWebviewId,
    onNavigate
}: TopBarProps) {
    const [activeTab, setActiveTab] = useState<ActiveTab | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [isFocused, setIsFocused] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [isAIProcessing, setIsAIProcessing] = useState(false);
    const [agentStatus, setAgentStatus] = useState<string>('');
    const [isAgentPaused, setIsAgentPaused] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Autocomplete state
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [showSuggestions, setShowSuggestions] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<NodeJS.Timeout>();
    const activeTabIdRef = useRef<string | null>(null);

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
                // Don't show internal URLs in the search bar
                const isInternalUrl = tab?.url.startsWith('anthracite://') || tab?.url.startsWith('about:');
                if (tab && !isInternalUrl) {
                    setInputValue(tab.url);
                }
            });

            // Listen for active tab changes
            const unsubscribe = window.electron.tabs.onActiveTabChanged((tab) => {
                setActiveTab(tab);
                activeTabIdRef.current = tab?.id || null;
                const isInternalUrl = tab?.url.startsWith('anthracite://') || tab?.url.startsWith('about:');
                if (tab && !isEditing && !isInternalUrl) {
                    setInputValue(tab.url);
                } else if (isInternalUrl) {
                    setInputValue('');
                }
            });

            // Listen for tab updates (loading state, URL, title, etc.)
            const unsubscribeUpdate = window.electron.tabs.onTabUpdated((tab) => {
                // Use ref to get current activeTabId to avoid stale closure
                if (activeTabIdRef.current && tab.id === activeTabIdRef.current) {
                    setActiveTab(prev => prev ? { ...prev, ...tab } : null);
                    // Always update URL when navigation happens (unless editing)
                    const isInternalUrl = tab.url.startsWith('anthracite://') || tab.url.startsWith('about:');
                    if (!isInternalUrl) {
                        // Use functional update to check isEditing state
                        setInputValue(prevInput => {
                            // Only update if not currently editing
                            const inputEl = inputRef.current;
                            const isFocused = inputEl === document.activeElement;
                            if (!isFocused) {
                                return tab.url;
                            }
                            return prevInput;
                        });
                    } else {
                        setInputValue('');
                    }
                }
            });

            return () => {
                unsubscribe();
                unsubscribeUpdate();
            };
        }
    }, []); // Remove isEditing dependency to avoid recreating listeners

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

            // Optimistic update & Navigation
            if (onNavigate) {
                onNavigate(input);
            } else {
                // Fallback if no handler provided (shouldn't happen in App)
                window.electron.navigation.navigate(input);
            }

            setIsEditing(false);
            inputRef.current?.blur();
        }
    };

    const handleSelectSuggestion = (suggestion: Suggestion) => {
        setShowSuggestions(false);

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
        setAgentStatus('Starting...');
        setIsAgentPaused(false);
        let agentTabId: string | null = null;

        try {
            // 1. Create a NEW tab for the agent
            const newTabParams = await window.electron.tabs.create('about:blank');
            agentTabId = newTabParams.id;

            // Wait for tab to be active and webview to mount
            // We need to wait for the UI to update and create the <webview> ref
            let webContentsId: number | null = null;
            for (let i = 0; i < 50; i++) { // Wait up to 5 seconds
                await new Promise(r => setTimeout(r, 100));
                // We need to access getActiveWebviewId from prop, but it returns current active tab's wv
                // Since we just switched to the new tab (createTab switches automatically), 
                // getActiveWebviewId should return the new tab's webview ID once mounted.
                webContentsId = getWebviewId?.(agentTabId) || null;
                if (webContentsId) break;
            }

            if (!webContentsId) {
                console.error('[Agent] Failed to initialize new tab webview');
                setAgentStatus('Error: Tab Init Failed');
                setIsAIProcessing(false);
                return;
            }

            // 2. Start agent on the NEW tab's webview
            // This connects the backend agent to the visible renderer webview
            const agentInfo = await (window as any).electron.agent.startOnCurrentTab(agentTabId, webContentsId);

            // Get API key from settings
            const settings = await window.electron?.settings.getAll();
            const apiKey = settings?.openaiApiKey;

            // 3. Stream agent task via SSE
            const response = await fetch('http://127.0.0.1:8000/agent/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instruction: inputValue.trim(),
                    cdp_url: agentInfo.cdpUrl || 'http://127.0.0.1:9222',
                    target_id: agentInfo.targetId || null,
                    api_key: apiKey,
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
                                    break;
                                case 'agent_starting':
                                    setAgentStatus('Agent starting...');
                                    break;
                                case 'step':
                                    setAgentStatus(event.next_goal || `Step ${event.step}...`);
                                    break;
                                case 'done':
                                    setAgentStatus('');
                                    break;
                                case 'stopped':
                                    setAgentStatus('Stopped');
                                    break;
                                case 'error':
                                    setAgentStatus('');
                                    console.error('Agent error:', event.message);
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
            // Clean up agent state
            if (agentTabId) {
                (window as any).electron.agent.endAgentTask(agentTabId).catch(() => { });
            }
            setIsAIProcessing(false);
            setAgentStatus('');
            setIsAgentPaused(false);
            abortControllerRef.current = null;
        }
    };

    const handleFocus = () => {
        setIsFocused(true);
        setIsEditing(true);
        // Clear internal URLs and select text
        if (activeTab?.url.startsWith('anthracite://')) {
            setInputValue('');
        } else {
            setTimeout(() => inputRef.current?.select(), 0);
        }
        // Fetch suggestions for current input
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
            // Reset to current URL if not submitted
            if (activeTab && !activeTab.url.startsWith('anthracite://')) {
                setInputValue(activeTab.url);
            }
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
                    "shrink-0 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
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
                        value={isEditing ? inputValue : (activeTab?.url === 'anthracite://newtab' ? '' : getDomain(displayUrl))}
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
        </header>
    );
}
