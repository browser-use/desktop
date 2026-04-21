/**
 * LLM-driven agent loop — Claude Opus 4.7 + tool use + streaming + prompt caching.
 *
 * Model: `claude-opus-4-7` (override via HL_MODEL env var).
 * Cache: the system prompt AND the tools block both carry cache_control: ephemeral
 *   breakpoints, so the 2nd+ iterations within a task (and across tasks in the
 *   same cache window) hit prompt cache for everything up to and including the
 *   tools block.
 * Stream: uses `client.messages.stream(...)` so partial text emits as `thinking`
 *   events while the model writes; the final Message (with tool_use blocks) is
 *   awaited via `stream.finalMessage()` before we dispatch tools.
 *
 * Safety bound: MAX_ITERATIONS (200) prevents runaway loops. An AbortSignal cancels the in-flight request.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam, MessageCreateParamsNonStreaming, Tool, ContentBlock, ToolUseBlock,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import fs from 'node:fs';
import path from 'node:path';
import type { HlContext } from './context';
import { loadHarness, helpersPath, toolsPath } from './harness';
import { mainLogger } from '../logger';

const SKILL_PATH_RE = /(?:domain-skills|interaction-skills)\/([^/]+)\/([^/]+)\.md$/;

function diffToolNames(prev: string | null, next: string): { added: string[]; removed: string[]; changed: string[] } {
  if (prev === null || prev === next) return { added: [], removed: [], changed: [] };
  try {
    const parse = (s: string) => JSON.parse(s) as Array<{ name: string; description: string; input_schema: unknown }>;
    const a = parse(prev); const b = parse(next);
    const aMap = new Map(a.map((t) => [t.name, JSON.stringify({ d: t.description, s: t.input_schema })]));
    const bMap = new Map(b.map((t) => [t.name, JSON.stringify({ d: t.description, s: t.input_schema })]));
    const added = [...bMap.keys()].filter((n) => !aMap.has(n));
    const removed = [...aMap.keys()].filter((n) => !bMap.has(n));
    const changed = [...bMap.keys()].filter((n) => aMap.has(n) && aMap.get(n) !== bMap.get(n));
    return { added, removed, changed };
  } catch {
    return { added: [], removed: [], changed: [] };
  }
}

const DEFAULT_MODEL = process.env.HL_MODEL ?? 'claude-opus-4-7';
const MAX_TOKENS = parseInt(process.env.HL_MAX_TOKENS ?? '4096', 10);
const MAX_ITERATIONS = parseInt(process.env.HL_MAX_ITERATIONS ?? '200', 10);

export type HlEvent =
  | { type: 'thinking';   text: string }
  | { type: 'tool_call';  name: string; args: unknown; iteration: number }
  | { type: 'tool_result';name: string; ok: boolean; preview: string; ms: number }
  | { type: 'done';       summary: string; iterations: number }
  | { type: 'error';      message: string }
  | { type: 'user_input'; text: string }
  | { type: 'skill_written'; path: string; domain: string; topic: string; bytes: number }
  | { type: 'skill_used'; path: string; domain?: string; topic: string }
  | { type: 'harness_edited'; target: 'helpers' | 'tools'; action: 'write' | 'patch'; path: string; added?: string[]; removed?: string[]; changed?: string[] }
  | { type: 'notify'; message: string; level: 'info' | 'blocking' };

export interface AgentAttachment {
  name: string;
  mime: string;
  bytes: Buffer | Uint8Array;
}

export type RunAgentAuth =
  | { type: 'apiKey'; value: string }
  | { type: 'oauth'; value: string };

export interface RunAgentOptions {
  ctx: HlContext;
  prompt: string;
  /** API key (sk-ant-api03-...) or, for OAuth, Bearer token (sk-ant-oat01-...). */
  apiKey?: string;
  auth?: RunAgentAuth;
  signal?: AbortSignal;
  onEvent: (e: HlEvent) => void;
  model?: string;
  priorMessages?: MessageParam[];
  drainQueue?: () => string | null;
  attachments?: AgentAttachment[];
}

