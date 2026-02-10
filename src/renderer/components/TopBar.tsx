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
    ChevronDown,
    Check,
} from 'lucide-react';
import { getIconComponent } from './IconPicker';
import type { Realm, ThemeColor } from '../../shared/types';

interface TopBarProps {
    className?: string;
    isSidebarPinned?: boolean;
    onBack?: () => void;
    onForward?: () => void;
    onReload?: () => void;
    canGoBack?: boolean;
    canGoForward?: boolean;
    isLoading?: boolean;
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

// Color mappings for realm indicator
const COLOR_BG_MAP: Record<ThemeColor, string> = {
    blue: 'bg-blue-500/10',
    purple: 'bg-purple-500/10',
    pink: 'bg-pink-500/10',
    red: 'bg-red-500/10',
    orange: 'bg-orange-500/10',
    yellow: 'bg-yellow-500/10',
    green: 'bg-green-500/10',
    teal: 'bg-teal-500/10',
    cyan: 'bg-cyan-500/10',
    gray: 'bg-gray-500/10',
};

const COLOR_TEXT_MAP: Record<ThemeColor, string> = {
    blue: 'text-blue-600',
    purple: 'text-purple-600',
    pink: 'text-pink-600',
    red: 'text-red-600',
    orange: 'text-orange-600',
    yellow: 'text-yellow-600',
    green: 'text-green-600',
    teal: 'text-teal-600',
    cyan: 'text-cyan-600',
    gray: 'text-gray-600',
};

const COLOR_BORDER_MAP: Record<ThemeColor, string> = {
    blue: 'border-blue-500/30',
    purple: 'border-purple-500/30',
    pink: 'border-pink-500/30',
    red: 'border-red-500/30',
    orange: 'border-orange-500/30',
    yellow: 'border-yellow-500/30',
    green: 'border-green-500/30',
    teal: 'border-teal-500/30',
    cyan: 'border-cyan-500/30',
    gray: 'border-gray-500/30',
};

export function TopBar({
    className,
    isSidebarPinned,
    onBack,
    onForward,
    onReload,
    canGoBack,
    canGoForward,
    isLoading
}: TopBarProps) {
    const [activeTab, setActiveTab] = useState<ActiveTab | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [isFocused, setIsFocused] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [isAIProcessing, setIsAIProcessing] = useState(false);

    // Autocomplete state
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [showSuggestions, setShowSuggestions] = useState(false);

    // Realm state
    const [realms, setRealms] = useState<Realm[]>([]);
    const [activeRealmId, setActiveRealmId] = useState<string>('');
    const [showRealmDropdown, setShowRealmDropdown] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);
    const realmDropdownRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<NodeJS.Timeout>();
    const activeTabIdRef = useRef<string | null>(null);

    // Keep ref in sync with activeTab
    useEffect(() => {
        activeTabIdRef.current = activeTab?.id || null;
    }, [activeTab]);

    // Load realm state and subscribe to changes
    useEffect(() => {
        if (typeof window === 'undefined' || !window.electron) return;

        const loadState = async () => {
            try {
                const state = await window.electron.sidebarState.get();
                setRealms(state.realms);
                setActiveRealmId(state.activeRealmId);
            } catch (err) {
                console.error('Failed to load realm state:', err);
            }
        };

        loadState();

        // Subscribe to realm changes
        const unsubscribeRealmCreated = window.electron.realms.onCreated((realm) => {
            setRealms(prev => [...prev, realm].sort((a, b) => a.order - b.order));
        });
        const unsubscribeRealmUpdated = window.electron.realms.onUpdated((realm) => {
            setRealms(prev => prev.map(r => r.id === realm.id ? realm : r));
        });
        const unsubscribeRealmDeleted = window.electron.realms.onDeleted(({ realmId }) => {
            setRealms(prev => prev.filter(r => r.id !== realmId));
        });
        const unsubscribeActiveRealmChanged = window.electron.realms.onActiveChanged(({ realmId }) => {
            setActiveRealmId(realmId);
        });

        return () => {
            unsubscribeRealmCreated();
            unsubscribeRealmUpdated();
            unsubscribeRealmDeleted();
            unsubscribeActiveRealmChanged();
        };
    }, []);

