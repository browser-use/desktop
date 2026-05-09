import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { WebContents } from 'electron';
import type { EngineAdapter, EngineRunControl, ParseContext, ParseResult, SpawnContext } from '../../../src/main/hl/engines/types';
import type { HlEvent } from '../../../src/shared/session-schemas';

const mockState = vi.hoisted(() => {
  const fsMod = require('node:fs') as typeof import('node:fs');
  const osMod = require('node:os') as typeof import('node:os');
  const pathMod = require('node:path') as typeof import('node:path');
  return {
    userData: fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'bu-run-engine-')),
  };
});

const authMocks = vi.hoisted(() => ({
  resolveAuth: vi.fn(async (): Promise<unknown> => null),
  loadOpenAIKey: vi.fn(async (): Promise<string | null> => null),
  loadClaudeSubscriptionType: vi.fn(async (): Promise<string | null> => null),
  loadBrowserCodeConfig: vi.fn(async (): Promise<unknown> => null),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return mockState.userData;
      return mockState.userData;
    }),
  },
}));

vi.mock('../../../src/main/identity/authStore', () => authMocks);

const { register } = await import('../../../src/main/hl/engines/registry');
const { runEngine } = await import('../../../src/main/hl/engines/runEngine');

function createWebContents() {
  return {
    debugger: {
      isAttached: vi.fn(() => false),
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand: vi.fn(async () => ({ targetInfo: { targetId: 'target-1' } })),
    },
  };
}

