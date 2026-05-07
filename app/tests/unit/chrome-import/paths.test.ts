import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  detectChromeProfiles,
  getChromeUserDataDirCandidates,
  resolveChromeProfilePath,
  supportedChromiumBrowserKeys,
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
    expect(candidates).toContain('C:\\Users\\Ada\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data');
    expect(candidates).toContain('C:\\Users\\Ada\\AppData\\Local\\Microsoft\\Edge\\User Data');
  });

  it('uses XDG_CONFIG_HOME for Linux Chrome profile discovery', () => {
    const candidates = getChromeUserDataDirCandidates({
      platform: 'linux',
      homedir: '/home/ada',
      env: { XDG_CONFIG_HOME: '/home/ada/.config' },
    });

    expect(candidates[0]).toBe(path.join('/home/ada/.config', 'google-chrome'));
    expect(candidates).toContain(path.join('/home/ada/.config', 'chromium'));
    expect(candidates).toContain(path.join('/home/ada/.config', 'BraveSoftware', 'Brave-Browser'));
    expect(candidates).toContain(path.join('/home/ada/.config', 'microsoft-edge'));
  });

  it('rejects profile traversal before importing cookies', () => {
    expect(() => resolveChromeProfilePath('..', {
      platform: 'linux',
      homedir: '/home/ada',
      env: { XDG_CONFIG_HOME: '/home/ada/.config' },
    })).toThrow('Invalid browser profile directory');
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
    expect(candidates).toContain('C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe');
    expect(candidates).toContain('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe');
  });

  it('detects multiple Chromium browser profiles with stable ids', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-profiles-'));
    try {
      const binDir = path.join(root, 'bin');
      const configHome = path.join(root, '.config');
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, 'google-chrome'), '');
      fs.writeFileSync(path.join(binDir, 'brave-browser'), '');

      const chromeDir = path.join(configHome, 'google-chrome');
      const braveDir = path.join(configHome, 'BraveSoftware', 'Brave-Browser');
      fs.mkdirSync(path.join(chromeDir, 'Default', 'Network'), { recursive: true });
      fs.mkdirSync(path.join(braveDir, 'Profile 1', 'Network'), { recursive: true });
      fs.writeFileSync(path.join(chromeDir, 'Default', 'Network', 'Cookies'), '');
      fs.writeFileSync(path.join(braveDir, 'Profile 1', 'Network', 'Cookies'), '');
      fs.writeFileSync(path.join(chromeDir, 'Local State'), JSON.stringify({
        profile: { info_cache: { Default: { name: 'Personal', user_name: 'ada@example.com' } } },
      }));
      fs.writeFileSync(path.join(braveDir, 'Local State'), JSON.stringify({
        profile: { info_cache: { 'Profile 1': { name: 'Work' } } },
      }));

      const profiles = detectChromeProfiles({
        platform: 'linux',
        homedir: root,
        env: {
          PATH: binDir,
          XDG_CONFIG_HOME: configHome,
        },
      });

      expect(profiles).toEqual([
        expect.objectContaining({
          id: 'google-chrome:Default',
          browserKey: 'google-chrome',
          browserName: 'Google Chrome',
          directory: 'Default',
          name: 'Personal',
          email: 'ada@example.com',
        }),
        expect.objectContaining({
          id: 'brave:Profile%201',
          browserKey: 'brave',
          browserName: 'Brave',
          directory: 'Profile 1',
          name: 'Work',
        }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('hides profile directories that do not have a readable cookie file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-profiles-'));
    try {
      const binDir = path.join(root, 'bin');
      const configHome = path.join(root, '.config');
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, 'google-chrome'), '');

      const chromeDir = path.join(configHome, 'google-chrome');
      fs.mkdirSync(path.join(chromeDir, 'Default', 'Network', 'Cookies'), { recursive: true });
      fs.mkdirSync(path.join(chromeDir, 'Profile 1', 'Network'), { recursive: true });
      fs.writeFileSync(path.join(chromeDir, 'Profile 1', 'Network', 'Cookies'), '');
      fs.writeFileSync(path.join(chromeDir, 'Local State'), JSON.stringify({
        profile: {
          info_cache: {
            Default: { name: 'Broken' },
            'Profile 1': { name: 'Good' },
          },
        },
      }));

      const profiles = detectChromeProfiles({
        platform: 'linux',
        homedir: root,
        env: {
          PATH: binDir,
          XDG_CONFIG_HOME: configHome,
        },
      });

      expect(profiles).toEqual([
        expect.objectContaining({
          id: 'google-chrome:Profile%201',
          browserKey: 'google-chrome',
          directory: 'Profile 1',
          name: 'Good',
        }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the supported browser key list stable for renderer identification', () => {
    expect(supportedChromiumBrowserKeys()).toEqual([
      'google-chrome',
      'google-chrome-canary',
      'brave',
      'microsoft-edge',
      'chromium',
      'arc',
      'opera',
      'vivaldi',
      'yandex',
      'iridium',
      'ungoogled-chromium',
      'comet',
      'helium',
      'dia',
      'sidekick',
      'thorium',
      'sigmaos',
      'wavebox',
      'ghost-browser',
      'blisk',
    ]);
  });
});