const SYSTEM_PROMPT = `You control a Chromium tab via CDP-backed tools AND have full local filesystem + shell access.
You are working inside a desktop browser app; the attached tab is the user's current tab.

## What actually works

- **Screenshots first**: use screenshot() to understand the current page quickly, find visible targets, and decide next.
- **Clicking**: screenshot() → look → click(x, y) → screenshot() again to verify. Coordinate clicks pass through iframes/shadow/cross-origin at the compositor level.
- **Before clicking**: use js() with getBoundingClientRect() to get accurate coords. Do not eyeball from screenshots.
- **Bulk HTTP**: http_get(url) for static pages/APIs — much faster than loading in a tab.
- **After goto**: wait_for_load().
- **Wrong/stale tab**: ensure_real_tab(). Use it when the current tab is stale or internal.
- **Verification**: page_info() is the simplest "is this alive?" check, but screenshots are the default way to verify.
- **DOM reads**: use js(...) for inspection and extraction when screenshots show coordinates are the wrong tool.
- **Iframe sites**: click(x, y) passes through; only drop to iframe DOM work when coordinate clicks are the wrong tool.
- **Auth wall**: redirected to login → call notify({message: "Please log in to <site>", level: "blocking"}). Don't type credentials.
- **Raw CDP** for anything helpers don't cover: cdp("Domain.method", params).

## Browser interaction details

- For React-controlled inputs, type_text may be overwritten — use react_set_value instead.
- For special keys (Enter, Tab), if press_key does not trigger the DOM listener, fall back to dispatch_key.
- Call capture_dialogs BEFORE any action that might open alert/confirm/prompt — otherwise the page JS thread freezes.
- capture_dialogs stubs are lost on navigation — re-call after goto().
- For cross-origin iframes, use iframe_target then js(expr, target_id). Same-origin nested iframes are NOT CDP targets — walk contentDocument.
- Shadow DOM: querySelector does NOT pierce — walk element.shadowRoot recursively.
- First navigation should be new_tab(url), not goto(url) — goto runs in the user's active tab and clobbers their work.

## Skills

- When goto() returns domain_skills, read the listed skill files before proceeding — they contain site-specific selectors, APIs, and traps.
- Search domain-skills/ first for the domain you are working on before inventing a new approach.
- If you struggle with a specific mechanic, check interaction-skills/ for helpers (dialogs, dropdowns, iframes, shadow-dom, uploads, etc.).
- Use shell to search skills: shell({command: "ls domain-skills/"}) or shell({command: "cat domain-skills/github/navigation.md"}).

## Always contribute back

If you learned anything non-obvious about how a site works, write it to domain-skills/<site>/<topic>.md before calling done.
Worth capturing: private APIs, stable selectors, framework quirks, URL patterns, waits that wait_for_load() misses, traps.
Do NOT write: raw pixel coordinates, run narration, secrets/cookies, or user-specific state.

## Filesystem + shell

- You can read, write, and patch files on the local machine via read_file, write_file, patch_file.
- You can list directories via list_dir and run shell commands via shell.
- You can edit your own tool source code (this harness) at runtime — see the "Your source code" section below for the exact path. Edits take effect on the very next iteration.
- Use patch_file for surgical edits (find-and-replace); use write_file for new files or full rewrites.
- Use shell for git, build commands, grep, or any CLI tool.

## General

- After every meaningful action, re-screenshot before assuming it worked.
- Prefer compositor-level actions over framework hacks.
- Use notify({level: "blocking"}) when you need user action (login, CAPTCHA, ambiguous choice). Use notify({level: "info"}) for non-blocking FYI messages. Keep messages short and actionable.
- Call the \`done\` tool with a short user-facing summary when the task is complete.
- Be concise. Act, don't narrate.`;

