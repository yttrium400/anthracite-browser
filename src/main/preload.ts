import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
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
    // Ad Blocker APIs
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

// Type definitions for renderer
declare global {
    interface Window {
        electron: {
            ipcRenderer: {
                send: (channel: string, ...args: any[]) => void
                invoke: (channel: string, ...args: any[]) => Promise<any>
                on: (channel: string, func: (...args: any[]) => void) => () => void
                once: (channel: string, func: (...args: any[]) => void) => void
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
