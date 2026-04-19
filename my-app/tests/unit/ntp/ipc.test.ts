/**
 * ntp/ipc.ts unit tests.
 *
 * Tests cover:
 *   - registerNtpHandlers: registers all expected IPC channels
 *   - unregisterNtpHandlers: removes all channels, clears store
 *   - ntp:get-customization: delegates to store.load()
 *   - ntp:set-customization: delegates to store.save(), broadcasts
 *   - ntp:reset-customization: delegates to store.reset(), broadcasts
 *   - ntp:add-shortcut: validates, creates shortcut, broadcasts
 *   - ntp:edit-shortcut: updates matching shortcut, broadcasts
 *   - ntp:delete-shortcut: removes matching shortcut, broadcasts
 *   - broadcast: notifyShell and notifyNewTab are both called
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
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
  },
}));

import {
  registerNtpHandlers,
  unregisterNtpHandlers,
  type RegisterNtpHandlersOptions,
} from '../../../src/main/ntp/ipc';
import type { NtpCustomizationStore, NtpCustomization } from '../../../src/main/ntp/NtpCustomizationStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CUSTOMIZATION: NtpCustomization = {
  backgroundType: 'default',
  backgroundColor: '#202124',
  backgroundImageDataUrl: '',
  accentColor: '#6D8196',
  colorScheme: 'system',
  shortcutMode: 'most-visited',
  shortcutsVisible: true,
  customShortcuts: [],
  cardsVisible: true,
};

function makeStore(data: NtpCustomization = { ...BASE_CUSTOMIZATION }) {
  return {
    load: vi.fn(() => ({ ...data })),
    save: vi.fn((patch: Partial<NtpCustomization>) => ({ ...data, ...patch })),
    reset: vi.fn(() => ({ ...BASE_CUSTOMIZATION })),
  } as unknown as NtpCustomizationStore;
}

async function invokeHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler: ${channel}`);
  return handler({} as never, ...args);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ntp/ipc.ts', () => {
  let store: ReturnType<typeof makeStore>;
  let notifyShell: ReturnType<typeof vi.fn>;
  let notifyNewTab: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    store = makeStore();
    notifyShell = vi.fn();
    notifyNewTab = vi.fn();
    const opts: RegisterNtpHandlersOptions = {
      store: store as unknown as NtpCustomizationStore,
      notifyShell: notifyShell as unknown as (data: NtpCustomization) => void,
      notifyNewTab: notifyNewTab as unknown as (data: NtpCustomization) => void,
    };
    registerNtpHandlers(opts);
  });

  // ---------------------------------------------------------------------------
  // Registration / unregistration
  // ---------------------------------------------------------------------------

  describe('registerNtpHandlers()', () => {
    const CHANNELS = [
      'ntp:get-customization', 'ntp:set-customization', 'ntp:reset-customization',
      'ntp:add-shortcut', 'ntp:edit-shortcut', 'ntp:delete-shortcut',
      'ntp:pick-background-image',
    ];

    for (const ch of CHANNELS) {
      it(`registers ${ch}`, () => {
        expect(handlers.has(ch)).toBe(true);
      });
    }
  });

  describe('unregisterNtpHandlers()', () => {
    it('removes all channels', () => {
      unregisterNtpHandlers();
      expect(handlers.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // ntp:get-customization
  // ---------------------------------------------------------------------------

  describe('ntp:get-customization', () => {
    it('returns result from store.load()', async () => {
      const data = { ...BASE_CUSTOMIZATION, colorScheme: 'dark' as const };
      (store.load as ReturnType<typeof vi.fn>).mockReturnValue(data);
      const result = await invokeHandler('ntp:get-customization');
      expect(result).toEqual(data);
    });
  });

  // ---------------------------------------------------------------------------
  // ntp:set-customization
  // ---------------------------------------------------------------------------

  describe('ntp:set-customization', () => {
    it('calls store.save with the patch', async () => {
      await invokeHandler('ntp:set-customization', { colorScheme: 'dark' });
      expect(store.save).toHaveBeenCalledWith({ colorScheme: 'dark' });
    });

    it('broadcasts the result to notifyShell and notifyNewTab', async () => {
      const saved = { ...BASE_CUSTOMIZATION, colorScheme: 'dark' as const };
      (store.save as ReturnType<typeof vi.fn>).mockReturnValue(saved);
      await invokeHandler('ntp:set-customization', { colorScheme: 'dark' });
      expect(notifyShell).toHaveBeenCalledWith(saved);
      expect(notifyNewTab).toHaveBeenCalledWith(saved);
    });

    it('returns the saved customization', async () => {
      const saved = { ...BASE_CUSTOMIZATION, shortcutsVisible: false };
      (store.save as ReturnType<typeof vi.fn>).mockReturnValue(saved);
      const result = await invokeHandler('ntp:set-customization', { shortcutsVisible: false });
      expect(result).toEqual(saved);
    });
  });

  // ---------------------------------------------------------------------------
  // ntp:reset-customization
  // ---------------------------------------------------------------------------

  describe('ntp:reset-customization', () => {
    it('calls store.reset()', async () => {
      await invokeHandler('ntp:reset-customization');
      expect(store.reset).toHaveBeenCalled();
    });

    it('broadcasts the reset data', async () => {
      await invokeHandler('ntp:reset-customization');
      expect(notifyShell).toHaveBeenCalledWith(BASE_CUSTOMIZATION);
    });
  });

  // ---------------------------------------------------------------------------
  // ntp:add-shortcut
  // ---------------------------------------------------------------------------

  describe('ntp:add-shortcut', () => {
    it('calls store.save with a new shortcut appended', async () => {
      await invokeHandler('ntp:add-shortcut', { name: 'Google', url: 'https://google.com' });
      expect(store.save).toHaveBeenCalledWith(
        expect.objectContaining({
          customShortcuts: expect.arrayContaining([
            expect.objectContaining({ name: 'Google', url: 'https://google.com' }),
          ]),
        }),
      );
    });

    it('generates a unique id for the new shortcut', async () => {
      (store.save as ReturnType<typeof vi.fn>).mockImplementation((patch: Partial<NtpCustomization>) => ({
        ...BASE_CUSTOMIZATION,
        ...patch,
      }));
      const result = await invokeHandler('ntp:add-shortcut', { name: 'G', url: 'https://g.com' }) as NtpCustomization;
      expect(result.customShortcuts[0].id).toMatch(/^sc_/);
    });

    it('broadcasts after adding', async () => {
      await invokeHandler('ntp:add-shortcut', { name: 'G', url: 'https://g.com' });
      expect(notifyShell).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // ntp:edit-shortcut
  // ---------------------------------------------------------------------------

  describe('ntp:edit-shortcut', () => {
    it('updates the matching shortcut by id', async () => {
      const initial: NtpCustomization = {
        ...BASE_CUSTOMIZATION,
        customShortcuts: [{ id: 'sc_1', name: 'Old', url: 'https://old.com' }],
      };
      (store.load as ReturnType<typeof vi.fn>).mockReturnValue(initial);
      await invokeHandler('ntp:edit-shortcut', { id: 'sc_1', name: 'New', url: 'https://new.com' });
      expect(store.save).toHaveBeenCalledWith(
        expect.objectContaining({
          customShortcuts: [{ id: 'sc_1', name: 'New', url: 'https://new.com' }],
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // ntp:delete-shortcut
  // ---------------------------------------------------------------------------

  describe('ntp:delete-shortcut', () => {
    it('removes the matching shortcut by id', async () => {
      const initial: NtpCustomization = {
        ...BASE_CUSTOMIZATION,
        customShortcuts: [
          { id: 'sc_1', name: 'A', url: 'https://a.com' },
          { id: 'sc_2', name: 'B', url: 'https://b.com' },
        ],
      };
      (store.load as ReturnType<typeof vi.fn>).mockReturnValue(initial);
      await invokeHandler('ntp:delete-shortcut', 'sc_1');
      expect(store.save).toHaveBeenCalledWith(
        expect.objectContaining({
          customShortcuts: [{ id: 'sc_2', name: 'B', url: 'https://b.com' }],
        }),
      );
    });

    it('broadcasts after delete', async () => {
      (store.load as ReturnType<typeof vi.fn>).mockReturnValue({ ...BASE_CUSTOMIZATION, customShortcuts: [] });
      await invokeHandler('ntp:delete-shortcut', 'sc_1');
      expect(notifyShell).toHaveBeenCalled();
    });
  });
});
