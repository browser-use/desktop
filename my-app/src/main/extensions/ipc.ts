/**
 * extensions/ipc.ts — IPC handlers for the Extensions window and toolbar.
 *
 * Registers all extensions:* channels via ipcMain.handle / ipcMain.on.
 * Call registerExtensionsHandlers() once after app.whenReady().
 */

import { dialog, ipcMain } from 'electron';
import { mainLogger } from '../logger';
import { assertString, assertOneOf } from '../ipc-validators';
import { ExtensionManager } from './ExtensionManager';
import type { ExtensionRecord } from './ExtensionManager';
import { getExtensionsWindow, openExtensionsWindow } from './ExtensionsWindow';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CH_LIST              = 'extensions:list';
const CH_ENABLE            = 'extensions:enable';
const CH_DISABLE           = 'extensions:disable';
const CH_REMOVE            = 'extensions:remove';
const CH_GET_DETAILS       = 'extensions:get-details';
const CH_LOAD_UNPACKED     = 'extensions:load-unpacked';
const CH_UPDATE            = 'extensions:update';
const CH_SET_HOST_ACCESS   = 'extensions:set-host-access';
const CH_GET_DEV_MODE      = 'extensions:get-dev-mode';
const CH_SET_DEV_MODE      = 'extensions:set-dev-mode';
const CH_PICK_DIRECTORY    = 'extensions:pick-directory';
const CH_CLOSE_WINDOW      = 'extensions:close-window';

// Toolbar-specific channels
const CH_TOOLBAR_LIST      = 'extensions:toolbar-list';
const CH_PIN               = 'extensions:pin';
const CH_UNPIN             = 'extensions:unpin';
const CH_REORDER_PINNED    = 'extensions:reorder-pinned';
const CH_OPEN_MANAGE       = 'extensions:open-manage';

const ALLOWED_HOST_ACCESS = ['all-sites', 'specific-sites', 'on-click'] as const;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _manager: ExtensionManager | null = null;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleList(): ExtensionRecord[] {
  mainLogger.info(CH_LIST);
  if (!_manager) throw new Error('ExtensionManager not initialised');
  return _manager.listExtensions();
}

async function handleEnable(
  _event: Electron.IpcMainInvokeEvent,
  id: string,
): Promise<void> {
  const validId = assertString(id, 'id', 200);
  mainLogger.info(CH_ENABLE, { id: validId });
  if (!_manager) throw new Error('ExtensionManager not initialised');
  await _manager.enableExtension(validId);
}

function handleDisable(
  _event: Electron.IpcMainInvokeEvent,
  id: string,
): void {
  const validId = assertString(id, 'id', 200);
  mainLogger.info(CH_DISABLE, { id: validId });
  if (!_manager) throw new Error('ExtensionManager not initialised');
  _manager.disableExtension(validId);
}

function handleRemove(
  _event: Electron.IpcMainInvokeEvent,
  id: string,
): void {
  const validId = assertString(id, 'id', 200);
  mainLogger.info(CH_REMOVE, { id: validId });
  if (!_manager) throw new Error('ExtensionManager not initialised');
  _manager.removeExtension(validId);
}

function handleGetDetails(
  _event: Electron.IpcMainInvokeEvent,
  id: string,
): ExtensionRecord | null {
  const validId = assertString(id, 'id', 200);
  mainLogger.info(CH_GET_DETAILS, { id: validId });
  if (!_manager) throw new Error('ExtensionManager not initialised');
  return _manager.getExtensionDetails(validId);
}

async function handleLoadUnpacked(): Promise<ExtensionRecord | null> {
  mainLogger.info(CH_LOAD_UNPACKED);
  if (!_manager) throw new Error('ExtensionManager not initialised');

  const win = getExtensionsWindow();
  const result = await dialog.showOpenDialog(win ?? ({} as Electron.BrowserWindow), {
    properties: ['openDirectory'],
    title: 'Select extension directory',
  });

  if (result.canceled || result.filePaths.length === 0) {
    mainLogger.info(`${CH_LOAD_UNPACKED}.canceled`);
    return null;
  }

  const extPath = result.filePaths[0];
  mainLogger.info(`${CH_LOAD_UNPACKED}.selected`, { path: extPath });
  return _manager.loadUnpacked(extPath);
}

async function handleUpdate(
  _event: Electron.IpcMainInvokeEvent,
  id: string,
): Promise<void> {
  const validId = assertString(id, 'id', 200);
  mainLogger.info(CH_UPDATE, { id: validId });
  if (!_manager) throw new Error('ExtensionManager not initialised');
  await _manager.updateExtension(validId);
}

function handleSetHostAccess(
  _event: Electron.IpcMainInvokeEvent,
  id: string,
  hostAccess: string,
): void {
  const validId = assertString(id, 'id', 200);
  const validAccess = assertOneOf(hostAccess, 'hostAccess', ALLOWED_HOST_ACCESS);
  mainLogger.info(CH_SET_HOST_ACCESS, { id: validId, hostAccess: validAccess });
  if (!_manager) throw new Error('ExtensionManager not initialised');
  _manager.setHostAccess(validId, validAccess);
}

function handleGetDevMode(): boolean {
  mainLogger.info(CH_GET_DEV_MODE);
  if (!_manager) throw new Error('ExtensionManager not initialised');
  return _manager.getDeveloperMode();
}

