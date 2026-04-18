/**
 * content-categories/ipc.ts — IPC handlers for content category toggles.
 *
 * Follows the permissions/ipc.ts pattern: register/unregister functions,
 * namespaced channels under 'content-categories:'.
 */

import { ipcMain } from 'electron';
import { mainLogger } from '../logger';
import {
  ContentCategoryStore,
  ContentCategory,
  CategoryState,
} from './ContentCategoryStore';

// ---------------------------------------------------------------------------
// Channel constants
// ---------------------------------------------------------------------------

const CH_GET_DEFAULTS     = 'content-categories:get-defaults';
const CH_SET_DEFAULT      = 'content-categories:set-default';
const CH_GET_SITE         = 'content-categories:get-site';
const CH_SET_SITE         = 'content-categories:set-site';
const CH_REMOVE_SITE      = 'content-categories:remove-site';
const CH_GET_ALL          = 'content-categories:get-all';
const CH_CLEAR_ORIGIN     = 'content-categories:clear-origin';
const CH_RESET_ALL        = 'content-categories:reset-all';

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface RegisterContentCategoryHandlersOptions {
  store: ContentCategoryStore;
}

export function registerContentCategoryHandlers(opts: RegisterContentCategoryHandlersOptions): void {
  const { store } = opts;

  ipcMain.handle(CH_GET_DEFAULTS, () => {
    mainLogger.info(CH_GET_DEFAULTS);
    return store.getDefaults();
  });

  ipcMain.handle(CH_SET_DEFAULT, (_e, category: string, state: string) => {
    mainLogger.info(CH_SET_DEFAULT, { category, state });
    store.setDefault(category as ContentCategory, state as CategoryState);
  });

  ipcMain.handle(CH_GET_SITE, (_e, origin: string) => {
    mainLogger.info(CH_GET_SITE, { origin });
    return store.getOverridesForOrigin(origin);
  });

  ipcMain.handle(CH_SET_SITE, (_e, origin: string, category: string, state: string) => {
    mainLogger.info(CH_SET_SITE, { origin, category, state });
    store.setSiteOverride(origin, category as ContentCategory, state as CategoryState);
  });

  ipcMain.handle(CH_REMOVE_SITE, (_e, origin: string, category: string) => {
    mainLogger.info(CH_REMOVE_SITE, { origin, category });
    return store.removeSiteOverride(origin, category as ContentCategory);
  });

  ipcMain.handle(CH_GET_ALL, () => {
    mainLogger.info(CH_GET_ALL);
    return store.getAllOverrides();
  });

  ipcMain.handle(CH_CLEAR_ORIGIN, (_e, origin: string) => {
    mainLogger.info(CH_CLEAR_ORIGIN, { origin });
    store.clearOrigin(origin);
  });

  ipcMain.handle(CH_RESET_ALL, () => {
    mainLogger.info(CH_RESET_ALL);
    store.resetAllOverrides();
  });

  mainLogger.info('content-categories.ipc.registered');
}

export function unregisterContentCategoryHandlers(): void {
  ipcMain.removeHandler(CH_GET_DEFAULTS);
  ipcMain.removeHandler(CH_SET_DEFAULT);
  ipcMain.removeHandler(CH_GET_SITE);
  ipcMain.removeHandler(CH_SET_SITE);
  ipcMain.removeHandler(CH_REMOVE_SITE);
  ipcMain.removeHandler(CH_GET_ALL);
  ipcMain.removeHandler(CH_CLEAR_ORIGIN);
  ipcMain.removeHandler(CH_RESET_ALL);
  mainLogger.info('content-categories.ipc.unregistered');
}
