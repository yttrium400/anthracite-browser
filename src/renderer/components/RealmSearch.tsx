import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '../lib/utils';
import { MagnifyingGlass, Globe, X, CircleNotch } from '@phosphor-icons/react';
import { getIconComponent } from './IconPicker';
import type { Realm, Dock as DockType, ThemeColor } from '../../shared/types';

// Color mappings
const COLOR_BG_MAP: Record<ThemeColor, string> = {
    blue: 'bg-blue-500/15',
    purple: 'bg-purple-500/15',
    pink: 'bg-pink-500/15',
    red: 'bg-red-500/15',
    orange: 'bg-orange-500/15',
    yellow: 'bg-yellow-500/15',
    green: 'bg-green-500/15',
    teal: 'bg-teal-500/15',
    cyan: 'bg-cyan-500/15',
    gray: 'bg-gray-500/15',
};

const COLOR_TEXT_MAP: Record<ThemeColor, string> = {
    blue: 'text-blue-400',
    purple: 'text-purple-400',
    pink: 'text-pink-400',
    red: 'text-red-400',
    orange: 'text-orange-400',
    yellow: 'text-yellow-400',
    green: 'text-green-400',
    teal: 'text-teal-400',
    cyan: 'text-cyan-400',
    gray: 'text-gray-400',
};

interface Tab {
    id: string;
    title: string;
    url: string;
    favicon: string;
    isLoading: boolean;
    realmId?: string;
    dockId?: string | null;
}

interface SearchResult extends Tab {
    realm?: Realm;
    dock?: DockType;
    score: number;
}

interface RealmSearchProps {
    isOpen: boolean;
    onClose: () => void;
}

