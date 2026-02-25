import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '../lib/utils';
import {
    ArrowLeft,
    ArrowRight,
    ArrowClockwise,
    X,
    Lock,
    LockOpen,
    Globe,
    CircleNotch,
    ClockCounterClockwise,
    MagnifyingGlass,
} from '@phosphor-icons/react';

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

    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [showSuggestions, setShowSuggestions] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<NodeJS.Timeout>();
    const activeTabIdRef = useRef<string | null>(null);
    const activeTabUrlRef = useRef<string>('');

    useEffect(() => {
        activeTabIdRef.current = activeTab?.id || null;
    }, [activeTab]);

    // Subscribe to active tab changes
    useEffect(() => {
        if (typeof window !== 'undefined' && window.electron?.tabs) {
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
                    } else {
                        setInputValue('');
                    }
                }
            });

            const unsubscribeUpdate = window.electron.tabs.onTabUpdated((tab) => {
                if (activeTabIdRef.current && tab.id === activeTabIdRef.current) {
                    const urlChanged = tab.url !== activeTabUrlRef.current;
                    setActiveTab(prev => prev ? { ...prev, ...tab } : null);
                    const isInternalUrl = tab.url.startsWith('anthracite://') || tab.url.startsWith('about:') || tab.url.startsWith('data:');
                    if (!isInternalUrl) {
                        if (urlChanged) activeTabUrlRef.current = tab.url;
                        setInputValue(prevInput => {
                            const focused = inputRef.current === document.activeElement;
                            if (urlChanged && !focused) {
                                clearDraft(tab.id);
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
    }, []);

    const fetchSuggestions = useCallback(async (query: string) => {
        if (!query || query.length < 1) {
            setSuggestions([]);
            setShowSuggestions(false);
            return;
        }

        const results: Suggestion[] = [];

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

        try {
            if (window.electron?.searchSuggestions) {
                const searchSuggestions = await window.electron.searchSuggestions(query);
                searchSuggestions.slice(0, 4).forEach((term: string) => {
                    if (!results.some(r => r.title.toLowerCase() === term.toLowerCase())) {
                        results.push({ type: 'search', title: term });
                    }
                });
            }
        } catch (err) {
            console.error('Failed to fetch search suggestions:', err);
        }

        if (document.activeElement === inputRef.current) {
            setSuggestions(results);
            setShowSuggestions(results.length > 0);
            setSelectedIndex(-1);
        }
    }, []);

    const handleInputChange = (value: string) => {
        setInputValue(value);
        if (activeTab?.id) saveDraft(activeTab.id, value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => fetchSuggestions(value), 300);
    };

    const handleNavigate = (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputValue.trim() || !window.electron?.navigation) return;
        setShowSuggestions(false);
        const input = inputValue.trim();
        if (activeTab?.id) clearDraft(activeTab.id);
        if (onNavigate) {
            onNavigate(input);
        } else {
            window.electron.navigation.navigate(input);
        }
        setIsEditing(false);
        inputRef.current?.blur();
    };

    const handleSelectSuggestion = (suggestion: Suggestion) => {
        setShowSuggestions(false);
        if (activeTab?.id) clearDraft(activeTab.id);
        const target = suggestion.type === 'history' && suggestion.url ? suggestion.url : suggestion.title;
        setInputValue(target);
        if (onNavigate) {
            onNavigate(target);
        } else {
            window.electron?.navigation.navigate(target);
        }
        setIsEditing(false);
        inputRef.current?.blur();
    };

    const handleFocus = () => {
        setIsFocused(true);
        setIsEditing(true);
        const isInternalPage = activeTab?.url.startsWith('anthracite://') || activeTab?.url.startsWith('about:');
        if (!isInternalPage && !inputValue) {
            setInputValue(activeTab?.url || '');
            setTimeout(() => inputRef.current?.select(), 0);
        }
        if (inputValue) fetchSuggestions(inputValue);
    };

    const handleBlur = () => {
        setTimeout(() => {
            setIsFocused(false);
            setIsEditing(false);
            setShowSuggestions(false);
        }, 200);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (showSuggestions && suggestions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
                return;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) => Math.max(prev - 1, -1));
                return;
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
            if (activeTab?.id) clearDraft(activeTab.id);
            setInputValue(activeTab?.url || '');
            inputRef.current?.blur();
        }
    };

    const isSecure = activeTab?.url.startsWith('https://');

    const getDomain = (url: string) => {
        try { return new URL(url).hostname; } catch { return url; }
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
            {/* Traffic Light Spacer */}
            <div className={cn(
                "shrink-0 transition-all duration-300 ease-ios",
                isSidebarPinned ? "w-[300px]" : "w-[68px]"
            )} />

            {/* URL / Search Bar */}
            <form
                onSubmit={handleNavigate}
                className="flex-1 max-w-3xl mx-auto relative"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
                <div className={cn(
                    "relative flex items-center h-9 rounded-xl",
                    "bg-white/[0.05] border transition-all duration-200",
                    isFocused
                        ? "border-brand/40 ring-1 ring-brand/30 bg-white/[0.08]"
                        : "border-white/[0.08] hover:border-white/[0.12]",
                    showSuggestions && "rounded-b-none"
                )}>
                    {/* Security Icon */}
                    <div className="flex items-center justify-center w-9 h-full shrink-0">
                        {isLoading ? (
                            <CircleNotch className="h-4 w-4 text-brand animate-spin" />
                        ) : isSecure ? (
                            <Lock className="h-3.5 w-3.5 text-success" />
                        ) : activeTab?.url && !activeTab.url.startsWith('about:') ? (
                            <LockOpen className="h-3.5 w-3.5 text-text-tertiary" />
                        ) : (
                            <Globe className="h-4 w-4 text-text-tertiary" />
                        )}
                    </div>

                    {/* Input */}
                    <input
                        ref={inputRef}
                        type="text"
                        value={
                            isEditing || (inputValue !== '' && inputValue !== (activeTab?.url || ''))
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
                            "focus:outline-none pr-3",
                            !isEditing && "text-text-secondary"
                        )}
                    />

                    {/* Navigation Controls */}
                    <div
                        className="flex items-center gap-1 pr-2 text-text-secondary"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    >
                        <button type="button" onClick={onBack} disabled={!canGoBack}
                            className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent active:scale-90">
                            <ArrowLeft size={16} />
                        </button>
                        <button type="button" onClick={onForward} disabled={!canGoForward}
                            className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent active:scale-90">
                            <ArrowRight size={16} />
                        </button>
                        <button type="button" onClick={onReload}
                            className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors active:scale-90">
                            {isLoading ? <X size={16} /> : <ArrowClockwise size={16} />}
                        </button>
                    </div>
                </div>

                {/* Autocomplete Suggestions */}
                {showSuggestions && suggestions.length > 0 && (
                    <div
                        ref={suggestionsRef}
                        className="absolute z-[9999] w-full bg-[#1A1A1D]/97 backdrop-blur-xl border border-t-0 border-white/[0.08] rounded-b-xl shadow-large overflow-hidden"
                    >
                        {suggestions.map((suggestion, index) => (
                            <button
                                key={`${suggestion.type}-${suggestion.url || suggestion.title}-${index}`}
                                type="button"
                                onMouseDown={(e) => { e.preventDefault(); handleSelectSuggestion(suggestion); }}
                                className={cn(
                                    "flex items-center gap-3 w-full px-3 py-2.5 text-left transition-colors",
                                    "hover:bg-white/[0.05]",
                                    index === selectedIndex && "bg-white/[0.05]"
                                )}
                            >
                                <div className="flex items-center justify-center h-7 w-7 rounded-md bg-white/[0.06] shrink-0">
                                    {suggestion.type === 'history' && suggestion.favicon ? (
                                        <img src={suggestion.favicon} alt="" className="h-4 w-4 rounded"
                                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                    ) : suggestion.type === 'history' ? (
                                        <ClockCounterClockwise className="h-3.5 w-3.5 text-text-tertiary" />
                                    ) : (
                                        <MagnifyingGlass className="h-3.5 w-3.5 text-text-tertiary" />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm text-text-primary truncate">{suggestion.title}</div>
                                    {suggestion.type === 'history' && suggestion.url && (
                                        <div className="text-xs text-text-tertiary truncate">{suggestion.url}</div>
                                    )}
                                </div>
                                {suggestion.type === 'search' && (
                                    <span className="text-[10px] text-brand bg-brand/10 px-1.5 py-0.5 rounded shrink-0">Search</span>
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
