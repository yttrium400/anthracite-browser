import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../lib/utils';
import { Globe, X, CircleNotch } from '@phosphor-icons/react';

interface Tab {
    id: string;
    title: string;
    url: string;
    favicon: string;
    isLoading: boolean;
}

interface SortableTabProps {
    tab: Tab;
    isActive: boolean;
    containerId: string;
    textColor?: string;
    borderColor?: string;
    showDropIndicator?: boolean;
    onTabClick: (tabId: string) => void;
    onTabClose: (tabId: string) => void;
    onContextMenu?: (e: React.MouseEvent, tab: Tab) => void;
}

export function SortableTab({
    tab,
    isActive,
    containerId,
    showDropIndicator = false,
    onTabClick,
    onTabClose,
    onContextMenu,
}: SortableTabProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: tab.id,
        data: {
            type: 'tab',
            tab,
            containerId,
        },
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
    };

    const getFaviconUrl = (t: Tab) => {
        if (t.favicon) return t.favicon;
        try {
            const url = new URL(t.url);
            return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
        } catch {
            return null;
        }
    };

    return (
        <div className="relative">
            {showDropIndicator && (
                <div className="absolute -top-px left-3 right-3 h-px bg-brand rounded-full z-10" />
            )}
            <div
                ref={setNodeRef}
                style={style}
                {...attributes}
                {...listeners}
                onClick={() => onTabClick(tab.id)}
                onContextMenu={(e) => onContextMenu?.(e, tab)}
                className={cn(
                    "flex items-center w-full gap-2 px-3 h-8 rounded-lg cursor-pointer select-none",
                    "transition-all duration-150 ease-out group/tab",
                    isDragging && "z-50 shadow-lg",
                    isActive
                        ? "bg-white/[0.07] border-l-2 border-brand text-text-primary pl-[10px]"
                        : "text-text-tertiary hover:bg-white/[0.05] hover:text-text-secondary"
                )}
            >
                {/* Favicon */}
                <div className="h-3.5 w-3.5 shrink-0 flex items-center justify-center overflow-hidden">
                    {tab.isLoading ? (
                        <CircleNotch className="h-3 w-3 text-brand animate-spin" />
                    ) : getFaviconUrl(tab) ? (
                        <img
                            src={getFaviconUrl(tab)!}
                            alt=""
                            className="h-3.5 w-3.5 object-contain rounded-[2px]"
                            onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                            }}
                        />
                    ) : (
                        <Globe className="h-3 w-3 text-text-tertiary" />
                    )}
                </div>

                {/* Title */}
                <span className="truncate flex-1 text-left text-[12.5px] font-medium leading-none">
                    {tab.title || 'New Tab'}
                </span>

                {/* Close button */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onTabClose(tab.id);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className={cn(
                        "h-4 w-4 rounded flex items-center justify-center shrink-0",
                        "opacity-0 group-hover/tab:opacity-60 hover:!opacity-100",
                        "hover:bg-white/[0.12] transition-all"
                    )}
                >
                    <X className="h-2.5 w-2.5" />
                </button>
            </div>
        </div>
    );
}

export function TabDragOverlay({ tab }: { tab: Tab }) {
    const getFaviconUrl = (t: Tab) => {
        if (t.favicon) return t.favicon;
        try {
            const url = new URL(t.url);
            return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
        } catch {
            return null;
        }
    };

    return (
        <div className={cn(
            "flex items-center gap-2 px-3 h-8 rounded-lg text-[12.5px]",
            "bg-[#1A1A1D] shadow-xl border border-brand/30",
            "pointer-events-none w-[240px]"
        )}>
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
            <span className="truncate flex-1 text-left font-medium text-text-primary">
                {tab.title || 'New Tab'}
            </span>
        </div>
    );
}