function previewResult(r: unknown, limit = 240): string {
  try {
    const s = typeof r === 'string' ? r : JSON.stringify(r);
    return s.length > limit ? s.slice(0, limit) + '…' : s;
  } catch { return String(r).slice(0, limit); }
}

function asTools(loaded: import('./harness').HarnessTool[]): Tool[] {
  const tools: Tool[] = loaded.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
  if (tools.length === 0) return tools;
  // Prompt-caching breakpoint on the last tool — caches everything up through tools.
  // Cache invalidates when the tools array changes, which is acceptable: an agent
  // edit to TOOLS.json is significant enough to re-cache.
  const last = tools[tools.length - 1] as Tool & { cache_control?: { type: 'ephemeral' } };
  last.cache_control = { type: 'ephemeral' };
  return tools;
}

type UserContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } };

function buildFirstUserContent(prompt: string, attachments?: AgentAttachment[]): string | UserContentBlock[] {
  if (!attachments || attachments.length === 0) return prompt;
  const blocks: UserContentBlock[] = [];
  const textPrefixParts: string[] = [];
  for (const a of attachments) {
    const buf = a.bytes instanceof Buffer ? a.bytes : Buffer.from(a.bytes);
    if (a.mime === 'image/png' || a.mime === 'image/jpeg' || a.mime === 'image/gif' || a.mime === 'image/webp') {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: a.mime, data: buf.toString('base64') } });
    } else if (a.mime === 'application/pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
    } else {
      // Text-ish: inline as <file> block in the prompt prefix.
      const text = buf.toString('utf-8');
      textPrefixParts.push(`<file name="${a.name}" mime="${a.mime}">\n${text}\n</file>`);
    }
  }
  const finalText = textPrefixParts.length > 0 ? `${textPrefixParts.join('\n\n')}\n\n${prompt}` : prompt;
  blocks.push({ type: 'text', text: finalText });
  return blocks;
}

