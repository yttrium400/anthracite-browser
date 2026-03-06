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
    Sparkle,
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
    onEditUrl?: () => void;
    onToggleAgentPanel?: () => void;
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
    onEditUrl,
    onToggleAgentPanel
}: TopBarProps) {
    const [activeTab, setActiveTab] = useState<ActiveTab | null>(null);

    // Subscribe to active tab changes
    useEffect(() => {
        if (typeof window !== 'undefined' && window.electron?.tabs) {
            window.electron.tabs.getActive().then(tab => {
                setActiveTab(tab);
            });

            const unsubscribe = window.electron.tabs.onActiveTabChanged((tab) => {
                setActiveTab(tab);
            });

            const unsubscribeUpdate = window.electron.tabs.onTabUpdated((tab) => {
                if (activeTab && tab.id === activeTab.id) {
                    setActiveTab(prev => prev ? { ...prev, ...tab } : null);
                }
            });

            return () => {
                unsubscribe();
                unsubscribeUpdate();
            };
        }
    }, []);

    // Update active tab when onTabUpdated fires
    const activeTabIdRef = useRef<string | null>(null);
    useEffect(() => {
        activeTabIdRef.current = activeTab?.id || null;
    }, [activeTab]);

    useEffect(() => {
        if (typeof window !== 'undefined' && window.electron?.tabs) {
            const unsubscribeUpdate = window.electron.tabs.onTabUpdated((tab) => {
                if (activeTabIdRef.current && tab.id === activeTabIdRef.current) {
                    setActiveTab(prev => prev ? { ...prev, ...tab } : null);
                }
            });
            return () => unsubscribeUpdate();
        }
    }, []);

    const isSecure = activeTab?.url.startsWith('https://');
    const isInternalPage = activeTab?.url?.startsWith('anthracite://') || activeTab?.url?.startsWith('about:');

    const getDomain = (url: string) => {
        try { return new URL(url).hostname; } catch { return url; }
    };

    const displayDomain = activeTab?.url && !isInternalPage
        ? getDomain(activeTab.url)
        : '';

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

            {/* Navigation Controls */}
            <div
                className="flex items-center gap-1 text-text-secondary"
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

            {/* Clickable Site Info — opens navigation overlay */}
            {displayDomain && (
                <button
                    type="button"
                    onClick={onEditUrl}
                    className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-lg mx-auto",
                        "text-[13px] text-text-secondary font-medium",
                        "hover:bg-white/[0.06] hover:text-text-primary transition-colors",
                        "active:scale-[0.98]"
                    )}
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    title={activeTab?.url}
                >
                    {isLoading ? (
                        <CircleNotch className="h-3.5 w-3.5 text-brand animate-spin" />
                    ) : isSecure ? (
                        <Lock className="h-3.5 w-3.5 text-success" />
                    ) : (
                        <LockOpen className="h-3.5 w-3.5 text-text-tertiary" />
                    )}
                    <span className="truncate max-w-[300px]">{displayDomain}</span>
                </button>
            )}

            {/* When no domain, push agent toggle to the right */}
            {!displayDomain && <div className="flex-1" />}

            {/* Right Actions */}
            <div className="flex items-center justify-end px-3 shrink-0 h-full ml-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                <button
                    type="button"
                    onClick={onToggleAgentPanel}
                    className="p-1.5 hover:bg-white/[0.08] text-text-tertiary hover:text-text-primary rounded-lg transition-colors active:scale-95"
                    title="Toggle Agent Panel"
                >
                    <Sparkle weight="fill" size={18} className="text-brand" />
                </button>
            </div>
        </header>
    );
}
