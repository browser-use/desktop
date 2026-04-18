/**
 * Password profile-isolation tests — Issue #208.
 *
 * Verifies that PasswordStore scopes persistence to the caller-supplied
 * dataDir so saved credentials in profile A are invisible from profile B.
 *
 * Uses the top-level electron mock's safeStorage stub for deterministic
 * encrypt/decrypt round-trip — we only care about persistence isolation here,
 * not the encryption semantics (see PasswordStore.spec.ts for those).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PasswordStore } from '../../../src/main/passwords/PasswordStore';

let rootDir: string;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'password-profile-iso-'));
});

afterEach(() => {
  try {
    fs.rmSync(rootDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe('PasswordStore — profile isolation', () => {
  it('writes passwords.json under the caller-supplied dataDir', () => {
    const profileDir = path.join(rootDir, 'profiles', 'profile-a');
    fs.mkdirSync(profileDir, { recursive: true });

    const store = new PasswordStore(profileDir);
    store.saveCredential('https://example.com', 'alice', 'hunter2');
    store.flushSync();

    const expectedPath = path.join(profileDir, 'passwords.json');
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(store.getFilePath()).toBe(expectedPath);
  });

  it('a credential saved in profile A is NOT visible from profile B', () => {
    const profileA = path.join(rootDir, 'profiles', 'profile-a');
    const profileB = path.join(rootDir, 'profiles', 'profile-b');
    fs.mkdirSync(profileA, { recursive: true });
    fs.mkdirSync(profileB, { recursive: true });

    const storeA = new PasswordStore(profileA);
    storeA.saveCredential('https://bank.example.com', 'alice', 'super-secret');
    storeA.flushSync();

    const storeB = new PasswordStore(profileB);
    expect(storeB.listCredentials()).toHaveLength(0);
    expect(storeB.findCredentialsForOrigin('https://bank.example.com')).toHaveLength(0);
  });

  it('never-save origins are scoped per-profile', () => {
    const profileA = path.join(rootDir, 'profiles', 'profile-a');
    const profileB = path.join(rootDir, 'profiles', 'profile-b');
    fs.mkdirSync(profileA, { recursive: true });
    fs.mkdirSync(profileB, { recursive: true });

    const storeA = new PasswordStore(profileA);
    storeA.addNeverSave('https://no-save.example.com');
    storeA.flushSync();

    const storeB = new PasswordStore(profileB);
    expect(storeB.isNeverSave('https://no-save.example.com')).toBe(false);
    expect(storeB.listNeverSave()).toHaveLength(0);
  });

  it('round-trips credentials per profile across dispose+reload', () => {
    const profileA = path.join(rootDir, 'profiles', 'profile-a');
    const profileB = path.join(rootDir, 'profiles', 'profile-b');
    fs.mkdirSync(profileA, { recursive: true });
    fs.mkdirSync(profileB, { recursive: true });

    const a1 = new PasswordStore(profileA);
    const credA = a1.saveCredential('https://a.example.com', 'alice', 'pwA');
    a1.dispose();

    const b1 = new PasswordStore(profileB);
    const credB = b1.saveCredential('https://b.example.com', 'bob', 'pwB');
    b1.dispose();

    const a2 = new PasswordStore(profileA);
    const b2 = new PasswordStore(profileB);

    // Each profile reads back only its own credential — no cross-contamination.
    expect(a2.listCredentials()).toHaveLength(1);
    expect(b2.listCredentials()).toHaveLength(1);
    expect(a2.revealPassword(credA.id)).toBe('pwA');
    expect(a2.revealPassword(credB.id)).toBe(null);
    expect(b2.revealPassword(credB.id)).toBe('pwB');
    expect(b2.revealPassword(credA.id)).toBe(null);
  });

  it('defaults to app.getPath("userData") when no dataDir is provided (back-compat)', () => {
    const store = new PasswordStore();
    expect(store.getFilePath()).toMatch(/passwords\.json$/);
  });
});
