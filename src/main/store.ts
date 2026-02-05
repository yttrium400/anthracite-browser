/**
 * Realm & Dock Storage Module
 *
 * Manages persistence for the hierarchical sidebar organization system.
 * Handles Realms, Docks, and tab organization with debounced saves.
 */

import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import {
    Realm,
    Dock,
    ThemeColor,
    IconName,
    SidebarState,
    createDefaultRealm,
    createRealm,
    createDock,
    generateId,
} from '../shared/types'

// ============================================
// Types
// ============================================

interface StoreData {
    version: number
    activeRealmId: string
    realms: Realm[]
    docks: Dock[]
    // Tab organization is stored here (mapping tabId -> organization)
    tabOrganization: Record<string, {
        realmId: string
        dockId: string | null
        order: number
        isPinned: boolean
    }>
}

const STORE_FILE = 'poseidon-realms.json'
const CURRENT_VERSION = 1

// ============================================
// Store State
// ============================================

let storeData: StoreData | null = null
let storePath: string = ''
let saveTimeout: NodeJS.Timeout | null = null
let initialized = false

// ============================================
// Initialization
// ============================================

function getStorePath(): string {
    if (!storePath) {
        const userDataPath = app.getPath('userData')
        storePath = path.join(userDataPath, STORE_FILE)
        console.log('[Store] Path:', storePath)
    }
    return storePath
}

function createDefaultData(): StoreData {
    const defaultRealm = createDefaultRealm()
    return {
        version: CURRENT_VERSION,
        activeRealmId: defaultRealm.id,
        realms: [defaultRealm],
        docks: [],
        tabOrganization: {},
    }
}

function loadStore(): StoreData {
    try {
        const filePath = getStorePath()
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf-8')
            const data = JSON.parse(raw) as StoreData

            // Migration check
            if (data.version < CURRENT_VERSION) {
                console.log('[Store] Migrating from version', data.version)
                // Add migration logic here when needed
                data.version = CURRENT_VERSION
            }

            console.log(`[Store] Loaded ${data.realms.length} realms, ${data.docks.length} docks`)
            return data
        }
    } catch (error) {
        console.error('[Store] Failed to load:', error)
    }

    console.log('[Store] Creating default data')
    return createDefaultData()
}

function ensureInitialized(): void {
    if (!initialized) {
        storeData = loadStore()
        initialized = true
    }
}

// ============================================
// Persistence
// ============================================

function saveStoreDebounced(): void {
    if (saveTimeout) {
        clearTimeout(saveTimeout)
    }
    saveTimeout = setTimeout(() => {
        saveStoreSync()
    }, 500)
}

function saveStoreSync(): void {
    if (!storeData) return

    try {
        const filePath = getStorePath()
        const tempPath = filePath + '.tmp'

        // Atomic write: write to temp file, then rename
        fs.writeFileSync(tempPath, JSON.stringify(storeData, null, 2))
        fs.renameSync(tempPath, filePath)

        console.log('[Store] Saved')
    } catch (error) {
        console.error('[Store] Failed to save:', error)
    }
}

// ============================================
// Realm Operations
// ============================================

export function getRealms(): Realm[] {
    ensureInitialized()
    return [...storeData!.realms].sort((a, b) => a.order - b.order)
}

export function getRealm(realmId: string): Realm | null {
    ensureInitialized()
    return storeData!.realms.find(r => r.id === realmId) || null
}

export function getActiveRealmId(): string {
    ensureInitialized()
    return storeData!.activeRealmId
}

export function setActiveRealmId(realmId: string): boolean {
    ensureInitialized()
    const realm = storeData!.realms.find(r => r.id === realmId)
    if (!realm) return false

    storeData!.activeRealmId = realmId
    saveStoreDebounced()
    return true
}

export function createRealmFromParams(
    name: string,
    icon: IconName = 'folder',
    color: ThemeColor = 'blue'
): Realm {
    ensureInitialized()

    // Calculate next order
    const maxOrder = storeData!.realms.reduce((max, r) => Math.max(max, r.order), -1)

    const realm = createRealm(name, icon, color, maxOrder + 1)
    storeData!.realms.push(realm)
    saveStoreDebounced()

    console.log('[Store] Created realm:', realm.name)
    return realm
}

