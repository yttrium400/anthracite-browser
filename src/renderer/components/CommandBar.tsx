import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../lib/utils';
import {
    Sparkles,
    ArrowRight,
    StopCircle,
    Loader2,
    Mic,
    Paperclip,
    ChevronDown,
} from 'lucide-react';

interface CommandBarProps {
    onRun: (instruction: string) => void;
    isRunning: boolean;
    status?: 'idle' | 'thinking' | 'running' | 'done' | 'error';
}

const placeholders = [
    "Search the web for latest AI news...",
    "Book a flight to San Francisco...",
    "Find and summarize this research paper...",
    "Compare prices for iPhone 16 Pro...",
    "Help me fill out this form...",
];

export function CommandBar({ onRun, isRunning, status = 'idle' }: CommandBarProps) {
    const [input, setInput] = useState('');
    const [isFocused, setIsFocused] = useState(false);
    const [placeholderIndex, setPlaceholderIndex] = useState(0);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Rotate placeholders
    useEffect(() => {
        const interval = setInterval(() => {
            setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
        }, 4000);
        return () => clearInterval(interval);
    }, []);

    // Auto-resize textarea
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
        }
    }, [input]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (input.trim() && !isRunning) {
            onRun(input);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    const getStatusConfig = () => {
        switch (status) {
            case 'thinking':
                return {
                    text: 'Thinking...',
                    color: 'text-brand',
                    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
                    dot: 'status-running',
                };
            case 'running':
                return {
                    text: 'Browsing the web...',
                    color: 'text-accent-blue',
                    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
                    dot: 'status-running',
                };
            case 'done':
                return {
                    text: 'Task completed',
                    color: 'text-success',
                    icon: null,
                    dot: 'status-ready',
                };
            case 'error':
                return {
                    text: 'Something went wrong',
                    color: 'text-error',
                    icon: null,
                    dot: 'status-error',
                };
            default:
                return {
                    text: 'Ready',
                    color: 'text-text-tertiary',
                    icon: null,
                    dot: 'status-ready',
                };
        }
    };

    const statusConfig = getStatusConfig();

    return (
        <div className="w-full max-w-2xl mx-auto">
            {/* Main Command Bar */}
            <form onSubmit={handleSubmit} className="relative">
                {/* Glow Effect */}
                <div
                    className={cn(
                        "absolute -inset-1 rounded-3xl transition-all duration-500",
                        isFocused
                            ? "bg-gradient-to-r from-brand/20 via-accent-violet/20 to-brand/20 blur-xl opacity-100"
                            : "opacity-0"
                    )}
                />

                {/* Card Container */}
                <div
                    className={cn(
                        "relative glass-elevated overflow-hidden transition-all duration-300",
                        isFocused ? "shadow-large ring-1 ring-brand/20" : "shadow-medium",
                        isRunning && "ring-1 ring-brand/30"
                    )}
                >
                    {/* Top Section - Input */}
                    <div className="flex items-start gap-3 p-4 pb-3">
                        {/* AI Icon */}
                        <div className={cn(
                            "flex items-center justify-center h-10 w-10 rounded-xl shrink-0 transition-all duration-300",
                            isRunning
                                ? "bg-gradient-to-br from-brand to-accent-violet shadow-brand"
                                : "bg-surface-tertiary"
                        )}>
                            <Sparkles className={cn(
                                "h-5 w-5 transition-colors",
                                isRunning ? "text-white" : "text-text-secondary"
                            )} />
                        </div>

                        {/* Input Field */}
                        <div className="flex-1 min-w-0">
                            <textarea
                                ref={inputRef}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onFocus={() => setIsFocused(true)}
                                onBlur={() => setIsFocused(false)}
                                onKeyDown={handleKeyDown}
                                placeholder={placeholders[placeholderIndex]}
                                disabled={isRunning}
                                rows={1}
                                className={cn(
                                    "w-full bg-transparent resize-none",
                                    "text-lg font-medium text-text-primary",
                                    "placeholder:text-text-tertiary placeholder:transition-opacity placeholder:duration-300",
                                    "focus:outline-none",
                                    "disabled:opacity-60 disabled:cursor-not-allowed",
                                    "leading-relaxed pt-2"
                                )}
                            />
                        </div>
                    </div>

                    {/* Bottom Section - Actions */}
                    <div className="flex items-center justify-between px-4 py-3 bg-surface-secondary/50 border-t border-border/40">
                        {/* Left Actions */}
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                className="btn-icon h-8 w-8"
                                title="Attach file"
                            >
                                <Paperclip className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                className="btn-icon h-8 w-8"
                                title="Voice input"
                            >
                                <Mic className="h-4 w-4" />
                            </button>
                            <div className="h-5 w-px bg-border mx-1" />
                            <button
                                type="button"
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:bg-surface-tertiary transition-colors"
                            >
                                <span>GPT-4o</span>
                                <ChevronDown className="h-3 w-3" />
                            </button>
                        </div>

                        {/* Right Actions */}
                        <div className="flex items-center gap-2">
                            {/* Status Indicator */}
                            <div className="flex items-center gap-2 mr-2">
                                <div className={cn("status-dot", statusConfig.dot)} />
                                <span className={cn("text-xs font-medium", statusConfig.color)}>
                                    {statusConfig.icon}
                                    {!statusConfig.icon && statusConfig.text}
                                </span>
                            </div>

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={!input.trim() || isRunning}
                                className={cn(
                                    "flex items-center justify-center gap-2 h-9 rounded-xl font-semibold text-sm transition-all duration-200",
                                    "disabled:opacity-40 disabled:cursor-not-allowed",
                                    isRunning
                                        ? "bg-error/10 text-error hover:bg-error/20 px-4"
                                        : "bg-brand text-white hover:bg-brand-dark hover:shadow-brand active:scale-[0.98] px-4",
                                    !input.trim() && !isRunning && "bg-surface-tertiary text-text-tertiary hover:bg-surface-tertiary"
                                )}
                            >
                                {isRunning ? (
                                    <>
                                        <StopCircle className="h-4 w-4" />
                                        <span>Stop</span>
                                    </>
                                ) : (
                                    <>
                                        <span>Run</span>
                                        <ArrowRight className="h-4 w-4" />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </form>

            {/* Hints */}
            <div className="flex items-center justify-center gap-4 mt-4">
                <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                    <kbd className="kbd">Enter</kbd>
                    <span>to run</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                    <kbd className="kbd">Shift</kbd>
                    <span>+</span>
                    <kbd className="kbd">Enter</kbd>
                    <span>for new line</span>
                </div>
            </div>
        </div>
    );
}
