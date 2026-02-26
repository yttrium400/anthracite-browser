import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import {
    Shield,
    Globe,
    Palette,
    Lock,
    AppWindow,
    Code,
    CaretLeft,
    ArrowCounterClockwise,
    Check,
    MagnifyingGlass,
    UserCircle,
    SignOut,
    ArrowsClockwise,
    CreditCard,
    Lightning,
    CheckCircle,
    User,
    Envelope,
    GithubLogo,
    CircleNotch,
    SealCheck,
    ArrowSquareOut,
    Robot,
    ClockCounterClockwise,
    CaretDown,
    CaretRight,
    Trash,
    Play,
    DownloadSimple,
    CheckCircle as CheckCircleFill,
    Spinner,
} from '@phosphor-icons/react';

interface AppSettings {
    adBlockerEnabled: boolean;
    httpsUpgradeEnabled: boolean;
    defaultSearchEngine: 'google' | 'duckduckgo' | 'bing' | 'brave';
    theme: 'light' | 'dark' | 'system';
    sidebarPosition: 'left' | 'right';
    compactMode: boolean;
    homeBackground: 'earth-horizon' | 'gradient-mesh' | 'aurora' | 'minimal' | 'custom';
    homeBackgroundCustomUrl: string;
    homeBackgroundIntensity: number;
    uiScale: 'extra-small' | 'small' | 'medium' | 'large' | 'extra-large';
    historyEnabled: boolean;
    historyRetentionDays: number;
    clearHistoryOnExit: boolean;
    blockThirdPartyCookies: boolean;
    sendDoNotTrack: boolean;
    openLinksInNewTab: boolean;
    confirmBeforeClosingMultipleTabs: boolean;
    restoreTabsOnStartup: boolean;
    enableDevTools: boolean;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    googleApiKey?: string;
    selectedModel?: string;
}

interface SettingsPageProps {
    className?: string;
}

type SettingsSection = 'browser' | 'appearance' | 'privacy' | 'tabs' | 'developer' | 'accounts' | 'subscription' | 'account' | 'agent-history' | 'import' | 'agent-profile';

interface AuthUserPublic {
    id: string;
    email: string | null;
    name: string | null;
    avatarUrl: string | null;
    plan: 'free' | 'pro';
}

// Toggle Switch Component
function Toggle({
    enabled,
    onChange,
    disabled = false,
}: {
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <button
            onClick={() => !disabled && onChange(!enabled)}
            aria-checked={enabled}
            role="switch"
            className={cn(
                "relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer rounded-full border-2 border-transparent",
                "transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[#1A1A1D]",
                enabled ? "bg-brand" : "bg-white/[0.14]",
                disabled && "opacity-40 cursor-not-allowed"
            )}
        >
            <span
                className={cn(
                    "pointer-events-none inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow ring-0",
                    "transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
                    enabled ? "translate-x-[16px]" : "translate-x-0"
                )}
            />
        </button>
    );
}

// Setting Row Component
function SettingRow({
    label,
    description,
    children,
}: {
    label: string;
    description?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex items-center justify-between py-3.5 border-b border-white/[0.04] last:border-0">
            <div className="flex-1 pr-6">
                <h4 className="text-sm font-medium text-text-primary leading-snug">{label}</h4>
                {description && (
                    <p className="text-[11.5px] text-text-tertiary mt-0.5 leading-relaxed">{description}</p>
                )}
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}

// Select Component
function Select<T extends string>({
    value,
    options,
    onChange,
}: {
    value: T;
    options: { value: T; label: string }[];
    onChange: (value: T) => void;
}) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value as T)}
            className={cn(
                "px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.05] text-sm text-text-primary",
                "focus:outline-none focus:ring-1 focus:ring-brand/30 focus:border-brand/40",
                "cursor-pointer"
            )}
        >
            {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                    {opt.label}
                </option>
            ))}
        </select>
    );
}

// Section Header
function SectionHeader({
    icon: Icon,
    title,
    description,
}: {
    icon: React.ElementType;
    title: string;
    description?: string;
}) {
    return (
        <div className="mb-5">
            <h3 className="text-base font-semibold text-text-primary tracking-tight">{title}</h3>
            {description && (
                <p className="text-xs text-text-tertiary mt-1 leading-relaxed">{description}</p>
            )}
        </div>
    );
}

interface ConnectedAccount {
    service: string;
    email: string | null;
    isActive: boolean;
}

// Service domain map for the disconnect action
const SERVICE_DOMAINS: Record<string, string> = {
    'Google': '.google.com',
    'GitHub': 'github.com',
    'Amazon': '.amazon.com',
    'LinkedIn': '.linkedin.com',
    'Reddit': '.reddit.com',
    'X (Twitter)': '.twitter.com',
    'Microsoft': '.live.com',
};

// Colored initials avatars for each service
const SERVICE_COLORS: Record<string, string> = {
    'Google': 'bg-blue-500/20 text-blue-400',
    'GitHub': 'bg-white/10 text-white/70',
    'Amazon': 'bg-amber-500/20 text-amber-400',
    'LinkedIn': 'bg-blue-600/20 text-blue-400',
    'Reddit': 'bg-orange-500/20 text-orange-400',
    'X (Twitter)': 'bg-white/10 text-white/70',
    'Microsoft': 'bg-cyan-500/20 text-cyan-400',
};

