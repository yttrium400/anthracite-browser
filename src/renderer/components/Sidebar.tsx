import React, { useState } from 'react';
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
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [hoveredItem, setHoveredItem] = useState<string | null>(null);

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

    return (
        <aside
            className={cn(
                "glass-panel relative flex flex-col h-full transition-all duration-300 ease-smooth z-50",
                isCollapsed ? "w-[72px]" : "w-[260px]",
                className
            )}
        >
            {/* macOS Traffic Light Space */}
            <div className="h-3" />

            {/* Header */}
            <header
                className={cn(
                    "flex items-center h-14 px-4 transition-all duration-300",
                    isCollapsed ? "justify-center px-3" : "justify-between"
                )}
            >
                {/* Logo */}
                <div className={cn(
                    "flex items-center gap-2.5 transition-all duration-300",
                    isCollapsed && "justify-center"
                )}>
                    <div className="relative group">
                        <div className="absolute inset-0 bg-gradient-to-br from-brand to-accent-violet rounded-xl blur-lg opacity-40 group-hover:opacity-60 transition-opacity" />
                        <div className={cn(
                            "relative flex items-center justify-center rounded-xl bg-gradient-to-br from-brand to-accent-violet shadow-lg transition-all duration-300",
                            isCollapsed ? "h-10 w-10" : "h-8 w-8"
                        )}>
                            <Zap className={cn(
                                "text-white transition-all",
                                isCollapsed ? "h-5 w-5" : "h-4 w-4"
                            )} />
                        </div>
                    </div>
                    {!isCollapsed && (
                        <div className="flex flex-col">
                            <span className="font-semibold text-sm text-text-primary tracking-tight">
                                Poseidon
                            </span>
                            <span className="text-[10px] text-text-tertiary font-medium">
                                Agent Browser
                            </span>
                        </div>
                    )}
                </div>

                {/* Collapse Toggle */}
                {!isCollapsed && (
                    <button
                        onClick={() => setIsCollapsed(true)}
                        className="btn-icon opacity-0 group-hover:opacity-100 hover:opacity-100"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                )}
            </header>

            {/* New Tab Button */}
            <div className="px-3 mt-2 mb-4">
                <button
                    className={cn(
                        "group flex items-center w-full gap-3 rounded-xl bg-surface-tertiary border border-transparent",
                        "transition-all duration-200 ease-smooth",
                        "hover:bg-brand-muted hover:border-brand/20 hover:shadow-soft",
                        "active:scale-[0.98]",
                        isCollapsed ? "justify-center p-3" : "px-3 py-2.5"
                    )}
                >
                    <div className={cn(
                        "flex items-center justify-center rounded-lg bg-white shadow-soft border border-border/50",
                        "group-hover:bg-brand group-hover:border-brand group-hover:shadow-brand",
                        "transition-all duration-200",
                        isCollapsed ? "h-8 w-8" : "h-7 w-7"
                    )}>
                        <Plus className={cn(
                            "text-text-secondary group-hover:text-white transition-colors",
                            isCollapsed ? "h-4 w-4" : "h-3.5 w-3.5"
                        )} />
                    </div>
                    {!isCollapsed && (
                        <span className="text-sm font-medium text-text-secondary group-hover:text-brand-dark">
                            New Tab
                        </span>
                    )}
                    {!isCollapsed && (
                        <span className="ml-auto kbd">
                            <span className="text-[9px]">⌘</span>T
                        </span>
                    )}
                </button>
            </div>

            {/* Search */}
            {!isCollapsed && (
                <div className="px-3 mb-4">
                    <button
                        className="flex items-center w-full gap-3 px-3 py-2 rounded-xl
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
            )}

            {isCollapsed && (
                <div className="px-3 mb-4 flex justify-center">
                    <button className="btn-icon">
                        <Search className="h-4 w-4" />
                    </button>
                </div>
            )}

            {/* Scrollable Content */}
            <nav className="flex-1 overflow-y-auto overflow-x-hidden thin-scrollbar px-3 space-y-6">
                {/* Main Navigation */}
                <section>
                    {!isCollapsed && (
                        <h2 className="px-3 mb-2 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
                            Navigate
                        </h2>
                    )}
                    <ul className="space-y-1">
                        {navItems.map((item, index) => (
                            <li key={index}>
                                <button
                                    onMouseEnter={() => setHoveredItem(item.label)}
                                    onMouseLeave={() => setHoveredItem(null)}
                                    className={cn(
                                        "nav-item w-full group relative",
                                        item.active && "nav-item-active",
                                        isCollapsed && "justify-center px-0 py-3"
                                    )}
                                    title={isCollapsed ? item.label : undefined}
                                >
                                    <item.icon
                                        className={cn(
                                            "h-[18px] w-[18px] shrink-0 transition-colors nav-icon",
                                            item.active ? "text-brand" : "text-text-secondary group-hover:text-text-primary"
                                        )}
                                    />
                                    {!isCollapsed && (
                                        <>
                                            <span className="truncate">{item.label}</span>
                                            {item.badge && (
                                                <span className="ml-auto badge badge-brand">
                                                    {item.badge}
                                                </span>
                                            )}
                                        </>
                                    )}

                                    {/* Tooltip for collapsed state */}
                                    {isCollapsed && hoveredItem === item.label && (
                                        <div className="absolute left-full ml-2 px-2.5 py-1.5 bg-text-primary text-white text-xs font-medium rounded-lg shadow-lg whitespace-nowrap z-50 animate-fade-in">
                                            {item.label}
                                        </div>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>

                {/* Favorites Section */}
                <section>
                    {!isCollapsed && (
                        <div className="flex items-center justify-between px-3 mb-2">
                            <h2 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
                                Favorites
                            </h2>
                            <button className="btn-icon h-6 w-6 -mr-1">
                                <Plus className="h-3 w-3" />
                            </button>
                        </div>
                    )}
                    <ul className="space-y-0.5">
                        {favorites.map((item, index) => (
                            <li key={index}>
                                <button
                                    className={cn(
                                        "nav-item w-full group",
                                        isCollapsed && "justify-center px-0 py-3"
                                    )}
                                    title={isCollapsed ? item.label : undefined}
                                >
                                    <div
                                        className="h-5 w-5 rounded-md flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                                        style={{ backgroundColor: item.color || '#6B7280' }}
                                    >
                                        {item.label[0]}
                                    </div>
                                    {!isCollapsed && (
                                        <>
                                            <span className="truncate">{item.label}</span>
                                            <span className="ml-auto text-[11px] text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity">
                                                {item.url}
                                            </span>
                                        </>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>

                {/* Recent Tabs */}
                {!isCollapsed && (
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
                )}
            </nav>

            {/* Footer */}
            <footer className="p-3 border-t border-border/60 space-y-1">
                {/* Settings */}
                <button
                    className={cn(
                        "nav-item w-full",
                        isCollapsed && "justify-center px-0 py-3"
                    )}
                    title={isCollapsed ? "Settings" : undefined}
                >
                    <Settings className="h-[18px] w-[18px] shrink-0" />
                    {!isCollapsed && <span>Settings</span>}
                </button>

                {/* Expand Toggle (only when collapsed) */}
                {isCollapsed && (
                    <button
                        onClick={() => setIsCollapsed(false)}
                        className="nav-item w-full justify-center px-0 py-3"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                )}

                {/* User / Status (only when expanded) */}
                {!isCollapsed && (
                    <div className="flex items-center gap-3 px-3 py-2 rounded-xl">
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
                )}
            </footer>
        </aside>
    );
}
