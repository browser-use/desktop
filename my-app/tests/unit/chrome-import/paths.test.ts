import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  getChromeUserDataDirCandidates,
  resolveChromeProfilePath,
} from '../../../src/main/chrome-import/profiles';
import { chromeBinaryCandidates } from '../../../src/main/chrome-import/cookies';

describe('chrome import path helpers', () => {
  it('uses LOCALAPPDATA for Windows Chrome profile discovery', () => {
    const candidates = getChromeUserDataDirCandidates({
      platform: 'win32',
      homedir: 'C:\\Users\\Ada',
      env: { LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local' },
    });

    expect(candidates[0]).toBe('C:\\Users\\Ada\\AppData\\Local\\Google\\Chrome\\User Data');
    expect(candidates).toContain('C:\\Users\\Ada\\AppData\\Local\\Chromium\\User Data');
  });

  it('uses XDG_CONFIG_HOME for Linux Chrome profile discovery', () => {
    const candidates = getChromeUserDataDirCandidates({
      platform: 'linux',
      homedir: '/home/ada',
      env: { XDG_CONFIG_HOME: '/home/ada/.config' },
    });

    expect(candidates[0]).toBe(path.join('/home/ada/.config', 'google-chrome'));
    expect(candidates).toContain(path.join('/home/ada/.config', 'chromium'));
  });

  it('rejects profile traversal before importing cookies', () => {
    expect(() => resolveChromeProfilePath('..', {
      platform: 'linux',
      homedir: '/home/ada',
      env: { XDG_CONFIG_HOME: '/home/ada/.config' },
    })).toThrow('Invalid Chrome profile directory');
  });

  it('includes Windows Chrome executable locations', () => {
    const candidates = chromeBinaryCandidates({
      platform: 'win32',
      homedir: 'C:\\Users\\Ada',
      env: {
        LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local',
        ProgramFiles: 'C:\\Program Files',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      },
    });

    expect(candidates).toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    expect(candidates).toContain('C:\\Users\\Ada\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe');
  });
});
