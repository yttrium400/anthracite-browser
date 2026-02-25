import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '../lib/utils';
import {
    CaretDown,
    CaretRight,
    Plus,
} from '@phosphor-icons/react';
import { getIconComponent } from './IconPicker';
import { SortableTab } from './SortableTab';
import type { Dock as DockType, ThemeColor } from '../../shared/types';

// Color mappings
const COLOR_BG_MAP: Record<ThemeColor, string> = {
    blue: 'bg-blue-500/15',
    purple: 'bg-purple-500/15',
    pink: 'bg-pink-500/15',
    red: 'bg-red-500/15',
    orange: 'bg-orange-500/15',
    yellow: 'bg-yellow-500/15',
    green: 'bg-green-500/15',
    teal: 'bg-teal-500/15',
    cyan: 'bg-cyan-500/15',
    gray: 'bg-gray-500/15',
};

const COLOR_TEXT_MAP: Record<ThemeColor, string> = {
    blue: 'text-blue-400',
    purple: 'text-purple-400',
    pink: 'text-pink-400',
    red: 'text-red-400',
    orange: 'text-orange-400',
    yellow: 'text-yellow-400',
    green: 'text-green-400',
    teal: 'text-teal-400',
    cyan: 'text-cyan-400',
    gray: 'text-gray-400',
};

const COLOR_BORDER_MAP: Record<ThemeColor, string> = {
    blue: 'border-blue-500/20',
    purple: 'border-purple-500/20',
    pink: 'border-pink-500/20',
    red: 'border-red-500/20',
    orange: 'border-orange-500/20',
    yellow: 'border-yellow-500/20',
    green: 'border-green-500/20',
    teal: 'border-teal-500/20',
    cyan: 'border-cyan-500/20',
    gray: 'border-gray-500/20',
};

interface Tab {
    id: string;
    title: string;
    url: string;
    favicon: string;
    isLoading: boolean;
}

interface DropTarget {
    containerId: string;
    index: number;
}

interface SortableDockProps {
    dock: DockType;
    tabs: Tab[];
    activeTabId: string | null;
    draggedTabId?: string | null;
    dropTarget?: DropTarget | null;
    onToggleCollapse: () => void;
    onTabClick: (tabId: string) => void;
    onTabClose: (tabId: string) => void;
    onAddTab: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    onTabContextMenu?: (e: React.MouseEvent, tab: Tab) => void;
    className?: string;
}

