import { ipcMain } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mainLogger } from '../logger';
import { assertString } from '../ipc-validators';
import { getCdpUrlState, setCdpUrl, setAlwaysAllow, getAlwaysAllow } from './cdpUrlStore';

const CH_GET = 'settings:cdp-url:get';
const CH_SET = 'settings:cdp-url:set';
const CH_TEST = 'settings:cdp-url:test';
const CH_ALWAYS_ALLOW_GET = 'settings:cdp-url:always-allow:get';
const CH_ALWAYS_ALLOW_SET = 'settings:cdp-url:always-allow:set';

function chromeProfileCandidates(): string[] {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
      path.join(home, 'Library', 'Application Support', 'Chromium'),
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome Canary'),
    ];
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      path.join(localAppData, 'Google', 'Chrome', 'User Data'),
      path.join(localAppData, 'Google', 'Chrome SxS', 'User Data'),
      path.join(localAppData, 'Chromium', 'User Data'),
    ];
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [
    path.join(configHome, 'google-chrome'),
    path.join(configHome, 'google-chrome-beta'),
    path.join(configHome, 'google-chrome-unstable'),
    path.join(configHome, 'chromium'),
  ];
}

function readDevToolsActivePort(): { port: string; wsPath: string } | null {
  for (const base of chromeProfileCandidates()) {
    // DevToolsActivePort lives in the profile dir (e.g. Default/ or Profile 1/)
    // Try the base itself first, then common profile subdirs.
    const candidates = [base, path.join(base, 'Default'), path.join(base, 'Profile 1')];
    for (const dir of candidates) {
      try {
        const raw = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf-8').trim();
        const [port, wsPath] = raw.split('\n', 2);
        if (port && wsPath) return { port: port.trim(), wsPath: wsPath.trim() };
      } catch { continue; }
    }
  }
  return null;
}

/**
 * If the user gives a bare host:port like ws://127.0.0.1:9222 (no path, or
 * just "/"), probe /json/version over HTTP and return the full
 * webSocketDebuggerUrl so the agent gets a real endpoint.
 *
 * Chrome 144+ hides HTTP endpoints when remote-debugging is toggled via
 * chrome://inspect — on 404 we fall back to reading DevToolsActivePort from
 * the local Chrome profile.
 */
async function resolveCdpWsUrl(input: string): Promise<string> {
  const trimmed = input.trim();
  const needsResolve =
    !trimmed.includes('/devtools/') || new URL(trimmed).pathname === '/';
  if (!needsResolve) return trimmed;

  const httpUrl = trimmed.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
  const versionUrl = new URL(httpUrl);
  versionUrl.pathname = '/json/version';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(versionUrl.toString(), { signal: controller.signal });
    if (res.ok) {
      const body = (await res.json()) as { webSocketDebuggerUrl?: string };
      if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
    }
  } catch {
    // Network error — fall through to DevToolsActivePort
  } finally {
    clearTimeout(timer);
  }

  // Chrome 144+ returns 404 on HTTP endpoints — read DevToolsActivePort instead.
  const active = readDevToolsActivePort();
  if (active) {
    const { port, wsPath } = active;
    const parsed = new URL(trimmed);
    const inputPort = parsed.port || '9222';
    if (inputPort === port) {
      return `ws://127.0.0.1:${port}${wsPath}`;
    }
  }

  throw new Error('Could not resolve CDP endpoint: HTTP 404 and DevToolsActivePort not found');
}

export function registerCdpUrlHandlers(): void {
  ipcMain.handle(CH_GET, (): { url: string | null; alwaysAllow: boolean } => {
    const state = getCdpUrlState();
    return { url: state.url, alwaysAllow: state.alwaysAllow };
  });

  ipcMain.handle(CH_SET, async (_evt, url: unknown): Promise<{ url: string | null }> => {
    if (url === null || url === undefined) {
      mainLogger.info('cdpUrlIpc.clear');
      return setCdpUrl(null);
    }
    const validated = assertString(url, 'url', 2000);
    mainLogger.info('cdpUrlIpc.save', { urlLength: validated.length });
    try {
      const resolved = await resolveCdpWsUrl(validated);
      mainLogger.info('cdpUrlIpc.resolved', { input: validated, resolved });
      return setCdpUrl(resolved);
    } catch (err) {
      // If resolution fails, still save the raw URL so the user can fix it.
      mainLogger.warn('cdpUrlIpc.resolveFailed', { input: validated, error: (err as Error).message });
      return setCdpUrl(validated);
    }
  });

  ipcMain.handle(CH_TEST, async (_evt, url: unknown): Promise<{ ok: boolean; error?: string }> => {
    const validated = assertString(url, 'url', 2000);
    mainLogger.info('cdpUrlIpc.test', { urlLength: validated.length });
    let resolved: string;
    try {
      resolved = await resolveCdpWsUrl(validated);
    } catch (err) {
      const msg = (err as Error).message ?? 'Connection failed';
      mainLogger.warn('cdpUrlIpc.test.resolveFailed', { error: msg });
      return { ok: false, error: msg };
    }

    // Chrome 144+ blocks HTTP /json/* when remote-debugging is toggled via UI.
    // Try HTTP first; on 404 fall back to a direct WebSocket handshake.
    try {
      const httpUrl = resolved.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
      const target = new URL(httpUrl);
      target.pathname = '/json/version';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(target.toString(), { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const body = (await res.json()) as { Browser?: string };
        return { ok: true, error: body.Browser };
      }
      // HTTP 404 — fall through to WS probe
    } catch {
      // Network error — fall through to WS probe
    }

    // WebSocket handshake test (works even when HTTP endpoints are hidden).
    try {
      const ws = new (await import('ws')).default(resolved);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { ws.close(); reject(new Error('WS handshake timeout')); }, 5000);
        ws.once('open', () => { clearTimeout(timer); ws.close(); resolve(); });
        ws.once('error', (err: Error) => { clearTimeout(timer); reject(err); });
      });
      return { ok: true, error: 'CDP WebSocket reachable' };
    } catch (err) {
      const msg = (err as Error).message ?? 'WebSocket connection failed';
      mainLogger.warn('cdpUrlIpc.test.wsFailed', { error: msg });
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle(CH_ALWAYS_ALLOW_GET, (): { alwaysAllow: boolean } => {
    return { alwaysAllow: getAlwaysAllow() };
  });

  ipcMain.handle(CH_ALWAYS_ALLOW_SET, (_evt, value: unknown): { alwaysAllow: boolean } => {
    const bool = value === true;
    mainLogger.info('cdpUrlIpc.alwaysAllow.set', { bool });
    const state = setAlwaysAllow(bool);
    return { alwaysAllow: state.alwaysAllow };
  });
}
