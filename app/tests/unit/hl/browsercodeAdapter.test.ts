import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineAdapter, ParseContext, SpawnContext } from '../../../src/main/hl/engines/types';

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

function parseContext(): ParseContext {
  return {
    iter: 0,
    pendingTools: new Map(),
    harnessHelpersPath: '/tmp/harness/helpers.js',
    harnessToolsPath: '/tmp/harness/TOOLS.json',
    harnessSkillPath: '/tmp/harness/skill.md',
  };
}

afterEach(() => {
  vi.useRealTimers();
});

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

  it('injects skill lifecycle guidance into the provider prompt', () => {
    const adapter = browserCodeAdapter();
    const wrappedPrompt = adapter.wrapPrompt(spawnContext());

    expect(wrappedPrompt).toContain('likely to repeat, long-running enough to justify reuse, or generally applicable');
    expect(wrappedPrompt).toContain('Do not write skills for one-off facts/calculations');
  });
});

describe('browsercode adapter tool parsing', () => {
  it('tracks tool durations from the first tool_use event through completion', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));

    const adapter = browserCodeAdapter();
    const ctx = parseContext();

    adapter.parseLine(JSON.stringify({ type: 'step_start' }), ctx);
    const started = adapter.parseLine(JSON.stringify({
      type: 'tool_use',
      part: {
        id: 'tool-1',
        tool: 'Bash',
        input: { command: 'pwd' },
        state: { status: 'running' },
      },
    }), ctx);

    expect(started.events).toEqual([{
      type: 'tool_call',
      name: 'Bash',
      args: { preview: 'pwd', command: 'pwd' },
      iteration: 1,
    }]);

    vi.advanceTimersByTime(250);

    const finished = adapter.parseLine(JSON.stringify({
      type: 'tool_use',
      part: {
        id: 'tool-1',
        tool: 'Bash',
        state: { status: 'completed', output: 'ok' },
      },
    }), ctx);

    expect(finished.events).toEqual([{
      type: 'tool_result',
      name: 'Bash',
      ok: true,
      preview: 'ok',
      ms: 250,
    }]);
    expect(ctx.pendingTools.size).toBe(0);
  });

  it('emits a zero-duration result when BrowserCode only reports the terminal tool event', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));

    const adapter = browserCodeAdapter();
    const ctx = parseContext();

    adapter.parseLine(JSON.stringify({ type: 'step_start' }), ctx);
    const finished = adapter.parseLine(JSON.stringify({
      type: 'tool_use',
      part: {
        id: 'tool-terminal-only',
        tool: 'Bash',
        state: { status: 'completed', output: 'ok' },
      },
    }), ctx);

    expect(finished.events).toEqual([{
      type: 'tool_result',
      name: 'Bash',
      ok: true,
      preview: 'ok',
      ms: 0,
    }]);
    expect(ctx.pendingTools.size).toBe(0);
  });

  it('keeps command metadata when BrowserCode reports input only on the terminal event', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));

    const adapter = browserCodeAdapter();
    const ctx = parseContext();

    adapter.parseLine(JSON.stringify({ type: 'step_start' }), ctx);
    const finished = adapter.parseLine(JSON.stringify({
      type: 'tool_use',
      part: {
        id: 'tool-terminal-with-input',
        tool: 'Bash',
        input: { command: 'agent-skill view domain/github/scraping' },
        state: { status: 'completed', output: '# GitHub' },
      },
    }), ctx);

    expect(finished.events).toEqual([
      {
        type: 'tool_call',
        name: 'Bash',
        args: {
          preview: 'agent-skill view domain/github/scraping',
          command: 'agent-skill view domain/github/scraping',
        },
        iteration: 1,
      },
      {
        type: 'tool_result',
        name: 'Bash',
        ok: true,
        preview: '# GitHub',
        ms: 0,
      },
    ]);
    expect(ctx.pendingTools.size).toBe(0);
  });

  it('marks cancelled terminal tool events as unsuccessful', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));

    const adapter = browserCodeAdapter();
    const ctx = parseContext();

    adapter.parseLine(JSON.stringify({ type: 'step_start' }), ctx);
    adapter.parseLine(JSON.stringify({
      type: 'tool_use',
      part: {
        id: 'tool-cancelled',
        tool: 'Bash',
        input: { command: 'sleep 10' },
        state: { status: 'running' },
      },
    }), ctx);

    vi.advanceTimersByTime(500);

    const finished = adapter.parseLine(JSON.stringify({
      type: 'tool_use',
      part: {
        id: 'tool-cancelled',
        tool: 'Bash',
        state: { status: 'cancelled', output: 'cancelled by user' },
      },
    }), ctx);

    expect(finished.events).toEqual([{
      type: 'tool_result',
      name: 'Bash',
      ok: false,
      preview: 'cancelled by user',
      ms: 500,
    }]);
    expect(ctx.pendingTools.size).toBe(0);
  });
});
