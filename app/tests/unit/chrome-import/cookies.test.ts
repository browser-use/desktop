import { describe, expect, it } from 'vitest';
import {
  electronCookieDetailsForImport,
  type CdpCookie,
} from '../../../src/main/chrome-import/cookies';

function cookie(overrides: Partial<CdpCookie> = {}): CdpCookie {
  return {
    name: 'SID',
    value: 'abc',
    domain: '.google.com',
    path: '/',
    expires: 1_900_000_000,
    size: 3,
    httpOnly: true,
    secure: true,
    session: false,
    sameSite: 'Lax',
    ...overrides,
  };
}

describe('electronCookieDetailsForImport', () => {
  it('keeps the domain attribute for domain cookies', () => {
    const details = electronCookieDetailsForImport(cookie({
      domain: '.google.com',
    }));

    expect(details).toMatchObject({
      url: 'https://google.com/',
      domain: '.google.com',
      name: 'SID',
      value: 'abc',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: 1_900_000_000,
    });
  });

  it('omits the domain attribute for host-only cookies', () => {
    const details = electronCookieDetailsForImport(cookie({
      name: '__Host-GMAIL_SCH_GMN',
      domain: 'mail.google.com',
    }));

    expect(details).toMatchObject({
      url: 'https://mail.google.com/',
      name: '__Host-GMAIL_SCH_GMN',
      value: 'abc',
      path: '/',
      secure: true,
    });
    expect(details).not.toHaveProperty('domain');
  });

  it('preserves empty cookie values', () => {
    const details = electronCookieDetailsForImport(cookie({
      value: '',
      domain: 'accounts.google.com',
    }));

    expect(details).toMatchObject({
      url: 'https://accounts.google.com/',
      value: '',
    });
  });

  it('returns null when the cookie has no name or domain', () => {
    expect(electronCookieDetailsForImport(cookie({ name: '' }))).toBeNull();
    expect(electronCookieDetailsForImport(cookie({ domain: '' }))).toBeNull();
  });
});
