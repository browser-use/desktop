/**
 * chrome/ipc unit tests.
 *
 * Tests cover:
 *   - ensureNetworkTargets: builds initial list from getAnnouncedCdpPort
 *   - ensureNetworkTargets: falls back to DEFAULT_CDP_PORT when announced port is 0
 *   - __resetNetworkTargetsForTests: clears cached targets so next access re-initialises
 *   - chrome:inspect-get-network-targets handler: returns current target list
 *   - chrome:inspect-add-target handler: adds host:port, deduplicates, returns updated list
 *   - chrome:inspect-remove-target handler: removes host:port by match, no-op when absent
 *   - chrome:version-info handler: returns version fields from app.* methods
 *   - chrome:accessibility-info handler: returns accessibilitySupportEnabled flag
 *   - chrome:sandbox-info handler: returns sandboxed/contextIsolated/nodeIntegration
 *   - chrome:open-page handler: routes 'settings' / 'extensions' / other to correct callbacks
 *   - registerChromeHandlers: registers all expected IPC channels
 *   - unregisterChromeHandlers: removes all channels
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { loggerSpy } = vi.hoisted(() => ({
  loggerSpy: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/main/logger', () => ({ mainLogger: loggerSpy }));

// Capture ipcMain handlers for direct invocation in tests
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'Browser'),
    getVersion: vi.fn(() => '1.2.3'),
    getGPUInfo: vi.fn(async () => ({ gpuDevice: [] })),
    accessibilitySupportEnabled: false,
    getPath: vi.fn((p: string) => `/test/path/${p}`),
    getLocale: vi.fn(() => 'en-US'),
    getSystemVersion: vi.fn(() => '14.0'),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  },
}));

const { mockGetAnnouncedCdpPort, mockDefaultCdpPort } = vi.hoisted(() => ({
  mockGetAnnouncedCdpPort: vi.fn(() => 9222),
  mockDefaultCdpPort: 9222,
}));

vi.mock('../../../src/main/startup/cli', () => ({
  getAnnouncedCdpPort: mockGetAnnouncedCdpPort,
  DEFAULT_CDP_PORT: mockDefaultCdpPort,
}));

import {
  registerChromeHandlers,
  unregisterChromeHandlers,
  __resetNetworkTargetsForTests,
} from '../../../src/main/chrome/ipc';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function invokeHandler(channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  return handler({} /* event */, ...args);
}

