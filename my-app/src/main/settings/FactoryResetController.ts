/**
 * FactoryResetController — permanently wipe all app-local data.
 *
 * The settings UI advertises "permanently delete all data and restart". Before
 * this controller landed the `settings:factory-reset` handler only removed
 * account.json, preferences.json, a few keytar entries, daemon socket files,
 * and logs/. Every other app-local store survived the reset — see
 * Issues #217 (bookmarks / history / passwords / autofill / safeStorage
 * token fallbacks) and #225 (profile dirs / permissions / granted devices /
 * content categories).
 *
 * Fix mirrors the sign-out "clear" path (#216 / #244): wipe each store via
 * its public API, then unlink the underlying JSON if it survived, then
 * `rm -rf` `<userData>/profiles/` and every `*.oauth-tokens.enc` safeStorage
 * fallback file.
 *
 * D2 logging: every store wipe and file removal is logged at info. Errors
 * are warnings (never throws) so one failing store cannot block the others.
 */

import fs from 'node:fs';
import path from 'node:path';
import { mainLogger } from '../logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANTHROPIC_SERVICE = 'com.agenticbrowser.anthropic';
const DAEMON_SOCK_PREFIX = 'daemon-';
const DAEMON_SOCK_SUFFIX = '.sock';
const LOGS_DIR_NAME = 'logs';
const PROFILES_DIR_NAME = 'profiles';
const OAUTH_FALLBACK_SUFFIX = '.oauth-tokens.enc';
const PREFS_FILE_NAME = 'preferences.json';
const ACCOUNT_FILE_NAME = 'account.json';

const KEYCHAIN_SERVICES = [
  'com.agenticbrowser.oauth',
  ANTHROPIC_SERVICE,
  'com.agenticbrowser.refresh',
] as const;

// App-local JSON files that are wiped even when the in-memory store is also
// cleared through its public API. The disk file is removed as belt + braces
// in case the store's debounced flush recreates it, and so the next launch
// starts completely fresh.
const APP_LOCAL_JSON_FILES = [
  'bookmarks.json',
  'history.json',
  'passwords.json',
  'autofill.json',
  'permissions.json',
  'granted-devices.json',
  'content-categories.json',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Public API surface each store exposes for "wipe everything". Every member
 * is optional so the controller can be used from partial test fixtures and
 * from startup paths where some stores haven't been initialised yet.
 */
export interface FactoryResetStores {
  bookmarkStore?: { deleteAll(): void };
  historyStore?: { clearAll(): void };
  passwordStore?: { deleteAllPasswords(): void };
  autofillStore?: { deleteAll(): void };
  permissionStore?: { resetAllSitePermissions(): void };
  deviceStore?: { revokeAll(): void };
  contentCategoryStore?: { resetAllOverrides(): void };
}

export interface FactoryResetDeps {
  userDataPath: string;
  stores?: FactoryResetStores;
  /**
   * keytar-like module. Injected for tests. In production we `require('keytar')`
   * inside the controller when this is omitted.
   */
  keytar?: {
    findCredentials(service: string): Promise<Array<{ account: string }>>;
    deletePassword(service: string, account: string): Promise<boolean>;
  };
}

export interface FactoryResetResult {
  success: boolean;
  /** Names of wipe steps that threw. Empty array on clean success. */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function performFactoryReset(
  deps: FactoryResetDeps,
): Promise<FactoryResetResult> {
  mainLogger.info('FactoryResetController.performFactoryReset.start', {
    userDataPath: deps.userDataPath,
    hasStores: !!deps.stores,
  });

  const errors: string[] = [];
  const userData = deps.userDataPath;

  // 1. Clear in-memory app-local stores via their public APIs. This matches
  //    the sign-out "clear" behaviour (#244) so the two code paths stay
  //    symmetric.
  clearAppLocalStores(deps.stores, errors);

  // 2. Unlink the backing JSON for every app-local store. If a store's
  //    debounced flush later rewrites its file, step 3 will have already
  //    removed the containing `profiles/<id>/` dir for non-default profiles
  //    and a blank default-profile file is harmless.
  unlinkAppLocalJsonFiles(userData, errors);

  // 3. account.json + preferences.json — existing narrow wipe surface.
  unlinkIfExists(path.join(userData, ACCOUNT_FILE_NAME), 'account', errors);
  unlinkIfExists(path.join(userData, PREFS_FILE_NAME), 'prefs', errors);

  // 4. Per-profile directories (`<userData>/profiles/*`).
  removeProfilesDir(userData, errors);

  // 5. safeStorage fallback files for OAuth tokens (`*.oauth-tokens.enc`).
  unlinkOAuthFallbackFiles(userData, errors);

  // 6. Daemon socket files (`daemon-*.sock`).
  unlinkDaemonSocks(userData, errors);

  // 7. Logs directory.
  removeLogsDir(userData, errors);

  // 8. Keychain: delete every credential under com.agenticbrowser.*.
  await clearKeychainEntries(deps.keytar, errors);

  const success = true;
  mainLogger.info('FactoryResetController.performFactoryReset.complete', {
    success,
    errorCount: errors.length,
  });
  return { success, errors };
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

function clearAppLocalStores(
  stores: FactoryResetStores | undefined,
  errors: string[],
): void {
  if (!stores) {
    mainLogger.info('FactoryResetController.clearAppLocalStores.skipped', {
      msg: 'No stores provided',
    });
    return;
  }

  const attempts: Array<[keyof FactoryResetStores, string, () => void]> = [
    ['bookmarkStore',        'bookmarks',         () => stores.bookmarkStore?.deleteAll()],
    ['historyStore',         'history',           () => stores.historyStore?.clearAll()],
    ['passwordStore',        'passwords',         () => stores.passwordStore?.deleteAllPasswords()],
    ['autofillStore',        'autofill',          () => stores.autofillStore?.deleteAll()],
    ['permissionStore',      'permissions',       () => stores.permissionStore?.resetAllSitePermissions()],
    ['deviceStore',          'granted-devices',   () => stores.deviceStore?.revokeAll()],
    ['contentCategoryStore', 'content-categories', () => stores.contentCategoryStore?.resetAllOverrides()],
  ];

  for (const [key, label, fn] of attempts) {
    if (!stores[key]) continue;
    try {
      fn();
      mainLogger.info('FactoryResetController.clearAppLocalStores.ok', { store: label });
    } catch (err) {
      const msg = `${label}: ${(err as Error).message}`;
      errors.push(msg);
      mainLogger.error('FactoryResetController.clearAppLocalStores.failed', {
        store: label,
        error: (err as Error).message,
      });
    }
  }
}

function unlinkAppLocalJsonFiles(userData: string, errors: string[]): void {
  for (const name of APP_LOCAL_JSON_FILES) {
    unlinkIfExists(path.join(userData, name), `file:${name}`, errors);
  }
}

function unlinkIfExists(filePath: string, label: string, errors: string[]): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      mainLogger.info('FactoryResetController.unlinkIfExists.ok', { label, filePath });
    }
  } catch (err) {
    errors.push(`${label}: ${(err as Error).message}`);
    mainLogger.warn('FactoryResetController.unlinkIfExists.failed', {
      label,
      filePath,
      error: (err as Error).message,
    });
  }
}

