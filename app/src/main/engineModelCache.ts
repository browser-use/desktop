import fs from 'node:fs';
import path from 'node:path';
import type { EngineModelList } from './hl/engines/types';

const ENGINE_MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CachedEngineModelList = EngineModelList & {
  cachedAt: number;
  expiresAt: number;
};

interface EngineModelCacheFile {
  version: 1;
  entries: Record<string, CachedEngineModelList>;
}

interface EngineModelCacheLogger {
  info?: (event: string, fields: Record<string, unknown>) => void;
  warn: (event: string, fields: Record<string, unknown>) => void;
}

interface StoreOptions {
  expectedVersion?: number;
}

export interface EngineModelCache {
  currentVersion(engineId: string): number;
  getCached(engineId: string): CachedEngineModelList | null;
  invalidate(engineId: string): boolean;
  store(engineId: string, list: EngineModelList, opts?: StoreOptions): EngineModelList;
}

export function createEngineModelCache({
  cachePath,
  logger,
}: {
  cachePath: () => string;
  logger: EngineModelCacheLogger;
}): EngineModelCache {
  let cache: EngineModelCacheFile | null = null;
  const versions = new Map<string, number>();

  const currentVersion = (engineId: string): number => versions.get(engineId) ?? 0;

  const read = (): EngineModelCacheFile => {
    if (cache) return cache;
    try {
      const raw = fs.readFileSync(cachePath(), 'utf-8');
      const parsed = JSON.parse(raw) as Partial<EngineModelCacheFile>;
      if (parsed.version === 1 && parsed.entries && typeof parsed.entries === 'object') {
        cache = { version: 1, entries: parsed.entries as Record<string, CachedEngineModelList> };
        return cache;
      }
    } catch {
      // Missing or corrupt cache is non-fatal; model listing can repopulate it.
    }
    cache = { version: 1, entries: {} };
    return cache;
  };

  const write = (next: EngineModelCacheFile): void => {
    cache = next;
    try {
      const resolved = cachePath();
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, JSON.stringify(next, null, 2));
    } catch (err) {
      logger.warn('engineModelCache.writeFailed', { error: (err as Error).message });
    }
  };

  const stamp = (list: EngineModelList): CachedEngineModelList => {
    const now = Date.now();
    return {
      ...list,
      cached: false,
      cachedAt: now,
      expiresAt: now + ENGINE_MODEL_CACHE_TTL_MS,
    };
  };

  return {
    currentVersion,

    getCached(engineId: string): CachedEngineModelList | null {
      const entry = read().entries[engineId];
      if (!entry) return null;
      if (Date.now() >= entry.expiresAt) return null;
      return entry;
    },

    invalidate(engineId: string): boolean {
      versions.set(engineId, currentVersion(engineId) + 1);
      const current = read();
      if (!(engineId in current.entries)) return false;
      delete current.entries[engineId];
      write(current);
      return true;
    },

    store(engineId: string, list: EngineModelList, opts?: StoreOptions): EngineModelList {
      const stamped = stamp(list);
      const expectedVersion = opts?.expectedVersion;
      if (expectedVersion != null && currentVersion(engineId) !== expectedVersion) {
        logger.info?.('engineModelCache.skipStaleWrite', {
          engineId,
          expectedVersion,
          currentVersion: currentVersion(engineId),
        });
        return stamped;
      }
      if (list.models.length > 0 && list.source !== 'fallback' && !list.error) {
        const current = read();
        current.entries[engineId] = stamped;
        write(current);
      }
      return stamped;
    },
  };
}
