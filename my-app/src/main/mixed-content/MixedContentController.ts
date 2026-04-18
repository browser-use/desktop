/**
 * MixedContentController — mixed content detection and per-site exception storage.
 *
 * Mixed content definitions (aligned with Chrome/spec):
 *   Active mixed content  — script, iframe, XHR, object, embed loaded over HTTP
 *                           while the page is HTTPS. Chromium blocks these by default.
 *   Passive mixed content — images, audio, video loaded over HTTP on an HTTPS page.
 *                           Chromium allows these but downgrades the security indicator.
 *
 * What this controller does:
 *   1. Parses Chromium console-messages that start with the known mixed-content prefix
 *      and classifies them as active vs passive.
 *   2. Persists per-site exceptions (origin → 'allow') in preferences.json so the user
 *      can grant explicit exceptions from the Site Settings panel.
 *   3. Exposes helpers for the preload/IPC layers to read/write those exceptions.
 *
 * Console message format injected by Chromium:
 *   "Mixed Content: The page at 'https://example.com' was loaded over HTTPS, but
 *    requested an insecure <type> '<url>'. ..."
 *
 * Detection relies on the well-known Chromium log lines. See:
 *   https://developer.chrome.com/docs/web-platform/mixed-content
 */

import { mainLogger } from '../logger';
import { readPrefs, mergePrefs } from '../settings/ipc';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIXED_CONTENT_LOG_PREFIX = 'Mixed Content:';

// Passive resource types mentioned in the Chromium mixed-content log lines.
// Everything else (script, stylesheet, iframe, XHR, fetch, object, embed)
// is treated as active.
const PASSIVE_RESOURCE_TYPES = new Set([
  'image',
  'video',
  'audio',
  'img',
  'source',
]);

// Regexp to extract the resource type from a Chromium mixed-content log line.
// Example: "...but requested an insecure image 'http://...'"
// Example: "...but requested an insecure script 'http://...'"
const RESOURCE_TYPE_RE = /but requested an insecure (\w+)\b/i;

// Prefs key for per-site exceptions: Record<origin, 'allow'>
const PREFS_KEY = 'mixedContentExceptions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MixedContentLevel = 'none' | 'passive' | 'active';

export interface MixedContentStatus {
  level: MixedContentLevel;
  /** True if the user has explicitly allowed mixed content for this origin. */
  hasException: boolean;
}

// ---------------------------------------------------------------------------
// Per-site exception storage (backed by preferences.json)
// ---------------------------------------------------------------------------

function loadExceptions(): Record<string, 'allow'> {
  try {
    const prefs = readPrefs();
    const raw = prefs[PREFS_KEY];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, 'allow'>;
    }
  } catch {
    // fall through
  }
  return {};
}

function saveExceptions(exceptions: Record<string, 'allow'>): void {
  mergePrefs({ [PREFS_KEY]: exceptions });
}

/**
 * Grant a per-site exception: allow mixed content for the given origin.
 */
export function allowMixedContentForOrigin(origin: string): void {
  mainLogger.info('MixedContentController.allowForOrigin', { origin });
  const exceptions = loadExceptions();
  exceptions[origin] = 'allow';
  saveExceptions(exceptions);
}

/**
 * Revoke a per-site exception for the given origin.
 */
export function revokeMixedContentException(origin: string): boolean {
  const exceptions = loadExceptions();
  if (!(origin in exceptions)) return false;
  delete exceptions[origin];
  saveExceptions(exceptions);
  mainLogger.info('MixedContentController.revokeException', { origin });
  return true;
}

/**
 * Returns true if the user has granted an explicit mixed-content exception
 * for the given origin.
 */
export function hasMixedContentException(origin: string): boolean {
  const exceptions = loadExceptions();
  return exceptions[origin] === 'allow';
}

/**
 * Returns all origins that have mixed-content exceptions.
 */
export function getAllMixedContentExceptions(): string[] {
  return Object.keys(loadExceptions());
}

// ---------------------------------------------------------------------------
// Console message analysis
// ---------------------------------------------------------------------------

/**
 * Inspect a console-message string from a WebContents and determine whether
 * it is a Chromium mixed-content warning. Returns the level if it is one,
 * or 'none' if it is unrelated to mixed content.
 */
export function classifyMixedContentMessage(message: string): MixedContentLevel {
  if (!message.startsWith(MIXED_CONTENT_LOG_PREFIX)) return 'none';

  const match = RESOURCE_TYPE_RE.exec(message);
  if (!match) {
    // Unknown format — treat conservatively as active.
    mainLogger.debug('MixedContentController.classify.unknownFormat', {
      preview: message.slice(0, 120),
    });
    return 'active';
  }

  const resourceType = match[1].toLowerCase();
  const level: MixedContentLevel = PASSIVE_RESOURCE_TYPES.has(resourceType)
    ? 'passive'
    : 'active';

  mainLogger.info('MixedContentController.classify', { resourceType, level });
  return level;
}
