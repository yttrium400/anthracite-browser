import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import {
    MagnifyingGlass,
    Plus,
    X,
    ArrowLeft,
    ArrowRight,
    ArrowClockwise,
    GearSix,
    PushPin,
    PushPinSlash,
    ShieldCheckered,
    ShieldSlash,
    Globe,
    CircleNotch,
    ArrowSquareOut,
    House,
    CaretRight,
} from '@phosphor-icons/react';

interface Tab {
    id: string;
    title: string;
    url: string;
    favicon?: string;
    isLoading?: boolean;
}

interface Command {
    id: string;
    label: string;
    description?: string;
    shortcut?: string;
    icon: React.ReactNode;
    category: 'navigation' | 'tabs' | 'browser' | 'settings';
    action: () => void;
    keywords?: string;
}

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    tabs: Tab[];
    activeTabId: string | null;
    canGoBack: boolean;
    canGoForward: boolean;
    isSidebarPinned: boolean;
    adBlockEnabled: boolean;
    onNewTab: () => void;
    onCloseTab: (tabId: string) => void;
    onSwitchTab: (tabId: string) => void;
    onBack: () => void;
    onForward: () => void;
    onReload: () => void;
    onNavigate: (url: string) => void;
    onToggleSidebarPin: () => void;
    onToggleAdBlock: () => void;
}

const CATEGORY_LABELS: Record<Command['category'], string> = {
    navigation: 'Navigation',
    tabs: 'Tabs',
    browser: 'Browser',
    settings: 'Settings',
};

function fuzzyMatch(haystack: string, needle: string): boolean {
    if (!needle) return true;
    const h = haystack.toLowerCase();
    const n = needle.toLowerCase();
    let hi = 0;
    for (let ni = 0; ni < n.length; ni++) {
        hi = h.indexOf(n[ni], hi);
        if (hi === -1) return false;
        hi++;
    }
    return true;
}

function CommandItem({
    command,
    isSelected,
    onClick,
}: {
    command: Command;
    isSelected: boolean;
    onClick: () => void;
}) {
    const ref = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (isSelected) {
            ref.current?.scrollIntoView({ block: 'nearest' });
        }
    }, [isSelected]);

    return (
        <button
            ref={ref}
            onClick={onClick}
            className={cn(
                'flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left transition-colors duration-100',
                isSelected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'
            )}
        >
            <div className={cn(
                'flex items-center justify-center h-7 w-7 rounded-lg shrink-0',
                isSelected ? 'bg-brand/15 text-brand' : 'bg-white/[0.06] text-text-tertiary'
            )}>
                {command.icon}
            </div>
            <div className="flex-1 min-w-0">
                <div className={cn(
                    'text-[13px] font-medium truncate',
                    isSelected ? 'text-text-primary' : 'text-text-secondary'
                )}>
                    {command.label}
                </div>
                {command.description && (
                    <div className="text-[11px] text-text-tertiary truncate mt-0.5">
                        {command.description}
                    </div>
                )}
            </div>
            {command.shortcut && (
                <kbd className="shrink-0 text-[10px] text-text-tertiary bg-white/[0.06] px-1.5 py-0.5 rounded-md font-mono">
                    {command.shortcut}
                </kbd>
            )}
            {isSelected && (
                <CaretRight className="h-3.5 w-3.5 text-brand shrink-0" />
            )}
        </button>
    );
}

