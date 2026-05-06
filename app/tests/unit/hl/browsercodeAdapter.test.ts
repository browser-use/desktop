import { describe, expect, it } from 'vitest';
import type { EngineAdapter, SpawnContext } from '../../../src/main/hl/engines/types';

const { get } = await import('../../../src/main/hl/engines/registry');
await import('../../../src/main/hl/engines/browsercode/adapter');

function browserCodeAdapter(): EngineAdapter {
  const adapter = get('browsercode');
  if (!adapter) throw new Error('browsercode adapter not registered');
  return adapter;
}

function spawnContext(): SpawnContext {
  return {
    prompt: 'Open the docs and summarize the page.',
    harnessDir: '/tmp/harness',
    sessionId: 'session-123',
    targetId: 'target-123',
    cdpPort: 9222,
    resumeSessionId: 'resume-123',
    providerId: 'alibaba',
    model: 'alibaba/qwen3-coder-plus',
    attachmentRefs: [{ relPath: 'attachments/spec.md', mime: 'text/markdown', size: 42 }],
  };
}

describe('browsercode adapter stdin payload mode', () => {
  it('reads the wrapped prompt from stdin instead of argv', () => {
    const adapter = browserCodeAdapter();
    const ctx = spawnContext();
    const wrappedPrompt = adapter.wrapPrompt(ctx);
    const args = adapter.buildSpawnArgs(ctx, wrappedPrompt);

    expect(args).toEqual([
      'run',
      '--format',
      'json',
      '--dangerously-skip-permissions',
      '--model',
      'alibaba/qwen3-coder-plus',
      '--session',
      'resume-123',
      '--file',
      'attachments/spec.md',
    ]);
    expect(args).not.toContain(wrappedPrompt);
    expect(adapter.getStdinPayload?.(ctx, wrappedPrompt)).toBe(wrappedPrompt);
  });
});
