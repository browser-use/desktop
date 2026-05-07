import { describe, expect, it } from 'vitest';
import type { EngineAdapter, SpawnContext } from '../../../src/main/hl/engines/types';

const { get } = await import('../../../src/main/hl/engines/registry');
await import('../../../src/main/hl/engines/codex/adapter');

function codexAdapter(): EngineAdapter {
  const adapter = get('codex');
  if (!adapter) throw new Error('codex adapter not registered');
  return adapter;
}

function spawnContext(resumeSessionId?: string): SpawnContext {
  return {
    prompt: 'Open the docs and summarize the page.',
    harnessDir: '/tmp/harness',
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
});
