/**
 * BrowserCode engine adapter — wraps `bcode run --format json`.
 *
 * BrowserCode inherits opencode's provider/model registry. This adapter uses
 * BrowserCode only as the headless model runtime; native `browser_execute` is
 * disabled so agents use this app's Electron-scoped browser-harness-js runtime.
 */

import { register } from '../registry';
import { applyBrowserHarnessEnv } from '../browserHarnessEnv';
import { enrichedEnv } from '../pathEnrich';
import { runCliCapture } from '../cliSpawn';
import type {
  EngineAdapter,
  InstallProbe,
  AuthProbe,
  SpawnContext,
  ParseContext,
  ParseResult,
} from '../types';
import type { HlEvent } from '../../../../shared/session-schemas';
import { loadBrowserCodeConfig } from '../../../identity/authStore';

const ID = 'browsercode';
const BIN = 'bcode';
const DEFAULT_MODEL = 'moonshotai/kimi-k2.6';
const TERMINAL_TOOL_STATUSES = new Set(['completed', 'success', 'done', 'error', 'failed', 'cancelled', 'canceled']);
const FAILED_TOOL_STATUSES = new Set(['error', 'failed', 'cancelled', 'canceled']);

const CUSTOM_PROVIDER_CONFIG: Record<string, { name: string; npm: string; baseURL: string }> = {
  moonshotai: {
    name: 'Moonshot AI',
    npm: '@ai-sdk/openai-compatible',
    baseURL: 'https://api.moonshot.ai/v1',
  },
  alibaba: {
    name: 'Qwen / Alibaba',
    npm: '@ai-sdk/openai-compatible',
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  },
  minimax: {
    name: 'MiniMax',
    npm: '@ai-sdk/anthropic',
    baseURL: 'https://api.minimax.io/anthropic/v1',
  },
};

function textFromPart(part: unknown): string {
  if (!part || typeof part !== 'object') return '';
  const rec = part as Record<string, unknown>;
  return typeof rec.text === 'string' ? rec.text : '';
}

function partId(part: Record<string, unknown>): string {
  return typeof part.id === 'string' ? part.id : `${part.tool ?? 'tool'}:${Date.now()}`;
}

function toolPreview(part: Record<string, unknown>): string {
  const state = part.state && typeof part.state === 'object' ? part.state as Record<string, unknown> : {};
  const output = state.output ?? state.result ?? state.error ?? part.output ?? '';
  if (typeof output === 'string') return output.slice(0, 4000);
  try { return JSON.stringify(output).slice(0, 4000); }
  catch { return String(output).slice(0, 4000); }
}

function toolArgs(part: Record<string, unknown>, fallbackName: string): Record<string, unknown> {
  const input = part.input && typeof part.input === 'object' ? part.input as Record<string, unknown> : {};
  const preview = typeof input.command === 'string'
    ? input.command
    : Object.keys(input).length > 0
      ? JSON.stringify(input, null, 2)
      : fallbackName;
  return { preview, ...input };
}

function isTerminalToolState(part: Record<string, unknown>): boolean {
  const state = part.state && typeof part.state === 'object' ? part.state as Record<string, unknown> : {};
  const status = typeof state.status === 'string' ? state.status.toLowerCase() : null;
  if (status && TERMINAL_TOOL_STATUSES.has(status)) return true;
  return 'output' in state || 'result' in state || 'error' in state || 'output' in part;
}

function toolStateOk(state: Record<string, unknown>): boolean {
  const status = typeof state.status === 'string' ? state.status.toLowerCase() : null;
  if (status && FAILED_TOOL_STATUSES.has(status)) return false;
  return !('error' in state);
}

function providerLocalModelId(providerId: string, model: string): string {
  return model.startsWith(`${providerId}/`) ? model.slice(providerId.length + 1) : model;
}

