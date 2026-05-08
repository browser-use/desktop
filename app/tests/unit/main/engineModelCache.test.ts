import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineModelCache } from '../../../src/main/engineModelCache';
import type { EngineModelList } from '../../../src/main/hl/engines/types';

const ENGINE_ID = 'cursor-agent';
type LogFn = (event: string, fields: Record<string, unknown>) => void;

function modelList(modelId = 'cursor/default'): EngineModelList {
  return {
    engineId: ENGINE_ID,
    source: 'cli',
    models: [{
      id: modelId,
      displayName: modelId,
      source: 'cli',
    }],
  };
}

describe('engineModelCache', () => {
  let dir: string;
  let cachePath: string;
  let logger: { info: LogFn; warn: LogFn };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bu-engine-model-cache-'));
    cachePath = path.join(dir, 'engine-model-cache.json');
    logger = { info: vi.fn() as unknown as LogFn, warn: vi.fn() as unknown as LogFn };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('stores fresh model lists and removes them on invalidation', () => {
    const cache = createEngineModelCache({ cachePath: () => cachePath, logger });
    const version = cache.currentVersion(ENGINE_ID);

    cache.store(ENGINE_ID, modelList(), { expectedVersion: version });

    expect(cache.getCached(ENGINE_ID)?.models[0]?.id).toBe('cursor/default');
    expect(cache.invalidate(ENGINE_ID)).toBe(true);
    expect(cache.currentVersion(ENGINE_ID)).toBe(version + 1);
    expect(cache.getCached(ENGINE_ID)).toBeNull();
  });

  it('does not let an invalidated in-flight request repopulate the cache', () => {
    const cache = createEngineModelCache({ cachePath: () => cachePath, logger });
    const requestVersion = cache.currentVersion(ENGINE_ID);

    expect(cache.invalidate(ENGINE_ID)).toBe(false);
    const response = cache.store(ENGINE_ID, modelList('cursor/stale'), { expectedVersion: requestVersion });

    expect(response.models[0]?.id).toBe('cursor/stale');
    expect(cache.getCached(ENGINE_ID)).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('engineModelCache.skipStaleWrite', {
      engineId: ENGINE_ID,
      expectedVersion: requestVersion,
      currentVersion: requestVersion + 1,
    });
  });
});
