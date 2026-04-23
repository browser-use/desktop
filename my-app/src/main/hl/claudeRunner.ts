/**
 * runClaudeAgent — spawns `claude -p` as a subprocess, feeds it the user's
 * prompt, parses the stream-json stdout, and bridges events to HlEvent.
 *
 * The subprocess uses Claude Code's own tools (bash, read, write, edit,
 * apply_patch). It reads SKILL.md + helpers.js from `cwd` (the harness dir)
 * and drives the session's assigned browser view via port-9222 CDP.
 *
 * No tool schema is passed. No MCP server is run. The agent writes scripts
 * and runs them via its own shell tool.
 *
 * Auth: the spawned subprocess inherits the user's Keychain login via
 * Electron's process env. ANTHROPIC_API_KEY is stripped so subscription
 * auth takes precedence (per Claude Code's auth precedence order).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { type WebContents } from 'electron';
import { mainLogger } from '../logger';
import type { HlEvent } from '../../shared/session-schemas';
import { helpersPath, toolsPath } from './harness';
import { resolveAuth } from '../identity/authStore';
import path from 'node:path';

const SKILL_PATH_RE = /(?:domain-skills|interaction-skills)\/([^/]+)\/([^/]+)\.md$/;

export interface RunClaudeAttachment {
  name: string;
  mime: string;
  bytes: Buffer | Uint8Array;
}

export interface RunClaudeOptions {
  /** Absolute path containing SKILL.md and helpers.js. */
  harnessDir: string;
  /**
   * App session id. Used to namespace `<harnessDir>/uploads/<sessionId>/` and
   * `<harnessDir>/outputs/<sessionId>/` so multiple concurrent sessions don't
   * stomp on each other.
   */
  sessionId: string;
  /** The user-facing prompt. */
  prompt: string;
  /** User-provided files to expose to the agent via ./uploads/<sessionId>/. */
  attachments?: RunClaudeAttachment[];
  /** WebContents whose CDP target the agent will drive. */
  webContents: WebContents;
  /** Port Electron exposes CDP on (from startup/cli.ts). */
  cdpPort: number;
  /** Aborts the spawned subprocess. */
  signal?: AbortSignal;
  /** Emit events to the session pipeline. */
  onEvent: (e: HlEvent) => void;
  /** Optional `claude` binary path (defaults to `claude` on PATH). */
  claudeBin?: string;
  /**
   * If set, passes `--resume <id>` to `claude -p` so Claude Code continues
   * an existing conversation instead of starting fresh. Capture this from
   * the `system/init` event's `session_id` on a prior run.
   */
  resumeSessionId?: string;
  /**
   * Invoked when the spawned Claude Code subprocess emits its `system/init`
   * event, which contains the Claude conversation id. Store this so you can
   * pass it as `resumeSessionId` on the next spawn for the same app session.
   */
  onSessionId?: (claudeSessionId: string) => void;
}

/**
 * Resolve the CDP target id of an Electron WebContents by briefly attaching
 * its debugger, calling Target.getTargetInfo, and detaching.
 */
export async function resolveTargetIdForWebContents(wc: WebContents): Promise<string> {
  const dbg = wc.debugger;
  let attachedNow = false;
  if (!dbg.isAttached()) {
    dbg.attach('1.3');
    attachedNow = true;
  }
  try {
    const info = (await dbg.sendCommand('Target.getTargetInfo')) as {
      targetInfo?: { targetId?: string };
    };
    const id = info?.targetInfo?.targetId;
    if (!id) throw new Error('Target.getTargetInfo returned no targetId');
    return id;
  } finally {
    if (attachedNow) {
      try { dbg.detach(); } catch { /* already detached */ }
    }
  }
}

/**
 * Spawn `claude -p` and relay its stream-json output as HlEvents.
 * Resolves when the subprocess exits. Rejects on unrecoverable errors
 * (spawn failure, abort).
 */
