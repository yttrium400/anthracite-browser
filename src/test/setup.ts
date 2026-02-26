import { vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'

// Mock electron's `app` with a temp dir so settings/store/history don't
// need a real Electron runtime to operate.
vi.mock('electron', () => ({
    app: {
        getPath: (name: string) => {
            if (name === 'userData') return path.join(os.tmpdir(), 'anthracite-test')
            return os.tmpdir()
        },
        getName: () => 'Anthracite',
        getVersion: () => '0.0.0',
    },
    ipcMain: {
        handle: vi.fn(),
        on: vi.fn(),
        removeHandler: vi.fn(),
    },
}))
