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
  ownerToken: string;
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

function ownerHint(ownerToken?: string): string | undefined {
  return ownerToken ? ownerToken.slice(-8) : undefined;
}

export class SessionScreencast {
  private readonly previews = new Map<string, ActivePreview>();
  private readonly startingOwners = new Map<string, Set<string>>();
  private readonly cancelledOwners = new Map<string, Set<string>>();
  private readonly pool: BrowserPool;
  private window: BrowserWindow | null = null;

  constructor(pool: BrowserPool) {
    this.pool = pool;
  }

  setWindow(win: BrowserWindow | null): void {
    this.window = win;
  }

  async start(sessionId: string, ownerToken = 'default', opts: Partial<PreviewOptions> = {}): Promise<{ ok: boolean; reason?: string }> {
    mainLogger.info('SessionScreencast.start.request', {
      sessionId,
      owner: ownerHint(ownerToken),
      active: this.previews.has(sessionId),
      startingOwners: this.startingOwners.get(sessionId)?.size ?? 0,
    });
    if (this.consumeCancelledOwner(sessionId, ownerToken)) {
      mainLogger.info('SessionScreencast.start.cancelledBeforeSetup', { sessionId, owner: ownerHint(ownerToken) });
      return { ok: false, reason: 'stopped' };
    }

    const active = this.previews.get(sessionId);
    if (active) {
      mainLogger.info('SessionScreencast.start.transferOwner', {
        sessionId,
        previousOwner: ownerHint(active.ownerToken),
        owner: ownerHint(ownerToken),
        framesSent: active.framesSent,
        inFlight: active.inFlight,
      });
      active.ownerToken = ownerToken;
      void this.capture(sessionId);
      return { ok: true };
    }

    this.rememberStartingOwner(sessionId, ownerToken);
    try {
      const previewWindow = this.window && !this.window.isDestroyed() ? this.window : null;
      const parking = previewWindow ? await this.pool.parkForPreview(sessionId, previewWindow) : { ok: true, parkedByUs: false };
      if (!parking.ok) {
        mainLogger.warn('SessionScreencast.start.parkFailed', {
          sessionId,
          owner: ownerHint(ownerToken),
          reason: parking.reason ?? 'park_failed',
        });
        return { ok: false, reason: parking.reason ?? 'park_failed' };
      }

      const wc = this.pool.getWebContents(sessionId);
      if (!wc || wc.isDestroyed()) {
        mainLogger.warn('SessionScreencast.start.noView', { sessionId, owner: ownerHint(ownerToken) });
        if (parking.parkedByUs && previewWindow) this.pool.releasePreviewParking(sessionId, previewWindow);
        return { ok: false, reason: 'no_view' };
      }

      const dbg = wc.debugger;
      const wasAttached = dbg.isAttached();
      const attachedByUs = !wasAttached;
      if (!wasAttached) {
        try {
          dbg.attach(CDP_PROTOCOL_VERSION);
        } catch (err) {
          mainLogger.warn('SessionScreencast.start.attachFailed', { sessionId, error: (err as Error).message });
          if (parking.parkedByUs && previewWindow) this.pool.releasePreviewParking(sessionId, previewWindow);
          return { ok: false, reason: 'attach_failed' };
        }
      }

      if (this.consumeCancelledOwner(sessionId, ownerToken)) {
        mainLogger.info('SessionScreencast.start.cancelledAfterAttach', {
          sessionId,
          owner: ownerHint(ownerToken),
          attachedByUs,
        });
        if (attachedByUs && !wc.isDestroyed() && dbg.isAttached()) {
          try { dbg.detach(); } catch { /* ignore cancelled start cleanup */ }
        }
        if (parking.parkedByUs && previewWindow) this.pool.releasePreviewParking(sessionId, previewWindow);
        return { ok: false, reason: 'stopped' };
      }

      const duplicate = this.previews.get(sessionId);
      if (duplicate) {
        mainLogger.info('SessionScreencast.start.duplicateAfterSetup', {
          sessionId,
          previousOwner: ownerHint(duplicate.ownerToken),
          owner: ownerHint(ownerToken),
          parkedByUs: parking.parkedByUs,
        });
        duplicate.ownerToken = ownerToken;
        if (parking.parkedByUs && previewWindow) this.pool.releasePreviewParking(sessionId, previewWindow);
        void this.capture(sessionId);
        return { ok: true };
      }

      const options = { ...DEFAULT_OPTIONS, ...opts };
      const preview: ActivePreview = {
        ownerToken,
        wc,
        dbg,
        options,
        attachedByUs,
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
        owner: ownerHint(ownerToken),
        intervalMs: options.intervalMs,
        format: options.format,
        attachedByUs: preview.attachedByUs,
        parkedByUs: preview.parkedByUs,
      });
      return { ok: true };
    } finally {
      this.forgetStartingOwner(sessionId, ownerToken);
      this.forgetCancelledOwner(sessionId, ownerToken);
    }
  }

  async stop(sessionId: string, ownerToken?: string): Promise<void> {
    mainLogger.info('SessionScreencast.stop.request', {
      sessionId,
      owner: ownerHint(ownerToken),
      activeOwner: ownerHint(this.previews.get(sessionId)?.ownerToken),
      active: this.previews.has(sessionId),
      startingOwners: this.startingOwners.get(sessionId)?.size ?? 0,
    });
    const preview = this.previews.get(sessionId);
    if (!preview) {
      if (ownerToken && this.hasStartingOwner(sessionId, ownerToken)) {
        this.rememberCancelledOwner(sessionId, ownerToken);
        mainLogger.info('SessionScreencast.stop.rememberCancelledStart', { sessionId, owner: ownerHint(ownerToken) });
      }
      return;
    }
    if (ownerToken && preview.ownerToken !== ownerToken) {
      if (this.hasStartingOwner(sessionId, ownerToken)) {
        this.rememberCancelledOwner(sessionId, ownerToken);
      }
      mainLogger.info('SessionScreencast.stop.ignoredStaleOwner', {
        sessionId,
        owner: ownerHint(ownerToken),
        activeOwner: ownerHint(preview.ownerToken),
      });
      return;
    }

    this.previews.delete(sessionId);
    preview.stopped = true;
    clearInterval(preview.timer);
    if (!preview.inFlight) this.cleanupPreview(sessionId, preview);

    mainLogger.info('SessionScreencast.stop.ok', {
      sessionId,
      owner: ownerHint(ownerToken),
      framesSent: preview.framesSent,
      inFlight: preview.inFlight,
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
          owner: ownerHint(preview.ownerToken),
          framesSent: preview.framesSent,
          bytes: result.data.length,
        });
      }
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('session-preview-frame', sessionId, result.data);
      }
    } catch (err) {
      const error = (err as Error).message;
      mainLogger.warn(error.startsWith('capture_timeout_') ? 'SessionScreencast.capture.timeout' : 'SessionScreencast.capture.error', {
        sessionId,
        owner: ownerHint(preview.ownerToken),
        activeOwner: ownerHint(this.previews.get(sessionId)?.ownerToken),
        attachedByUs: preview.attachedByUs,
        parkedByUs: preview.parkedByUs,
        stopped: preview.stopped,
        error,
      });
    } finally {
      preview.inFlight = false;
      if (preview.stopped) this.cleanupPreview(sessionId, preview);
    }
  }

  private cleanupPreview(sessionId: string, preview: ActivePreview): void {
    const active = this.previews.get(sessionId);
    if (active && active !== preview) {
      if (preview.attachedByUs && active.dbg === preview.dbg) active.attachedByUs = true;
      if (preview.parkedByUs) active.parkedByUs = true;
      mainLogger.info('SessionScreencast.cleanup.skipStalePreview', {
        sessionId,
        owner: ownerHint(preview.ownerToken),
        activeOwner: ownerHint(active.ownerToken),
        framesSent: preview.framesSent,
        transferredDebuggerOwnership: preview.attachedByUs && active.dbg === preview.dbg,
        transferredParkingOwnership: preview.parkedByUs,
      });
      return;
    }
    mainLogger.info('SessionScreencast.cleanup', {
      sessionId,
      owner: ownerHint(preview.ownerToken),
      framesSent: preview.framesSent,
      attachedByUs: preview.attachedByUs,
      parkedByUs: preview.parkedByUs,
    });
    this.detachIfOwned(preview);
    if (!preview.parkedByUs) return;
    this.pool.releasePreviewParking(sessionId, this.window);
  }

  private rememberStartingOwner(sessionId: string, ownerToken: string): void {
    let owners = this.startingOwners.get(sessionId);
    if (!owners) {
      owners = new Set();
      this.startingOwners.set(sessionId, owners);
    }
    owners.add(ownerToken);
  }

  private forgetStartingOwner(sessionId: string, ownerToken: string): void {
    const owners = this.startingOwners.get(sessionId);
    if (!owners) return;
    owners.delete(ownerToken);
    if (owners.size === 0) this.startingOwners.delete(sessionId);
  }

  private hasStartingOwner(sessionId: string, ownerToken: string): boolean {
    return this.startingOwners.get(sessionId)?.has(ownerToken) ?? false;
  }

  private rememberCancelledOwner(sessionId: string, ownerToken: string): void {
    let owners = this.cancelledOwners.get(sessionId);
    if (!owners) {
      owners = new Set();
      this.cancelledOwners.set(sessionId, owners);
    }
    owners.add(ownerToken);
  }

  private consumeCancelledOwner(sessionId: string, ownerToken: string): boolean {
    const owners = this.cancelledOwners.get(sessionId);
    if (!owners?.delete(ownerToken)) return false;
    if (owners.size === 0) this.cancelledOwners.delete(sessionId);
    return true;
  }

  private forgetCancelledOwner(sessionId: string, ownerToken: string): void {
    const owners = this.cancelledOwners.get(sessionId);
    if (!owners) return;
    owners.delete(ownerToken);
    if (owners.size === 0) this.cancelledOwners.delete(sessionId);
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