export function CommandPalette({
    isOpen,
    onClose,
    tabs,
    activeTabId,
    canGoBack,
    canGoForward,
    isSidebarPinned,
    adBlockEnabled,
    onNewTab,
    onCloseTab,
    onSwitchTab,
    onBack,
    onForward,
    onReload,
    onNavigate,
    onToggleSidebarPin,
    onToggleAdBlock,
}: CommandPaletteProps) {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // Reset when opened
    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    const execute = useCallback((cmd: Command) => {
        cmd.action();
        onClose();
    }, [onClose]);

    // Build the full command list
    const allCommands = useMemo((): Command[] => {
        const activeTab = tabs.find(t => t.id === activeTabId);
        const cmds: Command[] = [];

        // Navigation
        cmds.push({
            id: 'new-tab',
            label: 'New Tab',
            icon: <Plus className="h-4 w-4" />,
            category: 'navigation',
            shortcut: '⌘T',
            action: onNewTab,
        });

        if (canGoBack) {
            cmds.push({
                id: 'go-back',
                label: 'Go Back',
                icon: <ArrowLeft className="h-4 w-4" />,
                category: 'navigation',
                shortcut: '⌘[',
                action: onBack,
            });
        }

        if (canGoForward) {
            cmds.push({
                id: 'go-forward',
                label: 'Go Forward',
                icon: <ArrowRight className="h-4 w-4" />,
                category: 'navigation',
                shortcut: '⌘]',
                action: onForward,
            });
        }

        cmds.push({
            id: 'reload',
            label: 'Reload Page',
            icon: <ArrowClockwise className="h-4 w-4" />,
            category: 'navigation',
            shortcut: '⌘R',
            action: onReload,
        });

        if (activeTab && !activeTab.url.startsWith('anthracite://')) {
            cmds.push({
                id: 'close-tab',
                label: 'Close Current Tab',
                description: activeTab.title || activeTab.url,
                icon: <X className="h-4 w-4" />,
                category: 'tabs',
                shortcut: '⌘W',
                action: () => onCloseTab(activeTab.id),
            });
        }

        cmds.push({
            id: 'home',
            label: 'Go to Home',
            icon: <House className="h-4 w-4" />,
            category: 'navigation',
            action: () => onNavigate('anthracite://newtab'),
        });

        // Switch to each tab
        tabs.filter(t => t.id !== activeTabId).forEach(tab => {
            cmds.push({
                id: `switch-${tab.id}`,
                label: tab.title || 'Untitled',
                description: tab.url.startsWith('anthracite://') ? 'Internal page' : tab.url,
                icon: tab.favicon
                    ? <img src={tab.favicon} alt="" className="h-4 w-4 rounded object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    : <Globe className="h-4 w-4" />,
                category: 'tabs',
                keywords: tab.url,
                action: () => onSwitchTab(tab.id),
            });
        });

        // Browser actions
        cmds.push({
            id: 'toggle-sidebar',
            label: isSidebarPinned ? 'Unpin Sidebar' : 'Pin Sidebar',
            icon: isSidebarPinned ? <PushPinSlash className="h-4 w-4" /> : <PushPin className="h-4 w-4" />,
            category: 'browser',
            shortcut: '⌘\\',
            action: onToggleSidebarPin,
        });

        cmds.push({
            id: 'toggle-adblock',
            label: adBlockEnabled ? 'Disable Shields' : 'Enable Shields',
            icon: adBlockEnabled
                ? <ShieldSlash className="h-4 w-4" />
                : <ShieldCheckered className="h-4 w-4" />,
            category: 'browser',
            action: onToggleAdBlock,
        });

        // Settings
        cmds.push({
            id: 'settings',
            label: 'Open Settings',
            icon: <GearSix className="h-4 w-4" />,
            category: 'settings',
            shortcut: '⌘,',
            action: () => onNavigate('anthracite://settings'),
        });

        return cmds;
    }, [tabs, activeTabId, canGoBack, canGoForward, isSidebarPinned, adBlockEnabled,
        onNewTab, onBack, onForward, onReload, onCloseTab, onSwitchTab,
        onNavigate, onToggleSidebarPin, onToggleAdBlock]);

    // Filter by query
    const filtered = useMemo(() => {
        if (!query.trim()) return allCommands;
        return allCommands.filter(cmd =>
            fuzzyMatch(cmd.label, query) ||
            fuzzyMatch(cmd.description || '', query) ||
            fuzzyMatch(cmd.keywords || '', query)
        );
    }, [allCommands, query]);

    // Group filtered results by category
    const grouped = useMemo(() => {
        const groups: Partial<Record<Command['category'], Command[]>> = {};
        filtered.forEach(cmd => {
            if (!groups[cmd.category]) groups[cmd.category] = [];
            groups[cmd.category]!.push(cmd);
        });
        return groups;
    }, [filtered]);

    // Flat index for keyboard nav
    const flatList = filtered;

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(i => Math.min(i + 1, flatList.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (flatList[selectedIndex]) execute(flatList[selectedIndex]);
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    // Reset selection when query changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[500] flex items-start justify-center pt-[15vh]">
                    {/* Backdrop */}
                    <motion.div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        onClick={onClose}
                    />

                    {/* Palette */}
                    <motion.div
                        className={cn(
                            'relative w-full max-w-xl mx-4 z-10',
                            'bg-[#141416]/95 backdrop-blur-2xl',
                            'rounded-2xl border border-white/[0.08]',
                            'shadow-large overflow-hidden',
                        )}
                        initial={{ opacity: 0, scale: 0.97, y: -12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97, y: -8 }}
                        transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
                    >
                        {/* Search input */}
                        <div className="flex items-center gap-3 px-4 h-14 border-b border-white/[0.06]">
                            <MagnifyingGlass className="h-4 w-4 text-text-tertiary shrink-0" />
                            <input
                                ref={inputRef}
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Search commands..."
                                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
                            />
                            <kbd className="text-[10px] text-text-tertiary bg-white/[0.06] px-1.5 py-0.5 rounded-md font-mono shrink-0">
                                ESC
                            </kbd>
                        </div>

                        {/* Results */}
                        <div className="max-h-[360px] overflow-y-auto thin-scrollbar p-2">
                            {flatList.length === 0 ? (
                                <div className="py-10 text-center text-sm text-text-tertiary">
                                    No commands found
                                </div>
                            ) : (
                                (Object.keys(CATEGORY_LABELS) as Command['category'][]).map(cat => {
                                    const items = grouped[cat];
                                    if (!items?.length) return null;
                                    return (
                                        <div key={cat} className="mb-2">
                                            <div className="px-3 py-1.5 text-[10px] font-semibold text-white/30 uppercase tracking-widest">
                                                {CATEGORY_LABELS[cat]}
                                            </div>
                                            {items.map(cmd => {
                                                const globalIndex = flatList.indexOf(cmd);
                                                return (
                                                    <CommandItem
                                                        key={cmd.id}
                                                        command={cmd}
                                                        isSelected={globalIndex === selectedIndex}
                                                        onClick={() => execute(cmd)}
                                                    />
                                                );
                                            })}
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {/* Footer */}
                        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-white/[0.06]">
                            <span className="text-[10px] text-text-tertiary flex items-center gap-1.5">
                                <kbd className="bg-white/[0.06] px-1 rounded text-[9px] font-mono">↑↓</kbd>
                                navigate
                            </span>
                            <span className="text-[10px] text-text-tertiary flex items-center gap-1.5">
                                <kbd className="bg-white/[0.06] px-1 rounded text-[9px] font-mono">↵</kbd>
                                execute
                            </span>
                            <span className="ml-auto text-[10px] text-text-tertiary">
                                {flatList.length} command{flatList.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
