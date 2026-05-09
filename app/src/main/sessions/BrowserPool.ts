import { WebContentsView, nativeTheme, type BrowserWindow, type WebContents } from 'electron';
import { browserLogger } from '../logger';
import { getWindowBackgroundColor } from '../themeMode';
import type { TabInfo } from './types';

const DEFAULT_BROWSER_WIDTH = 1280;
const DEFAULT_BROWSER_HEIGHT = 800;
const DEFAULT_MAX_CONCURRENT = 10;
const THROTTLED_FRAME_RATE = 4;
const IDLE_FRAME_RATE = 1;
const ACTIVE_FRAME_RATE = 60;
const DEFAULT_IDLE_FREEZE_DELAY_MS = 15_000;
const CDP_PROTOCOL_VERSION = '1.3';
// Emulated viewport pins height; width is computed per-attach from the
// physical rect's aspect ratio so the rendered page fills the box exactly
// (no letterboxing). A floor on width keeps sites in their desktop
// layout — media queries always see ≥1440px so tablet/mobile breakpoints
// never trigger.
const EMULATED_VIEWPORT_HEIGHT = 900;
const MIN_EMULATED_VIEWPORT_WIDTH = 1440;
const DEFAULT_EMULATED_VIEWPORT_WIDTH = 1440;
// Cap how wide we let the emulated viewport grow. Past this, sites like
// X/Twitter shift to an "ultra-wide" centered layout that leaves a fat
// dead band on one side. Above the cap we letterbox (centered) instead.
const MAX_EMULATED_VIEWPORT_WIDTH = 1600;

interface PoolEntry {
  sessionId: string;
  view: WebContentsView;
  createdAt: number;
  attached: boolean;
  emulatedWidth: number;
  idleFreezeEligible: boolean;
  frozen: boolean;
  freezeTimer: ReturnType<typeof setTimeout> | null;
}

function readIdleFreezeDelayMs(): number {
  const raw = process.env.BU_IDLE_BROWSER_FREEZE_DELAY_MS;
  if (raw == null || raw.trim() === '') return DEFAULT_IDLE_FREEZE_DELAY_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_IDLE_FREEZE_DELAY_MS;
  return value;
}

export class BrowserPool {
  private entries: Map<string, PoolEntry> = new Map();
  private maxConcurrent: number;
  private queue: string[] = [];
  private onGone?: (sessionId: string) => void;
  private onNavigate?: (sessionId: string, url: string) => void;
  private onInterruptShortcut?: (sessionId: string) => boolean | void;
  private idleFreezeDelayMs: number;

  constructor(maxConcurrent = DEFAULT_MAX_CONCURRENT, opts: { idleFreezeDelayMs?: number } = {}) {
    this.maxConcurrent = maxConcurrent;
    this.idleFreezeDelayMs = opts.idleFreezeDelayMs ?? readIdleFreezeDelayMs();
    browserLogger.info('BrowserPool.init', { maxConcurrent });

    // Repaint every pooled view (attached AND detached) when the theme
    // flips. themeMode.applyBackgroundToAllWindows only walks attached
    // contentView children, so a session sitting at "Browser not started
    // yet" while the user toggles theme would otherwise carry stale bg
    // until next attach.
    nativeTheme.on('updated', () => {
      const color = getWindowBackgroundColor();
      for (const entry of this.entries.values()) {
        try { entry.view.setBackgroundColor(color); } catch { /* view destroyed */ }
      }
    });
  }

  /** Register a listener that fires when a session's WebContents is gone
   *  (destroyed, crashed, or explicitly closed). Used to push a browser-gone
   *  notification to the renderer so the UI can stop showing "Browser starting…". */
  setOnGone(listener: (sessionId: string) => void): void {
    this.onGone = listener;
  }

  /** Register a listener that fires on every top-frame navigation (including
   *  in-page hash/pushState). Used by SessionManager to keep session.primarySite
   *  in sync with the actual browser — the source of truth, not tool-call args. */
  setOnNavigate(listener: (sessionId: string, url: string) => void): void {
    this.onNavigate = listener;
  }

  /** Register a listener for Ctrl+C inside an attached browser view. Returning
   *  true means the keypress was handled and should not continue into the page. */
  setOnInterruptShortcut(listener: (sessionId: string) => boolean | void): void {
    this.onInterruptShortcut = listener;
  }

