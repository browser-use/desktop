import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSkillIndexPrompt, scanSkillIndex } from '../../../src/main/hl/engines/skillIndexPrompt';

let harnessDir: string;

describe('skill index prompt', () => {
  beforeEach(() => {
    harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-index-prompt-'));
    fs.mkdirSync(path.join(harnessDir, 'domain-skills', 'linkedin'), { recursive: true });
    fs.writeFileSync(
      path.join(harnessDir, 'domain-skills', 'linkedin', 'invitation-manager.md'),
      '# LinkedIn Invitation Manager\n\nUse when accepting, ignoring, or searching LinkedIn invitations.\n\nFull selector details should not be copied into search metadata.\n',
      'utf-8',
    );
    fs.mkdirSync(path.join(harnessDir, 'interaction-skills'), { recursive: true });
    fs.writeFileSync(
      path.join(harnessDir, 'interaction-skills', 'screenshots.md'),
      '# Screenshots\n\nUse Page.captureScreenshot for visual verification.\n',
      'utf-8',
    );
    fs.mkdirSync(path.join(harnessDir, 'skills', 'workflow', 'crm-triage'), { recursive: true });
    fs.writeFileSync(
      path.join(harnessDir, 'skills', 'workflow', 'crm-triage', 'SKILL.md'),
      [
        '---',
        'name: CRM Triage',
        'description: Reusable CRM queue triage workflow',
        '---',
        '',
        '# CRM Triage',
        '',
        'Long private instructions stay in the view output, not the prompt index.',
      ].join('\n'),
      'utf-8',
    );
  });

  afterEach(() => {
    fs.rmSync(harnessDir, { recursive: true, force: true });
  });

  it('builds a compact metadata-only index with informative skill ids', () => {
    const entries = scanSkillIndex(harnessDir);
    const prompt = buildSkillIndexPrompt(harnessDir);

    expect(entries.map((entry) => entry.id)).toEqual([
      'user/workflow/crm-triage',
      'interaction/screenshots',
      'domain/linkedin/invitation-manager',
    ]);
    expect(prompt).toContain('## Available Skills');
    expect(prompt).toContain('user/workflow/crm-triage: CRM Triage - Reusable CRM queue triage workflow');
    expect(prompt).toContain('interaction/screenshots: Screenshots - Use Page.captureScreenshot for visual verification.');
    expect(prompt).toContain('domain/linkedin/invitation-manager: LinkedIn Invitation Manager');
    expect(prompt).not.toContain('Long private instructions');
    expect(prompt).not.toContain('Full selector details');
  });

  it('caps prompt size and points agents back to search when truncated', () => {
    const prompt = buildSkillIndexPrompt(harnessDir, 320);

    expect(prompt.length).toBeLessThan(500);
    expect(prompt).toContain('Index truncated');
    expect(prompt).toContain('agent-skill search');
  });
});
