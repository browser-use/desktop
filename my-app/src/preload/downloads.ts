/**
 * Preload script for the chrome://downloads internal page.
 * Exposes a safe contextBridge API for listing and managing downloads.
 *
 * IPC surface is additive on top of the existing DownloadManager channels
 * (downloads:get-all, downloads:pause, downloads:resume, downloads:cancel,
 * downloads:open-file, downloads:show-in-folder, downloads:clear-completed).
 * New channels added in DownloadManager: downloads:remove, downloads:retry,
 * downloads:clear-all.
 */

import { contextBridge, ipcRenderer } from 'electron';

export type DownloadStatus =
  | 'in-progress'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'interrupted';

export interface DownloadItemDTO {
  id: string;
  filename: string;
  url: string;
  savePath: string;
  totalBytes: number;
  receivedBytes: number;
  status: DownloadStatus;
  startTime: number;
  endTime: number | null;
  openWhenDone: boolean;
  speed: number;
  eta: number;
}

contextBridge.exposeInMainWorld('downloadsAPI', {
  list: (): Promise<DownloadItemDTO[]> =>
    ipcRenderer.invoke('downloads:get-all'),

  remove: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('downloads:remove', id),

  openFile: (id: string): Promise<void> =>
    ipcRenderer.invoke('downloads:open-file', id),

  showInFolder: (id: string): Promise<void> =>
    ipcRenderer.invoke('downloads:show-in-folder', id),

  retry: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('downloads:retry', id),

  pause: (id: string): Promise<void> =>
    ipcRenderer.invoke('downloads:pause', id),

  resume: (id: string): Promise<void> =>
    ipcRenderer.invoke('downloads:resume', id),

  cancel: (id: string): Promise<void> =>
    ipcRenderer.invoke('downloads:cancel', id),

  clearAll: (): Promise<boolean> =>
    ipcRenderer.invoke('downloads:clear-all'),

  navigateTo: (url: string): Promise<void> =>
    ipcRenderer.invoke('tabs:navigate-active', url),

  onStateChange: (cb: (items: DownloadItemDTO[]) => void): (() => void) => {
    const listener = (_e: unknown, payload: DownloadItemDTO[]) => cb(payload);
    ipcRenderer.on('downloads-state', listener);
    return () => {
      ipcRenderer.removeListener('downloads-state', listener);
    };
  },
});
