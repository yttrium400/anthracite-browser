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
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { cn } from '../lib/utils';
import {
    Settings,
    Plus,
    Globe,
    Pin,
    PinOff,
    ShieldOff,
    ShieldCheck,
    X,
    Loader2,
    FolderPlus,
    Trash2,
    Edit3,
    FolderInput,
    ArrowRightCircle,
    Copy,
} from 'lucide-react';
import { RealmSwitcher } from './RealmSwitcher';
import { SortableDock, DockDragOverlay } from './SortableDock';
import { RealmModal } from './RealmModal';
import { DockModal } from './DockModal';
import { ContextMenu, useContextMenu, ContextMenuItem } from './ContextMenu';
import { SortableTab, TabDragOverlay } from './SortableTab';
import type { Realm, Dock as DockType, IconName, ThemeColor } from '../../shared/types';
import type { RealmTemplate } from '../../shared/templates';

interface SidebarProps {
    className?: string;
    isPinned: boolean;
    onPinnedChange: (pinned: boolean) => void;
    tabs: Tab[];
    activeTabId: string | null;
}

// ... existing interfaces ...

// ... existing interfaces ...

interface Tab {
    id: string;
    title: string;
    url: string;
    favicon: string;
    isLoading: boolean;
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
    activeRealmDocks: any[];
    children: React.ReactNode;
}

