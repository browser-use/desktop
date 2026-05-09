import { app, BrowserWindow, ipcMain, screen, type IpcMainEvent, type Rectangle, type WebContents } from 'electron';
import path from 'node:path';
import type {
  AppPopupAction,
  AppPopupClosed,
  AppPopupContentSize,
  AppPopupOpenRequest,
  AppPopupOpenResult,
  AppPopupPlacement,
} from '../shared/app-popup';
import { mainLogger, rendererLogger } from './logger';
import { getWindowBackgroundColor } from './themeMode';
import { registerViteDepStaleHeal } from './viteDepStaleHeal';

const log = {
  info: (c: string, x: object) => mainLogger.info(c, x as Record<string, unknown>),
  warn: (c: string, x: object) => mainLogger.warn(c, x as Record<string, unknown>),
  error: (c: string, x: object) => mainLogger.error(c, x as Record<string, unknown>),
  debug: (c: string, x: object) => mainLogger.debug(c, x as Record<string, unknown>),
};

const DEFAULT_WIDTH = 260;
const DEFAULT_HEIGHT = 240;
const MAX_DEFAULT_HEIGHT = 380;
const SCREEN_MARGIN = 6;
const ANCHOR_GAP = 6;

interface ActivePopup {
  id: string;
  request: AppPopupOpenRequest;
  origin: WebContents;
  owner: BrowserWindow | null;
}

let popupWindow: BrowserWindow | null = null;
let popupReady = false;
let pendingRender: AppPopupOpenRequest | null = null;
let activePopup: ActivePopup | null = null;
let registered = false;
let ownerCleanup: (() => void) | null = null;
let showWhenRenderedId: string | null = null;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(value, max));
}

function sanitizeDimension(value: unknown, fallback: number, min: number, max: number): number {
  if (!isFiniteNumber(value)) return fallback;
  return clamp(Math.round(value), min, max);
}

function estimateMenuHeight(request: AppPopupOpenRequest): number {
  if (request.kind !== 'menu') return DEFAULT_HEIGHT;
  const rowHeight = 34;
  const separators = request.items.filter((item) => item.separatorBefore).length;
  return Math.min(MAX_DEFAULT_HEIGHT, 8 + request.items.length * rowHeight + separators * 9);
}

function requestedSize(request: AppPopupOpenRequest): { width: number; height: number } {
  const fallbackWidth = request.kind === 'engine-picker'
    ? 266
    : request.kind === 'browsercode-model-picker'
      ? 292
      : request.kind === 'memory-indicator'
        ? 360
        : DEFAULT_WIDTH;
  const fallbackHeight = request.kind === 'engine-picker' || request.kind === 'browsercode-model-picker' || request.kind === 'memory-indicator'
    ? MAX_DEFAULT_HEIGHT
    : estimateMenuHeight(request);
  return {
    width: sanitizeDimension(request.width, fallbackWidth, 80, 900),
    height: sanitizeDimension(request.height, fallbackHeight, 40, sanitizeDimension(request.maxHeight, MAX_DEFAULT_HEIGHT, 80, 900)),
  };
}

function screenAnchorFor(owner: BrowserWindow | null, request: AppPopupOpenRequest): Rectangle {
  const content = owner && !owner.isDestroyed()
    ? owner.getContentBounds()
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  return {
    x: Math.round(content.x + request.anchor.x),
    y: Math.round(content.y + request.anchor.y),
    width: Math.round(request.anchor.width),
    height: Math.round(request.anchor.height),
  };
}

function displayAreaFor(anchor: Rectangle): Rectangle {
  const point = {
    x: Math.round(anchor.x + anchor.width / 2),
    y: Math.round(anchor.y + anchor.height / 2),
  };
  return screen.getDisplayNearestPoint(point).workArea;
}

