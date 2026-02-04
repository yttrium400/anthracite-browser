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
    ipcRenderer: {
        send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
        invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
        on: (channel: string, func: (...args: any[]) => void) => {
            const subscription = (_event: any, ...args: any[]) => func(...args)
            ipcRenderer.on(channel, subscription)
            return () => ipcRenderer.removeListener(channel, subscription)
        },
        once: (channel: string, func: (...args: any[]) => void) => {
            ipcRenderer.once(channel, (_event, ...args) => func(...args))
        },
    },

    // Tab Management
    tabs: {
        create: (url?: string) => ipcRenderer.invoke('create-tab', url),
        close: (tabId: string) => ipcRenderer.invoke('close-tab', tabId),
        switch: (tabId: string) => ipcRenderer.invoke('switch-tab', tabId),
        getAll: () => ipcRenderer.invoke('get-tabs'),
        getActive: () => ipcRenderer.invoke('get-active-tab'),

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
        onStatusChange: (callback: (data: { enabled: boolean; count: number }) => void) => {
            const subscription = (_event: any, data: any) => callback(data)
            ipcRenderer.on('ad-block-status', subscription)
            return () => ipcRenderer.removeListener('ad-block-status', subscription)
        },
    },
})

// ============================================
// Type Definitions for Renderer
// ============================================

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
                create: (url?: string) => Promise<{ id: string }>
                close: (tabId: string) => Promise<{ success: boolean }>
                switch: (tabId: string) => Promise<{ success: boolean }>
                getAll: () => Promise<TabInfo[]>
                getActive: () => Promise<ActiveTabInfo | null>
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
            }
            adBlock: {
                toggle: (enabled: boolean) => Promise<{ enabled: boolean }>
                getStatus: () => Promise<{ enabled: boolean; count: number }>
                resetCount: () => Promise<{ count: number }>
                onBlocked: (callback: (data: { count: number; url?: string }) => void) => () => void
                onStatusChange: (callback: (data: { enabled: boolean; count: number }) => void) => () => void
            }
        }
    }
}

export {}
