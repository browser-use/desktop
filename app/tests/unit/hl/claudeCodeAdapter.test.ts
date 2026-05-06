import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineAdapter } from '../../../src/main/hl/engines/types';

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
