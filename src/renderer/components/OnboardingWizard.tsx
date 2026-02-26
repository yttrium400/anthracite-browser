/**
 * OnboardingWizard — First-run setup experience
 *
 * Steps:
 *   1. Welcome  — logo + tagline, sets the tone
 *   2. Import   — detect installed browsers, import history with one click
 *   3. Finish   — "You're all set" confirmation, launches the browser
 */

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    ArrowRight,
    BrowsersLight,
    CheckCircle,
    CloudArrowDown,
    Spinner,
    X,
    Lightning,
    ShieldCheck,
    Robot,
} from '@phosphor-icons/react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BrowserProfile {
    browser: string
    profileName: string
    historyPath: string
    bookmarksPath?: string
    type: string
}

interface ImportStatus {
    state: 'idle' | 'importing' | 'done' | 'error'
    imported?: number
    error?: string
}

interface OnboardingWizardProps {
    onComplete: () => void
}

// ─── Step definitions ─────────────────────────────────────────────────────────

type Step = 'welcome' | 'import' | 'finish'
const STEPS: Step[] = ['welcome', 'import', 'finish']

// ─── Browser logos (simple text badges for now) ──────────────────────────────

function BrowserBadge({ browser }: { browser: string }) {
    const colors: Record<string, string> = {
        'Google Chrome': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
        'Brave': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
        'Microsoft Edge': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
        'Firefox': 'bg-orange-600/20 text-orange-400 border-orange-600/30',
        'Safari': 'bg-sky-500/20 text-sky-400 border-sky-500/30',
        'Arc': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
        'Chromium': 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    }
    const cls = colors[browser] ?? 'bg-white/10 text-text-secondary border-white/10'
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${cls}`}>
            {browser}
        </span>
    )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
    const [step, setStep] = useState<Step>('welcome')
    const [direction, setDirection] = useState(1)

    // Import state
    const [browsers, setBrowsers] = useState<BrowserProfile[]>([])
    const [browsersLoading, setBrowsersLoading] = useState(false)
    const [importStatus, setImportStatus] = useState<Record<string, ImportStatus>>({})
    const [anyImported, setAnyImported] = useState(false)

    // ── Load browsers when reaching import step ──────────────────────────────
    useEffect(() => {
        if (step === 'import' && browsers.length === 0 && !browsersLoading) {
            setBrowsersLoading(true)
            window.electron?.importer?.detectBrowsers().then((detected: BrowserProfile[]) => {
                setBrowsers(detected)
                setBrowsersLoading(false)
            }).catch(() => setBrowsersLoading(false))
        }
    }, [step, browsers.length, browsersLoading])

    // ── Navigation ───────────────────────────────────────────────────────────
    const goTo = useCallback((next: Step) => {
        const curr = STEPS.indexOf(step)
        const nxt = STEPS.indexOf(next)
        setDirection(nxt > curr ? 1 : -1)
        setStep(next)
    }, [step])

    const next = useCallback(() => {
        const idx = STEPS.indexOf(step)
        if (idx < STEPS.length - 1) goTo(STEPS[idx + 1])
    }, [step, goTo])

    // ── Import a single profile ───────────────────────────────────────────────
    const handleImport = useCallback(async (profile: BrowserProfile) => {
        const key = `${profile.browser}-${profile.profileName}`
        setImportStatus(prev => ({ ...prev, [key]: { state: 'importing' } }))
        try {
            const result = await window.electron?.importer?.importHistory(profile)
            setImportStatus(prev => ({
                ...prev,
                [key]: { state: 'done', imported: result?.imported ?? 0 },
            }))
            setAnyImported(true)
        } catch (err: any) {
            setImportStatus(prev => ({
                ...prev,
                [key]: { state: 'error', error: err?.message ?? 'Import failed' },
            }))
        }
    }, [])

    // ── Handle finish ────────────────────────────────────────────────────────
    const handleFinish = useCallback(async () => {
        await window.electron?.onboarding?.complete()
        onComplete()
    }, [onComplete])

    // ── Animation variants ───────────────────────────────────────────────────
    const variants = {
        enter: (d: number) => ({ opacity: 0, x: d * 32 }),
        center: { opacity: 1, x: 0 },
        exit: (d: number) => ({ opacity: 0, x: d * -32 }),
    }

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="relative w-[480px] max-h-[620px] rounded-2xl bg-surface-elevated border border-border-subtle shadow-2xl overflow-hidden flex flex-col"
            >
                {/* Progress dots */}
                <div className="flex items-center justify-center gap-2 pt-5 pb-1">
                    {STEPS.map((s) => (
                        <div
                            key={s}
                            className={`h-1.5 rounded-full transition-all duration-300 ${
                                s === step
                                    ? 'w-6 bg-brand'
                                    : STEPS.indexOf(s) < STEPS.indexOf(step)
                                    ? 'w-3 bg-brand/50'
                                    : 'w-3 bg-white/10'
                            }`}
                        />
                    ))}
                </div>

                {/* Step content */}
                <div className="flex-1 overflow-hidden relative">
                    <AnimatePresence initial={false} custom={direction} mode="wait">
                        <motion.div
                            key={step}
                            custom={direction}
                            variants={variants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{ duration: 0.22, ease: 'easeInOut' }}
                            className="absolute inset-0 flex flex-col"
                        >
                            {step === 'welcome' && <WelcomeStep onNext={next} />}
                            {step === 'import' && (
                                <ImportStep
                                    browsers={browsers}
                                    browsersLoading={browsersLoading}
                                    importStatus={importStatus}
                                    onImport={handleImport}
                                    onNext={next}
                                />
                            )}
                            {step === 'finish' && (
                                <FinishStep anyImported={anyImported} onFinish={handleFinish} />
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </motion.div>
        </div>
    )
}

// ─── Step: Welcome ────────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
    return (
        <div className="flex flex-col items-center justify-center flex-1 px-10 py-8 text-center">
            {/* Logo mark */}
            <motion.div
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.05, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
                className="w-16 h-16 rounded-2xl bg-brand/15 border border-brand/30 flex items-center justify-center mb-6"
            >
                <BrowsersLight className="w-8 h-8 text-brand" weight="duotone" />
            </motion.div>

            <motion.h1
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 }}
                className="text-2xl font-bold text-text-primary mb-2"
            >
                Welcome to Anthracite
            </motion.h1>
            <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.18 }}
                className="text-[13px] text-text-secondary leading-relaxed mb-8"
            >
                The browser that thinks alongside you.
                <br />
                Let's get you set up in two quick steps.
            </motion.p>

            {/* Feature highlights */}
            <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.24 }}
                className="w-full space-y-2.5 mb-8"
            >
                {[
                    { icon: Robot, label: 'AI agent that browses for you' },
                    { icon: Lightning, label: 'Lightning-fast with built-in ad blocking' },
                    { icon: ShieldCheck, label: 'Private — your data stays on your device' },
                ].map(({ icon: Icon, label }) => (
                    <div key={label} className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/4 border border-white/6">
                        <Icon className="w-4 h-4 text-brand shrink-0" weight="duotone" />
                        <span className="text-[12px] text-text-secondary">{label}</span>
                    </div>
                ))}
            </motion.div>

            <motion.button
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                onClick={onNext}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand text-black text-[13px] font-semibold hover:bg-brand/90 transition-colors"
            >
                Get Started
                <ArrowRight className="w-4 h-4" weight="bold" />
            </motion.button>
        </div>
    )
}

// ─── Step: Import ─────────────────────────────────────────────────────────────

function ImportStep({
    browsers,
    browsersLoading,
    importStatus,
    onImport,
    onNext,
}: {
    browsers: BrowserProfile[]
    browsersLoading: boolean
    importStatus: Record<string, ImportStatus>
    onImport: (profile: BrowserProfile) => void
    onNext: () => void
}) {
    return (
        <div className="flex flex-col flex-1 px-8 py-6">
            <div className="mb-5">
                <h2 className="text-[18px] font-bold text-text-primary mb-1">Import your history</h2>
                <p className="text-[12px] text-text-secondary leading-relaxed">
                    Bring your browsing history from other browsers so Anthracite's AI has context about your habits.
                    Nothing is shared externally.
                </p>
            </div>

            {/* Browser list */}
            <div className="flex-1 overflow-y-auto space-y-2 min-h-0 pr-1">
                {browsersLoading ? (
                    <div className="flex items-center justify-center py-10 gap-2 text-text-secondary text-[12px]">
                        <Spinner className="w-4 h-4 animate-spin" />
                        Detecting browsers…
                    </div>
                ) : browsers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                        <BrowsersLight className="w-8 h-8 text-text-muted mb-2" />
                        <p className="text-[12px] text-text-secondary">No other browsers detected.</p>
                        <p className="text-[11px] text-text-muted mt-0.5">You can import data later in Settings → Import.</p>
                    </div>
                ) : (
                    browsers.map((profile) => {
                        const key = `${profile.browser}-${profile.profileName}`
                        const status = importStatus[key] ?? { state: 'idle' }
                        return (
                            <div
                                key={key}
                                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/4 border border-white/6"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <BrowserBadge browser={profile.browser} />
                                        {profile.profileName !== 'Default' && (
                                            <span className="text-[10px] text-text-muted">{profile.profileName}</span>
                                        )}
                                    </div>
                                    {status.state === 'done' && (
                                        <p className="text-[10px] text-success mt-0.5">
                                            {status.imported?.toLocaleString()} entries imported
                                        </p>
                                    )}
                                    {status.state === 'error' && (
                                        <p className="text-[10px] text-error mt-0.5">{status.error}</p>
                                    )}
                                </div>

                                {status.state === 'idle' && (
                                    <button
                                        onClick={() => onImport(profile)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-brand bg-brand/10 hover:bg-brand/20 transition-colors shrink-0"
                                    >
                                        <CloudArrowDown className="w-3.5 h-3.5" />
                                        Import
                                    </button>
                                )}
                                {status.state === 'importing' && (
                                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-text-muted shrink-0">
                                        <Spinner className="w-3.5 h-3.5 animate-spin" />
                                        Importing…
                                    </div>
                                )}
                                {status.state === 'done' && (
                                    <CheckCircle className="w-5 h-5 text-success shrink-0" weight="fill" />
                                )}
                            </div>
                        )
                    })
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between mt-5 pt-4 border-t border-border-subtle">
                <button
                    onClick={onNext}
                    className="text-[12px] text-text-muted hover:text-text-secondary transition-colors"
                >
                    Skip for now
                </button>
                <button
                    onClick={onNext}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl bg-brand text-black text-[12px] font-semibold hover:bg-brand/90 transition-colors"
                >
                    Continue
                    <ArrowRight className="w-3.5 h-3.5" weight="bold" />
                </button>
            </div>
        </div>
    )
}

// ─── Step: Finish ─────────────────────────────────────────────────────────────

function FinishStep({ anyImported, onFinish }: { anyImported: boolean; onFinish: () => void }) {
    return (
        <div className="flex flex-col items-center justify-center flex-1 px-10 py-8 text-center">
            <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
                className="w-16 h-16 rounded-full bg-success/15 border border-success/30 flex items-center justify-center mb-6"
            >
                <CheckCircle className="w-8 h-8 text-success" weight="fill" />
            </motion.div>

            <motion.h2
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-2xl font-bold text-text-primary mb-2"
            >
                You're all set!
            </motion.h2>
            <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.16 }}
                className="text-[13px] text-text-secondary leading-relaxed mb-8"
            >
                {anyImported
                    ? 'Your browsing history has been imported. Anthracite is ready to go.'
                    : 'Anthracite is ready. You can import data any time in Settings → Import Data.'}
            </motion.p>

            <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22 }}
                className="w-full space-y-2 mb-8"
            >
                <p className="text-[11px] text-text-muted">A few things to try:</p>
                {[
                    'Press ⌘K to open the command palette',
                    'Type a task in the agent bar (bottom) — "Find flights to Tokyo"',
                    'Add an API key in Settings → Developer to power the AI agent',
                ].map((tip) => (
                    <div key={tip} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-white/4 text-left">
                        <span className="text-brand text-[11px] mt-0.5">→</span>
                        <span className="text-[11px] text-text-secondary">{tip}</span>
                    </div>
                ))}
            </motion.div>

            <motion.button
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.28 }}
                onClick={onFinish}
                className="flex items-center gap-2 px-8 py-3 rounded-xl bg-brand text-black text-[13px] font-semibold hover:bg-brand/90 transition-colors"
            >
                Start Browsing
                <ArrowRight className="w-4 h-4" weight="bold" />
            </motion.button>
        </div>
    )
}
