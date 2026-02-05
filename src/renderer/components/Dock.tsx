import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '../lib/utils';
import {
    ChevronDown,
    ChevronRight,
    Plus,
} from 'lucide-react';
import { getIconComponent } from './IconPicker';
import { SortableTab } from './SortableTab';
import type { Dock as DockType, ThemeColor } from '../../shared/types';

// Color mappings
const COLOR_BG_MAP: Record<ThemeColor, string> = {
    blue: 'bg-blue-500/10',
    purple: 'bg-purple-500/10',
    pink: 'bg-pink-500/10',
    red: 'bg-red-500/10',
    orange: 'bg-orange-500/10',
    yellow: 'bg-yellow-500/10',
    green: 'bg-green-500/10',
    teal: 'bg-teal-500/10',
    cyan: 'bg-cyan-500/10',
    gray: 'bg-gray-500/10',
};

const COLOR_TEXT_MAP: Record<ThemeColor, string> = {
    blue: 'text-blue-600',
    purple: 'text-purple-600',
    pink: 'text-pink-600',
    red: 'text-red-600',
    orange: 'text-orange-600',
    yellow: 'text-yellow-600',
    green: 'text-green-600',
    teal: 'text-teal-600',
    cyan: 'text-cyan-600',
    gray: 'text-gray-600',
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

interface DockProps {
    dock: DockType;
    tabs: Tab[];
    activeTabId: string | null;
    onToggleCollapse: () => void;
    onTabClick: (tabId: string) => void;
    onTabClose: (tabId: string) => void;
    onAddTab: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    onTabContextMenu?: (e: React.MouseEvent, tab: Tab) => void;
    className?: string;
}

export function Dock({
    dock,
    tabs,
    activeTabId,
    onToggleCollapse,
    onTabClick,
    onTabClose,
    onAddTab,
    onContextMenu,
    onTabContextMenu,
    className,
}: DockProps) {
    const bgColor = COLOR_BG_MAP[dock.color] || COLOR_BG_MAP.gray;
    const textColor = COLOR_TEXT_MAP[dock.color] || COLOR_TEXT_MAP.gray;
    const borderColor = COLOR_BORDER_MAP[dock.color] || COLOR_BORDER_MAP.gray;
    const DockIcon = getIconComponent(dock.icon);

    // Make the dock a droppable area
    const { isOver, setNodeRef } = useDroppable({
        id: `dock-${dock.id}`,
        data: {
            type: 'dock',
            dockId: dock.id,
        },
    });

    const tabIds = tabs.map(t => t.id);

    return (
        <div
            ref={setNodeRef}
            className={cn(
                "rounded-xl overflow-hidden transition-all duration-200",
                isOver && "ring-2 ring-brand/50 bg-brand/5",
                className
            )}
            onContextMenu={onContextMenu}
        >
            {/* Dock Header */}
            <button
                onClick={onToggleCollapse}
                className={cn(
                    "w-full flex items-center gap-2 px-3 py-2.5",
                    "transition-colors duration-200",
                    bgColor,
                    "hover:brightness-95",
                    "group"
                )}
            >
                {/* Collapse icon */}
                <span className={cn("transition-transform duration-200", textColor)}>
                    {dock.isCollapsed ? (
                        <ChevronRight className="h-4 w-4" />
                    ) : (
                        <ChevronDown className="h-4 w-4" />
                    )}
                </span>

                {/* Dock icon */}
                <DockIcon className={cn("h-4 w-4", textColor)} />

                {/* Dock name */}
                <span className={cn("flex-1 text-left text-sm font-medium truncate", textColor)}>
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
                        "hover:bg-white/50",
                        textColor
                    )}
                    title="Add tab to dock"
                >
                    <Plus className="h-3.5 w-3.5" />
                </button>
            </button>

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
                        {tabs.map((tab) => (
                            <li key={tab.id}>
                                <SortableTab
                                    tab={tab}
                                    isActive={activeTabId === tab.id}
                                    containerId={dock.id}
                                    textColor={textColor}
                                    borderColor={borderColor}
                                    onTabClick={onTabClick}
                                    onTabClose={onTabClose}
                                    onContextMenu={onTabContextMenu}
                                />
                            </li>
                        ))}

                        {/* Empty state */}
                        {tabs.length === 0 && (
                            <li className="px-3 py-4 text-center">
                                <p className="text-xs text-text-tertiary">No tabs in this dock</p>
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
                            </li>
                        )}
                    </ul>
                </SortableContext>
            </div>
        </div>
    );
}
