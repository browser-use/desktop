import { describe, expect, it } from 'vitest';
import { normalizeBrowserNavigationInput } from '../../../src/shared/browser-navigation';

describe('normalizeBrowserNavigationInput', () => {
  it('preserves explicit http and https URLs', () => {
    expect(normalizeBrowserNavigationInput('https://example.com/docs').ok).toBe(true);
    expect(normalizeBrowserNavigationInput('http://localhost:3000/path')).toMatchObject({
      ok: true,
      url: 'http://localhost:3000/path',
      kind: 'url',
    });
  });

  it('adds a web scheme to host-like input', () => {
    expect(normalizeBrowserNavigationInput('example.com')).toMatchObject({
      ok: true,
      url: 'https://example.com/',
      kind: 'url',
    });
    expect(normalizeBrowserNavigationInput('localhost:5173')).toMatchObject({
      ok: true,
      url: 'http://localhost:5173/',
      kind: 'url',
    });
  });

  it('turns non-url text into a search URL', () => {
    expect(normalizeBrowserNavigationInput('browser use desktop')).toMatchObject({
      ok: true,
      url: 'https://www.google.com/search?q=browser%20use%20desktop',
      kind: 'search',
    });
  });

  it('rejects empty and unsupported URL inputs', () => {
    expect(normalizeBrowserNavigationInput('')).toMatchObject({ ok: false });
    expect(normalizeBrowserNavigationInput('javascript:alert(1)')).toMatchObject({
      ok: false,
      error: 'Unsupported URL scheme: javascript',
    });
    expect(normalizeBrowserNavigationInput('http://')).toMatchObject({ ok: false });
  });
});