export async function runAgent(opts: RunAgentOptions): Promise<MessageParam[]> {
  const { ctx, prompt, apiKey, auth, signal, onEvent } = opts;

  // Resolve auth: explicit auth object takes precedence, else fall back to
  // apiKey, auto-detecting OAuth tokens by their sk-ant-oat prefix.
  const resolvedAuth: RunAgentAuth =
    auth ??
    (apiKey
      ? { type: apiKey.startsWith('sk-ant-oat') ? 'oauth' : 'apiKey', value: apiKey }
      : (() => { throw new Error('runAgent: no auth provided'); })());

  const client =
    resolvedAuth.type === 'oauth'
      ? new Anthropic({
          authToken: resolvedAuth.value,
          defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
        })
      : new Anthropic({ apiKey: resolvedAuth.value });
  const firstContent = buildFirstUserContent(prompt, opts.attachments);
  if (opts.attachments && opts.attachments.length > 0) {
    mainLogger.info('hl.agent.attachments', {
      count: opts.attachments.length,
      mimes: opts.attachments.map((a) => a.mime),
      totalBytes: opts.attachments.reduce((s, a) => s + (a.bytes instanceof Buffer ? a.bytes.byteLength : a.bytes.byteLength), 0),
    });
  }
  const messages: MessageParam[] = [
    ...(opts.priorMessages ?? []),
    { role: 'user', content: firstContent as MessageParam['content'] },
  ];
  const model = opts.model ?? DEFAULT_MODEL;

  // System prompt includes the absolute path to the editable harness so the
  // agent knows where its own source lives. Appended to the static prose so
  // the majority of the prompt still hits the prompt cache.
  const harnessInfo = `\n\n## Your source code (editable harness)\n\n` +
    `Your tool implementations live at:\n` +
    `  helpers: ${helpersPath()}\n` +
    `  schemas: ${toolsPath()}\n\n` +
    `If a helper is missing, broken, or you need a new one, use \`write_file\` or \`patch_file\` ` +
    `to edit helpers.js and append/modify the matching schema in TOOLS.json. Both take effect ` +
    `on the very next iteration. Export every helper via \`module.exports.dispatch.<tool_name>\`.`;
  const system: MessageCreateParamsNonStreaming['system'] = [
    { type: 'text', text: SYSTEM_PROMPT + harnessInfo, cache_control: { type: 'ephemeral' } },
  ];

  for (let iter = 1; ; iter++) {
    if (iter > MAX_ITERATIONS) {
      mainLogger.warn('hl.agent.maxIterations', { iter, max: MAX_ITERATIONS });
      onEvent({ type: 'done', summary: `Reached maximum iterations (${MAX_ITERATIONS})`, iterations: iter });
      return messages;
    }
    if (signal?.aborted) { onEvent({ type: 'done', summary: 'Halted by user', iterations: iter }); return messages; }

    const queued = opts.drainQueue?.() ?? null;
    if (queued) {
      mainLogger.info('hl.agent.steer', { iter, promptLength: queued.length });
      onEvent({ type: 'user_input', text: queued });
      const last = messages[messages.length - 1];
      if (last?.role === 'user') {
        const existing = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
        last.content = existing + '\n\n[User interruption]: ' + queued;
      } else {
        messages.push({ role: 'user', content: '[User interruption]: ' + queued });
      }
    }

    mainLogger.info('hl.agent.iter', { iter, model, ctx: ctx.name, messages: messages.length });

    // Hot-reload helpers + TOOLS.json from disk every iteration — agent edits
    // land immediately. If the JS is malformed or TOOLS.json is broken, fail
    // this iteration with a clear error instead of crashing the whole loop.
    let harness: ReturnType<typeof loadHarness>;
    try {
      harness = loadHarness();
    } catch (err) {
      const msg = (err as Error).message ?? 'harness_load_error';
      mainLogger.error('hl.agent.harnessLoadFailed', { error: msg, iter });
      onEvent({ type: 'error', message: `harness_load_error: ${msg}` });
      return messages;
    }
    const tools = asTools(harness.tools);
    // Snapshot TOOLS.json at iteration start for diffing after write/patch calls.
    let toolsJsonBefore: string | null = null;
    try { toolsJsonBefore = fs.readFileSync(toolsPath(), 'utf-8'); } catch { /* file gone */ }

    let finalMsg: { content: ContentBlock[]; stop_reason: string | null; usage?: unknown };
    try {
      const stream = client.messages.stream(
        { model, max_tokens: MAX_TOKENS, system, tools, messages },
        { signal },
      );
      // Emit partial text as 'thinking' events as the model streams.
      stream.on('text', (delta: string) => {
        if (delta.trim()) onEvent({ type: 'thinking', text: delta });
      });
      finalMsg = await stream.finalMessage();
    } catch (err) {
      const msg = (err as Error).message ?? 'anthropic_error';
      mainLogger.error('hl.agent.apiError', { error: msg, iter });
      onEvent({ type: 'error', message: `api_error: ${msg}` });
      return messages;
    }

    // Cache-hit telemetry (not user-facing; shows the breakpoints are doing work).
    const u = finalMsg.usage as { cache_creation_input_tokens?: number; cache_read_input_tokens?: number } | undefined;
    if (u) mainLogger.info('hl.agent.cache', { iter, cache_read: u.cache_read_input_tokens ?? 0, cache_create: u.cache_creation_input_tokens ?? 0 });

    mainLogger.info('hl.agent.response', {
      iter,
      stop_reason: finalMsg.stop_reason,
      content_blocks: finalMsg.content.length,
      types: finalMsg.content.map((b) => b.type),
    });

    // If no tool call, model ended its turn — treat the assistant text as the summary.
    if (finalMsg.stop_reason !== 'tool_use') {
      const text = finalMsg.content
        .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n').trim();
      onEvent({ type: 'done', summary: text || '(no response)', iterations: iter });
      return messages;
    }

    // Execute every tool_use block; gather tool_result blocks for the next turn.
    const toolResults: ToolResultBlockParam[] = [];
    let doneSummary: string | null = null;

    for (const block of finalMsg.content) {
      if (block.type !== 'tool_use') continue;
      const tu = block as ToolUseBlock;
      const args = (tu.input ?? {}) as Record<string, unknown>;
      onEvent({ type: 'tool_call', name: tu.name, args, iteration: iter });

      mainLogger.info('hl.agent.toolDispatch', { iter, tool: tu.name, id: tu.id });
      const t0 = Date.now();

      try {
        const r = await harness.dispatch(ctx, tu.name, args);
        const preview = previewResult(r);
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: preview });
        onEvent({ type: 'tool_result', name: tu.name, ok: true, preview, ms: Date.now() - t0 });
        if (tu.name === 'done' && r && typeof r === 'object' && 'summary' in r) {
          doneSummary = String((r as { summary: unknown }).summary);
        }
        if ((tu.name === 'write_file' || tu.name === 'patch_file') && r && typeof r === 'object' && 'path' in r) {
          const writtenPath = path.resolve(String((r as { path: string }).path));
          const skillMatch = writtenPath.match(SKILL_PATH_RE);
          if (skillMatch) {
            const rObj = r as Record<string, unknown>;
            const bytes = typeof rObj.bytes === 'number' ? rObj.bytes : 0;
            onEvent({ type: 'skill_written', path: writtenPath, domain: skillMatch[1], topic: skillMatch[2], bytes });
          }
          const action = tu.name === 'patch_file' ? 'patch' : 'write';
          if (writtenPath === path.resolve(helpersPath())) {
            onEvent({ type: 'harness_edited', target: 'helpers', action, path: writtenPath });
          } else if (writtenPath === path.resolve(toolsPath())) {
            let toolsJsonAfter: string | null = null;
            try { toolsJsonAfter = fs.readFileSync(toolsPath(), 'utf-8'); } catch { /* gone */ }
            const diff = toolsJsonAfter ? diffToolNames(toolsJsonBefore, toolsJsonAfter) : { added: [], removed: [], changed: [] };
            onEvent({
              type: 'harness_edited',
              target: 'tools',
              action,
              path: writtenPath,
              added: diff.added.length ? diff.added : undefined,
              removed: diff.removed.length ? diff.removed : undefined,
              changed: diff.changed.length ? diff.changed : undefined,
            });
            toolsJsonBefore = toolsJsonAfter;
          }
        }
        if (tu.name === 'read_file' && typeof args.path === 'string') {
          const m = args.path.match(SKILL_PATH_RE);
          if (m) onEvent({ type: 'skill_used', path: args.path, domain: m[1], topic: m[2] });
        }
        if (tu.name === 'goto' && r && typeof r === 'object' && 'domain_skills' in r) {
          const skills = (r as { domain_skills?: unknown }).domain_skills;
          if (Array.isArray(skills)) {
            for (const s of skills) {
              if (typeof s === 'string') {
                const topic = s.replace(/\.md$/, '');
                onEvent({ type: 'skill_used', path: s, topic });
              }
            }
          }
        }
        if (tu.name === 'notify' && r && typeof r === 'object' && 'message' in r) {
          const n = r as { message: string; level: string };
          const level = n.level === 'blocking' ? 'blocking' as const : 'info' as const;
          onEvent({ type: 'notify', message: n.message, level });
          if (level === 'blocking') {
            onEvent({ type: 'done', summary: `Blocked: ${n.message}`, iterations: iter });
            return messages;
          }
        }
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `error: ${msg}`, is_error: true });
        onEvent({ type: 'tool_result', name: tu.name, ok: false, preview: msg, ms: Date.now() - t0 });
      }
    }

    if (doneSummary !== null) { onEvent({ type: 'done', summary: doneSummary, iterations: iter }); return messages; }

    messages.push({ role: 'assistant', content: finalMsg.content });
    messages.push({ role: 'user', content: toolResults });
  }
}
