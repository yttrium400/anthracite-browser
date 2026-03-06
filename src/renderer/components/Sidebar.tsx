import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    DndContext,
    DragOverlay,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragStartEvent,
    DragEndEvent,
    DragOverEvent,
    useDroppable,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { cn } from '../lib/utils';
import {
    GearSix,
    Plus,
    Globe,
    PushPin,
    PushPinSlash,
    ShieldSlash,
    ShieldCheckered,
    X,
    CircleNotch,
    Trash,
    PencilSimpleLine,
    ArrowCircleRight,
    Copy,
    CaretDown,
    ClockCounterClockwise,
    ArrowLeft,
    ArrowRight,
    ArrowClockwise,
    Lock,
    LockOpen,
    Sparkle,
} from '@phosphor-icons/react';
import { RealmSwitcher } from './RealmSwitcher';
import { RealmModal } from './RealmModal';
import { ContextMenu, useContextMenu, ContextMenuItem } from './ContextMenu';
import { SortableTab, TabDragOverlay } from './SortableTab';
import type { Realm, IconName, ThemeColor } from '../../shared/types';
import type { RealmTemplate } from '../../shared/templates';

interface SidebarProps {
    className?: string;
    isPinned: boolean;
    onPinnedChange: (pinned: boolean) => void;
    tabs: Tab[];
    activeTabId: string | null;
    onNewTabWithOverlay?: () => void;
    // Navigation props (Arc-style: nav controls live in sidebar)
    onBack?: () => void;
    onForward?: () => void;
    onReload?: () => void;
    canGoBack?: boolean;
    canGoForward?: boolean;
    isLoading?: boolean;
    onEditUrl?: () => void;
    onToggleAgentPanel?: () => void;
    currentUrl?: string;
}

// ... existing interfaces ...

// ... existing interfaces ...

interface Tab {
    id: string;
    title: string;
    url: string;
    favicon: string;
    isLoading: boolean;
    isArchived?: boolean;
    realmId?: string;
    dockId?: string | null;
    order?: number;
    isPinned?: boolean;
}

interface TabOrganization {
    realmId: string;
    dockId: string | null;
    order: number;
    isPinned: boolean;
}

// Droppable zone for loose tabs section
interface LooseTabsDropZoneProps {
    looseTabs: Tab[];
    children: React.ReactNode;
}

function LooseTabsDropZone({ looseTabs, children }: LooseTabsDropZoneProps) {
    const { isOver, setNodeRef } = useDroppable({
        id: 'loose-tabs-dropzone',
        data: {
            type: 'loose',
        },
    });

    return (
        <section
            ref={setNodeRef}
            className={cn(
                "transition-all duration-200 min-h-[120px]",
                isOver && "bg-brand/5 rounded-xl ring-2 ring-brand/30"
            )}
        >
            {children}
        </section>
    );
}


