export { };

declare global {
    interface Window {
        electron: {
            log: (message: string) => void;
            ipcRenderer: {
                send(channel: string, ...args: any[]): void;
                on(channel: string, func: (...args: any[]) => void): () => void;
                once(channel: string, func: (...args: any[]) => void): void;
                invoke(channel: string, ...args: any[]): Promise<any>;
                removeAllListeners(channel: string): void;
            };
            store: {
                get: (key: string) => any;
                set: (key: string, val: any) => void;
                // ... any others
            };
            settings: {
                getAll: () => Promise<any>;
                get: (key: string) => Promise<any>;
                set: (key: string, value: any) => Promise<any>;
                reset: () => Promise<any>;
                onChanged: (callback: (data: any) => void) => () => void;
            };
            history: {
                clear: () => Promise<void>;
            };
            navigation: {
                navigate: (url: string) => void;
                goBack: () => void;
                goForward: () => void;
                reload: () => void;
                stop: () => void;
                onNavigate: (callback: (data: any) => void) => () => void;
                onNavigateInPage: (callback: (data: any) => void) => () => void;
            };
            tabs: {
                create: (url?: string) => Promise<any>;
                update: (tabId: string, state: any) => Promise<any>;
                close: (tabId: string) => Promise<void>;
                switchTo: (tabId: string) => Promise<void>;
                onUpdated: (callback: (data: any) => void) => () => void;
                onCreated: (callback: (data: any) => void) => () => void;
                onRemoved: (callback: (data: any) => void) => () => void;
                onActivated: (callback: (data: any) => void) => () => void;
            };
            agent: {
                createAgentTab: () => Promise<{ tabId: string; cdpUrl: string; targetId: string }>;
                getActiveWebviewTarget: () => Promise<string | null>;
            };
            getAppVersion: () => Promise<string>;
            [key: string]: any; // Allow other properties
        };
    }
}
