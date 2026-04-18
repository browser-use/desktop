/**
 * Extensions preload — contextBridge API for the extensions renderer.
 *
 * Exposes a typed API surface on window.extensionsAPI.
 * All IPC channels are namespaced under 'extensions:' to avoid collisions.
 */

import { contextBridge, ipcRenderer } from 'electron';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtensionRecord {
  id: string;
  name: string;
  version: string;
  description: string;
  path: string;
  enabled: boolean;
  permissions: string[];
  hostPermissions: string[];
  hostAccess: 'all-sites' | 'specific-sites' | 'on-click';
  icons: Record<string, string>;
}

export type HostAccessLevel = 'all-sites' | 'specific-sites' | 'on-click';

export interface ExtensionsAPI {
  listExtensions: () => Promise<ExtensionRecord[]>;
  enableExtension: (id: string) => Promise<void>;
  disableExtension: (id: string) => Promise<void>;
  removeExtension: (id: string) => Promise<void>;
  getExtensionDetails: (id: string) => Promise<ExtensionRecord | null>;
  loadUnpacked: () => Promise<ExtensionRecord | null>;
  updateExtension: (id: string) => Promise<void>;
  setHostAccess: (id: string, access: HostAccessLevel) => Promise<void>;
  getDeveloperMode: () => Promise<boolean>;
  setDeveloperMode: (enabled: boolean) => Promise<void>;
  pickDirectory: () => Promise<string | null>;
  closeWindow: () => void;
}

// ---------------------------------------------------------------------------
// contextBridge exposure
// ---------------------------------------------------------------------------

const api: ExtensionsAPI = {
  listExtensions: async (): Promise<ExtensionRecord[]> => {
    console.debug('[extensions-preload] listExtensions');
    return ipcRenderer.invoke('extensions:list') as Promise<ExtensionRecord[]>;
  },

  enableExtension: async (id: string): Promise<void> => {
    console.debug('[extensions-preload] enableExtension', { id });
    await ipcRenderer.invoke('extensions:enable', id);
  },

  disableExtension: async (id: string): Promise<void> => {
    console.debug('[extensions-preload] disableExtension', { id });
    await ipcRenderer.invoke('extensions:disable', id);
  },

  removeExtension: async (id: string): Promise<void> => {
    console.debug('[extensions-preload] removeExtension', { id });
    await ipcRenderer.invoke('extensions:remove', id);
  },

  getExtensionDetails: async (id: string): Promise<ExtensionRecord | null> => {
    console.debug('[extensions-preload] getExtensionDetails', { id });
    return ipcRenderer.invoke('extensions:get-details', id) as Promise<ExtensionRecord | null>;
  },

  loadUnpacked: async (): Promise<ExtensionRecord | null> => {
    console.debug('[extensions-preload] loadUnpacked');
    return ipcRenderer.invoke('extensions:load-unpacked') as Promise<ExtensionRecord | null>;
  },

  updateExtension: async (id: string): Promise<void> => {
    console.debug('[extensions-preload] updateExtension', { id });
    await ipcRenderer.invoke('extensions:update', id);
  },

  setHostAccess: async (id: string, access: HostAccessLevel): Promise<void> => {
    console.debug('[extensions-preload] setHostAccess', { id, access });
    await ipcRenderer.invoke('extensions:set-host-access', id, access);
  },

  getDeveloperMode: async (): Promise<boolean> => {
    console.debug('[extensions-preload] getDeveloperMode');
    return ipcRenderer.invoke('extensions:get-dev-mode') as Promise<boolean>;
  },

  setDeveloperMode: async (enabled: boolean): Promise<void> => {
    console.debug('[extensions-preload] setDeveloperMode', { enabled });
    await ipcRenderer.invoke('extensions:set-dev-mode', enabled);
  },

  pickDirectory: async (): Promise<string | null> => {
    console.debug('[extensions-preload] pickDirectory');
    return ipcRenderer.invoke('extensions:pick-directory') as Promise<string | null>;
  },

  closeWindow: (): void => {
    console.debug('[extensions-preload] closeWindow');
    ipcRenderer.send('extensions:close-window');
  },
};

contextBridge.exposeInMainWorld('extensionsAPI', api);
