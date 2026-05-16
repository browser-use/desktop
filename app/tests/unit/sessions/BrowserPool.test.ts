import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { BrowserPool } from '../../../src/main/sessions/BrowserPool';
import { contentViewStub } from '../../fixtures/electron-mock';

type MockWindow = {
  contentView: {
    children: unknown[];
    addChildView: (view: unknown) => void;
    removeChildView: (view: unknown) => void;
  };
};

function mockWindow(): BrowserWindow & MockWindow {
  const children: unknown[] = [];
  return {
    getContentBounds: vi.fn(() => ({ x: 0, y: 0, width: 1200, height: 900 })),
    contentView: {
      ...contentViewStub,
      children,
      addChildView: vi.fn((view: unknown) => {
        if (!children.includes(view)) children.push(view);
      }),
      removeChildView: vi.fn((view: unknown) => {
        const index = children.indexOf(view);
        if (index >= 0) children.splice(index, 1);
      }),
    },
  } as unknown as BrowserWindow & MockWindow;
}

function instrumentLifecycle(view: NonNullable<ReturnType<BrowserPool['create']>>) {
  const setFrameRate = vi.fn<(fps: number) => void>();
  const sendCommand = vi.fn<(method: string, params: Record<string, unknown>) => Promise<unknown>>().mockResolvedValue({});
  const wc = view.webContents as unknown as {
    setFrameRate: (fps: number) => void;
    debugger: {
      sendCommand: (method: string, params: Record<string, unknown>) => Promise<unknown>;
      attach: () => void;
      detach: () => void;
      isAttached: () => boolean;
    };
  };
  wc.setFrameRate = setFrameRate;
  Object.assign(wc.debugger, {
    sendCommand,
    attach: vi.fn<() => void>(),
    detach: vi.fn<() => void>(),
    isAttached: () => false,
  });
  return { setFrameRate, sendCommand };
}

// ---------------------------------------------------------------------------
// Creation & lifecycle
// ---------------------------------------------------------------------------

