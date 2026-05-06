import Module from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const keytarMocks = vi.hoisted(() => ({
  getPassword: vi.fn(),
  setPassword: vi.fn(async () => undefined),
  deletePassword: vi.fn(async () => false),
}));

vi.mock('../../../src/main/logger', () => ({
  mainLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/main/identity/claudeCodeAuth', () => ({
  probeClaudeAuthStatus: vi.fn(async () => ({ loggedIn: false, subscriptionType: null })),
}));

const originalRequire = Module.prototype.require;

describe('authStore BrowserCode normalization', () => {
  afterEach(() => {
    Module.prototype.require = originalRequire;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('trims provider ids and active provider when loading the BrowserCode store blob', async () => {
    vi.resetModules();
    Module.prototype.require = function patchedRequire(this: NodeJS.Module, id: string) {
      if (id === 'keytar') return keytarMocks;
      return originalRequire.call(this, id);
    };
    keytarMocks.getPassword.mockResolvedValue(JSON.stringify({
      browserCode: {
        keys: {
          ' moonshotai ': {
            apiKey: '  secret-key  ',
            lastModel: ' moonshotai/kimi-k2.6 ',
          },
        },
        active: ' moonshotai ',
      },
    }));

    const authStore = await import('../../../src/main/identity/authStore');

    await expect(authStore.loadBrowserCodeStore()).resolves.toEqual({
      keys: {
        moonshotai: {
          apiKey: 'secret-key',
          lastModel: 'moonshotai/kimi-k2.6',
        },
      },
      active: 'moonshotai',
    });
    await expect(authStore.loadBrowserCodeConfig()).resolves.toEqual({
      providerId: 'moonshotai',
      model: 'moonshotai/kimi-k2.6',
      apiKey: 'secret-key',
    });
  });
});
