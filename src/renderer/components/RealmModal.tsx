import React, { useState, useEffect, useRef } from 'react';
import { cn } from '../lib/utils';
import { X } from 'lucide-react';
import { IconPicker, getIconComponent } from './IconPicker';
import { ColorPicker } from './ColorPicker';
import type { IconName, ThemeColor, Realm } from '../../shared/types';

interface RealmModalProps {
    isOpen: boolean;
    mode: 'create' | 'edit';
    realm?: Realm | null;
    onSubmit: (data: { name: string; icon: IconName; color: ThemeColor }) => void;
    onClose: () => void;
}

export function RealmModal({
    isOpen,
    mode,
    realm,
    onSubmit,
    onClose,
}: RealmModalProps) {
    const [name, setName] = useState('');
    const [icon, setIcon] = useState<IconName>('globe');
    const [color, setColor] = useState<ThemeColor>('blue');
    const [showIconPicker, setShowIconPicker] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Initialize form when modal opens
    useEffect(() => {
        if (isOpen) {
            if (mode === 'edit' && realm) {
                setName(realm.name);
                setIcon(realm.icon);
                setColor(realm.color);
            } else {
                setName('');
                setIcon('globe');
                setColor('blue');
            }
            setShowIconPicker(false);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen, mode, realm]);

    // Handle escape key
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            onSubmit({ name: name.trim(), icon, color });
            onClose();
        }
    };

    if (!isOpen) return null;

    const IconComponent = getIconComponent(icon);

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className={cn(
                "relative w-full max-w-md mx-4",
                "bg-white rounded-2xl shadow-2xl",
                "border border-border/60",
                "animate-in fade-in zoom-in-95 duration-200"
            )}>
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
                    <h2 className="text-base font-semibold text-text-primary">
                        {mode === 'create' ? 'Create New Realm' : 'Edit Realm'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="h-8 w-8 rounded-lg flex items-center justify-center text-text-tertiary hover:bg-surface-tertiary hover:text-text-primary transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Content */}
                <form onSubmit={handleSubmit} className="p-5 space-y-5">
                    {/* Preview */}
                    <div className="flex items-center justify-center">
                        <button
                            type="button"
                            onClick={() => setShowIconPicker(!showIconPicker)}
                            className={cn(
                                "h-16 w-16 rounded-2xl flex items-center justify-center",
                                "transition-all duration-200",
                                "shadow-lg",
                                `bg-${color}-500 text-white`,
                                "hover:scale-105"
                            )}
                            style={{ backgroundColor: `var(--color-${color}, #3b82f6)` }}
                        >
                            <IconComponent className="h-8 w-8" />
                        </button>
                    </div>

                    {/* Name input */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">
                            Name
                        </label>
                        <input
                            ref={inputRef}
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Enter realm name..."
                            className={cn(
                                "w-full px-4 py-3 rounded-xl",
                                "bg-surface-secondary border border-border/60",
                                "text-sm text-text-primary placeholder:text-text-tertiary",
                                "focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10",
                                "transition-all duration-200"
                            )}
                        />
                    </div>

                    {/* Color picker */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-text-secondary">
                            Color
                        </label>
                        <ColorPicker
                            selected={color}
                            onSelect={setColor}
                        />
                    </div>

                    {/* Icon picker (collapsible) */}
                    <div className="space-y-2">
                        <button
                            type="button"
                            onClick={() => setShowIconPicker(!showIconPicker)}
                            className="text-sm font-medium text-text-secondary hover:text-text-primary flex items-center gap-2"
                        >
                            Icon
                            <span className="text-xs text-text-tertiary">
                                {showIconPicker ? '(click to collapse)' : '(click to expand)'}
                            </span>
                        </button>
                        {showIconPicker && (
                            <div className="p-3 bg-surface-secondary rounded-xl border border-border/40">
                                <IconPicker
                                    selected={icon}
                                    onSelect={setIcon}
                                />
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className={cn(
                                "flex-1 px-4 py-2.5 rounded-xl",
                                "text-sm font-medium text-text-secondary",
                                "bg-surface-tertiary hover:bg-surface-secondary",
                                "transition-colors duration-200"
                            )}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!name.trim()}
                            className={cn(
                                "flex-1 px-4 py-2.5 rounded-xl",
                                "text-sm font-medium text-white",
                                "bg-brand hover:bg-brand-dark",
                                "disabled:opacity-50 disabled:cursor-not-allowed",
                                "transition-colors duration-200"
                            )}
                        >
                            {mode === 'create' ? 'Create Realm' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
