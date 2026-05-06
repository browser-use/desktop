import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrowserPool } from '../../../src/main/sessions/BrowserPool';
import { contentViewStub } from '../../fixtures/electron-mock';

function mockWindow(): any {
  return { contentView: { ...contentViewStub } };
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
  let win: any;

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

  it('re-centers an attached view using the current zoom factor after manual zoom changes', () => {
    pool.create('s1');
    pool.attachToWindow('s1', win, { x: 0, y: 0, width: 2000, height: 900 });

    const view = pool.getView('s1');
    expect(view).not.toBeNull();

    (view!.webContents as { getZoomFactor?: () => number }).getZoomFactor = () => 0.5;

    const ok = pool.attachToWindow('s1', win, { x: 0, y: 0, width: 2000, height: 900 });
    expect(ok).toBe(true);
    expect(view!.getBounds()).toEqual({ x: 600, y: 0, width: 800, height: 900 });
  });

  it('destroy detaches if currently attached', () => {
    pool.create('s1');
    pool.attachToWindow('s1', win, { x: 0, y: 0, width: 800, height: 600 });
    pool.destroy('s1', win);
    expect(pool.activeCount).toBe(0);
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

describe('BrowserPool — manual navigation', () => {
  let pool: BrowserPool;

  beforeEach(() => { pool = new BrowserPool(5); });
  afterEach(() => { pool.destroyAll(); });

  it('normalizes and dispatches typed URLs to the active browser', async () => {
    pool.create('s1');

    const result = await pool.navigate('s1', 'example.com/docs');
    const state = pool.getNavigationState('s1');

    expect(result).toMatchObject({ ok: true, url: 'https://example.com/docs' });
    expect(state).toMatchObject({
      url: 'https://example.com/docs',
      title: 'https://example.com/docs',
      canGoBack: true,
      canGoForward: false,
    });
  });

  it('normalizes plain text into search navigation', async () => {
    pool.create('s1');

    const result = await pool.navigate('s1', 'browser use desktop');

    expect(result).toMatchObject({
      ok: true,
      url: 'https://www.google.com/search?q=browser%20use%20desktop',
    });
  });

  it('returns clear errors for invalid input and navigation failures', async () => {
    pool.create('s1');
    const wc = pool.getWebContents('s1') as unknown as {
      __setNavigationState: (state: { loadError?: Error | null }) => void;
    };

    expect(await pool.navigate('s1', 'javascript:alert(1)')).toMatchObject({
      ok: false,
      error: 'Unsupported URL scheme: javascript',
    });

    wc.__setNavigationState({ loadError: new Error('DNS failed') });
    expect(await pool.navigate('s1', 'https://example.com')).toMatchObject({
      ok: false,
      error: 'DNS failed',
    });
  });

  it('dispatches history and reload controls', async () => {
    pool.create('s1');
    const wc = pool.getWebContents('s1') as unknown as {
      __setNavigationState: (state: { canGoBack?: boolean; canGoForward?: boolean }) => void;
    };

    wc.__setNavigationState({ canGoBack: true, canGoForward: true });

    expect(pool.goBack('s1')).toMatchObject({ ok: true });
    expect(pool.goForward('s1')).toMatchObject({ ok: true });
    expect(pool.reload('s1')).toMatchObject({ ok: true });
  });
});

describe('BrowserPool — fitted resize', () => {
  let pool: BrowserPool;
  let win: any;

  beforeEach(() => {
    pool = new BrowserPool(5);
    win = mockWindow();
  });

  afterEach(() => { pool.destroyAll(); });

  it('uses the current zoom factor when fitting bounds after a zoom change', () => {
    pool.create('s1');
    pool.attachToWindow('s1', win, { x: 0, y: 0, width: 2000, height: 900 });

    const view = pool.getView('s1');
    expect(view).not.toBeNull();

    (view!.webContents as { getZoomFactor?: () => number }).getZoomFactor = () => 0.5;

    const fitted = pool.setViewBoundsFitted('s1', { x: 0, y: 0, width: 2000, height: 900 });
    expect(fitted).toEqual({ x: 600, y: 0, width: 800, height: 900 });
    expect(view!.getBounds()).toEqual({ x: 600, y: 0, width: 800, height: 900 });
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
