/**
 * Track B — Pill BrowserWindow lifecycle.
 *
 * Creates and manages the transparent frameless overlay window used for the
 * Cmd+K pill UX. The window is created hidden at app-ready and shown/hidden
 * on hotkey toggle.
 *
 * Design decisions (from plan §5 Track B):
 * - width: 560, height: 72 initial; grows downward with toast/result
 * - transparent: true, frame: false, alwaysOnTop: true, hasShadow: true
 * - Positioned at center-top of the active display on show
 * - Show latency measured from toggle entry to window.show() call (p95 ≤ 150ms)
 *
 * D2: Verbose dev-only logging on all lifecycle events.
 */

import { app, BrowserWindow, screen, type Rectangle } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentEvent } from '../shared/types';
import { mainLogger, rendererLogger } from './logger';

// ---------------------------------------------------------------------------
// Scoped logger shim — delegates to mainLogger with component prefix
// ---------------------------------------------------------------------------

const log = {
  debug: (comp: string, ctx: object) => mainLogger.debug(comp, ctx as Record<string, unknown>),
  info:  (comp: string, ctx: object) => mainLogger.info(comp, ctx as Record<string, unknown>),
  warn:  (comp: string, ctx: object) => mainLogger.warn(comp, ctx as Record<string, unknown>),
  error: (comp: string, ctx: object) => mainLogger.error(comp, ctx as Record<string, unknown>),
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PILL_WIDTH = 600;
const PILL_HEIGHT_COLLAPSED = 110;
const PILL_HEIGHT_EXPANDED = 520;
const PILL_TOP_OFFSET = 160;
const PILL_BOUNDS_FILE_NAME = 'pill-bounds.json';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let pillWindow: BrowserWindow | null = null;
let requestedPillHeight = PILL_HEIGHT_COLLAPSED;
let savedPillBounds: PillBounds | null = null;
let programmaticBoundsChangeUntil = 0;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute the x position so the pill is horizontally centered on the display
 * nearest the cursor.
 */
interface PillBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clampPillHeight(height: number): number {
  return Math.max(PILL_HEIGHT_COLLAPSED, Math.min(height, PILL_HEIGHT_EXPANDED));
}

function boundsStorePath(): string {
  return path.join(app.getPath('userData'), PILL_BOUNDS_FILE_NAME);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampToRange(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(value, max));
}

function rectsIntersect(a: Rectangle, b: Rectangle): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function visibleAreaForBounds(bounds: PillBounds): Rectangle | null {
  try {
    const displays = screen.getAllDisplays();
    const areas = displays.map((display) => display.workArea ?? display.bounds);
    return areas.find((area) => rectsIntersect(bounds, area)) ?? null;
  } catch (err) {
    log.warn('pill.visibleAreaForBounds', {
      message: 'Failed to get displays for saved pill bounds',
      error: (err as Error).message,
    });
    return null;
  }
}

function loadSavedPillBounds(): PillBounds | null {
  try {
    const raw = fs.readFileSync(boundsStorePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PillBounds>;
    if (!isFiniteNumber(parsed.x) || !isFiniteNumber(parsed.y)) {
      log.warn('pill.loadSavedBounds.invalid', { message: 'Saved pill bounds missing valid coordinates' });
      return null;
    }
    return {
      x: Math.round(parsed.x),
      y: Math.round(parsed.y),
      width: PILL_WIDTH,
      height: clampPillHeight(isFiniteNumber(parsed.height) ? parsed.height : requestedPillHeight),
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && code !== 'ENOENT') {
      log.warn('pill.loadSavedBounds.failed', { error: (err as Error).message });
    }
    return null;
  }
}

function savePillBounds(bounds: PillBounds): void {
  const toSave: PillBounds = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: PILL_WIDTH,
    height: clampPillHeight(bounds.height),
  };

  try {
    fs.mkdirSync(path.dirname(boundsStorePath()), { recursive: true });
    fs.writeFileSync(boundsStorePath(), JSON.stringify(toSave, null, 2), 'utf-8');
    savedPillBounds = toSave;
    log.debug('pill.saveBounds.ok', { bounds: toSave });
  } catch (err) {
    log.warn('pill.saveBounds.failed', { error: (err as Error).message });
  }
}

function beginProgrammaticBoundsChange(durationMs = 200): void {
  programmaticBoundsChangeUntil = Date.now() + durationMs;
}

function isProgrammaticBoundsChange(): boolean {
  return Date.now() < programmaticBoundsChangeUntil;
}

function boundsFromSavedPosition(height = requestedPillHeight): PillBounds | null {
  if (!savedPillBounds) return null;

  const candidate = {
    x: savedPillBounds.x,
    y: savedPillBounds.y,
    width: PILL_WIDTH,
    height,
  };
  const visibleArea = visibleAreaForBounds(candidate);
  if (!visibleArea) {
    log.warn('pill.savedBounds.offscreen', {
      message: 'Saved pill bounds are off-screen, using default position',
      savedBounds: savedPillBounds,
    });
    return null;
  }

  const clamped = {
    ...candidate,
    x: clampToRange(candidate.x, visibleArea.x, visibleArea.x + visibleArea.width - PILL_WIDTH),
    y: clampToRange(candidate.y, visibleArea.y, visibleArea.y + visibleArea.height - height),
  };

  if (clamped.x !== candidate.x || clamped.y !== candidate.y) {
    log.info('pill.savedBounds.clamped', {
      savedBounds: savedPillBounds,
      clamped,
      visibleArea,
    });
    savePillBounds(clamped);
  }

  return clamped;
}

function computePillBounds(height = requestedPillHeight): PillBounds {
  const savedBounds = boundsFromSavedPosition(height);
  if (savedBounds) return savedBounds;

  let displayBounds = { x: 0, y: 0, width: 1920, height: 1080 };

  try {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    displayBounds = display.bounds;
  } catch (err) {
    log.warn('pill.computePillBounds', {
      message: 'Failed to get display bounds, using defaults',
      error: (err as Error).message,
    });
  }

  const x = Math.round(displayBounds.x + (displayBounds.width - PILL_WIDTH) / 2);
  const y = displayBounds.y + PILL_TOP_OFFSET;

  log.debug('pill.computePillBounds', {
    message: 'Computed pill position',
    x,
    y,
    displayBounds,
  });

  return { x, y, width: PILL_WIDTH, height };
}

function trackUserMovedPill(): void {
  if (!pillWindow || pillWindow.isDestroyed()) return;
  if (isProgrammaticBoundsChange()) return;

  const bounds = pillWindow.getBounds();
  savePillBounds({
    x: bounds.x,
    y: bounds.y,
    width: PILL_WIDTH,
    height: requestedPillHeight,
  });
}

// ---------------------------------------------------------------------------
// Visibility callbacks
// ---------------------------------------------------------------------------

const visibilityCallbacks: Array<(visible: boolean) => void> = [];

export function onPillVisibilityChange(cb: (visible: boolean) => void): () => void {
  visibilityCallbacks.push(cb);
  return () => {
    const i = visibilityCallbacks.indexOf(cb);
    if (i >= 0) visibilityCallbacks.splice(i, 1);
  };
}

function notifyVisibility(visible: boolean): void {
  for (const cb of visibilityCallbacks) {
    try { cb(visible); } catch (err) {
      log.warn('pill.notifyVisibility.error', { error: (err as Error).message });
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create the pill BrowserWindow. Call once at app.whenReady().
 * The window starts hidden and is shown on first toggle.
 */
export function createPillWindow(): BrowserWindow {
  if (pillWindow && !pillWindow.isDestroyed()) {
    log.warn('pill.createPillWindow', {
      message: 'Pill window already exists — returning existing instance',
    });
    return pillWindow;
  }

  log.info('pill.createPillWindow', {
    message: 'Creating pill window',
    width: PILL_WIDTH,
    height: PILL_HEIGHT_COLLAPSED,
  });

  requestedPillHeight = PILL_HEIGHT_COLLAPSED;
  savedPillBounds = loadSavedPillBounds();

  // macOS uses `vibrancy: 'hud'` to render the pill body as frosted glass —
  // it requires `transparent: true` + a fully clear backgroundColor. Windows
  // has no equivalent that works with `transparent: true` (vibrancy is a
  // no-op there), so the same options produce a fully see-through window
  // with no surface. Branch the platform-specific options so Windows gets a
  // real opaque surface that matches the rest of the dark UI.
  const isMac = process.platform === 'darwin';
  pillWindow = new BrowserWindow({
    width: PILL_WIDTH,
    height: PILL_HEIGHT_COLLAPSED,
    transparent: isMac,
    frame: false,
    alwaysOnTop: true,
    hasShadow: true,
    resizable: false,
    backgroundColor: isMac ? '#00000000' : '#0b0d10',
    roundedCorners: true,
    skipTaskbar: true,
    show: false,
    ...(isMac ? { vibrancy: 'hud' as const, visualEffectState: 'active' as const, type: 'panel' as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'pill.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  pillWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pillWindow.setAlwaysOnTop(true, 'screen-saver');

  // Load the pill renderer
  if (
    typeof PILL_VITE_DEV_SERVER_URL !== 'undefined' &&
    PILL_VITE_DEV_SERVER_URL
  ) {
    const pillDevUrl = `${PILL_VITE_DEV_SERVER_URL}/src/renderer/pill/pill.html`;
    log.debug('pill.createPillWindow', {
      message: 'Loading pill from dev server',
      url: pillDevUrl,
    });
    pillWindow.loadURL(pillDevUrl);
  } else {
    // Forge VitePlugin preserves the input path relative to project root.
    // __dirname = .vite/build; renderer lands at
    // .vite/renderer/pill/src/renderer/pill/pill.html
    const htmlPath = path.join(__dirname, '../renderer/pill/src/renderer/pill/pill.html');
    log.debug('pill.createPillWindow', {
      message: 'Loading pill from file',
      htmlPath,
    });
    pillWindow.loadFile(htmlPath);
  }

  pillWindow.webContents.setZoomFactor(1);
  pillWindow.webContents.setVisualZoomLevelLimits(1, 1);
  pillWindow.webContents.once('did-finish-load', () => {
    log.info('pill.webContents.ready', {
      message: 'Pill renderer loaded and ready',
    });
  });

  pillWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    rendererLogger.info('renderer.console', { window: 'pill', level, source: sourceId, line, message });
  });

  pillWindow.on('closed', () => {
    log.info('pill.closed', { message: 'Pill window closed — nulling reference' });
    pillWindow = null;
  });
  pillWindow.on('move', trackUserMovedPill);

  log.info('pill.createPillWindow.complete', {
    message: 'Pill window created (hidden)',
    width: PILL_WIDTH,
    height: PILL_HEIGHT_COLLAPSED,
  });

  return pillWindow;
}

/**
 * Show the pill window, repositioning it to center-top of the active display.
 * Measures show latency (§6 Acceptance #6 target: p95 ≤ 150ms).
 */
export function showPill(): void {
  const t0 = performance.now();

  if (!pillWindow || pillWindow.isDestroyed()) {
    log.error('pill.showPill', {
      message: 'Cannot show pill — window not created or destroyed',
    });
    return;
  }

  // Reposition to center-top of active display every time we show
  const bounds = computePillBounds();
  beginProgrammaticBoundsChange();
  pillWindow.setBounds(bounds);

  pillWindow.showInactive();
  pillWindow.setAlwaysOnTop(true, 'screen-saver');
  pillWindow.focus();
  pillWindow.webContents.send('pill:shown');
  notifyVisibility(true);

  const latency_ms = performance.now() - t0;
  log.info('pill.show', {
    message: 'Pill shown',
    latency_ms,
    bounds,
  });

  // Warn if we're approaching the 150ms p95 target
  if (latency_ms > 100) {
    log.warn('pill.show.latency', {
      message: 'Pill show latency above 100ms warning threshold',
      latency_ms,
      target_p95_ms: 150,
    });
  }
}

/**
 * Hide the pill window.
 */
export function hidePill(): void {
  if (!pillWindow || pillWindow.isDestroyed()) {
    log.debug('pill.hidePill', {
      message: 'No pill window to hide',
    });
    return;
  }

  log.info('pill.hidePill', { message: 'Hiding pill window' });
  pillWindow.hide();
  notifyVisibility(false);
}

/**
 * Toggle pill visibility.
 * - If hidden → show (reposition to center-top of active display)
 * - If visible → hide
 *
 * This is the function called by the Cmd+K hotkey handler.
 */
export function togglePill(): void {
  if (!pillWindow || pillWindow.isDestroyed()) {
    log.error('pill.togglePill', {
      message: 'Cannot toggle pill — window not created or destroyed',
    });
    return;
  }

  const visible = pillWindow.isVisible();
  log.info('pill.togglePill', {
    message: 'Toggling pill',
    currentlyVisible: visible,
  });

  if (visible) {
    hidePill();
  } else {
    showPill();
  }
}

/**
/**
 * Send a channel+payload to the pill renderer via webContents.send.
 * Used by the main-process IPC hub to forward agent events.
 */
export function sendToPill(channel: string, payload: unknown): void {
  if (!pillWindow || pillWindow.isDestroyed()) {
    log.warn('pill.sendToPill', {
      message: 'Cannot send to pill — window not created or destroyed',
      channel,
    });
    return;
  }

  if (!pillWindow.isVisible()) {
    log.debug('pill.sendToPill', {
      message: 'Pill is hidden — sending anyway (renderer may queue)',
      channel,
    });
  }

  log.debug('pill.sendToPill', {
    message: 'Sending message to pill renderer',
    channel,
    payloadType: typeof payload === 'object' && payload !== null
      ? (payload as { event?: string }).event ?? 'unknown'
      : typeof payload,
  });

  pillWindow.webContents.send(channel, payload);
}

/**
 * Forward an AgentEvent to the pill renderer on the `pill:event` channel.
 */
export function forwardAgentEvent(event: AgentEvent): void {
  log.debug('pill.forwardAgentEvent', {
    message: 'Forwarding agent event to pill',
    event: event.event,
    task_id: event.task_id,
  });
  sendToPill('pill:event', event);
}

/**
 * Exported dimension constants — use these in IPC handlers to grow/shrink the pill.
 * COLLAPSED = idle/focused (56px input row only)
 * EXPANDED  = streaming or result state (input row + expanded section)
 */
export { PILL_HEIGHT_COLLAPSED, PILL_HEIGHT_EXPANDED };

/**
 * Resize pill window height (grows downward as toast/result appear).
 */
export function setPillHeight(height: number): void {
  const nextHeight = clampPillHeight(height);
  requestedPillHeight = nextHeight;

  if (!pillWindow || pillWindow.isDestroyed()) return;

  const current = pillWindow.getBounds();
  beginProgrammaticBoundsChange();
  pillWindow.setBounds({ ...current, height: nextHeight }, true);

  log.debug('pill.setPillHeight', {
    message: 'Pill height updated',
    previous: current.height,
    next: nextHeight,
  });
}
