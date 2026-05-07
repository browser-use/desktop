import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

interface MockBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const windows: MockBrowserWindow[] = [];
const userDataPath = path.join(os.tmpdir(), `BrowserUseDesktop-pill-window-test-${process.pid}`);
const mockScreen = {
  getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 100 })),
  getDisplayNearestPoint: vi.fn(() => ({
    bounds: { x: 20, y: 30, width: 1200, height: 900 },
    workArea: { x: 20, y: 30, width: 1200, height: 900 },
  })),
  getAllDisplays: vi.fn(() => [{
    bounds: { x: 20, y: 30, width: 1200, height: 900 },
    workArea: { x: 20, y: 30, width: 1200, height: 900 },
  }]),
};

class MockBrowserWindow {
  private bounds: MockBounds;
  private destroyed = false;
  private visible = false;
  private handlers = new Map<string, Array<(...args: unknown[]) => void>>();

  webContents = {
    setZoomFactor: vi.fn(),
    setVisualZoomLevelLimits: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
  };

  constructor(opts: { width: number; height: number }) {
    this.bounds = { x: 0, y: 0, width: opts.width, height: opts.height };
    windows.push(this);
  }

  setVisibleOnAllWorkspaces = vi.fn();
  setAlwaysOnTop = vi.fn();
  loadURL = vi.fn();
  loadFile = vi.fn();
  on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
    return this;
  });
  focus = vi.fn();

  getBounds(): MockBounds {
    return { ...this.bounds };
  }

  setBounds(bounds: MockBounds): void {
    this.bounds = { ...bounds };
  }

  showInactive(): void {
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }
}

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => userDataPath),
  },
  BrowserWindow: MockBrowserWindow,
  screen: mockScreen,
}));

vi.mock('../../src/main/logger', () => ({
  mainLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  rendererLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function pillBoundsStorePath(): string {
  return path.join(userDataPath, 'pill-bounds.json');
}

function readSavedPillBounds(): MockBounds {
  const raw = fs.readFileSync(pillBoundsStorePath(), 'utf-8');
  return JSON.parse(raw) as MockBounds;
}

async function loadPillModule() {
  vi.resetModules();
  return import('../../src/main/pill');
}

describe('pill window sizing', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    windows.length = 0;
    fs.rmSync(userDataPath, { recursive: true, force: true });
    fs.mkdirSync(userDataPath, { recursive: true });
    mockScreen.getCursorScreenPoint.mockReturnValue({ x: 100, y: 100 });
    mockScreen.getDisplayNearestPoint.mockReturnValue({
      bounds: { x: 20, y: 30, width: 1200, height: 900 },
      workArea: { x: 20, y: 30, width: 1200, height: 900 },
    });
    mockScreen.getAllDisplays.mockReturnValue([{
      bounds: { x: 20, y: 30, width: 1200, height: 900 },
      workArea: { x: 20, y: 30, width: 1200, height: 900 },
    }]);
  });

  test('showPill preserves the last renderer-requested height while repositioning', async () => {
    const pill = await loadPillModule();

    const win = pill.createPillWindow();
    pill.setPillHeight(141);

    expect(win.getBounds().height).toBe(141);

    pill.hidePill();
    pill.showPill();

    expect(win.getBounds()).toEqual({
      x: 320,
      y: 190,
      width: 600,
      height: 141,
    });
  });

  test('showPill restores the last user-moved position after hide', async () => {
    vi.useFakeTimers();
    const pill = await loadPillModule();
    const win = pill.createPillWindow();

    pill.showPill();
    vi.advanceTimersByTime(250);

    win.setBounds({ x: 500, y: 260, width: 600, height: 110 });
    win.emit('move');

    expect(readSavedPillBounds()).toEqual({
      x: 500,
      y: 260,
      width: 600,
      height: 110,
    });

    pill.hidePill();
    pill.showPill();

    expect(win.getBounds()).toEqual({
      x: 500,
      y: 260,
      width: 600,
      height: 110,
    });
  });

  test('showPill restores the persisted position after module reload', async () => {
    fs.writeFileSync(
      pillBoundsStorePath(),
      JSON.stringify({ x: 480, y: 250, width: 600, height: 110 }),
      'utf-8',
    );
    const pill = await loadPillModule();
    const win = pill.createPillWindow();

    pill.showPill();

    expect(win.getBounds()).toEqual({
      x: 480,
      y: 250,
      width: 600,
      height: 110,
    });
  });

  test('showPill clamps a partially offscreen saved position to the visible work area', async () => {
    fs.writeFileSync(
      pillBoundsStorePath(),
      JSON.stringify({ x: 1100, y: 880, width: 600, height: 110 }),
      'utf-8',
    );
    const pill = await loadPillModule();
    const win = pill.createPillWindow();

    pill.showPill();

    expect(win.getBounds()).toEqual({
      x: 620,
      y: 820,
      width: 600,
      height: 110,
    });
    expect(readSavedPillBounds()).toEqual({
      x: 620,
      y: 820,
      width: 600,
      height: 110,
    });
  });

  test('showPill falls back to the default position when saved position is fully offscreen', async () => {
    fs.writeFileSync(
      pillBoundsStorePath(),
      JSON.stringify({ x: 9000, y: 9000, width: 600, height: 110 }),
      'utf-8',
    );
    const pill = await loadPillModule();
    const win = pill.createPillWindow();

    pill.showPill();

    expect(win.getBounds()).toEqual({
      x: 320,
      y: 190,
      width: 600,
      height: 110,
    });
  });
});