export async function runClaudeAgent(opts: RunClaudeOptions): Promise<void> {
  const { harnessDir, prompt, webContents, cdpPort, signal, onEvent } = opts;
  const claudeBin = opts.claudeBin ?? 'claude';

  let targetId: string;
  try {
    targetId = await resolveTargetIdForWebContents(webContents);
  } catch (err) {
    const msg = `Failed to resolve CDP target id: ${(err as Error).message}`;
    mainLogger.error('claudeRunner.resolveTarget.failed', { error: msg });
    onEvent({ type: 'error', message: msg });
    return;
  }

  mainLogger.info('claudeRunner.spawn', { harnessDir, cdpPort, targetId, promptLength: prompt.length });

  // Auth resolution:
  //   1. User saved an API key in settings → pass as ANTHROPIC_API_KEY (wins
  //      in Claude CLI's precedence order).
  //   2. Otherwise → strip ANTHROPIC_API_KEY from env so Claude CLI's own
  //      Keychain subscription auth takes precedence. User must have run
  //      `claude login` beforehand.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  try {
    const auth = await resolveAuth();
    if (auth?.type === 'apiKey') {
      env.ANTHROPIC_API_KEY = auth.value;
      mainLogger.info('claudeRunner.auth', { source: 'savedApiKey' });
    } else {
      mainLogger.info('claudeRunner.auth', { source: 'claudeCliKeychain' });
    }
  } catch (err) {
    mainLogger.warn('claudeRunner.auth.resolveFailed', { error: (err as Error).message });
  }
  env.BU_TARGET_ID = targetId;
  env.BU_CDP_PORT = String(cdpPort);

  // Prepare uploads + outputs dirs, write attachment bytes to disk.
  const fsSync = require('node:fs');
  const uploadsDir = path.join(harnessDir, 'uploads', opts.sessionId);
  const outputsDir = path.join(harnessDir, 'outputs', opts.sessionId);
  try {
    fsSync.mkdirSync(uploadsDir, { recursive: true });
    fsSync.mkdirSync(outputsDir, { recursive: true });
  } catch (err) {
    mainLogger.warn('claudeRunner.mkdir.failed', { error: (err as Error).message });
  }

  const writtenAttachmentPaths: Array<{ relPath: string; name: string; mime: string; size: number }> = [];
  for (const a of opts.attachments ?? []) {
    const buf = a.bytes instanceof Buffer ? a.bytes : Buffer.from(a.bytes);
    // Sanitize filename: keep it simple and safe.
    const safeName = a.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'upload';
    const filePath = path.join(uploadsDir, safeName);
    try {
      fsSync.writeFileSync(filePath, buf);
      writtenAttachmentPaths.push({
        relPath: path.relative(harnessDir, filePath),
        name: safeName,
        mime: a.mime,
        size: buf.byteLength,
      });
    } catch (err) {
      mainLogger.warn('claudeRunner.attachmentWrite.failed', { name: a.name, error: (err as Error).message });
    }
  }
  if (writtenAttachmentPaths.length > 0) {
    mainLogger.info('claudeRunner.attachments', { sessionId: opts.sessionId, count: writtenAttachmentPaths.length });
  }

  // Harnessless-style seed prompt: tell the agent where AGENTS.md, helpers.js,
  // user attachments, and the outputs directory are — then the task.
  const promptLines: string[] = [
    'You are driving a specific Chromium browser view on this machine.',
    `Your target is CDP target_id=${targetId} on port ${cdpPort} (env BU_TARGET_ID / BU_CDP_PORT).`,
    'Read `./AGENTS.md` for how to drive the browser in this harness.',
    'Always read `./helpers.js` before writing scripts — that is where the functions live. Edit it if a helper is missing.',
  ];
  if (writtenAttachmentPaths.length > 0) {
    promptLines.push('', 'The user attached these files for this task. Read each with your Read tool before acting:');
    for (const a of writtenAttachmentPaths) {
      promptLines.push(`  - ${a.relPath} (${a.mime}, ${a.size} bytes)`);
    }
  }
  promptLines.push(
    '',
    `When the user asks you to produce a file (a report, CSV, screenshot, transcript, etc.), save it to \`./outputs/${opts.sessionId}/\`. Mention the filename in your final answer.`,
    '',
    `Task: ${prompt}`,
  );
  const wrappedPrompt = promptLines.join('\n');

  const args: string[] = [
    '-p',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose', // Claude Code requires --verbose with stream-json in print mode
    // Non-interactive mode can't answer permission prompts — auto-accept so
    // the harness tool loop (Bash for `node`, Read/Write/Edit on helpers.js)
    // runs unblocked. The agent is sandboxed by `cwd` + env, not by prompts.
    '--dangerously-skip-permissions',
  ];
  if (opts.resumeSessionId) {
    args.push('--resume', opts.resumeSessionId);
    mainLogger.info('claudeRunner.resume', { resumeSessionId: opts.resumeSessionId });
  }
  args.push(wrappedPrompt);

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(claudeBin, args, {
      cwd: harnessDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const msg = `Failed to spawn ${claudeBin}: ${(err as Error).message}`;
    mainLogger.error('claudeRunner.spawn.failed', { error: msg });
    onEvent({ type: 'error', message: msg });
    return;
  }

  const onAbort = () => {
    try { child.kill('SIGTERM'); } catch { /* already dead */ }
  };
  signal?.addEventListener('abort', onAbort);

  let stderrBuf = '';
  child.stderr.setEncoding('utf-8');
  child.stderr.on('data', (chunk: string) => {
    stderrBuf += chunk;
    if (stderrBuf.length > 8192) stderrBuf = stderrBuf.slice(-8192);
  });

  // NDJSON line buffer.
  let buf = '';
  const harnessHelpersPath = path.resolve(helpersPath());
  const harnessToolsPath = path.resolve(toolsPath());
  const harnessSkillPath = path.resolve(harnessDir, 'SKILL.md');

  child.stdout.setEncoding('utf-8');
  child.stdout.on('data', (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        handleStreamEvent(evt);
      } catch (err) {
        mainLogger.warn('claudeRunner.stream.parseFail', { line: line.slice(0, 200), error: (err as Error).message });
      }
    }
  });

  // Track in-flight tool calls by id so we can pair tool_result blocks back
  // to the originating tool_use for accurate duration + name on the result.
  const pendingTools = new Map<string, { name: string; startedAt: number; iter: number }>();
  let iter = 0;
  // Claude CLI has been observed to exit non-zero even after emitting a
  // successful `result` event. If `done` already fired we must not overwrite
  // the completed session with an exit-code error.
  let doneEmitted = false;

  function stringifyToolInput(name: string, input: Record<string, unknown>): string {
    // For Bash, show the command body verbatim — that's the most useful preview.
    if (name === 'Bash' && typeof input.command === 'string') return input.command as string;
    // For Read/Write/Edit, prioritize file_path.
    const fp = input.file_path ?? input.path ?? input.target_file;
    if (typeof fp === 'string') {
      const extra = Object.entries(input).filter(([k]) => k !== 'file_path' && k !== 'path' && k !== 'target_file');
      if (extra.length === 0) return fp;
      return `${fp}\n${JSON.stringify(Object.fromEntries(extra), null, 2)}`;
    }
    return JSON.stringify(input, null, 2);
  }

  function stringifyToolResult(content: unknown): { text: string; isError: boolean } {
    // Claude Code's tool_result content can be a string or an array of blocks.
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

  function checkHarnessEditEvent(name: string, input: Record<string, unknown>): void {
    const filePath = typeof input.file_path === 'string' ? input.file_path
                    : typeof input.path === 'string' ? input.path
                    : typeof input.target_file === 'string' ? input.target_file
                    : undefined;
    if (!filePath) return;
    const resolved = path.resolve(filePath);
    const action = name === 'Edit' ? 'patch' : 'write';
    if (name === 'Write' || name === 'Edit' || name === 'apply_patch' || name === 'MultiEdit') {
      if (resolved === harnessHelpersPath) {
        onEvent({ type: 'harness_edited', target: 'helpers', action, path: resolved });
      } else if (resolved === harnessToolsPath || resolved === harnessSkillPath) {
        onEvent({ type: 'harness_edited', target: 'tools', action, path: resolved });
      } else {
        const skillMatch = resolved.match(SKILL_PATH_RE);
        if (skillMatch) onEvent({ type: 'skill_written', path: resolved, domain: skillMatch[1], topic: skillMatch[2], bytes: 0 });
      }
    } else if (name === 'Read') {
      const skillMatch = resolved.match(SKILL_PATH_RE);
      if (skillMatch) onEvent({ type: 'skill_used', path: resolved, domain: skillMatch[1], topic: skillMatch[2] });
    }
  }

  function handleStreamEvent(evt: unknown): void {
    if (!evt || typeof evt !== 'object') return;
    const e = evt as Record<string, unknown>;
    const type = e.type as string | undefined;

    // Streaming assistant text — emit as thinking for live token-by-token feel.
    if (type === 'stream_event') {
      const inner = e.event as Record<string, unknown> | undefined;
      if (!inner) return;
      const innerType = inner.type as string | undefined;
      if (innerType === 'content_block_delta') {
        const delta = inner.delta as Record<string, unknown> | undefined;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          if (delta.text.trim()) onEvent({ type: 'thinking', text: delta.text });
        }
      }
      return;
    }

    // Full assistant turn — every tool_use is now fully-formed with parsed input.
    if (type === 'assistant') {
      iter++;
      const msg = e.message as Record<string, unknown> | undefined;
      const content = msg?.content as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        if (block?.type !== 'tool_use') continue;
        const id = block.id as string;
        const name = (block.name as string | undefined) ?? 'unknown';
        const input = (block.input as Record<string, unknown> | undefined) ?? {};
        pendingTools.set(id, { name, startedAt: Date.now(), iter });
        onEvent({
          type: 'tool_call',
          name,
          args: { preview: stringifyToolInput(name, input), ...input },
          iteration: iter,
        });
        checkHarnessEditEvent(name, input);
      }
      return;
    }

    // Tool results from Claude Code's built-in tool execution come back wrapped
    // in a 'user' message with tool_result content blocks.
    if (type === 'user') {
      const msg = e.message as Record<string, unknown> | undefined;
      const content = msg?.content as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        if (block?.type !== 'tool_result') continue;
        const tid = block.tool_use_id as string;
        const match = pendingTools.get(tid);
        const { text, isError } = stringifyToolResult(block.content);
        const ok = block.is_error !== true && !isError;
        const ms = match ? Date.now() - match.startedAt : 0;
        const name = match?.name ?? 'unknown';
        onEvent({ type: 'tool_result', name, ok, preview: text.slice(0, 2000), ms });
        pendingTools.delete(tid);
      }
      return;
    }

    // Final result emitted by Claude Code.
    if (type === 'result') {
      const subtype = e.subtype as string | undefined;
      const resultText = (e.result as string | undefined) ?? '';
      if (subtype && subtype !== 'success') {
        onEvent({ type: 'error', message: `claude_code_error: ${subtype} ${resultText}`.trim() });
        return;
      }
      doneEmitted = true;
      onEvent({ type: 'done', summary: resultText || '(done)', iterations: 0 });
      return;
    }

    // system/init, system/api_retry — ignore or log.
    if (type === 'system') {
      const subtype = e.subtype as string | undefined;
      if (subtype === 'init') {
        mainLogger.info('claudeRunner.init', {
          model: e.model,
          session_id: e.session_id,
          tools: Array.isArray(e.tools) ? (e.tools as string[]).length : 0,
        });
        if (typeof e.session_id === 'string' && opts.onSessionId) {
          try { opts.onSessionId(e.session_id); } catch (err) {
            mainLogger.warn('claudeRunner.onSessionId.threw', { error: (err as Error).message });
          }
        }
      } else if (subtype === 'api_retry') {
        mainLogger.warn('claudeRunner.apiRetry', { attempt: e.attempt, reason: e.reason });
      }
      return;
    }
  }

  // Watch <outputsDir> for agent-produced files. Emit `file_output` events
  // so the UI can show + offer download. fs.watch fires redundantly, so
  // dedupe by known size.
  const seenOutputs = new Map<string, number>();
  let outputsWatcher: ReturnType<typeof fsSync.watch> | null = null;
  try {
    outputsWatcher = fsSync.watch(outputsDir, { persistent: false }, (_event: string, filename: string | null) => {
      if (!filename) return;
      const filePath = path.join(outputsDir, filename);
      let stat;
      try { stat = fsSync.statSync(filePath); } catch { return; }
      if (!stat.isFile()) return;
      const prevSize = seenOutputs.get(filename);
      if (prevSize === stat.size) return; // deduped: no size change
      seenOutputs.set(filename, stat.size);
      onEvent({
        type: 'file_output',
        name: filename,
        path: filePath,
        size: stat.size,
        mime: mimeFromExt(filename),
      });
      mainLogger.info('claudeRunner.fileOutput', { sessionId: opts.sessionId, name: filename, size: stat.size });
    });
  } catch (err) {
    mainLogger.warn('claudeRunner.outputs.watchFailed', { outputsDir, error: (err as Error).message });
  }

  await new Promise<void>((resolve) => {
    child.on('close', (code, sig) => {
      signal?.removeEventListener('abort', onAbort);
      try { outputsWatcher?.close(); } catch { /* already closed */ }
      mainLogger.info('claudeRunner.exit', { code, signal: sig, stderrTail: stderrBuf.slice(-400) });
      if (signal?.aborted) {
        onEvent({ type: 'done', summary: 'Halted by user', iterations: 0 });
      } else if (code !== 0 && !doneEmitted) {
        const trimmed = stderrBuf.trim().slice(-800) || `exit_code=${code}`;
        onEvent({ type: 'error', message: `claude_exit: ${trimmed}` });
      } else if (code !== 0) {
        mainLogger.warn('claudeRunner.exit.postDoneNonZero', { code, stderrTail: stderrBuf.slice(-200) });
      }
      resolve();
    });
    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      try { outputsWatcher?.close(); } catch { /* already closed */ }
      onEvent({ type: 'error', message: `claude_spawn_error: ${err.message}` });
      resolve();
    });
  });
}

function mimeFromExt(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown',
    json: 'application/json', html: 'text/html', xml: 'application/xml', yaml: 'application/x-yaml', yml: 'application/x-yaml',
    js: 'text/javascript', ts: 'application/typescript', py: 'text/x-python',
    zip: 'application/zip', tar: 'application/x-tar', gz: 'application/gzip',
  };
  return map[ext] ?? 'application/octet-stream';
}