function makeCallbacks() {
  return {
    openInternalPage: vi.fn(),
    openSettingsWindow: vi.fn(),
    openExtensionsWindow: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('chrome/ipc', () => {
  let cbs: ReturnType<typeof makeCallbacks>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    __resetNetworkTargetsForTests();
    mockGetAnnouncedCdpPort.mockReturnValue(9222);
    // process.getSystemVersion is Electron-specific; stub it for Node.js test env
    (process as unknown as Record<string, unknown>).getSystemVersion = vi.fn(() => '14.0');
    cbs = makeCallbacks();
    registerChromeHandlers(cbs.openInternalPage, cbs.openSettingsWindow, cbs.openExtensionsWindow);
  });

  // ---------------------------------------------------------------------------
  // registerChromeHandlers / unregisterChromeHandlers
  // ---------------------------------------------------------------------------

  describe('registerChromeHandlers()', () => {
    it('registers all expected IPC channels', () => {
      expect(handlers.has('chrome:version-info')).toBe(true);
      expect(handlers.has('chrome:gpu-info')).toBe(true);
      expect(handlers.has('chrome:accessibility-info')).toBe(true);
      expect(handlers.has('chrome:sandbox-info')).toBe(true);
      expect(handlers.has('chrome:open-page')).toBe(true);
      expect(handlers.has('chrome:inspect-targets')).toBe(true);
      expect(handlers.has('chrome:inspect-add-target')).toBe(true);
      expect(handlers.has('chrome:inspect-remove-target')).toBe(true);
      expect(handlers.has('chrome:inspect-get-network-targets')).toBe(true);
    });
  });

  describe('unregisterChromeHandlers()', () => {
    it('removes all registered channels', () => {
      unregisterChromeHandlers();
      expect(handlers.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Network targets — initial state
  // ---------------------------------------------------------------------------

  describe('network targets — initial state', () => {
    it('initialises with [{ host: localhost, port: announcedCdpPort }]', () => {
      mockGetAnnouncedCdpPort.mockReturnValue(9333);
      __resetNetworkTargetsForTests();
      registerChromeHandlers(cbs.openInternalPage, cbs.openSettingsWindow, cbs.openExtensionsWindow);

      const result = invokeHandler('chrome:inspect-get-network-targets') as { host: string; port: number }[];
      expect(result).toEqual([{ host: 'localhost', port: 9333 }]);
    });

    it('falls back to DEFAULT_CDP_PORT when announced port is 0', () => {
      mockGetAnnouncedCdpPort.mockReturnValue(0);
      __resetNetworkTargetsForTests();
      registerChromeHandlers(cbs.openInternalPage, cbs.openSettingsWindow, cbs.openExtensionsWindow);

      const result = invokeHandler('chrome:inspect-get-network-targets') as { host: string; port: number }[];
      expect(result[0].port).toBe(9222);
    });

    it('__resetNetworkTargetsForTests re-initialises on next access', () => {
      // First access — populates with port 9222
      invokeHandler('chrome:inspect-get-network-targets');
      // Reset and change the announced port
      __resetNetworkTargetsForTests();
      mockGetAnnouncedCdpPort.mockReturnValue(9999);
      // Next access should use new port
      const result = invokeHandler('chrome:inspect-get-network-targets') as { host: string; port: number }[];
      expect(result[0].port).toBe(9999);
    });
  });

  // ---------------------------------------------------------------------------
  // chrome:inspect-add-target
  // ---------------------------------------------------------------------------

  describe('chrome:inspect-add-target', () => {
    it('adds a new target and returns the updated list', () => {
      const result = invokeHandler('chrome:inspect-add-target', 'remote.host', 9229) as unknown[];
      expect(result).toContainEqual({ host: 'remote.host', port: 9229 });
    });

    it('is a no-op when the same host:port already exists', () => {
      invokeHandler('chrome:inspect-add-target', 'remote.host', 9229);
      const result = invokeHandler('chrome:inspect-add-target', 'remote.host', 9229) as unknown[];
      const matches = (result as { host: string; port: number }[]).filter(
        (t) => t.host === 'remote.host' && t.port === 9229,
      );
      expect(matches).toHaveLength(1);
    });

    it('returns a list containing the initial localhost entry too', () => {
      const result = invokeHandler('chrome:inspect-add-target', 'remote.host', 9229) as { host: string; port: number }[];
      expect(result).toContainEqual({ host: 'localhost', port: 9222 });
    });
  });

  // ---------------------------------------------------------------------------
  // chrome:inspect-remove-target
  // ---------------------------------------------------------------------------

  describe('chrome:inspect-remove-target', () => {
    it('removes a target by host and port', () => {
      invokeHandler('chrome:inspect-add-target', 'remote.host', 9229);
      const result = invokeHandler('chrome:inspect-remove-target', 'remote.host', 9229) as { host: string; port: number }[];
      expect(result).not.toContainEqual({ host: 'remote.host', port: 9229 });
    });

    it('is a no-op when the target does not exist', () => {
      const before = invokeHandler('chrome:inspect-get-network-targets') as unknown[];
      const result = invokeHandler('chrome:inspect-remove-target', 'nonexistent', 1234) as unknown[];
      expect(result.length).toBe(before.length);
    });

    it('removes only the matching target, leaving others intact', () => {
      invokeHandler('chrome:inspect-add-target', 'host-a', 9001);
      invokeHandler('chrome:inspect-add-target', 'host-b', 9002);
      const result = invokeHandler('chrome:inspect-remove-target', 'host-a', 9001) as { host: string; port: number }[];
      expect(result).not.toContainEqual({ host: 'host-a', port: 9001 });
      expect(result).toContainEqual({ host: 'host-b', port: 9002 });
    });
  });

  // ---------------------------------------------------------------------------
  // chrome:version-info
  // ---------------------------------------------------------------------------

  describe('chrome:version-info', () => {
    it('returns appName from app.getName()', () => {
      const result = invokeHandler('chrome:version-info') as Record<string, unknown>;
      expect(result.appName).toBe('Browser');
    });

    it('returns appVersion from app.getVersion()', () => {
      const result = invokeHandler('chrome:version-info') as Record<string, unknown>;
      expect(result.appVersion).toBe('1.2.3');
    });

    it('returns electronVersion from process.versions.electron', () => {
      const result = invokeHandler('chrome:version-info') as Record<string, unknown>;
      expect(typeof result.electronVersion).toBe('string');
    });

    it('returns userData path from app.getPath("userData")', () => {
      const result = invokeHandler('chrome:version-info') as Record<string, unknown>;
      expect(result.userData).toBe('/test/path/userData');
    });
  });

  // ---------------------------------------------------------------------------
  // chrome:accessibility-info
  // ---------------------------------------------------------------------------

  describe('chrome:accessibility-info', () => {
    it('returns accessibilitySupportEnabled field', () => {
      const result = invokeHandler('chrome:accessibility-info') as Record<string, unknown>;
      expect('accessibilitySupportEnabled' in result).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // chrome:sandbox-info
  // ---------------------------------------------------------------------------

  describe('chrome:sandbox-info', () => {
    it('returns contextIsolated: true', () => {
      const result = invokeHandler('chrome:sandbox-info') as Record<string, unknown>;
      expect(result.contextIsolated).toBe(true);
    });

    it('returns nodeIntegration: false', () => {
      const result = invokeHandler('chrome:sandbox-info') as Record<string, unknown>;
      expect(result.nodeIntegration).toBe(false);
    });

    it('returns sandboxed field', () => {
      const result = invokeHandler('chrome:sandbox-info') as Record<string, unknown>;
      expect('sandboxed' in result).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // chrome:open-page
  // ---------------------------------------------------------------------------

  describe('chrome:open-page', () => {
    it('calls openSettingsWindow when page is "settings"', () => {
      invokeHandler('chrome:open-page', 'settings');
      expect(cbs.openSettingsWindow).toHaveBeenCalledOnce();
    });

    it('calls openExtensionsWindow when page is "extensions"', () => {
      invokeHandler('chrome:open-page', 'extensions');
      expect(cbs.openExtensionsWindow).toHaveBeenCalledOnce();
    });

    it('calls openInternalPage for other page names', () => {
      invokeHandler('chrome:open-page', 'downloads');
      expect(cbs.openInternalPage).toHaveBeenCalledWith('downloads');
    });

    it('does not call openSettingsWindow for non-settings pages', () => {
      invokeHandler('chrome:open-page', 'downloads');
      expect(cbs.openSettingsWindow).not.toHaveBeenCalled();
    });
  });
});
