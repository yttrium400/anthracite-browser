import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import {
    Globe,
    Lock,
    ClockCounterClockwise,
    MagnifyingGlass,
    ArrowRight,
} from '@phosphor-icons/react';

interface NavigationOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    onNavigate: (url: string) => void;
    currentUrl?: string;
    mode: 'new-tab' | 'edit-url';
}

interface Suggestion {
    type: 'history' | 'search';
    url?: string;
    title: string;
    favicon?: string;
    visitCount?: number;
}

export function NavigationOverlay({
    isOpen,
    onClose,
    onNavigate,
    currentUrl,
    mode,
}: NavigationOverlayProps) {
    const [inputValue, setInputValue] = useState('');
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<NodeJS.Timeout>();

    // Reset state when overlay opens
    useEffect(() => {
        if (isOpen) {
            if (mode === 'edit-url' && currentUrl && !currentUrl.startsWith('anthracite://')) {
                setInputValue(currentUrl);
                // Select the text after a tick so the input is rendered
                setTimeout(() => inputRef.current?.select(), 50);
            } else {
                setInputValue('');
            }
            setSuggestions([]);
            setSelectedIndex(-1);
            setShowSuggestions(false);
            // Focus the input
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen, mode, currentUrl]);

    // Fetch suggestions (reused logic from old TopBar)
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

        // Fetch Google search suggestions via IPC
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
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => fetchSuggestions(value), 150);
    };

    const handleNavigate = () => {
        if (!inputValue.trim()) return;
        const input = inputValue.trim();
        setShowSuggestions(false);
        onNavigate(input);
        onClose();
    };

    const handleSelectSuggestion = (suggestion: Suggestion) => {
        setShowSuggestions(false);
        const target = suggestion.type === 'history' && suggestion.url
            ? suggestion.url
            : suggestion.title;
        setInputValue(target);
        onNavigate(target);
        onClose();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (showSuggestions && suggestions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1));
                return;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(prev => Math.max(prev - 1, -1));
                return;
            } else if (e.key === 'Enter' && selectedIndex >= 0) {
                e.preventDefault();
                handleSelectSuggestion(suggestions[selectedIndex]);
                return;
            }
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            handleNavigate();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    };

    // Clean up debounce on unmount
    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, []);

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        onClick={onClose}
                    />

                    {/* Overlay Container */}
                    <motion.div
                        className="fixed inset-0 z-[301] flex items-start justify-center pt-[18vh]"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        onClick={onClose}
                    >
                        <motion.div
                            className="w-full max-w-[640px] mx-4"
                            initial={{ opacity: 0, scale: 0.95, y: -10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -10 }}
                            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Search Card */}
                            <div className={cn(
                                "bg-[#1A1A1D] border border-white/[0.1] shadow-[0_20px_60px_rgba(0,0,0,0.6)]",
                                "overflow-hidden",
                                showSuggestions && suggestions.length > 0
                                    ? "rounded-2xl"
                                    : "rounded-2xl"
                            )}>
                                {/* Input Row */}
                                <div className="flex items-center gap-3 px-5 h-[56px]">
                                    {/* Icon */}
                                    <div className="shrink-0 text-text-tertiary">
                                        {mode === 'edit-url' && currentUrl?.startsWith('https://') ? (
                                            <Lock className="h-4.5 w-4.5 text-success" weight="bold" />
                                        ) : (
                                            <Globe className="h-4.5 w-4.5" />
                                        )}
                                    </div>

                                    {/* Input */}
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        value={inputValue}
                                        onChange={(e) => handleInputChange(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        placeholder={mode === 'new-tab' ? 'Search or enter URL...' : 'Edit address...'}
                                        className={cn(
                                            "flex-1 h-full bg-transparent text-[15px] font-medium",
                                            "text-text-primary placeholder:text-text-tertiary",
                                            "focus:outline-none"
                                        )}
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="off"
                                        spellCheck={false}
                                    />

                                    {/* Go button (shown when there's input) */}
                                    {inputValue.trim() && (
                                        <button
                                            type="button"
                                            onClick={handleNavigate}
                                            className="shrink-0 flex items-center justify-center h-8 w-8 rounded-lg bg-brand text-white hover:bg-brand-dark transition-colors active:scale-95"
                                        >
                                            <ArrowRight className="h-4 w-4" weight="bold" />
                                        </button>
                                    )}
                                </div>

                                {/* Suggestions */}
                                <AnimatePresence>
                                    {showSuggestions && suggestions.length > 0 && (
                                        <motion.div
                                            className="border-t border-white/[0.06]"
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            exit={{ opacity: 0, height: 0 }}
                                            transition={{ duration: 0.15, ease: 'easeOut' }}
                                        >
                                            <div className="py-1.5">
                                                {suggestions.map((suggestion, index) => (
                                                    <button
                                                        key={`${suggestion.type}-${suggestion.url || suggestion.title}-${index}`}
                                                        type="button"
                                                        onMouseDown={(e) => {
                                                            e.preventDefault();
                                                            handleSelectSuggestion(suggestion);
                                                        }}
                                                        onMouseEnter={() => setSelectedIndex(index)}
                                                        className={cn(
                                                            "flex items-center gap-3 w-full px-5 py-2.5 text-left transition-colors",
                                                            "hover:bg-white/[0.05]",
                                                            index === selectedIndex && "bg-white/[0.05]"
                                                        )}
                                                    >
                                                        {/* Icon */}
                                                        <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-white/[0.06] shrink-0">
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
                                                                <ClockCounterClockwise className="h-3.5 w-3.5 text-text-tertiary" />
                                                            ) : (
                                                                <MagnifyingGlass className="h-3.5 w-3.5 text-text-tertiary" />
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

                                                        {/* Badge */}
                                                        {suggestion.type === 'search' && (
                                                            <span className="text-[10px] text-brand bg-brand/10 px-1.5 py-0.5 rounded shrink-0">
                                                                Search
                                                            </span>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* Hint */}
                            <div className="flex items-center justify-center mt-3">
                                <div className="inline-flex items-center gap-3 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-sm">
                                    <div className="flex items-center gap-1 text-[11px] text-white/40">
                                        <kbd className="kbd text-[10px]">Enter</kbd>
                                        <span>to go</span>
                                    </div>
                                    <div className="flex items-center gap-1 text-[11px] text-white/40">
                                        <kbd className="kbd text-[10px]">Esc</kbd>
                                        <span>to close</span>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
