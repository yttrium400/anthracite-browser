import React, { useState, useEffect, useRef } from 'react';
import { cn } from '../lib/utils';
import {
    Compass,
    LayoutGrid,
    Sparkles,
    Settings,
    ChevronLeft,
    ChevronRight,
    Plus,
    Search,
    Globe,
    Clock,
    Star,
    MoreHorizontal,
    Zap,
    Pin,
    PinOff,
    Shield,
    ShieldOff,
    ShieldCheck,
} from 'lucide-react';

interface SidebarProps {
    className?: string;
}

interface NavItem {
    icon: React.ElementType;
    label: string;
    active?: boolean;
    badge?: string;
}

interface FavoriteItem {
    icon?: React.ElementType;
    label: string;
    url: string;
    color?: string;
}

export function Sidebar({ className }: SidebarProps) {
    const [isVisible, setIsVisible] = useState(false);
    const [isPinned, setIsPinned] = useState(false);
    const [hoveredItem, setHoveredItem] = useState<string | null>(null);
    const [adBlockEnabled, setAdBlockEnabled] = useState(true);
    const [blockedCount, setBlockedCount] = useState(0);
    const sidebarRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLDivElement>(null);

    // Initialize ad-block status and listen for updates
    useEffect(() => {
        // Check if running in Electron
        if (typeof window !== 'undefined' && window.electron?.adBlock) {
            // Get initial status
            window.electron.adBlock.getStatus().then((status) => {
                setAdBlockEnabled(status.enabled);
                setBlockedCount(status.count);
            });

            // Listen for blocked count updates
            const unsubscribeBlocked = window.electron.adBlock.onBlocked((data) => {
                setBlockedCount(data.count);
            });

            // Listen for status changes
            const unsubscribeStatus = window.electron.adBlock.onStatusChange((data) => {
                setAdBlockEnabled(data.enabled);
                setBlockedCount(data.count);
            });

            return () => {
                unsubscribeBlocked();
                unsubscribeStatus();
            };
        }
    }, []);

    // Toggle ad-blocker
    const handleToggleAdBlock = async () => {
        if (typeof window !== 'undefined' && window.electron?.adBlock) {
            const result = await window.electron.adBlock.toggle(!adBlockEnabled);
            setAdBlockEnabled(result.enabled);
        }
    };

    const navItems: NavItem[] = [
        { icon: Compass, label: 'Discover', active: true },
        { icon: LayoutGrid, label: 'Spaces' },
        { icon: Sparkles, label: 'Agent', badge: 'AI' },
        { icon: Clock, label: 'History' },
    ];

    const favorites: FavoriteItem[] = [
        { label: 'GitHub', url: 'github.com', color: '#24292F' },
        { label: 'Linear', url: 'linear.app', color: '#5E6AD2' },
        { label: 'Figma', url: 'figma.com', color: '#F24E1E' },
        { label: 'Notion', url: 'notion.so', color: '#000000' },
    ];

    const recentTabs = [
        { label: 'React Documentation', url: 'react.dev' },
        { label: 'Tailwind CSS', url: 'tailwindcss.com' },
    ];

    // Handle mouse entering the trigger zone or sidebar
    const handleMouseEnter = () => {
        setIsVisible(true);
    };

    // Handle mouse leaving - only hide if not pinned
    const handleMouseLeave = () => {
        if (!isPinned) {
            setIsVisible(false);
        }
    };

    // Keyboard shortcut to toggle sidebar (Cmd/Ctrl + \)
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

    return (
        <>
            {/* Hover Trigger Zone - invisible strip on left edge */}
            <div
                ref={triggerRef}
                className="fixed left-0 top-0 w-4 h-full z-[100]"
                onMouseEnter={handleMouseEnter}
            />

            {/* Backdrop - subtle overlay when sidebar is open */}
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
                    {/* Logo */}
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

                    {/* Pin Toggle */}
                    <button
                        onClick={() => setIsPinned(!isPinned)}
                        className={cn(
                            "btn-icon h-8 w-8",
                            isPinned && "bg-brand-muted text-brand"
                        )}
                        title={isPinned ? "Unpin sidebar (⌘\\)" : "Pin sidebar (⌘\\)"}
                    >
                        {isPinned ? (
                            <Pin className="h-4 w-4" />
                        ) : (
                            <PinOff className="h-4 w-4" />
                        )}
                    </button>
                </header>

                {/* New Tab Button */}
                <div className="px-3 py-3">
                    <button
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
                    <button
                        className="flex items-center w-full gap-3 px-3 py-2.5 rounded-xl
                                   bg-surface-secondary border border-border/60
                                   text-text-tertiary text-sm
                                   transition-all duration-200 ease-smooth
                                   hover:border-border-strong hover:text-text-secondary"
                    >
                        <Search className="h-4 w-4" />
                        <span>Search anything...</span>
                        <span className="ml-auto kbd">
                            <span className="text-[9px]">⌘</span>K
                        </span>
                    </button>
                </div>

                {/* Scrollable Content */}
                <nav className="flex-1 overflow-y-auto overflow-x-hidden thin-scrollbar px-3 space-y-5 pb-3">
                    {/* Main Navigation */}
                    <section>
                        <h2 className="px-3 mb-2 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
                            Navigate
                        </h2>
                        <ul className="space-y-0.5">
                            {navItems.map((item, index) => (
                                <li key={index}>
                                    <button
                                        onMouseEnter={() => setHoveredItem(item.label)}
                                        onMouseLeave={() => setHoveredItem(null)}
                                        className={cn(
                                            "nav-item w-full group relative",
                                            item.active && "nav-item-active"
                                        )}
                                    >
                                        <item.icon
                                            className={cn(
                                                "h-[18px] w-[18px] shrink-0 transition-colors nav-icon",
                                                item.active ? "text-brand" : "text-text-secondary group-hover:text-text-primary"
                                            )}
                                        />
                                        <span className="truncate">{item.label}</span>
                                        {item.badge && (
                                            <span className="ml-auto badge badge-brand">
                                                {item.badge}
                                            </span>
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>

                    {/* Favorites Section */}
                    <section>
                        <div className="flex items-center justify-between px-3 mb-2">
                            <h2 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
                                Favorites
                            </h2>
                            <button className="btn-icon h-6 w-6 -mr-1">
                                <Plus className="h-3 w-3" />
                            </button>
                        </div>
                        <ul className="space-y-0.5">
                            {favorites.map((item, index) => (
                                <li key={index}>
                                    <button className="nav-item w-full group">
                                        <div
                                            className="h-5 w-5 rounded-md flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                                            style={{ backgroundColor: item.color || '#6B7280' }}
                                        >
                                            {item.label[0]}
                                        </div>
                                        <span className="truncate">{item.label}</span>
                                        <span className="ml-auto text-[11px] text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity">
                                            {item.url}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>

                    {/* Recent Tabs */}
                    <section>
                        <div className="flex items-center justify-between px-3 mb-2">
                            <h2 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
                                Recent
                            </h2>
                            <button className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors">
                                Clear
                            </button>
                        </div>
                        <ul className="space-y-0.5">
                            {recentTabs.map((item, index) => (
                                <li key={index}>
                                    <button className="nav-item w-full group">
                                        <Globe className="h-4 w-4 text-text-tertiary shrink-0" />
                                        <span className="truncate text-text-secondary">{item.label}</span>
                                        <button className="ml-auto btn-icon h-6 w-6 opacity-0 group-hover:opacity-100">
                                            <MoreHorizontal className="h-3.5 w-3.5" />
                                        </button>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                </nav>

                {/* Footer */}
                <footer className="p-3 border-t border-border/40 space-y-1">
                    {/* Ad Blocker Toggle */}
                    <button
                        onClick={handleToggleAdBlock}
                        className={cn(
                            "nav-item w-full group",
                            adBlockEnabled && "text-success"
                        )}
                    >
                        {adBlockEnabled ? (
                            <ShieldCheck className="h-[18px] w-[18px] shrink-0 text-success" />
                        ) : (
                            <ShieldOff className="h-[18px] w-[18px] shrink-0 text-text-tertiary" />
                        )}
                        <span className={adBlockEnabled ? "text-success" : ""}>
                            {adBlockEnabled ? "Protected" : "Unprotected"}
                        </span>
                        {adBlockEnabled && blockedCount > 0 && (
                            <span className="ml-auto badge bg-success/10 text-success text-[10px]">
                                {blockedCount > 999 ? '999+' : blockedCount} blocked
                            </span>
                        )}
                    </button>

                    {/* Settings */}
                    <button className="nav-item w-full">
                        <Settings className="h-[18px] w-[18px] shrink-0" />
                        <span>Settings</span>
                    </button>

                    {/* User / Status */}
                    <div className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-surface-tertiary transition-colors cursor-pointer">
                        <div className="relative">
                            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-accent-emerald to-accent-blue flex items-center justify-center text-white text-xs font-semibold">
                                U
                            </div>
                            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-success border-2 border-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-text-primary truncate">User</p>
                            <p className="text-[11px] text-text-tertiary">Pro Plan</p>
                        </div>
                        <button className="btn-icon h-7 w-7">
                            <MoreHorizontal className="h-4 w-4" />
                        </button>
                    </div>
                </footer>
            </aside>
        </>
    );
}
