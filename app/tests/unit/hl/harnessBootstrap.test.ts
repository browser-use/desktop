import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

const mockState = vi.hoisted(() => {
  const fsMod = require('node:fs') as typeof import('node:fs');
  const osMod = require('node:os') as typeof import('node:os');
  const pathMod = require('node:path') as typeof import('node:path');
  return {
    userData: fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'bu-harness-bootstrap-')),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockState.userData),
  },
}));

const {
  bootstrapHarness,
  browserHarnessJsDir,
  helpersPath,
  interactionSkillsDir,
  skillPath,
  toolsPath,
} = await import('../../../src/main/hl/harness');

describe('bootstrapHarness browser-harness-js materialization', () => {
  beforeEach(() => {
    fs.rmSync(path.join(mockState.userData, 'harness'), { recursive: true, force: true });
  });

  afterAll(() => {
    fs.rmSync(mockState.userData, { recursive: true, force: true });
  });

  test('writes Browser Harness JS runtime and removes legacy TOOLS.json', () => {
    fs.mkdirSync(path.dirname(toolsPath()), { recursive: true });
    fs.writeFileSync(toolsPath(), '{}\n');

    bootstrapHarness();

    const cli = path.join(browserHarnessJsDir(), 'sdk', 'browser-harness-js');
    const cliCmd = path.join(browserHarnessJsDir(), 'sdk', 'browser-harness-js.cmd');
    expect(fs.existsSync(helpersPath())).toBe(true);
    expect(fs.readFileSync(skillPath(), 'utf-8')).toContain('Browser Harness JS');
    expect(fs.existsSync(toolsPath())).toBe(false);
    expect(fs.existsSync(cli)).toBe(true);
    // Windows launcher ships alongside the bash script so Codex can find it
    // via PATHEXT (.CMD) instead of hitting the no-handler popup on the
    // extensionless bash file.
    expect(fs.existsSync(cliCmd)).toBe(true);
    expect(fs.readFileSync(cliCmd, 'utf-8')).toContain('bash.exe');
    expect(fs.existsSync(path.join(interactionSkillsDir(), 'screenshots.md'))).toBe(true);
    // Executable-bit assert: skipped on Windows because NTFS permission
    // mapping doesn't expose POSIX exec bits the way the test asserts.
    if (process.platform !== 'win32') {
      expect(fs.statSync(cli).mode & 0o111).not.toBe(0);
    }
  });
});
