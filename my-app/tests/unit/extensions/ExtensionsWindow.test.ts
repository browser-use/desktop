/**
 * extensions/ExtensionsWindow.ts unit tests.
 *
 * Tests cover:
 *   - getExtensionsWindow: returns null before any window is opened
 *   - openExtensionsWindow: creates a BrowserWindow the first time
 *   - openExtensionsWindow: focuses existing window instead of creating a new one
 *   - getExtensionsWindow: returns window after open, null after 'closed' event
 *   - closeExtensionsWindow: calls close() on the existing window
 *   - closeExtensionsWindow: is a no-op when no window exists or window is destroyed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { loggerSpy } = vi.hoisted(() => ({
  loggerSpy: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/main/logger', () => ({ mainLogger: loggerSpy }));

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  return {
    ...actual,
    default: { ...actual, join: vi.fn((...parts: string[]) => parts.join('/')) },
    join: vi.fn((...parts: string[]) => parts.join('/')),
  };
});

const { MockBrowserWindow } = vi.hoisted(() => {
  class MockBrowserWindow {
    static last: MockBrowserWindow | null = null;
    static eventHandlers: Map<string, () => void> = new Map();
    id = Math.floor(Math.random() * 1000);
    isDestroyed = vi.fn(() => false);
    focus = vi.fn();
    show = vi.fn();
    close = vi.fn();
    loadURL = vi.fn(() => Promise.resolve());
    loadFile = vi.fn(() => Promise.resolve());
    getPosition = vi.fn(() => [0, 0]);
    getSize = vi.fn(() => [860, 620]);
    once = vi.fn((event: string, handler: () => void) => {
      MockBrowserWindow.eventHandlers.set(`once:${event}`, handler);
    });
    on = vi.fn((event: string, handler: () => void) => {
      MockBrowserWindow.eventHandlers.set(event, handler);
    });
    webContents = {
      on: vi.fn(),
      getURL: vi.fn(() => ''),
      openDevTools: vi.fn(),
    };

    constructor() {
      MockBrowserWindow.eventHandlers = new Map();
      MockBrowserWindow.last = this;
    }
  }
  return { MockBrowserWindow };
});

vi.mock('electron', () => ({
  BrowserWindow: MockBrowserWindow,
}));

import {
  openExtensionsWindow,
  getExtensionsWindow,
  closeExtensionsWindow,
} from '../../../src/main/extensions/ExtensionsWindow';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockWin = InstanceType<typeof MockBrowserWindow>;

function getLastMockWin(): MockWin | null {
  return MockBrowserWindow.last;
}

function fireEvent(_win: MockWin, event: string): void {
  const handler = MockBrowserWindow.eventHandlers.get(event);
  if (handler) handler();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extensions/ExtensionsWindow.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (MockBrowserWindow.last) {
      MockBrowserWindow.last.isDestroyed.mockReturnValue(false);
    }
  });

  describe('before openExtensionsWindow() is called', () => {
    it('getExtensionsWindow() returns null', () => {
      if (MockBrowserWindow.last === null) {
        expect(getExtensionsWindow()).toBeNull();
      }
    });
  });

  describe('after openExtensionsWindow() is called', () => {
    let win: MockWin;

    beforeEach(() => {
      if (getExtensionsWindow() === null) {
        openExtensionsWindow();
      }
      win = getLastMockWin()!;
      win.isDestroyed.mockReturnValue(false);
    });

    it('creates a BrowserWindow', () => {
      expect(win).not.toBeNull();
    });

    it('getExtensionsWindow() returns the window', () => {
      expect(getExtensionsWindow()).toBe(win);
    });

    it('openExtensionsWindow() focuses the existing window instead of creating a second one', () => {
      const before = MockBrowserWindow.last;
      openExtensionsWindow();
      expect(MockBrowserWindow.last).toBe(before);
      expect(win.focus).toHaveBeenCalled();
    });

    it('openExtensionsWindow() returns the same window instance', () => {
      const result = openExtensionsWindow();
      expect(result).toBe(win);
    });

    it('closeExtensionsWindow() calls close() on the window', () => {
      closeExtensionsWindow();
      expect(win.close).toHaveBeenCalled();
    });

    it('closeExtensionsWindow() does not call close() when window is destroyed', () => {
      win.isDestroyed.mockReturnValue(true);
      closeExtensionsWindow();
      expect(win.close).not.toHaveBeenCalled();
    });

    it('getExtensionsWindow() returns null after window is destroyed', () => {
      win.isDestroyed.mockReturnValue(true);
      expect(getExtensionsWindow()).toBeNull();
    });

    it('getExtensionsWindow() returns null after the "closed" event fires', () => {
      fireEvent(win, 'closed');
      expect(getExtensionsWindow()).toBeNull();
    });
  });

  describe('closeExtensionsWindow() with no window', () => {
    it('does not throw when no window has been created', () => {
      if (MockBrowserWindow.last) {
        MockBrowserWindow.last.isDestroyed.mockReturnValue(true);
        fireEvent(MockBrowserWindow.last, 'closed');
      }
      expect(() => closeExtensionsWindow()).not.toThrow();
    });
  });
});
