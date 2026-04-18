/**
 * PermissionManager — intercepts Electron permission requests from WebContents,
 * checks the PermissionStore for cached decisions, and dispatches prompts to
 * the shell renderer when user input is needed.
 *
 * One-time ("Allow this time") grants are tracked per tab and expire on tab close.
 */

import { BrowserWindow, Session, session } from 'electron';
import { mainLogger } from '../logger';
import { PermissionStore, PermissionType, PermissionState } from './PermissionStore';

// Map Electron's permission strings to our PermissionType enum
const ELECTRON_PERMISSION_MAP: Record<string, PermissionType> = {
  'media': 'media',
  'mediaKeySystem': 'media',
  'geolocation': 'geolocation',
  'notifications': 'notifications',
  'midi': 'midi',
  'midiSysex': 'midi',
  'pointerLock': 'pointerLock',
  'fullscreen': 'fullscreen',
  'openExternal': 'openExternal',
  'clipboard-read': 'clipboard-read',
  'clipboard-sanitized-write': 'clipboard-sanitized-write',
  'idle-detection': 'idle-detection',
  'sensors': 'sensors',
  'camera': 'camera',
  'microphone': 'microphone',
};

// Permissions that are auto-granted without prompting
const AUTO_GRANT: Set<PermissionType> = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  'media',
  'pointerLock',
]);

export interface PermissionPromptRequest {
  id: string;
  tabId: string | null;
  origin: string;
  permissionType: PermissionType;
  isMainFrame: boolean;
}

export type PermissionDecision = 'allow' | 'allow-once' | 'deny';

interface PendingPrompt {
  request: PermissionPromptRequest;
  resolve: (granted: boolean) => void;
}

export class PermissionManager {
  private store: PermissionStore;
  private getShellWindow: () => BrowserWindow | null;
  private getTabIdForWebContents: (wcId: number) => string | null;
  private pending: Map<string, PendingPrompt> = new Map();
  private sessionGrants: Map<string, Set<string>> = new Map();
  private promptCounter = 0;

  constructor(opts: {
    store: PermissionStore;
    getShellWindow: () => BrowserWindow | null;
    getTabIdForWebContents: (wcId: number) => string | null;
  }) {
    this.store = opts.store;
    this.getShellWindow = opts.getShellWindow;
    this.getTabIdForWebContents = opts.getTabIdForWebContents;

    this.attachToSession(session.defaultSession);
    mainLogger.info('PermissionManager.init');
  }

  private attachToSession(ses: Session): void {
    ses.setPermissionRequestHandler((webContents, electronPermission, callback, details) => {
      const origin = this.extractOrigin(details?.requestingUrl ?? webContents.getURL());
      const permissionType = ELECTRON_PERMISSION_MAP[electronPermission] ?? 'unknown';
      const wcId = webContents.id;
      const tabId = this.getTabIdForWebContents(wcId);

      mainLogger.info('PermissionManager.request', {
        origin,
        electronPermission,
        permissionType,
        tabId,
        wcId,
        isMainFrame: details?.isMainFrame ?? true,
      });

      if (AUTO_GRANT.has(permissionType)) {
        mainLogger.debug('PermissionManager.autoGrant', { origin, permissionType });
        callback(true);
        return;
      }

      if (this.hasSessionGrant(tabId, origin, permissionType)) {
        mainLogger.info('PermissionManager.sessionGrant', { origin, permissionType, tabId });
        callback(true);
        return;
      }

      const stored = this.store.getSitePermission(origin, permissionType);
      if (stored === 'allow') {
        mainLogger.info('PermissionManager.storedAllow', { origin, permissionType });
        callback(true);
        return;
      }
      if (stored === 'deny') {
        mainLogger.info('PermissionManager.storedDeny', { origin, permissionType });
        callback(false);
        return;
      }

      const promptId = `perm-${++this.promptCounter}`;
      const request: PermissionPromptRequest = {
        id: promptId,
        tabId,
        origin,
        permissionType,
        isMainFrame: details?.isMainFrame ?? true,
      };

      this.pending.set(promptId, { request, resolve: callback });
      this.sendPromptToRenderer(request);
    });

    ses.setPermissionCheckHandler((_webContents, electronPermission, requestingOrigin) => {
      const permissionType = ELECTRON_PERMISSION_MAP[electronPermission] ?? 'unknown';
      if (AUTO_GRANT.has(permissionType)) return true;
      const origin = this.extractOrigin(requestingOrigin);
      const stored = this.store.getSitePermission(origin, permissionType);
      return stored === 'allow';
    });
  }