export function SettingsPage({ className }: SettingsPageProps) {
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [activeSection, setActiveSection] = useState<SettingsSection>('account');
    const [isSaving, setIsSaving] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);
    const [showAnthropicKey, setShowAnthropicKey] = useState(false);
    const [showGoogleKey, setShowGoogleKey] = useState(false);
    const [apiKeyTestStatus, setApiKeyTestStatus] = useState<'success' | 'error' | 'testing' | null>(null);
    const [anthropicTestStatus, setAnthropicTestStatus] = useState<'success' | 'error' | 'testing' | null>(null);
    const [googleTestStatus, setGoogleTestStatus] = useState<'success' | 'error' | 'testing' | null>(null);
    const [appVersion, setAppVersion] = useState<string>('');
    const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
    const [accountsLoading, setAccountsLoading] = useState(false);

    // Agent task history
    const [agentTasks, setAgentTasks] = useState<any[]>([]);
    const [agentTasksLoading, setAgentTasksLoading] = useState(false);
    const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);

    // Agent memory / user profile
    const [agentMemory, setAgentMemory] = useState<{
        userName: string;
        preferredServices: Record<string, string>;
        customNotes: string;
        topDomains: string[];
    } | null>(null);
    const [agentMemorySaving, setAgentMemorySaving] = useState(false);
    const [agentMemorySaved, setAgentMemorySaved] = useState(false);

    // Browser import
    const [detectedBrowsers, setDetectedBrowsers] = useState<any[]>([]);
    const [importingId, setImportingId] = useState<string | null>(null);
    const [importResults, setImportResults] = useState<Record<string, { imported: number; errors: string[] }>>({});

    // Anthracite user account (task 7)
    const [authUser, setAuthUser] = useState<AuthUserPublic | null>(null);
    const [authEmail, setAuthEmail] = useState('');
    const [emailSent, setEmailSent] = useState(false);
    const [emailSending, setEmailSending] = useState(false);
    const [otpCode, setOtpCode] = useState('');
    const [otpVerifying, setOtpVerifying] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);

    // Load settings on mount
    useEffect(() => {
        const loadSettings = async () => {
            if (window.electron?.settings) {
                const loadedSettings = await window.electron.settings.getAll();
                setSettings(loadedSettings);
            }

            // Load app version
            try {
                if (window.electron?.getAppVersion) {
                    const version = await window.electron.getAppVersion();
                    setAppVersion(version);
                }
            } catch (err) {
                console.error('Failed to get app version:', err);
            }

            // Load auth user
            try {
                const user = await (window.electron as any)?.auth?.getUser();
                setAuthUser(user ?? null);
            } catch { /* auth not configured */ }
        };
        loadSettings();

        // Jump to a specific section if another component requested it via localStorage
        const pending = localStorage.getItem('settings-pending-section') as SettingsSection | null;
        if (pending) {
            setActiveSection(pending);
            localStorage.removeItem('settings-pending-section');
        }

        // Subscribe to settings changes
        const unsubscribe = window.electron?.settings.onChanged((data) => {
            if (data.settings) {
                setSettings(data.settings);
            }
        });

        // Subscribe to auth state changes
        const unsubscribeAuth = (window.electron as any)?.auth?.onStateChanged(
            (data: { user: AuthUserPublic | null }) => setAuthUser(data.user)
        );

        return () => {
            unsubscribe?.();
            unsubscribeAuth?.();
        };
    }, []);

    // Update a single setting
    const updateSetting = useCallback(async <K extends keyof AppSettings>(
        key: K,
        value: AppSettings[K]
    ) => {
        if (!window.electron?.settings) return;

        setIsSaving(true);
        try {
            const updated = await window.electron.settings.set(key, value);
            setSettings(updated);
        } catch (error) {
            console.error('Failed to update setting:', error);
        } finally {
            setIsSaving(false);
        }
    }, []);

    // Load connected accounts
    const loadConnectedAccounts = useCallback(async () => {
        if (!(window.electron as any)?.accounts) return;
        setAccountsLoading(true);
        try {
            const accounts = await (window.electron as any).accounts.getConnected();
            setConnectedAccounts(accounts || []);
        } catch (error) {
            console.error('Failed to load connected accounts:', error);
        } finally {
            setAccountsLoading(false);
        }
    }, []);

    // Load accounts when section becomes active
    useEffect(() => {
        if (activeSection === 'accounts') {
            loadConnectedAccounts();
        }
        if (activeSection === 'agent-history') {
            loadAgentTasks();
        }
        if (activeSection === 'agent-profile' && !agentMemory) {
            (window.electron as any)?.agentMemory?.get().then((mem: any) => {
                setAgentMemory(mem);
            }).catch(() => {});
        }
        if (activeSection === 'import' && detectedBrowsers.length === 0) {
            (window.electron as any)?.importer?.detectBrowsers().then((browsers: any[]) => {
                setDetectedBrowsers(browsers || []);
            }).catch(() => {});
        }
    }, [activeSection, loadConnectedAccounts, detectedBrowsers.length, agentMemory]);

    const loadAgentTasks = useCallback(async () => {
        setAgentTasksLoading(true);
        try {
            const tasks = await (window.electron as any)?.agentHistory?.getAll(50) || [];
            setAgentTasks(tasks);
        } catch { /* ignore */ } finally {
            setAgentTasksLoading(false);
        }
    }, []);

    // Disconnect an account
    const handleDisconnect = useCallback(async (service: string) => {
        if (!(window.electron as any)?.accounts) return;
        const domain = SERVICE_DOMAINS[service];
        if (!domain) return;
        if (!window.confirm(`Disconnect ${service}? The agent will no longer be able to access ${service} on your behalf.`)) return;
        try {
            await (window.electron as any).accounts.disconnect(domain);
            setConnectedAccounts(prev => prev.filter(a => a.service !== service));
        } catch (error) {
            console.error('Failed to disconnect account:', error);
        }
    }, []);

    // Reset all settings
    const handleReset = useCallback(async () => {
        if (!window.electron?.settings) return;

        if (window.confirm('Are you sure you want to reset all settings to defaults?')) {
            setIsSaving(true);
            try {
                const defaultSettings = await window.electron.settings.reset();
                setSettings(defaultSettings);
            } catch (error) {
                console.error('Failed to reset settings:', error);
            } finally {
                setIsSaving(false);
            }
        }
    }, []);

    // Navigate back
    const handleBack = useCallback(() => {
        window.electron?.navigation.navigate('anthracite://newtab');
    }, []);

    const testKey = useCallback(async (
        apiKey: string,
        provider: 'openai' | 'anthropic' | 'google',
        setStatus: (s: 'success' | 'error' | 'testing' | null) => void,
    ) => {
        setStatus('testing');
        try {
            const response = await fetch('http://127.0.0.1:8000/test-api-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: apiKey, provider }),
            });
            const data = await response.json();
            if (data.valid) {
                setStatus('success');
                setTimeout(() => setStatus(null), 3000);
            } else {
                setStatus('error');
                setTimeout(() => setStatus(null), 5000);
            }
        } catch {
            setStatus('error');
            setTimeout(() => setStatus(null), 5000);
        }
    }, []);

    const testApiKey = useCallback(() =>
        testKey(settings?.openaiApiKey || '', 'openai', setApiKeyTestStatus),
        [settings?.openaiApiKey, testKey]);

    const testAnthropicKey = useCallback(() =>
        testKey(settings?.anthropicApiKey || '', 'anthropic', setAnthropicTestStatus),
        [settings?.anthropicApiKey, testKey]);

    const testGoogleKey = useCallback(() =>
        testKey(settings?.googleApiKey || '', 'google', setGoogleTestStatus),
        [settings?.googleApiKey, testKey]);

    if (!settings) {
        return (
            <div className="flex items-center justify-center h-full w-full bg-[#0A0A0B]">
                <div className="loading-spinner w-8 h-8" />
            </div>
        );
    }

    const sections: { id: SettingsSection; label: string; icon: React.ElementType }[] = [
        { id: 'account', label: 'My Account', icon: User },
        { id: 'subscription', label: 'Plan & Billing', icon: CreditCard },
        { id: 'accounts', label: 'Connected Accounts', icon: UserCircle },
        { id: 'agent-history', label: 'Task History', icon: Robot },
        { id: 'agent-profile', label: 'Agent Profile', icon: Robot },
        { id: 'import', label: 'Import Data', icon: DownloadSimple },
        { id: 'browser', label: 'Browser', icon: Globe },
        { id: 'appearance', label: 'Appearance', icon: Palette },
        { id: 'privacy', label: 'Privacy & Security', icon: Lock },
        { id: 'tabs', label: 'Tabs & Navigation', icon: AppWindow },
        { id: 'developer', label: 'Developer', icon: Code },
    ];

    return (
        <div className={cn(
            "flex h-full w-full bg-[#0A0A0B]",
            className
        )}>
            {/* Sidebar Navigation */}
            <nav className="w-56 border-r border-white/[0.06] bg-[#0D0D0F] p-3 flex flex-col">
                <button
                    onClick={handleBack}
                    className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary mb-5 mt-1 ml-1 transition-colors"
                >
                    <CaretLeft className="h-3.5 w-3.5" />
                    Back
                </button>

                <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest px-2 mb-2">Settings</p>

                <ul className="space-y-0.5 flex-1">
                    {sections.map((section) => (
                        <li key={section.id}>
                            <button
                                onClick={() => setActiveSection(section.id)}
                                className={cn(
                                    "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-all duration-150",
                                    activeSection === section.id
                                        ? "bg-white/[0.08] text-text-primary"
                                        : "text-text-tertiary hover:bg-white/[0.04] hover:text-text-secondary"
                                )}
                            >
                                <section.icon className={cn(
                                    "h-4 w-4 shrink-0 transition-colors",
                                    activeSection === section.id ? "text-text-primary" : "text-text-tertiary"
                                )} />
                                {section.label}
                            </button>
                        </li>
                    ))}
                </ul>

                <button
                    onClick={handleReset}
                    className="flex items-center justify-center gap-2 px-3 py-2 text-xs text-text-tertiary hover:text-error hover:bg-error/5 rounded-lg transition-colors mt-2"
                >
                    <ArrowCounterClockwise className="h-3.5 w-3.5" />
                    Reset All
                </button>
            </nav>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto p-8 bg-[#0A0A0B]">
                <div className="max-w-xl mx-auto">
                    <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                        key={activeSection}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                    {/* My Account Section */}
                    {activeSection === 'account' && (
                        <section>
                            <SectionHeader
                                icon={User}
                                title="My Account"
                                description="Manage your Anthracite account and sign-in options."
                            />

                            {authUser ? (
                                /* ── Signed-in profile ───────────────────────────────── */
                                <div className="space-y-4">
                                    <div className="flex items-center gap-4 p-5 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                                        {authUser.avatarUrl ? (
                                            <img
                                                src={authUser.avatarUrl}
                                                alt="Avatar"
                                                className="h-14 w-14 rounded-full object-cover border border-white/[0.12]"
                                            />
                                        ) : (
                                            <div className="h-14 w-14 rounded-full bg-brand/20 flex items-center justify-center">
                                                <User className="h-7 w-7 text-brand-light" />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            {authUser.name && (
                                                <p className="text-base font-semibold text-text-primary truncate">
                                                    {authUser.name}
                                                </p>
                                            )}
                                            <p className="text-sm text-text-secondary truncate">
                                                {authUser.email ?? 'No email'}
                                            </p>
                                            <div className="mt-1.5 flex items-center gap-1.5">
                                                {authUser.plan === 'pro' ? (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-400">
                                                        <SealCheck className="h-3 w-3" />
                                                        Pro
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/[0.08] text-text-tertiary">
                                                        Free
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <button
                                        onClick={async () => {
                                            await (window.electron as any)?.auth?.signOut();
                                        }}
                                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-error bg-error/5 hover:bg-error/10 border border-error/20 transition-colors"
                                    >
                                        <SignOut className="h-4 w-4" />
                                        Sign out
                                    </button>
                                </div>
                            ) : (
                                /* ── Sign-in form ──────────────────────────────────────── */
                                <div className="space-y-4">
                                    {/* OAuth buttons */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            onClick={() => (window.electron as any)?.auth?.signInWithOAuth('google')}
                                            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-white/[0.04] border border-white/[0.08] text-text-secondary hover:bg-white/[0.08] hover:text-text-primary transition-colors"
                                        >
                                            {/* Google SVG icon */}
                                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                            </svg>
                                            Continue with Google
                                        </button>
                                        <button
                                            onClick={() => (window.electron as any)?.auth?.signInWithOAuth('github')}
                                            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-white/[0.04] border border-white/[0.08] text-text-secondary hover:bg-white/[0.08] hover:text-text-primary transition-colors"
                                        >
                                            <GithubLogo className="h-4 w-4" />
                                            Continue with GitHub
                                        </button>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <div className="flex-1 h-px bg-white/[0.06]" />
                                        <span className="text-xs text-text-tertiary">or</span>
                                        <div className="flex-1 h-px bg-white/[0.06]" />
                                    </div>

                                    {/* Email OTP */}
                                    {!emailSent ? (
                                        <div className="flex gap-2">
                                            <input
                                                type="email"
                                                value={authEmail}
                                                onChange={e => { setAuthEmail(e.target.value); setAuthError(null); }}
                                                placeholder="your@email.com"
                                                className="flex-1 px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand/30"
                                            />
                                            <button
                                                disabled={!authEmail.includes('@') || emailSending}
                                                onClick={async () => {
                                                    setEmailSending(true);
                                                    setAuthError(null);
                                                    const result = await (window.electron as any)?.auth?.signInWithEmail(authEmail);
                                                    setEmailSending(false);
                                                    if (result?.success) {
                                                        setEmailSent(true);
                                                        setOtpCode('');
                                                    } else {
                                                        setAuthError(result?.error ?? 'Failed to send code');
                                                    }
                                                }}
                                                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-brand text-white hover:bg-brand-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                            >
                                                {emailSending ? (
                                                    <CircleNotch className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Envelope className="h-4 w-4" />
                                                )}
                                                <span>Send code</span>
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <div className="flex items-start gap-3 p-4 rounded-xl bg-brand/5 border border-brand/20">
                                                <Check className="h-4 w-4 text-brand-light mt-0.5 shrink-0" />
                                                <div>
                                                    <p className="text-sm font-medium text-text-primary">Check your email</p>
                                                    <p className="text-xs text-text-secondary mt-0.5">
                                                        We sent a code to <span className="text-text-primary">{authEmail}</span>. Enter it below.
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    maxLength={8}
                                                    value={otpCode}
                                                    onChange={e => { setOtpCode(e.target.value.replace(/\D/g, '')); setAuthError(null); }}
                                                    placeholder="12345678"
                                                    className="flex-1 px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand/30 tracking-widest"
                                                />
                                                <button
                                                    disabled={otpCode.length < 6 || otpVerifying}
                                                    onClick={async () => {
                                                        setOtpVerifying(true);
                                                        setAuthError(null);
                                                        const result = await (window.electron as any)?.auth?.verifyOtp(authEmail, otpCode);
                                                        setOtpVerifying(false);
                                                        if (result?.success) {
                                                            setEmailSent(false);
                                                            setAuthEmail('');
                                                            setOtpCode('');
                                                        } else {
                                                            setAuthError(result?.error ?? 'Invalid code');
                                                        }
                                                    }}
                                                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-brand text-white hover:bg-brand-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                                >
                                                    {otpVerifying ? <CircleNotch className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                                    <span>Verify</span>
                                                </button>
                                            </div>
                                            <button
                                                onClick={() => { setEmailSent(false); setAuthEmail(''); setOtpCode(''); setAuthError(null); }}
                                                className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
                                            >
                                                Use a different email
                                            </button>
                                        </div>
                                    )}

                                    {authError && (
                                        <p className="text-xs text-error px-1">{authError}</p>
                                    )}

                                    <p className="text-xs text-text-tertiary px-1">
                                        Sign in to sync your settings and realms across devices.
                                        No account needed. Anthracite works fully offline.
                                    </p>
                                </div>
                            )}
                        </section>
                    )}

                    {/* Connected Accounts Section */}
                    {activeSection === 'accounts' && (
                        <section>
                            <div className="flex items-center justify-between mb-4">
                                <SectionHeader
                                    icon={UserCircle}
                                    title="Connected Accounts"
                                    description="Accounts the agent can use on your behalf. Log into any website in a normal tab and it appears here automatically."
                                />
                                <button
                                    onClick={loadConnectedAccounts}
                                    disabled={accountsLoading}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary bg-white/[0.04] hover:bg-white/[0.08] rounded-lg transition-colors disabled:opacity-50"
                                >
                                    <ArrowsClockwise className={cn("h-3.5 w-3.5", accountsLoading && "animate-spin")} />
                                    Refresh
                                </button>
                            </div>

                            {accountsLoading ? (
                                <div className="flex items-center justify-center py-12 text-text-tertiary">
                                    <ArrowsClockwise className="h-5 w-5 animate-spin mr-2" />
                                    <span className="text-sm">Scanning for logged-in accounts...</span>
                                </div>
                            ) : connectedAccounts.length === 0 ? (
                                <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-8 text-center">
                                    <UserCircle className="h-10 w-10 text-text-tertiary mx-auto mb-3" />
                                    <p className="text-sm font-medium text-text-secondary mb-1">No accounts detected</p>
                                    <p className="text-xs text-text-tertiary max-w-xs mx-auto">
                                        Log into Google, GitHub, Amazon, or any other site in a normal Anthracite tab.
                                        Your session will be available to the AI agent automatically.
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {connectedAccounts.map((account) => (
                                        <div
                                            key={account.service}
                                            className="flex items-center gap-4 p-4 bg-white/[0.03] rounded-xl border border-white/[0.06] hover:border-white/[0.1] transition-colors"
                                        >
                                            {/* Avatar */}
                                            <div className={cn(
                                                "h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                                                SERVICE_COLORS[account.service] || 'bg-white/10 text-white/70'
                                            )}>
                                                {account.service.charAt(0)}
                                            </div>

                                            {/* Info */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium text-text-primary">{account.service}</span>
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/10 text-success font-medium">
                                                        Connected
                                                    </span>
                                                </div>
                                                <p className="text-xs text-text-tertiary mt-0.5 truncate">
                                                    {account.email || 'Session active · Agent can use this account'}
                                                </p>
                                            </div>

                                            {/* Disconnect */}
                                            <button
                                                onClick={() => handleDisconnect(account.service)}
                                                title={`Disconnect ${account.service}`}
                                                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-text-tertiary hover:text-error hover:bg-error/5 rounded-lg transition-colors shrink-0"
                                            >
                                                <SignOut className="h-3.5 w-3.5" />
                                                Disconnect
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Security note */}
                            <div className="mt-6 p-4 bg-white/[0.02] rounded-xl border border-white/[0.06]">
                                <div className="flex items-start gap-3">
                                    <Shield className="h-4 w-4 text-text-tertiary shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-xs font-medium text-text-secondary mb-1">How this works</p>
                                        <p className="text-xs text-text-tertiary leading-relaxed">
                                            Anthracite's AI agent uses the same browser session you do. Your cookies are stored locally
                                            and never sent to any server. The agent can only act on sites where you're already logged in.
                                            Disconnect any account to clear its session cookies immediately.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Browser Section */}
                    {activeSection === 'browser' && (
                        <section>
                            <SectionHeader
                                icon={Globe}
                                title="Browser"
                                description="Core browser settings and defaults"
                            />
                            <div className="bg-white/[0.025] rounded-xl border border-white/[0.05] px-4 py-1">
                                <SettingRow
                                    label="Default Search Engine"
                                    description="Used when searching from the address bar"
                                >
                                    <Select
                                        value={settings.defaultSearchEngine}
                                        options={[
                                            { value: 'google', label: 'Google' },
                                            { value: 'duckduckgo', label: 'DuckDuckGo' },
                                            { value: 'bing', label: 'Bing' },
                                            { value: 'brave', label: 'Brave Search' },
                                        ]}
                                        onChange={(v) => updateSetting('defaultSearchEngine', v)}
                                    />
                                </SettingRow>

                                <SettingRow
                                    label="Ad & Tracker Blocker"
                                    description="Block ads, trackers, and malicious content"
                                >
                                    <Toggle
                                        enabled={settings.adBlockerEnabled}
                                        onChange={(v) => updateSetting('adBlockerEnabled', v)}
                                    />
                                </SettingRow>

                                <SettingRow
                                    label="HTTPS Upgrade"
                                    description="Automatically upgrade connections to HTTPS when available"
                                >
                                    <Toggle
                                        enabled={settings.httpsUpgradeEnabled}
                                        onChange={(v) => updateSetting('httpsUpgradeEnabled', v)}
                                    />
                                </SettingRow>
                            </div>
                        </section>
                    )}

                    {/* Appearance Section */}
                    {activeSection === 'appearance' && (
                        <section>
                            <SectionHeader
                                icon={Palette}
                                title="Appearance"
                                description="Customize how Anthracite looks"
                            />
                            <div className="bg-white/[0.025] rounded-xl border border-white/[0.05] px-4 py-1">
                                <SettingRow
                                    label="Theme"
                                    description="Choose your preferred color scheme"
                                >
                                    <Select
                                        value={settings.theme}
                                        options={[
                                            { value: 'dark', label: 'Dark' },
                                            { value: 'light', label: 'Light (Coming Soon)' },
                                            { value: 'system', label: 'System (Coming Soon)' },
                                        ]}
                                        onChange={(v) => updateSetting('theme', v)}
                                    />
                                </SettingRow>

                                <SettingRow
                                    label="Sidebar Position"
                                    description="Choose which side the sidebar appears on"
                                >
                                    <Select
                                        value={settings.sidebarPosition}
                                        options={[
                                            { value: 'left', label: 'Left' },
                                            { value: 'right', label: 'Right (Coming Soon)' },
                                        ]}
                                        onChange={(v) => updateSetting('sidebarPosition', v)}
                                    />
                                </SettingRow>

                                <SettingRow
                                    label="Compact Mode"
                                    description="Use smaller UI elements to show more content"
                                >
                                    <Toggle
                                        enabled={settings.compactMode}
                                        onChange={(v) => updateSetting('compactMode', v)}
                                    />
                                </SettingRow>

                                <SettingRow
                                    label="UI Scale"
                                    description="Adjust the overall size of the browser interface"
                                >
                                    <div className="flex items-center gap-1.5">
                                        {([
                                            { value: 'extra-small' as const, label: 'XS' },
                                            { value: 'small' as const, label: 'S' },
                                            { value: 'medium' as const, label: 'M' },
                                            { value: 'large' as const, label: 'L' },
                                            { value: 'extra-large' as const, label: 'XL' },
                                        ]).map((scale) => (
                                            <button
                                                key={scale.value}
                                                onClick={() => updateSetting('uiScale', scale.value)}
                                                className={cn(
                                                    "px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150",
                                                    settings.uiScale === scale.value
                                                        ? "bg-brand text-white shadow-sm"
                                                        : "bg-white/[0.06] text-text-secondary hover:bg-white/[0.08] hover:text-text-primary"
                                                )}
                                            >
                                                {scale.label}
                                            </button>
                                        ))}
                                    </div>
                                </SettingRow>
                            </div>

                            {/* Home Background Picker */}
                            <div className="mt-6">
                                <h4 className="text-sm font-medium text-text-primary mb-1">Home Background</h4>
                                <p className="text-xs text-text-tertiary mb-4">Choose the background for your new tab page</p>
                                <div className="grid grid-cols-2 gap-3">
                                    {([
                                        { id: 'earth-horizon' as const, label: 'Earth Horizon', desc: 'Atmospheric glow from space' },
                                        { id: 'gradient-mesh' as const, label: 'Gradient Mesh', desc: 'Subtle color gradients' },
                                        { id: 'aurora' as const, label: 'Aurora', desc: 'Northern lights effect' },
                                        { id: 'minimal' as const, label: 'Minimal', desc: 'Pure dark background' },
                                    ]).map((bg) => (
                                        <button
                                            key={bg.id}
                                            onClick={() => updateSetting('homeBackground', bg.id)}
                                            className={cn(
                                                "relative flex flex-col items-start p-3 rounded-xl border transition-all duration-200 text-left",
                                                settings.homeBackground === bg.id
                                                    ? "border-brand/40 bg-brand/5 ring-1 ring-brand/20"
                                                    : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1]"
                                            )}
                                        >
                                            {/* Preview swatch */}
                                            <div className={cn(
                                                "w-full h-16 rounded-lg mb-2.5 overflow-hidden",
                                                bg.id === 'earth-horizon' && "bg-[#0A0A0B]",
                                                bg.id === 'gradient-mesh' && "bg-[#0A0A0B]",
                                                bg.id === 'aurora' && "bg-[#0A0A0B]",
                                                bg.id === 'minimal' && "bg-[#0A0A0B]",
                                            )}>
                                                {bg.id === 'earth-horizon' && (
                                                    <div className="w-full h-full relative">
                                                        <div className="absolute bottom-0 left-0 right-0 h-3/4" style={{
                                                            background: 'radial-gradient(ellipse 150% 60% at 50% 100%, rgba(135,206,250,0.12) 0%, rgba(70,130,220,0.06) 30%, transparent 60%), radial-gradient(ellipse 200% 100% at 50% 100%, rgba(12,20,40,0.5) 0%, transparent 70%)'
                                                        }} />
                                                    </div>
                                                )}
                                                {bg.id === 'gradient-mesh' && (
                                                    <div className="w-full h-full" style={{
                                                        background: 'radial-gradient(at 20% 20%, rgba(200,169,126,0.15) 0%, transparent 50%), radial-gradient(at 80% 80%, rgba(200,169,126,0.08) 0%, transparent 50%)'
                                                    }} />
                                                )}
                                                {bg.id === 'aurora' && (
                                                    <div className="w-full h-full" style={{
                                                        background: 'radial-gradient(ellipse 80% 50% at 30% 20%, rgba(16,185,129,0.12) 0%, transparent 50%), radial-gradient(ellipse 60% 40% at 70% 30%, rgba(200,169,126,0.08) 0%, transparent 50%)'
                                                    }} />
                                                )}
                                            </div>
                                            <span className="text-sm font-medium text-text-primary">{bg.label}</span>
                                            <span className="text-xs text-text-tertiary mt-0.5">{bg.desc}</span>
                                            {settings.homeBackground === bg.id && (
                                                <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-brand flex items-center justify-center">
                                                    <Check className="h-3 w-3 text-white" />
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Background Intensity Slider */}
                            {settings.homeBackground !== 'minimal' && (
                                <div className="mt-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <div>
                                            <h4 className="text-sm font-medium text-text-primary">Background Intensity</h4>
                                            <p className="text-xs text-text-tertiary mt-0.5">Adjust how prominent the background effect appears</p>
                                        </div>
                                        <span className="text-sm font-medium text-text-secondary tabular-nums">{settings.homeBackgroundIntensity}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        min={0}
                                        max={100}
                                        step={5}
                                        value={settings.homeBackgroundIntensity}
                                        onChange={(e) => updateSetting('homeBackgroundIntensity', parseInt(e.target.value))}
                                        className="w-full h-1.5 bg-white/[0.08] rounded-full appearance-none cursor-pointer accent-brand
                                            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
                                            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brand [&::-webkit-slider-thumb]:shadow-glow
                                            [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform
                                            [&::-webkit-slider-thumb]:hover:scale-110"
                                    />
                                </div>
                            )}
                        </section>
                    )}

                    {/* Privacy Section */}
                    {activeSection === 'privacy' && (
                        <section>
                            <SectionHeader
                                icon={Lock}
                                title="Privacy & Security"
                                description="Control your privacy and data"
                            />
                            <div className="bg-white/[0.025] rounded-xl border border-white/[0.05] px-4 py-1">
                                <SettingRow
                                    label="Save Browsing History"
                                    description="Remember sites you visit for autocomplete and suggestions"
                                >
                                    <Toggle
                                        enabled={settings.historyEnabled}
                                        onChange={(v) => updateSetting('historyEnabled', v)}
                                    />
                                </SettingRow>

                                <SettingRow
                                    label="History Retention"
                                    description="How long to keep browsing history"
                                >
                                    <Select
                                        value={String(settings.historyRetentionDays) as any}
                                        options={[
                                            { value: '7', label: '1 Week' },
                                            { value: '30', label: '1 Month' },
                                            { value: '90', label: '3 Months' },
                                            { value: '365', label: '1 Year' },
                                            { value: '-1', label: 'Forever' },
                                        ]}
                                        onChange={(v) => updateSetting('historyRetentionDays', parseInt(v))}
                                    />
                                </SettingRow>

                                <SettingRow
                                    label="Clear History on Exit"
                                    description="Automatically clear browsing history when closing Anthracite"
                                >
                                    <Toggle
                                        enabled={settings.clearHistoryOnExit}
                                        onChange={(v) => updateSetting('clearHistoryOnExit', v)}
                                    />
                                </SettingRow>

                                <SettingRow
                                    label="Block Third-Party Cookies"
                                    description="Prevent cross-site tracking via cookies"
                                >
                                    <Toggle
                                        enabled={settings.blockThirdPartyCookies}
                                        onChange={(v) => updateSetting('blockThirdPartyCookies', v)}
                                    />
                                </SettingRow>

                                <SettingRow
                                    label="Send Do Not Track"
                                    description="Request websites not to track you (not all sites honor this)"
                                >
                                    <Toggle
                                        enabled={settings.sendDoNotTrack}
                                        onChange={(v) => updateSetting('sendDoNotTrack', v)}
                                    />
                                </SettingRow>

                                <div className="pt-4 border-t border-white/[0.06] mt-4">
                                    <button
                                        onClick={() => {
                                            if (window.confirm('Are you sure you want to clear all browsing history?')) {
                                                window.electron?.history.clear();
                                            }
                                        }}
                                        className="px-4 py-2 text-sm font-medium text-error bg-error/5 hover:bg-error/10 rounded-lg transition-colors"
                                    >
                                        Clear Browsing History
                                    </button>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Tabs Section */}
                    {activeSection === 'tabs' && (
                        <section>
                            <SectionHeader
                                icon={AppWindow}
                                title="Tabs & Navigation"
                                description="Configure tab behavior and navigation"
                            />
                            <div className="bg-white/[0.025] rounded-xl border border-white/[0.05] px-4 py-1">
                                <SettingRow
                                    label="Open Links in New Tab"
                                    description="Open external links in a new tab instead of the current one"
                                >
                                    <Toggle
                                        enabled={settings.openLinksInNewTab}
                                        onChange={(v) => updateSetting('openLinksInNewTab', v)}
                                    />
                                </SettingRow>

                                <SettingRow
                                    label="Confirm Before Closing Multiple Tabs"
                                    description="Show a confirmation dialog when closing multiple tabs at once"
                                >
                                    <Toggle
                                        enabled={settings.confirmBeforeClosingMultipleTabs}
                                        onChange={(v) => updateSetting('confirmBeforeClosingMultipleTabs', v)}
                                    />
                                </SettingRow>

                                <SettingRow
                                    label="Restore Tabs on Startup"
                                    description="Reopen tabs from your last session when starting Anthracite"
                                >
                                    <Toggle
                                        enabled={settings.restoreTabsOnStartup}
                                        onChange={(v) => updateSetting('restoreTabsOnStartup', v)}
                                    />
                                </SettingRow>
                            </div>
                        </section>
                    )}

                    {/* Subscription Section */}
                    {activeSection === 'subscription' && (
                        <section>
                            <SectionHeader
                                icon={CreditCard}
                                title="Plan & Billing"
                                description="Manage your Anthracite subscription and usage."
                            />

                            {/* Free plan (current) */}
                            <div className="relative p-7 rounded-2xl border-2 border-brand/40 bg-brand/5 mb-4">
                                <div className="flex items-start justify-between mb-5">
                                    <div>
                                        <div className="flex items-center gap-2.5 mb-1.5">
                                            <span className="text-xl font-bold text-text-primary">Free</span>
                                            <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-brand/20 text-brand-light font-semibold">Current plan</span>
                                        </div>
                                        <p className="text-sm text-text-tertiary">Everything you need to browse smarter.</p>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-4xl font-bold text-text-primary">$0</span>
                                        <span className="text-sm text-text-tertiary">/mo</span>
                                    </div>
                                </div>
                                <ul className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                                    {[
                                        'Full browser with tabs, history and realms',
                                        'AI agent with your own API key',
                                        'Connected Accounts (ambient session)',
                                        'Native ad blocker',
                                        'Local Ollama models',
                                    ].map(f => (
                                        <li key={f} className="flex items-start gap-2 text-sm text-text-secondary">
                                            <CheckCircle className="h-4 w-4 text-brand shrink-0 mt-0.5" />
                                            {f}
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            {/* Pro plan */}
                            <div className="relative p-7 rounded-2xl border border-white/[0.1] bg-white/[0.03] mb-6 overflow-hidden">
                                {/* Subtle glow */}
                                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent pointer-events-none" />
                                <div className="relative">
                                    <div className="flex items-start justify-between mb-5">
                                        <div>
                                            <div className="flex items-center gap-2.5 mb-1.5">
                                                <span className="text-xl font-bold text-text-primary flex items-center gap-2">
                                                    <Lightning className="h-5 w-5 text-amber-400" />
                                                    Pro
                                                </span>
                                                <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-semibold">Coming soon</span>
                                            </div>
                                            <p className="text-sm text-text-tertiary">No API key needed. We handle the infrastructure.</p>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-4xl font-bold text-text-primary">$20</span>
                                            <span className="text-sm text-text-tertiary">/mo</span>
                                        </div>
                                    </div>
                                    <ul className="grid grid-cols-2 gap-x-6 gap-y-2.5 mb-6">
                                        {[
                                            'Everything in Free',
                                            '200 agent credits per month',
                                            'No API key needed, we proxy calls',
                                            'Claude Sonnet 4.6 by default',
                                            'Priority support',
                                        ].map(f => (
                                            <li key={f} className="flex items-start gap-2 text-sm text-text-secondary">
                                                <CheckCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                                                {f}
                                            </li>
                                        ))}
                                    </ul>
                                    <button
                                        onClick={() => window.electron?.openExternal('https://anthracitebrowser.com')}
                                        className="w-full py-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 text-sm font-semibold transition-colors"
                                    >
                                        Join the waitlist →
                                    </button>
                                </div>
                            </div>

                            {/* BYOK info */}
                            <div className="p-5 rounded-2xl border border-white/[0.06] bg-white/[0.03]">
                                <div className="flex items-center gap-2 mb-2">
                                    <Shield className="h-4 w-4 text-text-tertiary shrink-0" />
                                    <h4 className="text-sm font-medium text-text-primary">Bring your own API key</h4>
                                </div>
                                <p className="text-sm text-text-tertiary mb-3">
                                    On the Free plan, add your Anthropic, OpenAI, or Google AI key in{' '}
                                    <button
                                        type="button"
                                        className="text-brand-light hover:text-brand transition-colors"
                                        onClick={() => setActiveSection('developer')}
                                    >
                                        Developer settings
                                    </button>
                                    . The agent uses it directly. Your key, your usage, your cost.
                                </p>
                                <p className="text-xs text-text-tertiary/70">
                                    Keys are stored locally and never transmitted to Anthracite servers.
                                </p>
                            </div>
                        </section>
                    )}

                    {/* Developer Section */}
                    {activeSection === 'developer' && (
                        <section>
                            <SectionHeader
                                icon={Code}
                                title="Developer"
                                description="Advanced settings for developers"
                            />
                            <div className="bg-white/[0.025] rounded-xl border border-white/[0.05] px-4 py-1">
                                <SettingRow
                                    label="Enable DevTools"
                                    description="Allow opening Chrome DevTools for web pages (F12 or Cmd+Option+I)"
                                >
                                    <Toggle
                                        enabled={settings.enableDevTools}
                                        onChange={(v) => updateSetting('enableDevTools', v)}
                                    />
                                </SettingRow>
                            </div>

                            {/* API Configuration */}
                            <div className="mt-6">
                                <h4 className="text-sm font-medium text-text-primary mb-1 flex items-center gap-2">
                                    <Shield className="h-4 w-4" />
                                    AI Model API Keys
                                </h4>
                                <p className="text-xs text-text-tertiary mb-4">
                                    Keys are stored locally and never transmitted externally. At least one key is required to use the AI agent.
                                </p>
                                <div className="space-y-3">
                                    {/* Anthropic (Recommended) */}
                                    {(() => {
                                        const isActive = !!settings.anthropicApiKey;
                                        return (
                                            <div className={cn("p-4 rounded-xl border", isActive ? "border-brand/30 bg-brand/5" : "border-white/[0.06] bg-white/[0.03]")}>
                                                <div className="flex items-center justify-between mb-3">
                                                    <div>
                                                        <span className="text-sm font-medium text-text-primary">Anthropic</span>
                                                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-brand/15 text-brand-light">Recommended</span>
                                                    </div>
                                                    {isActive && <span className="text-xs text-success flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-success inline-block" />Active</span>}
                                                </div>
                                                <p className="text-xs text-text-tertiary mb-3">Powers Claude Sonnet 4.6, Opus 4.6, Haiku 4.5. <button type="button" className="text-brand-light hover:text-brand transition-colors" onClick={() => window.open('https://console.anthropic.com/settings/keys')}>Get key →</button></p>
                                                <div className="relative mb-2">
                                                    <input
                                                        type={showAnthropicKey ? 'text' : 'password'}
                                                        value={settings.anthropicApiKey || ''}
                                                        onChange={(e) => updateSetting('anthropicApiKey', e.target.value)}
                                                        placeholder="sk-ant-..."
                                                        className="w-full px-3 py-2 pr-20 rounded-lg border border-white/[0.08] bg-white/[0.05] text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-brand/30 focus:border-brand/40 font-mono"
                                                    />
                                                    <button onClick={() => setShowAnthropicKey(!showAnthropicKey)} className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors">
                                                        {showAnthropicKey ? 'Hide' : 'Show'}
                                                    </button>
                                                </div>
                                                {anthropicTestStatus && (
                                                    <div className={cn("flex items-center gap-2 px-3 py-2 rounded-lg text-xs mb-2", anthropicTestStatus === 'success' && "bg-success/10 text-success", anthropicTestStatus === 'error' && "bg-error/10 text-error", anthropicTestStatus === 'testing' && "bg-brand/10 text-brand-light")}>
                                                        {anthropicTestStatus === 'testing' && <div className="loading-spinner w-3 h-3" />}
                                                        {anthropicTestStatus === 'success' && '✓ Key is valid'}
                                                        {anthropicTestStatus === 'error' && '✗ Invalid key or network error'}
                                                        {anthropicTestStatus === 'testing' && 'Testing...'}
                                                    </div>
                                                )}
                                                <button onClick={testAnthropicKey} disabled={!settings.anthropicApiKey || anthropicTestStatus === 'testing'} className="px-3 py-1.5 text-xs font-medium text-brand-light bg-brand/10 hover:bg-brand/15 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                                    Test Connection
                                                </button>
                                            </div>
                                        );
                                    })()}

                                    {/* OpenAI */}
                                    {(() => {
                                        const isActive = !!settings.openaiApiKey;
                                        return (
                                            <div className={cn("p-4 rounded-xl border", isActive ? "border-white/[0.12] bg-white/[0.04]" : "border-white/[0.06] bg-white/[0.03]")}>
                                                <div className="flex items-center justify-between mb-3">
                                                    <span className="text-sm font-medium text-text-primary">OpenAI</span>
                                                    {isActive && <span className="text-xs text-success flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-success inline-block" />Active</span>}
                                                </div>
                                                <p className="text-xs text-text-tertiary mb-3">Powers GPT-4o and GPT-4o mini. <button type="button" className="text-brand-light hover:text-brand transition-colors" onClick={() => window.open('https://platform.openai.com/api-keys')}>Get key →</button></p>
                                                <div className="relative mb-2">
                                                    <input
                                                        type={showApiKey ? 'text' : 'password'}
                                                        value={settings.openaiApiKey || ''}
                                                        onChange={(e) => updateSetting('openaiApiKey', e.target.value)}
                                                        placeholder="sk-..."
                                                        className="w-full px-3 py-2 pr-20 rounded-lg border border-white/[0.08] bg-white/[0.05] text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-brand/30 focus:border-brand/40 font-mono"
                                                    />
                                                    <button onClick={() => setShowApiKey(!showApiKey)} className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors">
                                                        {showApiKey ? 'Hide' : 'Show'}
                                                    </button>
                                                </div>
                                                {apiKeyTestStatus && (
                                                    <div className={cn("flex items-center gap-2 px-3 py-2 rounded-lg text-xs mb-2", apiKeyTestStatus === 'success' && "bg-success/10 text-success", apiKeyTestStatus === 'error' && "bg-error/10 text-error", apiKeyTestStatus === 'testing' && "bg-brand/10 text-brand-light")}>
                                                        {apiKeyTestStatus === 'testing' && <div className="loading-spinner w-3 h-3" />}
                                                        {apiKeyTestStatus === 'success' && '✓ Key is valid'}
                                                        {apiKeyTestStatus === 'error' && '✗ Invalid key or network error'}
                                                        {apiKeyTestStatus === 'testing' && 'Testing...'}
                                                    </div>
                                                )}
                                                <button onClick={testApiKey} disabled={!settings.openaiApiKey || apiKeyTestStatus === 'testing'} className="px-3 py-1.5 text-xs font-medium text-brand-light bg-brand/10 hover:bg-brand/15 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                                    Test Connection
                                                </button>
                                            </div>
                                        );
                                    })()}

                                    {/* Google */}
                                    {(() => {
                                        const isActive = !!settings.googleApiKey;
                                        return (
                                            <div className={cn("p-4 rounded-xl border", isActive ? "border-white/[0.12] bg-white/[0.04]" : "border-white/[0.06] bg-white/[0.03]")}>
                                                <div className="flex items-center justify-between mb-3">
                                                    <span className="text-sm font-medium text-text-primary">Google AI</span>
                                                    {isActive && <span className="text-xs text-success flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-success inline-block" />Active</span>}
                                                </div>
                                                <p className="text-xs text-text-tertiary mb-3">Powers Gemini 2.0 Flash and Gemini 1.5 Pro. <button type="button" className="text-brand-light hover:text-brand transition-colors" onClick={() => window.open('https://aistudio.google.com/app/apikey')}>Get key →</button></p>
                                                <div className="relative mb-2">
                                                    <input
                                                        type={showGoogleKey ? 'text' : 'password'}
                                                        value={settings.googleApiKey || ''}
                                                        onChange={(e) => updateSetting('googleApiKey', e.target.value)}
                                                        placeholder="AIza..."
                                                        className="w-full px-3 py-2 pr-20 rounded-lg border border-white/[0.08] bg-white/[0.05] text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-brand/30 focus:border-brand/40 font-mono"
                                                    />
                                                    <button onClick={() => setShowGoogleKey(!showGoogleKey)} className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors">
                                                        {showGoogleKey ? 'Hide' : 'Show'}
                                                    </button>
                                                </div>
                                                {googleTestStatus && (
                                                    <div className={cn("flex items-center gap-2 px-3 py-2 rounded-lg text-xs mb-2", googleTestStatus === 'success' && "bg-success/10 text-success", googleTestStatus === 'error' && "bg-error/10 text-error", googleTestStatus === 'testing' && "bg-brand/10 text-brand-light")}>
                                                        {googleTestStatus === 'testing' && <div className="loading-spinner w-3 h-3" />}
                                                        {googleTestStatus === 'success' && '✓ Key is valid'}
                                                        {googleTestStatus === 'error' && '✗ Invalid key or network error'}
                                                        {googleTestStatus === 'testing' && 'Testing...'}
                                                    </div>
                                                )}
                                                <button onClick={testGoogleKey} disabled={!settings.googleApiKey || googleTestStatus === 'testing'} className="px-3 py-1.5 text-xs font-medium text-brand-light bg-brand/10 hover:bg-brand/15 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                                    Test Connection
                                                </button>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>

                            <div className="mt-6 p-4 bg-white/[0.03] rounded-xl border border-white/[0.06]">
                                <h4 className="text-sm font-medium text-text-primary mb-2">About Anthracite</h4>
                                <div className="space-y-1 text-xs text-text-tertiary">
                                    <p>Version: {appVersion}</p>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Import Data Section */}
                    {activeSection === 'import' && (
                        <section>
                            <SectionHeader
                                icon={DownloadSimple}
                                title="Import Data"
                                description="Bring your browsing history from Chrome, Brave, Edge, Firefox, or Safari."
                            />

                            {detectedBrowsers.length === 0 ? (
                                <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-8 text-center">
                                    <DownloadSimple className="h-10 w-10 text-text-tertiary mx-auto mb-3" />
                                    <p className="text-sm font-medium text-text-secondary mb-1">No supported browsers detected</p>
                                    <p className="text-xs text-text-tertiary max-w-xs mx-auto">
                                        Chrome, Brave, Edge, Firefox, and Safari are supported. Make sure at least one is installed.
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {detectedBrowsers.map((profile: any) => {
                                        const key = `${profile.browser}-${profile.profileName}`;
                                        const isImporting = importingId === key;
                                        const result = importResults[key];

                                        return (
                                            <div
                                                key={key}
                                                className="flex items-center gap-4 p-4 bg-white/[0.03] rounded-xl border border-white/[0.06] hover:border-white/[0.1] transition-colors"
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium text-text-primary">{profile.browser}</span>
                                                        {profile.profileName !== 'Default' && (
                                                            <span className="text-[10px] text-text-tertiary bg-white/[0.06] px-1.5 py-0.5 rounded-full">{profile.profileName}</span>
                                                        )}
                                                    </div>
                                                    {result ? (
                                                        <p className="text-xs text-success mt-0.5 flex items-center gap-1">
                                                            <CheckCircle className="h-3 w-3" weight="fill" />
                                                            {result.imported.toLocaleString()} entries imported
                                                            {result.errors.length > 0 && <span className="text-error"> · {result.errors.length} error(s)</span>}
                                                        </p>
                                                    ) : (
                                                        <p className="text-xs text-text-tertiary mt-0.5">Browsing history</p>
                                                    )}
                                                </div>
                                                <button
                                                    disabled={isImporting || !!result}
                                                    onClick={async () => {
                                                        setImportingId(key);
                                                        try {
                                                            const res = await (window.electron as any)?.importer?.importHistory(profile);
                                                            setImportResults(prev => ({ ...prev, [key]: res }));
                                                        } catch {
                                                            setImportResults(prev => ({ ...prev, [key]: { imported: 0, errors: ['Import failed'] } }));
                                                        } finally {
                                                            setImportingId(null);
                                                        }
                                                    }}
                                                    className={cn(
                                                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                                                        result
                                                            ? 'text-success bg-success/10 cursor-default'
                                                            : isImporting
                                                                ? 'text-text-tertiary bg-white/[0.04] cursor-wait'
                                                                : 'text-text-primary bg-brand/10 hover:bg-brand/20 text-brand'
                                                    )}
                                                >
                                                    {isImporting ? (
                                                        <><ArrowsClockwise className="h-3.5 w-3.5 animate-spin" /> Importing...</>
                                                    ) : result ? (
                                                        <><CheckCircle className="h-3.5 w-3.5" weight="fill" /> Done</>
                                                    ) : (
                                                        <><DownloadSimple className="h-3.5 w-3.5" /> Import</>
                                                    )}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            <div className="mt-6 p-4 bg-white/[0.02] rounded-xl border border-white/[0.06]">
                                <div className="flex items-start gap-3">
                                    <Shield className="h-4 w-4 text-text-tertiary shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-xs font-medium text-text-secondary mb-1">Privacy note</p>
                                        <p className="text-xs text-text-tertiary leading-relaxed">
                                            History is read directly from your local disk and imported into Anthracite's local database.
                                            No data is sent externally. Passwords and cookies are never accessed.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Agent Task History Section */}
                    {activeSection === 'agent-history' && (
                        <section>
                            <div className="flex items-center justify-between mb-4">
                                <SectionHeader
                                    icon={Robot}
                                    title="Task History"
                                    description="Past AI agent runs — click to see step-by-step what the agent did."
                                />
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={loadAgentTasks}
                                        disabled={agentTasksLoading}
                                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary bg-white/[0.04] hover:bg-white/[0.08] rounded-lg transition-colors disabled:opacity-50"
                                    >
                                        <ArrowsClockwise className={cn("h-3.5 w-3.5", agentTasksLoading && "animate-spin")} />
                                        Refresh
                                    </button>
                                    {agentTasks.length > 0 && (
                                        <button
                                            onClick={async () => {
                                                if (!window.confirm('Clear all task history?')) return;
                                                await (window.electron as any)?.agentHistory?.clear();
                                                setAgentTasks([]);
                                            }}
                                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-error hover:bg-error/5 rounded-lg transition-colors"
                                        >
                                            <Trash className="h-3.5 w-3.5" />
                                            Clear All
                                        </button>
                                    )}
                                </div>
                            </div>

                            {agentTasksLoading ? (
                                <div className="flex items-center justify-center py-12 text-text-tertiary">
                                    <ArrowsClockwise className="h-5 w-5 animate-spin mr-2" />
                                    <span className="text-sm">Loading history...</span>
                                </div>
                            ) : agentTasks.length === 0 ? (
                                <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-8 text-center">
                                    <ClockCounterClockwise className="h-10 w-10 text-text-tertiary mx-auto mb-3" />
                                    <p className="text-sm font-medium text-text-secondary mb-1">No task history yet</p>
                                    <p className="text-xs text-text-tertiary max-w-xs mx-auto">
                                        AI agent runs will appear here once you start using the agent.
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {agentTasks.map((task: any) => {
                                        const steps = (() => { try { return JSON.parse(task.steps || '[]'); } catch { return []; } })();
                                        const isExpanded = expandedTaskId === task.id;
                                        const statusColor = task.status === 'done' ? 'text-success bg-success/10' : task.status === 'error' ? 'text-error bg-error/10' : 'text-text-tertiary bg-white/[0.06]';
                                        const durationSec = (task.durationMs / 1000).toFixed(1);
                                        const date = new Date(task.completedAt).toLocaleString();

                                        return (
                                            <div
                                                key={task.id}
                                                className="bg-white/[0.03] rounded-xl border border-white/[0.06] hover:border-white/[0.1] transition-colors overflow-hidden"
                                            >
                                                {/* Row */}
                                                <button
                                                    onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                                                    className="flex items-center gap-3 w-full px-4 py-3 text-left"
                                                >
                                                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-brand/10 shrink-0">
                                                        <Robot className="h-4 w-4 text-brand" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[13px] font-medium text-text-primary truncate">{task.instruction}</p>
                                                        <p className="text-[11px] text-text-tertiary mt-0.5">{date} · {task.stepCount} step{task.stepCount !== 1 ? 's' : ''} · {durationSec}s</p>
                                                    </div>
                                                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0', statusColor)}>
                                                        {task.status}
                                                    </span>
                                                    {isExpanded ? (
                                                        <CaretDown className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
                                                    ) : (
                                                        <CaretRight className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
                                                    )}
                                                </button>

                                                {/* Expanded: steps + result */}
                                                {isExpanded && (
                                                    <div className="px-4 pb-3 border-t border-white/[0.05] pt-3 space-y-1.5">
                                                        {steps.map((s: any) => (
                                                            <div key={s.step} className="flex items-start gap-2.5">
                                                                <span className="h-4 w-4 rounded bg-white/[0.06] text-[9px] font-bold text-text-tertiary flex items-center justify-center shrink-0 mt-0.5">
                                                                    {s.step}
                                                                </span>
                                                                <div className="min-w-0">
                                                                    <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">{s.action} </span>
                                                                    <span className="text-[12px] text-text-secondary">{s.goal}</span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                        {task.result && (
                                                            <div className="mt-2 pt-2 border-t border-white/[0.05]">
                                                                <p className="text-[12px] text-text-secondary italic">{task.result}</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    )}

                    {/* Agent Profile Section */}
                    {activeSection === 'agent-profile' && (
                        <section>
                            <SectionHeader
                                icon={Robot}
                                title="Agent Profile"
                                description="Context the AI agent uses to personalise its actions. Stored locally — never shared."
                            />

                            {!agentMemory ? (
                                <div className="flex items-center gap-2 text-text-muted text-xs py-8 justify-center">
                                    <Spinner className="h-4 w-4 animate-spin" />
                                    Loading profile…
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {/* Name */}
                                    <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.06]">
                                        <div className="flex flex-col gap-1.5">
                                            <label className="text-xs font-medium text-text-secondary">Your name</label>
                                            <input
                                                type="text"
                                                value={agentMemory.userName}
                                                onChange={e => setAgentMemory(m => m ? { ...m, userName: e.target.value } : m)}
                                                placeholder="e.g. Alex"
                                                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-brand/50 transition-colors"
                                            />
                                            <p className="text-[11px] text-text-muted">The agent will address you by this name.</p>
                                        </div>
                                    </div>

                                    {/* Preferred services */}
                                    <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.06]">
                                        <p className="text-xs font-medium text-text-secondary mb-3">Preferred services</p>
                                        <div className="space-y-2">
                                            {Object.entries(agentMemory.preferredServices).map(([category, url]) => (
                                                <div key={category} className="flex items-center gap-2">
                                                    <span className="text-xs text-text-muted w-20 capitalize shrink-0">{category}</span>
                                                    <input
                                                        type="text"
                                                        value={url}
                                                        onChange={e => setAgentMemory(m => m ? {
                                                            ...m,
                                                            preferredServices: { ...m.preferredServices, [category]: e.target.value }
                                                        } : m)}
                                                        placeholder={`e.g. gmail.com`}
                                                        className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-brand/50 transition-colors"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Custom notes */}
                                    <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.06]">
                                        <div className="flex flex-col gap-1.5">
                                            <label className="text-xs font-medium text-text-secondary">Custom notes</label>
                                            <textarea
                                                value={agentMemory.customNotes}
                                                onChange={e => setAgentMemory(m => m ? { ...m, customNotes: e.target.value } : m)}
                                                rows={4}
                                                placeholder="e.g. I'm based in Sydney, Australia. I prefer vegetarian options. My default airport is SYD."
                                                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-brand/50 transition-colors resize-none"
                                            />
                                            <p className="text-[11px] text-text-muted">Free-form context injected into every agent run. Mention your location, preferences, timezone, etc.</p>
                                        </div>
                                    </div>

                                    {/* Top domains (read-only) */}
                                    {agentMemory.topDomains.length > 0 && (
                                        <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.06]">
                                            <p className="text-xs font-medium text-text-secondary mb-2">Frequently visited sites</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {agentMemory.topDomains.map(d => (
                                                    <span key={d} className="px-2 py-0.5 rounded-md text-[11px] bg-white/[0.04] border border-white/[0.08] text-text-secondary">{d}</span>
                                                ))}
                                            </div>
                                            <p className="text-[11px] text-text-muted mt-2">Auto-detected from your browsing history.</p>
                                        </div>
                                    )}

                                    {/* Save button */}
                                    <div className="flex items-center gap-3 pt-1">
                                        <button
                                            onClick={async () => {
                                                setAgentMemorySaving(true);
                                                setAgentMemorySaved(false);
                                                try {
                                                    await (window.electron as any)?.agentMemory?.save(agentMemory);
                                                    setAgentMemorySaved(true);
                                                    setTimeout(() => setAgentMemorySaved(false), 2000);
                                                } catch { /* ignore */ } finally {
                                                    setAgentMemorySaving(false);
                                                }
                                            }}
                                            disabled={agentMemorySaving}
                                            className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand text-black hover:bg-brand/90 transition-colors disabled:opacity-50"
                                        >
                                            {agentMemorySaving ? 'Saving…' : 'Save Profile'}
                                        </button>
                                        {agentMemorySaved && (
                                            <span className="text-xs text-success flex items-center gap-1">
                                                <CheckCircle className="h-3.5 w-3.5" weight="fill" />
                                                Saved
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </section>
                    )}

                    </motion.div>
                    </AnimatePresence>

                    {/* Saving indicator */}
                    {isSaving && (
                        <div className="fixed bottom-4 right-4 flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg shadow-lg">
                            <div className="loading-spinner w-4 h-4 border-white" />
                            <span className="text-sm">Saving...</span>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
