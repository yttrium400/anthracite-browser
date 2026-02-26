import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';
import { CommandBar } from './CommandBar';
import type { AgentStatus } from './AgentPanel';

type HomeBackground = 'earth-horizon' | 'gradient-mesh' | 'aurora' | 'minimal' | 'custom';

interface HomePageProps {
    className?: string;
    onRun?: (instruction: string) => void;
    agentStatus?: AgentStatus;
}

function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
}

export function HomePage({ className, onRun, agentStatus }: HomePageProps) {
    const [greeting] = useState(getGreeting);
    const [background, setBackground] = useState<HomeBackground>('earth-horizon');
    const [customUrl, setCustomUrl] = useState('');
    const [intensity, setIntensity] = useState(60);

    // Load background preference from settings
    useEffect(() => {
        const loadBg = async () => {
            if (window.electron?.settings) {
                const settings = await window.electron.settings.getAll();
                if (settings?.homeBackground) {
                    setBackground(settings.homeBackground);
                }
                if (settings?.homeBackgroundCustomUrl) {
                    setCustomUrl(settings.homeBackgroundCustomUrl);
                }
                if (settings?.homeBackgroundIntensity !== undefined) {
                    setIntensity(settings.homeBackgroundIntensity);
                }
            }
        };
        loadBg();

        // Listen for settings changes
        const unsub = window.electron?.settings.onChanged((data: any) => {
            if (data.settings?.homeBackground) {
                setBackground(data.settings.homeBackground);
            }
            if (data.settings?.homeBackgroundCustomUrl !== undefined) {
                setCustomUrl(data.settings.homeBackgroundCustomUrl);
            }
            if (data.settings?.homeBackgroundIntensity !== undefined) {
                setIntensity(data.settings.homeBackgroundIntensity);
            }
        });
        return () => { unsub?.(); };
    }, []);

    const handleSearch = (instruction: string) => {
        const input = instruction.trim();
        if (!input) return;
        if (onRun) {
            onRun(input);
        } else {
            window.electron?.navigation.navigate(input);
        }
    };

    return (
        <div className={cn(
            "flex flex-col items-center justify-center h-full w-full bg-[#0A0A0B] relative overflow-hidden",
            className
        )}>
            {/* Dynamic background — intensity controlled */}
            <div className="pointer-events-none" style={{ opacity: intensity / 100 }}>
                {background === 'earth-horizon' && (
                    <>
                        <div className="earth-horizon" />
                        <div className="earth-horizon-glow" />
                    </>
                )}
                {background === 'gradient-mesh' && (
                    <div className="gradient-mesh-bg" />
                )}
                {background === 'aurora' && (
                    <div className="aurora-bg" />
                )}
                {background === 'custom' && customUrl && (
                    <div
                        className="fixed inset-0 z-0 pointer-events-none bg-cover bg-center"
                        style={{ backgroundImage: `url(${customUrl})` }}
                    />
                )}
            </div>
            {/* minimal = no background layers, just solid #0A0A0B */}

            {/* Subtle ambient orb (always present, very faint) */}
            <div className="absolute inset-0 pointer-events-none">
                <motion.div
                    className="absolute top-[15%] left-[30%] w-[600px] h-[600px] rounded-full"
                    style={{
                        background: 'radial-gradient(circle, rgba(200,169,126,0.04) 0%, transparent 70%)',
                    }}
                    animate={{
                        x: [0, 20, -15, 0],
                        y: [0, -15, 10, 0],
                    }}
                    transition={{
                        duration: 30,
                        repeat: Infinity,
                        ease: 'linear',
                    }}
                />
            </div>

            <motion.div
                className="relative w-full max-w-2xl px-6 flex flex-col items-center gap-12 -mt-16 z-10"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
            >
                {/* Brand / Greeting */}
                <div className="flex flex-col items-center gap-5">
                    {/* Wordmark */}
                    <motion.h2
                        className="font-display text-sm font-medium tracking-[0.3em] uppercase text-white/25"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.1 }}
                    >
                        Anthracite
                    </motion.h2>

                    {/* Greeting */}
                    <motion.div
                        className="text-center"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.2 }}
                    >
                        <h1 className="font-display text-5xl font-extralight text-text-primary tracking-tight">
                            {greeting}
                        </h1>
                        <p className="mt-3 text-text-tertiary text-base font-light">
                            Search the web, or let AI browse for you.
                        </p>
                    </motion.div>
                </div>

                {/* Command Bar */}
                <motion.div
                    className="w-full"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.3 }}
                >
                    <CommandBar
                        onRun={handleSearch}
                        isRunning={agentStatus === 'thinking' || agentStatus === 'running'}
                        status={agentStatus === 'thinking' ? 'thinking' : agentStatus === 'running' ? 'running' : agentStatus === 'done' ? 'done' : agentStatus === 'error' ? 'error' : 'idle'}
                    />
                </motion.div>
            </motion.div>
        </div>
    );
}
