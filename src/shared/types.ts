/**
 * Shared Type Definitions for Poseidon Browser
 *
 * Core types for the Realms & Docks organizational system.
 * Used by both main process and renderer.
 */

// ============================================
// Color & Icon Types
// ============================================

/** Preset colors for realms and docks */
export type ThemeColor =
    | 'blue'
    | 'purple'
    | 'pink'
    | 'red'
    | 'orange'
    | 'yellow'
    | 'green'
    | 'teal'
    | 'cyan'
    | 'gray';

/** Color values mapped to Tailwind/CSS colors */
export const THEME_COLORS: Record<ThemeColor, { bg: string; text: string; accent: string }> = {
    blue: { bg: 'bg-blue-500', text: 'text-blue-500', accent: '#3b82f6' },
    purple: { bg: 'bg-purple-500', text: 'text-purple-500', accent: '#a855f7' },
    pink: { bg: 'bg-pink-500', text: 'text-pink-500', accent: '#ec4899' },
    red: { bg: 'bg-red-500', text: 'text-red-500', accent: '#ef4444' },
    orange: { bg: 'bg-orange-500', text: 'text-orange-500', accent: '#f97316' },
    yellow: { bg: 'bg-yellow-500', text: 'text-yellow-500', accent: '#eab308' },
    green: { bg: 'bg-green-500', text: 'text-green-500', accent: '#22c55e' },
    teal: { bg: 'bg-teal-500', text: 'text-teal-500', accent: '#14b8a6' },
    cyan: { bg: 'bg-cyan-500', text: 'text-cyan-500', accent: '#06b6d4' },
    gray: { bg: 'bg-gray-500', text: 'text-gray-500', accent: '#6b7280' },
};

/** Available icons for realms and docks (lucide-react icon names) */
export type IconName =
    | 'globe'
    | 'home'
    | 'briefcase'
    | 'code'
    | 'gamepad-2'
    | 'music'
    | 'film'
    | 'book-open'
    | 'shopping-cart'
    | 'heart'
    | 'star'
    | 'zap'
    | 'coffee'
    | 'sun'
    | 'moon'
    | 'cloud'
    | 'folder'
    | 'layers'
    | 'grid'
    | 'hash'
    | 'at-sign'
    | 'message-circle'
    | 'mail'
    | 'calendar'
    | 'clock'
    | 'camera'
    | 'image'
    | 'video'
    | 'headphones'
    | 'mic'
    | 'compass'
    | 'map'
    | 'flag'
    | 'award'
    | 'target'
    | 'trending-up'
    | 'bar-chart'
    | 'pie-chart'
    | 'database'
    | 'server'
    | 'terminal'
    | 'github'
    | 'twitter'
    | 'youtube'
    | 'twitch'
    | 'linkedin'
    | 'slack'
    | 'figma'
    | 'chrome';

// ============================================
// Tab Types (Extended)
// ============================================

/** Extended tab information with realm/dock organization */
export interface Tab {
    id: string;
    url: string;
    title: string;
    favicon: string;
    isLoading: boolean;

    // Organization
    realmId: string;
    dockId: string | null;  // null = loose tab (not in any dock)
    order: number;          // Position within dock or loose tabs section

    // Pinning
    isPinned: boolean;

    // Metadata
    createdAt: number;
    lastAccessedAt: number;
}

/** Tab info sent to renderer (subset of full Tab) */
export interface TabInfo {
    id: string;
    url: string;
    title: string;
    favicon: string;
    isLoading: boolean;
    realmId: string;
    dockId: string | null;
    order: number;
    isPinned: boolean;
}

/** Active tab with navigation state */
export interface ActiveTabInfo extends TabInfo {
    canGoBack: boolean;
    canGoForward: boolean;
}

// ============================================
// Dock Types
// ============================================

/** A dock is a collapsible group of related tabs within a realm */
export interface Dock {
    id: string;
    name: string;
    icon: IconName;
    color: ThemeColor;

    // Parent realm
    realmId: string;

    // State
    isCollapsed: boolean;

    // Ordering
    order: number;  // Position within the realm

    // Metadata
    createdAt: number;
    updatedAt: number;
}

/** Dock info with computed tab count (for renderer) */
export interface DockInfo extends Dock {
    tabCount: number;
    tabIds: string[];
}

// ============================================
// Realm Types
// ============================================

/** A realm is a workspace containing docks and loose tabs */
export interface Realm {
    id: string;
    name: string;
    icon: IconName;
    color: ThemeColor;

    // State
    isDefault: boolean;  // The default realm cannot be deleted

    // Ordering
    order: number;  // Position in realm switcher

    // Metadata
    createdAt: number;
    updatedAt: number;
}

/** Realm info with computed counts (for renderer) */
export interface RealmInfo extends Realm {
    tabCount: number;
    dockCount: number;
    pinnedTabCount: number;
}

// ============================================
// Sidebar State
// ============================================

/** Complete sidebar state for persistence and renderer */
export interface SidebarState {
    activeRealmId: string;
    realms: Realm[];
    docks: Dock[];
    // Note: Tabs are managed separately in main.ts, but their organization
    // (realmId, dockId, order, isPinned) is part of this system
}

/** Full state snapshot sent to renderer */
export interface SidebarSnapshot {
    activeRealmId: string;
    realms: RealmInfo[];
    docks: DockInfo[];
    tabs: TabInfo[];
}

// ============================================
// Realm Templates
// ============================================

// Templates moved to separate file: src/shared/templates.ts

// ============================================
// IPC Event Types
// ============================================

/** Events emitted from main to renderer */
export interface SidebarEvents {
    'sidebar-state-changed': SidebarSnapshot;
    'realm-updated': RealmInfo;
    'realm-deleted': { realmId: string };
    'dock-updated': DockInfo;
    'dock-deleted': { dockId: string };
    'active-realm-changed': { realmId: string };
    'tab-organization-changed': { tabId: string; realmId: string; dockId: string | null };
}

// ============================================
// Utility Functions
// ============================================

/** Generate a unique ID */
export function generateId(prefix: string = ''): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}

/** Get default realm structure */
export function createDefaultRealm(): Realm {
    return {
        id: generateId('realm'),
        name: 'General',
        icon: 'globe',
        color: 'blue',
        isDefault: true,
        order: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

/** Create a new realm from template or blank */
export function createRealm(
    name: string,
    icon: IconName = 'folder',
    color: ThemeColor = 'gray',
    order: number = 0
): Realm {
    return {
        id: generateId('realm'),
        name,
        icon,
        color,
        isDefault: false,
        order,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

/** Create a new dock */
export function createDock(
    name: string,
    realmId: string,
    icon: IconName = 'folder',
    color: ThemeColor = 'gray',
    order: number = 0
): Dock {
    return {
        id: generateId('dock'),
        name,
        icon,
        color,
        realmId,
        isCollapsed: true, // Default to collapsed for cleanly UI
        order,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}
