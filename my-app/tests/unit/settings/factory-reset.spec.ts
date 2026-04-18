/**
 * FactoryResetController unit tests — Issues #217 + #225.
 *
 * The `settings:factory-reset` handler previously wiped only account.json,
 * preferences.json, a few keytar entries, daemon sockets, and logs/ while the
 * settings UI advertised "permanently delete all data". These tests lock in
 * the fixed behaviour: every app-local store is wiped through its public API
 * AND every app-local JSON file, every safeStorage `*.oauth-tokens.enc`
 * fallback, the per-profile `<userData>/profiles/` tree, daemon sockets, and
 * the logs/ directory are unlinked.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — logger, keytar (we inject a stub instead of hitting the real one).
// ---------------------------------------------------------------------------

vi.mock('../../../src/main/logger', () => ({
  mainLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  performFactoryReset,
  type FactoryResetStores,
} from '../../../src/main/settings/FactoryResetController';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeTempUserData(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-reset-test-'));
  return dir;
}

function touch(filePath: string, contents = '{}'): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf-8');
}

/**
 * Write every file + directory that the factory reset is expected to wipe,
 * plus a control file that must survive. Returns the user-data root.
 */
function seedUserData(): { userData: string; controlFile: string } {
  const userData = makeTempUserData();
  // App-local store JSONs (Issue #217 + #225)
  touch(path.join(userData, 'bookmarks.json'), '{"version":1,"roots":[]}');
  touch(path.join(userData, 'history.json'), '{"version":1,"entries":[]}');
  touch(path.join(userData, 'passwords.json'), '{"version":1,"credentials":[]}');
  touch(path.join(userData, 'autofill.json'), '{"version":1,"addresses":[],"cards":[]}');
  touch(path.join(userData, 'permissions.json'), '{"version":1,"records":[]}');
  touch(path.join(userData, 'granted-devices.json'), '{"version":1,"devices":[]}');
  touch(path.join(userData, 'content-categories.json'), '{"version":1,"overrides":[]}');
  // Identity + prefs
  touch(path.join(userData, 'account.json'), '{"email":"u@example.com"}');
  touch(path.join(userData, 'preferences.json'), '{"theme":"shell"}');
  // safeStorage OAuth fallback files (Issue #217)
  touch(path.join(userData, 'user@example.com.oauth-tokens.enc'), 'encrypted-payload');
  touch(path.join(userData, 'other_user.oauth-tokens.enc'), 'encrypted-payload-2');
  // Per-profile dirs (Issue #225)
  touch(path.join(userData, 'profiles', 'alice', 'bookmarks.json'), '{}');
  touch(path.join(userData, 'profiles', 'alice', 'history.json'), '{}');
  touch(path.join(userData, 'profiles', 'bob', 'permissions.json'), '{}');
  // Daemon sockets
  touch(path.join(userData, 'daemon-abc.sock'), '');
  // Logs dir
  touch(path.join(userData, 'logs', 'main.log'), 'log-line');
  // Control file — must NOT be removed (factory reset should not wipe
  // everything under userData, only the enumerated targets).
  const controlFile = path.join(userData, 'unrelated.dat');
  touch(controlFile, 'keep-me');

  return { userData, controlFile };
}

function makeStores(): {
  stores: Required<FactoryResetStores>;
  spies: Record<string, ReturnType<typeof vi.fn>>;
} {
  const spies = {
    bookmarksDeleteAll:            vi.fn(),
    historyClearAll:               vi.fn(),
    passwordsDeleteAll:            vi.fn(),
    autofillDeleteAll:             vi.fn(),
    permissionsReset:              vi.fn(),
    devicesRevokeAll:              vi.fn(),
    contentCategoriesReset:        vi.fn(),
  };

  return {
    spies,
    stores: {
      bookmarkStore:        { deleteAll:               spies.bookmarksDeleteAll },
      historyStore:         { clearAll:                spies.historyClearAll },
      passwordStore:        { deleteAllPasswords:      spies.passwordsDeleteAll },
      autofillStore:        { deleteAll:               spies.autofillDeleteAll },
      permissionStore:      { resetAllSitePermissions: spies.permissionsReset },
      deviceStore:          { revokeAll:               spies.devicesRevokeAll },
      contentCategoryStore: { resetAllOverrides:       spies.contentCategoriesReset },
    },
  };
}

