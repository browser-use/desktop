/**
 * Unit tests for hotkeys.ts — Cmd+K pill toggle registration.
 *
 * Contract as of Menu-accelerator refactor (Track B):
 *   - Cmd+K is registered as an app-local Menu accelerator in index.ts,
 *     NOT via globalShortcut (which would steal focus system-wide).
 *   - registerHotkeys() is intentionally a no-op shim retained so existing
 *     callers in index.ts keep compiling; it always returns true.
 *   - unregisterHotkeys() is intentionally a no-op shim; nothing to clean up.
 *   - globalShortcut.register is NOT called at all for Cmd+K.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock electron — all mock fns defined INSIDE the factory (vi.mock hoisting)
// ---------------------------------------------------------------------------
vi.mock('electron', () => ({
  globalShortcut: {
    register: vi.fn().mockReturnValue(true),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
    isRegistered: vi.fn().mockReturnValue(false),
  },
  app: {
    getPath: () => '/tmp/test-userData',
    on: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
    on: vi.fn(),
  },
}));

import { globalShortcut } from 'electron';

describe('HotkeyManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(globalShortcut.register).mockReturnValue(true);
    vi.mocked(globalShortcut.isRegistered).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test: registerHotkeys does NOT call globalShortcut.register
  // Cmd+K moved to Menu accelerator; globalShortcut is not used.
  // -------------------------------------------------------------------------
  it('registerHotkeys does not call globalShortcut.register (Cmd+K is a Menu accelerator)', async () => {
    const toggleCb = vi.fn();
    const { registerHotkeys } = await import('../../src/main/hotkeys');

    registerHotkeys(toggleCb);

    // globalShortcut.register must NOT be called — Cmd+K is app-local via Menu
    expect(globalShortcut.register).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test: registerHotkeys is callable without throwing even though it is a
  // no-op shim. The toggleCallback parameter is accepted but not wired here
  // (the Menu accelerator in index.ts calls togglePill() directly).
  // -------------------------------------------------------------------------
  it('registerHotkeys accepts a toggleCallback without throwing', async () => {
    const toggleCb = vi.fn();
    const { registerHotkeys } = await import('../../src/main/hotkeys');

    expect(() => registerHotkeys(toggleCb)).not.toThrow();

    // The callback is not invoked by registerHotkeys itself — it is wired
    // externally via the Menu accelerator in index.ts
    expect(toggleCb).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test: unregisterHotkeys does NOT call globalShortcut.unregister
  // Nothing was registered with globalShortcut, so nothing to unregister.
  // -------------------------------------------------------------------------
  it('unregisterHotkeys does not call globalShortcut.unregister (nothing registered)', async () => {
    const toggleCb = vi.fn();
    const { registerHotkeys, unregisterHotkeys } = await import('../../src/main/hotkeys');

    registerHotkeys(toggleCb);
    unregisterHotkeys();

    expect(globalShortcut.unregister).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test: registerHotkeys always returns true (no registration can fail when
  // it is a no-op; the Menu accelerator is registered synchronously by Electron).
  // -------------------------------------------------------------------------
  it('registerHotkeys always returns true regardless of globalShortcut state', async () => {
    // Even if globalShortcut.register were somehow set to return false,
    // our shim must return true because it does not call register at all.
    vi.mocked(globalShortcut.register).mockReturnValue(false);
    const toggleCb = vi.fn();
    const { registerHotkeys } = await import('../../src/main/hotkeys');

    const result = registerHotkeys(toggleCb);

    expect(result).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test: registerHotkeys returns true on every call (idempotent no-op)
  // -------------------------------------------------------------------------
  it('registerHotkeys returns true when called (Menu-accelerator path always succeeds)', async () => {
    vi.mocked(globalShortcut.register).mockReturnValue(true);
    const toggleCb = vi.fn();
    const { registerHotkeys } = await import('../../src/main/hotkeys');

    const result = registerHotkeys(toggleCb);

    expect(result).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test: calling registerHotkeys multiple times does not call
  // globalShortcut.register at all — the Menu accelerator handles dedup.
  // -------------------------------------------------------------------------
  it('calling registerHotkeys twice never calls globalShortcut.register', async () => {
    const toggleCb = vi.fn();
    const { registerHotkeys } = await import('../../src/main/hotkeys');

    registerHotkeys(toggleCb);
    registerHotkeys(toggleCb);

    expect(globalShortcut.register).toHaveBeenCalledTimes(0);
  });
});
