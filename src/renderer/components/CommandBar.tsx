import React, { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '../lib/utils';
import {
    ArrowRight,
    StopCircle,
    Loader2,
    Mic,
    Paperclip,
    ChevronDown,
    Globe,
    History,
    Search,
} from 'lucide-react';

interface ModelOption {
    id: string;
    name: string;
    provider: 'anthropic' | 'openai' | 'google' | 'ollama';
}

const ANTHROPIC_MODELS: ModelOption[] = [
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic' },
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic' },
];
const OPENAI_MODELS: ModelOption[] = [
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
    { id: 'gpt-4o-mini', name: 'GPT-4o mini', provider: 'openai' },
];
const GOOGLE_MODELS: ModelOption[] = [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'google' },
];

interface CommandBarProps {
    onRun: (instruction: string) => void;
    isRunning: boolean;
    status?: 'idle' | 'thinking' | 'running' | 'done' | 'error';
}

interface Suggestion {
    type: 'history' | 'search';
    url?: string;
    title: string;
    favicon?: string;
    visitCount?: number;
}

const placeholders = [
    "Search the web for latest AI news...",
    "Book a flight to San Francisco...",
    "Find and summarize this research paper...",
    "Compare prices for iPhone 16 Pro...",
    "Help me fill out this form...",
];

