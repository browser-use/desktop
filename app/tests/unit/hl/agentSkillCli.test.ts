import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const cli = path.resolve(__dirname, '../../../src/main/hl/stock/agent-skill/agent-skill');

let root: string;

function runAgentSkill(args: string[], input?: string) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    input,
    encoding: 'utf-8',
  });
}

function json(args: string[], input?: string) {
  const result = runAgentSkill([...args, '--json'], input);
  const output = result.status === 0 ? result.stdout : result.stderr;
  return { result, parsed: JSON.parse(output) as Record<string, unknown> };
}

describe('agent-skill CLI', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-cli-'));
    fs.mkdirSync(path.join(root, 'domain-skills', 'linkedin'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'domain-skills', 'linkedin', 'invitation-manager.md'),
      '# LinkedIn Invitation Manager\n\nUse when accepting, ignoring, or searching LinkedIn invitations.\n',
      'utf-8',
    );
    fs.mkdirSync(path.join(root, 'interaction-skills'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'interaction-skills', 'screenshots.md'),
      '# Screenshots\n\nUse Page.captureScreenshot and verify the saved PNG exists.\n',
      'utf-8',
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('searches stock skills without returning full skill content', () => {
    const { parsed } = json(['search', 'linkedin invitations']);
    const entries = parsed.entries as Array<Record<string, unknown>>;

    expect(entries[0].id).toBe('domain/linkedin/invitation-manager');
    expect(entries[0].content).toBeUndefined();
    expect(typeof parsed.elapsed_ms).toBe('number');
  });

  it('creates, views, validates, patches, and deletes user skills', () => {
    const body = [
      'Use when a recurring CRM triage workflow needs the same checks.',
      '',
      '1. Search the queue.',
      '2. Verify the account status.',
      '3. Report done when the queue is empty.',
    ].join('\n');
    const created = json(['create', 'workflow/crm-triage', '--description', 'Reusable CRM triage workflow'], body);
    expect(created.parsed.success).toBe(true);
    expect((created.parsed.entry as Record<string, unknown>).id).toBe('user/workflow/crm-triage');

    const viewed = json(['view', 'user/workflow/crm-triage']);
    expect(viewed.parsed.content).toContain('CRM triage');

    const validated = json(['validate', 'user/workflow/crm-triage']);
    expect(validated.parsed.ok).toBe(true);

    const patched = json(['patch', 'user/workflow/crm-triage', '--old', 'queue is empty', '--new', 'queue is reconciled']);
    expect(patched.parsed.success).toBe(true);

    const after = json(['view', 'user/workflow/crm-triage']);
    expect(after.parsed.content).toContain('queue is reconciled');

    const deleted = json(['delete', 'user/workflow/crm-triage']);
    expect(deleted.parsed.success).toBe(true);
    expect((deleted.parsed.entry as Record<string, unknown>).id).toBe('user/workflow/crm-triage');

    const missing = json(['view', 'user/workflow/crm-triage']);
    expect(missing.result.status).toBe(1);
    expect(missing.parsed.error).toContain('skill not found');
  });

  it('rejects patching read-only stock skills', () => {
    const { result, parsed } = json(['patch', 'interaction/screenshots', '--old', 'capture', '--new', 'snap']);

    expect(result.status).toBe(1);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('only user skills');
  });

  it('rejects deleting read-only stock skills', () => {
    const { result, parsed } = json(['delete', 'interaction/screenshots']);

    expect(result.status).toBe(1);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('only user skills');
  });
});
