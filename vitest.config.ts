import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        // Mock electron before any test file imports it
        setupFiles: ['./src/test/setup.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/main/**/*.ts'],
            exclude: ['src/main/main.ts', 'src/main/preload.ts', 'src/main/auth-preload.ts', 'src/main/webview-preload.ts'],
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
})
