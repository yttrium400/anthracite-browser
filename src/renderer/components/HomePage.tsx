import React, { useState } from 'react';
import { cn } from '../lib/utils';
import { CommandBar } from './CommandBar';
import { Sparkles } from 'lucide-react';

interface HomePageProps {
    className?: string;
}

export function HomePage({ className }: HomePageProps) {
    const [isRunning, setIsRunning] = useState(false);
    const [status, setStatus] = useState<'idle' | 'thinking' | 'running' | 'done' | 'error'>('idle');

    const handleRunAgent = async (instruction: string) => {
        // Check if it looks like a URL or search term for navigation
        const urlPattern = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/;
        const isUrl = urlPattern.test(instruction.trim());

        if (isUrl || instruction.startsWith('http')) {
            // Navigate directly
            window.electron?.navigation.navigate(instruction.trim());
            return;
        }

        // Otherwise, run the AI agent
        setIsRunning(true);
        setStatus('thinking');

        try {
            const response = await fetch('http://127.0.0.1:8000/agent/run', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ instruction }),
            });

            setStatus('running');
            const data = await response.json();

            if (data.status === 'success') {
                setStatus('done');
            } else {
                setStatus('error');
            }
            console.log('Agent Result:', data);
        } catch (error) {
            console.error('Failed to run agent:', error);
            setStatus('error');
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className={cn(
            "flex flex-col items-center justify-center h-full w-full bg-gradient-to-b from-surface to-surface-secondary/30",
            "animate-in fade-in duration-500",
            className
        )}>
            <div className="w-full max-w-2xl px-6 flex flex-col items-center gap-10 -mt-16">
                {/* Brand / Greeting */}
                <div className="flex flex-col items-center gap-4">
                    <div className="relative group">
                        <div className="absolute inset-0 bg-gradient-to-br from-brand to-accent-violet rounded-3xl blur-2xl opacity-30 group-hover:opacity-50 transition-opacity" />
                        <div className="relative h-20 w-20 rounded-3xl bg-gradient-to-br from-brand to-accent-violet flex items-center justify-center shadow-xl shadow-brand/20">
                            <Sparkles className="h-10 w-10 text-white" />
                        </div>
                    </div>
                    <div className="text-center">
                        <h1 className="text-4xl font-light text-text-primary tracking-tight">
                            What would you like to do?
                        </h1>
                        <p className="mt-2 text-text-tertiary">
                            Search the web, or let AI browse for you.
                        </p>
                    </div>
                </div>

                {/* Command Bar (existing component) */}
                <CommandBar
                    onRun={handleRunAgent}
                    isRunning={isRunning}
                    status={status}
                />
            </div>
        </div>
    );
}
