/**
 * Claude Code engine adapter — wraps `claude -p` non-interactive mode.
 * Docs: https://code.claude.com/docs/en/headless
 *
 * Event shapes translated:
 *   system/init             → captures session_id (for --resume)
 *   stream_event text_delta → thinking
 *   assistant.content[] tool_use  → tool_call (with normalized args)
 *   user.content[] tool_result    → tool_result (paired by tool_use_id)
 *   result                  → done / error
 */

import { spawn } from 'node:child_process';
import { shell } from 'electron';
import { mainLogger } from '../../../logger';
import { register } from '../registry';
import type {
  AuthProbe,
  EngineAdapter,
  InstallProbe,
  ParseContext,
  ParseResult,
  SpawnContext,
} from '../types';
import type { HlEvent } from '../../../../shared/session-schemas';

const ID = 'claude-code';
const DISPLAY = 'Claude Code';
const BIN = 'claude';

// ── helpers: prompt shaping ─────────────────────────────────────────────────

function stringifyToolInput(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash' && typeof input.command === 'string') return input.command as string;
  const fp = input.file_path ?? input.path ?? input.target_file;
  if (typeof fp === 'string') {
    const extra = Object.entries(input).filter(([k]) => k !== 'file_path' && k !== 'path' && k !== 'target_file');
    if (extra.length === 0) return fp as string;
    return `${fp}\n${JSON.stringify(Object.fromEntries(extra), null, 2)}`;
  }
  return JSON.stringify(input, null, 2);
}

function stringifyToolResult(content: unknown): { text: string; isError: boolean } {
  if (typeof content === 'string') return { text: content, isError: false };
  if (Array.isArray(content)) {
    const parts = content.map((b) => {
      if (!b || typeof b !== 'object') return '';
      const bo = b as Record<string, unknown>;
      if (bo.type === 'text') return typeof bo.text === 'string' ? bo.text : '';
      if (bo.type === 'image') return '[image]';
      return JSON.stringify(bo);
    });
    return { text: parts.join('\n'), isError: false };
  }
  return { text: JSON.stringify(content), isError: false };
}

function runCli(args: string[], timeoutMs = 5000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { resolve({ ok: false, stdout: '', stderr: 'spawn failed' }); return; }
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, stdout, stderr }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, stdout, stderr }); });
  });
}

// ── adapter ─────────────────────────────────────────────────────────────────