function removeProfilesDir(userData: string, errors: string[]): void {
  const profilesPath = path.join(userData, PROFILES_DIR_NAME);
  try {
    if (fs.existsSync(profilesPath)) {
      fs.rmSync(profilesPath, { recursive: true, force: true });
      mainLogger.info('FactoryResetController.removeProfilesDir.ok', { profilesPath });
    }
  } catch (err) {
    errors.push(`profiles: ${(err as Error).message}`);
    mainLogger.warn('FactoryResetController.removeProfilesDir.failed', {
      profilesPath,
      error: (err as Error).message,
    });
  }
}

function unlinkOAuthFallbackFiles(userData: string, errors: string[]): void {
  try {
    if (!fs.existsSync(userData)) return;
    const entries = fs.readdirSync(userData);
    for (const name of entries) {
      if (!name.endsWith(OAUTH_FALLBACK_SUFFIX)) continue;
      unlinkIfExists(path.join(userData, name), `oauth-fallback:${name}`, errors);
    }
  } catch (err) {
    errors.push(`oauth-fallback-scan: ${(err as Error).message}`);
    mainLogger.warn('FactoryResetController.unlinkOAuthFallbackFiles.failed', {
      userData,
      error: (err as Error).message,
    });
  }
}

function unlinkDaemonSocks(userData: string, errors: string[]): void {
  try {
    if (!fs.existsSync(userData)) return;
    const entries = fs.readdirSync(userData);
    for (const name of entries) {
      if (!name.startsWith(DAEMON_SOCK_PREFIX) || !name.endsWith(DAEMON_SOCK_SUFFIX)) continue;
      unlinkIfExists(path.join(userData, name), `sock:${name}`, errors);
    }
  } catch (err) {
    errors.push(`daemon-sock-scan: ${(err as Error).message}`);
    mainLogger.warn('FactoryResetController.unlinkDaemonSocks.failed', {
      userData,
      error: (err as Error).message,
    });
  }
}

function removeLogsDir(userData: string, errors: string[]): void {
  const logsPath = path.join(userData, LOGS_DIR_NAME);
  try {
    if (fs.existsSync(logsPath)) {
      fs.rmSync(logsPath, { recursive: true, force: true });
      mainLogger.info('FactoryResetController.removeLogsDir.ok', { logsPath });
    }
  } catch (err) {
    errors.push(`logs: ${(err as Error).message}`);
    mainLogger.warn('FactoryResetController.removeLogsDir.failed', {
      logsPath,
      error: (err as Error).message,
    });
  }
}

async function clearKeychainEntries(
  keytarOverride: FactoryResetDeps['keytar'],
  errors: string[],
): Promise<void> {
  let keytar: FactoryResetDeps['keytar'];

  if (keytarOverride) {
    keytar = keytarOverride;
  } else {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      keytar = require('keytar') as FactoryResetDeps['keytar'];
    } catch (err) {
      errors.push(`keychain-load: ${(err as Error).message}`);
      mainLogger.warn('FactoryResetController.clearKeychainEntries.loadFailed', {
        error: (err as Error).message,
      });
      return;
    }
  }

  if (!keytar) return;

  for (const service of KEYCHAIN_SERVICES) {
    try {
      const creds = await keytar.findCredentials(service);
      for (const cred of creds) {
        await keytar.deletePassword(service, cred.account);
        mainLogger.info('FactoryResetController.clearKeychainEntries.deleted', {
          service,
          accountLength: cred.account.length,
        });
      }
    } catch (err) {
      errors.push(`keychain:${service}: ${(err as Error).message}`);
      mainLogger.warn('FactoryResetController.clearKeychainEntries.failed', {
        service,
        error: (err as Error).message,
      });
    }
  }
}
