import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// Settings Types
// ============================================

export interface AppSettings {
    // Browser
    adBlockerEnabled: boolean;
    httpsUpgradeEnabled: boolean;
    defaultSearchEngine: 'google' | 'duckduckgo' | 'bing' | 'brave';

    // Appearance
    theme: 'light' | 'dark' | 'system';
    sidebarPosition: 'left' | 'right';
    compactMode: boolean;
    homeBackground: 'earth-horizon' | 'gradient-mesh' | 'aurora' | 'minimal' | 'custom';
    homeBackgroundCustomUrl: string;
    homeBackgroundIntensity: number;
    uiScale: 'extra-small' | 'small' | 'medium' | 'large' | 'extra-large';

    // Privacy
    historyEnabled: boolean;
    historyRetentionDays: number;
    clearHistoryOnExit: boolean;
    blockThirdPartyCookies: boolean;
    sendDoNotTrack: boolean;

    // Tabs & Navigation
    openLinksInNewTab: boolean;
    confirmBeforeClosingMultipleTabs: boolean;
    restoreTabsOnStartup: boolean;

    // Developer
    enableDevTools: boolean;

    // API Configuration
    openaiApiKey?: string;
    anthropicApiKey?: string;
    googleApiKey?: string;
    selectedModel?: string; // e.g. "claude-sonnet-4-6", "gpt-4o", "gemini-2.0-flash"

    // Onboarding
    hasCompletedOnboarding: boolean;
}

// Default settings
const DEFAULT_SETTINGS: AppSettings = {
    // Browser
    adBlockerEnabled: true,
    httpsUpgradeEnabled: true,
    defaultSearchEngine: 'google',

    // Appearance
    theme: 'dark',
    sidebarPosition: 'left',
    compactMode: false,
    homeBackground: 'earth-horizon',
    homeBackgroundCustomUrl: '',
    homeBackgroundIntensity: 50,
    uiScale: 'small',

    // Privacy
    historyEnabled: true,
    historyRetentionDays: 90,
    clearHistoryOnExit: false,
    blockThirdPartyCookies: false,
    sendDoNotTrack: true,

    // Tabs & Navigation
    openLinksInNewTab: true,
    confirmBeforeClosingMultipleTabs: true,
    restoreTabsOnStartup: false,

    // Developer
    enableDevTools: false,

    // Onboarding
    hasCompletedOnboarding: false,
};

// ============================================
// Settings Store
// ============================================

class SettingsStore {
    private settings: AppSettings;
    private filePath: string;
    private saveTimeout: NodeJS.Timeout | null = null;

    constructor() {
        this.filePath = path.join(app.getPath('userData'), 'settings.json');
        this.settings = this.loadSettings();
    }

    private loadSettings(): AppSettings {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = fs.readFileSync(this.filePath, 'utf-8');
                const loaded = JSON.parse(data);
                // Merge with defaults to ensure all keys exist
                return { ...DEFAULT_SETTINGS, ...loaded };
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
        return { ...DEFAULT_SETTINGS };
    }

    private saveSettings(): void {
        // Debounce saves to prevent excessive I/O
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        this.saveTimeout = setTimeout(() => {
            try {
                const dir = path.dirname(this.filePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8');
            } catch (error) {
                console.error('Failed to save settings:', error);
            }
        }, 500);
    }

    // Get all settings
    getAll(): AppSettings {
        return { ...this.settings };
    }

    // Get a single setting
    get<K extends keyof AppSettings>(key: K): AppSettings[K] {
        return this.settings[key];
    }

    // Update a single setting
    set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): AppSettings {
        this.settings[key] = value;
        this.saveSettings();
        return { ...this.settings };
    }

    // Update multiple settings
    update(updates: Partial<AppSettings>): AppSettings {
        this.settings = { ...this.settings, ...updates };
        this.saveSettings();
        return { ...this.settings };
    }

    // Reset to defaults
    reset(): AppSettings {
        this.settings = { ...DEFAULT_SETTINGS };
        this.saveSettings();
        return { ...this.settings };
    }

    // Reset a single setting to default
    resetKey<K extends keyof AppSettings>(key: K): AppSettings {
        this.settings[key] = DEFAULT_SETTINGS[key];
        this.saveSettings();
        return { ...this.settings };
    }
}

// Singleton instance
export const settingsStore = new SettingsStore();
