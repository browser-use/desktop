import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { WebContents } from 'electron';
import type { EngineAdapter, ParseContext, ParseResult, SpawnContext } from '../../../src/main/hl/engines/types';
import type { HlEvent } from '../../../src/shared/session-schemas';

const mockState = vi.hoisted(() => {
  const fsMod = require('node:fs') as typeof import('node:fs');
  const osMod = require('node:os') as typeof import('node:os');
  const pathMod = require('node:path') as typeof import('node:path');
  return {
    userData: fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'bu-run-engine-')),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return mockState.userData;
      return mockState.userData;
    }),
  },
}));

vi.mock('../../../src/main/identity/authStore', () => ({
  resolveAuth: vi.fn(async () => null),
  loadOpenAIKey: vi.fn(async () => null),
  loadClaudeSubscriptionType: vi.fn(async () => null),
}));

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

describe('runEngine harness watcher', () => {
  let harnessDir: string;

  beforeEach(() => {
    harnessDir = prepareHarness();
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
});