export function SortableDock({
    dock,
    tabs,
    activeTabId,
    draggedTabId,
    dropTarget,
    onToggleCollapse,
    onTabClick,
    onTabClose,
    onAddTab,
    onContextMenu,
    onTabContextMenu,
    className,
}: SortableDockProps) {
    const bgColor = COLOR_BG_MAP[dock.color] || COLOR_BG_MAP.gray;
    const textColor = COLOR_TEXT_MAP[dock.color] || COLOR_TEXT_MAP.gray;
    const borderColor = COLOR_BORDER_MAP[dock.color] || COLOR_BORDER_MAP.gray;
    const DockIcon = getIconComponent(dock.icon);

    // Make the dock sortable (for reordering docks)
    const {
        attributes,
        listeners,
        setNodeRef: setSortableRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: `dock-${dock.id}`,
        data: {
            type: 'dock',
            dock,
            dockId: dock.id, // Also include dockId for consistent drop handling
        },
    });

    // Make the dock a droppable area for tabs (separate from sortable)
    const { isOver, setNodeRef: setDroppableRef } = useDroppable({
        id: `dock-drop-${dock.id}`,
        data: {
            type: 'dock-drop', // Different type to distinguish from dock sortable
            dockId: dock.id,
        },
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const tabIds = tabs.map(t => t.id);

    // Combine refs
    const setNodeRef = (node: HTMLDivElement | null) => {
        setSortableRef(node);
        setDroppableRef(node);
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "rounded-xl overflow-hidden transition-all duration-200",
                isOver && "ring-2 ring-brand/50 bg-brand/5",
                isDragging && "z-50 shadow-lg",
                className
            )}
            onContextMenu={onContextMenu}
        >
            {/* Dock Header */}
            <div
                className={cn(
                    "w-full flex items-center gap-2 px-3 py-2.5",
                    "transition-colors duration-200",
                    bgColor,
                    "hover:brightness-95",
                    "group"
                )}
            >
                {/* Drag Handle */}
                <div
                    {...attributes}
                    {...listeners}
                    className={cn(
                        "h-4 w-4 shrink-0 flex items-center justify-center cursor-grab",
                        "opacity-0 group-hover:opacity-100 transition-opacity",
                        textColor
                    )}
                    onClick={(e) => e.stopPropagation()}
                >
                    
                </div>

                {/* Collapse toggle */}
                <button
                    onClick={onToggleCollapse}
                    className={cn("transition-transform duration-200", textColor)}
                >
                    {dock.isCollapsed ? (
                        <CaretRight className="h-4 w-4" />
                    ) : (
                        <CaretDown className="h-4 w-4" />
                    )}
                </button>

                {/* Dock icon */}
                <DockIcon className={cn("h-4 w-4", textColor)} />

                {/* Dock name */}
                <span
                    className={cn("flex-1 text-left text-sm font-medium truncate cursor-pointer", textColor)}
                    onClick={onToggleCollapse}
                >
                    {dock.name}
                </span>

                {/* Tab count badge */}
                <span className={cn(
                    "text-xs font-medium px-1.5 py-0.5 rounded-md",
                    bgColor,
                    textColor,
                    "border",
                    borderColor
                )}>
                    {tabs.length}
                </span>

                {/* Add tab button (visible on hover) */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onAddTab();
                    }}
                    className={cn(
                        "opacity-0 group-hover:opacity-100",
                        "h-6 w-6 rounded-md flex items-center justify-center",
                        "transition-all duration-200",
                        "hover:bg-white/[0.06]",
                        textColor
                    )}
                    title="Add tab to dock"
                >
                    <Plus className="h-3.5 w-3.5" />
                </button>
            </div>

            {/* Tabs list - collapsible */}
            <div
                className={cn(
                    "overflow-hidden transition-all duration-200 ease-out",
                    dock.isCollapsed ? "max-h-0" : "max-h-[1000px]"
                )}
            >
                <SortableContext
                    items={tabIds}
                    strategy={verticalListSortingStrategy}
                >
                    <ul className="py-1 space-y-0.5 px-1">
                        {tabs.map((tab, index) => (
                            <li key={tab.id}>
                                <SortableTab
                                    tab={tab}
                                    isActive={activeTabId === tab.id}
                                    containerId={dock.id}
                                    textColor={textColor}
                                    borderColor={borderColor}
                                    showDropIndicator={
                                        dropTarget?.containerId === dock.id &&
                                        dropTarget?.index === index &&
                                        draggedTabId !== tab.id
                                    }
                                    onTabClick={onTabClick}
                                    onTabClose={onTabClose}
                                    onContextMenu={onTabContextMenu}
                                />
                            </li>
                        ))}

                        {/* End-of-list drop indicator */}
                        {dropTarget?.containerId === dock.id &&
                            dropTarget?.index === tabs.length &&
                            tabs.length > 0 && (
                            <li className="h-0.5 mx-2 bg-brand rounded-full" />
                        )}

                        {/* Empty state with drop indicator */}
                        {tabs.length === 0 && (
                            <li className={cn(
                                "px-3 py-4 text-center",
                                dropTarget?.containerId === dock.id && "ring-2 ring-brand/50 rounded-lg bg-brand/5"
                            )}>
                                <p className="text-xs text-text-tertiary">
                                    {dropTarget?.containerId === dock.id ? 'Drop here' : 'No tabs in this dock'}
                                </p>
                                {dropTarget?.containerId !== dock.id && (
                                    <button
                                        onClick={onAddTab}
                                        className={cn(
                                            "mt-2 text-xs font-medium",
                                            textColor,
                                            "hover:underline"
                                        )}
                                    >
                                        Add a tab
                                    </button>
                                )}
                            </li>
                        )}
                    </ul>
                </SortableContext>
            </div>
        </div>
    );
}

// Overlay component for dock drag preview
export function DockDragOverlay({ dock, tabCount }: { dock: DockType; tabCount: number }) {
    const bgColor = COLOR_BG_MAP[dock.color] || COLOR_BG_MAP.gray;
    const textColor = COLOR_TEXT_MAP[dock.color] || COLOR_TEXT_MAP.gray;
    const borderColor = COLOR_BORDER_MAP[dock.color] || COLOR_BORDER_MAP.gray;
    const DockIcon = getIconComponent(dock.icon);

    return (
        <div className={cn(
            "flex items-center gap-2 px-3 py-2.5 rounded-xl",
            "bg-[#1A1A1D] shadow-xl border border-brand/30",
            "pointer-events-none w-[260px]",
            bgColor
        )}>
            <DockIcon className={cn("h-4 w-4", textColor)} />
            <span className={cn("flex-1 text-left text-sm font-medium truncate", textColor)}>
                {dock.name}
            </span>
            <span className={cn(
                "text-xs font-medium px-1.5 py-0.5 rounded-md border",
                bgColor, textColor, borderColor
            )}>
                {tabCount}
            </span>
        </div>
    );
}
