/**
 * API key sourcing for the agent daemon.
 *
 * Priority:
 *   1. Keychain: service=com.agenticbrowser.anthropic, account=<email>
 *   2. Environment: ANTHROPIC_API_KEY
 *   3. null (caller handles missing key)
 *
 * Security invariant: the API key value is NEVER logged (D2 scrub rule).
 * Only metadata is logged: source ('keytar' | 'env' | 'none'), key length.
 *
 * Track 1 owns this file.
 */

import { mainLogger } from './logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const API_KEY_KEYCHAIN_SERVICE = 'com.agenticbrowser.anthropic';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export interface GetApiKeyOptions {
  /** Injected keytar module (for tests or when keytar is available) */
  keytarModule?: KeytarLike;
  /** Account email to look up in Keychain */
  accountEmail?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieve the Anthropic API key.
 *
 * 1. Try Keychain (keytar) with service=com.agenticbrowser.anthropic
 * 2. Fall back to process.env.ANTHROPIC_API_KEY
 * 3. Return null if neither source has a key
 *
 * The key value is NEVER logged. Only metadata (source, length) is logged.
 */
export async function getApiKey(opts: GetApiKeyOptions = {}): Promise<string | null> {
  const { keytarModule, accountEmail } = opts;

  // Source 1: Keychain via keytar
  if (keytarModule && accountEmail) {
    try {
      const key = await keytarModule.getPassword(API_KEY_KEYCHAIN_SERVICE, accountEmail);
      if (key) {
        mainLogger.info('agentApiKey.getApiKey', {
          source: 'keytar',
          keyLength: key.length,
          account: accountEmail,
        });
        return key;
      }
      mainLogger.debug('agentApiKey.getApiKey', {
        source: 'keytar',
        result: 'not_found',
        account: accountEmail,
      });
    } catch (err) {
      mainLogger.warn('agentApiKey.getApiKey.keytarError', {
        error: (err as Error).message,
        account: accountEmail,
      });
    }
  }

  // Source 2: Environment variable
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    mainLogger.info('agentApiKey.getApiKey', {
      source: 'env',
      keyLength: envKey.length,
    });
    return envKey;
  }

  // Source 3: No key available
  mainLogger.warn('agentApiKey.getApiKey', {
    source: 'none',
    msg: 'No API key found in Keychain or environment',
  });
  return null;
}
