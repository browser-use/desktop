/**
 * ZoomStore — persists per-origin zoom levels to userData/zoom.json.
 *
 * Follows the BookmarkStore pattern: debounced atomic writes (300ms).
 * Keys are origins (e.g. "https://example.com"); values are Electron
 * zoom levels (0 = 100%, 0.5 ≈ 110%, etc.).
 */

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { mainLogger } from '../logger';

const ZOOM_FILE_NAME = 'zoom.json';
const DEBOUNCE_MS = 300;

export interface ZoomEntry {
  origin: string;
  zoomLevel: number;
}

interface PersistedZoom {
  version: 1;
  origins: Record<string, number>;
}

function getZoomPath(): string {
  return path.join(app.getPath('userData'), ZOOM_FILE_NAME);
}

function makeEmpty(): PersistedZoom {
  return { version: 1, origins: {} };
}

/** Extract the origin from a URL. Returns null for data:/about: URLs. */
export function extractOrigin(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'data:' || parsed.protocol === 'about:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Convert an Electron zoom level to a human-readable percentage string. */
export function zoomLevelToPercent(level: number): number {
  return Math.round(Math.pow(1.2, level) * 100);
}

export class ZoomStore {
  private state: PersistedZoom;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor() {
    this.state = this.load();
    mainLogger.info('ZoomStore.init', { entryCount: Object.keys(this.state.origins).length });
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private load(): PersistedZoom {
    try {
      const raw = fs.readFileSync(getZoomPath(), 'utf-8');
      const parsed = JSON.parse(raw) as PersistedZoom;
      if (parsed.version !== 1 || typeof parsed.origins !== 'object') {
        mainLogger.warn('ZoomStore.load.invalid', { msg: 'Resetting zoom data' });
        return makeEmpty();
      }
      mainLogger.info('ZoomStore.load.ok', { entryCount: Object.keys(parsed.origins).length });
      return parsed;
    } catch {
      mainLogger.info('ZoomStore.load.fresh', { msg: 'No zoom.json — starting fresh' });
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
      fs.writeFileSync(getZoomPath(), JSON.stringify(this.state, null, 2), 'utf-8');
      mainLogger.info('ZoomStore.flushSync.ok', {
        path: getZoomPath(),
        entryCount: Object.keys(this.state.origins).length,
      });
    } catch (err) {
      mainLogger.error('ZoomStore.flushSync.failed', { error: (err as Error).message });
    }
    this.dirty = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  getZoomForOrigin(origin: string): number {
    return this.state.origins[origin] ?? 0;
  }

  getZoomForUrl(url: string): number {
    const origin = extractOrigin(url);
    if (!origin) return 0;
    return this.getZoomForOrigin(origin);
  }

  listOverrides(): ZoomEntry[] {
    return Object.entries(this.state.origins).map(([origin, zoomLevel]) => ({
      origin,
      zoomLevel,
    }));
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  setZoomForOrigin(origin: string, zoomLevel: number): void {
    if (zoomLevel === 0) {
      delete this.state.origins[origin];
      mainLogger.info('ZoomStore.remove', { origin });
    } else {
      this.state.origins[origin] = zoomLevel;
      mainLogger.info('ZoomStore.set', { origin, zoomLevel });
    }
    this.schedulePersist();
  }

  setZoomForUrl(url: string, zoomLevel: number): void {
    const origin = extractOrigin(url);
    if (!origin) return;
    this.setZoomForOrigin(origin, zoomLevel);
  }

  removeOrigin(origin: string): boolean {
    if (!(origin in this.state.origins)) return false;
    delete this.state.origins[origin];
    mainLogger.info('ZoomStore.removeOrigin', { origin });
    this.schedulePersist();
    return true;
  }

  clearAll(): void {
    this.state.origins = {};
    mainLogger.info('ZoomStore.clearAll');
    this.schedulePersist();
  }
}