describe('BrowserPool — creation', () => {
  let pool: BrowserPool;

  beforeEach(() => { pool = new BrowserPool(3); });
  afterEach(() => { pool.destroyAll(); });

  it('creates a browser view and returns it', () => {
    const view = pool.create('s1');
    expect(view).not.toBeNull();
    expect(pool.activeCount).toBe(1);
  });

  it('assigns unique webContents per session', () => {
    const v1 = pool.create('s1');
    const v2 = pool.create('s2');
    expect(v1!.webContents.id).not.toBe(v2!.webContents.id);
  });

  it('returns existing view for duplicate session ID', () => {
    const v1 = pool.create('s1');
    const v2 = pool.create('s1');
    expect(v1).toBe(v2);
    expect(pool.activeCount).toBe(1);
  });

  it('getWebContents returns the correct webContents', () => {
    const view = pool.create('s1');
    const wc = pool.getWebContents('s1');
    expect(wc).toBe(view!.webContents);
  });

  it('getWebContents returns null for unknown session', () => {
    expect(pool.getWebContents('nonexistent')).toBeNull();
  });

  it('getView returns the view or null', () => {
    pool.create('s1');
    expect(pool.getView('s1')).not.toBeNull();
    expect(pool.getView('nonexistent')).toBeNull();
  });

  it('notifies when Ctrl+C is pressed inside a browser view and prevents the page keypress when handled', () => {
    const view = pool.create('s1');
    const onInterruptShortcut = vi.fn(() => true);
    const preventDefault = vi.fn();
    pool.setOnInterruptShortcut(onInterruptShortcut);

    (view!.webContents as unknown as { emit: (event: string, ...args: unknown[]) => boolean }).emit(
      'before-input-event',
      { preventDefault },
      { type: 'keyDown', key: 'c', control: true, meta: false, alt: false },
    );

    expect(onInterruptShortcut).toHaveBeenCalledWith('s1');
    expect(preventDefault).toHaveBeenCalled();
  });

  it('lets Ctrl+C through to the page when the app does not handle it', () => {
    const view = pool.create('s1');
    const preventDefault = vi.fn();
    pool.setOnInterruptShortcut(() => false);

    (view!.webContents as unknown as { emit: (event: string, ...args: unknown[]) => boolean }).emit(
      'before-input-event',
      { preventDefault },
      { type: 'keyDown', key: 'c', control: true, meta: false, alt: false },
    );

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('does not treat Escape as the browser-view interrupt shortcut', () => {
    const view = pool.create('s1');
    const onInterruptShortcut = vi.fn(() => true);
    const preventDefault = vi.fn();
    pool.setOnInterruptShortcut(onInterruptShortcut);

    (view!.webContents as unknown as { emit: (event: string, ...args: unknown[]) => boolean }).emit(
      'before-input-event',
      { preventDefault },
      { type: 'keyDown', key: 'Escape', control: false, meta: false, alt: false },
    );

    expect(onInterruptShortcut).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Concurrency limits
// ---------------------------------------------------------------------------

describe('BrowserPool — concurrency', () => {
  let pool: BrowserPool;

  beforeEach(() => { pool = new BrowserPool(2); });
  afterEach(() => { pool.destroyAll(); });

  it('enforces max concurrent limit', () => {
    pool.create('s1');
    pool.create('s2');
    const v3 = pool.create('s3');
    expect(v3).toBeNull();
    expect(pool.activeCount).toBe(2);
    expect(pool.queuedCount).toBe(1);
  });

  it('canCreate returns false at capacity', () => {
    pool.create('s1');
    expect(pool.canCreate()).toBe(true);
    pool.create('s2');
    expect(pool.canCreate()).toBe(false);
  });

  it('frees capacity when a session is destroyed', () => {
    pool.create('s1');
    pool.create('s2');
    expect(pool.canCreate()).toBe(false);

    pool.destroy('s1');
    expect(pool.canCreate()).toBe(true);
    expect(pool.activeCount).toBe(1);
  });

  it('queued count resets on destroyAll', () => {
    pool.create('s1');
    pool.create('s2');
    pool.create('s3');
    expect(pool.queuedCount).toBe(1);

    pool.destroyAll();
    expect(pool.queuedCount).toBe(0);
    expect(pool.activeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Attach / detach (live view)
// ---------------------------------------------------------------------------

describe('BrowserPool — attach/detach', () => {
  let pool: BrowserPool;
  let win: BrowserWindow & MockWindow;

  beforeEach(() => {
    pool = new BrowserPool(5);
    win = mockWindow();
  });
  afterEach(() => { pool.destroyAll(); });

  it('attachToWindow returns true and sets bounds', () => {
    pool.create('s1');
    const bounds = { x: 100, y: 50, width: 800, height: 600 };
    const ok = pool.attachToWindow('s1', win, bounds);
    expect(ok).toBe(true);
  });

  it('attachToWindow returns false for unknown session', () => {
    const ok = pool.attachToWindow('nonexistent', win, { x: 0, y: 0, width: 100, height: 100 });
    expect(ok).toBe(false);
  });

  it('detachFromWindow returns true after attach', () => {
    pool.create('s1');
    pool.attachToWindow('s1', win, { x: 0, y: 0, width: 800, height: 600 });
    const ok = pool.detachFromWindow('s1', win);
    expect(ok).toBe(true);
  });

  it('detachFromWindow returns false if not attached', () => {
    pool.create('s1');
    const ok = pool.detachFromWindow('s1', win);
    expect(ok).toBe(false);
  });

  it('detachFromWindow returns false for unknown session', () => {
    const ok = pool.detachFromWindow('nonexistent', win);
    expect(ok).toBe(false);
  });

  it('double attach updates bounds without error', () => {
    pool.create('s1');
    pool.attachToWindow('s1', win, { x: 0, y: 0, width: 800, height: 600 });
    const ok = pool.attachToWindow('s1', win, { x: 50, y: 50, width: 640, height: 480 });
    expect(ok).toBe(true);
  });

  it('keeps an attached view edge-to-edge and resets page zoom', () => {
    const view = pool.create('s1');
    expect(view).not.toBeNull();
    const setZoomFactor = vi.fn<(factor: number) => void>();
    (view!.webContents as unknown as { setZoomFactor: (factor: number) => void }).setZoomFactor = setZoomFactor;

    const ok = pool.attachToWindow('s1', win, { x: 0, y: 0, width: 2000, height: 900 });
    expect(ok).toBe(true);
    expect(view!.getBounds()).toEqual({ x: 0, y: 0, width: 2000, height: 900 });
    expect(setZoomFactor).toHaveBeenLastCalledWith(1);
  });

  it('destroy detaches if currently attached', () => {
    pool.create('s1');
    pool.attachToWindow('s1', win, { x: 0, y: 0, width: 800, height: 600 });
    pool.destroy('s1', win);
    expect(pool.activeCount).toBe(0);
  });

  it('parks temporarily hidden views at the window edge without collapsing their viewport', () => {
    const view = pool.create('s1');
    expect(view).not.toBeNull();

    pool.attachToWindow('s1', win, { x: 100, y: 50, width: 800, height: 600 });
    expect(win.contentView.children).toContain(view);

    pool.temporarilyDetachAll(win);
    expect(win.contentView.children).toContain(view);
    expect(view!.getBounds()).toEqual({ x: 1199, y: 899, width: 800, height: 600 });

    pool.reattachAll(win);
    expect(win.contentView.children.filter((child: unknown) => child === view)).toHaveLength(1);
    expect(view!.getBounds()).toEqual({ x: 100, y: 50, width: 800, height: 600 });
  });

  it('clears preview parking state even when the preview window is gone', async () => {
    const view = pool.create('s1');
    expect(view).not.toBeNull();
    instrumentLifecycle(view!);

    const parking = await pool.parkForPreview('s1', win);
    expect(parking).toEqual({ ok: true, parkedByUs: true });
    expect(pool.getStats().sessions[0].attached).toBe(true);

    pool.releasePreviewParking('s1', null);

    expect(pool.getStats().sessions[0].attached).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tab observation
// ---------------------------------------------------------------------------

describe('BrowserPool — getTabs', () => {
  let pool: BrowserPool;

  beforeEach(() => { pool = new BrowserPool(5); });
  afterEach(() => { pool.destroyAll(); });

  it('returns tab info for active session', async () => {
    pool.create('s1');
    const tabs = await pool.getTabs('s1');
    expect(tabs.length).toBe(1);
    expect(tabs[0].url).toBe('about:blank');
    expect(tabs[0].type).toBe('page');
    expect(tabs[0].active).toBe(true);
  });

  it('returns empty array for unknown session', async () => {
    const tabs = await pool.getTabs('nonexistent');
    expect(tabs).toEqual([]);
  });
});

describe('BrowserPool — fitted resize', () => {
  let pool: BrowserPool;

  beforeEach(() => {
    pool = new BrowserPool(5);
  });

  afterEach(() => { pool.destroyAll(); });

  it('keeps fitted resize edge-to-edge and resets page zoom', () => {
    const view = pool.create('s1');
    expect(view).not.toBeNull();
    const setZoomFactor = vi.fn<(factor: number) => void>();
    (view!.webContents as unknown as { setZoomFactor: (factor: number) => void }).setZoomFactor = setZoomFactor;

    const fitted = pool.setViewBoundsFitted('s1', { x: 0, y: 0, width: 2000, height: 900 });
    expect(fitted).toEqual({ x: 0, y: 0, width: 2000, height: 900 });
    expect(view!.getBounds()).toEqual({ x: 0, y: 0, width: 2000, height: 900 });
    expect(setZoomFactor).toHaveBeenLastCalledWith(1);
  });
});

describe('BrowserPool — idle CPU throttling', () => {
  let pool: BrowserPool;

  beforeEach(() => {
    vi.useFakeTimers();
    pool = new BrowserPool(5, { idleFreezeDelayMs: 100 });
  });

  afterEach(() => {
    pool.destroyAll();
    vi.useRealTimers();
  });

  it('drops detached idle sessions to 1 FPS and freezes after the idle delay', async () => {
    const view = pool.create('s1');
    expect(view).not.toBeNull();

    const { setFrameRate, sendCommand } = instrumentLifecycle(view!);

    pool.markSessionIdle('s1');
    expect(setFrameRate).toHaveBeenLastCalledWith(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(sendCommand).toHaveBeenCalledWith('Page.setWebLifecycleState', { state: 'frozen' });
  });

  it('does not freeze an idle session while it is visible', async () => {
    const view = pool.create('s1');
    expect(view).not.toBeNull();

    const { setFrameRate, sendCommand } = instrumentLifecycle(view!);

    const win = mockWindow();
    pool.attachToWindow('s1', win, { x: 0, y: 0, width: 800, height: 600 });
    pool.markSessionIdle('s1');

    await vi.advanceTimersByTimeAsync(100);
    expect(sendCommand).not.toHaveBeenCalled();
    expect(setFrameRate).toHaveBeenLastCalledWith(60);
  });

  it('wakes a frozen detached session before new agent activity', async () => {
    const view = pool.create('s1');
    expect(view).not.toBeNull();

    const { setFrameRate, sendCommand } = instrumentLifecycle(view!);

    pool.markSessionIdle('s1');
    await vi.advanceTimersByTimeAsync(100);
    await pool.markSessionActive('s1');

    expect(sendCommand).toHaveBeenNthCalledWith(1, 'Page.setWebLifecycleState', { state: 'frozen' });
    expect(sendCommand).toHaveBeenNthCalledWith(2, 'Page.setWebLifecycleState', { state: 'active' });
    expect(setFrameRate).toHaveBeenLastCalledWith(4);
  });
});

// ---------------------------------------------------------------------------
// Stats / monitoring
// ---------------------------------------------------------------------------

describe('BrowserPool — getStats', () => {
  let pool: BrowserPool;

  beforeEach(() => { pool = new BrowserPool(3); });
  afterEach(() => { pool.destroyAll(); });

  it('returns accurate stats with no sessions', () => {
    const stats = pool.getStats();
    expect(stats.active).toBe(0);
    expect(stats.queued).toBe(0);
    expect(stats.maxConcurrent).toBe(3);
    expect(stats.sessions).toEqual([]);
  });

  it('returns accurate stats with active sessions', () => {
    pool.create('s1');
    pool.create('s2');
    const stats = pool.getStats();
    expect(stats.active).toBe(2);
    expect(stats.sessions.length).toBe(2);
    expect(stats.sessions[0].sessionId).toBe('s1');
    expect(stats.sessions[0].attached).toBe(false);
    expect(typeof stats.sessions[0].pid).toBe('number');
    expect(typeof stats.sessions[0].createdAt).toBe('number');
  });

  it('reflects attached state in stats', () => {
    pool.create('s1');
    const win = mockWindow();
    pool.attachToWindow('s1', win, { x: 0, y: 0, width: 800, height: 600 });
    const stats = pool.getStats();
    expect(stats.sessions[0].attached).toBe(true);
  });

  it('includes queued count', () => {
    pool.create('s1');
    pool.create('s2');
    pool.create('s3');
    pool.create('s4');
    const stats = pool.getStats();
    expect(stats.active).toBe(3);
    expect(stats.queued).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Destroy / cleanup
// ---------------------------------------------------------------------------

describe('BrowserPool — destroy', () => {
  let pool: BrowserPool;

  beforeEach(() => { pool = new BrowserPool(5); });

  it('destroy removes the entry', () => {
    pool.create('s1');
    pool.destroy('s1');
    expect(pool.activeCount).toBe(0);
    expect(pool.getWebContents('s1')).toBeNull();
  });

  it('destroy is idempotent', () => {
    pool.create('s1');
    pool.destroy('s1');
    pool.destroy('s1');
    expect(pool.activeCount).toBe(0);
  });

  it('destroyAll clears everything', () => {
    pool.create('s1');
    pool.create('s2');
    pool.create('s3');
    pool.destroyAll();
    expect(pool.activeCount).toBe(0);
    expect(pool.queuedCount).toBe(0);
  });
});
