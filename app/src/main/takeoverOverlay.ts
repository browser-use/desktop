/**
 * Takeover overlay — a sibling WebContentsView that paints a pulsing edge
 * glow on top of the session's browser view while automation is running.
 *
 * On hover, reveals a "Stop and take over" button that cancels the session
 * and hides the overlay, letting the user interact with the browser directly.
 *
 * Why WebContentsView (not BrowserWindow):
 *   - Bounds live in hub-local coordinates, so the overlay resizes in the
 *     same frame as the browser view when the user drags the split or the
 *     hub window itself. A BrowserWindow requires screen-coord translation
 *     and lags by one IPC round-trip per ResizeObserver tick.
 *   - Z-order is literally the order of children in contentView — add the
 *     overlay after the browser view and it stacks on top. No alwaysOnTop
 *     level juggling.
 *   - Input blocking is implicit: mouse events route to the topmost view
 *     at the cursor, so the browser view beneath never sees clicks/scrolls.
 */
import { WebContentsView, type BrowserWindow } from 'electron';
import { mainLogger } from './logger';

export type OverlayMode = 'idle' | 'active';

interface OverlayEntry {
  sessionId: string;
  view: WebContentsView;
  attached: boolean;
  mode: OverlayMode;
  // Whether the overlay renderer has finished loading and is ready to
  // receive takeover:mode IPC. Until then we cache `mode` on the entry and
  // replay on did-finish-load to avoid races between show() and load.
  loaded: boolean;
}

const entries: Map<string, OverlayEntry> = new Map();

/**
 * Inline HTML/CSS/JS for the overlay. Loaded via data: URL so we don't need
 * a separate Forge/Vite renderer entry. Uses `nodeIntegration: true` (safe
 * here because content is trusted and generated locally) so the inline
 * script can `require('electron').ipcRenderer.invoke('takeover:stop', id)`.
 */
function overlayHtml(sessionId: string): string {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  :root {
    --cyan: 80, 200, 255;
    --cyan-strong: 120, 220, 255;
  }
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; color: #fff; }

  /* Default = active mode. Idle mode hides the glow/chip/scrim/button and
     shows the "Browser not started yet" label instead. */
  .label {
    position: relative;
    z-index: 2;
    font-size: 12px;
    letter-spacing: 0.02em;
    color: rgba(200, 210, 225, 0.55);
    opacity: 0;
    transition: opacity 180ms ease;
    pointer-events: none;
    user-select: none;
  }
  body[data-mode="idle"] .glow,
  body[data-mode="idle"] .chip,
  body[data-mode="idle"] .scrim,
  body[data-mode="idle"] .button { display: none; }
  body[data-mode="idle"] .label { opacity: 1; }

  .overlay {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* One layer: a cyan glow that bleeds inward from all four edges and
     pulses. Built from a deep inset box-shadow (center stays clear) so
     the page content is always visible. */
  .glow {
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow:
      inset 0 0 0 1px rgba(var(--cyan), 0.55),
      inset 0 0 18px 2px rgba(var(--cyan), 0.45),
      inset 0 0 60px 10px rgba(var(--cyan), 0.22);
    animation: pulse 2.2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.55; }
    50%      { opacity: 1.0;  }
  }

  .chip {
    position: absolute;
    top: 10px;
    left: 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(12, 18, 28, 0.7);
    backdrop-filter: blur(6px);
    font-size: 11px;
    letter-spacing: 0.02em;
    color: rgba(220, 240, 255, 0.9);
    pointer-events: none;
    border: 1px solid rgba(var(--cyan), 0.35);
    transition: opacity 180ms ease;
  }
  .chip .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: rgba(var(--cyan-strong), 1);
    box-shadow: 0 0 8px rgba(var(--cyan), 0.8);
    animation: dot 1.6s ease-in-out infinite;
  }
  @keyframes dot {
    0%, 100% { transform: scale(1);   opacity: 0.85; }
    50%      { transform: scale(1.3); opacity: 1;    }
  }

  .scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0);
    transition: background 220ms ease;
    pointer-events: none;
  }

  .button {
    position: relative;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 11px 18px;
    border-radius: 10px;
    background: rgba(18, 22, 30, 0.95);
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.01em;
    border: 1px solid rgba(var(--cyan), 0.45);
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.55),
      0 0 0 0 rgba(var(--cyan), 0);
    cursor: pointer;
    opacity: 0;
    transform: translateY(4px) scale(0.98);
    transition: opacity 180ms ease, transform 180ms ease, background 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
    user-select: none;
  }
  .button:hover {
    background: rgba(24, 30, 40, 1);
    border-color: rgba(var(--cyan-strong), 0.9);
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.55),
      0 0 0 3px rgba(var(--cyan), 0.18);
  }
  .button:active { transform: translateY(1px) scale(0.99); }
  .button svg { width: 14px; height: 14px; }

  /* Hover state — same cyan palette, pulse speeds up slightly + scrim
     focuses attention on the button. No colour swap. */
  body.hover .glow {
    animation-duration: 1.4s;
    box-shadow:
      inset 0 0 0 1.5px rgba(var(--cyan-strong), 0.75),
      inset 0 0 24px 3px rgba(var(--cyan), 0.55),
      inset 0 0 72px 14px rgba(var(--cyan), 0.3);
  }
  body.hover .chip { opacity: 0; }
  body.hover .scrim { background: rgba(0, 0, 0, 0.3); }
  body.hover .button { opacity: 1; transform: translateY(0) scale(1); }
