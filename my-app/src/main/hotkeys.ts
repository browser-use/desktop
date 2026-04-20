import { globalShortcut } from 'electron';
import { mainLogger } from './logger';

const log = {
  info:  (comp: string, ctx: object) => mainLogger.info(comp, ctx as Record<string, unknown>),
  warn:  (comp: string, ctx: object) => mainLogger.warn(comp, ctx as Record<string, unknown>),
};

const HOTKEY_GLOBAL_CMDBAR = 'CommandOrControl+Shift+Space' as const;

export function registerHotkeys(callback: () => void): boolean {
  log.info('hotkeys.register', { hotkey: HOTKEY_GLOBAL_CMDBAR });

  const ok = globalShortcut.register(HOTKEY_GLOBAL_CMDBAR, () => {
    log.info('hotkeys.fired', { hotkey: HOTKEY_GLOBAL_CMDBAR });
    callback();
  });

  if (!ok) {
    log.warn('hotkeys.register.failed', {
      message: 'Failed to register global shortcut',
      hotkey: HOTKEY_GLOBAL_CMDBAR,
    });
  }

  return ok;
}

export function unregisterHotkeys(): void {
  log.info('hotkeys.unregister', { hotkey: HOTKEY_GLOBAL_CMDBAR });
  globalShortcut.unregister(HOTKEY_GLOBAL_CMDBAR);
}
