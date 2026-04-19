/**
 * SafeBrowsingController unit tests.
 *
 * Tests cover:
 *   - isValidLevel: valid levels, invalid values
 *   - getSafeBrowsingLevel: default when no prefs, reads from prefs, invalid prefs fallback
 *   - bypassOrigin / isBypassed / clearBypasses
 *   - buildSafeBrowsingInterstitial: HTML structure, all 3 threat types, entity escaping,
 *     SAFE_BROWSING_PROCEED_PREFIX, SAFE_BROWSING_BACK_PREFIX
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { loggerSpy } = vi.hoisted(() => ({
  loggerSpy: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/main/logger', () => ({ mainLogger: loggerSpy }));

const { mockReadPrefs } = vi.hoisted(() => ({ mockReadPrefs: vi.fn(() => ({})) }));

vi.mock('../../../src/main/settings/ipc', () => ({ readPrefs: mockReadPrefs }));

import {
  isValidLevel,
  getSafeBrowsingLevel,
  bypassOrigin,
  isBypassed,
  clearBypasses,
  buildSafeBrowsingInterstitial,
  SAFE_BROWSING_PROCEED_PREFIX,
  SAFE_BROWSING_BACK_PREFIX,
  type SafeBrowsingLevel,
} from '../../../src/main/safebrowsing/SafeBrowsingController';

// ---------------------------------------------------------------------------
// Reset state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearBypasses();
  mockReadPrefs.mockReturnValue({});
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// isValidLevel
// ---------------------------------------------------------------------------

describe('isValidLevel()', () => {
  it.each(['enhanced', 'standard', 'disabled'] as SafeBrowsingLevel[])(
    'returns true for valid level "%s"',
    (level) => {
      expect(isValidLevel(level)).toBe(true);
    },
  );

  it.each(['ENHANCED', 'Standard', 'off', '', 'unknown', 42])(
    'returns false for invalid value "%s"',
    (value) => {
      expect(isValidLevel(value as string)).toBe(false);
    },
  );
});

// ---------------------------------------------------------------------------
// getSafeBrowsingLevel
// ---------------------------------------------------------------------------

describe('getSafeBrowsingLevel()', () => {
  it('returns "standard" by default when no prefs', () => {
    mockReadPrefs.mockReturnValue({});
    expect(getSafeBrowsingLevel()).toBe('standard');
  });

  it('returns "enhanced" when set in prefs', () => {
    mockReadPrefs.mockReturnValue({ safeBrowsing: 'enhanced' });
    expect(getSafeBrowsingLevel()).toBe('enhanced');
  });

  it('returns "disabled" when set in prefs', () => {
    mockReadPrefs.mockReturnValue({ safeBrowsing: 'disabled' });
    expect(getSafeBrowsingLevel()).toBe('disabled');
  });

  it('falls back to "standard" when prefs has invalid value', () => {
    mockReadPrefs.mockReturnValue({ safeBrowsing: 'unknown-level' });
    expect(getSafeBrowsingLevel()).toBe('standard');
  });

  it('falls back to "standard" when prefs value is not a string', () => {
    mockReadPrefs.mockReturnValue({ safeBrowsing: 42 });
    expect(getSafeBrowsingLevel()).toBe('standard');
  });
});

// ---------------------------------------------------------------------------
// Bypass state
// ---------------------------------------------------------------------------

describe('bypass state', () => {
  it('isBypassed returns false initially', () => {
    expect(isBypassed('https://example.com')).toBe(false);
  });

  it('bypassOrigin marks origin as bypassed', () => {
    bypassOrigin('https://example.com');
    expect(isBypassed('https://example.com')).toBe(true);
  });

  it('bypassOrigin is idempotent', () => {
    bypassOrigin('https://example.com');
    bypassOrigin('https://example.com');
    expect(isBypassed('https://example.com')).toBe(true);
  });

  it('clearBypasses removes all bypassed origins', () => {
    bypassOrigin('https://a.com');
    bypassOrigin('https://b.com');
    clearBypasses();
    expect(isBypassed('https://a.com')).toBe(false);
    expect(isBypassed('https://b.com')).toBe(false);
  });

  it('bypass is origin-specific', () => {
    bypassOrigin('https://a.com');
    expect(isBypassed('https://b.com')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildSafeBrowsingInterstitial
// ---------------------------------------------------------------------------

describe('buildSafeBrowsingInterstitial()', () => {
  it('contains DOCTYPE and html structure', () => {
    const html = buildSafeBrowsingInterstitial('SOCIAL_ENGINEERING', 'https://bad.com', 'bad.com');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html>');
  });

  it('includes the hostname in the page', () => {
    const html = buildSafeBrowsingInterstitial('SOCIAL_ENGINEERING', 'https://phish.com', 'phish.com');
    expect(html).toContain('phish.com');
  });

  it('includes the URL in the details panel', () => {
    const html = buildSafeBrowsingInterstitial('SOCIAL_ENGINEERING', 'https://phish.com/page', 'phish.com');
    expect(html).toContain('https://phish.com/page');
  });

  it('contains Back to safety button', () => {
    const html = buildSafeBrowsingInterstitial('MALWARE', 'https://bad.com', 'bad.com');
    expect(html).toContain('Back to safety');
  });

  it('includes bypass "visit this unsafe site" link', () => {
    const html = buildSafeBrowsingInterstitial('MALWARE', 'https://bad.com', 'bad.com');
    expect(html).toContain('visit this unsafe site');
  });

  it('includes SAFE_BROWSING_PROCEED_PREFIX in script', () => {
    const html = buildSafeBrowsingInterstitial('MALWARE', 'https://bad.com', 'bad.com');
    expect(html).toContain(SAFE_BROWSING_PROCEED_PREFIX);
  });

  it('includes SAFE_BROWSING_BACK_PREFIX in script', () => {
    const html = buildSafeBrowsingInterstitial('MALWARE', 'https://bad.com', 'bad.com');
    expect(html).toContain(SAFE_BROWSING_BACK_PREFIX);
  });

  describe('SOCIAL_ENGINEERING threat type', () => {
    it('uses "Deceptive site ahead" title and heading', () => {
      const html = buildSafeBrowsingInterstitial('SOCIAL_ENGINEERING', 'https://phish.com', 'phish.com');
      expect(html).toContain('Deceptive site ahead');
    });

    it('mentions phishing in the details', () => {
      const html = buildSafeBrowsingInterstitial('SOCIAL_ENGINEERING', 'https://phish.com', 'phish.com');
      expect(html).toContain('phishing');
    });
  });

  describe('MALWARE threat type', () => {
    it('uses "Dangerous site" title', () => {
      const html = buildSafeBrowsingInterstitial('MALWARE', 'https://malware.com', 'malware.com');
      expect(html).toContain('Dangerous site');
    });

    it('mentions malware in the description', () => {
      const html = buildSafeBrowsingInterstitial('MALWARE', 'https://malware.com', 'malware.com');
      expect(html).toContain('malware');
    });
  });

  describe('UNWANTED_SOFTWARE threat type', () => {
    it('uses "Harmful programs ahead" title', () => {
      const html = buildSafeBrowsingInterstitial('UNWANTED_SOFTWARE', 'https://badware.com', 'badware.com');
      expect(html).toContain('Harmful programs ahead');
    });

    it('mentions harmful programs in the description', () => {
      const html = buildSafeBrowsingInterstitial('UNWANTED_SOFTWARE', 'https://badware.com', 'badware.com');
      expect(html).toContain('harmful');
    });
  });

  describe('HTML entity escaping', () => {
    it('escapes & in URL', () => {
      const html = buildSafeBrowsingInterstitial('MALWARE', 'https://a.com/?x=1&y=2', 'a.com');
      expect(html).toContain('&amp;y=2');
    });

    it('escapes < and > in hostname', () => {
      const html = buildSafeBrowsingInterstitial('MALWARE', 'https://a.com', '<script>a.com</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes " in URL', () => {
      const html = buildSafeBrowsingInterstitial('MALWARE', 'https://a.com/"path"', 'a.com');
      expect(html).toContain('&quot;path&quot;');
    });
  });

  describe('constants', () => {
    it('SAFE_BROWSING_PROCEED_PREFIX is a non-empty string', () => {
      expect(typeof SAFE_BROWSING_PROCEED_PREFIX).toBe('string');
      expect(SAFE_BROWSING_PROCEED_PREFIX.length).toBeGreaterThan(0);
    });

    it('SAFE_BROWSING_BACK_PREFIX is a non-empty string', () => {
      expect(typeof SAFE_BROWSING_BACK_PREFIX).toBe('string');
      expect(SAFE_BROWSING_BACK_PREFIX.length).toBeGreaterThan(0);
    });
  });
});
