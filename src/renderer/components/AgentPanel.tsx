import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import {
    X,
    Robot,
    CircleNotch,
    CheckCircle,
    XCircle,
    StopCircle,
    PaperPlaneTilt,
    Globe,
    CursorClick,
    Keyboard,
    MagnifyingGlass,
    ArrowRight,
    Warning,
    LockKey,
    ArrowsClockwise,
} from '@phosphor-icons/react';

export type AgentStatus = 'idle' | 'thinking' | 'running' | 'done' | 'error' | 'stopped' | 'auth';

export interface AgentStep {
    step: number;
    action: string;
    goal: string;
}

interface AgentPanelProps {
    isOpen: boolean;
    onClose: () => void;
    status: AgentStatus;
    instruction: string;
    steps: AgentStep[];
    result?: string;
    authService?: string;
    authUrl?: string;
    onStop: () => void;
    onResume: () => void;
    onFollowUp: (instruction: string) => void;
}

function getStepIcon(action: string) {
    const a = action.toLowerCase();
    if (a.includes('click') || a.includes('tap') || a.includes('select')) return CursorClick;
    if (a.includes('navigate') || a.includes('goto') || a.includes('url') || a.includes('open')) return Globe;
    if (a.includes('type') || a.includes('input') || a.includes('fill') || a.includes('text') || a.includes('write')) return Keyboard;
    if (a.includes('search') || a.includes('find') || a.includes('scroll')) return MagnifyingGlass;
    return ArrowRight;
}

