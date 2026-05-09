/**
 * Main-process theme-mode store + helpers.
 *
 * Renderers persist their preference here so the main process can:
 *   1. Set BrowserWindow.backgroundColor at creation time, eliminating the
 *      black flash users saw when swapping views (the OS shows the window's
 *      native bg before the renderer has painted).
 *   2. Update existing windows on theme change via win.setBackgroundColor().
 *
 * Persisted to <userData>/theme.json. Defaults to 'dark' (matches the legacy
 * baked-in window backgrounds).
 */

import fs from 'node:fs';
import path from 'node:path';
import { app, nativeTheme, BrowserWindow } from 'electron';
import { mainLogger } from './logger';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedThemeMode = 'light' | 'dark';

const FILE = 'theme.json';
const VALID = new Set<ThemeMode>(['light', 'dark', 'system']);
const DEFAULT_MODE: ThemeMode = 'dark';

/** Hex bg colors per resolved mode — must match --color-bg-base in CSS. */
export const WINDOW_BG: Record<ResolvedThemeMode, string> = {
  dark:  '#131318',
  light: '#ede9e2',
};

function filePath(): string {
  return path.join(app.getPath('userData'), FILE);
}

function readMode(): ThemeMode {
  try {
    const raw = fs.readFileSync(filePath(), 'utf-8');
    const parsed = JSON.parse(raw) as { mode?: string };
    if (parsed.mode && VALID.has(parsed.mode as ThemeMode)) {
      return parsed.mode as ThemeMode;
    }
  } catch {
    // file missing or invalid — fall through.
  }
  return DEFAULT_MODE;
}

function writeMode(mode: ThemeMode): void {
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify({ mode }, null, 2), 'utf-8');
  } catch (err) {
    mainLogger.error('theme.set-failed', { error: (err as Error).message });
  }
}

export function getThemeMode(): ThemeMode {
  return readMode();
}

export function resolveThemeMode(mode: ThemeMode = readMode()): ResolvedThemeMode {
  if (mode === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return mode;
}

export function getWindowBackgroundColor(): string {
  return WINDOW_BG[resolveThemeMode()];
}

export function setThemeMode(mode: ThemeMode): { mode: ThemeMode; resolved: ResolvedThemeMode } {
  if (!VALID.has(mode)) throw new TypeError(`invalid theme mode: ${mode}`);
  writeMode(mode);
  const resolved = resolveThemeMode(mode);
  applyBackgroundToAllWindows(resolved);
  broadcastThemeChange(mode, resolved);
  mainLogger.info('theme.set', { mode, resolved });
  return { mode, resolved };
}

function applyBackgroundToAllWindows(resolved: ResolvedThemeMode): void {
  const color = WINDOW_BG[resolved];
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.setBackgroundColor(color);
      // Existing WebContentsView children (e.g. browser session views) also
      // need updating so they don't paint dark on the next attach.
      for (const child of win.contentView.children) {
        const setter = (child as { setBackgroundColor?: (c: string) => void }).setBackgroundColor;
        // Don't touch fully-transparent overlays (e.g. takeover overlay).
        const bg = (child as { getBackgroundColor?: () => string }).getBackgroundColor?.();
        if (bg && bg.length === 9 && bg.endsWith('00')) continue;
        setter?.call(child, color);
      }
    } catch (err) {
      mainLogger.warn('theme.apply-bg-failed', { error: (err as Error).message });
    }
  }
}

function broadcastThemeChange(mode: ThemeMode, resolved: ResolvedThemeMode): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('theme:changed', { mode, resolved });
    } catch {
      // window may be loading or destroyed — best effort.
    }
  }
}

/** Watch for OS-level dark/light flips when user picked 'system'. */
export function startSystemThemeWatcher(): void {
  nativeTheme.on('updated', () => {
    if (readMode() === 'system') {
      const resolved = resolveThemeMode();
      applyBackgroundToAllWindows(resolved);
      broadcastThemeChange('system', resolved);
    }
  });
}
