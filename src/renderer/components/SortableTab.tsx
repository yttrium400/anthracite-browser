import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../lib/utils';
import { Globe, X, Loader2, GripVertical } from 'lucide-react';

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
    containerId: string; // dock ID or 'loose'
    textColor?: string;
    borderColor?: string;
    onTabClick: (tabId: string) => void;
    onTabClose: (tabId: string) => void;
    onContextMenu?: (e: React.MouseEvent, tab: Tab) => void;
}

export function SortableTab({
    tab,
    isActive,
    containerId,
    textColor = 'text-text-secondary',
    borderColor = 'border-gray-500/20',
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
        opacity: isDragging ? 0.5 : 1,
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
        <div
            ref={setNodeRef}
            style={style}
            onClick={() => onTabClick(tab.id)}
            onContextMenu={(e) => onContextMenu?.(e, tab)}
            className={cn(
                "flex items-center w-full gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer",
                "transition-all duration-150 ease-out group/tab",
                isDragging && "z-50 shadow-lg",
                isActive
                    ? cn("bg-white shadow-sm border", borderColor, textColor)
                    : "text-text-secondary hover:bg-white/50 hover:text-text-primary"
            )}
        >
            {/* Drag Handle */}
            <div
                {...attributes}
                {...listeners}
                className={cn(
                    "h-4 w-4 shrink-0 flex items-center justify-center cursor-grab",
                    "opacity-0 group-hover/tab:opacity-100 transition-opacity",
                    "text-text-tertiary hover:text-text-secondary"
                )}
                onClick={(e) => e.stopPropagation()}
            >
                <GripVertical className="h-3 w-3" />
            </div>

            {/* Favicon */}
            <div className="h-4 w-4 rounded shrink-0 flex items-center justify-center overflow-hidden">
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

            {/* Close button */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onTabClose(tab.id);
                }}
                className={cn(
                    "h-5 w-5 rounded flex items-center justify-center shrink-0",
                    "opacity-0 group-hover/tab:opacity-100",
                    "hover:bg-black/10 transition-all"
                )}
            >
                <X className="h-3 w-3" />
            </button>
        </div>
    );
}

// Overlay component for drag preview
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
            "flex items-center gap-2 px-3 py-2 rounded-lg text-sm",
            "bg-white shadow-xl border border-brand/30",
            "pointer-events-none w-[240px]"
        )}>
            {/* Favicon */}
            <div className="h-4 w-4 rounded shrink-0 flex items-center justify-center overflow-hidden">
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

            {/* Title */}
            <span className="truncate flex-1 text-left font-medium text-text-primary">
                {tab.title || 'New Tab'}
            </span>
        </div>
    );
}
