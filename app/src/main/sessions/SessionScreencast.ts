/**
 * SessionScreencast — per-session preview thumbnail driver.
 *
 * Polls `Page.captureScreenshot` via the WebContentsView's debugger every
 * `intervalMs` (default 1s) and forwards the JPEG bytes to the renderer as
 * `session-preview-frame(id, base64)`. Works regardless of whether the
 * BrowserView is currently attached to the window — captureScreenshot
 * runs in the renderer and doesn't require an on-screen compositor pass.
 *
 * This is intentionally simpler than `Page.startScreencast` (which would
 * have required keeping the view in the window tree). 1Hz is plenty for a
 * "what is the agent looking at" thumbnail; the user clicks through to grid
 * for live interaction.
 *
 * Lifecycle:
 *   - start(id):  attach debugger if not already, kick off the poll loop.
 *   - stop(id):   clear the interval, detach debugger if we attached it.
 *                 Idempotent.
 */

import type { BrowserPool } from './BrowserPool';
import type { BrowserWindow, Debugger, WebContents } from 'electron';
import { mainLogger } from '../logger';

const CDP_PROTOCOL_VERSION = '1.3';

interface PreviewOptions {
  format: 'jpeg' | 'png';
  quality?: number;
  maxWidth: number;
  maxHeight: number;
  /** Poll interval in milliseconds. */
  intervalMs: number;
}

const DEFAULT_OPTS: PreviewOptions = {
  format: 'jpeg',
  quality: 50,
  maxWidth: 480,
  maxHeight: 300,
  intervalMs: 1000,
};

interface ActiveStream {
  wc: WebContents;
  dbg: Debugger;
  attachedByUs: boolean;
  timer: NodeJS.Timeout | null;
  inFlight: boolean;
  framesSeen: number;
  lastLogAt: number;
}

type LayoutViewport = {
  clientWidth?: number;
  clientHeight?: number;
  pageX?: number;
  pageY?: number;
};

type ScreenshotParams = {
  format: PreviewOptions['format'];
  quality?: number;
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
  };
};

export class SessionScreencast {
  private readonly streams = new Map<string, ActiveStream>();
  private readonly pool: BrowserPool;
  private window: BrowserWindow | null = null;

  constructor(pool: BrowserPool) {
    this.pool = pool;
  }

  setWindow(win: BrowserWindow | null): void {
    this.window = win;
  }

  async start(sessionId: string, opts: Partial<PreviewOptions> = {}): Promise<{ ok: boolean; reason?: string }> {
    if (this.streams.has(sessionId)) {
      mainLogger.debug('SessionScreencast.start.alreadyStreaming', { sessionId });
      return { ok: true };
    }
    const wc = this.pool.getWebContents(sessionId);
    if (!wc || wc.isDestroyed()) {
      mainLogger.debug('SessionScreencast.start.noWebContents', { sessionId });
      return { ok: false, reason: 'no_view' };
    }
    const dbg = wc.debugger;
    const wasAttached = dbg.isAttached();
    if (!wasAttached) {
      try {
        dbg.attach(CDP_PROTOCOL_VERSION);
      } catch (err) {
        mainLogger.warn('SessionScreencast.start.attachFailed', { sessionId, error: (err as Error).message });
        return { ok: false, reason: 'attach_failed' };
      }
    }
    const merged: PreviewOptions = { ...DEFAULT_OPTS, ...opts };

    const stream: ActiveStream = {
      wc,
      dbg,
      attachedByUs: !wasAttached,
      timer: null,
      inFlight: false,
      framesSeen: 0,
      lastLogAt: 0,
    };

    const tick = async (): Promise<void> => {
      if (!this.streams.has(sessionId)) return;
      if (stream.inFlight) return; // skip if previous capture still pending
      if (wc.isDestroyed()) return;
      stream.inFlight = true;
      try {
        const params: ScreenshotParams = {
          format: merged.format,
          quality: merged.quality,
        };
        try {
          const metrics = await dbg.sendCommand('Page.getLayoutMetrics') as {
            cssVisualViewport?: LayoutViewport;
            cssLayoutViewport?: LayoutViewport;
            layoutViewport?: LayoutViewport;
          };
          const viewport = metrics.cssVisualViewport ?? metrics.cssLayoutViewport ?? metrics.layoutViewport;
          const width = Math.floor(viewport?.clientWidth ?? 0);
          const height = Math.floor(viewport?.clientHeight ?? 0);
          if (width > 0 && height > 0) {
            const scale = Math.min(1, merged.maxWidth / width, merged.maxHeight / height);
            if (scale < 1) {
              params.clip = {
                x: viewport?.pageX ?? 0,
                y: viewport?.pageY ?? 0,
                width,
                height,
                scale,
              };
            }
          }
        } catch (err) {
          mainLogger.debug('SessionScreencast.metrics.error', { sessionId, error: (err as Error).message });
        }

        const result = await dbg.sendCommand('Page.captureScreenshot', params) as { data: string };

        stream.framesSeen += 1;
        const now = Date.now();
        if (now - stream.lastLogAt > 5000) {
          stream.lastLogAt = now;
          mainLogger.info('SessionScreencast.frame', {
            sessionId,
            framesSeen: stream.framesSeen,
            bytes: result.data.length,
          });
        }
        if (this.window && !this.window.isDestroyed()) {
          this.window.webContents.send('session-preview-frame', sessionId, result.data);
        }
      } catch (err) {
        const msg = (err as Error).message;
        mainLogger.warn('SessionScreencast.capture.error', { sessionId, error: msg });
      } finally {
        stream.inFlight = false;
      }
    };

    stream.timer = setInterval(() => { void tick(); }, merged.intervalMs);
    this.streams.set(sessionId, stream);
    // Kick off the first frame immediately so the placeholder swaps within
    // the first poll-interval rather than waiting a full second.
    void tick();

    mainLogger.info('SessionScreencast.start.ok', {
      sessionId,
      attachedByUs: !wasAttached,
      intervalMs: merged.intervalMs,
      maxWidth: merged.maxWidth,
      maxHeight: merged.maxHeight,
    });
    return { ok: true };
  }

  async stop(sessionId: string): Promise<void> {
    const s = this.streams.get(sessionId);
    if (!s) return;
    this.streams.delete(sessionId);
    if (s.timer) {
      clearInterval(s.timer);
      s.timer = null;
    }
    // Deliberately do NOT detach the debugger here. React StrictMode causes
    // rapid setup/cleanup/setup cycles; thrashing attach/detach drops
    // in-flight CDP commands and can leave the next start in a half-attached
    // state. The debugger is cheap to keep attached — Electron cleans up
    // when the WebContents is destroyed.
    mainLogger.info('SessionScreencast.stop.ok', { sessionId, framesSeen: s.framesSeen });
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.streams.keys());
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  isActive(sessionId: string): boolean {
    return this.streams.has(sessionId);
  }
}
