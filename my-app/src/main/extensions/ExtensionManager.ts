/**
 * ExtensionManager.ts — manages Chrome extensions via Electron's session API.
 *
 * Handles loading, enabling, disabling, and removing extensions.
 * Persists extension state (enabled/disabled, paths) to a JSON file in userData.
 * Uses session.defaultSession.loadExtension / removeExtension under the hood.
 */

import fs from 'node:fs';
import path from 'node:path';
import { app, session } from 'electron';
import { mainLogger } from '../logger';

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

interface PersistedState {
  extensions: Array<{
    id: string;
    path: string;
    enabled: boolean;
    hostAccess: string;
  }>;
  developerMode: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_FILE_NAME = 'extensions-state.json';
const LOG_PREFIX = 'ExtensionManager';

// ---------------------------------------------------------------------------
// ExtensionManager
// ---------------------------------------------------------------------------

export class ExtensionManager {
  private statePath: string;
  private state: PersistedState;

  constructor() {
    this.statePath = path.join(app.getPath('userData'), STATE_FILE_NAME);
    this.state = this.loadState();
    mainLogger.info(`${LOG_PREFIX}.init`, {
      statePath: this.statePath,
      extensionCount: this.state.extensions.length,
      developerMode: this.state.developerMode,
    });
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private loadState(): PersistedState {
    try {
      if (fs.existsSync(this.statePath)) {
        const raw = fs.readFileSync(this.statePath, 'utf-8');
        const parsed = JSON.parse(raw) as PersistedState;
        mainLogger.info(`${LOG_PREFIX}.loadState.ok`, {
          extensionCount: parsed.extensions?.length ?? 0,
        });
        return {
          extensions: Array.isArray(parsed.extensions) ? parsed.extensions : [],
          developerMode: parsed.developerMode === true,
        };
      }
    } catch (err) {
      mainLogger.warn(`${LOG_PREFIX}.loadState.failed`, {
        error: (err as Error).message,
      });
    }
    return { extensions: [], developerMode: false };
  }

  private saveState(): void {
    try {
      fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
      fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf-8');
      mainLogger.info(`${LOG_PREFIX}.saveState.ok`, {
        extensionCount: this.state.extensions.length,
      });
    } catch (err) {
      mainLogger.error(`${LOG_PREFIX}.saveState.failed`, {
        error: (err as Error).message,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Startup: load all enabled extensions into the session
  // -------------------------------------------------------------------------

  async loadAllEnabled(): Promise<void> {
    mainLogger.info(`${LOG_PREFIX}.loadAllEnabled`, {
      total: this.state.extensions.length,
    });

    for (const record of this.state.extensions) {
      if (!record.enabled) {
        mainLogger.info(`${LOG_PREFIX}.loadAllEnabled.skip`, {
          id: record.id,
          reason: 'disabled',
        });
        continue;
      }

      if (!fs.existsSync(record.path)) {
        mainLogger.warn(`${LOG_PREFIX}.loadAllEnabled.pathMissing`, {
          id: record.id,
          path: record.path,
        });
        continue;
      }

      try {
        const ext = await session.defaultSession.loadExtension(record.path, {
          allowFileAccess: true,
        });
        record.id = ext.id;
        mainLogger.info(`${LOG_PREFIX}.loadAllEnabled.loaded`, {
          id: ext.id,
          name: ext.name,
        });
      } catch (err) {
        mainLogger.error(`${LOG_PREFIX}.loadAllEnabled.loadFailed`, {
          id: record.id,
          path: record.path,
          error: (err as Error).message,
        });
      }
    }

    this.saveState();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  listExtensions(): ExtensionRecord[] {
    const loaded = session.defaultSession.getAllExtensions();
    const loadedMap = new Map(loaded.map((e) => [e.id, e]));

    const results: ExtensionRecord[] = [];

    for (const record of this.state.extensions) {
      const live = loadedMap.get(record.id);
      const manifest = live?.manifest as Record<string, unknown> | undefined;

      results.push({
        id: record.id,
        name: live?.name ?? (manifest?.name as string) ?? 'Unknown',
        version: live?.version ?? (manifest?.version as string) ?? '0.0.0',
        description: (manifest?.description as string) ?? '',
        path: record.path,
        enabled: record.enabled,
        permissions: (manifest?.permissions as string[]) ?? [],
        hostPermissions: (manifest?.host_permissions as string[]) ?? [],
        hostAccess: (record.hostAccess as ExtensionRecord['hostAccess']) ?? 'on-click',
        icons: this.extractIcons(manifest, record.path),
      });
    }

    mainLogger.info(`${LOG_PREFIX}.listExtensions`, { count: results.length });
    return results;
  }

  async loadUnpacked(extensionPath: string): Promise<ExtensionRecord> {
    mainLogger.info(`${LOG_PREFIX}.loadUnpacked`, { path: extensionPath });

    const resolvedPath = path.resolve(extensionPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Extension path does not exist: ${resolvedPath}`);
    }

    const manifestPath = path.join(resolvedPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`No manifest.json found at: ${resolvedPath}`);
    }

    const ext = await session.defaultSession.loadExtension(resolvedPath, {
      allowFileAccess: true,
    });

    const existing = this.state.extensions.find((e) => e.path === resolvedPath);
    if (existing) {
      existing.id = ext.id;
      existing.enabled = true;
    } else {
      this.state.extensions.push({
        id: ext.id,
        path: resolvedPath,
        enabled: true,
        hostAccess: 'on-click',
      });
    }

    this.saveState();

    const manifest = ext.manifest as Record<string, unknown>;
    const record: ExtensionRecord = {
      id: ext.id,
      name: ext.name,
      version: ext.version ?? (manifest?.version as string) ?? '0.0.0',
      description: (manifest?.description as string) ?? '',
      path: resolvedPath,
      enabled: true,
      permissions: (manifest?.permissions as string[]) ?? [],
      hostPermissions: (manifest?.host_permissions as string[]) ?? [],
      hostAccess: 'on-click',
      icons: this.extractIcons(manifest, resolvedPath),
    };

    mainLogger.info(`${LOG_PREFIX}.loadUnpacked.ok`, {
      id: ext.id,
      name: ext.name,
    });

    return record;
  }

  async enableExtension(id: string): Promise<void> {
    mainLogger.info(`${LOG_PREFIX}.enableExtension`, { id });

    const record = this.state.extensions.find((e) => e.id === id);
    if (!record) throw new Error(`Extension not found: ${id}`);

    if (!fs.existsSync(record.path)) {
      throw new Error(`Extension path missing: ${record.path}`);
    }

    await session.defaultSession.loadExtension(record.path, {
      allowFileAccess: true,
    });

    record.enabled = true;
    this.saveState();
    mainLogger.info(`${LOG_PREFIX}.enableExtension.ok`, { id });
  }

  disableExtension(id: string): void {
    mainLogger.info(`${LOG_PREFIX}.disableExtension`, { id });

    const record = this.state.extensions.find((e) => e.id === id);
    if (!record) throw new Error(`Extension not found: ${id}`);

    try {
      session.defaultSession.removeExtension(id);
    } catch (err) {
      mainLogger.warn(`${LOG_PREFIX}.disableExtension.removeFailed`, {
        id,
        error: (err as Error).message,
      });
    }

    record.enabled = false;
    this.saveState();
    mainLogger.info(`${LOG_PREFIX}.disableExtension.ok`, { id });
  }

  removeExtension(id: string): void {
    mainLogger.info(`${LOG_PREFIX}.removeExtension`, { id });

    try {
      session.defaultSession.removeExtension(id);
    } catch (err) {
      mainLogger.warn(`${LOG_PREFIX}.removeExtension.sessionRemoveFailed`, {
        id,
        error: (err as Error).message,
      });
    }

    this.state.extensions = this.state.extensions.filter((e) => e.id !== id);
    this.saveState();
    mainLogger.info(`${LOG_PREFIX}.removeExtension.ok`, { id });
  }

  async updateExtension(id: string): Promise<void> {
    mainLogger.info(`${LOG_PREFIX}.updateExtension`, { id });

    const record = this.state.extensions.find((e) => e.id === id);
    if (!record) throw new Error(`Extension not found: ${id}`);

    try {
      session.defaultSession.removeExtension(id);
    } catch {
      // may not be loaded
    }

    await session.defaultSession.loadExtension(record.path, {
      allowFileAccess: true,
    });

    mainLogger.info(`${LOG_PREFIX}.updateExtension.ok`, { id });
  }

  setHostAccess(id: string, hostAccess: ExtensionRecord['hostAccess']): void {
    mainLogger.info(`${LOG_PREFIX}.setHostAccess`, { id, hostAccess });

    const record = this.state.extensions.find((e) => e.id === id);
    if (!record) throw new Error(`Extension not found: ${id}`);

    record.hostAccess = hostAccess;
    this.saveState();
    mainLogger.info(`${LOG_PREFIX}.setHostAccess.ok`, { id, hostAccess });
  }

  getDeveloperMode(): boolean {
    return this.state.developerMode;
  }

  setDeveloperMode(enabled: boolean): void {
    mainLogger.info(`${LOG_PREFIX}.setDeveloperMode`, { enabled });
    this.state.developerMode = enabled;
    this.saveState();
  }

  getExtensionDetails(id: string): ExtensionRecord | null {
    const all = this.listExtensions();
    return all.find((e) => e.id === id) ?? null;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private extractIcons(
    manifest: Record<string, unknown> | undefined,
    extPath: string,
  ): Record<string, string> {
    const icons: Record<string, string> = {};
    const manifestIcons = manifest?.icons as Record<string, string> | undefined;
    if (manifestIcons) {
      for (const [size, relativePath] of Object.entries(manifestIcons)) {
        const absPath = path.join(extPath, relativePath);
        if (fs.existsSync(absPath)) {
          icons[size] = absPath;
        }
      }
    }
    return icons;
  }
}