</style>
</head>
<body>
  <div class="overlay" id="overlay">
    <div class="glow"></div>
    <div class="chip"><span class="dot"></span><span>Automating</span></div>
    <div class="scrim"></div>
    <div class="label">Browser not started yet</div>
    <button class="button" id="takeover" type="button">
      <svg viewBox="0 0 14 14" fill="none"><rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor"/></svg>
      Stop and take over
    </button>
  </div>
<script>
  const { ipcRenderer } = require('electron');
  const SESSION_ID = ${JSON.stringify(sessionId)};
  const body = document.body;
  const overlay = document.getElementById('overlay');
  const button = document.getElementById('takeover');

  // Start in idle — main will push the real mode via takeover:mode IPC
  // as soon as the page finishes loading. Avoids a flash of active glow
  // on fresh overlays opened for not-yet-navigated sessions.
  body.dataset.mode = 'idle';

  ipcRenderer.on('takeover:mode', (_e, mode) => {
    if (mode === 'idle' || mode === 'active') {
      body.dataset.mode = mode;
    }
  });

  overlay.addEventListener('mouseenter', () => body.classList.add('hover'));
  overlay.addEventListener('mouseleave', () => body.classList.remove('hover'));

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    ipcRenderer.invoke('takeover:stop', SESSION_ID);
  });
</script>
</body>
</html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function createOverlayEntry(sessionId: string, mode: OverlayMode): OverlayEntry {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  // Transparent background so the pulsing glow / scrim sits over the
  // browser view beneath. WebContentsView has no `transparent` webPreference
  // (that's a BrowserWindow option) — use setBackgroundColor with zero alpha.
  view.setBackgroundColor('#00000000');
  const entry: OverlayEntry = { sessionId, view, attached: false, mode, loaded: false };
  view.webContents.once('did-finish-load', () => {
    entry.loaded = true;
    // Replay the latest cached mode — cheap no-op if nothing changed.
    try { view.webContents.send('takeover:mode', entry.mode); } catch { /* ignore */ }
  });
  view.webContents.loadURL(overlayHtml(sessionId)).catch((err) => {
    mainLogger.warn('takeoverOverlay.load.error', { sessionId, error: (err as Error).message });
  });
  return entry;
}

function pushMode(entry: OverlayEntry, mode: OverlayMode): void {
  if (entry.mode === mode && entry.loaded) return;
  entry.mode = mode;
  if (entry.loaded && !entry.view.webContents.isDestroyed()) {
    try { entry.view.webContents.send('takeover:mode', mode); } catch { /* ignore */ }
  }
}

export function show(
  sessionId: string,
  window: BrowserWindow,
  bounds: { x: number; y: number; width: number; height: number },
  mode: OverlayMode = 'idle',
): void {
  if (!sessionId || !window || window.isDestroyed()) return;
  let entry = entries.get(sessionId);
  if (!entry) {
    entry = createOverlayEntry(sessionId, mode);
    entries.set(sessionId, entry);
  } else {
    pushMode(entry, mode);
  }
  entry.view.setBounds(bounds);
  if (!entry.attached) {
    window.contentView.addChildView(entry.view);
    entry.attached = true;
    mainLogger.info('takeoverOverlay.show', { sessionId, bounds, mode });
  }
}

/** Re-add the overlay above the browser view. Called after BrowserPool attaches
 *  or re-adds its view, since addChildView raises the added view to the top. */
export function reraise(sessionId: string, window: BrowserWindow): void {
  const entry = entries.get(sessionId);
  if (!entry || !entry.attached || !window || window.isDestroyed()) return;
  const children = window.contentView.children;
  if (children.includes(entry.view)) {
    window.contentView.removeChildView(entry.view);
  }
  window.contentView.addChildView(entry.view);
}

export function updateBounds(
  sessionId: string,
  bounds: { x: number; y: number; width: number; height: number },
): void {
  const entry = entries.get(sessionId);
  if (!entry) return;
  entry.view.setBounds(bounds);
}

export function hide(sessionId: string, window: BrowserWindow | null): void {
  const entry = entries.get(sessionId);
  if (!entry) return;
  if (entry.attached && window && !window.isDestroyed()) {
    try { window.contentView.removeChildView(entry.view); } catch { /* ignore */ }
  }
  entry.attached = false;
  // Let the view + its webContents GC naturally after removeChildView.
  // Calling any destroy/close on WebContents here is brittle across Electron
  // versions and the overlay is cheap enough to recreate on next show().
  entries.delete(sessionId);
  mainLogger.info('takeoverOverlay.hide', { sessionId });
}

export function hasOverlay(sessionId: string): boolean {
  return entries.has(sessionId);
}

export function destroyAll(window: BrowserWindow | null): void {
  for (const id of Array.from(entries.keys())) {
    hide(id, window);
  }
}
