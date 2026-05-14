import type { BrowserWindow, Debugger, WebContents } from 'electron';
import { mainLogger } from '../logger';
import type { BrowserPool } from './BrowserPool';

const CDP_PROTOCOL_VERSION = '1.3';

type PreviewFormat = 'jpeg' | 'png';

interface PreviewOptions {
  format: PreviewFormat;
  quality: number;
  intervalMs: number;
}

const DEFAULT_OPTIONS: PreviewOptions = {
  format: 'jpeg',
  quality: 55,
  intervalMs: 1000,
};
const CAPTURE_TIMEOUT_MS = 2500;

interface ActivePreview {
  wc: WebContents;
  dbg: Debugger;
  options: PreviewOptions;
  timer: NodeJS.Timeout;
  attachedByUs: boolean;
  inFlight: boolean;
  stopped: boolean;
  framesSent: number;
  lastFrameLogAt: number;
  parkedByUs: boolean;
}

type CaptureScreenshotParams = {
  format: PreviewFormat;
  quality?: number;
  captureBeyondViewport: boolean;
  fromSurface: boolean;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`capture_timeout_${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class SessionScreencast {
  private readonly previews = new Map<string, ActivePreview>();
  private readonly pool: BrowserPool;
  private window: BrowserWindow | null = null;

  constructor(pool: BrowserPool) {
    this.pool = pool;
  }

  setWindow(win: BrowserWindow | null): void {
    this.window = win;
  }

  async start(sessionId: string, opts: Partial<PreviewOptions> = {}): Promise<{ ok: boolean; reason?: string }> {
    if (this.previews.has(sessionId)) return { ok: true };

    const previewWindow = this.window && !this.window.isDestroyed() ? this.window : null;
    const parking = previewWindow ? await this.pool.parkForPreview(sessionId, previewWindow) : { ok: true, parkedByUs: false };
    if (!parking.ok) return { ok: false, reason: parking.reason ?? 'park_failed' };

    const wc = this.pool.getWebContents(sessionId);
    if (!wc || wc.isDestroyed()) {
      if (parking.parkedByUs && previewWindow) this.pool.releasePreviewParking(sessionId, previewWindow);
      return { ok: false, reason: 'no_view' };
    }

    const dbg = wc.debugger;
    const wasAttached = dbg.isAttached();
    if (!wasAttached) {
      try {
        dbg.attach(CDP_PROTOCOL_VERSION);
      } catch (err) {
        mainLogger.warn('SessionScreencast.start.attachFailed', { sessionId, error: (err as Error).message });
        if (parking.parkedByUs && previewWindow) this.pool.releasePreviewParking(sessionId, previewWindow);
        return { ok: false, reason: 'attach_failed' };
      }
    }

    const options = { ...DEFAULT_OPTIONS, ...opts };
    const preview: ActivePreview = {
      wc,
      dbg,
      options,
      attachedByUs: !wasAttached,
      timer: setInterval(() => {
        void this.capture(sessionId);
      }, options.intervalMs),
      inFlight: false,
      stopped: false,
      framesSent: 0,
      lastFrameLogAt: 0,
      parkedByUs: parking.parkedByUs,
    };

    this.previews.set(sessionId, preview);
    void this.capture(sessionId);

    mainLogger.info('SessionScreencast.start.ok', {
      sessionId,
      intervalMs: options.intervalMs,
      format: options.format,
      attachedByUs: preview.attachedByUs,
    });
    return { ok: true };
  }

  async stop(sessionId: string): Promise<void> {
    const preview = this.previews.get(sessionId);
    if (!preview) return;

    this.previews.delete(sessionId);
    preview.stopped = true;
    clearInterval(preview.timer);
    if (!preview.inFlight) this.cleanupPreview(sessionId, preview);

    mainLogger.info('SessionScreencast.stop.ok', {
      sessionId,
      framesSent: preview.framesSent,
    });
  }

  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.previews.keys()).map((id) => this.stop(id)));
  }

  isActive(sessionId: string): boolean {
    return this.previews.has(sessionId);
  }

  private async capture(sessionId: string): Promise<void> {
    const preview = this.previews.get(sessionId);
    if (!preview || preview.inFlight || preview.stopped) return;

    if (preview.wc.isDestroyed()) {
      await this.stop(sessionId);
      return;
    }

    preview.inFlight = true;
    try {
      const params: CaptureScreenshotParams = {
        format: preview.options.format,
        captureBeyondViewport: false,
        // The browser view is parked with a 1px window intersection so Chromium
        // keeps a compositor surface alive without covering the chat UI.
        fromSurface: true,
      };
      if (preview.options.format === 'jpeg') params.quality = preview.options.quality;

      const result = await withTimeout(
        preview.dbg.sendCommand('Page.captureScreenshot', params) as Promise<{ data?: unknown }>,
        CAPTURE_TIMEOUT_MS,
      );
      if (preview.stopped || this.previews.get(sessionId) !== preview) return;
      if (typeof result.data !== 'string' || result.data.length === 0) return;

      preview.framesSent += 1;
      const now = Date.now();
      if (preview.framesSent === 1 || now - preview.lastFrameLogAt >= 5000) {
        preview.lastFrameLogAt = now;
        mainLogger.info('SessionScreencast.frame', {
          sessionId,
          framesSent: preview.framesSent,
          bytes: result.data.length,
        });
      }
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('session-preview-frame', sessionId, result.data);
      }
    } catch (err) {
      const error = (err as Error).message;
      mainLogger.warn(error.startsWith('capture_timeout_') ? 'SessionScreencast.capture.timeout' : 'SessionScreencast.capture.error', { sessionId, error });
    } finally {
      preview.inFlight = false;
      if (preview.stopped) this.cleanupPreview(sessionId, preview);
    }
  }

  private cleanupPreview(sessionId: string, preview: ActivePreview): void {
    this.detachIfOwned(preview);
    if (!preview.parkedByUs) return;
    this.pool.releasePreviewParking(sessionId, this.window);
  }

  private detachIfOwned(preview: ActivePreview): void {
    if (!preview.attachedByUs || preview.wc.isDestroyed() || !preview.dbg.isAttached()) return;
    try {
      preview.dbg.detach();
    } catch (err) {
      mainLogger.debug('SessionScreencast.detach.error', { error: (err as Error).message });
    }
  }
}
