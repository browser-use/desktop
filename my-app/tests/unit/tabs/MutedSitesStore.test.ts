/**
 * MutedSitesStore unit tests.
 *
 * Tests cover:
 *   - isMutedOrigin / isMutedUrl query behaviour
 *   - muteOrigin / unmuteOrigin / toggleOrigin mutations
 *   - listMutedOrigins returns current set
 *   - Persistence round-trip via flushSync
 *   - Invalid JSON / missing file / wrong version starts fresh
 *   - isMutedUrl handling of data: and about: protocols
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { loggerSpy, mockApp } = vi.hoisted(() => ({
  loggerSpy: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockApp: { getPath: vi.fn(() => os.tmpdir()) },
}));

vi.mock('electron', () => ({ app: mockApp }));
vi.mock('../../../src/main/logger', () => ({ mainLogger: loggerSpy }));

import { MutedSitesStore } from '../../../src/main/tabs/MutedSitesStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutedsitesstore-'));
  mockApp.getPath.mockReturnValue(tmpDir);
  vi.clearAllMocks();
});

function newStore(): MutedSitesStore {
  return new MutedSitesStore();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MutedSitesStore', () => {
  describe('isMutedOrigin', () => {
    it('returns false for an unknown origin', () => {
      const store = newStore();
      expect(store.isMutedOrigin('https://example.com')).toBe(false);
    });

    it('returns true after muteOrigin', () => {
      const store = newStore();
      store.muteOrigin('https://example.com');
      expect(store.isMutedOrigin('https://example.com')).toBe(true);
    });

    it('returns false after unmuteOrigin', () => {
      const store = newStore();
      store.muteOrigin('https://example.com');
      store.unmuteOrigin('https://example.com');
      expect(store.isMutedOrigin('https://example.com')).toBe(false);
    });
  });

  describe('isMutedUrl', () => {
    it('returns false for an unknown URL', () => {
      const store = newStore();
      expect(store.isMutedUrl('https://example.com/page')).toBe(false);
    });

    it('returns true when the origin is muted', () => {
      const store = newStore();
      store.muteOrigin('https://example.com');
      expect(store.isMutedUrl('https://example.com/page?q=1')).toBe(true);
    });

    it('matches origin regardless of path/query', () => {
      const store = newStore();
      store.muteOrigin('https://example.com');
      expect(store.isMutedUrl('https://example.com/other/path')).toBe(true);
    });

    it('does NOT match a different subdomain', () => {
      const store = newStore();
      store.muteOrigin('https://example.com');
      expect(store.isMutedUrl('https://sub.example.com/')).toBe(false);
    });

    it('returns false for data: URLs', () => {
      const store = newStore();
      expect(store.isMutedUrl('data:text/html,hello')).toBe(false);
    });

    it('returns false for about:blank', () => {
      const store = newStore();
      expect(store.isMutedUrl('about:blank')).toBe(false);
    });

    it('returns false for invalid URLs', () => {
      const store = newStore();
      expect(store.isMutedUrl('not a url')).toBe(false);
    });
  });

  describe('muteOrigin', () => {
    it('adds the origin to the muted set', () => {
      const store = newStore();
      store.muteOrigin('https://noisy.com');
      expect(store.isMutedOrigin('https://noisy.com')).toBe(true);
    });

    it('is idempotent when origin is already muted', () => {
      const store = newStore();
      store.muteOrigin('https://noisy.com');
      store.muteOrigin('https://noisy.com');
      expect(store.listMutedOrigins()).toHaveLength(1);
    });
  });

  describe('unmuteOrigin', () => {
    it('removes the origin from the muted set', () => {
      const store = newStore();
      store.muteOrigin('https://noisy.com');
      store.unmuteOrigin('https://noisy.com');
      expect(store.isMutedOrigin('https://noisy.com')).toBe(false);
    });

    it('is idempotent when origin is not muted', () => {
      const store = newStore();
      expect(() => store.unmuteOrigin('https://quiet.com')).not.toThrow();
    });
  });

  describe('toggleOrigin', () => {
    it('mutes an unmuted origin and returns true', () => {
      const store = newStore();
      const result = store.toggleOrigin('https://example.com');
      expect(result).toBe(true);
      expect(store.isMutedOrigin('https://example.com')).toBe(true);
    });

    it('unmutes a muted origin and returns false', () => {
      const store = newStore();
      store.muteOrigin('https://example.com');
      const result = store.toggleOrigin('https://example.com');
      expect(result).toBe(false);
      expect(store.isMutedOrigin('https://example.com')).toBe(false);
    });
  });

  describe('listMutedOrigins', () => {
    it('returns empty array on fresh store', () => {
      const store = newStore();
      expect(store.listMutedOrigins()).toEqual([]);
    });

    it('returns all muted origins', () => {
      const store = newStore();
      store.muteOrigin('https://a.com');
      store.muteOrigin('https://b.com');
      const list = store.listMutedOrigins();
      expect(list).toHaveLength(2);
      expect(list).toContain('https://a.com');
      expect(list).toContain('https://b.com');
    });

    it('does not include unmuted origins', () => {
      const store = newStore();
      store.muteOrigin('https://a.com');
      store.muteOrigin('https://b.com');
      store.unmuteOrigin('https://a.com');
      expect(store.listMutedOrigins()).toEqual(['https://b.com']);
    });
  });

  describe('persistence', () => {
    it('persists and reloads muted origins via flushSync', () => {
      const store = newStore();
      store.muteOrigin('https://a.com');
      store.muteOrigin('https://b.com');
      store.flushSync();

      const reloaded = newStore();
      expect(reloaded.listMutedOrigins()).toHaveLength(2);
      expect(reloaded.isMutedOrigin('https://a.com')).toBe(true);
      expect(reloaded.isMutedOrigin('https://b.com')).toBe(true);
    });

    it('unmuted origins are not in reloaded store', () => {
      const store = newStore();
      store.muteOrigin('https://a.com');
      store.muteOrigin('https://b.com');
      store.unmuteOrigin('https://a.com');
      store.flushSync();

      const reloaded = newStore();
      expect(reloaded.isMutedOrigin('https://a.com')).toBe(false);
      expect(reloaded.isMutedOrigin('https://b.com')).toBe(true);
    });

    it('starts fresh when file does not exist', () => {
      const store = newStore();
      expect(store.listMutedOrigins()).toEqual([]);
    });

    it('starts fresh with invalid JSON', () => {
      const filePath = path.join(tmpDir, 'muted-sites.json');
      fs.writeFileSync(filePath, '{ not valid json }', 'utf-8');
      const store = newStore();
      expect(store.listMutedOrigins()).toEqual([]);
    });

    it('starts fresh when version is wrong', () => {
      const filePath = path.join(tmpDir, 'muted-sites.json');
      fs.writeFileSync(filePath, JSON.stringify({ version: 99, origins: ['https://a.com'] }), 'utf-8');
      const store = newStore();
      expect(store.listMutedOrigins()).toEqual([]);
      expect(loggerSpy.warn).toHaveBeenCalledWith('MutedSitesStore.load.invalid', expect.any(Object));
    });
  });
});