function LooseTabsDropZone({ looseTabs, activeRealmDocks, children }: LooseTabsDropZoneProps) {
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

function CreateDockDropZone({ children }: { children: React.ReactNode }) {
    const { isOver, setNodeRef } = useDroppable({
        id: 'create-dock-dropzone',
        data: {
            type: 'create-dock',
        },
    });

    return (
        <div
            ref={setNodeRef}
            className={cn(
                "mt-2 border-2 border-dashed rounded-xl transition-all duration-200 flex items-center justify-center",
                isOver
                    ? "border-brand bg-brand/5 h-24 opacity-100 scale-105"
                    : "border-border/40 hover:border-brand/50 h-16 opacity-80"
            )}
        >
            {children}
        </div>
    );
}

export function Sidebar({ className, isPinned, onPinnedChange, tabs, activeTabId }: SidebarProps) {
    const [isVisible, setIsVisible] = useState(false);

    // Ad blocker state
    const [adBlockEnabled, setAdBlockEnabled] = useState(true);
    const [blockedCount, setBlockedCount] = useState(0);
    const [httpsUpgradeCount, setHttpsUpgradeCount] = useState(0);

    // Realms & Docks state
    const [realms, setRealms] = useState<Realm[]>([]);
    const [docks, setDocks] = useState<DockType[]>([]);
    const [activeRealmId, setActiveRealmId] = useState<string>('');
    const [tabOrganizations, setTabOrganizations] = useState<Record<string, TabOrganization>>({});

    const sidebarRef = useRef<HTMLDivElement>(null);

    // Modal state
    const [showRealmModal, setShowRealmModal] = useState(false);
    const [showDockModal, setShowDockModal] = useState(false);
    const [editingRealm, setEditingRealm] = useState<Realm | null>(null);
    const [editingDock, setEditingDock] = useState<DockType | null>(null);

    // Context menu state
    const tabContextMenu = useContextMenu();
    const dockContextMenu = useContextMenu();
    const realmContextMenu = useContextMenu();

    // Drag and Drop state
    const [activeId, setActiveId] = useState<string | null>(null);
    const [draggedTab, setDraggedTab] = useState<Tab | null>(null);
    const [draggedDock, setDraggedDock] = useState<DockType | null>(null);
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
            setDocks(state.docks);

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
            setDocks(state.docks);
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

        // Dock subscriptions
        const unsubscribeDockCreated = window.electron.docks.onCreated((dock) => {
            setDocks(prev => [...prev, dock].sort((a, b) => a.order - b.order));
        });
        const unsubscribeDockUpdated = window.electron.docks.onUpdated((dock) => {
            setDocks(prev => prev.map(d => d.id === dock.id ? dock : d));
        });
        const unsubscribeDockDeleted = window.electron.docks.onDeleted(({ dockId }) => {
            setDocks(prev => prev.filter(d => d.id !== dockId));
        });
        const unsubscribeDockReordered = window.electron.docks.onReordered(({ dockIds }) => {
            // Update dock order based on the new order
            setDocks(prev => {
                const updated = prev.map(dock => {
                    const newOrder = dockIds.indexOf(dock.id);
                    if (newOrder !== -1) {
                        return { ...dock, order: newOrder };
                    }
                    return dock;
                });
                return updated.sort((a, b) => a.order - b.order);
            });
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
            unsubscribeDockCreated();
            unsubscribeDockUpdated();
            unsubscribeDockDeleted();
            unsubscribeDockReordered();
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
            dockContextMenu.contextMenu.position ||
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
    }, [isPinned, activeId, tabContextMenu.contextMenu.position, dockContextMenu.contextMenu.position, realmContextMenu.contextMenu.position]);

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
    const handleCreateTab = useCallback((dockId?: string) => {
        window.electron?.tabs.create(undefined, dockId ? { dockId } : undefined);
    }, []);

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

    // Dock actions
    const handleCreateDock = useCallback(() => {
        setShowDockModal(true);
    }, []);

    const handleDockModalSubmit = useCallback(async (data: { name: string; icon: IconName; color: ThemeColor }) => {
        if (editingDock) {
            await window.electron?.docks.update(editingDock.id, data);
            setEditingDock(null);
        } else if (activeRealmId) {
            await window.electron?.docks.create(data.name, activeRealmId, data.icon, data.color);
        }
    }, [activeRealmId, editingDock]);

    const handleDockModalClose = useCallback(() => {
        setShowDockModal(false);
        setEditingDock(null);
    }, []);

    const handleToggleDockCollapse = useCallback((dockId: string) => {
        window.electron?.docks.toggleCollapse(dockId);
    }, []);

    // DnD Event Handlers
    const handleDragStart = useCallback((event: DragStartEvent) => {
        const { active } = event;
        setActiveId(active.id as string);

        // Check if dragging a dock
        const activeData = active.data.current;
        if (activeData?.type === 'dock' && activeData.dock) {
            setDraggedDock(activeData.dock as DockType);
            setDraggedTab(null);
            return;
        }

        // Find the tab being dragged
        const tab = tabs.find(t => t.id === active.id);
        if (tab) {
            setDraggedTab(tab);
            setDraggedDock(null);
        }
    }, [tabs]);

    const handleDragOver = useCallback((event: DragOverEvent) => {
        const { active, over } = event;

        if (!over || !draggedTab) {
            setDropTarget(null);
            return;
        }

        const overData = over.data.current;
        let containerId: string | null = null;
        let index = 0;

        if (overData?.type === 'dock' || overData?.type === 'dock-drop') {
            containerId = overData.dockId as string;
            // Dropping on dock itself means end of list
            const dockTabs = tabs.filter(t => tabOrganizations[t.id]?.dockId === containerId);
            index = dockTabs.length;
        } else if (overData?.type === 'tab') {
            containerId = (overData.containerId as string) || 'loose';
            // Find the index of the tab we're hovering over
            const containerTabs = containerId === 'loose'
                ? tabs.filter(t => {
                    const org = tabOrganizations[t.id];
                    return org?.realmId === activeRealmId && !org?.dockId && !org?.isPinned;
                }).sort((a, b) => (tabOrganizations[a.id]?.order || 0) - (tabOrganizations[b.id]?.order || 0))
                : tabs.filter(t => tabOrganizations[t.id]?.dockId === containerId)
                    .sort((a, b) => (tabOrganizations[a.id]?.order || 0) - (tabOrganizations[b.id]?.order || 0));

            index = containerTabs.findIndex(t => t.id === over.id);
            if (index === -1) index = containerTabs.length;
        } else if ((over.id as string) === 'loose-tabs-dropzone') {
            containerId = 'loose';
            const looseTabs = tabs.filter(t => {
                const org = tabOrganizations[t.id];
                return org?.realmId === activeRealmId && !org?.dockId && !org?.isPinned;
            });
            index = looseTabs.length;
        }

        if (containerId) {
            // Check if the dragged tab is from the same container
            const sourceContainerId = tabOrganizations[active.id as string]?.dockId || 'loose';
            const isSameContainer = (sourceContainerId === containerId) ||
                (sourceContainerId === null && containerId === 'loose');

            // Adjust index if moving within same container and source is before target
            if (isSameContainer) {
                const containerTabs = containerId === 'loose'
                    ? tabs.filter(t => {
                        const org = tabOrganizations[t.id];
                        return org?.realmId === activeRealmId && !org?.dockId && !org?.isPinned;
                    }).sort((a, b) => (tabOrganizations[a.id]?.order || 0) - (tabOrganizations[b.id]?.order || 0))
                    : tabs.filter(t => tabOrganizations[t.id]?.dockId === containerId)
                        .sort((a, b) => (tabOrganizations[a.id]?.order || 0) - (tabOrganizations[b.id]?.order || 0));

                const sourceIndex = containerTabs.findIndex(t => t.id === active.id);
                if (sourceIndex !== -1 && sourceIndex < index) {
                    index = index; // Keep as is, indicator shows after the hovered item
                }
            }

            setDropTarget({ containerId, index });
        } else {
            setDropTarget(null);
        }
    }, [draggedTab, tabs, tabOrganizations, activeRealmId]);

    const handleDragEnd = useCallback(async (event: DragEndEvent) => {
        const { active, over } = event;

        setActiveId(null);
        setDraggedTab(null);
        setDraggedDock(null);
        setDropTarget(null);

        if (!over) return;
        if (active.id === over.id) return; // No change needed

        const activeData = active.data.current;
        const overData = over.data.current;

        if (!activeData) return;

        // Handle dock reordering
        if (activeData.type === 'dock') {
            const activeDockId = (active.id as string).replace('dock-', '');
            const overDockId = (over.id as string).replace('dock-', '');

            // Only reorder if dropped on another dock
            if (overData?.type === 'dock' || (over.id as string).startsWith('dock-')) {
                const currentDocks = docks
                    .filter(d => d.realmId === activeRealmId)
                    .sort((a, b) => a.order - b.order);

                const oldIndex = currentDocks.findIndex(d => d.id === activeDockId);
                const newIndex = currentDocks.findIndex(d => d.id === overDockId);

                if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
                    const newOrder = [...currentDocks];
                    const [movedItem] = newOrder.splice(oldIndex, 1);
                    newOrder.splice(newIndex, 0, movedItem);
                    const dockIds = newOrder.map(d => d.id);

                    // Optimistic update
                    setDocks(prev => {
                        const updated = prev.map((dock, idx) => {
                            const newIdx = dockIds.indexOf(dock.id);
                            return newIdx !== -1 ? { ...dock, order: newIdx } : dock;
                        });
                        return updated.sort((a, b) => a.order - b.order);
                    });

                    await window.electron?.docks.reorder(activeRealmId, dockIds);
                }
            }
            return;
        }

        // Handle tab dragging
        const activeTabId = active.id as string;
        const overId = over.id as string;

        // Default to 'loose' if containerId is undefined (for legacy tabs)
        const sourceContainerId = (activeData.containerId as string) || 'loose';

        // Determine target container
        let targetContainerId: string | null = null;

        if (overData?.type === 'dock' || overData?.type === 'dock-drop') {
            // Dropped directly on a dock (either sortable or droppable zone)
            targetContainerId = overData.dockId as string;
        } else if (overData?.type === 'tab') {
            // Dropped on another tab - use the tab's container
            targetContainerId = (overData.containerId as string) || 'loose';
        } else if (overId === 'loose-tabs-dropzone') {
            // Dropped on loose tabs section
            targetContainerId = 'loose';
        } else if (overId === 'create-dock-dropzone') {
            // Create new dock from tab
            const newDockName = draggedTab?.title ? `Group: ${draggedTab.title.slice(0, 15)}...` : 'New Group';

            // 1. Create the dock
            const newDock = await window.electron?.docks.create(newDockName, activeRealmId, 'folder', 'blue');

            if (newDock) {
                // 2. Move tab to the new dock
                await window.electron?.tabOrganization.moveToDock(activeTabId, newDock.id);
                await refreshState();
            }
            return;
        }

        if (!targetContainerId) return;

        // Handle cross-container moves
        if (sourceContainerId !== targetContainerId) {
            // Optimistic update for cross-container move
            setTabOrganizations(prev => ({
                ...prev,
                [activeTabId]: {
                    ...prev[activeTabId],
                    dockId: targetContainerId === 'loose' ? null : targetContainerId,
                    order: 0,
                },
            }));

            if (targetContainerId === 'loose') {
                await window.electron?.tabOrganization.moveToLoose(activeTabId);
            } else {
                await window.electron?.tabOrganization.moveToDock(activeTabId, targetContainerId);
            }
            // Refresh to get correct order
            await refreshState();
        } else {
            // Reorder within same container - only if dropped on a tab
            if (overData?.type === 'tab') {
                // Get tabs in this container, SORTED by order (critical!)
                const getContainerTabs = () => {
                    if (targetContainerId === 'loose') {
                        return tabs
                            .filter(tab => {
                                const org = tabOrganizations[tab.id];
                                return org?.realmId === activeRealmId && !org?.dockId && !org?.isPinned;
                            })
                            .sort((a, b) => (tabOrganizations[a.id]?.order || 0) - (tabOrganizations[b.id]?.order || 0));
                    } else {
                        return tabs
                            .filter(t => tabOrganizations[t.id]?.dockId === targetContainerId)
                            .sort((a, b) => (tabOrganizations[a.id]?.order || 0) - (tabOrganizations[b.id]?.order || 0));
                    }
                };

                const containerTabs = getContainerTabs();
                const oldIndex = containerTabs.findIndex(t => t.id === activeTabId);
                const newIndex = containerTabs.findIndex(t => t.id === overId);

                if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
                    // Use arrayMove pattern for correct reordering
                    const newOrder = [...containerTabs];
                    const [movedItem] = newOrder.splice(oldIndex, 1);
                    newOrder.splice(newIndex, 0, movedItem);
                    const tabIds = newOrder.map(t => t.id);

                    // Optimistic update for reorder
                    setTabOrganizations(prev => {
                        const updated = { ...prev };
                        tabIds.forEach((id, idx) => {
                            if (updated[id]) {
                                updated[id] = { ...updated[id], order: idx };
                            }
                        });
                        return updated;
                    });

                    if (targetContainerId === 'loose') {
                        await window.electron?.tabOrganization.reorderLoose(activeRealmId, tabIds);
                    } else {
                        await window.electron?.tabOrganization.reorderInDock(targetContainerId, tabIds);
                    }
                }
            }
        }
    }, [tabs, tabOrganizations, activeRealmId, docks, refreshState]);


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

    const handleDockContextMenu = useCallback((e: React.MouseEvent, dock: DockType) => {
        dockContextMenu.openContextMenu(e, dock);
    }, [dockContextMenu]);

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
        } else if (actionId === 'move-to-loose') {
            await window.electron?.tabOrganization.moveToLoose(tab.id);
        } else if (actionId.startsWith('move-to-dock:')) {
            const dockId = actionId.replace('move-to-dock:', '');
            await window.electron?.tabOrganization.moveToDock(tab.id, dockId);
        } else if (actionId.startsWith('move-to-realm:')) {
            const realmId = actionId.replace('move-to-realm:', '');
            await window.electron?.tabOrganization.moveToRealm(tab.id, realmId);
        }
    }, [tabContextMenu.contextMenu.data, handleCloseTab]);

    // Dock context menu action handler
    const handleDockContextAction = useCallback(async (actionId: string) => {
        const dock = dockContextMenu.contextMenu.data as DockType;
        if (!dock) return;

        if (actionId === 'edit') {
            setEditingDock(dock);
            setShowDockModal(true);
        } else if (actionId === 'delete') {
            await window.electron?.docks.delete(dock.id);
        } else if (actionId.startsWith('move-to-realm:')) {
            const realmId = actionId.replace('move-to-realm:', '');
            await window.electron?.docks.moveToRealm(dock.id, realmId);
        }
    }, [dockContextMenu.contextMenu.data]);

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

    // Get docks for active realm
    const activeRealmDocks = docks.filter(d => d.realmId === activeRealmId);

    // Get tabs for a specific dock
    const getTabsForDock = (dockId: string) => {
        return activeRealmTabs
            .filter(tab => {
                const org = tabOrganizations[tab.id];
                return org?.dockId === dockId;
            })
            .sort((a, b) => (tabOrganizations[a.id]?.order || 0) - (tabOrganizations[b.id]?.order || 0));
    };

    // Get loose tabs (not in any dock, not pinned)
    const looseTabs = activeRealmTabs
        .filter(tab => {
            const org = tabOrganizations[tab.id];
            return !org?.dockId && !org?.isPinned;
        })
        .sort((a, b) => (tabOrganizations[a.id]?.order || 0) - (tabOrganizations[b.id]?.order || 0));

    // Current realm
    const currentRealm = realms.find(r => r.id === activeRealmId);


    // Build tab context menu items
    const buildTabContextMenuItems = useCallback((): ContextMenuItem[] => {
        const tab = tabContextMenu.contextMenu.data as Tab;
        if (!tab) return [];

        const org = tabOrganizations[tab.id];
        const isPinned = org?.isPinned;
        const currentDockId = org?.dockId;

        const items: ContextMenuItem[] = [
            {
                id: isPinned ? 'unpin' : 'pin',
                label: isPinned ? 'Unpin Tab' : 'Pin Tab',
                icon: isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />,
            },
            { id: 'divider-1', label: '', divider: true },
            {
                id: 'copy-url',
                label: 'Copy URL',
                icon: <Copy className="h-4 w-4" />,
                shortcut: '⌘C',
            },
        ];

        // Move to dock submenu
        if (activeRealmDocks.length > 0) {
            const dockSubmenu: ContextMenuItem[] = activeRealmDocks
                .filter(d => d.id !== currentDockId)
                .map(d => ({
                    id: `move-to-dock:${d.id}`,
                    label: d.name,
                }));

            if (currentDockId) {
                dockSubmenu.unshift({
                    id: 'move-to-loose',
                    label: 'Remove from Dock',
                });
            }

            if (dockSubmenu.length > 0) {
                items.push({
                    id: 'move-to-dock',
                    label: 'Move to Dock',
                    icon: <FolderInput className="h-4 w-4" />,
                    submenu: dockSubmenu,
                });
            }
        }

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
                    icon: <ArrowRightCircle className="h-4 w-4" />,
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
    }, [tabContextMenu.contextMenu.data, tabOrganizations, activeRealmDocks, realms, activeRealmId]);

    // Build dock context menu items
    const buildDockContextMenuItems = useCallback((): ContextMenuItem[] => {
        const dock = dockContextMenu.contextMenu.data as DockType;
        if (!dock) return [];

        const items: ContextMenuItem[] = [
            {
                id: 'edit',
                label: 'Edit Dock',
                icon: <Edit3 className="h-4 w-4" />,
            },
        ];

        // Move to realm submenu (only if there are multiple realms)
        if (realms.length > 1) {
            const realmSubmenu: ContextMenuItem[] = realms
                .filter(r => r.id !== dock.realmId)
                .map(r => ({
                    id: `move-to-realm:${r.id}`,
                    label: r.name,
                }));

            if (realmSubmenu.length > 0) {
                items.push({
                    id: 'move-to-realm',
                    label: 'Move to Realm',
                    icon: <ArrowRightCircle className="h-4 w-4" />,
                    submenu: realmSubmenu,
                });
            }
        }

        items.push(
            { id: 'divider-1', label: '', divider: true },
            {
                id: 'delete',
                label: 'Delete Dock',
                icon: <Trash2 className="h-4 w-4" />,
                danger: true,
            }
        );

        return items;
    }, [dockContextMenu.contextMenu.data, realms]);

    // Build realm context menu items
    const buildRealmContextMenuItems = useCallback((): ContextMenuItem[] => {
        const realm = realmContextMenu.contextMenu.data as Realm;
        if (!realm) return [];

        return [
            {
                id: 'edit',
                label: 'Edit Realm',
                icon: <Edit3 className="h-4 w-4" />,
            },
            { id: 'divider-1', label: '', divider: true },
            {
                id: 'delete',
                label: 'Delete Realm',
                icon: <Trash2 className="h-4 w-4" />,
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
                        "fixed left-3 top-3 bottom-3 w-[280px] z-[200]",
                        "bg-[#111113]/90 backdrop-blur-2xl",
                        "rounded-2xl border border-white/[0.06]",
                        "shadow-large",
                        "flex flex-col",
                        className
                    )}
                    initial={false}
                    animate={{
                        x: isPinned || isVisible ? 0 : -(280 + 20),
                        opacity: isPinned || isVisible ? 1 : 0,
                    }}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                >
                    {/* Header */}
                    <header className="flex items-center justify-between h-14 px-4 border-b border-white/[0.06]">
                        <div className="flex items-center gap-2.5">
                            <div className="flex flex-col">
                                <span className="font-semibold text-sm text-text-primary tracking-tight">
                                    {currentRealm?.name || 'Poseidon'}
                                </span>
                                <span className="text-[10px] text-text-tertiary font-medium">
                                    {activeRealmTabs.length} tabs
                                </span>
                            </div>
                        </div>

                        <button
                            onClick={() => onPinnedChange(!isPinned)}
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
                                <h2 className="px-3 mb-2 text-[11px] font-semibold text-white/40 uppercase tracking-wider flex items-center gap-1.5">
                                    <Pin className="h-3 w-3" />
                                    Pinned
                                </h2>
                                <ul className="space-y-0.5">
                                    {pinnedTabs.map((tab) => (
                                        <li key={tab.id}>
                                            <div
                                                onClick={() => handleSwitchTab(tab.id)}
                                                onContextMenu={(e) => handleTabContextMenu(e, tab)}
                                                className={cn(
                                                    "flex items-center w-full gap-3 px-3 py-2 rounded-xl text-sm font-medium cursor-pointer",
                                                    "transition-all duration-200 ease-smooth group",
                                                    activeTabId === tab.id
                                                        ? "bg-white/[0.08] text-text-primary border-l-2 border-brand"
                                                        : "text-text-secondary hover:bg-white/[0.06] hover:text-text-primary"
                                                )}
                                            >
                                                <div className="h-5 w-5 rounded shrink-0 flex items-center justify-center bg-white/[0.06] overflow-hidden">
                                                    {tab.isLoading ? (
                                                        <Loader2 className="h-3 w-3 text-brand animate-spin" />
                                                    ) : getFaviconUrl(tab) ? (
                                                        <img
                                                            src={getFaviconUrl(tab)!}
                                                            alt=""
                                                            className="h-4 w-4 object-contain"
                                                        />
                                                    ) : (
                                                        <Globe className="h-3 w-3 text-text-tertiary" />
                                                    )}
                                                </div>
                                                <span className="truncate flex-1 text-left">
                                                    {tab.title || 'New Tab'}
                                                </span>
                                                <Pin className="h-3 w-3 text-text-tertiary shrink-0" />
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {/* Docks Section */}
                        {activeRealmDocks.length > 0 && (
                            <section className="space-y-2">
                                <div className="flex items-center justify-between px-3">
                                    <h2 className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
                                        Docks
                                    </h2>
                                    <button
                                        onClick={handleCreateDock}
                                        className="text-text-tertiary hover:text-brand transition-colors"
                                        title="Create dock"
                                    >
                                        <FolderPlus className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                                <SortableContext
                                    items={activeRealmDocks.map(d => `dock-${d.id}`)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    {activeRealmDocks.map((dock) => (
                                        <SortableDock
                                            key={dock.id}
                                            dock={dock}
                                            tabs={getTabsForDock(dock.id)}
                                            activeTabId={activeTabId}
                                            draggedTabId={draggedTab?.id}
                                            dropTarget={dropTarget}
                                            onToggleCollapse={() => handleToggleDockCollapse(dock.id)}
                                            onTabClick={handleSwitchTab}
                                            onTabClose={handleCloseTab}
                                            onAddTab={() => handleCreateTab(dock.id)}
                                            onContextMenu={(e) => handleDockContextMenu(e, dock)}
                                            onTabContextMenu={handleTabContextMenu}
                                        />
                                    ))}
                                </SortableContext>
                            </section>
                        )}

                        {/* Loose Tabs Section */}
                        <LooseTabsDropZone looseTabs={looseTabs} activeRealmDocks={activeRealmDocks}>
                            <div className="flex items-center justify-between px-3 mb-2">
                                <h2 className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
                                    Tabs ({looseTabs.length})
                                </h2>
                                {activeRealmDocks.length === 0 && (
                                    <button
                                        onClick={handleCreateDock}
                                        className="text-text-tertiary hover:text-brand transition-colors"
                                        title="Create dock"
                                    >
                                        <FolderPlus className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                            <SortableContext
                                items={looseTabs.map(t => t.id)}
                                strategy={verticalListSortingStrategy}
                            >
                                <ul className="space-y-0.5">
                                    {looseTabs.map((tab, index) => (
                                        <li key={tab.id}>
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
                                        </li>
                                    ))}
                                    {/* End-of-list drop indicator */}
                                    {dropTarget?.containerId === 'loose' &&
                                        dropTarget?.index === looseTabs.length &&
                                        looseTabs.length > 0 && (
                                            <li className="h-0.5 mx-2 bg-brand rounded-full" />
                                        )}
                                </ul>
                            </SortableContext>

                            {looseTabs.length === 0 && activeRealmDocks.length === 0 && (
                                <div className="px-3 py-6 text-center text-sm text-text-tertiary">
                                    No tabs open
                                </div>
                            )}
                        </LooseTabsDropZone>

                        {/* Create Dock Drop Zone (only visible when dragging a tab) */}
                        {activeId && draggedTab && !activeRealmDocks.some(d => d.id === 'create-dock-dropzone') && (
                            <CreateDockDropZone>
                                <div className="flex flex-col items-center gap-1 text-text-tertiary">
                                    <FolderPlus className="h-5 w-5" />
                                    <span className="text-xs font-medium">Drop to Create Dock</span>
                                </div>
                            </CreateDockDropZone>
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
                                <ShieldCheck className="h-[18px] w-[18px] shrink-0 text-success" />
                            ) : (
                                <ShieldOff className="h-[18px] w-[18px] shrink-0" />
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
                            onClick={() => window.electron?.navigation.navigate('poseidon://settings')}
                            className="flex items-center w-full gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-all duration-200"
                        >
                            <Settings className="h-[18px] w-[18px] shrink-0" />
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

                {/* Dock Modal (Create/Edit) */}
                <DockModal
                    isOpen={showDockModal}
                    mode={editingDock ? 'edit' : 'create'}
                    dock={editingDock}
                    onSubmit={handleDockModalSubmit}
                    onClose={handleDockModalClose}
                />

                {/* Context Menus */}
                <ContextMenu
                    items={buildTabContextMenuItems()}
                    position={tabContextMenu.contextMenu.position}
                    onSelect={handleTabContextAction}
                    onClose={tabContextMenu.closeContextMenu}
                />
                <ContextMenu
                    items={buildDockContextMenuItems()}
                    position={dockContextMenu.contextMenu.position}
                    onSelect={handleDockContextAction}
                    onClose={dockContextMenu.closeContextMenu}
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
                {activeId && draggedTab ? (
                    <TabDragOverlay tab={draggedTab} />
                ) : activeId && draggedDock ? (
                    <DockDragOverlay dock={draggedDock} tabCount={getTabsForDock(draggedDock.id).length} />
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}