  private notifyGone(sessionId: string): void {
    try { this.onGone?.(sessionId); } catch (err) {
      browserLogger.warn('BrowserPool.notifyGone.listenerError', { sessionId, error: (err as Error).message });
    }
  }

  private notifyNavigate(sessionId: string, url: string): void {
    try { this.onNavigate?.(sessionId, url); } catch (err) {
      browserLogger.warn('BrowserPool.notifyNavigate.listenerError', { sessionId, error: (err as Error).message });
    }
  }

  private notifyInterruptShortcut(sessionId: string): boolean {
    try { return this.onInterruptShortcut?.(sessionId) === true; } catch (err) {
      browserLogger.warn('BrowserPool.notifyInterruptShortcut.listenerError', { sessionId, error: (err as Error).message });
      return false;
    }
  }

  get activeCount(): number {
    return this.entries.size;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  canCreate(): boolean {
    return this.entries.size < this.maxConcurrent;
  }

  create(sessionId: string, sessionStartedAt?: number): WebContentsView | null {
    if (this.entries.has(sessionId)) {
      browserLogger.warn('BrowserPool.create.duplicate', { sessionId });
      return this.entries.get(sessionId)!.view;
    }

    if (!this.canCreate()) {
      this.queue.push(sessionId);
      browserLogger.warn('BrowserPool.create.queued', {
        sessionId,
        activeCount: this.entries.size,
        maxConcurrent: this.maxConcurrent,
        queuePosition: this.queue.length,
      });
      return null;
    }

    const startupStartedAt = Date.now();
    const timingStartedAt = sessionStartedAt ?? startupStartedAt;
    const startupMs = (): number => Date.now() - startupStartedAt;
    const sessionMs = (): number => Date.now() - timingStartedAt;
    browserLogger.info('BrowserPool.startup.start', {
      sessionId,
      component: 'BrowserPool',
      area: 'startup',
      event: 'start',
      msSinceSessionStart: sessionMs(),
      activeCount: this.entries.size,
      maxConcurrent: this.maxConcurrent,
    });

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: true,
      },
    });
    // Without this, attach/detach during view swaps briefly paints black
    // (Chromium's default before the page commits its first frame).
    view.setBackgroundColor(getWindowBackgroundColor());
    browserLogger.info('BrowserPool.startup.constructed', {
      sessionId,
      component: 'BrowserPool',
      area: 'startup',
      event: 'constructed',
      msSinceCreate: startupMs(),
      msSinceSessionStart: sessionMs(),
      pid: view.webContents.getOSProcessId(),
      wcId: view.webContents.id,
    });

    view.setBounds({
      x: 0,
      y: 0,
      width: DEFAULT_BROWSER_WIDTH,
      height: DEFAULT_BROWSER_HEIGHT,
    });

    // Anti-detection: replace the Electron default UA with a vanilla Chrome UA.
    // The default contains TWO bot tells — the app name token (`app/x.y.z`)
    // injected by Electron between `Gecko)` and `Chrome/`, and the Electron
    // token (`Electron/x.y.z`) before `Safari/`. Strip both. We keep the real
    // bundled Chromium version (process.versions.chrome) so feature-detection,
    // Sec-CH-UA hints, and TLS fingerprint stay coherent with the engine.
    try {
      const defaultUa = view.webContents.getUserAgent();
      const cleanedUa = defaultUa
        .replace(/\sElectron\/\S+/, '')
        .replace(/\s[A-Za-z][\w-]*\/\d+\.\d+\.\d+(?=\sChrome\/)/, '');
      if (cleanedUa !== defaultUa) {
        view.webContents.setUserAgent(cleanedUa);
        browserLogger.info('BrowserPool.userAgent.stripped', { sessionId, before: defaultUa, after: cleanedUa });
      }
    } catch (err) {
      browserLogger.warn('BrowserPool.userAgent.error', { sessionId, error: (err as Error).message });
    }

    // Anti-detection: hide `navigator.webdriver` on every frame load. Runs in
    // the page's isolated world via executeJavaScript — does not touch the
    // CDP session the agent uses, so driving behavior is unaffected.
    const hideWebdriver = (): void => {
      if (view.webContents.isDestroyed()) return;
      view.webContents.executeJavaScript(
        "try{Object.defineProperty(Navigator.prototype,'webdriver',{get:()=>undefined,configurable:true})}catch(e){}",
        true,
      ).catch(() => { /* frame may have navigated away */ });
    };
    view.webContents.on('dom-ready', hideWebdriver);
    view.webContents.on('before-input-event', (event, input) => {
      if (
        input.type === 'keyDown' &&
        input.key.toLowerCase() === 'c' &&
        input.control &&
        !input.meta &&
        !input.alt
      ) {
        const handled = this.notifyInterruptShortcut(sessionId);
        if (handled) event.preventDefault();
      }
    });

    view.webContents.setFrameRate(THROTTLED_FRAME_RATE);

    // Pin the embedded page's viewport to a fixed desktop size so sites
    // always render their desktop layout — no tablet/mobile reflow.
    //
    // Strategy: emulate screen/view at EMULATED_VIEWPORT_* (for media
    // queries / window.innerWidth) but leave fitToView=false so Chromium
    // renders at natural size. We then scale the visible content down via
    // webContents.setZoomFactor so it fits the physical WebContentsView
    // rect. setZoomFactor doesn't change CSS viewport, so the page still
    // thinks it's 1440-wide even though we're drawing it smaller. Input
    // coordinates are scaled correctly by Chromium's zoom pipeline, so
    // clicks and scrolls land on the right DOM elements.
    const applyEmulation = (): void => {
      try {
        if (view.webContents.isDestroyed()) return;
        const width = this.entries.get(sessionId)?.emulatedWidth ?? DEFAULT_EMULATED_VIEWPORT_WIDTH;
        // `fitToView` is accepted at runtime but missing from Electron's
        // Parameters typedef; cast to loosen the shape.
        view.webContents.enableDeviceEmulation({
          screenSize: { width, height: EMULATED_VIEWPORT_HEIGHT },
          viewSize:   { width, height: EMULATED_VIEWPORT_HEIGHT },
          deviceScaleFactor: 1,
          viewPosition: { x: 0, y: 0 },
          screenPosition: 'desktop',
          fitToView: false,
          offset: { x: 0, y: 0 },
          scale: 1,
        } as Parameters<typeof view.webContents.enableDeviceEmulation>[0]);
        browserLogger.info('BrowserPool.deviceEmulation.applied', {
          sessionId,
          operationalViewport: {
            width,
            height: EMULATED_VIEWPORT_HEIGHT,
            note: 'what the page sees via window.innerWidth / media queries',
          },
        });
      } catch (err) {
        browserLogger.warn('BrowserPool.deviceEmulation.error', {
          sessionId,
          error: (err as Error).message,
        });
      }
    };
    view.webContents.once('did-start-loading', applyEmulation);
    view.webContents.on('did-finish-load', applyEmulation);

    const entry: PoolEntry = {
      sessionId,
      view,
      createdAt: startupStartedAt,
      attached: false,
      emulatedWidth: DEFAULT_EMULATED_VIEWPORT_WIDTH,
      idleFreezeEligible: false,
      frozen: false,
      freezeTimer: null,
    };

    this.entries.set(sessionId, entry);

    // Fire onGone if the renderer process crashes, closes, or otherwise dies
    // out-of-band so the UI can react (stop showing "Browser starting…").
    const wc = view.webContents;
    let navigationSeq = 0;
    let currentNavigation: { id: number; url: string; startedAt: number } | null = null;

    const navigationElapsedMs = (): number | null =>
      currentNavigation ? Date.now() - currentNavigation.startedAt : null;

    wc.once('did-start-loading', () => {
      browserLogger.info('BrowserPool.startup.didStartLoading', {
        sessionId,
        component: 'BrowserPool',
        area: 'startup',
        event: 'didStartLoading',
        msSinceCreate: startupMs(),
        msSinceSessionStart: sessionMs(),
        pid: wc.getOSProcessId(),
        wcId: wc.id,
        url: wc.getURL(),
      });
    });
    wc.once('dom-ready', () => {
      browserLogger.info('BrowserPool.startup.domReady', {
        sessionId,
        component: 'BrowserPool',
        area: 'startup',
        event: 'domReady',
        msSinceCreate: startupMs(),
        msSinceSessionStart: sessionMs(),
        pid: wc.getOSProcessId(),
        wcId: wc.id,
        url: wc.getURL(),
      });
    });
    wc.once('did-finish-load', () => {
      browserLogger.info('BrowserPool.startup.didFinishLoad', {
        sessionId,
        component: 'BrowserPool',
        area: 'startup',
        event: 'didFinishLoad',
        msSinceCreate: startupMs(),
        msSinceSessionStart: sessionMs(),
        pid: wc.getOSProcessId(),
        wcId: wc.id,
        url: wc.getURL(),
      });
    });
    wc.once('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      browserLogger.warn('BrowserPool.startup.didFailLoad', {
        sessionId,
        component: 'BrowserPool',
        area: 'startup',
        event: 'didFailLoad',
        msSinceCreate: startupMs(),
        msSinceSessionStart: sessionMs(),
        pid: wc.getOSProcessId(),
        wcId: wc.id,
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      });
    });
    wc.on('destroyed', () => {
      browserLogger.info('BrowserPool.wc.destroyed', { sessionId, msSinceCreate: startupMs() });
      const entry = this.entries.get(sessionId);
      if (entry) this.clearIdleFreezeTimer(entry);
      this.entries.delete(sessionId);
      this.notifyGone(sessionId);
    });
    wc.on('render-process-gone', (_event, details) => {
      browserLogger.warn('BrowserPool.wc.renderProcessGone', { sessionId, reason: details.reason, msSinceCreate: startupMs() });
      this.notifyGone(sessionId);
    });
    wc.on('did-start-navigation', (_event, url, isInPlace, isMainFrame, frameProcessId, frameRoutingId) => {
      if (!isMainFrame) return;
      navigationSeq += 1;
      currentNavigation = { id: navigationSeq, url, startedAt: Date.now() };
      browserLogger.info('BrowserPool.navigation.start', {
        sessionId,
        component: 'BrowserPool',
        area: 'navigation',
        event: 'start',
        navigationId: currentNavigation.id,
        url,
        msSinceBrowserCreate: startupMs(),
        msSinceSessionStart: sessionMs(),
        isInPlace,
        isMainFrame,
        frameProcessId,
        frameRoutingId,
        pid: wc.getOSProcessId(),
        wcId: wc.id,
      });
    });
    wc.on('did-redirect-navigation', (_event, url, isInPlace, isMainFrame, frameProcessId, frameRoutingId) => {
      if (!isMainFrame) return;
      const msSinceNavigationStart = navigationElapsedMs();
      if (currentNavigation) currentNavigation.url = url;
      browserLogger.info('BrowserPool.navigation.redirect', {
        sessionId,
        component: 'BrowserPool',
        area: 'navigation',
        event: 'redirect',
        navigationId: currentNavigation?.id ?? null,
        url,
        isInPlace,
        isMainFrame,
        frameProcessId,
        frameRoutingId,
        msSinceNavigationStart,
        msSinceBrowserCreate: startupMs(),
        msSinceSessionStart: sessionMs(),
        pid: wc.getOSProcessId(),
        wcId: wc.id,
      });
    });
    // Top-frame navigation — full page load. Covers agent-driven goto(),
    // user clicks on links, form submits, history back/forward, etc.
    wc.on('did-navigate', (_event, url) => {
      browserLogger.info('BrowserPool.navigation.didNavigate', {
        sessionId,
        component: 'BrowserPool',
        area: 'navigation',
        event: 'didNavigate',
        navigationId: currentNavigation?.id ?? null,
        url,
        startedUrl: currentNavigation?.url ?? null,
        msSinceNavigationStart: navigationElapsedMs(),
        msSinceBrowserCreate: startupMs(),
        msSinceSessionStart: sessionMs(),
        pid: wc.getOSProcessId(),
        wcId: wc.id,
      });
      this.notifyNavigate(sessionId, url);
    });
    wc.on('did-finish-load', () => {
      if (!currentNavigation) return;
      browserLogger.info('BrowserPool.navigation.didFinishLoad', {
        sessionId,
        component: 'BrowserPool',
        area: 'navigation',
        event: 'didFinishLoad',
        navigationId: currentNavigation.id,
        url: wc.getURL(),
        startedUrl: currentNavigation.url,
        msSinceNavigationStart: navigationElapsedMs(),
        msSinceBrowserCreate: startupMs(),
        msSinceSessionStart: sessionMs(),
        pid: wc.getOSProcessId(),
        wcId: wc.id,
      });
      currentNavigation = null;
    });
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      browserLogger.warn('BrowserPool.navigation.didFailLoad', {
        sessionId,
        component: 'BrowserPool',
        area: 'navigation',
        event: 'didFailLoad',
        navigationId: currentNavigation?.id ?? null,
        validatedURL,
        startedUrl: currentNavigation?.url ?? null,
        msSinceNavigationStart: navigationElapsedMs(),
        msSinceBrowserCreate: startupMs(),
        msSinceSessionStart: sessionMs(),
        errorCode,
        errorDescription,
        pid: wc.getOSProcessId(),
        wcId: wc.id,
      });
      if (errorCode !== -3) currentNavigation = null;
    });
    // SPA/hash navigation — pushState, replaceState, hash changes. Many
    // sites (x.com, linkedin, gmail) never fire did-navigate after the
    // initial load, so without this the primarySite gets stuck on the
    // first URL and misses SPA route changes.
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) {
        browserLogger.info('BrowserPool.navigation.inPage', {
          sessionId,
          component: 'BrowserPool',
          area: 'navigation',
          event: 'inPage',
          url,
          msSinceBrowserCreate: startupMs(),
          msSinceSessionStart: sessionMs(),
          pid: wc.getOSProcessId(),
          wcId: wc.id,
        });
        this.notifyNavigate(sessionId, url);
      }
    });

    browserLogger.info('BrowserPool.create', {
      sessionId,
      activeCount: this.entries.size,
      maxConcurrent: this.maxConcurrent,
      pid: view.webContents.getOSProcessId(),
    });

    return view;
  }

  getWebContents(sessionId: string): WebContents | null {
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    return entry.view.webContents;
  }

  getView(sessionId: string): WebContentsView | null {
    const entry = this.entries.get(sessionId);
    return entry?.view ?? null;
  }

  async markSessionActive(sessionId: string): Promise<void> {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.idleFreezeEligible = false;
    this.clearIdleFreezeTimer(entry);
    this.applyFrameRate(entry);
    await this.setLifecycleState(entry, 'active', 'session-active');
  }

  markSessionIdle(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.idleFreezeEligible = true;
    this.applyFrameRate(entry);
    this.scheduleIdleFreeze(entry, 'session-idle');
  }

  private clearIdleFreezeTimer(entry: PoolEntry): void {
    if (!entry.freezeTimer) return;
    clearTimeout(entry.freezeTimer);
    entry.freezeTimer = null;
  }

  private frameRateFor(entry: PoolEntry): number {
    if (entry.attached) return ACTIVE_FRAME_RATE;
    return entry.idleFreezeEligible ? IDLE_FRAME_RATE : THROTTLED_FRAME_RATE;
  }

  private applyFrameRate(entry: PoolEntry): void {
    try {
      entry.view.webContents.setFrameRate(this.frameRateFor(entry));
    } catch (err) {
      browserLogger.warn('BrowserPool.frameRate.error', {
        sessionId: entry.sessionId,
        error: (err as Error).message,
      });
    }
  }

  private scheduleIdleFreeze(entry: PoolEntry, reason: string): void {
    this.clearIdleFreezeTimer(entry);
    if (!entry.idleFreezeEligible || entry.attached || this.idleFreezeDelayMs <= 0) return;

    entry.freezeTimer = setTimeout(() => {
      entry.freezeTimer = null;
      const current = this.entries.get(entry.sessionId);
      if (current !== entry) return;
      void this.freezeIfStillIdle(entry, reason);
    }, this.idleFreezeDelayMs);
  }

  private async freezeIfStillIdle(entry: PoolEntry, reason: string): Promise<void> {
    if (!entry.idleFreezeEligible || entry.attached || entry.frozen) return;
    const wc = entry.view.webContents;
    if (wc.isDestroyed()) return;
    if (wc.isCurrentlyAudible()) {
      browserLogger.info('BrowserPool.freeze.skippedAudible', { sessionId: entry.sessionId, reason });
      this.scheduleIdleFreeze(entry, 'audible-retry');
      return;
    }

    await this.setLifecycleState(entry, 'frozen', reason);
  }

  private async wakeForVisibility(entry: PoolEntry, reason: string): Promise<void> {
    this.clearIdleFreezeTimer(entry);
    await this.setLifecycleState(entry, 'active', reason);
  }

  private async setLifecycleState(entry: PoolEntry, state: 'active' | 'frozen', reason: string): Promise<void> {
    const wc = entry.view.webContents;
    if (wc.isDestroyed()) return;
    if (state === 'active' && !entry.frozen) return;
    if (state === 'frozen' && entry.frozen) return;

    const dbg = wc.debugger;
    const wasAttached = dbg.isAttached();
    try {
      if (!wasAttached) dbg.attach(CDP_PROTOCOL_VERSION);
      await dbg.sendCommand('Page.setWebLifecycleState', { state });
      entry.frozen = state === 'frozen';
      browserLogger.info('BrowserPool.lifecycleState', {
        sessionId: entry.sessionId,
        state,
        reason,
      });
    } catch (err) {
      browserLogger.debug('BrowserPool.lifecycleState.error', {
        sessionId: entry.sessionId,
        state,
        reason,
        error: (err as Error).message,
      });
    } finally {
      if (!wasAttached) {
        try { dbg.detach(); } catch { /* debugger may have detached during navigation */ }
      }
    }
  }

  /** Center + shrink the view rect inside the hub box if the emulated
   *  viewport is narrower than the rect (after zoom-to-fit on height).
   *  Otherwise the rect is used as-is. */
  private fitBoundsToView(
    emulatedWidth: number,
    bounds: { x: number; y: number; width: number; height: number },
    zoom: number,
  ): { x: number; y: number; width: number; height: number } {
    const renderedWidth = Math.round(emulatedWidth * zoom);
    if (renderedWidth >= bounds.width) return bounds;
    return {
      x: bounds.x + Math.round((bounds.width - renderedWidth) / 2),
      y: bounds.y,
      width: renderedWidth,
      height: bounds.height,
    };
  }

  private zoomForBounds(bounds: { height: number }): number {
    return Math.max(0.25, Math.min(1, bounds.height / EMULATED_VIEWPORT_HEIGHT));
  }

  private currentZoomForBounds(entry: PoolEntry, bounds: { height: number }): number {
    try {
      const zoom = entry.view.webContents.getZoomFactor();
      if (Number.isFinite(zoom) && zoom > 0) return zoom;
    } catch (err) {
      browserLogger.warn('BrowserPool.zoom.getZoomFactor.error', { sessionId: entry.sessionId, error: (err as Error).message });
    }
    return this.zoomForBounds(bounds);
  }

  /** Public helper for the resize fast path: applies the same fit/center
   *  logic as attach so the rendered page stays centered as the hub layout
   *  changes. Returns true if the view exists and bounds were applied. */
  setViewBoundsFitted(sessionId: string, bounds: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } | null {
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    const currentZoom = this.currentZoomForBounds(entry, bounds);
    const fitted = this.fitBoundsToView(entry.emulatedWidth, bounds, currentZoom);
    entry.view.setBounds(fitted);
    return fitted;
  }

  attachToWindow(sessionId: string, window: BrowserWindow, bounds: { x: number; y: number; width: number; height: number }): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry) {
      browserLogger.warn('BrowserPool.attach.notFound', { sessionId });
      return false;
    }

    // Re-apply the resolved theme bg every attach. While detached, the view
    // isn't a child of any window's contentView, so it misses the
    // theme-broadcast loop in themeMode.applyBackgroundToAllWindows() and
    // would otherwise paint with whatever bg it had at create time.
    try { entry.view.setBackgroundColor(getWindowBackgroundColor()); } catch { /* noop */ }

    if (entry.attached) {
      browserLogger.debug('BrowserPool.attach.alreadyAttached', { sessionId });
      const currentZoom = this.currentZoomForBounds(entry, bounds);
      entry.view.setBounds(this.fitBoundsToView(entry.emulatedWidth, bounds, currentZoom));
      // Don't touch zoom here — user's manual zoom (Cmd+=/Cmd+-) should
      // persist across attach cycles.
      return true;
    }

    // Match emulated width to the physical rect's aspect ratio (height pinned
    // at EMULATED_VIEWPORT_HEIGHT) so the scaled render fills the box. Clamp
    // to [MIN, MAX]: floor keeps desktop media queries triggered; cap stops
    // sites from shifting into ultra-wide centered layouts that leave dead
    // bands. When clamped, we shrink + center the view rect so the leftover
    // splits evenly on both sides (cosmetic letterbox) rather than piling up
    // on one edge.
    const aspectWidth = Math.round(EMULATED_VIEWPORT_HEIGHT * bounds.width / bounds.height);
    const emulatedWidth = Math.max(MIN_EMULATED_VIEWPORT_WIDTH, Math.min(MAX_EMULATED_VIEWPORT_WIDTH, aspectWidth));
    entry.emulatedWidth = emulatedWidth;
    const zoom = this.zoomForBounds(bounds);

    const fittedBounds = this.fitBoundsToView(emulatedWidth, bounds, zoom);
    entry.view.setBounds(fittedBounds);
    window.contentView.addChildView(entry.view);
    entry.attached = true;
    void this.wakeForVisibility(entry, 'attach');

    try {
      entry.view.webContents.enableDeviceEmulation({
        screenSize: { width: emulatedWidth, height: EMULATED_VIEWPORT_HEIGHT },
        viewSize:   { width: emulatedWidth, height: EMULATED_VIEWPORT_HEIGHT },
        deviceScaleFactor: 1,
        viewPosition: { x: 0, y: 0 },
        screenPosition: 'desktop',
        fitToView: false,
        offset: { x: 0, y: 0 },
        scale: 1,
      } as Parameters<typeof entry.view.webContents.enableDeviceEmulation>[0]);
    } catch (err) {
      browserLogger.warn('BrowserPool.attach.enableDeviceEmulation.error', { sessionId, error: (err as Error).message });
    }

    this.applyFrameRate(entry);

    // Scale the rendered page so the emulated viewport fills the physical
    // rect. With aspect-matched emulatedWidth, both axes give the same zoom
    // (modulo rounding), so we just use the height axis.
    try {
      entry.view.webContents.setZoomFactor(zoom);
    } catch (err) {
      browserLogger.warn('BrowserPool.attach.setZoomFactor.error', { sessionId, zoom, error: (err as Error).message });
    }

    browserLogger.info('BrowserPool.attach', {
      sessionId,
      visualBounds: bounds,
      fittedBounds,
      operationalViewport: { width: emulatedWidth, height: EMULATED_VIEWPORT_HEIGHT },
      rectAspect: bounds.width / bounds.height,
      emulatedAspect: emulatedWidth / EMULATED_VIEWPORT_HEIGHT,
      zoomFactor: zoom,
      frameRate: this.frameRateFor(entry),
    });

    return true;
  }

  detachFromWindow(sessionId: string, window: BrowserWindow): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry) {
      browserLogger.warn('BrowserPool.detach.notFound', { sessionId });
      return false;
    }

    if (!entry.attached) {
      browserLogger.debug('BrowserPool.detach.notAttached', { sessionId });
      return false;
    }

    window.contentView.removeChildView(entry.view);
    entry.attached = false;

    this.applyFrameRate(entry);
    this.scheduleIdleFreeze(entry, 'detached');

    browserLogger.info('BrowserPool.detach', {
      sessionId,
      frameRate: this.frameRateFor(entry),
      idleFreezeEligible: entry.idleFreezeEligible,
    });

    return true;
  }

  detachAll(window: BrowserWindow): void {
    const ids = Array.from(this.entries.keys());
    for (const id of ids) {
      this.detachFromWindow(id, window);
    }
    browserLogger.info('BrowserPool.detachAll', { count: ids.length });
  }

  temporarilyDetachAll(window: BrowserWindow): void {
    for (const entry of this.entries.values()) {
      if (entry.attached) {
        window.contentView.removeChildView(entry.view);
        try {
          entry.view.webContents.setFrameRate(entry.idleFreezeEligible ? IDLE_FRAME_RATE : THROTTLED_FRAME_RATE);
        } catch (err) {
          browserLogger.warn('BrowserPool.temporarilyDetachAll.frameRate.error', {
            sessionId: entry.sessionId,
            error: (err as Error).message,
          });
        }
      }
    }
    browserLogger.info('BrowserPool.temporarilyDetachAll');
  }

  reattachAll(window: BrowserWindow): void {
    for (const entry of this.entries.values()) {
      if (entry.attached) {
        window.contentView.addChildView(entry.view);
        void this.wakeForVisibility(entry, 'reattach');
        this.applyFrameRate(entry);
      }
    }
    browserLogger.info('BrowserPool.reattachAll');
  }

  async getTabs(sessionId: string): Promise<TabInfo[]> {
    const wc = this.getWebContents(sessionId);
    if (!wc) return [];

    try {
      const url = wc.getURL();
      const title = wc.getTitle();

      return [{
        targetId: String(wc.id),
        url: url || 'about:blank',
        title: title || 'New Tab',
        type: 'page',
        active: true,
      }];
    } catch (err) {
      browserLogger.warn('BrowserPool.getTabs.error', {
        sessionId,
        error: (err as Error).message,
      });
      return [];
    }
  }

  destroy(sessionId: string, window?: BrowserWindow): void {
    const entry = this.entries.get(sessionId);
    if (!entry) {
      browserLogger.debug('BrowserPool.destroy.notFound', { sessionId });
      return;
    }

    if (entry.attached && window) {
      try {
        window.contentView.removeChildView(entry.view);
      } catch (err) {
        browserLogger.warn('BrowserPool.destroy.detachError', {
          sessionId,
          error: (err as Error).message,
        });
      }
    }

    const lifetimeMs = Date.now() - entry.createdAt;
    this.clearIdleFreezeTimer(entry);

    // Delete from map first so the wc.on('destroyed') listener's notifyGone
    // is a clean no-op (it still fires, but the entry is already gone).
    this.entries.delete(sessionId);

    const wc = entry.view.webContents;
    let closed = false;
    try {
      if (!wc.isDestroyed()) {
        (wc as unknown as { close: (opts?: { waitForBeforeUnload?: boolean }) => void }).close();
        closed = true;
      }
    } catch (err) {
      browserLogger.warn('BrowserPool.destroy.closeError', {
        sessionId,
        error: (err as Error).message,
      });
    }

    // wc.close() doesn't always destroy embedded WebContents synchronously
    // (or at all, for views without an unload handler). Force teardown on the
    // next tick if it's still alive — this fires the `destroyed` listener,
    // which also calls notifyGone (idempotent on the renderer).
    setImmediate(() => {
      try {
        if (!wc.isDestroyed()) {
          (wc as unknown as { destroy?: () => void }).destroy?.();
        }
      } catch (err) {
        browserLogger.warn('BrowserPool.destroy.forceError', {
          sessionId,
          error: (err as Error).message,
        });
      }
    });

    // Notify renderer synchronously so "Browser ended" paints immediately —
    // we don't want to wait for the wc.destroyed event, which may be delayed
    // or never fire if close() is a no-op.
    this.notifyGone(sessionId);

    browserLogger.info('BrowserPool.destroy', {
      sessionId,
      lifetimeMs,
      remainingActive: this.entries.size,
      closed,
    });

    this.drainQueue();
  }

  destroyAll(window?: BrowserWindow): void {
    const sessionIds = Array.from(this.entries.keys());
    browserLogger.info('BrowserPool.destroyAll', { count: sessionIds.length });

    for (const sessionId of sessionIds) {
      this.destroy(sessionId, window);
    }

    this.queue.length = 0;
  }

  isAttached(sessionId: string): boolean {
    const entry = this.entries.get(sessionId);
    return entry?.attached ?? false;
  }

  getStats(): {
    active: number;
    queued: number;
    maxConcurrent: number;
    sessions: Array<{ sessionId: string; attached: boolean; createdAt: number; pid: number }>;
  } {
    const sessions = Array.from(this.entries.values()).map((e) => ({
      sessionId: e.sessionId,
      attached: e.attached,
      createdAt: e.createdAt,
      pid: e.view.webContents.getOSProcessId(),
    }));

    return {
      active: this.entries.size,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      sessions,
    };
  }

  private drainQueue(): void {
    while (this.queue.length > 0 && this.canCreate()) {
      const nextSessionId = this.queue.shift()!;
      browserLogger.info('BrowserPool.drainQueue', {
        sessionId: nextSessionId,
        remainingQueued: this.queue.length,
      });
      // The session manager will need to call create() again for this session.
      // We emit the session ID so the caller knows to retry.
      // For now, just log — the session manager polls canCreate().
    }
  }
}