export const claudeCodeAdapter: EngineAdapter = {
  id: ID,
  displayName: DISPLAY,
  binaryName: BIN,

  async probeInstalled(): Promise<InstallProbe> {
    const r = await runCli(['--version']);
    if (!r.ok) return { installed: false, error: r.stderr || 'claude not found on PATH' };
    const m = r.stdout.match(/(\d+\.\d+\.\d+)/);
    return { installed: true, version: m?.[1] };
  },

  async probeAuthed(): Promise<AuthProbe> {
    const r = await runCli(['auth', 'status']);
    return r.ok ? { authed: true } : { authed: false, error: r.stderr || r.stdout || 'not logged in' };
  },

  async openLoginInTerminal(): Promise<{ opened: boolean; error?: string }> {
    if (process.platform !== 'darwin') {
      shell.openExternal('https://code.claude.com/docs/en/authentication').catch(() => {});
      return { opened: false, error: 'macOS only — follow docs to run `claude login`' };
    }
    const script = `tell application "Terminal"\nactivate\ndo script "claude login"\nend tell`;
    return new Promise((resolve) => {
      const osa = spawn('osascript', ['-e', script]);
      let stderrBuf = '';
      osa.stderr.on('data', (d) => (stderrBuf += String(d)));
      osa.on('close', (code) => {
        if (code === 0) resolve({ opened: true });
        else resolve({ opened: false, error: stderrBuf.trim() || `osascript exit ${code}` });
      });
    });
  },

  wrapPrompt(ctx: SpawnContext): string {
    const lines: string[] = [
      'You are driving a specific Chromium browser view on this machine.',
      `Your target is CDP target_id=${ctx.targetId} on port ${ctx.cdpPort} (env BU_TARGET_ID / BU_CDP_PORT).`,
      'Read `./AGENTS.md` for how to drive the browser in this harness.',
      'Always read `./helpers.js` before writing scripts — that is where the functions live. Edit it if a helper is missing.',
    ];
    if (ctx.attachmentRefs.length > 0) {
      lines.push('', 'The user attached these files for this task. Read each with your Read tool before acting:');
      for (const a of ctx.attachmentRefs) lines.push(`  - ${a.relPath} (${a.mime}, ${a.size} bytes)`);
    }
    lines.push(
      '',
      `When the user asks you to produce a file (a report, CSV, screenshot, transcript, etc.), save it to \`./outputs/${ctx.sessionId}/\`. Mention the filename in your final answer.`,
      '',
      `Task: ${ctx.prompt}`,
    );
    return lines.join('\n');
  },

  buildSpawnArgs(_ctx: SpawnContext, wrappedPrompt: string): string[] {
    const args: string[] = [
      '-p',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--dangerously-skip-permissions',
    ];
    if (_ctx.resumeSessionId) args.push('--resume', _ctx.resumeSessionId);
    args.push(wrappedPrompt);
    return args;
  },

  buildEnv(ctx: SpawnContext, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env = { ...baseEnv };
    // Strip every env that outranks subscription OAuth so Keychain auth wins.
    // Precedence (per Claude Code docs): cloud-provider envs > ANTHROPIC_AUTH_TOKEN
    // > ANTHROPIC_API_KEY > apiKeyHelper > CLAUDE_CODE_OAUTH_TOKEN > subscription OAuth.
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.CLAUDE_CODE_USE_BEDROCK;
    delete env.CLAUDE_CODE_USE_VERTEX;
    delete env.CLAUDE_CODE_USE_FOUNDRY;
    if (ctx.savedApiKey) env.ANTHROPIC_API_KEY = ctx.savedApiKey;
    env.BU_TARGET_ID = ctx.targetId;
    env.BU_CDP_PORT = String(ctx.cdpPort);
    return env;
  },

  parseLine(line: string, ctx: ParseContext): ParseResult {
    let evt: unknown;
    try { evt = JSON.parse(line); } catch { return { events: [] }; }
    if (!evt || typeof evt !== 'object') return { events: [] };
    const e = evt as Record<string, unknown>;
    const type = e.type as string | undefined;
    const events: HlEvent[] = [];
    let capturedSessionId: string | undefined;
    let terminalDone = false;
    let terminalError: string | undefined;

    if (type === 'system') {
      const subtype = e.subtype as string | undefined;
      if (subtype === 'init') {
        mainLogger.info('claude-code.init', { model: e.model, session_id: e.session_id, tools: Array.isArray(e.tools) ? (e.tools as unknown[]).length : 0 });
        if (typeof e.session_id === 'string') capturedSessionId = e.session_id;
      } else if (subtype === 'api_retry') {
        mainLogger.warn('claude-code.apiRetry', { attempt: e.attempt, reason: e.reason });
      }
      return { events, capturedSessionId };
    }

    if (type === 'stream_event') {
      const inner = e.event as Record<string, unknown> | undefined;
      if (inner?.type === 'content_block_delta') {
        const delta = inner.delta as Record<string, unknown> | undefined;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          const txt = delta.text as string;
          if (txt.trim()) events.push({ type: 'thinking', text: txt });
        }
      }
      return { events };
    }

    if (type === 'assistant') {
      ctx.iter++;
      const msg = e.message as Record<string, unknown> | undefined;
      const content = msg?.content as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(content)) return { events };
      for (const block of content) {
        if (block?.type !== 'tool_use') continue;
        const id = block.id as string;
        const name = (block.name as string | undefined) ?? 'unknown';
        const input = (block.input as Record<string, unknown> | undefined) ?? {};
        ctx.pendingTools.set(id, { name, startedAt: Date.now(), iter: ctx.iter });
        events.push({
          type: 'tool_call',
          name,
          args: { preview: stringifyToolInput(name, input), ...input },
          iteration: ctx.iter,
        });
      }
      return { events };
    }

    if (type === 'user') {
      const msg = e.message as Record<string, unknown> | undefined;
      const content = msg?.content as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(content)) return { events };
      for (const block of content) {
        if (block?.type !== 'tool_result') continue;
        const tid = block.tool_use_id as string;
        const match = ctx.pendingTools.get(tid);
        const { text, isError } = stringifyToolResult(block.content);
        const ok = block.is_error !== true && !isError;
        const ms = match ? Date.now() - match.startedAt : 0;
        const name = match?.name ?? 'unknown';
        events.push({ type: 'tool_result', name, ok, preview: text.slice(0, 2000), ms });
        ctx.pendingTools.delete(tid);
      }
      return { events };
    }

    if (type === 'result') {
      const subtype = e.subtype as string | undefined;
      const resultText = (e.result as string | undefined) ?? '';
      if (subtype && subtype !== 'success') {
        terminalError = `claude_code_error: ${subtype} ${resultText}`.trim();
        events.push({ type: 'error', message: terminalError });
      } else {
        terminalDone = true;
        events.push({ type: 'done', summary: resultText || '(done)', iterations: ctx.iter });
      }
    }

    return { events, capturedSessionId, terminalDone, terminalError };
  },
};

register(claudeCodeAdapter);