function StatusBadge({ status }: { status: AgentStatus }) {
    const label = { idle: 'Idle', thinking: 'Thinking', running: 'Running', done: 'Done', error: 'Error', stopped: 'Stopped', auth: 'Action Required' }[status];
    const color = {
        idle: 'text-text-tertiary bg-white/[0.06]',
        thinking: 'text-brand bg-brand/10',
        running: 'text-amber-400 bg-amber-400/10',
        done: 'text-success bg-success/10',
        error: 'text-red-400 bg-red-400/10',
        stopped: 'text-text-tertiary bg-white/[0.06]',
        auth: 'text-amber-400 bg-amber-400/10',
    }[status];
    const showSpin = status === 'thinking';
    const showPulse = status === 'running' || status === 'auth';
    const showDot = status === 'done' || status === 'error' || status === 'stopped' || status === 'idle';
    return (
        <span className={cn('flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full', color)}>
            {showSpin && <CircleNotch className="h-2.5 w-2.5 animate-spin" />}
            {showPulse && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
            {showDot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            {label}
        </span>
    );
}

function StepCard({ step, isLast, isRunning }: { step: AgentStep; isLast: boolean; isRunning: boolean }) {
    const Icon = getStepIcon(step.action);
    const active = isLast && isRunning;

    return (
        <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className={cn(
                'flex gap-3 px-3 py-2.5 rounded-xl border',
                active
                    ? 'bg-brand/5 border-brand/20'
                    : 'bg-white/[0.03] border-white/[0.05]'
            )}
        >
            {/* Step number */}
            <div className={cn(
                'flex items-center justify-center h-5 w-5 rounded-md text-[10px] font-bold shrink-0 mt-0.5',
                active ? 'bg-brand/20 text-brand' : 'bg-white/[0.07] text-text-tertiary'
            )}>
                {step.step}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                    <Icon className={cn('h-3 w-3 shrink-0', active ? 'text-brand' : 'text-text-tertiary')} />
                    <span className={cn('text-[10px] font-semibold uppercase tracking-wide', active ? 'text-brand' : 'text-text-tertiary')}>
                        {step.action}
                    </span>
                    {active && <CircleNotch className="h-3 w-3 text-brand animate-spin ml-auto" />}
                </div>
                <p className="text-[12px] text-text-secondary leading-snug line-clamp-2">
                    {step.goal}
                </p>
            </div>
        </motion.div>
    );
}

export function AgentPanel({
    isOpen,
    onClose,
    status,
    instruction,
    steps,
    result,
    authService,
    authUrl,
    onStop,
    onResume,
    onFollowUp,
}: AgentPanelProps) {
    const [followUp, setFollowUp] = useState('');
    const stepsEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-scroll to latest step
    useEffect(() => {
        if (steps.length > 0) {
            stepsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [steps.length]);

    // Focus follow-up input when done
    useEffect(() => {
        if (status === 'done' || status === 'stopped') {
            setTimeout(() => inputRef.current?.focus(), 300);
        }
    }, [status]);

    const handleFollowUp = (e: React.FormEvent) => {
        e.preventDefault();
        if (!followUp.trim()) return;
        onFollowUp(followUp.trim());
        setFollowUp('');
    };

    const isActive = status === 'thinking' || status === 'running';
    const isDone = status === 'done' || status === 'stopped' || status === 'error';

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.aside
                    initial={{ x: 320, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: 320, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                    className={cn(
                        'fixed right-3 top-3 bottom-3 w-[300px] z-[200]',
                        'bg-[#111113]/90 backdrop-blur-2xl',
                        'rounded-2xl border border-white/[0.06]',
                        'shadow-large flex flex-col',
                    )}
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between h-14 px-4 border-b border-white/[0.06] shrink-0">
                        <div className="flex items-center gap-2.5">
                            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-brand/10">
                                <Robot className="h-4 w-4 text-brand" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-sm font-semibold text-text-primary tracking-tight leading-none">
                                    AI Agent
                                </span>
                                <div className="mt-0.5">
                                    <StatusBadge status={status} />
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="btn-icon h-7 w-7"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    {/* Instruction */}
                    <div className="px-4 py-3 border-b border-white/[0.06] shrink-0">
                        <p className="text-[11px] text-text-tertiary uppercase font-semibold tracking-widest mb-1">Task</p>
                        <p className="text-[13px] text-text-primary leading-snug line-clamp-2 font-medium">
                            {instruction || '—'}
                        </p>
                    </div>

                    {/* Steps */}
                    <div className="flex-1 overflow-y-auto thin-scrollbar px-3 py-3 space-y-2">
                        {status === 'thinking' && steps.length === 0 && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="flex items-center gap-3 px-3 py-3 rounded-xl bg-white/[0.03] border border-white/[0.05]"
                            >
                                <CircleNotch className="h-4 w-4 text-brand animate-spin shrink-0" />
                                <span className="text-[12px] text-text-secondary">Analysing task...</span>
                            </motion.div>
                        )}

                        {steps.map((step, i) => (
                            <StepCard
                                key={step.step}
                                step={step}
                                isLast={i === steps.length - 1}
                                isRunning={isActive}
                            />
                        ))}

                        {/* Auth required notice */}
                        {status === 'auth' && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.97 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="rounded-xl bg-amber-400/5 border border-amber-400/20 overflow-hidden"
                            >
                                <div className="flex gap-3 px-3 py-3">
                                    <LockKey className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-[12px] font-semibold text-amber-400">Login Required</p>
                                        <p className="text-[11px] text-text-secondary mt-0.5 leading-snug">
                                            Log in to {authService || 'the website'} to continue. The agent is paused and will resume automatically once you're signed in.
                                        </p>
                                    </div>
                                </div>
                                <div className="flex gap-2 px-3 pb-3">
                                    {authUrl && (
                                        <button
                                            onClick={() => (window.electron as any)?.accounts?.openLoginPopup(authUrl)}
                                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold text-amber-400 bg-amber-400/10 hover:bg-amber-400/20 transition-colors"
                                        >
                                            <ArrowsClockwise className="h-3 w-3" />
                                            Open Login Page
                                        </button>
                                    )}
                                    <button
                                        onClick={onResume}
                                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold text-success bg-success/10 hover:bg-success/20 transition-colors"
                                    >
                                        <ArrowRight className="h-3 w-3" />
                                        Resume Agent
                                    </button>
                                </div>
                            </motion.div>
                        )}

                        {/* Result */}
                        {isDone && result && (
                            <motion.div
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1 }}
                                className={cn(
                                    'flex gap-3 px-3 py-3 rounded-xl border',
                                    status === 'done' ? 'bg-success/5 border-success/20' : 'bg-red-400/5 border-red-400/15'
                                )}
                            >
                                {status === 'done' ? (
                                    <CheckCircle className="h-4 w-4 text-success shrink-0 mt-0.5" weight="fill" />
                                ) : (
                                    <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" weight="fill" />
                                )}
                                <p className="text-[12px] text-text-secondary leading-snug">{result}</p>
                            </motion.div>
                        )}

                        <div ref={stepsEndRef} />
                    </div>

                    {/* Footer */}
                    <div className="px-3 pb-3 pt-2 border-t border-white/[0.06] shrink-0 space-y-2">
                        {/* Stop button — only when running */}
                        {isActive && (
                            <button
                                onClick={onStop}
                                className={cn(
                                    'flex items-center justify-center gap-2 w-full py-2 rounded-xl',
                                    'text-sm font-medium text-red-400',
                                    'bg-red-400/8 hover:bg-red-400/15 border border-red-400/15',
                                    'transition-all duration-150'
                                )}
                            >
                                <StopCircle className="h-4 w-4" weight="fill" />
                                Stop Agent
                            </button>
                        )}

                        {/* Follow-up input — when done */}
                        {isDone && (
                            <form onSubmit={handleFollowUp} className="flex items-center gap-2">
                                <input
                                    ref={inputRef}
                                    value={followUp}
                                    onChange={e => setFollowUp(e.target.value)}
                                    placeholder="Follow up..."
                                    className={cn(
                                        'flex-1 h-9 px-3 rounded-xl text-sm',
                                        'bg-white/[0.05] border border-white/[0.08]',
                                        'text-text-primary placeholder:text-text-tertiary',
                                        'focus:outline-none focus:border-brand/40 focus:ring-1 focus:ring-brand/30',
                                        'transition-all duration-150'
                                    )}
                                />
                                <button
                                    type="submit"
                                    disabled={!followUp.trim()}
                                    className="btn-icon h-9 w-9 bg-brand/10 hover:bg-brand/20 text-brand disabled:opacity-30 disabled:hover:bg-brand/10"
                                >
                                    <PaperPlaneTilt className="h-4 w-4" weight="fill" />
                                </button>
                            </form>
                        )}
                    </div>
                </motion.aside>
            )}
        </AnimatePresence>
    );
}
