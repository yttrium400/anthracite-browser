import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
        on: (channel: string, func: (...args: any[]) => void) => {
            const subscription = (_event: any, ...args: any[]) => func(...args)
            ipcRenderer.on(channel, subscription)
            return () => ipcRenderer.removeListener(channel, subscription)
        },
        once: (channel: string, func: (...args: any[]) => void) => {
            ipcRenderer.once(channel, (_event, ...args) => func(...args))
        },
    },
})