const browserCodeAdapter: EngineAdapter = {
  id: ID,
  displayName: 'BrowserCode',
  binaryName: BIN,

  async probeInstalled(): Promise<InstallProbe> {
    const r = await runCliCapture(BIN, ['--version']);
    if (!r.ok) return { installed: false, error: r.stderr || r.error || 'bcode not found on PATH' };
    return { installed: true, version: (r.stdout || r.stderr).trim().split(/\s+/).at(-1) };
  },

  async probeAuthed(): Promise<AuthProbe> {
    const cfg = await loadBrowserCodeConfig();
    if (cfg?.apiKey && cfg.providerId) return { authed: true };
    return { authed: false, error: 'Add a BrowserCode provider API key in Settings.' };
  },

  async openLoginInTerminal(): Promise<{ opened: boolean; error?: string }> {
    return { opened: false, error: 'BrowserCode is configured with API keys in Settings.' };
  },

  buildSpawnArgs(ctx: SpawnContext): string[] {
    const model = ctx.model || DEFAULT_MODEL;
    const args = ['run', '--format', 'json', '--dangerously-skip-permissions', '--model', model];
    if (ctx.resumeSessionId) args.push('--session', ctx.resumeSessionId);
    for (const a of ctx.attachmentRefs) args.push('--file', a.relPath);
    return args;
  },

  getStdinPayload(_ctx: SpawnContext, wrappedPrompt: string): string {
    return wrappedPrompt;
  },

  buildEnv(ctx: SpawnContext, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env = enrichedEnv(baseEnv);
    env.BU_TARGET_ID = ctx.targetId;
    env.BU_CDP_PORT = String(ctx.cdpPort);
    env.DO_NOT_TRACK = env.DO_NOT_TRACK ?? '1';

    const providerId = ctx.providerId ?? 'moonshotai';
    const model = ctx.model || DEFAULT_MODEL;
    if (ctx.savedApiKey) {
      env.OPENCODE_AUTH_CONTENT = JSON.stringify({
        [providerId]: { type: 'api', key: ctx.savedApiKey },
      });
    }
    const providerConfig = CUSTOM_PROVIDER_CONFIG[providerId];
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      model,
      tools: { browser_execute: false },
      ...(providerConfig ? {
        provider: {
          [providerId]: {
            npm: providerConfig.npm,
            name: providerConfig.name,
            options: { baseURL: providerConfig.baseURL },
            models: {
              [providerLocalModelId(providerId, model)]: {
                name: providerLocalModelId(providerId, model),
              },
            },
          },
        },
      } : {}),
    });
    return applyBrowserHarnessEnv(ctx, env);
  },

  wrapPrompt(ctx: SpawnContext): string {
    const attachmentLines = ctx.attachmentRefs.length
      ? [
          '',
          'Attachments are available relative to the working directory:',
          ...ctx.attachmentRefs.map((a) => `- ./${a.relPath} (${a.mime}, ${a.size} bytes)`),
        ]
      : [];
    return [
      'You are running inside Browser Use Desktop through BrowserCode.',
      'You are driving a specific Chromium browser view on this machine.',
      `Your target is CDP target_id=${ctx.targetId} on port ${ctx.cdpPort} (env BU_TARGET_ID / BU_CDP_PORT).`,
      'Do not use BrowserCode browser_execute. Read `./AGENTS.md` and use Browser Harness JS from this working directory for browser actions.',
      "Use the `browser-harness-js` CLI for browser actions. Start with `browser-harness-js 'await connectToAssignedTarget()'`.",
      'Do not use old helpers.js convenience APIs for browser control.',
      'Do not edit harness files unless the user asks or a confirmed Browser Harness JS defect blocks the task.',
      'For terminal commands, use BrowserCode/OpenCode\'s Bash tool and write commands for the current OS/shell it reports.',
      'When producing files, save them to `./outputs/' + ctx.sessionId + '/` and mention the filename in the final answer.',
      ...attachmentLines,
      '',
      'User task:',
      ctx.prompt,
    ].join('\n');
  },

  parseLine(line: string, ctx: ParseContext): ParseResult {
    const events: HlEvent[] = [];
    let capturedSessionId: string | undefined;
    let terminalError: string | undefined;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return { events: [] };
    }

    if (typeof e.sessionID === 'string') capturedSessionId = e.sessionID;
    if (typeof e.model === 'string') ctx.currentModel = e.model;
    if (e.part && typeof e.part === 'object' && typeof (e.part as Record<string, unknown>).model === 'string') {
      ctx.currentModel = (e.part as Record<string, string>).model;
    }

    if (e.type === 'text') {
      const text = textFromPart(e.part);
      if (text.trim()) {
        ctx.lastNarrative = text.trim();
        events.push({ type: 'thinking' as const, text });
      }
    }

    if (e.type === 'reasoning') {
      const text = textFromPart(e.part);
      if (text.trim()) events.push({ type: 'thinking' as const, text });
    }

    if (e.type === 'step_start') {
      ctx.iter += 1;
    }

    if (e.type === 'step_finish' && e.part && typeof e.part === 'object') {
      const part = e.part as Record<string, unknown>;
      const tokens = part.tokens && typeof part.tokens === 'object' ? part.tokens as Record<string, unknown> : {};
      const cache = tokens.cache && typeof tokens.cache === 'object' ? tokens.cache as Record<string, unknown> : {};
      const inputTokens = typeof tokens.input === 'number' ? tokens.input : 0;
      const outputTokens = typeof tokens.output === 'number' ? tokens.output : 0;
      const cachedInputTokens = typeof cache.read === 'number' ? cache.read : 0;
      if (inputTokens > 0 || outputTokens > 0) {
        events.push({
          type: 'turn_usage',
          inputTokens,
          outputTokens,
          cachedInputTokens,
          costUsd: typeof part.cost === 'number' ? part.cost : 0,
          model: ctx.currentModel,
          source: 'exact',
        });
      }
      if (part.reason === 'stop') {
        const summary = (ctx.lastNarrative ?? '').trim() || 'Task completed';
        events.push({ type: 'done', summary, iterations: ctx.iter });
        ctx.lastNarrative = undefined;
      }
    }

    if (e.type === 'tool_use' && e.part && typeof e.part === 'object') {
      const part = e.part as Record<string, unknown>;
      const state = part.state && typeof part.state === 'object' ? part.state as Record<string, unknown> : {};
      const name = typeof part.tool === 'string' ? part.tool : 'tool';
      const id = partId(part);
      const match = ctx.pendingTools.get(id);
      const terminal = isTerminalToolState(part);

      if (!match) {
        ctx.pendingTools.set(id, { name, startedAt: Date.now(), iter: ctx.iter });
        if (!terminal) {
          events.push({
            type: 'tool_call' as const,
            name,
            args: toolArgs(part, name),
            iteration: ctx.iter,
          });
        }
      }

      if (terminal) {
        const completedMatch = ctx.pendingTools.get(id);
        const startedAt = completedMatch?.startedAt ?? Date.now();
        ctx.pendingTools.delete(id);
        events.push({
          type: 'tool_result' as const,
          name: completedMatch?.name ?? name,
          ok: toolStateOk(state),
          preview: toolPreview(part),
          ms: Math.max(0, Date.now() - startedAt),
        });
      }
    }

    if (e.type === 'error') {
      const error = e.error as Record<string, unknown> | undefined;
      const msg = typeof error?.message === 'string' ? error.message : JSON.stringify(e.error ?? e);
      terminalError = `browsercode_error: ${msg}`;
      events.push({ type: 'error' as const, message: terminalError });
    }

    return { events, capturedSessionId, terminalError };
  },
};

register(browserCodeAdapter);
