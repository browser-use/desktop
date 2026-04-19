/**
 * history/ipc.ts unit tests.
 *
 * Tests cover:
 *   - registerHistoryHandlers: registers all 6 IPC channels
 *   - unregisterHistoryHandlers: removes all channels
 *   - history:query: delegates to store.query() with defaults and capped limits
 *   - history:remove: validates id, calls store.removeEntry()
 *   - history:remove-bulk: validates array, calls store.removeEntries()
 *   - history:remove-bulk: throws for non-array or oversized array
 *   - history:clear-all: calls store.clearAll(), returns true
 *   - history:journeys: calls store.getAll() and delegates to queryJourneys
 *   - history:remove-cluster: calls removeClusterEntries and store.removeEntries
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { loggerSpy } = vi.hoisted(() => ({
  loggerSpy: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/main/logger', () => ({ mainLogger: loggerSpy }));

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((ch: string, fn: (...args: unknown[]) => unknown) => { handlers.set(ch, fn); }),
    removeHandler: vi.fn((ch: string) => { handlers.delete(ch); }),
  },
}));

const { mockQueryJourneys, mockRemoveClusterEntries } = vi.hoisted(() => ({
  mockQueryJourneys: vi.fn(() => []),
  mockRemoveClusterEntries: vi.fn(() => [] as string[]),
}));

vi.mock('../../../src/main/history/JourneyCluster', () => ({
  queryJourneys: mockQueryJourneys,
  removeClusterEntries: mockRemoveClusterEntries,
}));

import {
  registerHistoryHandlers,
  unregisterHistoryHandlers,
} from '../../../src/main/history/ipc';
import type { HistoryStore } from '../../../src/main/history/HistoryStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore() {
  return {
    query: vi.fn(() => ({ entries: [], total: 0 })),
    getAll: vi.fn(() => []),
    removeEntry: vi.fn(() => true),
    removeEntries: vi.fn(() => 3),
    clearAll: vi.fn(),
  } as unknown as HistoryStore;
}

async function invokeHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler: ${channel}`);
  return handler({} as never, ...args);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('history/ipc.ts', () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    store = makeStore();
    registerHistoryHandlers({ store: store as unknown as HistoryStore });
  });

  // ---------------------------------------------------------------------------
  // Registration / unregistration
  // ---------------------------------------------------------------------------

  describe('registerHistoryHandlers()', () => {
    const CHANNELS = [
      'history:query', 'history:remove', 'history:remove-bulk',
      'history:clear-all', 'history:journeys', 'history:remove-cluster',
    ];
    for (const ch of CHANNELS) {
      it(`registers ${ch}`, () => { expect(handlers.has(ch)).toBe(true); });
    }
  });

  describe('unregisterHistoryHandlers()', () => {
    it('removes all channels', () => {
      unregisterHistoryHandlers();
      expect(handlers.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // history:query
  // ---------------------------------------------------------------------------

  describe('history:query', () => {
    it('calls store.query with provided query/limit/offset', async () => {
      await invokeHandler('history:query', { query: 'google', limit: 50, offset: 10 });
      expect(store.query).toHaveBeenCalledWith({ query: 'google', limit: 50, offset: 10 });
    });

    it('uses defaults when no payload provided', async () => {
      await invokeHandler('history:query', undefined);
      expect(store.query).toHaveBeenCalledWith({ query: '', limit: 100, offset: 0 });
    });

    it('caps limit at 500', async () => {
      await invokeHandler('history:query', { limit: 9999 });
      expect(store.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 500 }));
    });

    it('returns the result from store.query', async () => {
      const data = { entries: [{ id: '1', url: 'https://a.com' }], total: 1 };
      (store.query as ReturnType<typeof vi.fn>).mockReturnValue(data);
      const result = await invokeHandler('history:query');
      expect(result).toBe(data);
    });
  });

  // ---------------------------------------------------------------------------
  // history:remove
  // ---------------------------------------------------------------------------

  describe('history:remove', () => {
    it('calls store.removeEntry with the id', async () => {
      await invokeHandler('history:remove', 'entry-abc');
      expect(store.removeEntry).toHaveBeenCalledWith('entry-abc');
    });

    it('returns the result from store.removeEntry', async () => {
      (store.removeEntry as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const result = await invokeHandler('history:remove', 'missing');
      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // history:remove-bulk
  // ---------------------------------------------------------------------------

  describe('history:remove-bulk', () => {
    it('calls store.removeEntries with the ids array', async () => {
      await invokeHandler('history:remove-bulk', ['id1', 'id2']);
      expect(store.removeEntries).toHaveBeenCalledWith(['id1', 'id2']);
    });

    it('throws when ids is not an array', async () => {
      await expect(invokeHandler('history:remove-bulk', 'not-an-array')).rejects.toThrow('ids must be an array');
    });

    it('throws when ids array exceeds 1000', async () => {
      const ids = Array.from({ length: 1001 }, (_, i) => `id${i}`);
      await expect(invokeHandler('history:remove-bulk', ids)).rejects.toThrow('Too many ids');
    });

    it('returns count of removed entries', async () => {
      (store.removeEntries as ReturnType<typeof vi.fn>).mockReturnValue(2);
      const result = await invokeHandler('history:remove-bulk', ['a', 'b']);
      expect(result).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // history:clear-all
  // ---------------------------------------------------------------------------

  describe('history:clear-all', () => {
    it('calls store.clearAll()', async () => {
      await invokeHandler('history:clear-all');
      expect(store.clearAll).toHaveBeenCalled();
    });

    it('returns true', async () => {
      const result = await invokeHandler('history:clear-all');
      expect(result).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // history:journeys
  // ---------------------------------------------------------------------------

  describe('history:journeys', () => {
    it('calls store.getAll()', async () => {
      await invokeHandler('history:journeys');
      expect(store.getAll).toHaveBeenCalled();
    });

    it('delegates to queryJourneys', async () => {
      const entries = [{ id: '1', url: 'https://a.com' }];
      (store.getAll as ReturnType<typeof vi.fn>).mockReturnValue(entries);
      await invokeHandler('history:journeys', { query: 'test', limit: 10, offset: 0 });
      expect(mockQueryJourneys).toHaveBeenCalledWith(entries, { query: 'test', limit: 10, offset: 0 });
    });

    it('uses defaults when no payload provided', async () => {
      await invokeHandler('history:journeys');
      expect(mockQueryJourneys).toHaveBeenCalledWith(expect.any(Array), { query: '', limit: 50, offset: 0 });
    });
  });

  // ---------------------------------------------------------------------------
  // history:remove-cluster
  // ---------------------------------------------------------------------------

  describe('history:remove-cluster', () => {
    it('calls removeClusterEntries with store.getAll() and clusterId', async () => {
      const entries = [{ id: 'e1', url: 'https://a.com' }];
      (store.getAll as ReturnType<typeof vi.fn>).mockReturnValue(entries);
      await invokeHandler('history:remove-cluster', 'cluster-xyz');
      expect(mockRemoveClusterEntries).toHaveBeenCalledWith(entries, 'cluster-xyz');
    });

    it('returns 0 when no entries to remove', async () => {
      mockRemoveClusterEntries.mockReturnValue([]);
      const result = await invokeHandler('history:remove-cluster', 'empty-cluster');
      expect(result).toBe(0);
    });

    it('calls store.removeEntries and returns count when entries exist', async () => {
      mockRemoveClusterEntries.mockReturnValue(['e1', 'e2']);
      (store.removeEntries as ReturnType<typeof vi.fn>).mockReturnValue(2);
      const result = await invokeHandler('history:remove-cluster', 'cluster-123');
      expect(store.removeEntries).toHaveBeenCalledWith(['e1', 'e2']);
      expect(result).toBe(2);
    });
  });
});
