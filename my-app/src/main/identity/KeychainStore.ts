/**
 * KeychainStore — secure token storage for Google OAuth tokens.
 *
 * Primary: macOS Keychain via `keytar` (native module).
 * Fallback: Electron safeStorage-encrypted file in userData when keytar is
 *           unavailable (e.g. first-run before keytar installs, or Keychain denial).
 *
 * Keytar service name: com.agenticbrowser.oauth
 * Keytar account:      <user email>
 * Value:               JSON.stringify(StoredTokens)
 *
 * Security invariant: access_token and refresh_token are NEVER logged.
 * Logged metadata: email (account key), expires_at, scopeCount, storageBackend.
 *
 * D2 logging: every Keychain read/write/delete is logged at debug level.
 */

import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import { mainLogger } from '../logger';
import type { GoogleOAuthScope } from '../../shared/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const KEYCHAIN_SERVICE = 'com.agenticbrowser.oauth';
const FALLBACK_FILE_NAME = 'oauth-tokens.enc';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scopes: GoogleOAuthScope[];
}

// ---------------------------------------------------------------------------
// KeychainStore
// ---------------------------------------------------------------------------

export interface KeytarLike {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export class KeychainStore {
  private keytarModule: KeytarLike | null = null;
  private keytarAvailable = false;
  private readonly fallbackDir: string;

  /**
   * @param userDataPath - override userData path (for tests / non-Electron env)
   * @param keytarOverride - inject a keytar-compatible mock (for tests)
   */
  constructor(userDataPath?: string, keytarOverride?: KeytarLike) {
    this.fallbackDir = userDataPath ?? (() => {
      try {
        return app.getPath('userData');
      } catch {
        return '/tmp/agentic-browser';
      }
    })();

    // Use injected mock if provided (test path)
    if (keytarOverride) {
      this.keytarModule = keytarOverride;
      this.keytarAvailable = true;
      mainLogger.info('KeychainStore.init', {
        backend: 'keytar-mock',
        service: KEYCHAIN_SERVICE,
      });
      return;
    }

    // Attempt to load keytar at construction time; fail gracefully
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.keytarModule = require('keytar') as KeytarLike;
      this.keytarAvailable = true;
      mainLogger.info('KeychainStore.init', {
        backend: 'keytar',
        service: KEYCHAIN_SERVICE,
      });
    } catch (err) {
      mainLogger.warn('KeychainStore.init.keytarUnavailable', {
        error: (err as Error).message,
        fallback: 'safeStorage',
      });
      this.keytarAvailable = false;
    }
  }

  /**
   * Store tokens in Keychain (or safeStorage fallback).
   * Tokens are serialised as JSON — access_token and refresh_token are NOT logged.
   */
  async setToken(account: string, tokens: StoredTokens): Promise<void> {
    mainLogger.debug('KeychainStore.setToken', {
      account,
      expiresAt: tokens.expires_at,
      scopeCount: tokens.scopes.length,
      backend: this.keytarAvailable ? 'keytar' : 'safeStorage',
    });

    const serialised = JSON.stringify(tokens);

    if (this.keytarAvailable && this.keytarModule) {
      try {
        await this.keytarModule.setPassword(KEYCHAIN_SERVICE, account, serialised);
        mainLogger.debug('KeychainStore.setToken.keytarWrite.ok', {
          account,
        });
        return;
      } catch (err) {
        mainLogger.warn('KeychainStore.setToken.keytarWrite.failed', {
          account,
          error: (err as Error).message,
          fallback: 'safeStorage',
        });
      }
    }

    // Fallback: safeStorage encrypted file
    this._writeFallback(account, serialised);
  }

  /**
   * Retrieve tokens from Keychain (or fallback).
   * Returns null if no token stored for this account.
   */
  async getToken(account: string): Promise<StoredTokens | null> {
    mainLogger.debug('KeychainStore.getToken', {
      account,
      backend: this.keytarAvailable ? 'keytar' : 'safeStorage',
    });

    if (this.keytarAvailable && this.keytarModule) {
      try {
        const raw = await this.keytarModule.getPassword(KEYCHAIN_SERVICE, account);
        if (raw === null) {
          mainLogger.debug('KeychainStore.getToken.notFound', { account });
          return null;
        }
        const tokens = JSON.parse(raw) as StoredTokens;
        mainLogger.debug('KeychainStore.getToken.ok', {
          account,
          expiresAt: tokens.expires_at,
          scopeCount: tokens.scopes.length,
        });
        return tokens;
      } catch (err) {
        mainLogger.warn('KeychainStore.getToken.keytarRead.failed', {
          account,
          error: (err as Error).message,
          fallback: 'safeStorage',
        });
      }
    }

    return this._readFallback(account);
  }

  /**
   * Delete tokens for this account from Keychain (or fallback).
   */
  async deleteToken(account: string): Promise<void> {
    mainLogger.debug('KeychainStore.deleteToken', {
      account,
      backend: this.keytarAvailable ? 'keytar' : 'safeStorage',
    });

    if (this.keytarAvailable && this.keytarModule) {
      try {
        await this.keytarModule.deletePassword(KEYCHAIN_SERVICE, account);
        mainLogger.debug('KeychainStore.deleteToken.ok', { account });
        return;
      } catch (err) {
        mainLogger.warn('KeychainStore.deleteToken.keytarDelete.failed', {
          account,
          error: (err as Error).message,
        });
      }
    }

    this._deleteFallback(account);
  }

  // -------------------------------------------------------------------------
  // safeStorage fallback helpers
  // -------------------------------------------------------------------------

  private _fallbackPath(account: string): string {
    // Sanitise account to a safe filename
    const safe = account.replace(/[^a-z0-9@._-]/gi, '_');
    return path.join(this.fallbackDir, `${safe}.${FALLBACK_FILE_NAME}`);
  }

  private _writeFallback(account: string, serialised: string): void {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        mainLogger.error('KeychainStore._writeFallback.encryptionUnavailable', {
          account,
          error: 'safeStorage encryption is not available on this system',
        });
        return;
      }
      fs.mkdirSync(this.fallbackDir, { recursive: true });
      const encrypted = safeStorage.encryptString(serialised);
      fs.writeFileSync(this._fallbackPath(account), encrypted);
      mainLogger.warn('KeychainStore._writeFallback.wrote', {
        account,
        note: 'Using safeStorage fallback instead of Keychain — tokens are less protected',
      });
    } catch (err) {
      mainLogger.error('KeychainStore._writeFallback.failed', {
        account,
        error: (err as Error).message,
      });
    }
  }

  private _readFallback(account: string): StoredTokens | null {
    try {
      const filePath = this._fallbackPath(account);
      if (!fs.existsSync(filePath)) return null;
      const encrypted = fs.readFileSync(filePath) as unknown as Buffer;
      const decrypted = safeStorage.decryptString(encrypted);
      return JSON.parse(decrypted) as StoredTokens;
    } catch (err) {
      mainLogger.warn('KeychainStore._readFallback.failed', {
        account,
        error: (err as Error).message,
      });
      return null;
    }
  }

  private _deleteFallback(account: string): void {
    try {
      const filePath = this._fallbackPath(account);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync?.(filePath);
      }
    } catch (err) {
      mainLogger.warn('KeychainStore._deleteFallback.failed', {
        account,
        error: (err as Error).message,
      });
    }
  }
}
