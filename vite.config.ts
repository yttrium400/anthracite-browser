import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [
        react(),
        electron({
            main: {
                // Shortcut of `build.lib.entry`.
                entry: 'src/main/main.ts',
                vite: {
                    build: {
                        rollupOptions: {
                            // Mark better-sqlite3 as external (native module)
                            external: ['better-sqlite3'],
                        },
                    },
                },
            },
            preload: {
                // Shortcut of `build.rollupOptions.input`.
                // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
                input: path.join(__dirname, 'src/main/preload.ts'),
            },
            // Ployfill the Electron and Node.js built-in modules for Renderer process.
            // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
            renderer: {},
        }),
    ],
    server: {
        host: '127.0.0.1',
        port: 5173,
    }
})