export function updateRealm(
    realmId: string,
    updates: Partial<Pick<Realm, 'name' | 'icon' | 'color'>>
): Realm | null {
    ensureInitialized()

    const realm = storeData!.realms.find(r => r.id === realmId)
    if (!realm) return null

    if (updates.name !== undefined) realm.name = updates.name
    if (updates.icon !== undefined) realm.icon = updates.icon
    if (updates.color !== undefined) realm.color = updates.color
    realm.updatedAt = Date.now()

    saveStoreDebounced()
    console.log('[Store] Updated realm:', realm.name)
    return realm
}

export function deleteRealm(realmId: string): boolean {
    ensureInitialized()

    const realmIndex = storeData!.realms.findIndex(r => r.id === realmId)
    if (realmIndex === -1) return false

    const realm = storeData!.realms[realmIndex]

    // Prevent deleting the default realm
    if (realm.isDefault) {
        console.log('[Store] Cannot delete default realm')
        return false
    }

    // Prevent deleting last realm
    if (storeData!.realms.length <= 1) {
        console.log('[Store] Cannot delete last realm')
        return false
    }

    // Delete all docks in this realm
    storeData!.docks = storeData!.docks.filter(d => d.realmId !== realmId)

    // Move tabs from deleted realm to default realm
    const defaultRealm = storeData!.realms.find(r => r.isDefault) || storeData!.realms[0]
    for (const tabId in storeData!.tabOrganization) {
        const org = storeData!.tabOrganization[tabId]
        if (org.realmId === realmId) {
            org.realmId = defaultRealm.id
            org.dockId = null // Move to loose tabs
        }
    }

    // If active realm is deleted, switch to default
    if (storeData!.activeRealmId === realmId) {
        storeData!.activeRealmId = defaultRealm.id
    }

    // Remove the realm
    storeData!.realms.splice(realmIndex, 1)

    saveStoreDebounced()
    console.log('[Store] Deleted realm:', realm.name)
    return true
}

export function reorderRealms(realmIds: string[]): boolean {
    ensureInitialized()

    // Validate all IDs exist
    const existingIds = new Set(storeData!.realms.map(r => r.id))
    if (!realmIds.every(id => existingIds.has(id))) {
        return false
    }

    // Update order based on array position
    realmIds.forEach((id, index) => {
        const realm = storeData!.realms.find(r => r.id === id)
        if (realm) {
            realm.order = index
            realm.updatedAt = Date.now()
        }
    })

    saveStoreDebounced()
    return true
}

// ============================================
// Dock Operations
// ============================================

export function getDocks(realmId?: string): Dock[] {
    ensureInitialized()

    let docks = [...storeData!.docks]
    if (realmId) {
        docks = docks.filter(d => d.realmId === realmId)
    }
    return docks.sort((a, b) => a.order - b.order)
}

export function getDock(dockId: string): Dock | null {
    ensureInitialized()
    return storeData!.docks.find(d => d.id === dockId) || null
}

export function createDockFromParams(
    name: string,
    realmId: string,
    icon: IconName = 'folder',
    color: ThemeColor = 'gray'
): Dock | null {
    ensureInitialized()

    // Verify realm exists
    if (!storeData!.realms.find(r => r.id === realmId)) {
        console.log('[Store] Cannot create dock: realm not found')
        return null
    }

    // Calculate next order within the realm
    const realmDocks = storeData!.docks.filter(d => d.realmId === realmId)
    const maxOrder = realmDocks.reduce((max, d) => Math.max(max, d.order), -1)

    const dock = createDock(name, realmId, icon, color, maxOrder + 1)
    storeData!.docks.push(dock)
    saveStoreDebounced()

    console.log('[Store] Created dock:', dock.name)
    return dock
}

export function updateDock(
    dockId: string,
    updates: Partial<Pick<Dock, 'name' | 'icon' | 'color' | 'isCollapsed'>>
): Dock | null {
    ensureInitialized()

    const dock = storeData!.docks.find(d => d.id === dockId)
    if (!dock) return null

    if (updates.name !== undefined) dock.name = updates.name
    if (updates.icon !== undefined) dock.icon = updates.icon
    if (updates.color !== undefined) dock.color = updates.color
    if (updates.isCollapsed !== undefined) dock.isCollapsed = updates.isCollapsed
    dock.updatedAt = Date.now()

    saveStoreDebounced()
    console.log('[Store] Updated dock:', dock.name)
    return dock
}

