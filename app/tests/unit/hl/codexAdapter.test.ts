import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EngineAdapter, SpawnContext } from '../../../src/main/hl/engines/types';

const { get } = await import('../../../src/main/hl/engines/registry');
await import('../../../src/main/hl/engines/codex/adapter');

function codexAdapter(): EngineAdapter {
  const adapter = get('codex');
  if (!adapter) throw new Error('codex adapter not registered');
  return adapter;
}

function spawnContext(resumeSessionId?: string, harnessDir = '/tmp/harness'): SpawnContext {
  return {
    prompt: 'Open the docs and summarize the page.',
    harnessDir,
    sessionId: 'session-123',
    targetId: 'target-123',
    cdpPort: 9222,
    resumeSessionId,
    attachmentRefs: [],
  };
}

describe('codex adapter spawn args', () => {
  it('uses stdin and the documented noninteractive bypass flag for new sessions', () => {
    const adapter = codexAdapter();
    const ctx = spawnContext();
    const wrappedPrompt = adapter.wrapPrompt(ctx);

    expect(adapter.buildSpawnArgs(ctx, wrappedPrompt)).toEqual([
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '-',
    ]);
    expect(adapter.getStdinPayload?.(ctx, wrappedPrompt)).toBe(wrappedPrompt);
  });

  it('puts resume options before the session id for current Codex CLI parsing', () => {
    const adapter = codexAdapter();
    const ctx = spawnContext('thread-123');
    const wrappedPrompt = adapter.wrapPrompt(ctx);

    expect(adapter.buildSpawnArgs(ctx, wrappedPrompt)).toEqual([
      'exec',
      'resume',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      'thread-123',
      '-',
    ]);
    expect(adapter.getStdinPayload?.(ctx, wrappedPrompt)).toBe(wrappedPrompt);
  });

  it('injects a compact skill index into the provider prompt', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skill-index-'));
    try {
      fs.mkdirSync(path.join(tmp, 'skills', 'workflow', 'crm-triage'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, 'skills', 'workflow', 'crm-triage', 'SKILL.md'),
        [
          '---',
          'name: CRM Triage',
          'description: Reusable CRM queue triage workflow',
          '---',
          '',
          '# CRM Triage',
          '',
          'Full internal instructions stay out of the prompt index.',
        ].join('\n'),
        'utf-8',
      );

      const adapter = codexAdapter();
      const wrappedPrompt = adapter.wrapPrompt(spawnContext(undefined, tmp));

      expect(wrappedPrompt).toContain('## Available Skills');
      expect(wrappedPrompt).toContain('user/workflow/crm-triage: CRM Triage - Reusable CRM queue triage workflow');
      expect(wrappedPrompt).not.toContain('Full internal instructions');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('injects skill lifecycle guidance into the provider prompt', () => {
    const adapter = codexAdapter();
    const wrappedPrompt = adapter.wrapPrompt(spawnContext());

    expect(wrappedPrompt).toContain('likely to repeat, long-running enough to justify reuse, or generally applicable');
    expect(wrappedPrompt).toContain('Do not write skills for one-off facts/calculations');
  });
});