function computePosition(
  anchor: Rectangle,
  width: number,
  height: number,
  placement: AppPopupPlacement,
): { x: number; y: number } {
  switch (placement) {
    case 'bottom-end':
      return { x: anchor.x + anchor.width - width, y: anchor.y + anchor.height + ANCHOR_GAP };
    case 'top-start':
      return { x: anchor.x, y: anchor.y - height - ANCHOR_GAP };
    case 'top-end':
      return { x: anchor.x + anchor.width - width, y: anchor.y - height - ANCHOR_GAP };
    case 'right-start':
      return { x: anchor.x + anchor.width + ANCHOR_GAP, y: anchor.y };
    case 'left-start':
      return { x: anchor.x - width - ANCHOR_GAP, y: anchor.y };
    case 'bottom-start':
    default:
      return { x: anchor.x, y: anchor.y + anchor.height + ANCHOR_GAP };
  }
}

function flipPlacementIfNeeded(
  anchor: Rectangle,
  width: number,
  height: number,
  placement: AppPopupPlacement,
  area: Rectangle,
): AppPopupPlacement {
  const pos = computePosition(anchor, width, height, placement);
  const overBottom = pos.y + height > area.y + area.height - SCREEN_MARGIN;
  const overTop = pos.y < area.y + SCREEN_MARGIN;
  const spaceAbove = anchor.y - area.y;
  const spaceBelow = area.y + area.height - (anchor.y + anchor.height);

  if (placement.startsWith('bottom') && overBottom && spaceAbove > spaceBelow) {
    return placement === 'bottom-end' ? 'top-end' : 'top-start';
  }
  if (placement.startsWith('top') && overTop && spaceBelow > spaceAbove) {
    return placement === 'top-end' ? 'bottom-end' : 'bottom-start';
  }
  return placement;
}

function computeBounds(request: AppPopupOpenRequest, owner: BrowserWindow | null): Rectangle {
  const anchor = screenAnchorFor(owner, request);
  const area = displayAreaFor(anchor);
  const size = requestedSize(request);
  const width = Math.min(size.width, Math.max(80, area.width - SCREEN_MARGIN * 2));
  const height = Math.min(size.height, Math.max(40, area.height - SCREEN_MARGIN * 2));
  const placement = flipPlacementIfNeeded(anchor, width, height, request.placement ?? 'bottom-start', area);
  const pos = computePosition(anchor, width, height, placement);
  return {
    x: clamp(Math.round(pos.x), area.x + SCREEN_MARGIN, area.x + area.width - width - SCREEN_MARGIN),
    y: clamp(Math.round(pos.y), area.y + SCREEN_MARGIN, area.y + area.height - height - SCREEN_MARGIN),
    width,
    height,
  };
}

