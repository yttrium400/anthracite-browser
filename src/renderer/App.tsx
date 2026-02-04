import React, { useState, useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { HomePage } from './components/HomePage';
import { cn } from './lib/utils';

function App() {
    const [isReady, setIsReady] = useState(false);
    const [activeTab, setActiveTab] = useState<{ url: string } | null>(null);

    useEffect(() => {
        // Wait for electron APIs to be available
        if (typeof window !== 'undefined' && window.electron) {
            setIsReady(true);
        }
        // Wait for electron APIs to be available
        if (typeof window !== 'undefined' && window.electron) {
            setIsReady(true);

            // Get initial active tab
            window.electron.tabs.getActive().then(setActiveTab);

            // Listen for active tab changes
            const unsubscribeActive = window.electron.tabs.onActiveTabChanged(setActiveTab);

            // Listen for updates to current tab (in case URL changes)
            const unsubscribeUpdate = window.electron.tabs.onTabUpdated((updatedTab) => {
                setActiveTab(prev => (prev && (prev as any).id === updatedTab.id) ? updatedTab : prev);
            });

            return () => {
                unsubscribeActive();
                unsubscribeUpdate();
            };
        }
    }, []);

    return (
        <div className="h-screen w-full bg-surface overflow-hidden font-sans flex flex-col">
            {/* Top Navigation Bar */}
            <TopBar />

            {/* Main Content Area - BrowserView renders below this */}
            <main className="flex-1 relative">
                {/* Floating Sidebar */}
                <Sidebar />

                {/*
                    The BrowserView is managed by Electron main process
                    and renders directly below the TopBar (52px from top).
                    This area is just a placeholder/background.
                */}
                {!isReady ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-surface">
                        <div className="flex flex-col items-center gap-4">
                            <div className="loading-spinner w-8 h-8" />
                            <p className="text-sm text-text-tertiary">Loading...</p>
                        </div>
                    </div>
                ) : activeTab?.url === 'poseidon://newtab' ? (
                    <HomePage />
                ) : null}
            </main>
        </div>
    );
}

export default App;
