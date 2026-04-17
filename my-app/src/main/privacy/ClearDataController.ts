/**
 * ClearDataController — narrow clears for "Clear browsing data" dialog.
 *
 * IMPORTANT: each DataType maps to its OWN Electron API. We DO NOT funnel
 * all checkboxes into one blanket `session.clearStorageData({ storages: [...] })`
 * call — that would cause checking "history" alone to also wipe cookies and
 * cache. Each clear is independent; failures are captured per-type.
 *
 * Stubs (downloads, autofill, hostedApp) return `note: 'no-op'` until those
 * app-local stores exist.
 */

import { session } from 'electron';
import { mainLogger } from '../logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const DATA_TYPES = [
  'history',
  'cookies',
  'cache',
  'downloads',
  'passwords',
  'autofill',
  'siteSettings',
  'hostedApp',
] as const;

export type DataType = typeof DATA_TYPES[number];

export interface ClearDataRequest {
  types: DataType[];
  /**
   * Milliseconds in the past to clear from. 0 = all time (no startTime filter).
   * Only honoured by APIs that accept `startTime` (clearStorageData).
   * clearCache / clearHistory / clearAuthCache ignore the range and always
   * clear everything — this is an Electron API limitation.
   */
  timeRangeMs: number;
}

export interface ClearDataResult {
  cleared: DataType[];
  errors: Partial<Record<DataType, string>>;
  notes: Partial<Record<DataType, string>>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SITE_SETTINGS_STORAGES = ['indexdb', 'localstorage', 'websql', 'serviceworkers'] as const;
const CACHE_STORAGES         = ['cachestorage', 'shadercache'] as const;
const COOKIE_STORAGES        = ['cookies'] as const;

const NOTE_NOOP_DOWNLOADS = 'downloads store not yet implemented; no-op';
const NOTE_NOOP_AUTOFILL  = 'autofill store not yet implemented; no-op';
const NOTE_NOOP_HOSTEDAPP = 'hosted-app data store not yet implemented; no-op';
const NOTE_RANGE_IGNORED_CACHE     = 'time range ignored — clearCache wipes all cache';
const NOTE_RANGE_IGNORED_HISTORY   = 'time range ignored — clearHistory wipes all history';
const NOTE_RANGE_IGNORED_PASSWORDS = 'time range ignored — clearAuthCache wipes all auth';

// ---------------------------------------------------------------------------
// Per-type clear implementations
// ---------------------------------------------------------------------------

async function clearHistory(): Promise<{ note?: string }> {
  await session.defaultSession.clearHistory();
  return { note: NOTE_RANGE_IGNORED_HISTORY };
}

async function clearCookies(startTimeMs?: number): Promise<{ note?: string }> {
  const opts: Electron.ClearStorageDataOptions = {
    storages: [...COOKIE_STORAGES],
  };
  if (startTimeMs !== undefined) {
    (opts as Electron.ClearStorageDataOptions & { startTime?: number }).startTime = startTimeMs;
  }
  await session.defaultSession.clearStorageData(opts);
  return {};
}

async function clearCacheAll(): Promise<{ note?: string }> {
  await session.defaultSession.clearCache();
  await session.defaultSession.clearStorageData({ storages: [...CACHE_STORAGES] });
  return { note: NOTE_RANGE_IGNORED_CACHE };
}

async function clearPasswords(): Promise<{ note?: string }> {
  await session.defaultSession.clearAuthCache();
  return { note: NOTE_RANGE_IGNORED_PASSWORDS };
}

async function clearSiteSettings(startTimeMs?: number): Promise<{ note?: string }> {
  const opts: Electron.ClearStorageDataOptions = {
    storages: [...SITE_SETTINGS_STORAGES],
  };
  if (startTimeMs !== undefined) {
    (opts as Electron.ClearStorageDataOptions & { startTime?: number }).startTime = startTimeMs;
  }
  await session.defaultSession.clearStorageData(opts);
  return {};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function clearBrowsingData(req: ClearDataRequest): Promise<ClearDataResult> {
  const types = Array.from(new Set(req.types));
  const rangeMs = Math.max(0, req.timeRangeMs | 0);
  const startTimeMs = rangeMs > 0 ? Date.now() - rangeMs : undefined;

  mainLogger.info('privacy.clearBrowsingData.start', {
    types,
    timeRangeMs: rangeMs,
    allTime: startTimeMs === undefined,
  });

  const result: ClearDataResult = { cleared: [], errors: {}, notes: {} };

  for (const type of types) {
    try {
      let outcome: { note?: string };
      switch (type) {
        case 'history':
          outcome = await clearHistory();
          break;
        case 'cookies':
          outcome = await clearCookies(startTimeMs);
          break;
        case 'cache':
          outcome = await clearCacheAll();
          break;
        case 'downloads':
          outcome = { note: NOTE_NOOP_DOWNLOADS };
          break;
        case 'passwords':
          outcome = await clearPasswords();
          break;
        case 'autofill':
          outcome = { note: NOTE_NOOP_AUTOFILL };
          break;
        case 'siteSettings':
          outcome = await clearSiteSettings(startTimeMs);
          break;
        case 'hostedApp':
          outcome = { note: NOTE_NOOP_HOSTEDAPP };
          break;
        default: {
          const _exhaustive: never = type;
          throw new Error(`unknown DataType: ${String(_exhaustive)}`);
        }
      }
      result.cleared.push(type);
      if (outcome.note) result.notes[type] = outcome.note;
      mainLogger.info('privacy.clearBrowsingData.typeOk', { type, note: outcome.note });
    } catch (err) {
      const msg = (err as Error).message ?? 'unknown error';
      result.errors[type] = msg;
      mainLogger.error('privacy.clearBrowsingData.typeFailed', { type, error: msg });
    }
  }

  mainLogger.info('privacy.clearBrowsingData.done', {
    clearedCount: result.cleared.length,
    errorCount: Object.keys(result.errors).length,
    noteCount: Object.keys(result.notes).length,
  });

  return result;
}
