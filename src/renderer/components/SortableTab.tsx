import React, { useState, useRef, useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../lib/utils';
import { Globe, X, CircleNotch } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

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

function getFaviconUrl(t: Tab): string | null {
    if (t.favicon) return t.favicon;
    try {
        const url = new URL(t.url);
        return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
    } catch {
        return null;
    }
}

function TabPreview({ tab, anchorY }: { tab: Tab; anchorY: number }) {
    const isInternal = tab.url.startsWith('anthracite://') || tab.url.startsWith('about:');
    const displayUrl = isInternal ? tab.url.replace('anthracite://', '') : tab.url;
    const faviconSrc = getFaviconUrl(tab);

    // Clamp so preview doesn't overflow viewport
    const previewHeight = 80;
    const viewportH = window.innerHeight;
    const top = Math.min(Math.max(anchorY - previewHeight / 2, 8), viewportH - previewHeight - 8);

    return createPortal(
        <motion.div
            className={cn(
                'fixed z-[600] pointer-events-none',
                'left-[304px]', // just to the right of the sidebar (280px wide + 12px left padding + 12px gap)
                'w-64 rounded-xl overflow-hidden',
                'bg-[#1C1C1F]/95 backdrop-blur-2xl',
                'border border-white/[0.08]',
                'shadow-large',
            )}
            style={{ top }}
            initial={{ opacity: 0, x: -6, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
            {/* Header */}
            <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-white/[0.06]">
                <div className="h-4 w-4 shrink-0 flex items-center justify-center">
                    {tab.isLoading ? (
                        <CircleNotch className="h-3.5 w-3.5 text-brand animate-spin" />
                    ) : faviconSrc ? (
                        <img
                            src={faviconSrc}
                            alt=""
                            className="h-4 w-4 object-contain rounded-[2px]"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                    ) : (
                        <Globe className="h-3.5 w-3.5 text-text-tertiary" />
                    )}
                </div>
                <span className="truncate flex-1 text-[12px] font-semibold text-text-primary leading-none">
                    {tab.title || 'New Tab'}
                </span>
            </div>

            {/* URL */}
            <div className="px-3 py-2">
                <p className="text-[10px] text-text-tertiary leading-relaxed break-all line-clamp-2">
                    {displayUrl || '—'}
                </p>
            </div>
        </motion.div>,
        document.body
    );
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

    const [showPreview, setShowPreview] = useState(false);
    const [previewY, setPreviewY] = useState(0);
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const tabRef = useRef<HTMLDivElement>(null);

    const handleMouseEnter = useCallback(() => {
        if (isDragging) return;
        hoverTimer.current = setTimeout(() => {
            if (tabRef.current) {
                const rect = tabRef.current.getBoundingClientRect();
                setPreviewY(rect.top + rect.height / 2);
            }
            setShowPreview(true);
        }, 400);
    }, [isDragging]);

    const handleMouseLeave = useCallback(() => {
        if (hoverTimer.current) {
            clearTimeout(hoverTimer.current);
            hoverTimer.current = null;
        }
        setShowPreview(false);
    }, []);

    return (
        <div className="relative" ref={tabRef}>
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
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
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

            <AnimatePresence>
                {showPreview && !isDragging && (
                    <TabPreview tab={tab} anchorY={previewY} />
                )}
            </AnimatePresence>
        </div>
    );
}

export function TabDragOverlay({ tab }: { tab: Tab }) {
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