export function RealmSearch({ isOpen, onClose }: RealmSearchProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [realms, setRealms] = useState<Realm[]>([]);
    const [docks, setDocks] = useState<DockType[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Load data when modal opens
    useEffect(() => {
        if (!isOpen) return;

        const loadData = async () => {
            setIsLoading(true);
            try {
                const state = await window.electron?.sidebarState.get();
                if (state) {
                    setRealms(state.realms);
                    setDocks(state.docks);
                    setTabs(state.tabs);
                }
            } catch (err) {
                console.error('Failed to load search data:', err);
            }
            setIsLoading(false);
        };

        loadData();
        setQuery('');
        setResults([]);
        setSelectedIndex(0);

        // Focus input after a short delay
        setTimeout(() => inputRef.current?.focus(), 50);
    }, [isOpen]);

    // Fuzzy search function
    const fuzzyMatch = useCallback((text: string, pattern: string): number => {
        if (!pattern) return 1;
        if (!text) return 0;

        const textLower = text.toLowerCase();
        const patternLower = pattern.toLowerCase();

        // Exact match
        if (textLower === patternLower) return 100;

        // Starts with
        if (textLower.startsWith(patternLower)) return 80;

        // Contains
        if (textLower.includes(patternLower)) return 60;

        // Fuzzy match - check if all characters exist in order
        let patternIdx = 0;
        let score = 0;
        for (let i = 0; i < textLower.length && patternIdx < patternLower.length; i++) {
            if (textLower[i] === patternLower[patternIdx]) {
                score += 1;
                patternIdx++;
            }
        }

        if (patternIdx === patternLower.length) {
            return Math.min(40, score * 5);
        }

        return 0;
    }, []);

    // Search tabs when query changes
    useEffect(() => {
        if (!query.trim()) {
            // Show all tabs sorted by realm when no query
            const allResults: SearchResult[] = tabs.map(tab => {
                const realm = realms.find(r => r.id === tab.realmId);
                const dock = docks.find(d => d.id === tab.dockId);
                return { ...tab, realm, dock, score: 1 };
            });
            setResults(allResults.slice(0, 10));
            setSelectedIndex(0);
            return;
        }

        const searchResults: SearchResult[] = [];

        tabs.forEach(tab => {
            const titleScore = fuzzyMatch(tab.title, query);
            const urlScore = fuzzyMatch(tab.url, query);
            const score = Math.max(titleScore, urlScore * 0.8);

            if (score > 0) {
                const realm = realms.find(r => r.id === tab.realmId);
                const dock = docks.find(d => d.id === tab.dockId);
                searchResults.push({ ...tab, realm, dock, score });
            }
        });

        // Sort by score descending
        searchResults.sort((a, b) => b.score - a.score);

        setResults(searchResults.slice(0, 10));
        setSelectedIndex(0);
    }, [query, tabs, realms, docks, fuzzyMatch]);

    // Handle keyboard navigation
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter' && results.length > 0) {
            e.preventDefault();
            handleSelectTab(results[selectedIndex]);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    }, [results, selectedIndex, onClose]);

    // Scroll selected item into view
    useEffect(() => {
        if (listRef.current && results.length > 0) {
            const selectedEl = listRef.current.children[selectedIndex] as HTMLElement;
            if (selectedEl) {
                selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }, [selectedIndex, results.length]);

    // Handle tab selection
    const handleSelectTab = useCallback(async (tab: SearchResult) => {
        // Switch to the tab's realm if different
        if (tab.realmId) {
            await window.electron?.realms.setActive(tab.realmId);
        }
        // Switch to the tab
        await window.electron?.tabs.switch(tab.id);
        onClose();
    }, [onClose]);

    // Get favicon URL
    const getFaviconUrl = (tab: Tab) => {
        if (tab.favicon) return tab.favicon;
        try {
            const url = new URL(tab.url);
            return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
        } catch {
            return null;
        }
    };

    // Build breadcrumb for result
    const getBreadcrumb = (result: SearchResult) => {
        const parts: string[] = [];
        if (result.realm) {
            parts.push(result.realm.name);
        }
        if (result.dock) {
            parts.push(result.dock.name);
        }
        return parts.join(' › ');
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] animate-in fade-in duration-150"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="fixed inset-0 z-[201] flex items-start justify-center pt-[15vh]">
                <div
                    className={cn(
                        "w-full max-w-xl mx-4",
                        "bg-[#1A1A1D]/95 backdrop-blur-xl rounded-2xl",
                        "border border-white/[0.08] shadow-2xl",
                        "overflow-hidden",
                        "animate-in fade-in zoom-in-95 duration-150"
                    )}
                >
                    {/* Search Input */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
                        <MagnifyingGlass className="h-5 w-5 text-text-tertiary shrink-0" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Search tabs across all realms..."
                            className={cn(
                                "flex-1 bg-transparent text-base",
                                "text-text-primary placeholder:text-text-tertiary",
                                "focus:outline-none"
                            )}
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                        />
                        <div className="flex items-center gap-2">
                            <kbd className="kbd text-[10px]">ESC</kbd>
                        </div>
                    </div>

                    {/* Results List */}
                    <div
                        ref={listRef}
                        className="max-h-[400px] overflow-y-auto thin-scrollbar"
                    >
                        {isLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <CircleNotch className="h-6 w-6 text-brand animate-spin" />
                            </div>
                        ) : results.length === 0 ? (
                            <div className="px-4 py-8 text-center text-text-tertiary">
                                {query ? 'No tabs found' : 'No open tabs'}
                            </div>
                        ) : (
                            results.map((result, index) => (
                                <button
                                    key={result.id}
                                    onClick={() => handleSelectTab(result)}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                    className={cn(
                                        "flex items-center gap-3 w-full px-4 py-3 text-left",
                                        "transition-colors duration-100",
                                        index === selectedIndex
                                            ? "bg-brand/10 border-l-2 border-brand"
                                            : "hover:bg-white/[0.06] border-l-2 border-transparent"
                                    )}
                                >
                                    {/* Favicon */}
                                    <div className="h-8 w-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0 overflow-hidden">
                                        {result.isLoading ? (
                                            <CircleNotch className="h-4 w-4 text-brand animate-spin" />
                                        ) : getFaviconUrl(result) ? (
                                            <img
                                                src={getFaviconUrl(result)!}
                                                alt=""
                                                className="h-5 w-5 object-contain"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                            />
                                        ) : (
                                            <Globe className="h-4 w-4 text-text-tertiary" />
                                        )}
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-text-primary truncate">
                                            {result.title || 'New Tab'}
                                        </div>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            {/* Breadcrumb */}
                                            {result.realm && (
                                                <span className={cn(
                                                    "text-[10px] font-medium px-1.5 py-0.5 rounded",
                                                    COLOR_BG_MAP[result.realm.color],
                                                    COLOR_TEXT_MAP[result.realm.color]
                                                )}>
                                                    {getBreadcrumb(result)}
                                                </span>
                                            )}
                                            <span className="text-xs text-text-tertiary truncate">
                                                {result.url}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Realm Icon */}
                                    {result.realm && (
                                        <div className={cn(
                                            "h-6 w-6 rounded-md flex items-center justify-center shrink-0",
                                            COLOR_BG_MAP[result.realm.color]
                                        )}>
                                            {(() => {
                                                const RealmIcon = getIconComponent(result.realm.icon);
                                                return <RealmIcon className={cn("h-3.5 w-3.5", COLOR_TEXT_MAP[result.realm.color])} />;
                                            })()}
                                        </div>
                                    )}
                                </button>
                            ))
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between px-4 py-2 border-t border-white/[0.06] bg-white/[0.02]">
                        <div className="flex items-center gap-3 text-xs text-text-tertiary">
                            <span className="flex items-center gap-1">
                                <kbd className="kbd text-[9px]">↑</kbd>
                                <kbd className="kbd text-[9px]">↓</kbd>
                                navigate
                            </span>
                            <span className="flex items-center gap-1">
                                <kbd className="kbd text-[9px]">↵</kbd>
                                select
                            </span>
                        </div>
                        <span className="text-xs text-text-tertiary">
                            {results.length} {results.length === 1 ? 'tab' : 'tabs'}
                        </span>
                    </div>
                </div>
            </div>
        </>
    );
}
