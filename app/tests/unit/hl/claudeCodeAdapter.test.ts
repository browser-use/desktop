import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineAdapter, SpawnContext } from '../../../src/main/hl/engines/types';

const cliSpawnMocks = vi.hoisted(() => ({
  runCliCapture: vi.fn(),
  spawnCli: vi.fn(),
}));

vi.mock('../../../src/main/logger', () => ({
  mainLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/main/hl/engines/cliSpawn', () => cliSpawnMocks);
vi.mock('../../../src/main/hl/engines/pathEnrich', () => ({
  enrichedEnv: vi.fn((env?: NodeJS.ProcessEnv) => env ?? process.env),
}));

async function claudeCodeAdapter(): Promise<EngineAdapter> {
  const { get } = await import('../../../src/main/hl/engines/registry');
  await import('../../../src/main/hl/engines/claude-code/adapter');
  const adapter = get('claude-code');
  if (!adapter) throw new Error('claude-code adapter not registered');
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

describe('claude-code adapter auth probing', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('surfaces transport failures from runCliCapture during auth probing', async () => {
    cliSpawnMocks.runCliCapture.mockResolvedValue({
      ok: false,
      stdout: '',
      stderr: '',
      error: 'Timed out after 50ms',
      code: null,
    });

    const adapter = await claudeCodeAdapter();

    await expect(adapter.probeAuthed()).resolves.toEqual({
      authed: false,
      error: 'Timed out after 50ms',
    });
  });
});

describe('claude-code adapter spawn args', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('uses Claude Code stream-json mode and --resume for paused sessions', async () => {
    const adapter = await claudeCodeAdapter();
    const ctx = spawnContext('claude-session-123');
    const wrappedPrompt = adapter.wrapPrompt(ctx);

    expect(adapter.buildSpawnArgs(ctx, wrappedPrompt)).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--dangerously-skip-permissions',
      '--resume',
      'claude-session-123',
      wrappedPrompt,
    ]);
  });

  it('injects skill lifecycle guidance into the provider prompt', async () => {
    const adapter = await claudeCodeAdapter();
    const wrappedPrompt = adapter.wrapPrompt(spawnContext());

    expect(wrappedPrompt).toContain('likely to repeat, long-running enough to justify reuse, or generally applicable');
    expect(wrappedPrompt).toContain('Do not write skills for one-off facts/calculations');
  });
});
