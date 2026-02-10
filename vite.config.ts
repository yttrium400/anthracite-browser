import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [
        react(),
        electron([
            {
                entry: 'src/main/main.ts',
                vite: {
                    build: {
                        rollupOptions: {
                            external: ['better-sqlite3'],
                        },
                    },
                },
            },
            {
                entry: 'src/main/preload.ts',
                onstart(args) {
                    args.reload()
                },
            },
            {
                entry: 'src/main/webview-preload.ts',
                onstart(args) {
                    args.reload()
                },
            },
        ]),
        renderer(),
    ],
    server: {
        host: '127.0.0.1',
        port: 5173,
    }
})


