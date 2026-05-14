import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, WebContents } from 'electron';
import type { BrowserPool } from '../../../src/main/sessions/BrowserPool';
import { SessionScreencast } from '../../../src/main/sessions/SessionScreencast';

function mockWebContents(opts: { destroyed?: boolean; delayCapture?: boolean; hangCapture?: boolean; attached?: boolean; attachThrows?: boolean } = {}): WebContents {
  let attached = opts.attached ?? false;
  const sendCommand = vi.fn(async (method: string) => {
    if (method !== 'Page.captureScreenshot') return {};
    if (opts.hangCapture) return new Promise(() => {});
    if (opts.delayCapture) await new Promise((resolve) => setTimeout(resolve, 10));
    return { data: 'jpeg-bytes' };
  });

  return {
    isDestroyed: vi.fn(() => opts.destroyed ?? false),
    debugger: {
      isAttached: vi.fn(() => attached),
      attach: vi.fn(() => {
        if (opts.attachThrows) throw new Error('attach failed');
        attached = true;
      }),
      detach: vi.fn(() => { attached = false; }),
      sendCommand,
    },
  } as unknown as WebContents;
}

function makeScreencast(wc: WebContents | null): {
  screencast: SessionScreencast;
  sent: ReturnType<typeof vi.fn>;
  pool: BrowserPool;
} {
  const pool = {
    getWebContents: vi.fn(() => wc),
    parkForPreview: vi.fn(async () => ({ ok: true, parkedByUs: false })),
    releasePreviewParking: vi.fn(),
  } as unknown as BrowserPool;
  const sent = vi.fn();
  const screencast = new SessionScreencast(pool);
  screencast.setWindow({
    isDestroyed: vi.fn(() => false),
    webContents: { send: sent },
  } as unknown as BrowserWindow);
  return { screencast, sent, pool };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SessionScreencast', () => {
  it('captures the assigned WebContents once per preview stream', async () => {
    const wc = mockWebContents();
    const { screencast, sent } = makeScreencast(wc);

    await expect(screencast.start('s1')).resolves.toEqual({ ok: true });
    await vi.waitFor(() => expect(sent).toHaveBeenCalledWith('session-preview-frame', 's1', 'jpeg-bytes'));

    expect(wc.debugger.attach).toHaveBeenCalledWith('1.3');
    expect(wc.debugger.sendCommand).toHaveBeenCalledWith('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 55,
      captureBeyondViewport: false,
      fromSurface: true,
    });

    await screencast.stop('s1');
  });

  it('keeps duplicate starts on a single stream', async () => {
    const wc = mockWebContents();
    const { screencast } = makeScreencast(wc);

    await screencast.start('s1');
    await screencast.start('s1');
    await vi.waitFor(() => expect(wc.debugger.sendCommand).toHaveBeenCalledTimes(1));

    await screencast.stop('s1');
  });

  it('returns no_view when there is no browser to capture', async () => {
    const { screencast } = makeScreencast(null);

    await expect(screencast.start('missing')).resolves.toEqual({ ok: false, reason: 'no_view' });
    expect(screencast.isActive('missing')).toBe(false);
  });

  it('parks a detached browser offscreen before capture', async () => {
    const wc = mockWebContents();
    const { screencast, sent, pool } = makeScreencast(wc);
    vi.mocked(pool.parkForPreview).mockResolvedValue({ ok: true, parkedByUs: true });

    await expect(screencast.start('s1')).resolves.toEqual({ ok: true });
    await vi.waitFor(() => expect(sent).toHaveBeenCalledWith('session-preview-frame', 's1', 'jpeg-bytes'));

    expect(pool.parkForPreview).toHaveBeenCalledWith('s1', expect.anything());

    await screencast.stop('s1');
    expect(pool.releasePreviewParking).toHaveBeenCalledWith('s1', expect.anything());
  });

  it('returns park failure when a browser cannot be parked for capture', async () => {
    const wc = mockWebContents();
    const { screencast, pool } = makeScreencast(wc);
    vi.mocked(pool.parkForPreview).mockResolvedValue({ ok: false, parkedByUs: false, reason: 'not_found' });

    await expect(screencast.start('s1')).resolves.toEqual({ ok: false, reason: 'not_found' });
    expect(wc.debugger.attach).not.toHaveBeenCalled();
  });

  it('releases preview parking when debugger attach fails after parking', async () => {
    const wc = mockWebContents({ attachThrows: true });
    const { screencast, pool } = makeScreencast(wc);
    vi.mocked(pool.parkForPreview).mockResolvedValue({ ok: true, parkedByUs: true });

    await expect(screencast.start('s1')).resolves.toEqual({ ok: false, reason: 'attach_failed' });

    expect(pool.releasePreviewParking).toHaveBeenCalledWith('s1', expect.anything());
    expect(screencast.isActive('s1')).toBe(false);
  });

  it('stops cleanly while a capture is still in flight', async () => {
    vi.useFakeTimers();
    const wc = mockWebContents({ delayCapture: true });
    const { screencast, sent } = makeScreencast(wc);

    await screencast.start('s1');
    await screencast.stop('s1');
    await vi.advanceTimersByTimeAsync(20);

    expect(sent).not.toHaveBeenCalled();
    expect(wc.debugger.detach).toHaveBeenCalledTimes(1);
    expect(screencast.isActive('s1')).toBe(false);
  });

  it('times out a stuck capture and retries on the next interval', async () => {
    vi.useFakeTimers();
    const wc = mockWebContents({ hangCapture: true });
    const { screencast, sent } = makeScreencast(wc);

    await screencast.start('s1');
    expect(wc.debugger.sendCommand).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(wc.debugger.sendCommand).toHaveBeenCalledTimes(2);
    expect(sent).not.toHaveBeenCalled();

    await screencast.stop('s1');
  });
});