function handleSetDevMode(
  _event: Electron.IpcMainInvokeEvent,
  enabled: boolean,
): void {
  mainLogger.info(CH_SET_DEV_MODE, { enabled });
  if (!_manager) throw new Error('ExtensionManager not initialised');
  _manager.setDeveloperMode(!!enabled);
}

async function handlePickDirectory(): Promise<string | null> {
  mainLogger.info(CH_PICK_DIRECTORY);
  const win = getExtensionsWindow();
  const result = await dialog.showOpenDialog(win ?? ({} as Electron.BrowserWindow), {
    properties: ['openDirectory'],
    title: 'Select extension directory',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}

function handleCloseWindow(): void {
  mainLogger.info(CH_CLOSE_WINDOW);
  const win = getExtensionsWindow();
  if (win && !win.isDestroyed()) {
    win.close();
  }
}

// ---------------------------------------------------------------------------
// Toolbar handlers
// ---------------------------------------------------------------------------

function handleToolbarList(): ExtensionRecord[] {
  mainLogger.info(CH_TOOLBAR_LIST);
  if (!_manager) throw new Error('ExtensionManager not initialised');
  return _manager.listExtensions();
}

function handlePin(
  _event: Electron.IpcMainInvokeEvent,
  id: string,
): void {
  const validId = assertString(id, 'id', 200);
  mainLogger.info(CH_PIN, { id: validId });
  if (!_manager) throw new Error('ExtensionManager not initialised');
  _manager.pinExtension(validId);
}

function handleUnpin(
  _event: Electron.IpcMainInvokeEvent,
  id: string,
): void {
  const validId = assertString(id, 'id', 200);
  mainLogger.info(CH_UNPIN, { id: validId });
  if (!_manager) throw new Error('ExtensionManager not initialised');
  _manager.unpinExtension(validId);
}

function handleReorderPinned(
  _event: Electron.IpcMainInvokeEvent,
  orderedIds: string[],
): void {
  mainLogger.info(CH_REORDER_PINNED, { count: orderedIds?.length });
  if (!_manager) throw new Error('ExtensionManager not initialised');
  if (!Array.isArray(orderedIds)) throw new Error('orderedIds must be an array');
  _manager.reorderPinned(orderedIds);
}

function handleOpenManage(): void {
  mainLogger.info(CH_OPEN_MANAGE);
  openExtensionsWindow();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function registerExtensionsHandlers(manager: ExtensionManager): void {
  mainLogger.info('extensions.ipc.register');
  _manager = manager;

  ipcMain.handle(CH_LIST, handleList);
  ipcMain.handle(CH_ENABLE, handleEnable);
  ipcMain.handle(CH_DISABLE, handleDisable);
  ipcMain.handle(CH_REMOVE, handleRemove);
  ipcMain.handle(CH_GET_DETAILS, handleGetDetails);
  ipcMain.handle(CH_LOAD_UNPACKED, handleLoadUnpacked);
  ipcMain.handle(CH_UPDATE, handleUpdate);
  ipcMain.handle(CH_SET_HOST_ACCESS, handleSetHostAccess);
  ipcMain.handle(CH_GET_DEV_MODE, handleGetDevMode);
  ipcMain.handle(CH_SET_DEV_MODE, handleSetDevMode);
  ipcMain.handle(CH_PICK_DIRECTORY, handlePickDirectory);
  ipcMain.on(CH_CLOSE_WINDOW, handleCloseWindow);

  // Toolbar channels
  ipcMain.handle(CH_TOOLBAR_LIST, handleToolbarList);
  ipcMain.handle(CH_PIN, handlePin);
  ipcMain.handle(CH_UNPIN, handleUnpin);
  ipcMain.handle(CH_REORDER_PINNED, handleReorderPinned);
  ipcMain.handle(CH_OPEN_MANAGE, handleOpenManage);

  mainLogger.info('extensions.ipc.register.ok', { channelCount: 17 });
}

export function unregisterExtensionsHandlers(): void {
  mainLogger.info('extensions.ipc.unregister');

  ipcMain.removeHandler(CH_LIST);
  ipcMain.removeHandler(CH_ENABLE);
  ipcMain.removeHandler(CH_DISABLE);
  ipcMain.removeHandler(CH_REMOVE);
  ipcMain.removeHandler(CH_GET_DETAILS);
  ipcMain.removeHandler(CH_LOAD_UNPACKED);
  ipcMain.removeHandler(CH_UPDATE);
  ipcMain.removeHandler(CH_SET_HOST_ACCESS);
  ipcMain.removeHandler(CH_GET_DEV_MODE);
  ipcMain.removeHandler(CH_SET_DEV_MODE);
  ipcMain.removeHandler(CH_PICK_DIRECTORY);
  ipcMain.removeAllListeners(CH_CLOSE_WINDOW);

  // Toolbar channels
  ipcMain.removeHandler(CH_TOOLBAR_LIST);
  ipcMain.removeHandler(CH_PIN);
  ipcMain.removeHandler(CH_UNPIN);
  ipcMain.removeHandler(CH_REORDER_PINNED);
  ipcMain.removeHandler(CH_OPEN_MANAGE);

  _manager = null;
  mainLogger.info('extensions.ipc.unregister.ok');
}
