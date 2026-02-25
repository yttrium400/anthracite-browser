
import React, { useState, useEffect, useRef } from 'react';
import { cn } from '../lib/utils';
import { X, ArrowLeft, Check, GridFour } from '@phosphor-icons/react';
import { IconPicker, getIconComponent } from './IconPicker';
import { ColorPicker } from './ColorPicker';
import type { IconName, ThemeColor, Realm } from '../../shared/types';
import { REALM_TEMPLATES, RealmTemplate } from '../../shared/templates';

interface RealmModalProps {
    isOpen: boolean;
    mode: 'create' | 'edit';
    realm?: Realm | null;
    onSubmit: (data: { name: string; icon: IconName; color: ThemeColor; template?: RealmTemplate }) => void;
    onClose: () => void;
}

export function RealmModal({
    isOpen,
    mode,
    realm,
    onSubmit,
    onClose,
}: RealmModalProps) {
    // Flow state
    const [step, setStep] = useState<'template' | 'details'>('template');
    const [selectedTemplate, setSelectedTemplate] = useState<RealmTemplate | null>(null);

    // Form state
    const [name, setName] = useState('');
    const [icon, setIcon] = useState<IconName>('globe');
    const [color, setColor] = useState<ThemeColor>('blue');
    const [showIconPicker, setShowIconPicker] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Initialize/Reset
    useEffect(() => {
        if (isOpen) {
            if (mode === 'edit' && realm) {
                setStep('details'); // Edit mode skips template selection
                setName(realm.name);
                setIcon(realm.icon);
                setColor(realm.color);
            } else {
                setStep('template');
                setSelectedTemplate(null);
                setName('');
                setIcon('globe');
                setColor('blue');
            }
            setShowIconPicker(false);
        }
    }, [isOpen, mode, realm]);

    // Focus input when entering details step
    useEffect(() => {
        if (isOpen && step === 'details') {
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen, step]);

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

    const handleTemplateSelect = (template: RealmTemplate | null) => {
        setSelectedTemplate(template);
        if (template) {
            setName(template.name);
            setIcon(template.icon);
            setColor(template.color);
        } else {
            // Blank template
            setName('');
            setIcon('globe');
            setColor('blue');
        }
        setStep('details');
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            onSubmit({
                name: name.trim(),
                icon,
                color,
                template: mode === 'create' && selectedTemplate ? selectedTemplate : undefined
            });
            onClose();
        }
    };

    if (!isOpen) return null;

    const IconComponent = getIconComponent(icon);

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className={cn(
                "relative w-full mx-4",
                step === 'template' ? "max-w-4xl" : "max-w-md",
                "bg-[#1A1A1D] rounded-2xl shadow-2xl",
                "border border-white/[0.08]",
                "animate-in fade-in zoom-in-95 duration-200",
                "flex flex-col max-h-[90vh]"
            )}>
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
                    <div className="flex items-center gap-3">
                        {step === 'details' && mode === 'create' && (
                            <button
                                onClick={() => setStep('template')}
                                className="p-1 -ml-2 rounded-lg text-text-tertiary hover:bg-white/[0.06] hover:text-text-primary transition-colors"
                            >
                                <ArrowLeft className="h-5 w-5" />
                            </button>
                        )}
                        <h2 className="text-lg font-semibold text-text-primary">
                            {mode === 'edit' ? 'Edit Realm' : (
                                step === 'template' ? 'Choose a Template' : 'Realm Details'
                            )}
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="h-8 w-8 rounded-lg flex items-center justify-center text-text-tertiary hover:bg-white/[0.06] hover:text-text-primary transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="overflow-y-auto">
                    {step === 'template' ? (
                        <div className="p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {/* Blank Template */}
                                <button
                                    onClick={() => handleTemplateSelect(null)}
                                    className={cn(
                                        "flex flex-col items-start text-left p-5 rounded-xl border-2 transition-all duration-200",
                                        "border-dashed border-white/[0.08] hover:border-brand hover:bg-white/[0.04] group"
                                    )}
                                >
                                    <div className="h-12 w-12 rounded-xl bg-white/[0.06] flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                                        <GridFour className="h-6 w-6 text-text-secondary" />
                                    </div>
                                    <h3 className="font-semibold text-text-primary mb-1">Start from Blank</h3>
                                    <p className="text-sm text-text-tertiary">Create a clean slate with no pre-configured docks.</p>
                                </button>

                                {/* Pre-defined Templates */}
                                {REALM_TEMPLATES.map(template => {
                                    const TemplateIcon = getIconComponent(template.icon);
                                    return (
                                        <button
                                            key={template.id}
                                            onClick={() => handleTemplateSelect(template)}
                                            className={cn(
                                                "flex flex-col items-start text-left p-5 rounded-xl border border-white/[0.06] transition-all duration-200",
                                                "hover:border-brand/50 hover:shadow-md hover:bg-white/[0.04] group"
                                            )}
                                        >
                                            <div
                                                className="h-12 w-12 rounded-xl flex items-center justify-center mb-4 group-hover:scale-105 transition-transform shadow-sm"
                                                style={{ backgroundColor: `var(--color-${template.color}, #3b82f6)` }}
                                            >
                                                <TemplateIcon className="h-6 w-6 text-white" />
                                            </div>
                                            <h3 className="font-semibold text-text-primary mb-1">{template.name}</h3>
                                            <p className="text-sm text-text-tertiary mb-4 line-clamp-2">{template.description}</p>

                                            {/* Docks Preview */}
                                            <div className="flex flex-wrap gap-2 mt-auto">
                                                {template.docks.slice(0, 3).map((dock, i) => {
                                                    const DockIcon = getIconComponent(dock.icon);
                                                    return (
                                                        <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.04] text-xs text-text-secondary border border-white/[0.06]">
                                                            <DockIcon className="h-3 w-3" />
                                                            <span>{dock.name}</span>
                                                        </div>
                                                    );
                                                })}
                                                {template.docks.length > 3 && (
                                                    <span className="text-xs text-text-tertiary py-1">+{template.docks.length - 3}</span>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="p-6 space-y-6">
                            {/* Icon Preview & Color */}
                            <div className="flex flex-col items-center">
                                <button
                                    type="button"
                                    onClick={() => setShowIconPicker(!showIconPicker)}
                                    className={cn(
                                        "h-24 w-24 rounded-3xl flex items-center justify-center mb-6",
                                        "transition-all duration-200",
                                        "shadow-xl ring-4 ring-white/10",
                                        `bg-${color}-500 text-white`,
                                        "hover:scale-105 active:scale-95"
                                    )}
                                    style={{ backgroundColor: `var(--color-${color}, #3b82f6)` }}
                                >
                                    <IconComponent className="h-12 w-12" />
                                </button>

                                <div className="w-full">
                                    <label className="text-sm font-medium text-text-secondary mb-3 block">
                                        Theme Color
                                    </label>
                                    <ColorPicker
                                        selected={color}
                                        onSelect={setColor}
                                    />
                                </div>
                            </div>

                            {/* Name input */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-text-secondary">
                                    Realm Name
                                </label>
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="e.g. Work, Personal, Gaming..."
                                    className={cn(
                                        "w-full px-4 py-3 rounded-xl",
                                        "bg-white/[0.05] border border-white/[0.08]",
                                        "text-base text-text-primary placeholder:text-text-tertiary",
                                        "focus:outline-none focus:border-brand/40 focus:ring-1 focus:ring-brand/30",
                                        "transition-all duration-200"
                                    )}
                                />
                            </div>

                            {/* Icon picker (collapsible) */}
                            <div className="space-y-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowIconPicker(!showIconPicker)}
                                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors"
                                >
                                    <span className="text-sm font-medium">Choose Icon</span>
                                    <span className="text-xs text-text-tertiary">
                                        {showIconPicker ? 'Collapse' : 'Expand'}
                                    </span>
                                </button>
                                {showIconPicker && (
                                    <div className="p-4 bg-white/[0.04] rounded-xl border border-white/[0.06] animate-in slide-in-from-top-2 duration-200">
                                        <IconPicker
                                            selected={icon}
                                            onSelect={(newIcon) => {
                                                setIcon(newIcon);
                                                // Don't auto-close, let user see feedback
                                            }}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className={cn(
                                        "flex-1 px-4 py-3 rounded-xl",
                                        "text-sm font-medium text-text-secondary",
                                        "bg-white/[0.06] hover:bg-white/[0.08]",
                                        "transition-colors duration-200"
                                    )}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!name.trim()}
                                    className={cn(
                                        "flex-1 px-4 py-3 rounded-xl flex items-center justify-center gap-2",
                                        "text-sm font-medium text-white",
                                        "bg-brand hover:bg-brand-dark shadow-lg shadow-brand/25",
                                        "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
                                        "transition-all duration-200 hover:translate-y-[-1px]"
                                    )}
                                >
                                    <Check className="h-4 w-4" />
                                    {mode === 'create' ? 'Create Realm' : 'Save Changes'}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
