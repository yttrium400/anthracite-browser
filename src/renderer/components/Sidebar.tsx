import React, { useState, useEffect, useRef } from 'react';
import { cn } from '../lib/utils';
import {
    Settings,
    Plus,
    Search,
    Globe,
    MoreHorizontal,
    Zap,
    Pin,
    PinOff,
    Shield,
    ShieldOff,
    ShieldCheck,
    X,
    Loader2,
} from 'lucide-react';

interface SidebarProps {
    className?: string;
}

interface Tab {
    id: string;
    title: string;
    url: string;
    favicon: string;
    isLoading: boolean;
}

export function Sidebar({ className }: SidebarProps) {
    const [isVisible, setIsVisible] = useState(false);
    const [isPinned, setIsPinned] = useState(false);
    const [adBlockEnabled, setAdBlockEnabled] = useState(true);
    const [blockedCount, setBlockedCount] = useState(0);
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    const sidebarRef = useRef<HTMLDivElement>(null);

    // Initialize and subscribe to updates
    useEffect(() => {
        if (typeof window !== 'undefined' && window.electron) {
            // Get initial tabs
            window.electron.tabs.getAll().then(setTabs);
            window.electron.tabs.getActive().then(tab => {
                if (tab) setActiveTabId(tab.id);
            });

            // Subscribe to tab updates
            const unsubscribeTabs = window.electron.tabs.onTabsUpdated(setTabs);
            const unsubscribeActive = window.electron.tabs.onActiveTabChanged(tab => {
                if (tab) setActiveTabId(tab.id);
            });

            // Ad-block status
            window.electron.adBlock.getStatus().then(status => {
                setAdBlockEnabled(status.enabled);
                setBlockedCount(status.count);
            });

            const unsubscribeBlocked = window.electron.adBlock.onBlocked(data => {
                setBlockedCount(data.count);
            });

            const unsubscribeAdStatus = window.electron.adBlock.onStatusChange(data => {
                setAdBlockEnabled(data.enabled);
                setBlockedCount(data.count);
            });

            return () => {
                unsubscribeTabs();
                unsubscribeActive();
                unsubscribeBlocked();
                unsubscribeAdStatus();
            };
        }
    }, []);

    const handleMouseEnter = () => setIsVisible(true);
    const handleMouseLeave = () => {
        if (!isPinned) setIsVisible(false);
    };

    // Keyboard shortcut (Cmd/Ctrl + \)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
                e.preventDefault();
                setIsPinned(prev => !prev);
                setIsVisible(prev => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleCreateTab = () => {
        window.electron?.tabs.create();
    };

    const handleSwitchTab = (tabId: string) => {
        window.electron?.tabs.switch(tabId);
    };

    const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
        e.stopPropagation();
        window.electron?.tabs.close(tabId);
    };

    const handleToggleAdBlock = async () => {
        if (window.electron?.adBlock) {
            const result = await window.electron.adBlock.toggle(!adBlockEnabled);
            setAdBlockEnabled(result.enabled);
        }
    };

    const getFaviconUrl = (tab: Tab) => {
        if (tab.favicon) return tab.favicon;
        try {
            const url = new URL(tab.url);
            return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
        } catch {
            return null;
        }
    };

    return (
        <>
            {/* Hover Trigger Zone */}
            <div
                className="fixed left-0 top-0 w-4 h-full z-[100]"
                onMouseEnter={handleMouseEnter}
            />

            {/* Backdrop */}
            <div
                className={cn(
                    "fixed inset-0 bg-black/5 backdrop-blur-[1px] z-40 transition-opacity duration-300",
                    isVisible && !isPinned ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
                onClick={() => !isPinned && setIsVisible(false)}
            />

            {/* Floating Sidebar */}
            <aside
                ref={sidebarRef}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                className={cn(
                    "fixed left-3 top-3 bottom-3 w-[280px] z-50",
                    "bg-white/95 backdrop-blur-2xl",
                    "rounded-2xl border border-border/60",
                    "shadow-large",
                    "flex flex-col",
                    "transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                    isVisible
                        ? "translate-x-0 opacity-100"
                        : "-translate-x-[calc(100%+20px)] opacity-0",
                    className
                )}
            >
                {/* Header */}
                <header className="flex items-center justify-between h-14 px-4 border-b border-border/40">
                    <div className="flex items-center gap-2.5">
                        <div className="relative group">
                            <div className="absolute inset-0 bg-gradient-to-br from-brand to-accent-violet rounded-xl blur-lg opacity-40 group-hover:opacity-60 transition-opacity" />
                            <div className="relative flex items-center justify-center h-8 w-8 rounded-xl bg-gradient-to-br from-brand to-accent-violet shadow-lg">
                                <Zap className="h-4 w-4 text-white" />
                            </div>
                        </div>
                        <div className="flex flex-col">
                            <span className="font-semibold text-sm text-text-primary tracking-tight">
                                Poseidon
                            </span>
                            <span className="text-[10px] text-text-tertiary font-medium">
                                Agent Browser
                            </span>
                        </div>
                    </div>

                    <button
                        onClick={() => setIsPinned(!isPinned)}
                        className={cn(
                            "btn-icon h-8 w-8",
                            isPinned && "bg-brand-muted text-brand"
                        )}
                        title={isPinned ? "Unpin (⌘\\)" : "Pin (⌘\\)"}
                    >
                        {isPinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
                    </button>
                </header>

                {/* New Tab Button */}
                <div className="px-3 py-3">
                    <button
                        onClick={handleCreateTab}
                        className={cn(
                            "group flex items-center w-full gap-3 rounded-xl bg-surface-tertiary border border-transparent px-3 py-2.5",
                            "transition-all duration-200 ease-smooth",
                            "hover:bg-brand-muted hover:border-brand/20 hover:shadow-soft",
                            "active:scale-[0.98]"
                        )}
                    >
                        <div className={cn(
                            "flex items-center justify-center h-7 w-7 rounded-lg bg-white shadow-soft border border-border/50",
                            "group-hover:bg-brand group-hover:border-brand group-hover:shadow-brand",
                            "transition-all duration-200"
                        )}>
                            <Plus className="h-3.5 w-3.5 text-text-secondary group-hover:text-white transition-colors" />
                        </div>
                        <span className="text-sm font-medium text-text-secondary group-hover:text-brand-dark">
                            New Tab
                        </span>
                        <span className="ml-auto kbd">
                            <span className="text-[9px]">⌘</span>T
                        </span>
                    </button>
                </div>

                {/* Search */}
                <div className="px-3 pb-3">
                    <button className="flex items-center w-full gap-3 px-3 py-2.5 rounded-xl bg-surface-secondary border border-border/60 text-text-tertiary text-sm transition-all duration-200 hover:border-border-strong hover:text-text-secondary">
                        <Search className="h-4 w-4" />
                        <span>Search tabs...</span>
                        <span className="ml-auto kbd">
                            <span className="text-[9px]">⌘</span>K
                        </span>
                    </button>
                </div>

                {/* Tabs Section */}
                <nav className="flex-1 overflow-y-auto thin-scrollbar px-3 pb-3">
                    <section>
                        <h2 className="px-3 mb-2 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
                            Tabs ({tabs.length})
                        </h2>
                        <ul className="space-y-0.5">
                            {tabs.map((tab) => (
                                <li key={tab.id}>
                                    <button
                                        onClick={() => handleSwitchTab(tab.id)}
                                        className={cn(
                                            "flex items-center w-full gap-3 px-3 py-2.5 rounded-xl text-sm font-medium",
                                            "transition-all duration-200 ease-smooth group",
                                            activeTabId === tab.id
                                                ? "bg-brand-muted text-brand-dark"
                                                : "text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                                        )}
                                    >
                                        {/* Favicon */}
                                        <div className="h-5 w-5 rounded shrink-0 flex items-center justify-center bg-surface-tertiary overflow-hidden">
                                            {tab.isLoading ? (
                                                <Loader2 className="h-3 w-3 text-brand animate-spin" />
                                            ) : getFaviconUrl(tab) ? (
                                                <img
                                                    src={getFaviconUrl(tab)!}
                                                    alt=""
                                                    className="h-4 w-4 object-contain"
                                                    onError={(e) => {
                                                        (e.target as HTMLImageElement).style.display = 'none';
                                                    }}
                                                />
                                            ) : (
                                                <Globe className="h-3 w-3 text-text-tertiary" />
                                            )}
                                        </div>

                                        {/* Title */}
                                        <span className="truncate flex-1 text-left">
                                            {tab.title || 'New Tab'}
                                        </span>

                                        {/* Close Button */}
                                        <button
                                            onClick={(e) => handleCloseTab(e, tab.id)}
                                            className={cn(
                                                "h-5 w-5 rounded flex items-center justify-center",
                                                "opacity-0 group-hover:opacity-100",
                                                "hover:bg-black/10 transition-all"
                                            )}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </button>
                                </li>
                            ))}
                        </ul>

                        {tabs.length === 0 && (
                            <div className="px-3 py-6 text-center text-sm text-text-tertiary">
                                No tabs open
                            </div>
                        )}
                    </section>
                </nav>

                {/* Footer */}
                <footer className="p-3 border-t border-border/40 space-y-1">
                    {/* Ad Blocker */}
                    <button
                        onClick={handleToggleAdBlock}
                        className={cn(
                            "flex items-center w-full gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group",
                            adBlockEnabled
                                ? "text-success hover:bg-success/5"
                                : "text-text-secondary hover:bg-surface-tertiary"
                        )}
                    >
                        {adBlockEnabled ? (
                            <ShieldCheck className="h-[18px] w-[18px] shrink-0 text-success" />
                        ) : (
                            <ShieldOff className="h-[18px] w-[18px] shrink-0" />
                        )}
                        <span>{adBlockEnabled ? "Protected" : "Unprotected"}</span>
                        {adBlockEnabled && blockedCount > 0 && (
                            <span className="ml-auto badge bg-success/10 text-success text-[10px]">
                                {blockedCount > 999 ? '999+' : blockedCount}
                            </span>
                        )}
                    </button>

                    {/* Settings */}
                    <button className="flex items-center w-full gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-text-secondary hover:bg-surface-tertiary hover:text-text-primary transition-all duration-200">
                        <Settings className="h-[18px] w-[18px] shrink-0" />
                        <span>Settings</span>
                    </button>
                </footer>
            </aside>
        </>
    );
}
