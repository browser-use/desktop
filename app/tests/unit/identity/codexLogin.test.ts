import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codexLoginPtySpawnSpec } from '../../../src/main/identity/codexLogin';

describe('codex login PTY spawn spec', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the shared Windows shim resolver for npm-installed codex.cmd', () => {
    vi.spyOn(fs, 'statSync').mockImplementation((candidate) => ({
      isFile: () => String(candidate).endsWith('codex.cmd'),
    }) as fs.Stats);

    const spec = codexLoginPtySpawnSpec(['login'], {
      platform: 'win32',
      env: {
        PATH: 'C:\\Users\\Ada\\AppData\\Roaming\\npm',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
      },
    });

    expect(spec.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(spec.args[0]).toBe('/d');
    expect(spec.args[1]).toBe('/s');
    expect(spec.args[2]).toBe('/c');
    expect(spec.args[3]).toContain('codex.cmd');
    expect(spec.args[3]).toContain('login');
  });
});
