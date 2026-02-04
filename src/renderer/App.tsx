import React, { useState } from 'react';
import { CommandBar } from './components/CommandBar';
import { Sidebar } from './components/Sidebar';
import { cn } from './lib/utils';
import {
    ChevronDown,
    ChevronUp,
    Terminal,
    X,
    Maximize2,
    Minimize2,
} from 'lucide-react';

type Status = 'idle' | 'thinking' | 'running' | 'done' | 'error';

interface LogEntry {
    type: 'user' | 'agent' | 'system' | 'error';
    message: string;
    timestamp: Date;
}

function App() {
    const [status, setStatus] = useState<Status>('idle');
    const [isRunning, setIsRunning] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [isLogsExpanded, setIsLogsExpanded] = useState(false);
    const [isLogsVisible, setIsLogsVisible] = useState(true);

    const addLog = (type: LogEntry['type'], message: string) => {
        setLogs(prev => [...prev, { type, message, timestamp: new Date() }]);
    };

    const handleRun = async (instruction: string) => {
        setIsRunning(true);
        setStatus('thinking');
        setIsLogsVisible(true);
        addLog('user', instruction);

        try {
            setStatus('running');
            addLog('system', 'Connecting to agent...');

            const response = await fetch('http://127.0.0.1:8000/agent/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instruction }),
            });

            const data = await response.json();
            addLog('agent', JSON.stringify(data, null, 2));
            setStatus('done');
        } catch (error) {
            console.error(error);
            addLog('error', 'Failed to connect to agent backend. Make sure the server is running.');
            setStatus('error');
        } finally {
            setIsRunning(false);
        }
    };

    const clearLogs = () => {
        setLogs([]);
        setStatus('idle');
    };

    const getLogIcon = (type: LogEntry['type']) => {
        switch (type) {
            case 'user':
                return <span className="text-brand">You</span>;
            case 'agent':
                return <span className="text-accent-violet">Agent</span>;
            case 'system':
                return <span className="text-text-tertiary">System</span>;
            case 'error':
                return <span className="text-error">Error</span>;
        }
    };

    return (
        <div className="flex h-screen w-full bg-surface overflow-hidden font-sans">
            {/* Sidebar */}
            <Sidebar />

            {/* Main Content */}
            <main className="flex-1 flex flex-col h-full relative overflow-hidden">
                {/* Draggable Title Bar Area (for Electron) */}
                <div className="h-12 shrink-0 flex items-center justify-center" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
                    <span className="text-xs text-text-tertiary font-medium">
                        Poseidon
                    </span>
                </div>

                {/* Hero Section */}
                <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden px-6">
                    {/* Subtle Background Gradient */}
                    <div className="absolute inset-0 bg-mesh-light pointer-events-none" />

                    {/* Decorative Elements */}
                    <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand/5 rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent-violet/5 rounded-full blur-3xl pointer-events-none" />

                    {/* Content */}
                    <div className="relative z-10 w-full max-w-2xl mx-auto space-y-8 animate-fade-in-up">
                        {/* Hero Text */}
                        <div className="text-center space-y-3">
                            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-text-primary">
                                What can I do for you
                                <span className="text-gradient-brand">?</span>
                            </h1>
                            <p className="text-lg text-text-secondary max-w-md mx-auto">
                                Your AI-powered browser assistant. Just describe what you need.
                            </p>
                        </div>

                        {/* Command Bar */}
                        <CommandBar
                            onRun={handleRun}
                            isRunning={isRunning}
                            status={status}
                        />

                        {/* Quick Actions */}
                        <div className="flex flex-wrap items-center justify-center gap-2">
                            {[
                                'Search for flights',
                                'Summarize this page',
                                'Fill this form',
                                'Compare prices',
                            ].map((action, index) => (
                                <button
                                    key={index}
                                    onClick={() => handleRun(action)}
                                    disabled={isRunning}
                                    className={cn(
                                        "px-4 py-2 rounded-full text-sm font-medium",
                                        "bg-surface-tertiary text-text-secondary border border-border/60",
                                        "transition-all duration-200 ease-smooth",
                                        "hover:bg-surface-secondary hover:border-border-strong hover:text-text-primary",
                                        "active:scale-[0.98]",
                                        "disabled:opacity-50 disabled:cursor-not-allowed"
                                    )}
                                >
                                    {action}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Logs Panel */}
                {isLogsVisible && logs.length > 0 && (
                    <div
                        className={cn(
                            "border-t border-border bg-surface-secondary/80 backdrop-blur-sm transition-all duration-300 ease-smooth",
                            isLogsExpanded ? "h-80" : "h-36"
                        )}
                    >
                        {/* Logs Header */}
                        <div className="flex items-center justify-between px-4 py-2 border-b border-border/60">
                            <div className="flex items-center gap-2">
                                <Terminal className="h-4 w-4 text-text-tertiary" />
                                <span className="text-sm font-medium text-text-secondary">
                                    Activity Log
                                </span>
                                <span className="badge badge-brand text-[10px]">
                                    {logs.length}
                                </span>
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setIsLogsExpanded(!isLogsExpanded)}
                                    className="btn-icon h-7 w-7"
                                    title={isLogsExpanded ? "Collapse" : "Expand"}
                                >
                                    {isLogsExpanded ? (
                                        <Minimize2 className="h-3.5 w-3.5" />
                                    ) : (
                                        <Maximize2 className="h-3.5 w-3.5" />
                                    )}
                                </button>
                                <button
                                    onClick={clearLogs}
                                    className="btn-icon h-7 w-7"
                                    title="Clear logs"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>

                        {/* Logs Content */}
                        <div className="h-[calc(100%-41px)] overflow-y-auto thin-scrollbar p-4 space-y-3 font-mono text-sm">
                            {logs.map((log, index) => (
                                <div
                                    key={index}
                                    className={cn(
                                        "flex gap-3 animate-fade-in",
                                        log.type === 'error' && "text-error"
                                    )}
                                >
                                    <span className="text-[11px] text-text-tertiary shrink-0 w-16 pt-0.5">
                                        {log.timestamp.toLocaleTimeString([], {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                            second: '2-digit'
                                        })}
                                    </span>
                                    <span className="text-[11px] font-semibold shrink-0 w-12 pt-0.5">
                                        {getLogIcon(log.type)}
                                    </span>
                                    <span className={cn(
                                        "flex-1 text-text-secondary whitespace-pre-wrap break-words",
                                        log.type === 'error' && "text-error",
                                        log.type === 'agent' && "text-text-primary"
                                    )}>
                                        {log.message}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;
