/**
 * agentApiKey unit tests.
 *
 * Tests cover:
 *   - Returns key from Keychain when keytarModule + accountEmail provided
 *   - Falls back to env when keytar returns null
 *   - Falls back to env when keytar throws
 *   - Returns env key when no keytarModule provided
 *   - Returns null when neither keytar nor env has a key
 *   - Keytar key takes priority over env key
 *   - API_KEY_KEYCHAIN_SERVICE constant value
 *   - Key value is never logged (only metadata)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { loggerSpy } = vi.hoisted(() => ({
  loggerSpy: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/main/logger', () => ({ mainLogger: loggerSpy }));

import { getApiKey, API_KEY_KEYCHAIN_SERVICE } from '../../src/main/agentApiKey';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCOUNT = 'user@example.com';
const KEYCHAIN_KEY = 'sk-ant-keychain-key';
const ENV_KEY = 'sk-ant-env-key';

function makeKeytar(key: string | null | Error) {
  return {
    getPassword: vi.fn(async () => {
      if (key instanceof Error) throw key;
      return key;
    }),
    setPassword: vi.fn(),
    deletePassword: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getApiKey()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe('Keychain source', () => {
    it('returns the key from Keychain when found', async () => {
      const keytar = makeKeytar(KEYCHAIN_KEY);
      const result = await getApiKey({ keytarModule: keytar, accountEmail: ACCOUNT });
      expect(result).toBe(KEYCHAIN_KEY);
    });

    it('queries the correct service and account', async () => {
      const keytar = makeKeytar(KEYCHAIN_KEY);
      await getApiKey({ keytarModule: keytar, accountEmail: ACCOUNT });
      expect(keytar.getPassword).toHaveBeenCalledWith(API_KEY_KEYCHAIN_SERVICE, ACCOUNT);
    });

    it('does not call keytar when accountEmail is missing', async () => {
      const keytar = makeKeytar(KEYCHAIN_KEY);
      process.env.ANTHROPIC_API_KEY = ENV_KEY;
      const result = await getApiKey({ keytarModule: keytar });
      expect(keytar.getPassword).not.toHaveBeenCalled();
      expect(result).toBe(ENV_KEY);
    });

    it('does not call keytar when keytarModule is missing', async () => {
      process.env.ANTHROPIC_API_KEY = ENV_KEY;
      const result = await getApiKey({ accountEmail: ACCOUNT });
      expect(result).toBe(ENV_KEY);
    });
  });

  describe('Environment variable fallback', () => {
    it('returns env key when keytar returns null', async () => {
      const keytar = makeKeytar(null);
      process.env.ANTHROPIC_API_KEY = ENV_KEY;
      const result = await getApiKey({ keytarModule: keytar, accountEmail: ACCOUNT });
      expect(result).toBe(ENV_KEY);
    });

    it('returns env key when keytar throws', async () => {
      const keytar = makeKeytar(new Error('Keychain locked'));
      process.env.ANTHROPIC_API_KEY = ENV_KEY;
      const result = await getApiKey({ keytarModule: keytar, accountEmail: ACCOUNT });
      expect(result).toBe(ENV_KEY);
    });

    it('returns env key when no keytar provided', async () => {
      process.env.ANTHROPIC_API_KEY = ENV_KEY;
      const result = await getApiKey();
      expect(result).toBe(ENV_KEY);
    });
  });

  describe('No key available', () => {
    it('returns null when neither keytar nor env has a key', async () => {
      const keytar = makeKeytar(null);
      const result = await getApiKey({ keytarModule: keytar, accountEmail: ACCOUNT });
      expect(result).toBeNull();
    });

    it('returns null with no options provided', async () => {
      const result = await getApiKey();
      expect(result).toBeNull();
    });

    it('logs a warning when no key is found', async () => {
      await getApiKey();
      expect(loggerSpy.warn).toHaveBeenCalledWith(
        'agentApiKey.getApiKey',
        expect.objectContaining({ source: 'none' }),
      );
    });
  });

  describe('Priority ordering', () => {
    it('keytar key takes priority over env key', async () => {
      const keytar = makeKeytar(KEYCHAIN_KEY);
      process.env.ANTHROPIC_API_KEY = ENV_KEY;
      const result = await getApiKey({ keytarModule: keytar, accountEmail: ACCOUNT });
      expect(result).toBe(KEYCHAIN_KEY);
    });
  });

  describe('Security: key value never logged', () => {
    it('does not log the key value from keytar', async () => {
      const keytar = makeKeytar(KEYCHAIN_KEY);
      await getApiKey({ keytarModule: keytar, accountEmail: ACCOUNT });
      const allLogs = [
        ...loggerSpy.info.mock.calls,
        ...loggerSpy.debug.mock.calls,
        ...loggerSpy.warn.mock.calls,
        ...loggerSpy.error.mock.calls,
      ].flat();
      for (const arg of allLogs) {
        expect(JSON.stringify(arg)).not.toContain(KEYCHAIN_KEY);
      }
    });

    it('does not log the env key value', async () => {
      process.env.ANTHROPIC_API_KEY = ENV_KEY;
      await getApiKey();
      const allLogs = [
        ...loggerSpy.info.mock.calls,
        ...loggerSpy.debug.mock.calls,
        ...loggerSpy.warn.mock.calls,
        ...loggerSpy.error.mock.calls,
      ].flat();
      for (const arg of allLogs) {
        expect(JSON.stringify(arg)).not.toContain(ENV_KEY);
      }
    });
  });

  describe('API_KEY_KEYCHAIN_SERVICE constant', () => {
    it('is the expected service name', () => {
      expect(API_KEY_KEYCHAIN_SERVICE).toBe('com.agenticbrowser.anthropic');
    });
  });
});
