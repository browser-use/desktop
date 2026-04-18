/**
 * ExtensionsWindow.ts — creates and manages the Extensions BrowserWindow.
 *
 * Follows the same singleton pattern as SettingsWindow.ts.
 * Width: 860, Height: 620, resizable: true, titleBarStyle: 'hiddenInset'
 * Uses the onboarding theme for visual consistency with Settings.
 */

import path from 'node:path';
import { BrowserWindow } from 'electron';
import { mainLogger } from '../logger';

// ---------------------------------------------------------------------------
// Forge VitePlugin globals (injected at build time)
// ---------------------------------------------------------------------------

declare const EXTENSIONS_VITE_DEV_SERVER_URL: string | undefined;
declare const EXTENSIONS_VITE_NAME: string | undefined;

// ---------------------------------------------------------------------------
// Singleton reference
// ---------------------------------------------------------------------------

let extensionsWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function openExtensionsWindow(): BrowserWindow {
  if (extensionsWindow && !extensionsWindow.isDestroyed()) {
    mainLogger.info('ExtensionsWindow.focus', { windowId: extensionsWindow.id });
    extensionsWindow.focus();
    return extensionsWindow;
  }

  mainLogger.info('ExtensionsWindow.create');

  const preloadPath = path.join(__dirname, 'extensions.js');

  extensionsWindow = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 640,
    minHeight: 480,
    resizable: true,
    titleBarStyle: 'hiddenInset',
    show: false,
    backgroundColor: '#1a1a1f',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  extensionsWindow.once('ready-to-show', () => {
    if (!extensionsWindow || extensionsWindow.isDestroyed()) return;
    extensionsWindow.show();
    extensionsWindow.focus();
    const [x, y] = extensionsWindow.getPosition();
    const [w, h] = extensionsWindow.getSize();
    mainLogger.info('ExtensionsWindow.readyToShow', {
      windowId: extensionsWindow.id,
      position: { x, y },
      size: { w, h },
    });
  });

  extensionsWindow.on('closed', () => {
    mainLogger.info('ExtensionsWindow.closed');
    extensionsWindow = null;
  });

  extensionsWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    mainLogger.error('ExtensionsWindow.did-fail-load', { code, desc, url });
  });

  extensionsWindow.webContents.on('did-finish-load', () => {
    mainLogger.info('ExtensionsWindow.did-finish-load', {
      url: extensionsWindow?.webContents.getURL(),
    });
  });

  extensionsWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    mainLogger.info('extensionsRenderer.console', { level, source, line, message });
  });

  if (process.env.NODE_ENV !== 'production') {
    extensionsWindow.webContents.openDevTools({ mode: 'detach' });
  }

  if (typeof EXTENSIONS_VITE_DEV_SERVER_URL !== 'undefined' && EXTENSIONS_VITE_DEV_SERVER_URL) {
    const url = `${EXTENSIONS_VITE_DEV_SERVER_URL}/src/renderer/extensions/extensions.html`;
    mainLogger.debug('ExtensionsWindow.loadURL', { url });
    void extensionsWindow.loadURL(url);
  } else {
    const name = typeof EXTENSIONS_VITE_NAME !== 'undefined' ? EXTENSIONS_VITE_NAME : 'extensions';
    const filePath = path.join(
      __dirname,
      `../../renderer/${name}/extensions.html`,
    );
    mainLogger.debug('ExtensionsWindow.loadFile', { filePath });
    void extensionsWindow.loadFile(filePath);
  }

  mainLogger.info('ExtensionsWindow.create.ok', {
    windowId: extensionsWindow.id,
    width: 860,
    height: 620,
  });

  return extensionsWindow;
}

export function getExtensionsWindow(): BrowserWindow | null {
  if (extensionsWindow && !extensionsWindow.isDestroyed()) {
    return extensionsWindow;
  }
  return null;
}

export function closeExtensionsWindow(): void {
  if (extensionsWindow && !extensionsWindow.isDestroyed()) {
    mainLogger.info('ExtensionsWindow.closeRequested');
    extensionsWindow.close();
  }
}