  private sendPromptToRenderer(request: PermissionPromptRequest): void {
    const win = this.getShellWindow();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      mainLogger.warn('PermissionManager.sendPrompt.noWindow', { promptId: request.id });
      const p = this.pending.get(request.id);
      if (p) {
        p.resolve(false);
        this.pending.delete(request.id);
      }
      return;
    }

    mainLogger.info('PermissionManager.sendPrompt', {
      promptId: request.id,
      origin: request.origin,
      permissionType: request.permissionType,
    });
    win.webContents.send('permission-prompt', request);
  }

  // Called from IPC when the renderer user makes a decision
  handleDecision(promptId: string, decision: PermissionDecision): void {
    const p = this.pending.get(promptId);
    if (!p) {
      mainLogger.warn('PermissionManager.handleDecision.notFound', { promptId });
      return;
    }
    this.pending.delete(promptId);

    const { request } = p;
    mainLogger.info('PermissionManager.handleDecision', {
      promptId,
      decision,
      origin: request.origin,
      permissionType: request.permissionType,
    });

    switch (decision) {
      case 'allow':
        this.store.setSitePermission(request.origin, request.permissionType, 'allow');
        p.resolve(true);
        break;
      case 'allow-once':
        if (request.tabId) {
          this.addSessionGrant(request.tabId, request.origin, request.permissionType);
        }
        p.resolve(true);
        break;
      case 'deny':
        this.store.setSitePermission(request.origin, request.permissionType, 'deny');
        p.resolve(false);
        break;
    }
  }

  // Called when a tab is closed — expire one-time grants
  expireSessionGrants(tabId: string): void {
    const count = this.sessionGrants.get(tabId)?.size ?? 0;
    if (count > 0) {
      mainLogger.info('PermissionManager.expireSessionGrants', { tabId, count });
    }
    this.sessionGrants.delete(tabId);

    // Also dismiss any pending prompts for this tab
    for (const [id, p] of this.pending) {
      if (p.request.tabId === tabId) {
        mainLogger.info('PermissionManager.dismissPending', { promptId: id, tabId });
        p.resolve(false);
        this.pending.delete(id);
        const win = this.getShellWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('permission-prompt-dismiss', id);
        }
      }
    }
  }

  // Dismiss a prompt without a user decision (e.g. navigation away)
  dismissPrompt(promptId: string): void {
    const p = this.pending.get(promptId);
    if (p) {
      mainLogger.info('PermissionManager.dismissPrompt', { promptId });
      p.resolve(false);
      this.pending.delete(promptId);
    }
  }

  private addSessionGrant(tabId: string, origin: string, permissionType: PermissionType): void {
    const key = `${origin}::${permissionType}`;
    let grants = this.sessionGrants.get(tabId);
    if (!grants) {
      grants = new Set();
      this.sessionGrants.set(tabId, grants);
    }
    grants.add(key);
    mainLogger.info('PermissionManager.addSessionGrant', { tabId, origin, permissionType });
  }

  private hasSessionGrant(tabId: string | null, origin: string, permissionType: PermissionType): boolean {
    if (!tabId) return false;
    const key = `${origin}::${permissionType}`;
    return this.sessionGrants.get(tabId)?.has(key) ?? false;
  }

  private extractOrigin(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.origin;
    } catch {
      return url;
    }
  }
}