function createPopupWindow(): BrowserWindow {
  if (popupWindow && !popupWindow.isDestroyed()) return popupWindow;

  popupReady = false;
  popupWindow = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: 80,
    minHeight: 40,
    transparent: false,
    frame: false,
    alwaysOnTop: true,
    hasShadow: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    minimizable: false,
    movable: false,
    skipTaskbar: true,
    show: false,
    roundedCorners: true,
    type: 'panel',
    backgroundColor: getWindowBackgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, 'popup.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  popupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  popupWindow.setAlwaysOnTop(true, 'screen-saver');

  const isDev = typeof POPUP_VITE_DEV_SERVER_URL !== 'undefined' && POPUP_VITE_DEV_SERVER_URL;
  const devUrl = isDev ? `${POPUP_VITE_DEV_SERVER_URL}/src/renderer/popup/popup.html` : null;
  const htmlPath = isDev ? null : path.join(__dirname, '../renderer/popup/src/renderer/popup/popup.html');

  const loadPopup = (): void => {
    if (!popupWindow || popupWindow.isDestroyed()) return;
    if (devUrl) {
      popupWindow.loadURL(devUrl).catch((err) => log.error('appPopup.loadURL.reject', { url: devUrl, error: (err as Error).message }));
    } else if (htmlPath) {
      popupWindow.loadFile(htmlPath).catch((err) => log.error('appPopup.loadFile.reject', { htmlPath, error: (err as Error).message }));
    }
  };
  loadPopup();

  popupWindow.webContents.setZoomFactor(1);
  popupWindow.webContents.setVisualZoomLevelLimits(1, 1);
  popupWindow.webContents.on('did-finish-load', () => {
    log.debug('appPopup.did-finish-load', {});
  });
  let retriesLeft = isDev ? 10 : 0;
  popupWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    log.warn('appPopup.did-fail-load', { code, desc, url, retriesLeft });
    if (retriesLeft > 0 && (code === -102 || code === -105 || code === -2)) {
      retriesLeft -= 1;
      setTimeout(loadPopup, 400);
    }
  });
  if (isDev) registerViteDepStaleHeal(popupWindow, 'popup');
  popupWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    rendererLogger.info('renderer.console', { window: 'popup', level, message, line, sourceId });
  });
  popupWindow.webContents.on('render-process-gone', (_e, details) => {
    log.error('appPopup.render-process-gone', { reason: details.reason, exitCode: details.exitCode });
  });
  popupWindow.webContents.on('preload-error', (_e, preloadPath, err) => {
    log.error('appPopup.preload-error', { preloadPath, error: (err as Error).message });
  });

  popupWindow.on('blur', () => {
    setTimeout(() => {
      if (!popupWindow || popupWindow.isDestroyed() || !popupWindow.isVisible()) return;
      if (BrowserWindow.getFocusedWindow() === popupWindow) return;
      if (activePopup?.owner && BrowserWindow.getFocusedWindow() === activePopup.owner) return;
      closeAppPopup('blur');
    }, 80);
  });
  popupWindow.on('closed', () => {
    popupWindow = null;
    popupReady = false;
    pendingRender = null;
    activePopup = null;
    showWhenRenderedId = null;
    ownerCleanup?.();
    ownerCleanup = null;
  });

  return popupWindow;
}

function sendRender(request: AppPopupOpenRequest): void {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  if (!popupReady) {
    pendingRender = request;
    return;
  }
  popupWindow.webContents.send('app-popup:render', request);
}

function showRenderedPopup(): void {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  popupWindow.showInactive();
  popupWindow.setAlwaysOnTop(true, 'screen-saver');
  popupWindow.focus();
}

function handlePopupRendererReady(event: IpcMainEvent): void {
  if (!popupWindow || popupWindow.isDestroyed() || event.sender !== popupWindow.webContents) return;
  popupReady = true;
  const request = pendingRender ?? activePopup?.request;
  if (request) {
    pendingRender = null;
    popupWindow.webContents.send('app-popup:render', request);
  }
}

function notifyClosed(event: AppPopupClosed): void {
  const origin = activePopup?.origin;
  if (origin && !origin.isDestroyed()) {
    origin.send('app-popup:closed', event);
  }
}

function closeAppPopup(reason: AppPopupClosed['reason']): void {
  if (!activePopup) {
    if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) popupWindow.hide();
    return;
  }
  const popupId = activePopup.id;
  notifyClosed({ popupId, reason });
  activePopup = null;
  pendingRender = null;
  showWhenRenderedId = null;
  ownerCleanup?.();
  ownerCleanup = null;
  if (popupWindow && !popupWindow.isDestroyed()) popupWindow.hide();
}

function bindOwnerLifecycle(owner: BrowserWindow | null): void {
  ownerCleanup?.();
  ownerCleanup = null;
  if (!owner || owner.isDestroyed()) return;

  const reposition = (): void => {
    if (!activePopup || !popupWindow || popupWindow.isDestroyed() || !popupWindow.isVisible()) return;
    popupWindow.setBounds(computeBounds(activePopup.request, activePopup.owner), false);
  };
  const closeForOwner = (): void => closeAppPopup('owner-destroyed');

  owner.on('move', reposition);
  owner.on('resize', reposition);
  owner.on('hide', closeForOwner);
  owner.on('minimize', closeForOwner);
  owner.on('closed', closeForOwner);
  ownerCleanup = () => {
    owner.off('move', reposition);
    owner.off('resize', reposition);
    owner.off('hide', closeForOwner);
    owner.off('minimize', closeForOwner);
    owner.off('closed', closeForOwner);
  };
}