export function toggleDockCollapse(dockId: string): Dock | null {
    ensureInitialized()

    const dock = storeData!.docks.find(d => d.id === dockId)
    if (!dock) return null

    dock.isCollapsed = !dock.isCollapsed
    dock.updatedAt = Date.now()

    saveStoreDebounced()
    return dock
}

export function deleteDock(dockId: string): boolean {
    ensureInitialized()

    const dockIndex = storeData!.docks.findIndex(d => d.id === dockId)
    if (dockIndex === -1) return false

    const dock = storeData!.docks[dockIndex]

    // Move tabs from deleted dock to loose tabs in same realm
    for (const tabId in storeData!.tabOrganization) {
        const org = storeData!.tabOrganization[tabId]
        if (org.dockId === dockId) {
            org.dockId = null
        }
    }

    // Remove the dock
    storeData!.docks.splice(dockIndex, 1)

    saveStoreDebounced()
    console.log('[Store] Deleted dock:', dock.name)
    return true
}

export function reorderDocks(realmId: string, dockIds: string[]): boolean {
    ensureInitialized()

    // Validate all IDs exist and belong to the realm
    const realmDocks = storeData!.docks.filter(d => d.realmId === realmId)
    const existingIds = new Set(realmDocks.map(d => d.id))

    if (!dockIds.every(id => existingIds.has(id))) {
        return false
    }

    // Update order based on array position
    dockIds.forEach((id, index) => {
        const dock = storeData!.docks.find(d => d.id === id)
        if (dock) {
            dock.order = index
            dock.updatedAt = Date.now()
        }
    })

    saveStoreDebounced()
    return true
}

export function moveDockToRealm(dockId: string, newRealmId: string): boolean {
    ensureInitialized()

    const dock = storeData!.docks.find(d => d.id === dockId)
    if (!dock) return false

    const newRealm = storeData!.realms.find(r => r.id === newRealmId)
    if (!newRealm) return false

    // Update tabs in this dock to new realm
    for (const tabId in storeData!.tabOrganization) {
        const org = storeData!.tabOrganization[tabId]
        if (org.dockId === dockId) {
            org.realmId = newRealmId
        }
    }

    // Calculate new order in target realm
    const targetDocks = storeData!.docks.filter(d => d.realmId === newRealmId)
    const maxOrder = targetDocks.reduce((max, d) => Math.max(max, d.order), -1)

    dock.realmId = newRealmId
    dock.order = maxOrder + 1
    dock.updatedAt = Date.now()

    saveStoreDebounced()
    console.log('[Store] Moved dock to realm:', dock.name, '->', newRealm.name)
    return true
}

// ============================================
// Tab Organization Operations
// ============================================

export function getTabOrganization(tabId: string): {
    realmId: string
    dockId: string | null
    order: number
    isPinned: boolean
} | null {
    ensureInitialized()
    return storeData!.tabOrganization[tabId] || null
}

export function setTabOrganization(
    tabId: string,
    realmId: string,
    dockId: string | null = null,
    order: number = 0,
    isPinned: boolean = false
): void {
    ensureInitialized()

    storeData!.tabOrganization[tabId] = {
        realmId,
        dockId,
        order,
        isPinned,
    }

    saveStoreDebounced()
}

export function assignTabToActiveRealm(tabId: string): string {
    ensureInitialized()

    const realmId = storeData!.activeRealmId

    // Calculate order for loose tabs in this realm
    const looseTabs = Object.entries(storeData!.tabOrganization)
        .filter(([_, org]) => org.realmId === realmId && org.dockId === null)

    const maxOrder = looseTabs.reduce((max, [_, org]) => Math.max(max, org.order), -1)

    storeData!.tabOrganization[tabId] = {
        realmId,
        dockId: null,
        order: maxOrder + 1,
        isPinned: false,
    }

    saveStoreDebounced()
    return realmId
}

