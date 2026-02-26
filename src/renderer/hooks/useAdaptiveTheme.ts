import { useEffect, useRef } from 'react';

// Default brand: warm gold hsl(33, 42%, 63%)
const DEFAULT_H = 33;
const DEFAULT_S = 42;
const DEFAULT_L = 63;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    if (max === min) return [0, 0, l * 100];

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    let h = 0;
    switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
    }

    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

async function extractHslFromFavicon(siteUrl: string): Promise<[number, number, number] | null> {
    return new Promise(resolve => {
        let hostname = '';
        try {
            hostname = new URL(siteUrl).hostname;
        } catch {
            resolve(null);
            return;
        }

        // Use Google's favicon service — CORS-safe, consistent size
        const src = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;

        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.width || 64;
                canvas.height = img.height || 64;
                const ctx = canvas.getContext('2d');
                if (!ctx) { resolve(null); return; }

                ctx.drawImage(img, 0, 0);
                const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

                let bestH = DEFAULT_H;
                let bestS = 0;
                let bestL = DEFAULT_L;
                let bestScore = -1;

                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
                    if (a < 128) continue; // skip transparent

                    const [h, s, l] = rgbToHsl(r, g, b);
                    if (s < 25) continue;         // skip near-grays
                    if (l < 15 || l > 85) continue; // skip too dark/light

                    // Score: favor high saturation + midrange lightness
                    const score = s * (1 - Math.abs(l - 50) / 50);
                    if (score > bestScore) {
                        bestScore = score;
                        bestH = h;
                        bestS = s;
                        bestL = l;
                    }
                }

                if (bestScore < 8) {
                    resolve(null); // Too monochromatic — keep default
                    return;
                }

                // Normalize: ensure legibility on dark background
                const finalH = bestH;
                const finalS = Math.min(75, Math.max(50, bestS));
                const finalL = Math.min(68, Math.max(55, bestL));

                resolve([finalH, finalS, finalL]);
            } catch {
                resolve(null);
            }
        };

        img.onerror = () => resolve(null);
        img.src = src;
    });
}

function applyBrand(h: number, s: number, l: number) {
    const root = document.documentElement;
    root.style.setProperty('--brand-h', String(h));
    root.style.setProperty('--brand-s', `${s}%`);
    root.style.setProperty('--brand-l', `${l}%`);
}

function resetBrand() {
    const root = document.documentElement;
    root.style.setProperty('--brand-h', String(DEFAULT_H));
    root.style.setProperty('--brand-s', `${DEFAULT_S}%`);
    root.style.setProperty('--brand-l', `${DEFAULT_L}%`);
}

export function useAdaptiveTheme(tabUrl: string | undefined) {
    const lastUrlRef = useRef<string | undefined>();

    useEffect(() => {
        if (!tabUrl) return;

        const isInternal =
            tabUrl.startsWith('anthracite://') ||
            tabUrl.startsWith('about:') ||
            tabUrl.startsWith('data:');

        if (isInternal) {
            resetBrand();
            lastUrlRef.current = tabUrl;
            return;
        }

        // Deduplicate: skip if URL (or at least the hostname) hasn't changed
        try {
            const newHost = new URL(tabUrl).hostname;
            const prevHost = lastUrlRef.current ? new URL(lastUrlRef.current).hostname : '';
            if (newHost === prevHost) return;
        } catch { /* proceed */ }

        lastUrlRef.current = tabUrl;

        extractHslFromFavicon(tabUrl).then(hsl => {
            // Guard: tab may have changed while we were loading the favicon
            if (lastUrlRef.current !== tabUrl) return;
            if (hsl) {
                applyBrand(...hsl);
            } else {
                resetBrand();
            }
        });
    }, [tabUrl]);
}