export function CommandBar({ onRun, isRunning, status = 'idle' }: CommandBarProps) {
    const [input, setInput] = useState('');
    const [isFocused, setIsFocused] = useState(false);
    const [placeholderIndex, setPlaceholderIndex] = useState(0);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
    const [selectedModel, setSelectedModel] = useState<ModelOption | null>(null);
    const [showModelMenu, setShowModelMenu] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);
    const modelMenuRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<NodeJS.Timeout>();

    // Load available models from settings + probe Ollama
    useEffect(() => {
        const load = async () => {
            const settings = await window.electron?.settings.getAll().catch(() => null);
            const models: ModelOption[] = [];
            if (settings?.anthropicApiKey) models.push(...ANTHROPIC_MODELS);
            if (settings?.openaiApiKey) models.push(...OPENAI_MODELS);
            if (settings?.googleApiKey) models.push(...GOOGLE_MODELS);

            // Probe Ollama
            try {
                const res = await fetch('http://127.0.0.1:8000/ollama/models');
                const data = await res.json();
                if (data.available && data.models?.length) {
                    data.models.forEach((name: string) =>
                        models.push({ id: name, name, provider: 'ollama' })
                    );
                }
            } catch { /* Ollama not running */ }

            setAvailableModels(models);

            // Restore persisted selection or pick smart default
            const savedId = settings?.selectedModel;
            const match = models.find(m => m.id === savedId);
            if (match) {
                setSelectedModel(match);
            } else if (models.length > 0) {
                setSelectedModel(models[0]);
            }
        };
        load();
    }, []);

    // Close model menu on outside click
    useEffect(() => {
        if (!showModelMenu) return;
        const handler = (e: MouseEvent) => {
            if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
                setShowModelMenu(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showModelMenu]);

    const handleSelectModel = useCallback(async (model: ModelOption) => {
        setSelectedModel(model);
        setShowModelMenu(false);
        await window.electron?.settings.set('selectedModel', model.id).catch(() => null);
    }, []);

    // Rotate placeholders
    useEffect(() => {
        const interval = setInterval(() => {
            setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
        }, 4000);
        return () => clearInterval(interval);
    }, []);

    // Auto-resize textarea
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
        }
    }, [input]);

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

                // Add up to 3 search suggestions
                searchSuggestions.slice(0, 3).forEach((term: string) => {
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

        setSuggestions(results);
        setShowSuggestions(results.length > 0);
        setSelectedIndex(-1);
    }, []);

    // Debounced input handler
    const handleInputChange = (value: string) => {
        setInput(value);

        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        debounceRef.current = setTimeout(() => {
            fetchSuggestions(value);
        }, 150);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (input.trim() && !isRunning) {
            setShowSuggestions(false);
            onRun(input);
        }
    };

    const handleSelectSuggestion = (suggestion: Suggestion) => {
        if (suggestion.type === 'history' && suggestion.url) {
            // Navigate directly to URL from history
            setInput(suggestion.url);
            setShowSuggestions(false);
            onRun(suggestion.url);
        } else {
            // Search suggestion - always perform Google search
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(suggestion.title)}`;
            setInput(suggestion.title);
            setShowSuggestions(false);
            onRun(searchUrl);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (showSuggestions && suggestions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) => Math.max(prev - 1, -1));
            } else if (e.key === 'Enter' && !e.shiftKey && selectedIndex >= 0) {
                e.preventDefault();
                handleSelectSuggestion(suggestions[selectedIndex]);
                return;
            } else if (e.key === 'Escape') {
                setShowSuggestions(false);
                setSelectedIndex(-1);
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    const handleBlur = () => {
        // Delay hiding suggestions to allow clicking on them
        setTimeout(() => {
            setIsFocused(false);
            setShowSuggestions(false);
        }, 200);
    };

    const getStatusConfig = () => {
        switch (status) {
            case 'thinking':
                return {
                    text: 'Thinking...',
                    color: 'text-brand',
                    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
                    dot: 'status-running',
                };
            case 'running':
                return {
                    text: 'Browsing the web...',
                    color: 'text-accent-blue',
                    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
                    dot: 'status-running',
                };
            case 'done':
                return {
                    text: 'Task completed',
                    color: 'text-success',
                    icon: null,
                    dot: 'status-ready',
                };
            case 'error':
                return {
                    text: 'Something went wrong',
                    color: 'text-error',
                    icon: null,
                    dot: 'status-error',
                };
            default:
                return {
                    text: 'Ready',
                    color: 'text-text-tertiary',
                    icon: null,
                    dot: 'status-ready',
                };
        }
    };

    const statusConfig = getStatusConfig();

    return (
        <div className="w-full max-w-2xl mx-auto">
            {/* Main Command Bar */}
            <form onSubmit={handleSubmit} className="relative">
                {/* Glow Effect */}
                <div
                    className={cn(
                        "absolute -inset-1 rounded-3xl transition-all duration-500",
                        isFocused
                            ? "bg-gradient-to-r from-brand/15 via-accent-violet/15 to-brand/15 blur-xl opacity-100"
                            : "opacity-0"
                    )}
                />

                {/* Card Container */}
                <div
                    className={cn(
                        "relative bg-white/[0.04] backdrop-blur-2xl rounded-2xl border border-white/[0.08] overflow-hidden transition-all duration-300",
                        isFocused ? "shadow-large ring-1 ring-brand/20 border-brand/30" : "shadow-medium",
                        isRunning && "ring-1 ring-brand/30",
                        showSuggestions && "rounded-b-none"
                    )}
                >
                    {/* Top Section - Input */}
                    <div className="flex items-start gap-3 p-4 pb-3">
                        {/* Input Field */}
                        <div className="flex-1 min-w-0">
                            <textarea
                                ref={inputRef}
                                value={input}
                                onChange={(e) => handleInputChange(e.target.value)}
                                onFocus={() => {
                                    setIsFocused(true);
                                    if (suggestions.length > 0) setShowSuggestions(true);
                                }}
                                onBlur={handleBlur}
                                onKeyDown={handleKeyDown}
                                placeholder={placeholders[placeholderIndex]}
                                disabled={isRunning}
                                rows={1}
                                className={cn(
                                    "w-full bg-transparent resize-none",
                                    "text-lg font-medium text-text-primary",
                                    "placeholder:text-text-tertiary placeholder:transition-opacity placeholder:duration-300",
                                    "focus:outline-none",
                                    "disabled:opacity-60 disabled:cursor-not-allowed",
                                    "leading-relaxed pt-2"
                                )}
                            />
                        </div>
                    </div>

                    {/* Bottom Section - Actions */}
                    <div className="flex items-center justify-between px-4 py-3 bg-white/[0.02] border-t border-white/[0.06]">
                        {/* Left Actions */}
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                className="btn-icon h-8 w-8"
                                title="Attach file"
                            >
                                <Paperclip className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                className="btn-icon h-8 w-8"
                                title="Voice input"
                            >
                                <Mic className="h-4 w-4" />
                            </button>
                            <div className="h-5 w-px bg-white/[0.08] mx-1" />
                            {/* Model selector */}
                            <div className="relative" ref={modelMenuRef}>
                                <button
                                    type="button"
                                    onClick={() => availableModels.length > 0 && setShowModelMenu(v => !v)}
                                    className={cn(
                                        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
                                        availableModels.length > 0
                                            ? "text-text-secondary hover:bg-white/[0.06]"
                                            : "text-text-tertiary cursor-default"
                                    )}
                                    title={availableModels.length === 0 ? "Add an API key in Settings to enable the AI agent" : undefined}
                                >
                                    <span>{selectedModel?.name ?? 'No model'}</span>
                                    {availableModels.length > 0 && <ChevronDown className="h-3 w-3" />}
                                </button>

                                {showModelMenu && (
                                    <div className="absolute bottom-full mb-2 left-0 z-50 w-52 rounded-xl border border-white/[0.1] bg-[#1A1A1D]/95 backdrop-blur-xl shadow-large py-1 overflow-hidden">
                                        {(['anthropic', 'openai', 'google', 'ollama'] as const).map(provider => {
                                            const group = availableModels.filter(m => m.provider === provider);
                                            if (!group.length) return null;
                                            const labels = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google AI', ollama: 'Ollama (local)' };
                                            return (
                                                <div key={provider}>
                                                    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">
                                                        {labels[provider]}
                                                    </div>
                                                    {group.map(model => (
                                                        <button
                                                            key={model.id}
                                                            type="button"
                                                            onClick={() => handleSelectModel(model)}
                                                            className={cn(
                                                                "w-full text-left px-3 py-2 text-xs transition-colors",
                                                                selectedModel?.id === model.id
                                                                    ? "text-brand-light bg-brand/10"
                                                                    : "text-text-secondary hover:bg-white/[0.06] hover:text-text-primary"
                                                            )}
                                                        >
                                                            {model.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Right Actions */}
                        <div className="flex items-center gap-2">
                            {/* Status Indicator */}
                            <div className="flex items-center gap-2 mr-2">
                                <div className={cn("status-dot", statusConfig.dot)} />
                                <span className={cn("text-xs font-medium", statusConfig.color)}>
                                    {statusConfig.icon}
                                    {!statusConfig.icon && statusConfig.text}
                                </span>
                            </div>

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={!input.trim() || isRunning}
                                className={cn(
                                    "flex items-center justify-center gap-2 h-9 rounded-xl font-semibold text-sm transition-all duration-200",
                                    "disabled:opacity-40 disabled:cursor-not-allowed",
                                    isRunning
                                        ? "bg-error/15 text-error hover:bg-error/25 px-4"
                                        : "bg-brand text-white hover:bg-brand-dark hover:shadow-glow active:scale-[0.98] px-4",
                                    !input.trim() && !isRunning && "bg-white/[0.06] text-text-tertiary hover:bg-white/[0.06]"
                                )}
                            >
                                {isRunning ? (
                                    <>
                                        <StopCircle className="h-4 w-4" />
                                        <span>Stop</span>
                                    </>
                                ) : (
                                    <>
                                        <span>Run</span>
                                        <ArrowRight className="h-4 w-4" />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Autocomplete Suggestions Dropdown */}
                {showSuggestions && suggestions.length > 0 && (
                    <div
                        ref={suggestionsRef}
                        className="absolute z-50 w-full bg-[#1A1A1D]/95 backdrop-blur-xl border border-t-0 border-white/[0.08] rounded-b-2xl shadow-large overflow-hidden"
                    >
                        {suggestions.map((suggestion, index) => (
                            <button
                                key={`${suggestion.type}-${suggestion.url || suggestion.title}`}
                                type="button"
                                onClick={() => handleSelectSuggestion(suggestion)}
                                className={cn(
                                    "flex items-center gap-3 w-full px-4 py-3 text-left transition-colors",
                                    "hover:bg-white/[0.06]",
                                    index === selectedIndex && "bg-white/[0.06]"
                                )}
                            >
                                {/* Icon */}
                                <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-white/[0.06] shrink-0">
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
                                        <History className="h-4 w-4 text-text-tertiary" />
                                    ) : (
                                        <Search className="h-4 w-4 text-text-tertiary" />
                                    )}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-text-primary truncate">
                                        {suggestion.title}
                                    </div>
                                    {suggestion.type === 'history' && suggestion.url && (
                                        <div className="text-xs text-text-tertiary truncate">
                                            {suggestion.url}
                                        </div>
                                    )}
                                </div>

                                {/* Badge */}
                                {suggestion.type === 'history' && suggestion.visitCount && suggestion.visitCount > 1 && (
                                    <span className="text-[10px] text-text-tertiary bg-white/[0.06] px-1.5 py-0.5 rounded">
                                        {suggestion.visitCount} visits
                                    </span>
                                )}
                                {suggestion.type === 'search' && (
                                    <span className="text-[10px] text-brand bg-brand/10 px-1.5 py-0.5 rounded">
                                        Search
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                )}
            </form>

            {/* Hints */}
            <div className="flex items-center justify-center gap-4 mt-4">
                <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                    <kbd className="kbd">Enter</kbd>
                    <span>to run</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                    <kbd className="kbd">Shift</kbd>
                    <span>+</span>
                    <kbd className="kbd">Enter</kbd>
                    <span>for new line</span>
                </div>
            </div>
        </div>
    );
}