export function moveTabToDock(tabId: string, dockId: string): boolean {
    ensureInitialized()

    const dock = storeData!.docks.find(d => d.id === dockId)
    if (!dock) return false

    const org = storeData!.tabOrganization[tabId]
    if (!org) {
        // Tab not yet organized, create entry
        storeData!.tabOrganization[tabId] = {
            realmId: dock.realmId,
            dockId,
            order: 0,
            isPinned: false,
        }
    } else {
        // Calculate new order in target dock
        const dockTabs = Object.entries(storeData!.tabOrganization)
            .filter(([_, o]) => o.dockId === dockId)
        const maxOrder = dockTabs.reduce((max, [_, o]) => Math.max(max, o.order), -1)

        org.realmId = dock.realmId
        org.dockId = dockId
        org.order = maxOrder + 1
    }

    saveStoreDebounced()
    return true
}

export function moveTabToLoose(tabId: string, realmId?: string): boolean {
    ensureInitialized()

    const org = storeData!.tabOrganization[tabId]
    const targetRealmId = realmId || org?.realmId || storeData!.activeRealmId

    // Verify realm exists
    if (!storeData!.realms.find(r => r.id === targetRealmId)) {
        return false
    }

    // Calculate new order in loose tabs
    const looseTabs = Object.entries(storeData!.tabOrganization)
        .filter(([_, o]) => o.realmId === targetRealmId && o.dockId === null)
    const maxOrder = looseTabs.reduce((max, [_, o]) => Math.max(max, o.order), -1)

    if (!org) {
        storeData!.tabOrganization[tabId] = {
            realmId: targetRealmId,
            dockId: null,
            order: maxOrder + 1,
            isPinned: false,
        }
    } else {
        org.realmId = targetRealmId
        org.dockId = null
        org.order = maxOrder + 1
    }

    saveStoreDebounced()
    return true
}

export function moveTabToRealm(tabId: string, realmId: string): boolean {
    ensureInitialized()

    // Verify realm exists
    if (!storeData!.realms.find(r => r.id === realmId)) {
        return false
    }

    return moveTabToLoose(tabId, realmId)
}

export function pinTab(tabId: string): boolean {
    ensureInitialized()

    const org = storeData!.tabOrganization[tabId]
    if (!org) return false

    org.isPinned = true
    saveStoreDebounced()
    return true
}

export function unpinTab(tabId: string): boolean {
    ensureInitialized()

    const org = storeData!.tabOrganization[tabId]
    if (!org) return false

    org.isPinned = false
    saveStoreDebounced()
    return true
}

export function reorderTabsInDock(dockId: string, tabIds: string[]): boolean {
    ensureInitialized()

    // Update order based on array position
    tabIds.forEach((tabId, index) => {
        const org = storeData!.tabOrganization[tabId]
        if (org && org.dockId === dockId) {
            org.order = index
        }
    })

    saveStoreDebounced()
    return true
}

export function reorderLooseTabs(realmId: string, tabIds: string[]): boolean {
    ensureInitialized()

    // Update order based on array position
    tabIds.forEach((tabId, index) => {
        const org = storeData!.tabOrganization[tabId]
        if (org && org.realmId === realmId && org.dockId === null) {
            org.order = index
        }
    })

    saveStoreDebounced()
    return true
}

export function removeTabOrganization(tabId: string): void {
    ensureInitialized()

    delete storeData!.tabOrganization[tabId]
    saveStoreDebounced()
}

// ============================================
// Bulk Operations
// ============================================

export function getFullState(): SidebarState {
    ensureInitialized()

    return {
        activeRealmId: storeData!.activeRealmId,
        realms: getRealms(),
        docks: getDocks(),
    }
}

export function getAllTabOrganizations(): Record<string, {
    realmId: string
    dockId: string | null
    order: number
    isPinned: boolean
}> {
    ensureInitialized()
    return { ...storeData!.tabOrganization }
}

// ============================================
// Lifecycle
// ============================================

export function closeStore(): void {
    if (saveTimeout) {
        clearTimeout(saveTimeout)
    }
    saveStoreSync()
    console.log('[Store] Closed')
}

// For testing/debugging
export function resetStore(): void {
    storeData = createDefaultData()
    saveStoreSync()
    console.log('[Store] Reset to defaults')
}
