import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyBrowserHarnessEnv, browserHarnessReplPort } from '../../../src/main/hl/engines/browserHarnessEnv';
import type { SpawnContext } from '../../../src/main/hl/engines/types';

function spawnContext(targetId: string): SpawnContext {
  return {
    prompt: 'Open example.com',
    harnessDir: '/tmp/harness',
    sessionId: 'session-123',
    targetId,
    cdpPort: 9222,
    attachmentRefs: [],
  };
}

describe('browser harness environment', () => {
  it('scopes the REPL port to the assigned target as well as the app session', () => {
    const firstTarget = browserHarnessReplPort('session-123', 'target-a');
    const secondTarget = browserHarnessReplPort('session-123', 'target-b');

    expect(browserHarnessReplPort('session-123', 'target-a')).toBe(firstTarget);
    expect(secondTarget).not.toBe(firstTarget);
  });

  it('gives reruns with a replacement browser target a fresh REPL port', () => {
    const firstEnv = applyBrowserHarnessEnv(spawnContext('old-target'), {});
    const rerunEnv = applyBrowserHarnessEnv(spawnContext('new-target'), {});

    expect(firstEnv.CDP_REPL_PORT).toBe(browserHarnessReplPort('session-123', 'old-target'));
    expect(rerunEnv.CDP_REPL_PORT).toBe(browserHarnessReplPort('session-123', 'new-target'));
    expect(rerunEnv.CDP_REPL_PORT).not.toBe(firstEnv.CDP_REPL_PORT);
  });

  it('preserves an explicit REPL port override', () => {
    const env = applyBrowserHarnessEnv(spawnContext('target-a'), { CDP_REPL_PORT: '9876' });

    expect(env.CDP_REPL_PORT).toBe('9876');
  });

  it('puts provider-neutral agent-skill and Browser Harness JS CLIs on PATH', () => {
    const env = applyBrowserHarnessEnv(spawnContext('target-a'), { PATH: '/usr/bin' });

    expect(env.PATH?.split(path.delimiter).slice(0, 3)).toEqual([
      '/tmp/harness/agent-skill',
      '/tmp/harness/browser-harness-js/sdk',
      '/usr/bin',
    ]);
  });
});
