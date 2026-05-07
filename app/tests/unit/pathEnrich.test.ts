import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enrichedPath, resolveCliLaunch } from '../../src/main/hl/engines/pathEnrich';

describe('pathEnrich', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps Windows PATH semicolon-delimited and adds common user CLI dirs', () => {
    const result = enrichedPath('C:\\Windows\\System32;C:\\Tools', {
      platform: 'win32',
      homedir: 'C:\\Users\\Ada',
      env: {
        LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local',
      },
    });

    const parts = result.split(';');
    expect(parts.slice(0, 2)).toEqual(['C:\\Windows\\System32', 'C:\\Tools']);
    expect(parts).toContain('C:\\Users\\Ada\\AppData\\Roaming\\npm');
    expect(parts).toContain('C:\\Users\\Ada\\.bcode\\bin');
    expect(parts).toContain('C:\\Users\\Ada\\.cargo\\bin');
    expect(parts).toContain('C:\\Users\\Ada\\AppData\\Local\\Microsoft\\WindowsApps');
    expect(parts).toContain('C:\\Users\\Ada\\scoop\\shims');
    expect(parts).toContain('C:\\ProgramData\\chocolatey\\bin');
  });

  it('combines Windows Path and PATH values before adding fallbacks', () => {
    const result = enrichedPath(undefined, {
      platform: 'win32',
      homedir: 'C:\\Users\\Ada',
      env: {
        Path: 'C:\\Windows\\System32',
        PATH: 'C:\\Tools',
        APPDATA: 'C:\\Users\\Ada\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local',
        PNPM_HOME: 'C:\\Users\\Ada\\AppData\\Local\\pnpm',
      },
    });

    const parts = result.split(';');
    expect(parts.slice(0, 2)).toEqual(['C:\\Windows\\System32', 'C:\\Tools']);
    expect(parts).toContain('C:\\Users\\Ada\\AppData\\Roaming\\npm');
    expect(parts).toContain('C:\\Users\\Ada\\AppData\\Local\\pnpm');
  });

  it('uses POSIX delimiters for Linux-style paths', () => {
    const result = enrichedPath('/usr/bin:/bin', {
      platform: 'linux',
      homedir: '/home/ada',
      env: {},
    });

    const parts = result.split(':');
    expect(parts.slice(0, 2)).toEqual(['/usr/bin', '/bin']);
    expect(parts).toContain('/home/ada/.local/bin');
    expect(parts).toContain('/home/ada/.cargo/bin');
    expect(parts).toContain('/home/ada/.asdf/shims');
    expect(parts).toContain('/home/ada/.local/share/mise/shims');
    expect(parts).toContain('/home/ada/.local/share/pnpm');
    expect(parts).toContain('/snap/bin');
  });

  it('adds existing POSIX Node version-manager bins', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'path-enrich-'));
    try {
      const home = path.join(tmp, 'home');
      const nvmBin = path.join(home, '.nvm', 'versions', 'node', 'v22.12.0', 'bin');
      const fnmBin = path.join(home, '.local', 'share', 'fnm', 'node-versions', 'v20.18.1', 'installation', 'bin');
      fs.mkdirSync(nvmBin, { recursive: true });
      fs.mkdirSync(fnmBin, { recursive: true });

      const result = enrichedPath('/usr/bin', {
        platform: 'darwin',
        homedir: home,
        env: {
          SHELL: path.join(tmp, 'missing-shell'),
          NPM_CONFIG_PREFIX: path.join(home, '.npm-prefix'),
          PNPM_HOME: path.join(home, 'Library', 'pnpm'),
        },
      });

      const parts = result.split(':');
      expect(parts).toContain(nvmBin);
      expect(parts).toContain(fnmBin);
      expect(parts).toContain(path.join(home, '.npm-prefix', 'bin'));
      expect(parts).toContain(path.join(home, 'Library', 'pnpm'));
      expect(parts).toContain(path.join(home, '.volta', 'bin'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('routes macOS/Linux CLI launches through a PATH-enriched env without a shell', () => {
    const spec = resolveCliLaunch('codex', ['--version'], {
      platform: 'linux',
      homedir: '/home/ada',
      env: { PATH: '/usr/bin' },
    });

    expect(spec.command).toBe('codex');
    expect(spec.args).toEqual(['--version']);
    expect(spec.viaCmdShell).toBe(false);
    expect(spec.spawnOptions).toEqual({});
    expect(spec.env.PATH?.split(':')).toEqual(expect.arrayContaining([
      '/usr/bin',
      '/home/ada/.local/bin',
      '/home/ada/.cargo/bin',
      '/home/ada/.asdf/shims',
    ]));
  });

  it('routes Windows CLI launches through the same PATH enrichment and shim resolver', () => {
    vi.spyOn(fs, 'statSync').mockImplementation((candidate) => ({
      isFile: () => String(candidate).endsWith('codex.cmd'),
      isDirectory: () => false,
    }) as fs.Stats);

    const spec = resolveCliLaunch('codex', ['login'], {
      platform: 'win32',
      homedir: 'C:\\Users\\Ada',
      env: {
        PATH: 'C:\\Users\\Ada\\AppData\\Roaming\\npm',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
      },
    });

    expect(spec.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(spec.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(spec.args[3]).toContain('codex.cmd');
    expect(spec.args[3]).toContain('login');
    expect(spec.env.PATH?.split(';')).toContain('C:\\Users\\Ada\\AppData\\Roaming\\npm');
    expect(spec.env.PATH?.split(';')).toContain('C:\\Users\\Ada\\.volta\\bin');
    expect(spec.spawnOptions).toEqual({ windowsVerbatimArguments: true });
  });
});
