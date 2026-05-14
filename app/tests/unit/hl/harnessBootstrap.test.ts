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
  agentSkillDir,
  bootstrapHarness,
  browserHarnessJsDir,
  helpersPath,
  interactionSkillsDir,
  skillIdToPath,
  skillPath,
  skillPathFromMeta,
  toolsPath,
  userSkillsDir,
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
    const agentSkill = path.join(agentSkillDir(), 'agent-skill');
    const userSkill = path.join(userSkillsDir(), 'general', 'existing', 'SKILL.md');
    fs.mkdirSync(path.dirname(userSkill), { recursive: true });
    fs.writeFileSync(userSkill, '# Existing\n');

    bootstrapHarness();

    expect(fs.existsSync(helpersPath())).toBe(true);
    expect(fs.readFileSync(skillPath(), 'utf-8')).toContain('Browser Harness JS');
    expect(fs.existsSync(toolsPath())).toBe(false);
    expect(fs.existsSync(cli)).toBe(true);
    expect(fs.existsSync(agentSkill)).toBe(true);
    expect(fs.existsSync(path.join(agentSkillDir(), 'agent-skill.cmd'))).toBe(true);
    expect(fs.existsSync(userSkill)).toBe(true);
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
      expect(fs.statSync(agentSkill).mode & 0o111).not.toBe(0);
    }
  });

  test('rejects traversal and absolute skill IDs before converting to paths', () => {
    const root = path.join(mockState.userData, 'harness');

    expect(skillIdToPath('domain/github/repo', root)).toBe(path.join(root, 'domain-skills', 'github/repo.md'));
    expect(skillIdToPath('interaction/screenshots.md', root)).toBe(path.join(root, 'interaction-skills', 'screenshots.md'));
    expect(skillIdToPath('domain/../secret', root)).toBeNull();
    expect(skillIdToPath('domain/./github', root)).toBeNull();
    expect(skillIdToPath('domain//github', root)).toBeNull();
    expect(skillIdToPath('/domain/github', root)).toBeNull();
    expect(skillIdToPath('domain/C:/secret', root)).toBeNull();
    expect(skillPathFromMeta({ domain: 'user', topic: '../secret' }, root)).toBeNull();
    expect(skillPathFromMeta({ domain: 'domain', topic: '/github/repo' }, root)).toBeNull();
  });
});