function makeKeytarStub(): {
  keytar: {
    findCredentials: ReturnType<typeof vi.fn>;
    deletePassword: ReturnType<typeof vi.fn>;
  };
  calls: Array<{ service: string; account: string }>;
} {
  const calls: Array<{ service: string; account: string }> = [];
  return {
    calls,
    keytar: {
      findCredentials: vi.fn(async (service: string) => {
        if (service === 'com.agenticbrowser.oauth') {
          return [{ account: 'user@example.com' }, { account: 'second@example.com' }];
        }
        if (service === 'com.agenticbrowser.anthropic') {
          return [{ account: 'default' }];
        }
        if (service === 'com.agenticbrowser.refresh') {
          return [];
        }
        return [];
      }),
      deletePassword: vi.fn(async (service: string, account: string) => {
        calls.push({ service, account });
        return true;
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('performFactoryReset', () => {
  let tempRoots: string[] = [];

  beforeEach(() => {
    tempRoots = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const dir of tempRoots) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch { /* best effort */ }
    }
  });

  function seed(): { userData: string; controlFile: string } {
    const seeded = seedUserData();
    tempRoots.push(seeded.userData);
    return seeded;
  }

  // -------------------------------------------------------------------------
  // Issue #217 — app-local stores + safeStorage fallbacks
  // -------------------------------------------------------------------------

  it('invokes deleteAll/clearAll on every provided app-local store', async () => {
    const { userData } = seed();
    const { stores, spies } = makeStores();
    const { keytar } = makeKeytarStub();

    await performFactoryReset({ userDataPath: userData, stores, keytar: keytar as never });

    expect(spies.bookmarksDeleteAll).toHaveBeenCalledTimes(1);
    expect(spies.historyClearAll).toHaveBeenCalledTimes(1);
    expect(spies.passwordsDeleteAll).toHaveBeenCalledTimes(1);
    expect(spies.autofillDeleteAll).toHaveBeenCalledTimes(1);
    expect(spies.permissionsReset).toHaveBeenCalledTimes(1);
    expect(spies.devicesRevokeAll).toHaveBeenCalledTimes(1);
    expect(spies.contentCategoriesReset).toHaveBeenCalledTimes(1);
  });

  it('unlinks every app-local JSON file (Issue #217 + #225)', async () => {
    const { userData } = seed();
    const { stores } = makeStores();
    const { keytar } = makeKeytarStub();

    await performFactoryReset({ userDataPath: userData, stores, keytar: keytar as never });

    const expectedGone = [
      'bookmarks.json',
      'history.json',
      'passwords.json',
      'autofill.json',
      'permissions.json',
      'granted-devices.json',
      'content-categories.json',
      'account.json',
      'preferences.json',
    ];
    for (const name of expectedGone) {
      expect(fs.existsSync(path.join(userData, name))).toBe(false);
    }
  });

  it('removes every *.oauth-tokens.enc safeStorage fallback file', async () => {
    const { userData } = seed();
    const { stores } = makeStores();
    const { keytar } = makeKeytarStub();

    await performFactoryReset({ userDataPath: userData, stores, keytar: keytar as never });

    expect(fs.existsSync(path.join(userData, 'user@example.com.oauth-tokens.enc'))).toBe(false);
    expect(fs.existsSync(path.join(userData, 'other_user.oauth-tokens.enc'))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Issue #225 — profile dirs
  // -------------------------------------------------------------------------

  it('rm -rfs the per-profile <userData>/profiles/ tree (Issue #225)', async () => {
    const { userData } = seed();
    const { stores } = makeStores();
    const { keytar } = makeKeytarStub();

    // sanity: seeded dirs exist before the reset
    expect(fs.existsSync(path.join(userData, 'profiles', 'alice'))).toBe(true);
    expect(fs.existsSync(path.join(userData, 'profiles', 'bob'))).toBe(true);

    await performFactoryReset({ userDataPath: userData, stores, keytar: keytar as never });

    expect(fs.existsSync(path.join(userData, 'profiles'))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Existing wipe surface still works
  // -------------------------------------------------------------------------

  it('still removes daemon-*.sock files and the logs/ directory', async () => {
    const { userData } = seed();
    const { stores } = makeStores();
    const { keytar } = makeKeytarStub();

    await performFactoryReset({ userDataPath: userData, stores, keytar: keytar as never });

    expect(fs.existsSync(path.join(userData, 'daemon-abc.sock'))).toBe(false);
    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false);
  });

  it('deletes every keychain entry under com.agenticbrowser.* via the keytar stub', async () => {
    const { userData } = seed();
    const { stores } = makeStores();
    const { keytar, calls } = makeKeytarStub();

    await performFactoryReset({ userDataPath: userData, stores, keytar: keytar as never });

    // 2 from oauth + 1 from anthropic + 0 from refresh.
    expect(calls).toEqual(
      expect.arrayContaining([
        { service: 'com.agenticbrowser.oauth',     account: 'user@example.com' },
        { service: 'com.agenticbrowser.oauth',     account: 'second@example.com' },
        { service: 'com.agenticbrowser.anthropic', account: 'default' },
      ]),
    );
    expect(calls.length).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Safety invariants
  // -------------------------------------------------------------------------

  it('preserves unrelated files inside <userData> (does not rm -rf the whole dir)', async () => {
    const { userData, controlFile } = seed();
    const { stores } = makeStores();
    const { keytar } = makeKeytarStub();

    await performFactoryReset({ userDataPath: userData, stores, keytar: keytar as never });

    expect(fs.existsSync(controlFile)).toBe(true);
    expect(fs.readFileSync(controlFile, 'utf-8')).toBe('keep-me');
  });

  it('still succeeds when no stores are provided (backward-compat with settings-standalone)', async () => {
    const { userData } = seed();
    const { keytar } = makeKeytarStub();

    const result = await performFactoryReset({ userDataPath: userData, keytar: keytar as never });

    expect(result.success).toBe(true);
    // File wipes still ran.
    expect(fs.existsSync(path.join(userData, 'bookmarks.json'))).toBe(false);
    expect(fs.existsSync(path.join(userData, 'profiles'))).toBe(false);
  });

  it('collects errors from an individual failing store without aborting the reset', async () => {
    const { userData } = seed();
    const { stores, spies } = makeStores();
    const { keytar } = makeKeytarStub();

    spies.bookmarksDeleteAll.mockImplementation(() => {
      throw new Error('simulated disk failure');
    });

    const result = await performFactoryReset({ userDataPath: userData, stores, keytar: keytar as never });

    // Other store wipes still ran.
    expect(spies.historyClearAll).toHaveBeenCalledTimes(1);
    expect(spies.passwordsDeleteAll).toHaveBeenCalledTimes(1);
    expect(spies.autofillDeleteAll).toHaveBeenCalledTimes(1);
    expect(spies.permissionsReset).toHaveBeenCalledTimes(1);
    expect(spies.devicesRevokeAll).toHaveBeenCalledTimes(1);
    expect(spies.contentCategoriesReset).toHaveBeenCalledTimes(1);

    // File wipes still ran.
    expect(fs.existsSync(path.join(userData, 'profiles'))).toBe(false);

    // Error was surfaced rather than swallowed silently.
    expect(result.errors.some((msg) => msg.includes('bookmarks'))).toBe(true);
    // The reset itself still completed.
    expect(result.success).toBe(true);
  });

  it('does not throw when <userData>/profiles/ is absent (fresh install reset)', async () => {
    const userData = makeTempUserData();
    tempRoots.push(userData);
    touch(path.join(userData, 'preferences.json'), '{}');
    const { keytar } = makeKeytarStub();

    const result = await performFactoryReset({ userDataPath: userData, keytar: keytar as never });
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
