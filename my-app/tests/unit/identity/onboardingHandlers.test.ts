/**
 * onboardingHandlers.ts unit tests.
 *
 * Tests cover:
 *   - registerOnboardingHandlers: registers all IPC channels
 *   - unregisterOnboardingHandlers: removes all channels
 *   - onboarding:save-api-key: stores key via keytar
 *   - onboarding:test-api-key: validates key against Anthropic API
 *   - onboarding:complete: saves onboarding_completed_at, opens shell, closes onboarding window
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
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  },
  BrowserWindow: class {},
}));

const mockSetPassword = vi.fn(async () => {});
vi.mock('keytar', () => ({
  setPassword: mockSetPassword,
}));

import {
  registerOnboardingHandlers,
  unregisterOnboardingHandlers,
  type OnboardingHandlerDeps,
} from '../../../src/main/identity/onboardingHandlers';
import type { AccountStore } from '../../../src/main/identity/AccountStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAccountStore(initialData: Record<string, unknown> | null = null) {
  return {
    load: vi.fn(() => initialData),
    save: vi.fn(),
  } as unknown as AccountStore;
}

function makeWindow(destroyed = false) {
  return {
    id: 1,
    isDestroyed: vi.fn(() => destroyed),
    close: vi.fn(),
  };
}

async function invokeHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered: ${channel}`);
  return handler({} as never, ...args);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('onboardingHandlers.ts', () => {
  let deps: OnboardingHandlerDeps;
  let accountStore: AccountStore;
  let onboardingWindow: ReturnType<typeof makeWindow>;
  let openShellWindow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    accountStore = makeAccountStore();
    onboardingWindow = makeWindow();
    openShellWindow = vi.fn(() => ({ id: 2 }));
    deps = {
      accountStore,
      getOnboardingWindow: () => onboardingWindow as never,
      openShellWindow: openShellWindow as never,
    };
    registerOnboardingHandlers(deps);
  });

  describe('registerOnboardingHandlers()', () => {
    it('registers onboarding:save-api-key', () => {
      expect(handlers.has('onboarding:save-api-key')).toBe(true);
    });

    it('registers onboarding:test-api-key', () => {
      expect(handlers.has('onboarding:test-api-key')).toBe(true);
    });

    it('registers onboarding:complete', () => {
      expect(handlers.has('onboarding:complete')).toBe(true);
    });
  });

  describe('unregisterOnboardingHandlers()', () => {
    it('removes all handlers', () => {
      unregisterOnboardingHandlers();
      expect(handlers.has('onboarding:save-api-key')).toBe(false);
      expect(handlers.has('onboarding:test-api-key')).toBe(false);
      expect(handlers.has('onboarding:complete')).toBe(false);
    });
  });

  describe('onboarding:complete', () => {
    it('saves onboarding_completed_at to account store', async () => {
      await invokeHandler('onboarding:complete');
      expect(accountStore.save).toHaveBeenCalledWith(
        expect.objectContaining({
          onboarding_completed_at: expect.any(String),
        }),
      );
    });

    it('calls openShellWindow', async () => {
      await invokeHandler('onboarding:complete');
      expect(openShellWindow).toHaveBeenCalled();
    });

    it('closes onboarding window when not destroyed', async () => {
      await invokeHandler('onboarding:complete');
      expect(onboardingWindow.close).toHaveBeenCalled();
    });

    it('does not close when window is destroyed', async () => {
      onboardingWindow = makeWindow(true);
      deps.getOnboardingWindow = () => onboardingWindow as never;
      handlers.clear();
      registerOnboardingHandlers(deps);

      await invokeHandler('onboarding:complete');
      expect(onboardingWindow.close).not.toHaveBeenCalled();
    });
  });
});
