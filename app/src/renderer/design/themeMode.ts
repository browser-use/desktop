/*
 * themeMode.ts — single source of truth for light/dark/system appearance.
 *
 * Persists the user choice in localStorage and reflects it on
 * <html data-mode="light|dark"> so semantic CSS tokens flip atomically.
 *
 * Components never read localStorage directly — they consume getThemeMode()
 * or subscribe via subscribeThemeMode(). Settings UI calls setThemeMode().
 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'browser-use:theme-mode';
const DEFAULT_MODE: ThemeMode = 'dark';

const VALID_MODES: ReadonlySet<ThemeMode> = new Set(['light', 'dark', 'system']);

const listeners = new Set<(mode: ThemeMode, resolved: ResolvedThemeMode) => void>();

function readStoredMode(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && VALID_MODES.has(raw as ThemeMode)) return raw as ThemeMode;
  } catch {
    // localStorage unavailable — fall through to default.
  }
  return DEFAULT_MODE;
}

function systemPrefersLight(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function resolveThemeMode(mode: ThemeMode): ResolvedThemeMode {
  if (mode === 'system') return systemPrefersLight() ? 'light' : 'dark';
  return mode;
}

export function getThemeMode(): ThemeMode {
  return readStoredMode();
}

export function applyThemeMode(mode: ThemeMode = readStoredMode()): ResolvedThemeMode {
  const resolved = resolveThemeMode(mode);
  document.documentElement.dataset.mode = resolved;
  return resolved;
}

export function setThemeMode(mode: ThemeMode): ResolvedThemeMode {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore — still apply in-memory.
  }
  // Push to main so BrowserWindow.backgroundColor matches and the bg-flash
  // during view swaps stops. Best-effort — main may not be reachable in
  // tests / non-Electron environments.
  getThemeApi()?.set(mode).catch(() => {});
  const resolved = applyThemeMode(mode);
  for (const fn of listeners) fn(mode, resolved);
  return resolved;
}

export function subscribeThemeMode(
  fn: (mode: ThemeMode, resolved: ResolvedThemeMode) => void,
): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

type ThemeApi = {
  get: () => Promise<{ mode: ThemeMode; resolved: ResolvedThemeMode }>;
  set: (m: ThemeMode) => Promise<unknown>;
  onChange?: (cb: (event: { mode: ThemeMode; resolved: ResolvedThemeMode }) => void) => () => void;
};

function getThemeApi(): ThemeApi | undefined {
  return (window as { electronAPI?: { settings?: { theme?: ThemeApi } } })
    .electronAPI?.settings?.theme;
}

/**
 * Initialise theme handling for a renderer entry point.
 * Applies the stored mode immediately, then asks main for the canonical
 * value so pill / logs / hub stay in sync. Re-applies whenever 'system'
 * is selected and the OS preference flips.
 */
export function initThemeMode(): void {
  applyThemeMode();

  // Hydrate from main — every renderer (hub, pill, logs) shares one source
  // of truth. Best-effort; non-Electron envs (tests) just keep the default.
  const api = getThemeApi();
  api?.get().then(({ mode }) => {
    try { window.localStorage.setItem(STORAGE_KEY, mode); } catch { /* noop */ }
    const resolved = applyThemeMode(mode);
    for (const fn of listeners) fn(mode, resolved);
  }).catch(() => {});

  // Live updates — when one renderer flips theme via setThemeMode, main
  // broadcasts to every window so pill / logs / hub all repaint together.
  api?.onChange?.((payload) => {
    try { window.localStorage.setItem(STORAGE_KEY, payload.mode); } catch { /* noop */ }
    document.documentElement.dataset.mode = payload.resolved;
    for (const fn of listeners) fn(payload.mode, payload.resolved);
  });

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const mql = window.matchMedia('(prefers-color-scheme: light)');
  const handleSystemChange = () => {
    if (readStoredMode() === 'system') {
      const resolved = applyThemeMode('system');
      for (const fn of listeners) fn('system', resolved);
    }
  };
  mql.addEventListener?.('change', handleSystemChange);

  // Cross-window sync (settings change in hub should propagate to pill etc.)
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    const mode = readStoredMode();
    const resolved = applyThemeMode(mode);
    for (const fn of listeners) fn(mode, resolved);
  });
}
