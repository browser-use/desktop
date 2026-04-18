/**
 * History profile-isolation tests — Issue #208.
 *
 * Verifies that HistoryStore scopes persistence to the caller-supplied
 * dataDir so switching profiles actually isolates browsing history.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { HistoryStore } from '../../../src/main/history/HistoryStore';

let rootDir: string;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-profile-iso-'));
});

afterEach(() => {
  try {
    fs.rmSync(rootDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe('HistoryStore — profile isolation', () => {
  it('writes history.json under the caller-supplied dataDir', () => {
    const profileDir = path.join(rootDir, 'profiles', 'profile-a');
    fs.mkdirSync(profileDir, { recursive: true });

    const store = new HistoryStore(profileDir);
    store.addVisit('https://example.com', 'Example');
    store.flushSync();

    const expectedPath = path.join(profileDir, 'history.json');
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(store.getFilePath()).toBe(expectedPath);
  });

  it('a visit recorded in profile A is NOT visible from profile B', () => {
    const profileA = path.join(rootDir, 'profiles', 'profile-a');
    const profileB = path.join(rootDir, 'profiles', 'profile-b');
    fs.mkdirSync(profileA, { recursive: true });
    fs.mkdirSync(profileB, { recursive: true });

    const storeA = new HistoryStore(profileA);
    storeA.addVisit('https://only-in-a.example.com', 'A-page');
    storeA.flushSync();

    const storeB = new HistoryStore(profileB);
    expect(storeB.getAll()).toHaveLength(0);
    expect(storeB.query({ query: 'a-page' }).totalCount).toBe(0);
  });

  it('two profiles accumulate separate histories across dispose+reload', () => {
    const profileA = path.join(rootDir, 'profiles', 'profile-a');
    const profileB = path.join(rootDir, 'profiles', 'profile-b');
    fs.mkdirSync(profileA, { recursive: true });
    fs.mkdirSync(profileB, { recursive: true });

    const a1 = new HistoryStore(profileA);
    a1.addVisit('https://a1.example.com', 'A1');
    a1.addVisit('https://a2.example.com', 'A2');
    a1.dispose();

    const b1 = new HistoryStore(profileB);
    b1.addVisit('https://b1.example.com', 'B1');
    b1.dispose();

    const a2 = new HistoryStore(profileA);
    const b2 = new HistoryStore(profileB);

    expect(a2.getAll().map((e) => e.url)).toEqual([
      'https://a2.example.com',
      'https://a1.example.com',
    ]);
    expect(b2.getAll().map((e) => e.url)).toEqual([
      'https://b1.example.com',
    ]);
  });

  it('defaults to app.getPath("userData") when no dataDir is provided (back-compat)', () => {
    const store = new HistoryStore();
    expect(store.getFilePath()).toMatch(/history\.json$/);
  });

  it('dispose flushes pending writes before detaching the store', () => {
    const profileA = path.join(rootDir, 'profiles', 'profile-a');
    fs.mkdirSync(profileA, { recursive: true });

    const store = new HistoryStore(profileA);
    store.addVisit('https://pending.example.com', 'Pending');
    // No explicit flushSync call — dispose must handle the pending write.
    store.dispose();

    const reader = new HistoryStore(profileA);
    expect(reader.getAll()).toHaveLength(1);
    expect(reader.getAll()[0].url).toBe('https://pending.example.com');
  });
});
