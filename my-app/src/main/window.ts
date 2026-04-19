/**
 * BrowserWindow lifecycle and bounds persistence.
 * Saves/restores window position and size to userData/window-bounds.json.
 */

import { BrowserWindow, app, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { mainLogger } from './logger';

const BOUNDS_FILE_NAME = 'window-bounds.json';
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;
const DEBOUNCE_MS = 500;

interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

function getBoundsPath(): string {
  return path.join(app.getPath('userData'), BOUNDS_FILE_NAME);
}

function loadBounds(): WindowBounds {
  try {
    const raw = fs.readFileSync(getBoundsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as WindowBounds;
    // Validate the bounds are on a visible display
    const displays = screen.getAllDisplays();
    const isVisible = displays.some((d) => {
      if (parsed.x === undefined || parsed.y === undefined) return false;
      return (
        parsed.x >= d.bounds.x &&
        parsed.y >= d.bounds.y &&
        parsed.x < d.bounds.x + d.bounds.width &&
        parsed.y < d.bounds.y + d.bounds.height
      );
    });
    if (!isVisible) {
      mainLogger.warn('window.loadBounds.offScreen', { msg: 'Saved bounds off-screen, using defaults' });
      return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
    }
    return parsed;
  } catch {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  }
}

function saveBounds(win: BrowserWindow): void {
  try {
    const bounds = win.getBounds();
    fs.writeFileSync(getBoundsPath(), JSON.stringify(bounds), 'utf-8');
    mainLogger.debug('window.saveBounds.ok', { bounds });
  } catch (err) {
    mainLogger.error('window.saveBounds.failed', {
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}

export interface ShellWindowOptions {
  titleSuffix?: string;
  incognito?: boolean;
}

export function createShellWindow(opts?: ShellWindowOptions): BrowserWindow {
  const bounds = loadBounds();
  const titleSuffix = opts?.titleSuffix ?? '';
  const incognito = opts?.incognito ?? false;
  mainLogger.info('window.createShellWindow', { bounds, titleSuffix, incognito });

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: incognito ? '#1a1a2e' : '#0d0d0d',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (titleSuffix) {
    win.setTitle(win.getTitle() + titleSuffix);
  }

  // Debounced bounds persistence — incognito windows do NOT persist bounds
  // to avoid leaking usage patterns.
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedSave = () => {
    if (incognito) return;
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => saveBounds(win), DEBOUNCE_MS);
  };

  win.on('resize', debouncedSave);
  win.on('move', debouncedSave);
  win.on('close', () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    if (!incognito) saveBounds(win);
    mainLogger.info('window.close', { windowId: win.id, incognito });
  });
  win.on('closed', () => {
    mainLogger.info('window.closed', { msg: 'Shell window destroyed', incognito });
  });

  return win;
}
