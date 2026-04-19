import { ipcMain } from 'electron';
import { mainLogger } from '../logger';
import { detectChromeProfiles } from './profiles';
import { importChromeProfileCookies } from './cookies';

export function registerChromeImportHandlers(): void {
  mainLogger.info('chromeImportHandlers.register');

  ipcMain.handle('chrome-import:detect-profiles', () => {
    mainLogger.info('chromeImportHandlers.detectProfiles');
    return detectChromeProfiles();
  });

  ipcMain.handle('chrome-import:import-cookies', async (_event, profileDir: string) => {
    mainLogger.info('chromeImportHandlers.importCookies', { profileDir });
    return importChromeProfileCookies(profileDir);
  });

  mainLogger.info('chromeImportHandlers.register.done');
}

export function unregisterChromeImportHandlers(): void {
  ipcMain.removeHandler('chrome-import:detect-profiles');
  ipcMain.removeHandler('chrome-import:import-cookies');
  mainLogger.info('chromeImportHandlers.unregistered');
}
