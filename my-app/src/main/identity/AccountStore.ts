/**
 * AccountStore — persists onboarding completion state to userData/account.json.
 *
 * Write is atomic: data is written to a .tmp file then renamed, so a crash
 * mid-write never produces a corrupt account.json.
 *
 * File location: ${app.getPath('userData')}/account.json
 * Shape: { created_at?, onboarding_completed_at? }
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mainLogger } from '../logger';

const ACCOUNT_FILE_NAME = 'account.json';

export interface AccountData {
  /** ISO 8601 — set once on first save, never overwritten */
  created_at?: string;
  /** ISO 8601 — set when the user completes onboarding */
  onboarding_completed_at?: string;
  /** The onboarding step the user was last on. Lets a closed-mid-flow
   *  onboarding window reopen to where the user left off, instead of
   *  starting from intro. Cleared once onboarding completes. */
  last_onboarding_step?: string;
  /** Per-Chrome-profile sync history, keyed by profile directory (e.g. "Default",
   *  "Profile 1"). Lets the cookies UI show "Synced 5m ago" instead of treating
   *  every reopen as a first-time view. */
  chrome_profile_syncs?: Record<string, ChromeProfileSyncRecord>;
}

export interface ChromeProfileSyncRecord {
  /** ISO 8601 timestamp of the most recent successful sync */
  last_synced_at: string;
  imported: number;
  total: number;
  domain_count: number;
  /** Cookies whose (name, domain, path) didn't exist in the Electron jar pre-sync. */
  new_cookies?: number;
  /** Cookies whose key existed but value changed. */
  updated_cookies?: number;
  /** Cookies whose key+value matched what was already there. */
  unchanged_cookies?: number;
  /** Domains that had zero cookies pre-sync. */
  new_domain_count?: number;
  /** Domains that already had at least one cookie pre-sync. */
  updated_domain_count?: number;
}

export class AccountStore {
  private readonly filePath: string;
  private readonly tmpPath: string;

  constructor(userDataPath?: string) {
    const dir = userDataPath ?? (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { app } = require('electron') as typeof import('electron');
        return app.getPath('userData');
      } catch {
        return path.join(os.tmpdir(), 'agentic-browser');
      }
    })();

    this.filePath = path.join(dir, ACCOUNT_FILE_NAME);
    this.tmpPath = path.join(dir, `account.tmp.${process.pid}`);

    mainLogger.debug('AccountStore.init', { filePath: this.filePath });
  }

  load(): AccountData | null {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as AccountData;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        mainLogger.warn('AccountStore.load.parseError', {
          filePath: this.filePath,
          error: (err as Error).message,
        });
      }
      return null;
    }
  }

  save(data: AccountData): void {
    let created_at = data.created_at;
    if (!created_at) {
      const existing = this.load();
      created_at = existing?.created_at ?? new Date().toISOString();
    }

    const toWrite: AccountData = { ...data, created_at };
    const serialised = JSON.stringify(toWrite, null, 2);

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.tmpPath, serialised, 'utf-8');
      fs.renameSync(this.tmpPath, this.filePath);
      mainLogger.debug('AccountStore.save.ok', { filePath: this.filePath });
    } catch (err) {
      mainLogger.error('AccountStore.save.failed', {
        error: (err as Error).message,
        filePath: this.filePath,
      });
      throw err;
    }
  }

  isOnboardingComplete(): boolean {
    return !!this.load()?.onboarding_completed_at;
  }

  getLastOnboardingStep(): string | null {
    return this.load()?.last_onboarding_step ?? null;
  }

  setLastOnboardingStep(step: string): void {
    const existing = this.load() ?? {};
    this.save({ ...existing, last_onboarding_step: step });
  }

  getChromeProfileSyncs(): Record<string, ChromeProfileSyncRecord> {
    return this.load()?.chrome_profile_syncs ?? {};
  }

  recordChromeProfileSync(profileDir: string, summary: Omit<ChromeProfileSyncRecord, 'last_synced_at'>): void {
    const existing = this.load() ?? {};
    const syncs = { ...(existing.chrome_profile_syncs ?? {}) };
    syncs[profileDir] = { ...summary, last_synced_at: new Date().toISOString() };
    this.save({ ...existing, chrome_profile_syncs: syncs });
  }
}
