import React, { useState } from 'react';
import { cn } from '../lib/utils';
import {
    Plus,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import { getIconComponent } from './IconPicker';
import type { Realm, ThemeColor, IconName } from '../../shared/types';

// Color mapping for realm colors
const COLOR_MAP: Record<ThemeColor, string> = {
    blue: 'bg-blue-500',
    purple: 'bg-purple-500',
    pink: 'bg-pink-500',
    red: 'bg-red-500',
    orange: 'bg-orange-500',
    yellow: 'bg-yellow-500',
    green: 'bg-green-500',
    teal: 'bg-teal-500',
    cyan: 'bg-cyan-500',
    gray: 'bg-gray-500',
};

const COLOR_RING_MAP: Record<ThemeColor, string> = {
    blue: 'ring-blue-500/50',
    purple: 'ring-purple-500/50',
    pink: 'ring-pink-500/50',
    red: 'ring-red-500/50',
    orange: 'ring-orange-500/50',
    yellow: 'ring-yellow-500/50',
    green: 'ring-green-500/50',
    teal: 'ring-teal-500/50',
    cyan: 'ring-cyan-500/50',
    gray: 'ring-gray-500/50',
};

interface RealmSwitcherProps {
    realms: Realm[];
    activeRealmId: string;
    onRealmSelect: (realmId: string) => void;
    onCreateRealm: () => void;
    onRealmContextMenu?: (e: React.MouseEvent, realm: Realm) => void;
    className?: string;
}

export function RealmSwitcher({
    realms,
    activeRealmId,
    onRealmSelect,
    onCreateRealm,
    onRealmContextMenu,
    className,
}: RealmSwitcherProps) {
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    // Check scroll state
    const checkScroll = () => {
        const container = containerRef.current;
        if (!container) return;

        setCanScrollLeft(container.scrollLeft > 0);
        setCanScrollRight(
            container.scrollLeft < container.scrollWidth - container.clientWidth - 1
        );
    };

    React.useEffect(() => {
        checkScroll();
        const container = containerRef.current;
        if (container) {
            container.addEventListener('scroll', checkScroll);
            window.addEventListener('resize', checkScroll);
            return () => {
                container.removeEventListener('scroll', checkScroll);
                window.removeEventListener('resize', checkScroll);
            };
        }
    }, [realms]);

    const scroll = (direction: 'left' | 'right') => {
        const container = containerRef.current;
        if (!container) return;

        const scrollAmount = 100;
        container.scrollBy({
            left: direction === 'left' ? -scrollAmount : scrollAmount,
            behavior: 'smooth',
        });
    };

    // Keyboard navigation
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Cmd/Ctrl + number to switch realms
            if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
                const index = parseInt(e.key) - 1;
                if (index < realms.length) {
                    e.preventDefault();
                    onRealmSelect(realms[index].id);
                }
            }

            // Cmd/Ctrl + [ or ] to navigate realms
            if ((e.metaKey || e.ctrlKey) && (e.key === '[' || e.key === ']')) {
                e.preventDefault();
                const currentIndex = realms.findIndex(r => r.id === activeRealmId);
                if (currentIndex === -1) return;

                const newIndex = e.key === '['
                    ? Math.max(0, currentIndex - 1)
                    : Math.min(realms.length - 1, currentIndex + 1);

                if (newIndex !== currentIndex) {
                    onRealmSelect(realms[newIndex].id);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [realms, activeRealmId, onRealmSelect]);

    return (
        <div className={cn("relative flex items-center gap-1 px-2", className)}>
            {/* Left scroll button */}
            {canScrollLeft && (
                <button
                    onClick={() => scroll('left')}
                    className="absolute left-0 z-10 h-8 w-8 flex items-center justify-center bg-gradient-to-r from-white via-white to-transparent"
                >
                    <ChevronLeft className="h-4 w-4 text-text-secondary" />
                </button>
            )}

            {/* Realms container */}
            <div
                ref={containerRef}
                className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-2 px-1"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
                {realms.map((realm, index) => {
                    const Icon = getIconComponent(realm.icon);
                    const isActive = realm.id === activeRealmId;
                    const bgColor = COLOR_MAP[realm.color] || COLOR_MAP.gray;
                    const ringColor = COLOR_RING_MAP[realm.color] || COLOR_RING_MAP.gray;

                    return (
                        <button
                            key={realm.id}
                            onClick={() => onRealmSelect(realm.id)}
                            onContextMenu={(e) => onRealmContextMenu?.(e, realm)}
                            title={`${realm.name} (⌘${index + 1})`}
                            className={cn(
                                "relative flex items-center justify-center shrink-0",
                                "h-9 w-9 rounded-xl",
                                "transition-all duration-200 ease-out",
                                isActive
                                    ? cn(bgColor, "text-white shadow-md ring-2", ringColor)
                                    : "bg-surface-tertiary text-text-secondary hover:bg-surface-secondary hover:text-text-primary hover:scale-105"
                            )}
                        >
                            <Icon className="h-4 w-4" />

                            {/* Active indicator dot */}
                            {isActive && (
                                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-current opacity-80" />
                            )}
                        </button>
                    );
                })}

                {/* Add realm button */}
                <button
                    onClick={onCreateRealm}
                    title="Create new realm"
                    className={cn(
                        "flex items-center justify-center shrink-0",
                        "h-9 w-9 rounded-xl",
                        "border-2 border-dashed border-border/60",
                        "text-text-tertiary",
                        "transition-all duration-200",
                        "hover:border-brand/40 hover:text-brand hover:bg-brand/5"
                    )}
                >
                    <Plus className="h-4 w-4" />
                </button>
            </div>

            {/* Right scroll button */}
            {canScrollRight && (
                <button
                    onClick={() => scroll('right')}
                    className="absolute right-0 z-10 h-8 w-8 flex items-center justify-center bg-gradient-to-l from-white via-white to-transparent"
                >
                    <ChevronRight className="h-4 w-4 text-text-secondary" />
                </button>
            )}
        </div>
    );
}
