import { ipcMain } from 'electron';
import { getThemeMode, resolveThemeMode, setThemeMode, type ThemeMode } from './themeMode';

export function registerThemeHandlers(): void {
  ipcMain.handle('theme:get', () => {
    const mode = getThemeMode();
    return { mode, resolved: resolveThemeMode(mode) };
  });

  ipcMain.handle('theme:set', (_evt, mode: unknown) => {
    if (mode !== 'light' && mode !== 'dark' && mode !== 'system') {
      throw new TypeError('theme:set expects "light" | "dark" | "system"');
    }
    return setThemeMode(mode as ThemeMode);
  });
}
