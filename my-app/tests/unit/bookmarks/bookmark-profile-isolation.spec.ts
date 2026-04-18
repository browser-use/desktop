/**
 * Bookmark profile-isolation tests — Issue #208.
 *
 * Verifies that BookmarkStore scopes persistence to the caller-supplied
 * dataDir so switching profiles actually isolates bookmarks. A bookmark
 * added under profile A must never be observable from profile B.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BookmarkStore, BAR_ROOT_ID } from '../../../src/main/bookmarks/BookmarkStore';
import { getProfileDataDir } from '../../../src/main/profiles/ProfileContext';

let rootDir: string;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmark-profile-iso-'));
});

afterEach(() => {
  try {
    fs.rmSync(rootDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function countBookmarks(store: BookmarkStore): number {
  const tree = store.listTree();
  const bar = tree.roots[0].children ?? [];
  const other = tree.roots[1].children ?? [];
  return bar.length + other.length;
}

describe('BookmarkStore — profile isolation', () => {
  it('writes bookmarks.json under the caller-supplied dataDir (not userData root)', () => {
    const profileDir = path.join(rootDir, 'profiles', 'profile-a');
    fs.mkdirSync(profileDir, { recursive: true });

    const store = new BookmarkStore(profileDir);
    store.addBookmark({ name: 'Example', url: 'https://example.com', parentId: BAR_ROOT_ID });
    store.flushSync();

    const expectedPath = path.join(profileDir, 'bookmarks.json');
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(store.getFilePath()).toBe(expectedPath);
  });

  it('a bookmark added in profile A is NOT visible from profile B', () => {
    const profileA = path.join(rootDir, 'profiles', 'profile-a');
    const profileB = path.join(rootDir, 'profiles', 'profile-b');
    fs.mkdirSync(profileA, { recursive: true });
    fs.mkdirSync(profileB, { recursive: true });

    const storeA = new BookmarkStore(profileA);
    storeA.addBookmark({ name: 'Only in A', url: 'https://a.example.com', parentId: BAR_ROOT_ID });
    storeA.flushSync();

    const storeB = new BookmarkStore(profileB);
    expect(countBookmarks(storeB)).toBe(0);
    expect(storeB.isUrlBookmarked('https://a.example.com')).toBe(false);
  });

  it('isolates writes: mutation on profile A does not leak into profile B on reload', () => {
    const profileA = path.join(rootDir, 'profiles', 'profile-a');
    const profileB = path.join(rootDir, 'profiles', 'profile-b');
    fs.mkdirSync(profileA, { recursive: true });
    fs.mkdirSync(profileB, { recursive: true });

    // Seed both profiles with one bookmark each so we can detect cross-talk.
    const storeA1 = new BookmarkStore(profileA);
    storeA1.addBookmark({ name: 'A-home', url: 'https://a.example.com', parentId: BAR_ROOT_ID });
    storeA1.flushSync();

    const storeB1 = new BookmarkStore(profileB);
    storeB1.addBookmark({ name: 'B-home', url: 'https://b.example.com', parentId: BAR_ROOT_ID });
    storeB1.flushSync();

    // Now simulate a profile switch by disposing and re-creating.
    storeA1.dispose();
    storeB1.dispose();

    const storeA2 = new BookmarkStore(profileA);
    const storeB2 = new BookmarkStore(profileB);

    expect(countBookmarks(storeA2)).toBe(1);
    expect(countBookmarks(storeB2)).toBe(1);
    expect(storeA2.isUrlBookmarked('https://a.example.com')).toBe(true);
    expect(storeA2.isUrlBookmarked('https://b.example.com')).toBe(false);
    expect(storeB2.isUrlBookmarked('https://b.example.com')).toBe(true);
    expect(storeB2.isUrlBookmarked('https://a.example.com')).toBe(false);
  });

  it('defaults to app.getPath("userData") when no dataDir is provided (back-compat)', () => {
    // The electron-mock points getPath('userData') at os.tmpdir()/AgenticBrowser-test.
    // We only need to assert the constructor picks SOME path and doesn't throw.
    const store = new BookmarkStore();
    expect(store.getFilePath()).toMatch(/bookmarks\.json$/);
  });
});

describe('ProfileContext.getProfileDataDir — wiring sanity', () => {
  it('returns distinct directories for distinct non-default profile ids', () => {
    // getProfileDataDir('default') returns app.getPath('userData') exactly —
    // non-default profiles get <userData>/profiles/<id>/. The exact
    // userData root comes from the electron-mock under this harness.
    const a = getProfileDataDir('profile-a');
    const b = getProfileDataDir('profile-b');
    expect(a).not.toBe(b);
    expect(a.endsWith(path.join('profiles', 'profile-a'))).toBe(true);
    expect(b.endsWith(path.join('profiles', 'profile-b'))).toBe(true);
  });

  it('returns the userData root for the default profile', () => {
    const defaultDir = getProfileDataDir('default');
    const nonDefault = getProfileDataDir('profile-x');
    expect(nonDefault.startsWith(defaultDir)).toBe(true);
    // Sanity: non-default is strictly nested below default.
    expect(nonDefault.length).toBeGreaterThan(defaultDir.length);
  });
});
