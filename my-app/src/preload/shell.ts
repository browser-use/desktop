/**
 * Preload script for the shell renderer.
 * Exposes a safe contextBridge API for tab management, navigation, CDP info,
 * and bookmarks.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { TabManagerState, TabState, ClosedTabRecord, FindResultPayload } from '../main/tabs/TabManager';
import type {
  BookmarkNode,
  PersistedBookmarks,
  Visibility,
} from '../main/bookmarks/BookmarkStore';
import type { PermissionRecord, PermissionType, PermissionState } from '../main/permissions/PermissionStore';
import type { PermissionPromptRequest } from '../main/permissions/PermissionManager';

// ---------------------------------------------------------------------------
// Type re-exports for renderer consumption
// ---------------------------------------------------------------------------
export type {
  TabManagerState,
  TabState,
  ClosedTabRecord,
  FindResultPayload,
  BookmarkNode,
  PersistedBookmarks,
  Visibility,
  PermissionRecord,
  PermissionType,
  PermissionState,
  PermissionPromptRequest,
};

// ---------------------------------------------------------------------------
// electronAPI surface exposed to renderer
// ---------------------------------------------------------------------------
contextBridge.exposeInMainWorld('electronAPI', {
  // Tab management
  tabs: {
    create: (url?: string): Promise<string> =>
      ipcRenderer.invoke('tabs:create', url),

    close: (tabId: string): Promise<void> =>
      ipcRenderer.invoke('tabs:close', tabId),

    activate: (tabId: string): Promise<void> =>
      ipcRenderer.invoke('tabs:activate', tabId),

    move: (tabId: string, toIndex: number): Promise<void> =>
      ipcRenderer.invoke('tabs:move', tabId, toIndex),

    navigate: (tabId: string, input: string): Promise<void> =>
      ipcRenderer.invoke('tabs:navigate', tabId, input),

    navigateActive: (input: string): Promise<void> =>
      ipcRenderer.invoke('tabs:navigate-active', input),

    back: (tabId: string): Promise<void> =>
      ipcRenderer.invoke('tabs:back', tabId),

    forward: (tabId: string): Promise<void> =>
      ipcRenderer.invoke('tabs:forward', tabId),

    reload: (tabId: string): Promise<void> =>
      ipcRenderer.invoke('tabs:reload', tabId),

    // Issue #25 — Hard reload bypassing cache (Shift-click on reload button).
    reloadHard: (tabId: string): Promise<void> =>
      ipcRenderer.invoke('tabs:reload-hard', tabId),

    getState: (): Promise<TabManagerState> =>
      ipcRenderer.invoke('tabs:get-state'),

    reopenLastClosed: (): Promise<void> =>
      ipcRenderer.invoke('tabs:reopen-last-closed'),

    reopenClosedAt: (index: number): Promise<void> =>
      ipcRenderer.invoke('tabs:reopen-closed-at', index),

    getClosedTabs: (): Promise<ClosedTabRecord[]> =>
      ipcRenderer.invoke('tabs:get-closed-tabs'),

    showContextMenu: (tabId: string): Promise<void> =>
      ipcRenderer.invoke('tabs:show-context-menu', tabId),

    showBackHistory: (tabId: string): Promise<void> =>
      ipcRenderer.invoke('tabs:show-back-history', tabId),

    showForwardHistory: (tabId: string): Promise<void> =>
      ipcRenderer.invoke('tabs:show-forward-history', tabId),
  },

  // CDP info for agent integration
  cdp: {
    getActiveTabCdpUrl: (): Promise<string | null> =>
      ipcRenderer.invoke('tabs:get-active-cdp-url'),

    getActiveTabTargetId: (): Promise<string | null> =>
      ipcRenderer.invoke('tabs:get-active-target-id'),
  },

  // Bookmarks
  bookmarks: {
    list: (): Promise<PersistedBookmarks> =>
      ipcRenderer.invoke('bookmarks:list'),

    add: (payload: { name: string; url: string; parentId?: string }): Promise<BookmarkNode> =>
      ipcRenderer.invoke('bookmarks:add', payload),

    addFolder: (payload: { name: string; parentId?: string }): Promise<BookmarkNode> =>
      ipcRenderer.invoke('bookmarks:add-folder', payload),

    remove: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('bookmarks:remove', id),

    rename: (payload: { id: string; newName: string }): Promise<boolean> =>
      ipcRenderer.invoke('bookmarks:rename', payload),

    move: (payload: { id: string; newParentId: string; index: number }): Promise<boolean> =>
      ipcRenderer.invoke('bookmarks:move', payload),

    isBookmarked: (url: string): Promise<boolean> =>
      ipcRenderer.invoke('bookmarks:is-bookmarked', url),

    findByUrl: (url: string): Promise<BookmarkNode | null> =>
      ipcRenderer.invoke('bookmarks:find-by-url', url),

    setVisibility: (state: Visibility): Promise<Visibility> =>
      ipcRenderer.invoke('bookmarks:set-visibility', state),

    getVisibility: (): Promise<Visibility> =>
      ipcRenderer.invoke('bookmarks:get-visibility'),

    bookmarkAllTabs: (payload: { folderName: string }): Promise<BookmarkNode> =>
      ipcRenderer.invoke('bookmarks:bookmark-all-tabs', payload),
  },

  // Zoom controls — per-origin persistence + badge UI
  zoom: {
    getPercent: (): Promise<number> =>
      ipcRenderer.invoke('zoom:get-percent'),
    zoomIn: (): Promise<void> =>
      ipcRenderer.invoke('zoom:in'),
    zoomOut: (): Promise<void> =>
      ipcRenderer.invoke('zoom:out'),
    reset: (): Promise<void> =>
      ipcRenderer.invoke('zoom:reset'),
    listOverrides: (): Promise<Array<{ origin: string; zoomLevel: number }>> =>
      ipcRenderer.invoke('zoom:list-overrides'),
    removeOverride: (origin: string): Promise<boolean> =>
      ipcRenderer.invoke('zoom:remove-override', origin),
    clearAll: (): Promise<void> =>
      ipcRenderer.invoke('zoom:clear-all'),
  },

  // Find-in-page. Main owns the search state on webContents; the renderer just
  // fires queries and renders results streamed back via on.findResult.
  find: {
    start: (text: string): Promise<void> =>
      ipcRenderer.invoke('find:start', text),
    next: (): Promise<void> => ipcRenderer.invoke('find:next'),
    prev: (): Promise<void> => ipcRenderer.invoke('find:prev'),
    stop: (): Promise<void> => ipcRenderer.invoke('find:stop'),
    getLastQuery: (): Promise<string> =>
      ipcRenderer.invoke('find:get-last-query'),
  },

  // Permissions — renderer -> main decision relay + query API
  permissions: {
    respond: (promptId: string, decision: string): Promise<void> =>
      ipcRenderer.invoke('permissions:respond', promptId, decision),

    dismiss: (promptId: string): Promise<void> =>
      ipcRenderer.invoke('permissions:dismiss', promptId),

    getSite: (origin: string): Promise<PermissionRecord[]> =>
      ipcRenderer.invoke('permissions:get-site', origin),

    setSite: (origin: string, permissionType: string, state: string): Promise<void> =>
      ipcRenderer.invoke('permissions:set-site', origin, permissionType, state),

    removeSite: (origin: string, permissionType: string): Promise<boolean> =>
      ipcRenderer.invoke('permissions:remove-site', origin, permissionType),

    clearOrigin: (origin: string): Promise<void> =>
      ipcRenderer.invoke('permissions:clear-origin', origin),

    getDefaults: (): Promise<Record<string, string>> =>
      ipcRenderer.invoke('permissions:get-defaults'),

    setDefault: (permissionType: string, state: string): Promise<void> =>
      ipcRenderer.invoke('permissions:set-default', permissionType, state),

    getAll: (): Promise<PermissionRecord[]> =>
      ipcRenderer.invoke('permissions:get-all'),

    resetAll: (): Promise<void> =>
      ipcRenderer.invoke('permissions:reset-all'),
  },

  // Shell-level signals (renderer → main)
  shell: {
    setChromeHeight: (height: number): Promise<void> =>
      ipcRenderer.invoke('shell:set-chrome-height', height),
  },

  // Event listeners
  on: {
    tabsState: (
      cb: (state: TabManagerState) => void,
    ): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, state: TabManagerState) =>
        cb(state);
      ipcRenderer.on('tabs-state', handler);
      return () => ipcRenderer.removeListener('tabs-state', handler);
    },

    tabUpdated: (
      cb: (tab: TabState) => void,
    ): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, tab: TabState) => cb(tab);
      ipcRenderer.on('tab-updated', handler);
      return () => ipcRenderer.removeListener('tab-updated', handler);
    },

    tabActivated: (
      cb: (tabId: string) => void,
    ): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, tabId: string) =>
        cb(tabId);
      ipcRenderer.on('tab-activated', handler);
      return () => ipcRenderer.removeListener('tab-activated', handler);
    },

    tabFaviconUpdated: (
      cb: (payload: { tabId: string; favicon: string | null }) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        payload: { tabId: string; favicon: string | null },
      ) => cb(payload);
      ipcRenderer.on('tab-favicon-updated', handler);
      return () =>
        ipcRenderer.removeListener('tab-favicon-updated', handler);
    },

    closedTabsUpdated: (
      cb: (records: ClosedTabRecord[]) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        records: ClosedTabRecord[],
      ) => cb(records);
      ipcRenderer.on('closed-tabs-updated', handler);
      return () =>
        ipcRenderer.removeListener('closed-tabs-updated', handler);
    },

    windowReady: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on('window-ready', handler);
      return () => ipcRenderer.removeListener('window-ready', handler);
    },

    focusUrlBar: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on('focus-url-bar', handler);
      return () => ipcRenderer.removeListener('focus-url-bar', handler);
    },

    targetLost: (
      cb: (payload: { tabId: string }) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        payload: { tabId: string },
      ) => cb(payload);
      ipcRenderer.on('target-lost', handler);
      return () => ipcRenderer.removeListener('target-lost', handler);
    },

    bookmarksUpdated: (
      cb: (tree: PersistedBookmarks) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        tree: PersistedBookmarks,
      ) => cb(tree);
      ipcRenderer.on('bookmarks-updated', handler);
      return () => ipcRenderer.removeListener('bookmarks-updated', handler);
    },

    openBookmarkDialog: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on('open-bookmark-dialog', handler);
      return () => ipcRenderer.removeListener('open-bookmark-dialog', handler);
    },

    toggleBookmarksBar: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on('toggle-bookmarks-bar', handler);
      return () => ipcRenderer.removeListener('toggle-bookmarks-bar', handler);
    },

    focusBookmarksBar: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on('focus-bookmarks-bar', handler);
      return () => ipcRenderer.removeListener('focus-bookmarks-bar', handler);
    },

    // Menu → 'Find…' asks the renderer to open the FindBar.
    // Main sends the remembered last query so the input pre-fills (Chrome parity).
    findOpen: (
      cb: (payload: { lastQuery: string }) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        payload: { lastQuery: string },
      ) => cb(payload);
      ipcRenderer.on('find-open', handler);
      return () => ipcRenderer.removeListener('find-open', handler);
    },

    // Streamed results from webContents.findInPage. Only finalUpdate===true
    // payloads are meaningful for the visible counter.
    findResult: (
      cb: (payload: FindResultPayload) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        payload: FindResultPayload,
      ) => cb(payload);
      ipcRenderer.on('find-result', handler);
      return () => ipcRenderer.removeListener('find-result', handler);
    },

    zoomChanged: (
      cb: (payload: { percent: number }) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        payload: { percent: number },
      ) => cb(payload);
      ipcRenderer.on('zoom-changed', handler);
      return () => ipcRenderer.removeListener('zoom-changed', handler);
    },

    permissionPrompt: (
      cb: (data: PermissionPromptRequest) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        data: PermissionPromptRequest,
      ) => cb(data);
      ipcRenderer.on('permission-prompt', handler);
      return () => ipcRenderer.removeListener('permission-prompt', handler);
    },

    permissionPromptDismiss: (
      cb: (promptId: string) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        promptId: string,
      ) => cb(promptId);
      ipcRenderer.on('permission-prompt-dismiss', handler);
      return () => ipcRenderer.removeListener('permission-prompt-dismiss', handler);
    },

    passwordFormDetected: (
      cb: (payload: { tabId: string; origin: string; username: string; password: string }) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        payload: { tabId: string; origin: string; username: string; password: string },
      ) => cb(payload);
      ipcRenderer.on('password-form-detected', handler);
      return () => ipcRenderer.removeListener('password-form-detected', handler);
    },
  },

  // Passwords
  passwords: {
    save: (payload: { origin: string; username: string; password: string }): Promise<unknown> =>
      ipcRenderer.invoke('passwords:save', payload),

    isNeverSave: (origin: string): Promise<boolean> =>
      ipcRenderer.invoke('passwords:is-never-save', origin),

    addNeverSave: (origin: string): Promise<void> =>
      ipcRenderer.invoke('passwords:add-never-save', origin),

    findForOrigin: (origin: string): Promise<Array<{ id: string; origin: string; username: string }>> =>
      ipcRenderer.invoke('passwords:find-for-origin', origin),
  },
});
