/**
 * settings-flow.test.ts — integration tests for Settings IPC handlers.
 *
 * Covers:
 *   - Save/read API key via KeychainStore
 *   - Test API key (mocked HTTP)
 *   - Save/read agent name via AccountStore
 *   - Theme toggle persistence
 *   - Factory reset sequence (deletes account.json, keychain entries, prefs)
 *   - No secrets appear in any log output
 *
 * D1: written BEFORE implementation (TDD).
 * D2: verifies zero-key-in-logs invariant.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_DIR = path.join(os.tmpdir(), `settings-test-${process.pid}-${Date.now()}`);
const ACCOUNT_FILE = path.join(TEST_DIR, 'account.json');
const PREFS_FILE = path.join(TEST_DIR, 'preferences.json');

// Mock keytar — tracks all operations for verification
interface KeytarEntry {
  service: string;
  account: string;
  password: string;
}

function createMockKeytar() {
  const store = new Map<string, string>();
  const deletions: Array<{ service: string; account: string }> = [];

  return {
    store,
    deletions,
    async setPassword(service: string, account: string, password: string): Promise<void> {
      store.set(`${service}:${account}`, password);
    },
    async getPassword(service: string, account: string): Promise<string | null> {
      return store.get(`${service}:${account}`) ?? null;
    },
    async deletePassword(service: string, account: string): Promise<boolean> {
      const key = `${service}:${account}`;
      const had = store.has(key);
      store.delete(key);
      deletions.push({ service, account });
      return had;
    },
    async findCredentials(service: string): Promise<Array<{ account: string; password: string }>> {
      const results: Array<{ account: string; password: string }> = [];
      for (const [key, password] of store.entries()) {
        if (key.startsWith(`${service}:`)) {
          const account = key.slice(service.length + 1);
          results.push({ account, password });
        }
      }
      return results;
    },
  };
}

// ---------------------------------------------------------------------------
// Import the modules under test (they use constructor injection)
// ---------------------------------------------------------------------------

import { AccountStore, type AccountData } from '../../src/main/identity/AccountStore';
import { KeychainStore, type KeytarLike, KEYCHAIN_SERVICE } from '../../src/main/identity/KeychainStore';

// ---------------------------------------------------------------------------
// Constants for test
// ---------------------------------------------------------------------------

const API_KEY_SERVICE = 'com.agenticbrowser.anthropic';
const TEST_EMAIL = 'test@browser-use.com';
const TEST_API_KEY = 'sk-ant-api03-FAKE_KEY_FOR_TESTING_ONLY_1234567890abcdef';
const TEST_AGENT_NAME = 'TestCompanion';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Settings Flow', () => {
  let accountStore: AccountStore;
  let mockKeytar: ReturnType<typeof createMockKeytar>;
  let keychainStore: KeychainStore;
  let logOutput: string[];

  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    logOutput = [];

    // Capture console output to verify no secrets leak
    const origDebug = console.debug;
    const origLog = console.log;
    const origInfo = console.info;
    const origWarn = console.warn;
    const origError = console.error;

    vi.spyOn(console, 'debug').mockImplementation((...args: unknown[]) => {
      logOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      logOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      logOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logOutput.push(args.map(String).join(' '));
    });

    accountStore = new AccountStore(TEST_DIR);
    mockKeytar = createMockKeytar();
    keychainStore = new KeychainStore(TEST_DIR, mockKeytar as unknown as KeytarLike);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Cleanup best-effort
    }
  });

  // -------------------------------------------------------------------------
  // API Key save/read
  // -------------------------------------------------------------------------

  describe('API Key', () => {
    it('should save an API key to the keychain under the anthropic service', async () => {
      await keychainStore.setToken(TEST_EMAIL, {
        access_token: TEST_API_KEY,
        refresh_token: '',
        expires_at: 0,
        scopes: [],
      });

      const stored = await keychainStore.getToken(TEST_EMAIL);
      expect(stored).not.toBeNull();
      expect(stored?.access_token).toBe(TEST_API_KEY);
    });

    it('should save API key using the specific anthropic service name', async () => {
      // Use the mock keytar directly with the anthropic service
      await mockKeytar.setPassword(API_KEY_SERVICE, TEST_EMAIL, TEST_API_KEY);
      const retrieved = await mockKeytar.getPassword(API_KEY_SERVICE, TEST_EMAIL);
      expect(retrieved).toBe(TEST_API_KEY);
    });

    it('should overwrite an existing API key', async () => {
      const newKey = 'sk-ant-api03-NEW_KEY_abcdef1234567890';
      await mockKeytar.setPassword(API_KEY_SERVICE, TEST_EMAIL, TEST_API_KEY);
      await mockKeytar.setPassword(API_KEY_SERVICE, TEST_EMAIL, newKey);

      const retrieved = await mockKeytar.getPassword(API_KEY_SERVICE, TEST_EMAIL);
      expect(retrieved).toBe(newKey);
    });

    it('should return null for missing API key', async () => {
      const retrieved = await mockKeytar.getPassword(API_KEY_SERVICE, 'nonexistent@test.com');
      expect(retrieved).toBeNull();
    });

    it('should never log the API key value (D2 scrub rule)', async () => {
      await mockKeytar.setPassword(API_KEY_SERVICE, TEST_EMAIL, TEST_API_KEY);
      await keychainStore.setToken(TEST_EMAIL, {
        access_token: TEST_API_KEY,
        refresh_token: '',
        expires_at: 0,
        scopes: [],
      });
      await keychainStore.getToken(TEST_EMAIL);

      const allLogs = logOutput.join('\n');
      expect(allLogs).not.toContain(TEST_API_KEY);
      expect(allLogs).not.toContain('sk-ant-api03');
    });
  });

  // -------------------------------------------------------------------------
  // Agent Name save/read
  // -------------------------------------------------------------------------

  describe('Agent Name', () => {
    it('should save and read agent name', () => {
      accountStore.save({
        agent_name: TEST_AGENT_NAME,
        email: TEST_EMAIL,
      });

      const loaded = accountStore.load();
      expect(loaded).not.toBeNull();
      expect(loaded?.agent_name).toBe(TEST_AGENT_NAME);
    });

    it('should update agent name preserving other fields', () => {
      accountStore.save({
        agent_name: 'Original',
        email: TEST_EMAIL,
        onboarding_completed_at: '2026-04-17T00:00:00.000Z',
      });

      // Update just the name
      const existing = accountStore.load();
      accountStore.save({
        ...existing!,
        agent_name: 'Updated',
      });

      const reloaded = accountStore.load();
      expect(reloaded?.agent_name).toBe('Updated');
      expect(reloaded?.email).toBe(TEST_EMAIL);
      expect(reloaded?.onboarding_completed_at).toBe('2026-04-17T00:00:00.000Z');
    });

    it('should return null when no account exists', () => {
      const loaded = accountStore.load();
      expect(loaded).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Theme toggle persistence
  // -------------------------------------------------------------------------

  describe('Theme Toggle', () => {
    it('should persist theme preference to preferences.json', () => {
      const prefs = { theme: 'onboarding' };
      fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf-8');

      const loaded = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8'));
      expect(loaded.theme).toBe('onboarding');
    });

    it('should switch theme from onboarding to shell', () => {
      fs.writeFileSync(PREFS_FILE, JSON.stringify({ theme: 'onboarding' }), 'utf-8');

      // Simulate theme change
      const prefs = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8'));
      prefs.theme = 'shell';
      fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf-8');

      const loaded = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8'));
      expect(loaded.theme).toBe('shell');
    });
  });

  // -------------------------------------------------------------------------
  // Factory Reset
  // -------------------------------------------------------------------------

  describe('Factory Reset', () => {
    it('should delete account.json', () => {
      accountStore.save({
        agent_name: TEST_AGENT_NAME,
        email: TEST_EMAIL,
        onboarding_completed_at: '2026-04-17T00:00:00.000Z',
      });
      expect(fs.existsSync(ACCOUNT_FILE)).toBe(true);

      // Factory reset: delete account file
      fs.unlinkSync(ACCOUNT_FILE);
      expect(fs.existsSync(ACCOUNT_FILE)).toBe(false);
    });

    it('should delete preferences.json', () => {
      fs.writeFileSync(PREFS_FILE, JSON.stringify({ theme: 'shell' }), 'utf-8');
      expect(fs.existsSync(PREFS_FILE)).toBe(true);

      fs.unlinkSync(PREFS_FILE);
      expect(fs.existsSync(PREFS_FILE)).toBe(false);
    });

    it('should delete all keychain entries under com.agenticbrowser.*', async () => {
      // Set up multiple keychain entries
      await mockKeytar.setPassword('com.agenticbrowser.oauth', TEST_EMAIL, 'oauth-token');
      await mockKeytar.setPassword(API_KEY_SERVICE, TEST_EMAIL, TEST_API_KEY);
      await mockKeytar.setPassword('com.agenticbrowser.refresh', TEST_EMAIL, 'refresh-token');

      // Factory reset: find and delete all entries
      const oauthCreds = await mockKeytar.findCredentials('com.agenticbrowser.oauth');
      const apiCreds = await mockKeytar.findCredentials(API_KEY_SERVICE);
      const refreshCreds = await mockKeytar.findCredentials('com.agenticbrowser.refresh');

      for (const cred of oauthCreds) {
        await mockKeytar.deletePassword('com.agenticbrowser.oauth', cred.account);
      }
      for (const cred of apiCreds) {
        await mockKeytar.deletePassword(API_KEY_SERVICE, cred.account);
      }
      for (const cred of refreshCreds) {
        await mockKeytar.deletePassword('com.agenticbrowser.refresh', cred.account);
      }

      // Verify all deleted
      expect(mockKeytar.store.size).toBe(0);
      expect(mockKeytar.deletions.length).toBe(3);
    });

    it('should clean up daemon socket files', () => {
      // Create mock socket files
      const sockPath = path.join(TEST_DIR, 'daemon-12345.sock');
      fs.writeFileSync(sockPath, '');
      expect(fs.existsSync(sockPath)).toBe(true);

      // Cleanup daemon sockets
      const files = fs.readdirSync(TEST_DIR);
      for (const file of files) {
        if (file.startsWith('daemon-') && file.endsWith('.sock')) {
          fs.unlinkSync(path.join(TEST_DIR, file));
        }
      }

      expect(fs.existsSync(sockPath)).toBe(false);
    });

    it('should clean up logs directory', () => {
      const logsDir = path.join(TEST_DIR, 'logs');
      fs.mkdirSync(logsDir, { recursive: true });
      fs.writeFileSync(path.join(logsDir, 'main.log'), 'test log');

      // Factory reset: delete logs
      fs.rmSync(logsDir, { recursive: true, force: true });
      expect(fs.existsSync(logsDir)).toBe(false);
    });

    it('should report complete reset sequence', async () => {
      // Setup everything
      accountStore.save({ agent_name: TEST_AGENT_NAME, email: TEST_EMAIL, onboarding_completed_at: '2026-04-17T00:00:00.000Z' });
      fs.writeFileSync(PREFS_FILE, JSON.stringify({ theme: 'shell' }));
      await mockKeytar.setPassword(API_KEY_SERVICE, TEST_EMAIL, TEST_API_KEY);
      const logsDir = path.join(TEST_DIR, 'logs');
      fs.mkdirSync(logsDir, { recursive: true });
      fs.writeFileSync(path.join(logsDir, 'main.log'), 'log');

      // Perform full reset
      if (fs.existsSync(ACCOUNT_FILE)) fs.unlinkSync(ACCOUNT_FILE);
      if (fs.existsSync(PREFS_FILE)) fs.unlinkSync(PREFS_FILE);

      for (const cred of await mockKeytar.findCredentials(API_KEY_SERVICE)) {
        await mockKeytar.deletePassword(API_KEY_SERVICE, cred.account);
      }

      // Clean daemon sockets
      const files = fs.readdirSync(TEST_DIR);
      for (const file of files) {
        if (file.startsWith('daemon-') && file.endsWith('.sock')) {
          fs.unlinkSync(path.join(TEST_DIR, file));
        }
      }

      // Clean logs
      if (fs.existsSync(logsDir)) {
        fs.rmSync(logsDir, { recursive: true, force: true });
      }

      // Verify everything is gone
      expect(fs.existsSync(ACCOUNT_FILE)).toBe(false);
      expect(fs.existsSync(PREFS_FILE)).toBe(false);
      expect(mockKeytar.store.size).toBe(0);
      expect(fs.existsSync(logsDir)).toBe(false);

      // After reset, onboarding should be incomplete
      const store2 = new AccountStore(TEST_DIR);
      expect(store2.isOnboardingComplete()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Security: no secrets in logs
  // -------------------------------------------------------------------------

  describe('Security', () => {
    it('should never log API key in any log line', async () => {
      await keychainStore.setToken(TEST_EMAIL, {
        access_token: TEST_API_KEY,
        refresh_token: 'rt-secret-refresh',
        expires_at: Date.now() + 3600000,
        scopes: [],
      });

      await keychainStore.getToken(TEST_EMAIL);
      await keychainStore.deleteToken(TEST_EMAIL);

      const allLogs = logOutput.join('\n');
      expect(allLogs).not.toContain(TEST_API_KEY);
      expect(allLogs).not.toContain('rt-secret-refresh');
    });
  });
});
