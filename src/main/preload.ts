import { contextBridge, ipcRenderer } from 'electron'

// ============================================
// Types
// ============================================

interface TabInfo {
    id: string
    title: string
    url: string
    favicon: string
    isLoading: boolean
}

interface ActiveTabInfo extends TabInfo {
    canGoBack: boolean
    canGoForward: boolean
}

// ============================================
// API Exposure
// ============================================

contextBridge.exposeInMainWorld('electron', {
    // Generic IPC
    log: (message: string) => ipcRenderer.send('renderer-log', message),
    // ipcRenderer: { ... }


    // Agent
    agent: {
        startOnCurrentTab: (tabId: string, webContentsId: number) => ipcRenderer.invoke('start-agent-on-tab', tabId, webContentsId),
        endAgentTask: (tabId: string) => ipcRenderer.invoke('end-agent-task', tabId),
        updateTab: (tabId: string, url: string, title?: string) => ipcRenderer.invoke('agent-update-tab', tabId, url, title),
    },

    // Tab Management
    tabs: {
        create: (url?: string, options?: { realmId?: string; dockId?: string }) => ipcRenderer.invoke('create-tab', url, options),
        close: (tabId: string) => ipcRenderer.invoke('close-tab', tabId),
        switch: (tabId: string) => ipcRenderer.invoke('switch-tab', tabId),
        getAll: () => ipcRenderer.invoke('get-tabs'),
        getActive: () => ipcRenderer.invoke('get-active-tab'),
        update: (tabId: string, data: Partial<TabInfo>) => ipcRenderer.invoke('update-tab-state', tabId, data),

        // Event listeners
        onTabsUpdated: (callback: (tabs: TabInfo[]) => void) => {
            const subscription = (_event: any, tabs: TabInfo[]) => callback(tabs)
            ipcRenderer.on('tabs-updated', subscription)
            return () => ipcRenderer.removeListener('tabs-updated', subscription)
        },
        onTabUpdated: (callback: (tab: TabInfo) => void) => {
            const subscription = (_event: any, tab: TabInfo) => callback(tab)
            ipcRenderer.on('tab-updated', subscription)
            return () => ipcRenderer.removeListener('tab-updated', subscription)
        },
        onActiveTabChanged: (callback: (tab: ActiveTabInfo | null) => void) => {
            const subscription = (_event: any, tab: ActiveTabInfo | null) => callback(tab)
            ipcRenderer.on('active-tab-changed', subscription)
            return () => ipcRenderer.removeListener('active-tab-changed', subscription)
        },
    },

    // Navigation
    navigation: {
        navigate: (url: string) => ipcRenderer.invoke('navigate', url),
        goBack: () => ipcRenderer.invoke('go-back'),
        goForward: () => ipcRenderer.invoke('go-forward'),
        reload: () => ipcRenderer.invoke('reload'),
        stop: () => ipcRenderer.invoke('stop'),
        onReloadActiveTab: (callback: () => void) => {
            const subscription = () => callback()
            ipcRenderer.on('reload-active-tab', subscription)
            return () => ipcRenderer.removeListener('reload-active-tab', subscription)
        },
        onNavigateToUrl: (callback: (data: { tabId: string; url: string }) => void) => {
            const subscription = (_event: any, data: { tabId: string; url: string }) => callback(data)
            ipcRenderer.on('navigate-to-url', subscription)
            return () => ipcRenderer.removeListener('navigate-to-url', subscription)
        },
        onSwipe: (callback: (direction: string) => void) => {
            const subscription = (_event: any, direction: string) => callback(direction)
            ipcRenderer.on('swipe-navigate', subscription)
            return () => ipcRenderer.removeListener('swipe-navigate', subscription)
        },
        onScrollTouchBegin: (callback: () => void) => {
            const subscription = () => callback()
            ipcRenderer.on('scroll-touch-begin', subscription)
            return () => ipcRenderer.removeListener('scroll-touch-begin', subscription)
        },
        onScrollTouchEnd: (callback: () => void) => {
            const subscription = () => callback()
            ipcRenderer.on('scroll-touch-end', subscription)
            return () => ipcRenderer.removeListener('scroll-touch-end', subscription)
        },
    },

    // Ad Blocker
    adBlock: {
        toggle: (enabled: boolean) => ipcRenderer.invoke('toggle-ad-block', enabled),
        getStatus: () => ipcRenderer.invoke('get-ad-block-status'),
        resetCount: () => ipcRenderer.invoke('reset-blocked-count'),
        onBlocked: (callback: (data: { count: number; url?: string }) => void) => {
            const subscription = (_event: any, data: any) => callback(data)
            ipcRenderer.on('ad-blocked', subscription)
            return () => ipcRenderer.removeListener('ad-blocked', subscription)
        },
        onHttpsUpgrade: (callback: (data: { count: number }) => void) => {
            const subscription = (_event: any, data: any) => callback(data)
            ipcRenderer.on('https-upgraded', subscription)
            return () => ipcRenderer.removeListener('https-upgraded', subscription)
        },
        onStatusChange: (callback: (data: { enabled: boolean; blockedCount: number; httpsUpgradeCount: number }) => void) => {
            const subscription = (_event: any, data: any) => callback(data)
            ipcRenderer.on('ad-block-status', subscription)
            return () => ipcRenderer.removeListener('ad-block-status', subscription)
        },
        getPreloadPath: () => ipcRenderer.invoke('get-adblock-preload-path'),
    },

    // Webview preload
    getWebviewPreloadPath: () => ipcRenderer.invoke('get-webview-preload-path'),

    // Settings
    settings: {
        getAll: () => ipcRenderer.invoke('get-settings'),
        get: (key: string) => ipcRenderer.invoke('get-setting', key),
        set: (key: string, value: any) => ipcRenderer.invoke('set-setting', key, value),
        update: (updates: Record<string, any>) => ipcRenderer.invoke('update-settings', updates),
        reset: () => ipcRenderer.invoke('reset-settings'),
        onChanged: (callback: (data: { key?: string; value?: any; settings: any }) => void) => {
            const subscription = (_event: any, data: any) => callback(data)
            ipcRenderer.on('settings-changed', subscription)
            return () => ipcRenderer.removeListener('settings-changed', subscription)
        },
    },

    // Sidebar
    sidebar: {
        setOpen: (isOpen: boolean) => ipcRenderer.invoke('sidebar-set-open', isOpen),
    },

    // History
    history: {
        search: (query: string, limit?: number) => ipcRenderer.invoke('history-search', query, limit),
        topSites: (limit?: number) => ipcRenderer.invoke('history-top-sites', limit),
        recent: (limit?: number) => ipcRenderer.invoke('history-recent', limit),
        clear: () => ipcRenderer.invoke('history-clear'),
    },

    // Search suggestions (Google API via main process to avoid CORS)
    searchSuggestions: (query: string) => ipcRenderer.invoke('search-suggestions', query),

    // Realm Management
    realms: {
        getAll: () => ipcRenderer.invoke('get-realms'),
        get: (realmId: string) => ipcRenderer.invoke('get-realm', realmId),
        getActiveId: () => ipcRenderer.invoke('get-active-realm-id'),
        setActive: (realmId: string) => ipcRenderer.invoke('set-active-realm', realmId),
        create: (name: string, icon?: string, color?: string, template?: any) => ipcRenderer.invoke('create-realm', name, icon, color, template),
        update: (realmId: string, updates: { name?: string; icon?: string; color?: string }) => ipcRenderer.invoke('update-realm', realmId, updates),
        delete: (realmId: string) => ipcRenderer.invoke('delete-realm', realmId),
        reorder: (realmIds: string[]) => ipcRenderer.invoke('reorder-realms', realmIds),

        // Event listeners
        onCreated: (callback: (realm: any) => void) => {
            const subscription = (_event: any, realm: any) => callback(realm)
            ipcRenderer.on('realm-created', subscription)
            return () => ipcRenderer.removeListener('realm-created', subscription)
        },
        onUpdated: (callback: (realm: any) => void) => {
            const subscription = (_event: any, realm: any) => callback(realm)
            ipcRenderer.on('realm-updated', subscription)
            return () => ipcRenderer.removeListener('realm-updated', subscription)
        },
        onDeleted: (callback: (data: { realmId: string }) => void) => {
            const subscription = (_event: any, data: any) => callback(data)
            ipcRenderer.on('realm-deleted', subscription)
            return () => ipcRenderer.removeListener('realm-deleted', subscription)
        },
        onActiveChanged: (callback: (data: { realmId: string }) => void) => {
            const subscription = (_event: any, data: any) => callback(data)
            ipcRenderer.on('active-realm-changed', subscription)
            return () => ipcRenderer.removeListener('active-realm-changed', subscription)
        },
    },

    // Dock Management
    docks: {
        getAll: (realmId?: string) => ipcRenderer.invoke('get-docks', realmId),
        get: (dockId: string) => ipcRenderer.invoke('get-dock', dockId),
        create: (name: string, realmId: string, icon?: string, color?: string) => ipcRenderer.invoke('create-dock', name, realmId, icon, color),
        update: (dockId: string, updates: { name?: string; icon?: string; color?: string; isCollapsed?: boolean }) => ipcRenderer.invoke('update-dock', dockId, updates),
        toggleCollapse: (dockId: string) => ipcRenderer.invoke('toggle-dock-collapse', dockId),
        delete: (dockId: string) => ipcRenderer.invoke('delete-dock', dockId),
        reorder: (realmId: string, dockIds: string[]) => ipcRenderer.invoke('reorder-docks', realmId, dockIds),
        moveToRealm: (dockId: string, newRealmId: string) => ipcRenderer.invoke('move-dock-to-realm', dockId, newRealmId),

        // Event listeners
        onCreated: (callback: (dock: any) => void) => {
            const subscription = (_event: any, dock: any) => callback(dock)
            ipcRenderer.on('dock-created', subscription)
            return () => ipcRenderer.removeListener('dock-created', subscription)
        },
        onUpdated: (callback: (dock: any) => void) => {
            const subscription = (_event: any, dock: any) => callback(dock)
            ipcRenderer.on('dock-updated', subscription)
            return () => ipcRenderer.removeListener('dock-updated', subscription)
        },
        onDeleted: (callback: (data: { dockId: string }) => void) => {
            const subscription = (_event: any, data: any) => callback(data)
            ipcRenderer.on('dock-deleted', subscription)
            return () => ipcRenderer.removeListener('dock-deleted', subscription)
        },
        onReordered: (callback: (data: { realmId: string; dockIds: string[] }) => void) => {
            const subscription = (_event: any, data: any) => callback(data)
            ipcRenderer.on('docks-reordered', subscription)
            return () => ipcRenderer.removeListener('docks-reordered', subscription)
        },
    },

    // Tab Organization
    tabOrganization: {
        get: (tabId: string) => ipcRenderer.invoke('get-tab-organization', tabId),
        getAll: () => ipcRenderer.invoke('get-all-tab-organizations'),
        moveToDock: (tabId: string, dockId: string) => ipcRenderer.invoke('move-tab-to-dock', tabId, dockId),
        moveToLoose: (tabId: string, realmId?: string) => ipcRenderer.invoke('move-tab-to-loose', tabId, realmId),
        moveToRealm: (tabId: string, realmId: string) => ipcRenderer.invoke('move-tab-to-realm', tabId, realmId),
        pin: (tabId: string) => ipcRenderer.invoke('pin-tab', tabId),
        unpin: (tabId: string) => ipcRenderer.invoke('unpin-tab', tabId),
        reorderInDock: (dockId: string, tabIds: string[]) => ipcRenderer.invoke('reorder-tabs-in-dock', dockId, tabIds),
        reorderLoose: (realmId: string, tabIds: string[]) => ipcRenderer.invoke('reorder-loose-tabs', realmId, tabIds),

        // Event listener
        onChanged: (callback: (data: { tabId: string; realmId: string; dockId: string | null; order: number; isPinned: boolean }) => void) => {
            const subscription = (_event: any, data: any) => callback(data)
            ipcRenderer.on('tab-organization-changed', subscription)
            return () => ipcRenderer.removeListener('tab-organization-changed', subscription)
        },
    },

    // Sidebar State (full snapshot)
    sidebarState: {
        get: () => ipcRenderer.invoke('get-sidebar-state'),
    },

    // App Info
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
})

