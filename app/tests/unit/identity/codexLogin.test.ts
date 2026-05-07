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
        PATH: 'C:\\Program Files\\npm',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
      },
    });

    expect(spec.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(spec.args).toBe('/d /s /c ""C:\\Program Files\\npm\\codex.cmd" login"');
    expect(spec.spawnOptions).toEqual({ windowsVerbatimArguments: true });
  });
});
