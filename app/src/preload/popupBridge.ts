import { ipcRenderer } from 'electron';
import type {
  AppPopupAction,
  AppPopupClosed,
  AppPopupContentSize,
  AppPopupOpenRequest,
  AppPopupOpenResult,
} from '../shared/app-popup';

export function createPopupBridge(): {
  open: (request: AppPopupOpenRequest) => Promise<AppPopupOpenResult>;
  close: (popupId?: string) => Promise<void>;
  resize: (size: AppPopupContentSize) => void;
  onAction: (cb: (action: AppPopupAction) => void) => () => void;
  onClosed: (cb: (event: AppPopupClosed) => void) => () => void;
} {
  return {
    open: (request) => ipcRenderer.invoke('app-popup:open', request),
    close: (popupId) => ipcRenderer.invoke('app-popup:close', popupId),
    resize: (size) => ipcRenderer.send('app-popup:content-size', size),
    onAction: (cb) => {
      const handler = (_evt: unknown, action: AppPopupAction): void => cb(action);
      ipcRenderer.on('app-popup:action', handler);
      return () => ipcRenderer.removeListener('app-popup:action', handler);
    },
    onClosed: (cb) => {
      const handler = (_evt: unknown, event: AppPopupClosed): void => cb(event);
      ipcRenderer.on('app-popup:closed', handler);
      return () => ipcRenderer.removeListener('app-popup:closed', handler);
    },
  };
}