// ============================================
// Type Definitions for Renderer
// ============================================

// Import shared types for type definitions
import type { Realm, Dock, ThemeColor, IconName, SidebarSnapshot } from '../shared/types'

// Extended Tab info with organization
interface OrganizedTabInfo extends TabInfo {
    realmId: string
    dockId: string | null
    order: number
    isPinned: boolean
}

interface TabOrganization {
    realmId: string
    dockId: string | null
    order: number
    isPinned: boolean
}

interface AppSettings {
    adBlockerEnabled: boolean
    httpsUpgradeEnabled: boolean
    defaultSearchEngine: 'google' | 'duckduckgo' | 'bing' | 'brave'
    theme: 'light' | 'dark' | 'system'
    sidebarPosition: 'left' | 'right'
    compactMode: boolean
    homeBackground: 'earth-horizon' | 'gradient-mesh' | 'aurora' | 'minimal' | 'custom'
    homeBackgroundCustomUrl: string
    homeBackgroundIntensity: number
    uiScale: 'extra-small' | 'small' | 'medium' | 'large' | 'extra-large'
    historyEnabled: boolean
    historyRetentionDays: number
    clearHistoryOnExit: boolean
    blockThirdPartyCookies: boolean
    sendDoNotTrack: boolean
    openLinksInNewTab: boolean
    confirmBeforeClosingMultipleTabs: boolean
    restoreTabsOnStartup: boolean
    enableDevTools: boolean
    openaiApiKey?: string
}