function prepareHarness(): string {
  const harnessDir = path.join(mockState.userData, 'harness');
  fs.rmSync(harnessDir, { recursive: true, force: true });
  fs.mkdirSync(harnessDir, { recursive: true });
  fs.writeFileSync(path.join(harnessDir, 'helpers.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(harnessDir, 'TOOLS.json'), '{}\n');
  fs.writeFileSync(path.join(harnessDir, 'AGENTS.md'), '# Harness\n');
  return harnessDir;
}

function registerFakeEngine(script: string, parseLine: (line: string, ctx: ParseContext) => ParseResult): string {
  const id = `harness-watch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const adapter: EngineAdapter = {
    id,
    displayName: 'Harness Watch Test',
    binaryName: process.execPath,
    async probeInstalled() { return { installed: true }; },
    async probeAuthed() { return { authed: true }; },
    async openLoginInTerminal() { return { opened: false }; },
    buildSpawnArgs() { return ['-e', script]; },
    buildEnv(_ctx: SpawnContext, baseEnv: NodeJS.ProcessEnv) { return baseEnv; },
    wrapPrompt(ctx: SpawnContext) { return ctx.prompt; },
    parseLine,
  };
  register(adapter);
  return id;
}

async function runFakeEngine(engineId: string, harnessDir: string): Promise<HlEvent[]> {
  const events: HlEvent[] = [];
  await runEngine({
    engineId,
    prompt: 'test',
    sessionId: 'test-session',
    webContents: createWebContents() as unknown as WebContents,
    cdpPort: 9222,
    harnessDir,
    onEvent: (event) => events.push(event),
  });
  return events;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(read: () => T | undefined, timeoutMs = 1000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition');
    await sleep(10);
  }
}

describe('runEngine harness watcher', () => {
  let harnessDir: string;

  beforeEach(() => {
    harnessDir = prepareHarness();
    authMocks.resolveAuth.mockResolvedValue(null);
    authMocks.loadOpenAIKey.mockResolvedValue(null);
    authMocks.loadClaudeSubscriptionType.mockResolvedValue(null);
    authMocks.loadBrowserCodeConfig.mockResolvedValue(null);
  });

  afterAll(() => {
    fs.rmSync(mockState.userData, { recursive: true, force: true });
  });

  test('emits harness_edited from an actual helpers.js content change before done', async () => {
    const script = [
      "const fs = require('node:fs');",
      "fs.appendFileSync('helpers.js', '\\n// changed by fake engine\\n');",
      "console.log(JSON.stringify({ type: 'done' }));",
    ].join('\n');
    const engineId = registerFakeEngine(script, (line) => {
      const event = JSON.parse(line) as { type?: string };
      if (event.type === 'done') return { events: [{ type: 'done', summary: 'ok', iterations: 1 }] };
      return { events: [] };
    });

    const events = await runFakeEngine(engineId, harnessDir);

    const harnessIndex = events.findIndex((event) => event.type === 'harness_edited');
    const doneIndex = events.findIndex((event) => event.type === 'done');
    expect(harnessIndex).toBeGreaterThanOrEqual(0);
    expect(doneIndex).toBeGreaterThan(harnessIndex);
    expect(events[harnessIndex]).toMatchObject({
      type: 'harness_edited',
      target: 'helpers',
      action: 'patch',
      path: path.join(harnessDir, 'helpers.js'),
    });
  });

  test('does not emit harness_edited for tool metadata when file content is unchanged', async () => {
    const script = [
      "console.log(JSON.stringify({ type: 'tool' }));",
      "console.log(JSON.stringify({ type: 'done' }));",
    ].join('\n');
    const engineId = registerFakeEngine(script, (line) => {
      const event = JSON.parse(line) as { type?: string };
      if (event.type === 'tool') {
        return {
          events: [{
            type: 'tool_call',
            name: 'edit',
            args: { file_path: 'helpers.js' },
            iteration: 1,
          }],
        };
      }
      if (event.type === 'done') return { events: [{ type: 'done', summary: 'ok', iterations: 1 }] };
      return { events: [] };
    });

    const events = await runFakeEngine(engineId, harnessDir);

    expect(events.some((event) => event.type === 'tool_call')).toBe(true);
    expect(events.some((event) => event.type === 'harness_edited')).toBe(false);
  });

  test.skipIf(process.platform === 'win32')('exposes live pause and resume controls for the spawned process group', async () => {
    const script = [
      'let i = 0;',
      "const interval = setInterval(() => console.log(JSON.stringify({ type: 'tick', i: ++i })), 40);",
      "setTimeout(() => { clearInterval(interval); console.log(JSON.stringify({ type: 'done' })); }, 650);",
    ].join('\n');
    const engineId = registerFakeEngine(script, (line) => {
      const event = JSON.parse(line) as { type?: string; i?: number };
      if (event.type === 'tick') return { events: [{ type: 'thinking', text: String(event.i ?? '') }] };
      if (event.type === 'done') return { events: [{ type: 'done', summary: 'ok', iterations: 1 }] };
      return { events: [] };
    });
    const events: HlEvent[] = [];
    let control: EngineRunControl | undefined;

    const run = runEngine({
      engineId,
      prompt: 'test',
      sessionId: 'test-session',
      webContents: createWebContents() as unknown as WebContents,
      cdpPort: 9222,
      harnessDir,
      onRunControl: (next) => { control = next; },
      onEvent: (event) => events.push(event),
    });

    const runControl = await waitFor(() => control);
    await waitFor(() => events.filter((event) => event.type === 'thinking').length >= 2 ? true : undefined);

    expect(runControl.pause()).toEqual({ paused: true });
    await sleep(120);
    const pausedCount = events.filter((event) => event.type === 'thinking').length;
    await sleep(160);
    expect(events.filter((event) => event.type === 'thinking')).toHaveLength(pausedCount);

    expect(runControl.resume()).toEqual({ resumed: true });
    await run;
    expect(events.some((event) => event.type === 'done')).toBe(true);
  });

  test('passes BrowserCode provider/model config through the generic spawn context', async () => {
    authMocks.loadBrowserCodeConfig.mockResolvedValue({
      providerId: 'alibaba',
      model: 'alibaba/qwen3-coder-plus',
      apiKey: 'test-browsercode-key',
    });
    const seenContexts: SpawnContext[] = [];
    const adapter: EngineAdapter = {
      id: 'browsercode',
      displayName: 'BrowserCode Test',
      binaryName: process.execPath,
      async probeInstalled() { return { installed: true }; },
      async probeAuthed() { return { authed: false }; },
      async openLoginInTerminal() { return { opened: false }; },
      buildSpawnArgs(ctx: SpawnContext) {
        seenContexts.push(ctx);
        return ['-e', "console.log(JSON.stringify({ type: 'done' }));"];
      },
      buildEnv(_ctx: SpawnContext, baseEnv: NodeJS.ProcessEnv) { return baseEnv; },
      wrapPrompt(ctx: SpawnContext) { return ctx.prompt; },
      parseLine(line) {
        const event = JSON.parse(line) as { type?: string };
        if (event.type === 'done') return { events: [{ type: 'done', summary: 'ok', iterations: 1 }] };
        return { events: [] };
      },
    };
    register(adapter);
    const resolvedModels: Array<{ model: string; source: 'config' | 'engine' }> = [];

    await runEngine({
      engineId: 'browsercode',
      prompt: 'test',
      sessionId: 'test-session',
      webContents: createWebContents() as unknown as WebContents,
      cdpPort: 9222,
      harnessDir,
      onEvent: () => undefined,
      onModelResolved: (info) => resolvedModels.push(info),
    });

    expect(seenContexts[0]).toMatchObject({
      providerId: 'alibaba',
      model: 'alibaba/qwen3-coder-plus',
      savedApiKey: 'test-browsercode-key',
    });
    expect(resolvedModels).toEqual([{ model: 'alibaba/qwen3-coder-plus', source: 'config' }]);
  });
});
