import { describe, expect, it } from 'vitest';
import { runCliCapture, spawnCli } from '../../../src/main/hl/engines/cliSpawn';

const onWindows = process.platform === 'win32';

describe.skipIf(onWindows)('runCliCapture timeout handling', () => {
  it('resolves after the timeout even when the child ignores SIGTERM', async () => {
    const script = [
      "process.on('SIGTERM', () => {});",
      "setInterval(() => {}, 1000);",
    ].join('\n');

    const startedAt = Date.now();
    const result = await Promise.race([
      runCliCapture(process.execPath, ['-e', script], 50),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('runCliCapture timed out in test')), 3000)),
    ]);
    const elapsedMs = Date.now() - startedAt;

    expect(result).toMatchObject({
      ok: false,
      error: 'Timed out after 50ms',
    });
    expect(elapsedMs).toBeLessThan(3000);
  });
});

describe('spawnCli executable validation', () => {
  it('rejects shell metacharacters in executable names before spawning', () => {
    expect(() => spawnCli('codex;rm', [])).toThrow(/unsupported executable name/);
    expect(() => spawnCli('codex\nrm', [])).toThrow(/unsafe executable name/);
  });
});
