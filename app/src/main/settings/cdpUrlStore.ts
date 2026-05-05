/**
 * CDP WebSocket URL preference storage.
 *
 * Persisted to <userData>/cdp-url.json as plain JSON (not Keychain — a URL
 * preference doesn't need encryption).
 *
 * When set, the app connects to an existing browser via CDP WebSocket instead
 * of creating a new embedded WebContentsView.
 */

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { mainLogger } from '../logger';

const CDP_URL_FILE = 'cdp-url.json';

export interface CdpUrlState {
  /** CDP WebSocket URL, e.g. ws://127.0.0.1:9222/devtools/browser/... */
  url: string | null;
  /** When true, a single global daemon is kept alive across all sessions. */
  alwaysAllow: boolean;
}

const DEFAULT_STATE: CdpUrlState = {
  url: null,
  alwaysAllow: false,
};

let onChange: ((state: CdpUrlState) => void) | null = null;

export function setCdpUrlChangeCallback(cb: ((state: CdpUrlState) => void) | null): void {
  onChange = cb;
}

function cdpUrlFilePath(): string {
  return path.join(app.getPath('userData'), CDP_URL_FILE);
}

export function getCdpUrlState(): CdpUrlState {
  try {
    const raw = fs.readFileSync(cdpUrlFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<CdpUrlState>;
    return {
      url: typeof parsed.url === 'string' && parsed.url.length > 0 ? parsed.url : null,
      alwaysAllow: parsed.alwaysAllow === true,
    };
  } catch {
    // File missing or corrupt — fall through to default.
  }
  return { ...DEFAULT_STATE };
}

export function getCdpUrl(): string | null {
  return getCdpUrlState().url;
}

export function getAlwaysAllow(): boolean {
  return getCdpUrlState().alwaysAllow;
}

export function setCdpUrl(url: string | null): CdpUrlState {
  const existing = getCdpUrlState();
  const next: CdpUrlState = {
    url: url && url.trim().length > 0 ? url.trim() : null,
    alwaysAllow: existing.alwaysAllow,
  };
  try {
    fs.mkdirSync(path.dirname(cdpUrlFilePath()), { recursive: true });
    fs.writeFileSync(cdpUrlFilePath(), JSON.stringify(next, null, 2), 'utf-8');
    mainLogger.info('cdpUrl.set', { url: next.url });
  } catch (err) {
    mainLogger.error('cdpUrl.set-failed', { error: (err as Error).message });
  }
  onChange?.(next);
  return next;
}

export function setAlwaysAllow(alwaysAllow: boolean): CdpUrlState {
  const existing = getCdpUrlState();
  const next: CdpUrlState = {
    url: existing.url,
    alwaysAllow,
  };
  try {
    fs.mkdirSync(path.dirname(cdpUrlFilePath()), { recursive: true });
    fs.writeFileSync(cdpUrlFilePath(), JSON.stringify(next, null, 2), 'utf-8');
    mainLogger.info('cdpUrl.alwaysAllow.set', { alwaysAllow });
  } catch (err) {
    mainLogger.error('cdpUrl.alwaysAllow.set-failed', { error: (err as Error).message });
  }
  onChange?.(next);
  return next;
}
