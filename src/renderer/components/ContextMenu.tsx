import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

export interface ContextMenuItem {
    id: string;
    label: string;
    icon?: React.ReactNode;
    shortcut?: string;
    danger?: boolean;
    disabled?: boolean;
    divider?: boolean;
    submenu?: ContextMenuItem[];
}

interface ContextMenuProps {
    items: ContextMenuItem[];
    position: { x: number; y: number } | null;
    onSelect: (itemId: string) => void;
    onClose: () => void;
}

export function ContextMenu({ items, position, onSelect, onClose }: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [adjustedPosition, setAdjustedPosition] = useState(position);
    const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);

    // Adjust position to stay within viewport
    useEffect(() => {
        if (!position || !menuRef.current) return;

        const menu = menuRef.current;
        const rect = menu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let x = position.x;
        let y = position.y;

        // Adjust horizontal position
        if (x + rect.width > viewportWidth - 10) {
            x = viewportWidth - rect.width - 10;
        }

        // Adjust vertical position
        if (y + rect.height > viewportHeight - 10) {
            y = viewportHeight - rect.height - 10;
        }

        setAdjustedPosition({ x: Math.max(10, x), y: Math.max(10, y) });
    }, [position]);

    // Close on outside click
    useEffect(() => {
        if (!position) return;

        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [position, onClose]);

    if (!position) return null;

    const handleItemClick = (item: ContextMenuItem) => {
        if (item.disabled || item.divider || item.submenu) return;
        onSelect(item.id);
        onClose();
    };

    return (
        <div
            ref={menuRef}
            className={cn(
                "fixed z-[300] min-w-[180px]",
                "bg-white/95 backdrop-blur-xl",
                "rounded-xl border border-border/60",
                "shadow-2xl",
                "py-1.5",
                "animate-in fade-in zoom-in-95 duration-100"
            )}
            style={{
                left: adjustedPosition?.x ?? position.x,
                top: adjustedPosition?.y ?? position.y,
            }}
        >
            {items.map((item, index) => {
                if (item.divider) {
                    return (
                        <div
                            key={`divider-${index}`}
                            className="my-1.5 mx-2 border-t border-border/40"
                        />
                    );
                }

                const hasSubmenu = item.submenu && item.submenu.length > 0;

                return (
                    <div
                        key={item.id}
                        className="relative"
                        onMouseEnter={() => hasSubmenu && setActiveSubmenu(item.id)}
                        onMouseLeave={() => hasSubmenu && setActiveSubmenu(null)}
                    >
                        <button
                            onClick={() => handleItemClick(item)}
                            disabled={item.disabled}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-2 text-left",
                                "text-sm transition-colors duration-100",
                                item.disabled
                                    ? "text-text-tertiary cursor-not-allowed"
                                    : item.danger
                                        ? "text-red-600 hover:bg-red-50"
                                        : "text-text-primary hover:bg-surface-secondary"
                            )}
                        >
                            {item.icon && (
                                <span className="w-4 h-4 flex items-center justify-center shrink-0">
                                    {item.icon}
                                </span>
                            )}
                            <span className="flex-1">{item.label}</span>
                            {item.shortcut && (
                                <span className="text-xs text-text-tertiary ml-4">
                                    {item.shortcut}
                                </span>
                            )}
                            {hasSubmenu && (
                                <span className="text-text-tertiary ml-2">›</span>
                            )}
                        </button>

                        {/* Submenu */}
                        {hasSubmenu && activeSubmenu === item.id && (
                            <div
                                className={cn(
                                    "absolute left-full top-0 ml-1 min-w-[160px]",
                                    "bg-white/95 backdrop-blur-xl",
                                    "rounded-xl border border-border/60",
                                    "shadow-2xl",
                                    "py-1.5"
                                )}
                            >
                                {item.submenu!.map((subItem) => (
                                    <button
                                        key={subItem.id}
                                        onClick={() => {
                                            if (!subItem.disabled) {
                                                onSelect(subItem.id);
                                                onClose();
                                            }
                                        }}
                                        disabled={subItem.disabled}
                                        className={cn(
                                            "w-full flex items-center gap-3 px-3 py-2 text-left",
                                            "text-sm transition-colors duration-100",
                                            subItem.disabled
                                                ? "text-text-tertiary cursor-not-allowed"
                                                : "text-text-primary hover:bg-surface-secondary"
                                        )}
                                    >
                                        {subItem.icon && (
                                            <span className="w-4 h-4 flex items-center justify-center shrink-0">
                                                {subItem.icon}
                                            </span>
                                        )}
                                        <span className="flex-1">{subItem.label}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// Hook for managing context menu state
export function useContextMenu() {
    const [contextMenu, setContextMenu] = useState<{
        position: { x: number; y: number } | null;
        data: any;
    }>({ position: null, data: null });

    const openContextMenu = (e: React.MouseEvent, data?: any) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            position: { x: e.clientX, y: e.clientY },
            data,
        });
    };

    const closeContextMenu = () => {
        setContextMenu({ position: null, data: null });
    };

    return {
        contextMenu,
        openContextMenu,
        closeContextMenu,
    };
}
