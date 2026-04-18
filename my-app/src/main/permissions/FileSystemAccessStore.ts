/**
 * FileSystemAccessStore — persistent per-origin, per-path grants for the
 * File System Access API (showOpenFilePicker / showSaveFilePicker /
 * showDirectoryPicker + FileSystemHandle.requestPermission()).
 *
 * Storage: userData/fs-access-grants.json (debounced 300ms writes).
 * Each grant records the origin, the absolute file-system path, whether
 * the grant covers readwrite (vs read-only), and timestamps.
 */

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { mainLogger } from '../logger';

const FS_GRANTS_FILE_NAME = 'fs-access-grants.json';
const DEBOUNCE_MS = 300;

export type FsAccessMode = 'read' | 'readwrite';

export interface FsAccessGrant {
  origin: string;
  /** Absolute path on the host file system */
  filePath: string;
  mode: FsAccessMode;
  createdAt: number;
  updatedAt: number;
}

interface PersistedFsGrants {
  version: 1;
  grants: FsAccessGrant[];
}

function makeEmpty(): PersistedFsGrants {
  return { version: 1, grants: [] };
}

export class FileSystemAccessStore {
  private readonly filePath: string;
  private state: PersistedFsGrants;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(dataDir?: string) {
    this.filePath = path.join(dataDir ?? app.getPath('userData'), FS_GRANTS_FILE_NAME);
    mainLogger.info('FileSystemAccessStore.constructor', { filePath: this.filePath });
    this.state = this.load();
    mainLogger.info('FileSystemAccessStore.init', { grantCount: this.state.grants.length });
  }

  private load(): PersistedFsGrants {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedFsGrants;
      if (parsed.version !== 1 || !Array.isArray(parsed.grants)) {
        mainLogger.warn('FileSystemAccessStore.load.invalid', { msg: 'Resetting fs grants' });
        return makeEmpty();
      }
      mainLogger.info('FileSystemAccessStore.load.ok', { grantCount: parsed.grants.length });
      return parsed;
    } catch {
      mainLogger.info('FileSystemAccessStore.load.fresh', { msg: 'No fs-access-grants.json — starting fresh' });
      return makeEmpty();
    }
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flushSync(), DEBOUNCE_MS);
  }

  flushSync(): void {
    if (!this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
      mainLogger.info('FileSystemAccessStore.flushSync.ok');
    } catch (err) {
      mainLogger.error('FileSystemAccessStore.flushSync.failed', { error: (err as Error).message });
    }
    this.dirty = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  hasGrant(origin: string, filePath: string): boolean {
    return this.state.grants.some((g) => g.origin === origin && g.filePath === filePath);
  }

  getGrantsForOrigin(origin: string): FsAccessGrant[] {
    return this.state.grants.filter((g) => g.origin === origin);
  }

  getAllGrants(): FsAccessGrant[] {
    return [...this.state.grants];
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  addGrant(origin: string, filePath: string, mode: FsAccessMode = 'read'): void {
    const existing = this.state.grants.find(
      (g) => g.origin === origin && g.filePath === filePath,
    );
    if (existing) {
      existing.mode = mode;
      existing.updatedAt = Date.now();
      mainLogger.info('FileSystemAccessStore.updateGrant', { origin, filePath, mode });
    } else {
      this.state.grants.push({
        origin,
        filePath,
        mode,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      mainLogger.info('FileSystemAccessStore.addGrant', { origin, filePath, mode });
    }
    this.schedulePersist();
  }

  removeGrant(origin: string, filePath: string): boolean {
    const before = this.state.grants.length;
    this.state.grants = this.state.grants.filter(
      (g) => !(g.origin === origin && g.filePath === filePath),
    );
    if (this.state.grants.length < before) {
      mainLogger.info('FileSystemAccessStore.removeGrant', { origin, filePath });
      this.schedulePersist();
      return true;
    }
    return false;
  }

  clearOrigin(origin: string): void {
    this.state.grants = this.state.grants.filter((g) => g.origin !== origin);
    mainLogger.info('FileSystemAccessStore.clearOrigin', { origin });
    this.schedulePersist();
  }

  clearAll(): void {
    this.state.grants = [];
    mainLogger.info('FileSystemAccessStore.clearAll');
    this.schedulePersist();
  }
}
