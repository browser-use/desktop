/**
 * HistoryStore — persistent browsing history.
 *
 * Follows the BookmarkStore pattern: debounced atomic writes to
 * history.json (300ms). Entries are stored reverse-chronologically.
 * Supports full-text search across title + URL and date-grouped queries.
 *
 * Issue #208: persistence is scoped to a caller-supplied data dir so each
 * profile has its own history. The default profile uses `<userData>/`
 * directly (see ProfileContext.getProfileDataDir).
 */

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { mainLogger } from '../logger';

const HISTORY_FILE_NAME = 'history.json';
const DEBOUNCE_MS = 300;
const MAX_ENTRIES = 10_000;

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitTime: number;
  favicon: string | null;
}

export interface PersistedHistory {
  version: 1;
  entries: HistoryEntry[];
}

export interface HistoryQueryOptions {
  query?: string;
  limit?: number;
  offset?: number;
}

export interface HistoryQueryResult {
  entries: HistoryEntry[];
  totalCount: number;
}

let nextId = 1;

function generateId(): string {
  return `h-${Date.now()}-${nextId++}`;
}

export class HistoryStore {
  private readonly filePath: string;
  private entries: HistoryEntry[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  /**
   * @param dataDir Absolute directory for history.json. Defaults to
   *   `app.getPath('userData')` for back-compat with tests and the default
   *   profile.
   */
  constructor(dataDir?: string) {
    const dir = dataDir ?? app.getPath('userData');
    this.filePath = path.join(dir, HISTORY_FILE_NAME);
    this.load();
  }

  /** @internal — test helper; returns the resolved history.json path. */
  getFilePath(): string {
    return this.filePath;
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedHistory;
      if (parsed.version === 1 && Array.isArray(parsed.entries)) {
        this.entries = parsed.entries;
        mainLogger.info('HistoryStore.load.ok', { count: this.entries.length });
      } else {
        mainLogger.warn('HistoryStore.load.invalidVersion', { version: parsed.version });
        this.entries = [];
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        mainLogger.error('HistoryStore.load.failed', {
          error: (err as Error).message,
        });
      }
      this.entries = [];
    }
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flushSync(), DEBOUNCE_MS);
  }

  flushSync(): void {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    try {
      const data: PersistedHistory = { version: 1, entries: this.entries };
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(data), 'utf-8');
      mainLogger.debug('HistoryStore.flush.ok', { count: this.entries.length });
    } catch (err) {
      mainLogger.error('HistoryStore.flush.failed', {
        error: (err as Error).message,
      });
    }
  }

  /**
   * Cancel any pending debounced write and flush what's in memory. Use before
   * disposing this store on a profile switch.
   */
  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.flushSync();
  }

  addVisit(url: string, title: string, favicon: string | null = null): HistoryEntry {
    const entry: HistoryEntry = {
      id: generateId(),
      url,
      title: title || url,
      visitTime: Date.now(),
      favicon,
    };
    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(0, MAX_ENTRIES);
    }
    mainLogger.debug('HistoryStore.addVisit', { url, title: entry.title });
    this.scheduleSave();
    return entry;
  }

  query(opts: HistoryQueryOptions = {}): HistoryQueryResult {
    const { query, limit = 100, offset = 0 } = opts;
    let filtered = this.entries;

    if (query && query.trim().length > 0) {
      const lower = query.toLowerCase();
      filtered = this.entries.filter(
        (e) =>
          e.title.toLowerCase().includes(lower) ||
          e.url.toLowerCase().includes(lower),
      );
    }

    const totalCount = filtered.length;
    const entries = filtered.slice(offset, offset + limit);
    return { entries, totalCount };
  }

  removeEntry(id: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) {
      mainLogger.warn('HistoryStore.removeEntry.notFound', { id });
      return false;
    }
    this.entries.splice(idx, 1);
    mainLogger.info('HistoryStore.removeEntry', { id });
    this.scheduleSave();
    return true;
  }

  removeEntries(ids: string[]): number {
    const idSet = new Set(ids);
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => !idSet.has(e.id));
    const removed = before - this.entries.length;
    if (removed > 0) {
      mainLogger.info('HistoryStore.removeEntries', { requested: ids.length, removed });
      this.scheduleSave();
    }
    return removed;
  }

  clearAll(): void {
    const count = this.entries.length;
    this.entries = [];
    mainLogger.info('HistoryStore.clearAll', { cleared: count });
    this.scheduleSave();
  }

  getAll(): HistoryEntry[] {
    return this.entries;
  }
}
