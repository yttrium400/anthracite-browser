import React, { useState, useEffect, useRef } from 'react';
import { cn } from '../lib/utils';
import { X } from 'lucide-react';

interface InputModalProps {
    isOpen: boolean;
    title: string;
    placeholder?: string;
    defaultValue?: string;
    submitLabel?: string;
    onSubmit: (value: string) => void;
    onClose: () => void;
}

export function InputModal({
    isOpen,
    title,
    placeholder = 'Enter name...',
    defaultValue = '',
    submitLabel = 'Create',
    onSubmit,
    onClose,
}: InputModalProps) {
    const [value, setValue] = useState(defaultValue);
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus input when modal opens
    useEffect(() => {
        if (isOpen) {
            setValue(defaultValue);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen, defaultValue]);

    // Handle keyboard
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
        if (value.trim()) {
            onSubmit(value.trim());
            setValue('');
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className={cn(
                "relative w-full max-w-sm mx-4",
                "bg-white rounded-2xl shadow-2xl",
                "border border-border/60",
                "animate-in fade-in zoom-in-95 duration-200"
            )}>
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
                    <h2 className="text-base font-semibold text-text-primary">
                        {title}
                    </h2>
                    <button
                        onClick={onClose}
                        className="h-8 w-8 rounded-lg flex items-center justify-center text-text-tertiary hover:bg-surface-tertiary hover:text-text-primary transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Content */}
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <input
                        ref={inputRef}
                        type="text"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={placeholder}
                        className={cn(
                            "w-full px-4 py-3 rounded-xl",
                            "bg-surface-secondary border border-border/60",
                            "text-sm text-text-primary placeholder:text-text-tertiary",
                            "focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10",
                            "transition-all duration-200"
                        )}
                    />

                    <div className="flex gap-3">
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
                            disabled={!value.trim()}
                            className={cn(
                                "flex-1 px-4 py-2.5 rounded-xl",
                                "text-sm font-medium text-white",
                                "bg-brand hover:bg-brand-dark",
                                "disabled:opacity-50 disabled:cursor-not-allowed",
                                "transition-colors duration-200"
                            )}
                        >
                            {submitLabel}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
