import { ipcMain } from 'electron';
import { mainLogger } from '../logger';
import { detectChromeProfiles } from './profiles';
import { importChromeProfileCookies, listSessionCookies } from './cookies';
import type { AccountStore } from '../identity/AccountStore';

export interface ChromeImportHandlerDeps {
  accountStore: AccountStore;
}

export function registerChromeImportHandlers(deps: ChromeImportHandlerDeps): void {
  const { accountStore } = deps;
  mainLogger.info('chromeImportHandlers.register');

  ipcMain.handle('chrome-import:detect-profiles', () => {
    mainLogger.info('chromeImportHandlers.detectProfiles');
    return detectChromeProfiles();
  });

  ipcMain.handle('chrome-import:import-cookies', async (_event, profileId: string) => {
    mainLogger.info('chromeImportHandlers.importCookies', { profileId });
    const result = await importChromeProfileCookies(profileId);
    // Persist a sync record so the UI can show "Synced 5m ago" on the next
    // open instead of treating the profile as never-synced.
    accountStore.recordChromeProfileSync(result.profileId, {
      imported: result.imported,
      total: result.total,
      domain_count: result.domains.length,
      new_cookies: result.newCookies,
      updated_cookies: result.updatedCookies,
      unchanged_cookies: result.unchangedCookies,
      new_domain_count: result.newDomains.length,
      updated_domain_count: result.updatedDomains.length,
    });
    return result;
  });

  ipcMain.handle('chrome-import:list-cookies', async () => {
    const cookies = await listSessionCookies();
    mainLogger.info('chromeImportHandlers.listCookies', { count: cookies.length });
    return cookies;
  });

  ipcMain.handle('chrome-import:get-syncs', () => {
    return accountStore.getChromeProfileSyncs();
  });

  mainLogger.info('chromeImportHandlers.register.done');
}

export function unregisterChromeImportHandlers(): void {
  ipcMain.removeHandler('chrome-import:detect-profiles');
  ipcMain.removeHandler('chrome-import:import-cookies');
  ipcMain.removeHandler('chrome-import:list-cookies');
  ipcMain.removeHandler('chrome-import:get-syncs');
  mainLogger.info('chromeImportHandlers.unregistered');
}