export function Sidebar({ className, isPinned, onPinnedChange, tabs, activeTabId, onNewTabWithOverlay, onBack, onForward, onReload, canGoBack, canGoForward, isLoading, onEditUrl, onToggleAgentPanel, currentUrl }: SidebarProps) {
    const [isVisible, setIsVisible] = useState(false);

    // Ad blocker state
    const [adBlockEnabled, setAdBlockEnabled] = useState(true);
    const [blockedCount, setBlockedCount] = useState(0);
    const [httpsUpgradeCount, setHttpsUpgradeCount] = useState(0);

    // Realms state
    const [realms, setRealms] = useState<Realm[]>([]);
    const [activeRealmId, setActiveRealmId] = useState<string>('');
    const [tabOrganizations, setTabOrganizations] = useState<Record<string, TabOrganization>>({});

    const sidebarRef = useRef<HTMLDivElement>(null);

    // Modal state
    const [showRealmModal, setShowRealmModal] = useState(false);
    const [editingRealm, setEditingRealm] = useState<Realm | null>(null);

    // Earlier (archived) section state
    const [showEarlier, setShowEarlier] = useState(false);

    // Context menu state
    const tabContextMenu = useContextMenu();
    const realmContextMenu = useContextMenu();

    // Drag and Drop state
    const [activeId, setActiveId] = useState<string | null>(null);
    const [draggedTab, setDraggedTab] = useState<Tab | null>(null);
    const [dropTarget, setDropTarget] = useState<{ containerId: string; index: number } | null>(null);

    // DnD sensors
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    // Refresh state from backend
    const refreshState = useCallback(async () => {
        if (!window.electron) return;
        try {
            const state = await window.electron.sidebarState.get();
            const orgs: Record<string, TabOrganization> = {};
            state.tabs.forEach((tab: Tab) => {
                orgs[tab.id] = {
                    realmId: tab.realmId || state.activeRealmId,
                    dockId: tab.dockId || null,
                    order: tab.order || 0,
                    isPinned: tab.isPinned || false,
                };
            });
            setTabOrganizations(orgs);
        } catch (err) {
            console.error('Failed to refresh state:', err);
        }
    }, []);

    // Load initial state
    // Load initial state and subscribe to changes
    const loadState = useCallback(async () => {
        try {
            // Get full sidebar state
            const state = await window.electron.sidebarState.get();
            setRealms(state.realms);
            setActiveRealmId(state.activeRealmId);

            // Build organization map from tabs
            const orgs: Record<string, TabOrganization> = {};
            state.tabs.forEach((tab: Tab) => {
                // Include all tabs - use active realm as fallback for tabs without organization
                orgs[tab.id] = {
                    realmId: tab.realmId || state.activeRealmId,
                    dockId: tab.dockId || null,
                    order: tab.order || 0,
                    isPinned: tab.isPinned || false,
                };
            });
            setTabOrganizations(orgs);

            // Ad-block status
            const status = await window.electron.adBlock.getStatus();
            setAdBlockEnabled(status.enabled);
            setBlockedCount(status.blockedCount);
            setHttpsUpgradeCount(status.httpsUpgradeCount);
        } catch (err) {
            console.error('Failed to load sidebar state:', err);
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.electron) return;

        loadState();

        // Subscribe to tab updates
        const unsubscribeTabs = window.electron.tabs.onTabsUpdated((updatedTabs: Tab[]) => {
            // Update organization from tabs data
            const orgs: Record<string, TabOrganization> = {};
            updatedTabs.forEach((tab: Tab) => {
                if (tab.realmId) {
                    orgs[tab.id] = {
                        realmId: tab.realmId,
                        dockId: tab.dockId || null,
                        order: tab.order || 0,
                        isPinned: tab.isPinned || false,
                    };
                }
            });
            setTabOrganizations(prev => ({ ...prev, ...orgs }));
        });

        // Ad-block subscriptions
        const unsubscribeBlocked = window.electron.adBlock.onBlocked(data => setBlockedCount(data.count));
        const unsubscribeHttpsUpgrade = window.electron.adBlock.onHttpsUpgrade(data => setHttpsUpgradeCount(data.count));
        const unsubscribeAdStatus = window.electron.adBlock.onStatusChange(data => {
            setAdBlockEnabled(data.enabled);
            setBlockedCount(data.blockedCount);
            setHttpsUpgradeCount(data.httpsUpgradeCount);
        });

        // Realm subscriptions
        const unsubscribeRealmCreated = window.electron.realms.onCreated((realm) => {
            setRealms(prev => [...prev, realm].sort((a, b) => a.order - b.order));
        });
        const unsubscribeRealmUpdated = window.electron.realms.onUpdated((realm) => {
            setRealms(prev => prev.map(r => r.id === realm.id ? realm : r));
        });
        const unsubscribeRealmDeleted = window.electron.realms.onDeleted(({ realmId }) => {
            // Reload full state to ensure docks and active realm are synced
            loadState();
        });
        const unsubscribeActiveRealmChanged = window.electron.realms.onActiveChanged(({ realmId }) => {
            setActiveRealmId(realmId);
        });

        // Tab organization subscription
        const unsubscribeTabOrg = window.electron.tabOrganization.onChanged((data) => {
            setTabOrganizations(prev => ({
                ...prev,
                [data.tabId]: {
                    realmId: data.realmId,
                    dockId: data.dockId,
                    order: data.order,
                    isPinned: data.isPinned,
                },
            }));
        });

        return () => {
            unsubscribeTabs();
            unsubscribeBlocked();
            unsubscribeHttpsUpgrade();
            unsubscribeAdStatus();
            unsubscribeRealmCreated();
            unsubscribeRealmUpdated();
            unsubscribeRealmDeleted();
            unsubscribeActiveRealmChanged();
            unsubscribeTabOrg();
        };
    }, [loadState]);

    // Hover handlers
    const handleMouseEnter = () => setIsVisible(true);
    const handleMouseLeave = useCallback((e: React.MouseEvent) => {
        // Don't close sidebar if pinned or if we're actively dragging
        if (isPinned || activeId) return;

        // Don't close if any context menu is open
        if (tabContextMenu.contextMenu.position ||
            realmContextMenu.contextMenu.position) {
            return;
        }

        // Check if we're actually leaving the sidebar, not moving to a child element
        const sidebar = sidebarRef.current;
        const relatedTarget = e.relatedTarget as Node | null;

        // If moving to an element inside the sidebar, don't close
        if (sidebar && relatedTarget && sidebar.contains(relatedTarget)) {
            return;
        }

        // Don't close if cursor moved to the left of the sidebar (into the gap between
        // the window edge and the sidebar). This prevents flicker when the cursor hits
        // the left wall of the window.
        if (e.clientX <= 16) {
            return;
        }

        setIsVisible(false);
    }, [isPinned, activeId, tabContextMenu.contextMenu.position, realmContextMenu.contextMenu.position]);

    // Keyboard shortcut (Cmd/Ctrl + \)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
                e.preventDefault();
                onPinnedChange(!isPinned);
                // Also toggle visibility if we're unpinning, or keep it visible if pinning
                if (!isPinned) {
                    setIsVisible(true);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isPinned, onPinnedChange]);

    // Tab actions
    const handleCreateTab = useCallback(() => {
        if (onNewTabWithOverlay) {
            onNewTabWithOverlay();
        } else {
            window.electron?.tabs.create();
        }
    }, [onNewTabWithOverlay]);

    const handleSwitchTab = useCallback((tabId: string) => {
        window.electron?.tabs.switch(tabId);
    }, []);

    const handleCloseTab = useCallback((tabId: string) => {
        window.electron?.tabs.close(tabId);
    }, []);

    // Realm actions
    const handleRealmSelect = useCallback((realmId: string) => {
        window.electron?.realms.setActive(realmId);
    }, []);

    const handleCreateRealm = useCallback(() => {
        setShowRealmModal(true);
    }, []);



    const handleRealmModalSubmit = useCallback(async (data: { name: string; icon: IconName; color: ThemeColor; template?: RealmTemplate }) => {
        if (editingRealm) {
            await window.electron?.realms.update(editingRealm.id, data);
            setEditingRealm(null);
        } else {
            await window.electron?.realms.create(data.name, data.icon, data.color, data.template);
        }
    }, [editingRealm]);

    const handleRealmModalClose = useCallback(() => {
        setShowRealmModal(false);
        setEditingRealm(null);
    }, []);

    // DnD Event Handlers
    const handleDragStart = useCallback((event: DragStartEvent) => {
        const { active } = event;
        setActiveId(active.id as string);
        const tab = tabs.find(t => t.id === active.id);
        if (tab) setDraggedTab(tab);
    }, [tabs]);

    const handleDragOver = useCallback((event: DragOverEvent) => {
        const { active, over } = event;

        if (!over || !draggedTab) {
            setDropTarget(null);
            return;
        }

        const overData = over.data.current;
        let index = 0;

        if (overData?.type === 'tab') {
            const looseTabs = tabs.filter(t => {
                const org = tabOrganizations[t.id];
                return org?.realmId === activeRealmId && !org?.isPinned;
            }).sort((a, b) => (tabOrganizations[a.id]?.order || 0) - (tabOrganizations[b.id]?.order || 0));

            index = looseTabs.findIndex(t => t.id === over.id);
            if (index === -1) index = looseTabs.length;
            setDropTarget({ containerId: 'loose', index });
        } else if ((over.id as string) === 'loose-tabs-dropzone') {
            const looseTabs = tabs.filter(t => {
                const org = tabOrganizations[t.id];
                return org?.realmId === activeRealmId && !org?.isPinned;
            });
            setDropTarget({ containerId: 'loose', index: looseTabs.length });
        } else {
            setDropTarget(null);
        }
    }, [draggedTab, tabs, tabOrganizations, activeRealmId]);

    const handleDragEnd = useCallback(async (event: DragEndEvent) => {
        const { active, over } = event;

        setActiveId(null);
        setDraggedTab(null);
        setDropTarget(null);

        if (!over) return;
        if (active.id === over.id) return;

        const activeData = active.data.current;
        const overData = over.data.current;
        if (!activeData) return;

        const activeTabId = active.id as string;
        const overId = over.id as string;

        // Only reorder if dropped on another tab
        if (overData?.type === 'tab') {
            const containerTabs = tabs
                .filter(t => {
                    const org = tabOrganizations[t.id];
                    return org?.realmId === activeRealmId && !org?.isPinned;
                })
                .sort((a, b) => (tabOrganizations[a.id]?.order || 0) - (tabOrganizations[b.id]?.order || 0));

            const oldIndex = containerTabs.findIndex(t => t.id === activeTabId);
            const newIndex = containerTabs.findIndex(t => t.id === overId);

            if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
                const newOrder = [...containerTabs];
                const [movedItem] = newOrder.splice(oldIndex, 1);
                newOrder.splice(newIndex, 0, movedItem);
                const tabIds = newOrder.map(t => t.id);

                setTabOrganizations(prev => {
                    const updated = { ...prev };
                    tabIds.forEach((id, idx) => {
                        if (updated[id]) updated[id] = { ...updated[id], order: idx };
                    });
                    return updated;
                });

                await window.electron?.tabOrganization.reorderLoose(activeRealmId, tabIds);
            }
        }
    }, [tabs, tabOrganizations, activeRealmId]);


    const handleToggleAdBlock = useCallback(async () => {
        if (window.electron?.adBlock) {
            const result = await window.electron.adBlock.toggle(!adBlockEnabled);
            setAdBlockEnabled(result.enabled);
        }
    }, [adBlockEnabled]);

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

    // Context menu handlers
    const handleTabContextMenu = useCallback((e: React.MouseEvent, tab: Tab) => {
        tabContextMenu.openContextMenu(e, tab);
    }, [tabContextMenu]);

    const handleRealmContextMenu = useCallback((e: React.MouseEvent, realm: Realm) => {
        realmContextMenu.openContextMenu(e, realm);
    }, [realmContextMenu]);

    // Tab context menu action handler
    const handleTabContextAction = useCallback(async (actionId: string) => {
        const tab = tabContextMenu.contextMenu.data as Tab;
        if (!tab) return;

        if (actionId === 'close') {
            handleCloseTab(tab.id);
        } else if (actionId === 'pin') {
            await window.electron?.tabOrganization.pin(tab.id);
        } else if (actionId === 'unpin') {
            await window.electron?.tabOrganization.unpin(tab.id);
        } else if (actionId === 'copy-url') {
            navigator.clipboard.writeText(tab.url);
        } else if (actionId.startsWith('move-to-realm:')) {
            const realmId = actionId.replace('move-to-realm:', '');
            await window.electron?.tabOrganization.moveToRealm(tab.id, realmId);
        }
    }, [tabContextMenu.contextMenu.data, handleCloseTab]);

    // Realm context menu action handler
    const handleRealmContextAction = useCallback(async (actionId: string) => {
        const realm = realmContextMenu.contextMenu.data as Realm;
        if (!realm) return;

        if (actionId === 'edit') {
            setEditingRealm(realm);
            setShowRealmModal(true);
        } else if (actionId === 'delete') {
            // Don't delete if it's the only realm
            if (realms.length > 1) {
                await window.electron?.realms.delete(realm.id);
            }
        }
    }, [realmContextMenu.contextMenu.data, realms.length]);

    // ==========================================
    // Derived state - must be defined BEFORE callbacks that use them
    // ==========================================

    // Filter tabs for active realm (only show tabs that belong to this realm)
    const activeRealmTabs = tabs.filter(tab => {
        const org = tabOrganizations[tab.id];
        // Only show tabs that explicitly belong to this realm
        return org?.realmId === activeRealmId;
    });

    // Get pinned tabs for active realm
    const pinnedTabs = activeRealmTabs.filter(tab => tabOrganizations[tab.id]?.isPinned);


    // Get all unpinned tabs (regardless of dock assignment — docks are hidden in this UI)
    const allLooseTabs = activeRealmTabs
        .filter(tab => {
            const org = tabOrganizations[tab.id];
            return !org?.isPinned;
        })
        .sort((a, b) => (tabOrganizations[a.id]?.order || 0) - (tabOrganizations[b.id]?.order || 0));

    const looseTabs = allLooseTabs.filter(t => !t.isArchived);
    const archivedTabs = allLooseTabs.filter(t => t.isArchived);

    // Current realm
    const currentRealm = realms.find(r => r.id === activeRealmId);


    // Build tab context menu items
    const buildTabContextMenuItems = useCallback((): ContextMenuItem[] => {
        const tab = tabContextMenu.contextMenu.data as Tab;
        if (!tab) return [];

        const org = tabOrganizations[tab.id];
        const isPinned = org?.isPinned;

        const items: ContextMenuItem[] = [
            {
                id: isPinned ? 'unpin' : 'pin',
                label: isPinned ? 'Unpin Tab' : 'Pin Tab',
                icon: isPinned ? <PushPinSlash className="h-4 w-4" /> : <PushPin className="h-4 w-4" />,
            },
            { id: 'divider-1', label: '', divider: true },
            {
                id: 'copy-url',
                label: 'Copy URL',
                icon: <Copy className="h-4 w-4" />,
                shortcut: '⌘C',
            },
        ];

        // Move to realm submenu (only if there are multiple realms)
        if (realms.length > 1) {
            const realmSubmenu: ContextMenuItem[] = realms
                .filter(r => r.id !== activeRealmId)
                .map(r => ({
                    id: `move-to-realm:${r.id}`,
                    label: r.name,
                }));

            if (realmSubmenu.length > 0) {
                items.push({
                    id: 'move-to-realm',
                    label: 'Move to Realm',
                    icon: <ArrowCircleRight className="h-4 w-4" />,
                    submenu: realmSubmenu,
                });
            }
        }

        items.push(
            { id: 'divider-2', label: '', divider: true },
            {
                id: 'close',
                label: 'Close Tab',
                icon: <X className="h-4 w-4" />,
                shortcut: '⌘W',
                danger: true,
            }
        );

        return items;
    }, [tabContextMenu.contextMenu.data, tabOrganizations, realms, activeRealmId]);

    // Build realm context menu items
    const buildRealmContextMenuItems = useCallback((): ContextMenuItem[] => {
        const realm = realmContextMenu.contextMenu.data as Realm;
        if (!realm) return [];

        return [
            {
                id: 'edit',
                label: 'Edit Realm',
                icon: <PencilSimpleLine className="h-4 w-4" />,
            },
            { id: 'divider-1', label: '', divider: true },
            {
                id: 'delete',
                label: 'Delete Realm',
                icon: <Trash className="h-4 w-4" />,
                danger: true,
                disabled: realms.length <= 1,
            },
        ];
    }, [realmContextMenu.contextMenu.data, realms.length]);

    // (Moved derived state definitions to before buildTabContextMenuItems)

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
        >
            <>
                {/* Hover Trigger Zone */}
                <div
                    className="fixed left-0 top-0 w-4 h-full z-[250]"
                    onMouseEnter={handleMouseEnter}
                />

                {/* Backdrop */}
                <AnimatePresence>
                    {isVisible && !isPinned && (
                        <motion.div
                            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[150]"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            onClick={() => !isPinned && setIsVisible(false)}
                        />
                    )}
                </AnimatePresence>

                {/* Floating Sidebar */}
                <motion.aside
                    ref={sidebarRef}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    className={cn(
                        "fixed left-3 top-1 bottom-3 w-[320px] z-[200]",
                        "bg-[#111113]/90 backdrop-blur-2xl",
                        "rounded-2xl border border-white/[0.06]",
                        "shadow-large",
                        "flex flex-col",
                        className
                    )}
                    initial={false}
                    animate={{
                        x: isPinned || isVisible ? 0 : -(320 + 20),
                        opacity: isPinned || isVisible ? 1 : 0,
                    }}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                >
                    {/* Traffic Light Spacer — reserves space for macOS window controls */}
                    <div
                        className="h-[32px] shrink-0"
                        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
                    />

                    {/* Arc-style Header: Nav Controls + URL Display */}
                    <header className="px-3 pb-3 border-b border-white/[0.06] space-y-2">
                        {/* Navigation Controls Row */}
                        <div className="flex items-center gap-1.5">
                            {/* Nav buttons */}
                            <div className="flex items-center gap-1 text-text-secondary" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                                <button type="button" onClick={onBack} disabled={!canGoBack}
                                    className="p-2 hover:bg-white/[0.06] rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent active:scale-90">
                                    <ArrowLeft size={16} />
                                </button>
                                <button type="button" onClick={onForward} disabled={!canGoForward}
                                    className="p-2 hover:bg-white/[0.06] rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent active:scale-90">
                                    <ArrowRight size={16} />
                                </button>
                                <button type="button" onClick={onReload}
                                    className="p-2 hover:bg-white/[0.06] rounded-lg transition-colors active:scale-90">
                                    {isLoading ? <X size={16} /> : <ArrowClockwise size={16} />}
                                </button>
                            </div>

                            <div className="flex-1" />

                            {/* Pin toggle */}
                            <button
                                type="button"
                                onClick={() => onPinnedChange(!isPinned)}
                                className={cn(
                                    "btn-icon h-8 w-8 pointer-events-auto",
                                    isPinned && "bg-brand-muted text-brand"
                                )}
                                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                                title={isPinned ? "Unpin (⌘\\)" : "Pin (⌘\\)"}
                            >
                                {isPinned ? <PushPinSlash className="h-4 w-4" /> : <PushPin className="h-4 w-4" />}
                            </button>
                        </div>

                        {/* URL Display — clickable to open navigation overlay */}
                        {(() => {
                            const isInternalUrl = !currentUrl || currentUrl.startsWith('anthracite://') || currentUrl.startsWith('about:');
                            const isSecure = currentUrl?.startsWith('https://');
                            const getDomain = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };
                            const displayDomain = currentUrl && !isInternalUrl ? getDomain(currentUrl) : null;

                            if (!displayDomain) {
                                return (
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-sm text-text-primary tracking-tight">
                                            {currentRealm?.name || 'Anthracite'}
                                        </span>
                                        <span className="text-[10px] text-text-tertiary font-medium">
                                            {activeRealmTabs.length} tabs
                                        </span>
                                    </div>
                                );
                            }

                            return (
                                <button
                                    type="button"
                                    onClick={onEditUrl}
                                    className={cn(
                                        "flex items-center gap-2.5 w-full px-3 py-2 rounded-lg",
                                        "text-[13px] text-text-secondary font-medium",
                                        "bg-white/[0.04] border border-white/[0.06]",
                                        "hover:bg-white/[0.08] hover:text-text-primary transition-colors",
                                        "active:scale-[0.98]"
                                    )}
                                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                                    title={currentUrl}
                                >
                                    {isLoading ? (
                                        <CircleNotch className="h-3 w-3 text-brand animate-spin shrink-0" />
                                    ) : isSecure ? (
                                        <Lock className="h-3 w-3 text-success shrink-0" />
                                    ) : (
                                        <LockOpen className="h-3 w-3 text-text-tertiary shrink-0" />
                                    )}
                                    <span className="truncate">{displayDomain}</span>
                                </button>
                            );
                        })()}
                    </header>

                    {/* New Tab Button */}
                    <div className="px-3 py-3">
                        <button
                            onClick={() => handleCreateTab()}
                            className={cn(
                                "group flex items-center w-full gap-3 rounded-xl bg-white/[0.04] border border-white/[0.06] px-3 py-2.5",
                                "transition-all duration-200 ease-smooth",
                                "hover:bg-white/[0.08] hover:border-brand/30",
                                "active:scale-[0.98]"
                            )}
                        >
                            <div className={cn(
                                "flex items-center justify-center h-7 w-7 rounded-lg bg-white/[0.08] border border-white/[0.08]",
                                "group-hover:bg-brand group-hover:border-brand group-hover:shadow-glow",
                                "transition-all duration-200"
                            )}>
                                <Plus className="h-3.5 w-3.5 text-text-secondary group-hover:text-white transition-colors" />
                            </div>
                            <span className="text-sm font-medium text-text-secondary group-hover:text-text-primary">
                                New Tab
                            </span>
                            <span className="ml-auto kbd">
                                <span className="text-[9px]">⌘</span>T
                            </span>
                        </button>
                    </div>

                    {/* Main Content Area */}
                    <nav className="flex-1 overflow-y-auto thin-scrollbar px-3 pb-3 space-y-4">
                        {/* Pinned Tabs Section */}
                        {pinnedTabs.length > 0 && (
                            <section>
                                <h2 className="px-3 mb-1 text-[10px] font-semibold text-white/30 uppercase tracking-widest">
                                    Pinned
                                </h2>
                                <ul className="space-y-0.5">
                                    {pinnedTabs.map((tab) => (
                                        <li key={tab.id}>
                                            <div
                                                onClick={() => handleSwitchTab(tab.id)}
                                                onContextMenu={(e) => handleTabContextMenu(e, tab)}
                                                className={cn(
                                                    "flex items-center w-full gap-2 px-3 h-8 rounded-lg cursor-pointer select-none",
                                                    "transition-all duration-150 ease-out group",
                                                    activeTabId === tab.id
                                                        ? "bg-white/[0.07] border-l-2 border-brand text-text-primary pl-[10px]"
                                                        : "text-text-tertiary hover:bg-white/[0.05] hover:text-text-secondary"
                                                )}
                                            >
                                                <div className="h-3.5 w-3.5 shrink-0 flex items-center justify-center overflow-hidden">
                                                    {tab.isLoading ? (
                                                        <CircleNotch className="h-3 w-3 text-brand animate-spin" />
                                                    ) : getFaviconUrl(tab) ? (
                                                        <img
                                                            src={getFaviconUrl(tab)!}
                                                            alt=""
                                                            className="h-3.5 w-3.5 object-contain rounded-[2px]"
                                                        />
                                                    ) : (
                                                        <Globe className="h-3 w-3 text-text-tertiary" />
                                                    )}
                                                </div>
                                                <span className="truncate flex-1 text-left text-[12.5px] font-medium leading-none">
                                                    {tab.title || 'New Tab'}
                                                </span>
                                                <PushPin weight="fill" className="h-2.5 w-2.5 text-brand/60 shrink-0" />
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {/* Tabs Section */}
                        <LooseTabsDropZone looseTabs={looseTabs}>
                            <div className="flex items-center justify-between px-3 mb-1">
                                <h2 className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">
                                    Tabs
                                </h2>
                            </div>
                            <SortableContext
                                items={looseTabs.map(t => t.id)}
                                strategy={verticalListSortingStrategy}
                            >
                                <ul className="space-y-0.5">
                                    <AnimatePresence initial={false}>
                                        {looseTabs.map((tab, index) => (
                                            <motion.li
                                                key={tab.id}
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                transition={{ duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
                                                style={{ overflow: 'hidden' }}
                                            >
                                                <SortableTab
                                                    tab={tab}
                                                    isActive={activeTabId === tab.id}
                                                    containerId="loose"
                                                    showDropIndicator={
                                                        dropTarget?.containerId === 'loose' &&
                                                        dropTarget?.index === index &&
                                                        draggedTab?.id !== tab.id
                                                    }
                                                    onTabClick={handleSwitchTab}
                                                    onTabClose={handleCloseTab}
                                                    onContextMenu={handleTabContextMenu}
                                                />
                                            </motion.li>
                                        ))}
                                    </AnimatePresence>
                                    {/* End-of-list drop indicator */}
                                    {dropTarget?.containerId === 'loose' &&
                                        dropTarget?.index === looseTabs.length &&
                                        looseTabs.length > 0 && (
                                            <li className="h-0.5 mx-2 bg-brand rounded-full" />
                                        )}
                                </ul>
                            </SortableContext>

                            {looseTabs.length === 0 && (
                                <div className="px-3 py-6 text-center text-sm text-text-tertiary">
                                    No tabs open
                                </div>
                            )}
                        </LooseTabsDropZone>

                        {/* Earlier (Archived) Tabs Section */}
                        {archivedTabs.length > 0 && (
                            <div className="mt-1">
                                <button
                                    onClick={() => setShowEarlier(p => !p)}
                                    className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[10px] font-semibold text-white/30 uppercase tracking-widest hover:text-white/50 transition-colors"
                                >
                                    <ClockCounterClockwise className="h-3 w-3" />
                                    Earlier
                                    <span className="ml-1 text-[9px] bg-white/[0.06] px-1.5 py-0.5 rounded-full">
                                        {archivedTabs.length}
                                    </span>
                                    <CaretDown className={cn(
                                        "h-2.5 w-2.5 ml-auto transition-transform duration-200",
                                        showEarlier && "rotate-180"
                                    )} />
                                </button>
                                <AnimatePresence>
                                    {showEarlier && (
                                        <motion.ul
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            exit={{ opacity: 0, height: 0 }}
                                            transition={{ duration: 0.18 }}
                                            className="overflow-hidden space-y-0.5 px-2"
                                        >
                                            {archivedTabs.map(tab => (
                                                <li key={tab.id}>
                                                    <button
                                                        onClick={async () => {
                                                            await window.electron?.tabs.unarchive(tab.id);
                                                            window.electron?.tabs.switch(tab.id);
                                                        }}
                                                        className="flex items-center gap-2 w-full px-3 h-8 rounded-lg text-text-tertiary hover:bg-white/[0.05] hover:text-text-secondary transition-colors"
                                                    >
                                                        <div className="h-3.5 w-3.5 shrink-0 flex items-center justify-center">
                                                            {tab.favicon ? (
                                                                <img src={tab.favicon} alt="" className="h-3.5 w-3.5 object-contain rounded-[2px]" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                                            ) : (
                                                                <Globe className="h-3 w-3" />
                                                            )}
                                                        </div>
                                                        <span className="truncate flex-1 text-left text-[12px] font-medium leading-none opacity-60">
                                                            {tab.title || 'Untitled'}
                                                        </span>
                                                        <button
                                                            onClick={e => { e.stopPropagation(); window.electron?.tabs.close(tab.id); }}
                                                            onMouseDown={e => e.stopPropagation()}
                                                            className="h-4 w-4 rounded flex items-center justify-center shrink-0 opacity-0 hover:!opacity-100 hover:bg-white/[0.12] transition-all group-hover:opacity-40"
                                                        >
                                                            <X className="h-2.5 w-2.5" />
                                                        </button>
                                                    </button>
                                                </li>
                                            ))}
                                        </motion.ul>
                                    )}
                                </AnimatePresence>
                            </div>
                        )}
                    </nav>

                    {/* Realm Switcher */}
                    <div className="border-t border-white/[0.06] py-2">
                        <RealmSwitcher
                            realms={realms}
                            activeRealmId={activeRealmId}
                            onRealmSelect={handleRealmSelect}
                            onCreateRealm={handleCreateRealm}
                            onRealmContextMenu={handleRealmContextMenu}
                        />
                    </div>

                    {/* Footer - Shields */}
                    <footer className="p-3 border-t border-white/[0.06] space-y-2">
                        <button
                            onClick={handleToggleAdBlock}
                            className={cn(
                                "flex items-center w-full gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group",
                                adBlockEnabled
                                    ? "text-success hover:bg-success/10"
                                    : "text-text-secondary hover:bg-white/[0.06]"
                            )}
                        >
                            {adBlockEnabled ? (
                                <ShieldCheckered className="h-[18px] w-[18px] shrink-0 text-success" />
                            ) : (
                                <ShieldSlash className="h-[18px] w-[18px] shrink-0" />
                            )}
                            <span className="font-semibold">{adBlockEnabled ? "Shields UP" : "Shields DOWN"}</span>
                            <span className={cn(
                                "ml-auto text-[10px] px-1.5 py-0.5 rounded-md font-medium",
                                adBlockEnabled ? "bg-success/10 text-success" : "bg-white/[0.06] text-text-tertiary"
                            )}>
                                {adBlockEnabled ? "ON" : "OFF"}
                            </span>
                        </button>

                        {adBlockEnabled && (blockedCount > 0 || httpsUpgradeCount > 0) && (
                            <div className="px-3 py-2 rounded-lg bg-white/[0.03] space-y-1.5">
                                {blockedCount > 0 && (
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-text-secondary">Ads & Trackers blocked</span>
                                        <span className="font-medium text-text-primary">{blockedCount.toLocaleString()}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        <button
                            onClick={onToggleAgentPanel}
                            className="flex items-center w-full gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-all duration-200"
                            title="Toggle Agent Panel"
                        >
                            <Sparkle weight="fill" size={18} className="text-brand shrink-0" />
                            <span>Agent</span>
                        </button>

                        <button
                            onClick={() => window.electron?.navigation.navigate('anthracite://settings')}
                            className="flex items-center w-full gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-all duration-200"
                        >
                            <GearSix className="h-[18px] w-[18px] shrink-0" />
                            <span>Settings</span>
                        </button>
                    </footer>
                </motion.aside>

                {/* Realm Modal (Create/Edit) */}
                <RealmModal
                    isOpen={showRealmModal}
                    mode={editingRealm ? 'edit' : 'create'}
                    realm={editingRealm}
                    onSubmit={handleRealmModalSubmit}
                    onClose={handleRealmModalClose}
                />

                {/* Context Menus */}
                <ContextMenu
                    items={buildTabContextMenuItems()}
                    position={tabContextMenu.contextMenu.position}
                    onSelect={handleTabContextAction}
                    onClose={tabContextMenu.closeContextMenu}
                />
                <ContextMenu
                    items={buildRealmContextMenuItems()}
                    position={realmContextMenu.contextMenu.position}
                    onSelect={handleRealmContextAction}
                    onClose={realmContextMenu.closeContextMenu}
                />
            </>

            {/* Drag Overlay */}
            <DragOverlay dropAnimation={null}>
                {activeId && draggedTab ? <TabDragOverlay tab={draggedTab} /> : null}
            </DragOverlay>
        </DndContext>
    );
}