    // Close realm dropdown on outside click
    useEffect(() => {
        if (!showRealmDropdown) return;

        const handleClick = (e: MouseEvent) => {
            if (realmDropdownRef.current && !realmDropdownRef.current.contains(e.target as Node)) {
                setShowRealmDropdown(false);
            }
        };

        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showRealmDropdown]);

    // Subscribe to active tab changes
    useEffect(() => {
        if (typeof window !== 'undefined' && window.electron?.tabs) {
            // Get initial active tab
            window.electron.tabs.getActive().then(tab => {
                setActiveTab(tab);
                activeTabIdRef.current = tab?.id || null;
                // Don't show internal URLs in the search bar
                const isInternalUrl = tab?.url.startsWith('poseidon://') || tab?.url.startsWith('about:');
                if (tab && !isInternalUrl) {
                    setInputValue(tab.url);
                }
            });

            // Listen for active tab changes
            const unsubscribe = window.electron.tabs.onActiveTabChanged((tab) => {
                setActiveTab(tab);
                activeTabIdRef.current = tab?.id || null;
                const isInternalUrl = tab?.url.startsWith('poseidon://') || tab?.url.startsWith('about:');
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
                    const isInternalUrl = tab.url.startsWith('poseidon://') || tab.url.startsWith('about:');
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
        }, 100); // Fast debounce for responsive feel
    };

    const handleNavigate = (e: React.FormEvent) => {
        e.preventDefault();
        if (inputValue.trim() && window.electron?.navigation) {
            setShowSuggestions(false);

            const input = inputValue.trim();

            // Send raw input to main process - let it handle normalization and search engine selection
            window.electron.navigation.navigate(input);
            setIsEditing(false);
            inputRef.current?.blur();
        }
    };

    const handleSelectSuggestion = (suggestion: Suggestion) => {
        setShowSuggestions(false);

        if (suggestion.type === 'history' && suggestion.url) {
            // Navigate directly to URL from history
            setInputValue(suggestion.url);
            window.electron?.navigation.navigate(suggestion.url);
        } else {
            // Search suggestion - let main process handle the search
            setInputValue(suggestion.title);
            window.electron?.navigation.navigate(suggestion.title);
        }

        setIsEditing(false);
        inputRef.current?.blur();
    };


    const handleRunAgent = async () => {
        if (!inputValue.trim()) return;

        setIsAIProcessing(true);
        try {
            // 1. Create a new agent tab inside Poseidon and get CDP info
            const agentTab = await (window as any).electron.agent.createAgentTab();

            // 2. Run the agent task, connected to Poseidon via CDP
            const response = await fetch('http://127.0.0.1:8000/agent/run', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    instruction: inputValue.trim(),
                    cdp_url: agentTab.cdpUrl || 'http://127.0.0.1:9222',
                    target_id: agentTab.targetId || null,
                }),
            });
            const data = await response.json();
        } catch (error) {
            console.error('Failed to run agent:', error);
        } finally {
            setIsAIProcessing(false);
        }
    };

    const handleFocus = () => {
        setIsFocused(true);
        setIsEditing(true);
        // Clear internal URLs and select text
        if (activeTab?.url.startsWith('poseidon://')) {
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
            if (activeTab && !activeTab.url.startsWith('poseidon://')) {
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

    // Get current realm
    const currentRealm = realms.find(r => r.id === activeRealmId);

    // Handle realm switch
    const handleRealmSwitch = (realmId: string) => {
        window.electron?.realms.setActive(realmId);
        setShowRealmDropdown(false);
    };

    // Extract domain for display when not editing
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
                "h-[52px] bg-surface border-b border-border/60 flex items-center gap-2 px-3",
                "select-none",
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

            {/* Realm Indicator */}
            {currentRealm && (
                <div
                    ref={realmDropdownRef}
                    className="relative"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                    <button
                        onClick={() => setShowRealmDropdown(!showRealmDropdown)}
                        className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg",
                            "border transition-all duration-200",
                            COLOR_BG_MAP[currentRealm.color],
                            COLOR_BORDER_MAP[currentRealm.color],
                            "hover:brightness-95"
                        )}
                        title="Switch realm"
                    >
                        {(() => {
                            const RealmIcon = getIconComponent(currentRealm.icon);
                            return <RealmIcon className={cn("h-3.5 w-3.5", COLOR_TEXT_MAP[currentRealm.color])} />;
                        })()}
                        <span className={cn("text-xs font-medium max-w-[80px] truncate", COLOR_TEXT_MAP[currentRealm.color])}>
                            {currentRealm.name}
                        </span>
                        <ChevronDown className={cn(
                            "h-3 w-3 transition-transform",
                            COLOR_TEXT_MAP[currentRealm.color],
                            showRealmDropdown && "rotate-180"
                        )} />
                    </button>

                    {/* Realm Dropdown */}
                    {showRealmDropdown && (
                        <div className={cn(
                            "absolute top-full left-0 mt-1 min-w-[160px] z-[100]",
                            "bg-white/95 backdrop-blur-xl rounded-xl",
                            "border border-border/60 shadow-lg",
                            "py-1.5 animate-in fade-in zoom-in-95 duration-100"
                        )}>
                            {realms.map((realm) => {
                                const RealmIcon = getIconComponent(realm.icon);
                                const isActive = realm.id === activeRealmId;
                                return (
                                    <button
                                        key={realm.id}
                                        onClick={() => handleRealmSwitch(realm.id)}
                                        className={cn(
                                            "flex items-center gap-2 w-full px-3 py-2 text-left",
                                            "text-sm transition-colors duration-100",
                                            isActive
                                                ? cn(COLOR_BG_MAP[realm.color], COLOR_TEXT_MAP[realm.color])
                                                : "text-text-primary hover:bg-surface-secondary"
                                        )}
                                    >
                                        <RealmIcon className={cn("h-4 w-4", COLOR_TEXT_MAP[realm.color])} />
                                        <span className="flex-1 truncate">{realm.name}</span>
                                        {isActive && (
                                            <Check className={cn("h-3.5 w-3.5", COLOR_TEXT_MAP[realm.color])} />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* URL / Search Bar */}
            <form
                onSubmit={handleNavigate}
                className="flex-1 max-w-3xl mx-auto relative"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
                <div
                    className={cn(
                        "relative flex items-center h-9 rounded-xl",
                        "bg-surface-secondary border",
                        "transition-all duration-200",
                        isFocused
                            ? "border-brand ring-2 ring-brand/10 bg-white"
                            : "border-border/60 hover:border-border-strong",
                        showSuggestions && "rounded-b-none"
                    )}
                >
                    {/* Icon */}
                    <div className="flex items-center justify-center w-9 h-full shrink-0">
                        {activeTab?.isLoading ? (
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
                        value={isEditing ? inputValue : (activeTab?.url === 'poseidon://newtab' ? '' : getDomain(displayUrl))}
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
                    {/* AI Indicator */}
                    <div className="flex items-center gap-2 pr-3">
                        <div className="h-5 w-px bg-border" />
                        <button
                            type="button"
                            onClick={handleRunAgent}
                            disabled={isAIProcessing}
                            className={cn(
                                "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors",
                                isAIProcessing
                                    ? "bg-brand/10 text-brand cursor-wait"
                                    : "text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                            )}
                            title="Run AI Agent"
                        >
                            {isAIProcessing ? (
                                <Loader2 className="h-3.5 w-3.5 text-brand animate-spin" />
                            ) : (
                                <Sparkles className="h-3.5 w-3.5 text-brand" />
                            )}
                            <span className="hidden sm:inline">{isAIProcessing ? 'Running...' : 'AI'}</span>
                        </button>
                    </div>
                </div>

                {/* Autocomplete Suggestions Dropdown */}
                {showSuggestions && suggestions.length > 0 && (
                    <div
                        ref={suggestionsRef}
                        className="absolute z-[9999] w-full bg-white border border-t-0 border-border/60 rounded-b-xl shadow-lg overflow-hidden"
                    >
                        {suggestions.map((suggestion, index) => (
                            <button
                                key={`${suggestion.type}-${suggestion.url || suggestion.title}-${index}`}
                                type="button"
                                onMouseDown={(e) => {
                                    e.preventDefault(); // Prevent blur
                                    handleSelectSuggestion(suggestion);
                                }}
                                className={cn(
                                    "flex items-center gap-3 w-full px-3 py-2.5 text-left transition-colors",
                                    "hover:bg-surface-secondary",
                                    index === selectedIndex && "bg-surface-secondary"
                                )}
                            >
                                {/* Icon */}
                                <div className="flex items-center justify-center h-7 w-7 rounded-md bg-surface-tertiary shrink-0">
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
                                    <span className="text-[10px] text-brand bg-brand/10 px-1.5 py-0.5 rounded shrink-0">
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
