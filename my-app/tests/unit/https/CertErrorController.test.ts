/**
 * CertErrorController unit tests.
 *
 * Tests cover:
 *   - allowCertBypassForOrigin / isCertBypassed / clearCertBypasses
 *   - buildCertErrorInterstitial: HTML structure, HSTS vs non-HSTS, entity escaping,
 *     error code labels, unknown error code fallback, CERT_BYPASS_PREFIX/CERT_BACK_PREFIX
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { loggerSpy } = vi.hoisted(() => ({
  loggerSpy: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/main/logger', () => ({ mainLogger: loggerSpy }));

import {
  allowCertBypassForOrigin,
  isCertBypassed,
  clearCertBypasses,
  buildCertErrorInterstitial,
  CERT_BYPASS_PREFIX,
  CERT_BACK_PREFIX,
} from '../../../src/main/https/CertErrorController';

// ---------------------------------------------------------------------------
// Reset module-level state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearCertBypasses();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Bypass origin state
// ---------------------------------------------------------------------------

describe('bypass origin management', () => {
  it('isCertBypassed returns false initially', () => {
    expect(isCertBypassed('example.com')).toBe(false);
  });

  it('allowCertBypassForOrigin marks origin as bypassed', () => {
    allowCertBypassForOrigin('example.com');
    expect(isCertBypassed('example.com')).toBe(true);
  });

  it('allowCertBypassForOrigin is idempotent', () => {
    allowCertBypassForOrigin('example.com');
    allowCertBypassForOrigin('example.com');
    expect(isCertBypassed('example.com')).toBe(true);
  });

  it('clearCertBypasses removes all bypassed origins', () => {
    allowCertBypassForOrigin('a.com');
    allowCertBypassForOrigin('b.com');
    clearCertBypasses();
    expect(isCertBypassed('a.com')).toBe(false);
    expect(isCertBypassed('b.com')).toBe(false);
  });

  it('bypass is origin-specific', () => {
    allowCertBypassForOrigin('a.com');
    expect(isCertBypassed('b.com')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildCertErrorInterstitial — HTML structure
// ---------------------------------------------------------------------------

describe('buildCertErrorInterstitial()', () => {
  it('contains DOCTYPE and title', () => {
    const html = buildCertErrorInterstitial('https://example.com', 'example.com', false, -202);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Your connection is not private');
  });

  it('includes the hostname in the page', () => {
    const html = buildCertErrorInterstitial('https://example.com', 'example.com', false, -202);
    expect(html).toContain('example.com');
  });

  it('includes the URL in the details section', () => {
    const html = buildCertErrorInterstitial('https://example.com/page', 'example.com', false, -202);
    expect(html).toContain('https://example.com/page');
  });

  it('contains Go back button', () => {
    const html = buildCertErrorInterstitial('https://example.com', 'example.com', false, -202);
    expect(html).toContain('Go back');
  });

  // ---------------------------------------------------------------------------
  // Non-HSTS: bypass section is visible
  // ---------------------------------------------------------------------------

  describe('non-HSTS host', () => {
    it('shows the "thisisunsafe" bypass section', () => {
      const html = buildCertErrorInterstitial('https://example.com', 'example.com', false, -202);
      expect(html).toContain('thisisunsafe');
      expect(html).toContain('bypass-section');
    });

    it('does not show HSTS badge', () => {
      const html = buildCertErrorInterstitial('https://example.com', 'example.com', false, -202);
      expect(html).not.toContain('HSTS Protected');
    });

    it('does not show hsts-note element', () => {
      const html = buildCertErrorInterstitial('https://example.com', 'example.com', false, -202);
      // hsts-note class is only in CSS, not used as an element class for non-HSTS
      expect(html).not.toContain('class="hsts-note"');
    });

    it('includes CERT_BYPASS_PREFIX in the script', () => {
      const html = buildCertErrorInterstitial('https://example.com', 'example.com', false, -202);
      expect(html).toContain(CERT_BYPASS_PREFIX);
    });
  });

  // ---------------------------------------------------------------------------
  // HSTS host: bypass section is hidden
  // ---------------------------------------------------------------------------

  describe('HSTS host', () => {
    it('shows HSTS badge', () => {
      const html = buildCertErrorInterstitial('https://hsts.example.com', 'hsts.example.com', true, -202);
      expect(html).toContain('HSTS Protected');
    });

    it('shows hsts-note element instead of bypass-section element', () => {
      const html = buildCertErrorInterstitial('https://hsts.example.com', 'hsts.example.com', true, -202);
      expect(html).toContain('class="hsts-note"');
      // bypass-section div element is absent (CSS definition still present)
      expect(html).not.toContain('class="bypass-section"');
    });

    it('hsts-note mentions the HSTS policy', () => {
      const html = buildCertErrorInterstitial('https://hsts.example.com', 'hsts.example.com', true, -202);
      expect(html).toContain('security policy');
    });

    it('mentions HSTS policy in the note', () => {
      const html = buildCertErrorInterstitial('https://hsts.example.com', 'hsts.example.com', true, -202);
      expect(html).toContain('HSTS');
    });
  });

  // ---------------------------------------------------------------------------
  // Error code labels
  // ---------------------------------------------------------------------------

  describe('error code labels', () => {
    const knownCodes: Array<[number, string]> = [
      [-200, 'ERR_CERT_COMMON_NAME_INVALID'],
      [-201, 'ERR_CERT_DATE_INVALID'],
      [-202, 'ERR_CERT_AUTHORITY_INVALID'],
      [-203, 'ERR_CERT_CONTAINS_ERRORS'],
      [-206, 'ERR_CERT_REVOKED'],
      [-207, 'ERR_CERT_INVALID'],
    ];

    for (const [code, label] of knownCodes) {
      it(`shows "${label}" for error code ${code}`, () => {
        const html = buildCertErrorInterstitial('https://example.com', 'example.com', false, code);
        expect(html).toContain(label);
      });
    }

    it('falls back to NET_ERROR(N) for unknown error code', () => {
      const html = buildCertErrorInterstitial('https://example.com', 'example.com', false, -999);
      expect(html).toContain('NET_ERROR(-999)');
    });
  });

  // ---------------------------------------------------------------------------
  // HTML entity escaping
  // ---------------------------------------------------------------------------

  describe('HTML entity escaping', () => {
    it('escapes & in URL', () => {
      const html = buildCertErrorInterstitial('https://a.com/?x=1&y=2', 'a.com', false, -202);
      expect(html).toContain('&amp;y=2');
    });

    it('escapes < and > in hostname', () => {
      const html = buildCertErrorInterstitial('https://a.com', '<script>a.com</script>', false, -202);
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes " in URL', () => {
      const html = buildCertErrorInterstitial('https://a.com/"path"', 'a.com', false, -202);
      expect(html).toContain('&quot;path&quot;');
    });
  });

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  describe('constants', () => {
    it('CERT_BYPASS_PREFIX is a non-empty string', () => {
      expect(typeof CERT_BYPASS_PREFIX).toBe('string');
      expect(CERT_BYPASS_PREFIX.length).toBeGreaterThan(0);
    });

    it('CERT_BACK_PREFIX is a non-empty string', () => {
      expect(typeof CERT_BACK_PREFIX).toBe('string');
      expect(CERT_BACK_PREFIX.length).toBeGreaterThan(0);
    });

    it('CERT_BACK_PREFIX appears in the goBack script', () => {
      const html = buildCertErrorInterstitial('https://example.com', 'example.com', false, -202);
      expect(html).toContain(CERT_BACK_PREFIX);
    });
  });
});
