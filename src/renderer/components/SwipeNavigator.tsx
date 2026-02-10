import React, { useState, useCallback, useRef, useImperativeHandle, forwardRef, useEffect } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';

interface SwipeNavigatorProps {
    onBack: () => void;
    onForward: () => void;
    canGoBack: boolean;
    canGoForward: boolean;
    /** True when on an internal page (no webview to forward wheel events) */
    isInternalPage?: boolean;
}

export interface SwipeNavigatorHandle {
    onWheel: (deltaX: number) => void;
}

const SWIPE_THRESHOLD = 50;
const MAX_ARROW_TRAVEL = 60;

export const SwipeNavigator = forwardRef<SwipeNavigatorHandle, SwipeNavigatorProps>(
    ({ onBack, onForward, canGoBack, canGoForward, isInternalPage }, ref) => {
        const [progress, setProgress] = useState(0);
        const [phase, setPhase] = useState<'idle' | 'swiping'>('idle');
        const accumulated = useRef(0);
        const gestureActive = useRef(false);
        // Tracks whether fingers are physically on the trackpad (from OS events)
        const touchActive = useRef(false);

        const reset = useCallback(() => {
            accumulated.current = 0;
            gestureActive.current = false;
            setProgress(0);
            setPhase('idle');
        }, []);

        const handleEnd = useCallback(() => {
            if (!gestureActive.current) { reset(); return; }

            const x = accumulated.current;
            if (Math.abs(x) >= SWIPE_THRESHOLD) {
                const dir = x < 0 ? 'back' : 'forward';
                const canNav = dir === 'back' ? canGoBack : canGoForward;
                if (canNav) {
                    if (dir === 'back') onBack();
                    else onForward();
                }
            }
            reset();
        }, [canGoBack, canGoForward, onBack, onForward, reset]);

        const handleWheel = useCallback((deltaX: number) => {
            // Ignore momentum/inertial wheel events after fingers have left the trackpad
            if (!touchActive.current) return;

            accumulated.current += deltaX;

            const x = accumulated.current;
            const dir = x < 0 ? 'back' : 'forward';
            const canNav = dir === 'back' ? canGoBack : canGoForward;
            if (!canNav) return;

            gestureActive.current = true;
            setProgress(accumulated.current);
            setPhase('swiping');
        }, [canGoBack, canGoForward]);

        // Expose onWheel to parent for webview ipc-message forwarding
        useImperativeHandle(ref, () => ({
            onWheel: handleWheel,
        }), [handleWheel]);

        // macOS scroll-touch lifecycle from BrowserWindow (via main process).
        // scroll-touch-begin = fingers touched trackpad
        // scroll-touch-end = fingers lifted off trackpad
        // This is how real browsers distinguish direct manipulation from momentum.
        useEffect(() => {
            const nav = window.electron?.navigation;
            if (!nav?.onScrollTouchBegin || !nav?.onScrollTouchEnd) return;

            const unsubBegin = nav.onScrollTouchBegin(() => {
                touchActive.current = true;
            });
            const unsubEnd = nav.onScrollTouchEnd(() => {
                touchActive.current = false;
                handleEnd();
            });

            return () => {
                unsubBegin();
                unsubEnd();
            };
        }, [handleEnd]);

        // Native macOS swipe event (fallback — fires on 3-finger swipe depending on system prefs)
        useEffect(() => {
            if (!window.electron?.navigation?.onSwipe) return;
            const unsubscribe = window.electron.navigation.onSwipe((direction: string) => {
                if (direction === 'right' && canGoBack) onBack();
                else if (direction === 'left' && canGoForward) onForward();
            });
            return unsubscribe;
        }, [canGoBack, canGoForward, onBack, onForward]);

        // Direct wheel listener for internal pages (home/settings — no webview to forward events)
        useEffect(() => {
            if (!isInternalPage) return;

            const onWheel = (e: WheelEvent) => {
                const absX = Math.abs(e.deltaX);
                const absY = Math.abs(e.deltaY);
                if (absX < 3 || absY > absX * 2) return;

                handleWheel(e.deltaX);
            };

            window.addEventListener('wheel', onWheel, { passive: true });
            return () => {
                window.removeEventListener('wheel', onWheel);
            };
        }, [isInternalPage, handleWheel]);

        // Visual calculations
        const direction = progress < 0 ? 'back' : 'forward';
        const absProgress = Math.abs(progress);
        const reachedThreshold = absProgress >= SWIPE_THRESHOLD;
        const canNav = direction === 'back' ? canGoBack : canGoForward;
        const show = phase === 'swiping' && canNav && absProgress > 8;

        if (!show) return null;

        const normalized = Math.min(absProgress / SWIPE_THRESHOLD, 1.5);
        const arrowTravel = Math.min(normalized * MAX_ARROW_TRAVEL, MAX_ARROW_TRAVEL);
        const opacity = Math.min(normalized * 1.5, 1);
        const scale = reachedThreshold ? 1.1 : 0.7 + normalized * 0.3;

        const indicator = (side: 'left' | 'right') => (
            <div
                className={`fixed ${side}-0 top-1/2 z-[9999] pointer-events-none`}
                style={{
                    transform: side === 'left'
                        ? `translateY(-50%) translateX(${arrowTravel - 44}px)`
                        : `translateY(-50%) translateX(-${arrowTravel - 44}px)`,
                    opacity,
                }}
            >
                <div
                    className={cn(
                        "flex items-center justify-center w-11 h-11 rounded-full shadow-lg backdrop-blur-sm border",
                        reachedThreshold
                            ? "bg-blue-500 border-blue-400 text-white shadow-blue-500/25"
                            : "bg-white/80 border-gray-200/60 text-gray-400"
                    )}
                    style={{ transform: `scale(${scale})` }}
                >
                    {side === 'left'
                        ? <ArrowLeft className="h-5 w-5" strokeWidth={2.5} />
                        : <ArrowRight className="h-5 w-5" strokeWidth={2.5} />}
                </div>
            </div>
        );

        return (
            <>
                {direction === 'back' && indicator('left')}
                {direction === 'forward' && indicator('right')}
            </>
        );
    }
);

SwipeNavigator.displayName = 'SwipeNavigator';
