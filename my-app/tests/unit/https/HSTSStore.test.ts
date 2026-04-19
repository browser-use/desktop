/**
 * HSTSStore unit tests.
 *
 * Tests cover:
 *   - processHSTSHeader: ignores HTTP, parses max-age & includeSubDomains, max-age=0 deletes
 *   - isHSTSHost: direct match, subdomain match via includeSubDomains, expired entries
 *   - getHSTSEntry: returns entry or null for unknown/expired hosts
 *   - clearHSTSEntries: removes all entries
 *   - Expiry: entries past max-age are considered expired
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../src/main/logger', () => ({
  mainLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  processHSTSHeader,
  isHSTSHost,
  getHSTSEntry,
  clearHSTSEntries,
} from '../../../src/main/https/HSTSStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearHSTSEntries();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// processHSTSHeader
// ---------------------------------------------------------------------------

describe('processHSTSHeader', () => {
  it('ignores HTTP URLs (RFC 6797 §8.1)', () => {
    processHSTSHeader('http://example.com', 'max-age=31536000');
    expect(isHSTSHost('http://example.com')).toBe(false);
  });

  it('records an entry for an HTTPS URL', () => {
    processHSTSHeader('https://example.com', 'max-age=31536000');
    expect(isHSTSHost('https://example.com')).toBe(true);
  });

  it('parses max-age correctly', () => {
    processHSTSHeader('https://example.com', 'max-age=7200');
    const entry = getHSTSEntry('https://example.com');
    expect(entry?.maxAge).toBe(7200);
  });

  it('sets includeSubdomains=false when directive is absent', () => {
    processHSTSHeader('https://example.com', 'max-age=31536000');
    const entry = getHSTSEntry('https://example.com');
    expect(entry?.includeSubdomains).toBe(false);
  });

  it('sets includeSubdomains=true when directive is present', () => {
    processHSTSHeader('https://example.com', 'max-age=31536000; includeSubDomains');
    const entry = getHSTSEntry('https://example.com');
    expect(entry?.includeSubdomains).toBe(true);
  });

  it('is case-insensitive for includeSubDomains', () => {
    processHSTSHeader('https://example.com', 'max-age=100; INCLUDESUBDOMAINS');
    const entry = getHSTSEntry('https://example.com');
    expect(entry?.includeSubdomains).toBe(true);
  });

  it('max-age=0 deletes an existing entry', () => {
    processHSTSHeader('https://example.com', 'max-age=31536000');
    expect(isHSTSHost('https://example.com')).toBe(true);
    processHSTSHeader('https://example.com', 'max-age=0');
    expect(isHSTSHost('https://example.com')).toBe(false);
  });

  it('max-age=0 on unknown host is a no-op', () => {
    // Should not throw
    expect(() => processHSTSHeader('https://unknown.com', 'max-age=0')).not.toThrow();
    expect(isHSTSHost('https://unknown.com')).toBe(false);
  });

  it('ignores headers without max-age', () => {
    processHSTSHeader('https://example.com', 'includeSubDomains; preload');
    expect(isHSTSHost('https://example.com')).toBe(false);
  });

  it('normalises host to lowercase', () => {
    processHSTSHeader('https://EXAMPLE.COM', 'max-age=100');
    expect(isHSTSHost('https://example.com')).toBe(true);
  });

  it('ignores invalid URLs', () => {
    expect(() => processHSTSHeader('not a url', 'max-age=100')).not.toThrow();
    expect(isHSTSHost('not a url')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isHSTSHost
// ---------------------------------------------------------------------------

describe('isHSTSHost', () => {
  it('returns false for an unknown host', () => {
    expect(isHSTSHost('https://unknown.example.com')).toBe(false);
  });

  it('returns true for a known host', () => {
    processHSTSHeader('https://example.com', 'max-age=100');
    expect(isHSTSHost('https://example.com')).toBe(true);
  });

  it('returns true for HTTP scheme against a known HSTS host', () => {
    processHSTSHeader('https://example.com', 'max-age=100');
    expect(isHSTSHost('http://example.com')).toBe(true);
  });

  it('returns false for non-http/https schemes', () => {
    processHSTSHeader('https://example.com', 'max-age=100');
    expect(isHSTSHost('ftp://example.com')).toBe(false);
  });

  it('matches subdomain when includeSubdomains is set', () => {
    processHSTSHeader('https://example.com', 'max-age=100; includeSubDomains');
    expect(isHSTSHost('https://sub.example.com')).toBe(true);
    expect(isHSTSHost('https://deep.sub.example.com')).toBe(true);
  });

  it('does NOT match subdomain when includeSubdomains is absent', () => {
    processHSTSHeader('https://example.com', 'max-age=100');
    expect(isHSTSHost('https://sub.example.com')).toBe(false);
  });

  it('returns false for an invalid URL', () => {
    expect(isHSTSHost('not a url')).toBe(false);
  });

  it('considers an expired entry as not HSTS', () => {
    processHSTSHeader('https://example.com', 'max-age=10'); // 10 seconds
    vi.advanceTimersByTime(11_000);
    expect(isHSTSHost('https://example.com')).toBe(false);
  });

  it('still matches before expiry', () => {
    processHSTSHeader('https://example.com', 'max-age=100');
    vi.advanceTimersByTime(50_000); // 50s — still within 100s window
    expect(isHSTSHost('https://example.com')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getHSTSEntry
// ---------------------------------------------------------------------------

describe('getHSTSEntry', () => {
  it('returns null for an unknown host', () => {
    expect(getHSTSEntry('https://unknown.com')).toBeNull();
  });

  it('returns the entry for a known host', () => {
    processHSTSHeader('https://example.com', 'max-age=3600; includeSubDomains');
    const entry = getHSTSEntry('https://example.com');
    expect(entry).not.toBeNull();
    expect(entry?.host).toBe('example.com');
    expect(entry?.maxAge).toBe(3600);
    expect(entry?.includeSubdomains).toBe(true);
    expect(typeof entry?.capturedAt).toBe('number');
  });

  it('returns null for an expired entry', () => {
    processHSTSHeader('https://example.com', 'max-age=5');
    vi.advanceTimersByTime(6_000);
    expect(getHSTSEntry('https://example.com')).toBeNull();
  });

  it('returns null for an invalid URL', () => {
    expect(getHSTSEntry('not a url')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// clearHSTSEntries
// ---------------------------------------------------------------------------

describe('clearHSTSEntries', () => {
  it('removes all stored entries', () => {
    processHSTSHeader('https://a.com', 'max-age=100');
    processHSTSHeader('https://b.com', 'max-age=100');
    expect(isHSTSHost('https://a.com')).toBe(true);
    expect(isHSTSHost('https://b.com')).toBe(true);
    clearHSTSEntries();
    expect(isHSTSHost('https://a.com')).toBe(false);
    expect(isHSTSHost('https://b.com')).toBe(false);
  });

  it('is idempotent on an empty store', () => {
    expect(() => clearHSTSEntries()).not.toThrow();
  });
});