function openAppPopup(origin: WebContents, request: AppPopupOpenRequest): AppPopupOpenResult {
  if (!request || typeof request !== 'object') throw new Error('app-popup:open requires a request');
  if (!request.id || typeof request.id !== 'string') throw new Error('app-popup:open requires a string id');
  if (!request.anchor || !isFiniteNumber(request.anchor.x) || !isFiniteNumber(request.anchor.y)) {
    throw new Error('app-popup:open requires a finite anchor rect');
  }

  if (activePopup && activePopup.id !== request.id) closeAppPopup('replaced');

  const owner = BrowserWindow.fromWebContents(origin);
  const win = createPopupWindow();
  activePopup = { id: request.id, request, origin, owner };
  bindOwnerLifecycle(owner);

  try {
    if (owner && !owner.isDestroyed()) win.setParentWindow(owner);
  } catch (err) {
    log.warn('appPopup.setParentWindow.error', { error: (err as Error).message });
  }

  const bounds = computeBounds(request, owner);
  win.setBounds(bounds, false);
  showWhenRenderedId = request.id;
  sendRender(request);
  log.debug('appPopup.open', { id: request.id, kind: request.kind, bounds });
  return { id: request.id };
}

function handleContentReady(popupId: string): void {
  if (!activePopup || popupId !== activePopup.id) return;
  if (showWhenRenderedId !== popupId) return;
  showWhenRenderedId = null;
  showRenderedPopup();
}

function handleResize(size: AppPopupContentSize): void {
  if (!activePopup || size.popupId !== activePopup.id) return;
  if (!popupWindow || popupWindow.isDestroyed()) return;
  const current = activePopup.request;
  activePopup.request = {
    ...current,
    width: sanitizeDimension(size.width, requestedSize(current).width, 80, 900),
    height: sanitizeDimension(size.height, requestedSize(current).height, 40, sanitizeDimension(current.maxHeight, MAX_DEFAULT_HEIGHT, 80, 900)),
  } as AppPopupOpenRequest;
  popupWindow.setBounds(computeBounds(activePopup.request, activePopup.owner), false);
}

function forwardAction(action: AppPopupAction): void {
  if (!activePopup || action.popupId !== activePopup.id) return;
  const origin = activePopup.origin;
  if (!origin.isDestroyed()) {
    origin.send('app-popup:action', action);
  }
  if (action.close !== false) closeAppPopup('action');
}

export function registerAppPopupHandlers(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle('app-popup:open', (event, request: AppPopupOpenRequest) => {
    return openAppPopup(event.sender, request);
  });
  ipcMain.handle('app-popup:close', (_event, popupId?: string) => {
    if (!popupId || activePopup?.id === popupId) closeAppPopup('request');
  });
  ipcMain.on('app-popup:renderer-ready', handlePopupRendererReady);
  ipcMain.on('app-popup:content-ready', (event, popupId: string) => {
    if (popupWindow && event.sender === popupWindow.webContents) handleContentReady(popupId);
  });
  ipcMain.on('app-popup:content-size', (event, size: AppPopupContentSize) => {
    if (popupWindow && event.sender === popupWindow.webContents) handleResize(size);
  });
  ipcMain.on('app-popup:action', (event, action: AppPopupAction) => {
    if (popupWindow && event.sender === popupWindow.webContents) forwardAction(action);
  });
  ipcMain.on('app-popup:close-from-popup', (event, payload: { popupId?: string; reason?: string }) => {
    if (popupWindow && event.sender === popupWindow.webContents && payload?.popupId === activePopup?.id) {
      closeAppPopup(payload.reason === 'escape' ? 'escape' : 'request');
    }
  });
  app.on('did-resign-active', () => {
    if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) {
      closeAppPopup('app-deactivated');
    }
  });
}

export function warmAppPopup(): void {
  createPopupWindow();
}
