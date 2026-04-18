/**
 * Autofill profile-isolation tests — Issue #208.
 *
 * Verifies that AutofillStore scopes persistence to the caller-supplied
 * dataDir so saved addresses and cards stay within one profile.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AutofillStore } from '../../../src/main/autofill/AutofillStore';

let rootDir: string;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autofill-profile-iso-'));
});

afterEach(() => {
  try {
    fs.rmSync(rootDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function sampleAddress(fullName: string): Parameters<AutofillStore['saveAddress']>[0] {
  return {
    fullName,
    company: '',
    addressLine1: '1 Market St',
    addressLine2: '',
    city: 'SF',
    state: 'CA',
    postalCode: '94105',
    country: 'US',
    phone: '',
    email: '',
  };
}

describe('AutofillStore — profile isolation', () => {
  it('writes autofill.json under the caller-supplied dataDir', () => {
    const profileDir = path.join(rootDir, 'profiles', 'profile-a');
    fs.mkdirSync(profileDir, { recursive: true });

    const store = new AutofillStore(profileDir);
    store.saveAddress(sampleAddress('Alice'));
    store.flushSync();

    const expectedPath = path.join(profileDir, 'autofill.json');
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(store.getFilePath()).toBe(expectedPath);
  });

  it('an address saved in profile A is NOT visible from profile B', () => {
    const profileA = path.join(rootDir, 'profiles', 'profile-a');
    const profileB = path.join(rootDir, 'profiles', 'profile-b');
    fs.mkdirSync(profileA, { recursive: true });
    fs.mkdirSync(profileB, { recursive: true });

    const storeA = new AutofillStore(profileA);
    storeA.saveAddress(sampleAddress('Alice-In-A'));
    storeA.flushSync();

    const storeB = new AutofillStore(profileB);
    expect(storeB.listAddresses()).toHaveLength(0);
  });

  it('a card saved in profile A is NOT visible from profile B', () => {
    const profileA = path.join(rootDir, 'profiles', 'profile-a');
    const profileB = path.join(rootDir, 'profiles', 'profile-b');
    fs.mkdirSync(profileA, { recursive: true });
    fs.mkdirSync(profileB, { recursive: true });

    const storeA = new AutofillStore(profileA);
    storeA.saveCard({
      nameOnCard: 'Alice Example',
      cardNumber: '4111111111111111',
      expiryMonth: '12',
      expiryYear: '2030',
      nickname: 'Work Visa',
    });
    storeA.flushSync();

    const storeB = new AutofillStore(profileB);
    expect(storeB.listCards()).toHaveLength(0);
  });

  it('isolates addresses + cards across dispose+reload', () => {
    const profileA = path.join(rootDir, 'profiles', 'profile-a');
    const profileB = path.join(rootDir, 'profiles', 'profile-b');
    fs.mkdirSync(profileA, { recursive: true });
    fs.mkdirSync(profileB, { recursive: true });

    const a1 = new AutofillStore(profileA);
    a1.saveAddress(sampleAddress('Alice-A'));
    a1.saveCard({
      nameOnCard: 'Alice A',
      cardNumber: '4111111111111111',
      expiryMonth: '01',
      expiryYear: '2028',
      nickname: '',
    });
    a1.dispose();

    const b1 = new AutofillStore(profileB);
    b1.saveAddress(sampleAddress('Bob-B'));
    b1.dispose();

    const a2 = new AutofillStore(profileA);
    const b2 = new AutofillStore(profileB);

    expect(a2.listAddresses().map((x) => x.fullName)).toEqual(['Alice-A']);
    expect(b2.listAddresses().map((x) => x.fullName)).toEqual(['Bob-B']);
    expect(a2.listCards()).toHaveLength(1);
    expect(b2.listCards()).toHaveLength(0);
  });

  it('defaults to app.getPath("userData") when no dataDir is provided (back-compat)', () => {
    const store = new AutofillStore();
    expect(store.getFilePath()).toMatch(/autofill\.json$/);
  });
});
