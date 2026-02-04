import React, { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';

interface TopBarProps {
    className?: string;
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

export function TopBar({ className }: TopBarProps) {
    const [activeTab, setActiveTab] = useState<ActiveTab | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [isFocused, setIsFocused] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [isAIProcessing, setIsAIProcessing] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Subscribe to active tab changes
    useEffect(() => {
        if (typeof window !== 'undefined' && window.electron?.tabs) {
            // Get initial active tab
            window.electron.tabs.getActive().then(tab => {
                setActiveTab(tab);
                // Don't show internal URLs in the search bar
                if (tab && !tab.url.startsWith('poseidon://')) {
                    setInputValue(tab.url);
                }
            });

            // Listen for active tab changes
            const unsubscribe = window.electron.tabs.onActiveTabChanged((tab) => {
                setActiveTab(tab);
                if (tab && !isEditing && !tab.url.startsWith('poseidon://')) {
                    setInputValue(tab.url);
                } else if (tab?.url.startsWith('poseidon://')) {
                    setInputValue('');
                }
            });

            // Listen for tab updates (loading state, title, etc.)
            const unsubscribeUpdate = window.electron.tabs.onTabUpdated((tab) => {
                if (activeTab && tab.id === activeTab.id) {
                    setActiveTab(prev => prev ? { ...prev, ...tab } : null);
                    if (!isEditing) {
                        setInputValue(tab.url);
                    }
                }
            });

            return () => {
                unsubscribe();
                unsubscribeUpdate();
            };
        }
    }, [isEditing]);

    const handleNavigate = (e: React.FormEvent) => {
        e.preventDefault();
        if (inputValue.trim() && window.electron?.navigation) {
            // Always perform a Google search from the top bar
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(inputValue.trim())}`;
            window.electron.navigation.navigate(searchUrl);
            setIsEditing(false);
            inputRef.current?.blur();
        }
    };

    const handleGoBack = () => {
        window.electron?.navigation.goBack();
    };

    const handleGoForward = () => {
        window.electron?.navigation.goForward();
    };

    const handleReload = () => {
        if (activeTab?.isLoading) {
            window.electron?.navigation.stop();
        } else {
            window.electron?.navigation.reload();
        }
    };

    const handleRunAgent = async () => {
        if (!inputValue.trim()) return;

        setIsAIProcessing(true);
        try {
            const response = await fetch('http://127.0.0.1:8000/agent/run', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ instruction: inputValue.trim() }),
            });
            const data = await response.json();
            console.log('Agent Result:', data);
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
    };

    const handleBlur = () => {
        setIsFocused(false);
        setIsEditing(false);
        // Reset to current URL if not submitted
        if (activeTab) {
            setInputValue(activeTab.url);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setIsEditing(false);
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
                "h-[52px] bg-surface border-b border-border/60 flex items-center gap-2 px-3",
                "select-none",
                className
            )}
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
            {/* Traffic Light Spacer (macOS) */}
            <div className="w-[68px] shrink-0" />

            {/* Navigation Buttons */}
            <div
                className="flex items-center gap-1"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
                <button
                    onClick={handleGoBack}
                    disabled={!activeTab?.canGoBack}
                    className={cn(
                        "btn-icon h-8 w-8",
                        !activeTab?.canGoBack && "opacity-30 cursor-not-allowed"
                    )}
                    title="Go back"
                >
                    <ArrowLeft className="h-4 w-4" />
                </button>
                <button
                    onClick={handleGoForward}
                    disabled={!activeTab?.canGoForward}
                    className={cn(
                        "btn-icon h-8 w-8",
                        !activeTab?.canGoForward && "opacity-30 cursor-not-allowed"
                    )}
                    title="Go forward"
                >
                    <ArrowRight className="h-4 w-4" />
                </button>
                <button
                    onClick={handleReload}
                    className="btn-icon h-8 w-8"
                    title={activeTab?.isLoading ? "Stop" : "Reload"}
                >
                    {activeTab?.isLoading ? (
                        <X className="h-4 w-4" />
                    ) : (
                        <RotateCw className="h-4 w-4" />
                    )}
                </button>
            </div>

            {/* URL / Search Bar */}
            <form
                onSubmit={handleNavigate}
                className="flex-1 max-w-3xl mx-auto"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
                <div
                    className={cn(
                        "relative flex items-center h-9 rounded-xl",
                        "bg-surface-secondary border",
                        "transition-all duration-200",
                        isFocused
                            ? "border-brand ring-2 ring-brand/10 bg-white"
                            : "border-border/60 hover:border-border-strong"
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
                        onChange={(e) => setInputValue(e.target.value)}
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
            </form>

            {/* Right Spacer */}
            <div className="w-20 shrink-0" />
        </header>
    );
}
