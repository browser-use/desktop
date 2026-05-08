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
    expect(fs.existsSync(helpersPath())).toBe(true);
    expect(fs.readFileSync(skillPath(), 'utf-8')).toContain('Browser Harness JS');
    expect(fs.existsSync(toolsPath())).toBe(false);
    expect(fs.existsSync(cli)).toBe(true);
    expect(fs.statSync(cli).mode & 0o111).not.toBe(0);
    expect(fs.existsSync(path.join(interactionSkillsDir(), 'screenshots.md'))).toBe(true);
  });
});