declare global {
    interface Window {
        electron: {
            ipcRenderer: {
                send: (channel: string, ...args: any[]) => void
                invoke: (channel: string, ...args: any[]) => Promise<any>
                on: (channel: string, func: (...args: any[]) => void) => () => void
                once: (channel: string, func: (...args: any[]) => void) => void
            }
            tabs: {
                create: (url?: string, options?: { realmId?: string; dockId?: string }) => Promise<{ id: string; realmId?: string }>
                close: (tabId: string) => Promise<{ success: boolean }>
                switch: (tabId: string) => Promise<{ success: boolean }>
                getAll: () => Promise<TabInfo[]>
                getActive: () => Promise<ActiveTabInfo | null>
                update: (tabId: string, data: Partial<TabInfo>) => Promise<{ success: boolean }>
                onTabsUpdated: (callback: (tabs: TabInfo[]) => void) => () => void
                onTabUpdated: (callback: (tab: TabInfo) => void) => () => void
                onActiveTabChanged: (callback: (tab: ActiveTabInfo | null) => void) => () => void
            }
            navigation: {
                navigate: (url: string) => Promise<{ success: boolean }>
                goBack: () => Promise<{ success: boolean }>
                goForward: () => Promise<{ success: boolean }>
                reload: () => Promise<{ success: boolean }>
                stop: () => Promise<{ success: boolean }>
                onReloadActiveTab: (callback: () => void) => () => void
                onNavigateToUrl: (callback: (data: { tabId: string; url: string }) => void) => () => void
                onSwipe: (callback: (direction: string) => void) => () => void
                onScrollTouchBegin: (callback: () => void) => () => void
                onScrollTouchEnd: (callback: () => void) => () => void
            }
            adBlock: {
                toggle: (enabled: boolean) => Promise<{ enabled: boolean }>
                getStatus: () => Promise<{ enabled: boolean; blockedCount: number; httpsUpgradeCount: number }>
                resetCount: () => Promise<{ blockedCount: number; httpsUpgradeCount: number }>
                onBlocked: (callback: (data: { count: number; url?: string }) => void) => () => void
                onHttpsUpgrade: (callback: (data: { count: number }) => void) => () => void
                onStatusChange: (callback: (data: { enabled: boolean; blockedCount: number; httpsUpgradeCount: number }) => void) => () => void
                getPreloadPath: () => Promise<string>
            }
            settings: {
                getAll: () => Promise<AppSettings>
                get: (key: keyof AppSettings) => Promise<any>
                set: (key: keyof AppSettings, value: any) => Promise<AppSettings>
                update: (updates: Partial<AppSettings>) => Promise<AppSettings>
                reset: () => Promise<AppSettings>
                onChanged: (callback: (data: { key?: keyof AppSettings; value?: any; settings: AppSettings }) => void) => () => void
            }
            sidebar: {
                setOpen: (isOpen: boolean) => Promise<void>
            }
            history: {
                search: (query: string, limit?: number) => Promise<HistoryEntry[]>
                topSites: (limit?: number) => Promise<HistoryEntry[]>
                recent: (limit?: number) => Promise<HistoryEntry[]>
                clear: () => Promise<{ success: boolean }>
            }
            getWebviewPreloadPath: () => Promise<string>
            searchSuggestions: (query: string) => Promise<string[]>
            realms: {
                getAll: () => Promise<Realm[]>
                get: (realmId: string) => Promise<Realm | null>
                getActiveId: () => Promise<string>
                setActive: (realmId: string) => Promise<{ success: boolean }>
                create: (name: string, icon?: IconName, color?: ThemeColor, template?: any) => Promise<Realm>
                update: (realmId: string, updates: { name?: string; icon?: IconName; color?: ThemeColor }) => Promise<Realm | null>
                delete: (realmId: string) => Promise<{ success: boolean }>
                reorder: (realmIds: string[]) => Promise<{ success: boolean }>
                onCreated: (callback: (realm: Realm) => void) => () => void
                onUpdated: (callback: (realm: Realm) => void) => () => void
                onDeleted: (callback: (data: { realmId: string }) => void) => () => void
                onActiveChanged: (callback: (data: { realmId: string }) => void) => () => void
            }
            docks: {
                getAll: (realmId?: string) => Promise<Dock[]>
                get: (dockId: string) => Promise<Dock | null>
                create: (name: string, realmId: string, icon?: IconName, color?: ThemeColor) => Promise<Dock | null>
                update: (dockId: string, updates: { name?: string; icon?: IconName; color?: ThemeColor; isCollapsed?: boolean }) => Promise<Dock | null>
                toggleCollapse: (dockId: string) => Promise<Dock | null>
                delete: (dockId: string) => Promise<{ success: boolean }>
                reorder: (realmId: string, dockIds: string[]) => Promise<{ success: boolean }>
                moveToRealm: (dockId: string, newRealmId: string) => Promise<{ success: boolean }>
                onCreated: (callback: (dock: Dock) => void) => () => void
                onUpdated: (callback: (dock: Dock) => void) => () => void
                onDeleted: (callback: (data: { dockId: string }) => void) => () => void
                onReordered: (callback: (data: { realmId: string; dockIds: string[] }) => void) => () => void
            }
            tabOrganization: {
                get: (tabId: string) => Promise<TabOrganization | null>
                getAll: () => Promise<Record<string, TabOrganization>>
                moveToDock: (tabId: string, dockId: string) => Promise<{ success: boolean }>
                moveToLoose: (tabId: string, realmId?: string) => Promise<{ success: boolean }>
                moveToRealm: (tabId: string, realmId: string) => Promise<{ success: boolean }>
                pin: (tabId: string) => Promise<{ success: boolean }>
                unpin: (tabId: string) => Promise<{ success: boolean }>
                reorderInDock: (dockId: string, tabIds: string[]) => Promise<{ success: boolean }>
                reorderLoose: (realmId: string, tabIds: string[]) => Promise<{ success: boolean }>
                onChanged: (callback: (data: { tabId: string; realmId: string; dockId: string | null; order: number; isPinned: boolean }) => void) => () => void
            }
            sidebarState: {
                get: () => Promise<{ activeRealmId: string; realms: Realm[]; docks: Dock[]; tabs: OrganizedTabInfo[] }>
            }
            getAppVersion: () => Promise<string>
        }
    }
}

interface HistoryEntry {
    id: number
    url: string
    title: string
    favicon: string
    visitCount: number
    lastVisited: number
}

export { }
