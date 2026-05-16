import { describe, expect, it } from 'vitest';
import {
  buildBrowserIdentity,
  withBrowserIdentityHeaders,
} from '../../../src/main/sessions/browserIdentity';

describe('browser identity', () => {
  it('builds a desktop Firefox identity for macOS', () => {
    const identity = buildBrowserIdentity({
      firefoxVersion: '140.0',
      platform: 'darwin',
    });

    expect(identity.userAgent).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0',
    );
    expect(identity.firefoxVersion).toBe('140.0');
    expect(identity.userAgent).not.toContain('Electron');
    expect(identity.userAgent).not.toContain('BrowserUse');
    expect(identity.userAgent).not.toContain('Chrome/');
    expect(identity.jsPlatform).toBe('MacIntel');
    expect(identity.platformLabel).toBe('macOS');
  });

  it('sets Firefox request headers and removes Chromium UA client hints', () => {
    const identity = buildBrowserIdentity({
      firefoxVersion: '140.0',
      platform: 'win32',
    });

    const headers = withBrowserIdentityHeaders({
      Accept: 'text/html',
      'user-agent': 'Electron UA',
      'sec-ch-ua': '"Electron";v="41"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua-arch': '"x86"',
      'sec-ch-ua-full-version-list': '"Electron";v="41.0.0.0"',
      'sec-ch-ua-form-factors': '"Unknown"',
      'sec-ch-ua-platform-version': '"15.0.0"',
    }, identity);

    expect(headers.Accept).toBe('text/html');
    expect(headers['user-agent']).toBe(identity.userAgent);
    expect(headers['sec-ch-ua']).toBeUndefined();
    expect(headers['sec-ch-ua-mobile']).toBeUndefined();
    expect(headers['sec-ch-ua-platform']).toBeUndefined();
    expect(headers['sec-ch-ua-arch']).toBeUndefined();
    expect(headers['sec-ch-ua-full-version-list']).toBeUndefined();
    expect(headers['sec-ch-ua-form-factors']).toBeUndefined();
    expect(headers['sec-ch-ua-platform-version']).toBeUndefined();
    expect(headers['Accept-Language']).toBe('en-US,en;q=0.9');
    expect(identity.acceptLanguageOverride).toBe('en-US,en');
    expect(identity.languages).toEqual(['en-US', 'en']);
  });

  it('builds platform-specific Firefox user agents', () => {
    const identity = buildBrowserIdentity({
      firefoxVersion: '140.0',
      platform: 'linux',
    });

    expect(identity.userAgent).toBe(
      'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
    );
    expect(identity.jsPlatform).toBe('Linux x86_64');
    expect(identity.platformLabel).toBe('Linux');
  });

  it('does not add client hints when none were present', () => {
    const identity = buildBrowserIdentity({
      firefoxVersion: '140.0',
      platform: 'darwin',
    });

    const headers = withBrowserIdentityHeaders({ Accept: 'text/html' }, identity);

    expect(headers['User-Agent']).toBe(identity.userAgent);
    expect(headers['sec-ch-ua']).toBeUndefined();
    expect(headers['sec-ch-ua-full-version-list']).toBeUndefined();
    expect(headers['sec-ch-ua-platform-version']).toBeUndefined();
  });

});
