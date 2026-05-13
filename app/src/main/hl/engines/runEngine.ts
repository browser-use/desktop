/**
 * Engine-agnostic runner. Spawns the configured adapter's CLI, pipes
 * its NDJSON stdout through the adapter's parser, and emits HlEvents.
 *
 * Everything downstream (SessionManager, AgentPane, DB, outputs watcher)
 * speaks HlEvent only — the adapter's job is to hide engine-specific
 * spawn args, env, and NDJSON dialect behind this contract.
 */

import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { engineLogger } from '../../logger';
import { resolveAuth, loadOpenAIKey, loadClaudeSubscriptionType, loadBrowserCodeConfig } from '../../identity/authStore';
import { helpersPath, skillPath } from '../harness';
import { get as getAdapter } from './registry';
import { spawnCli } from './cliSpawn';
import { registerResourceOwner, unregisterResourceOwner } from '../../resourceMonitor';
import type {
  EngineAdapter,
  EngineRunControl,
  ParseContext,
  RunEngineOptions,
  SpawnContext,
} from './types';
import type { HlEvent } from '../../../shared/session-schemas';
import type { WebContents } from 'electron';

async function resolveTargetIdForWebContents(wc: WebContents): Promise<string> {
  const dbg = wc.debugger;
  const attachedByUs = !dbg.isAttached();
  if (attachedByUs) dbg.attach('1.3');
  try {
    const info = (await dbg.sendCommand('Target.getTargetInfo')) as {
      targetInfo?: { targetId?: string };
    };
    const id = info?.targetInfo?.targetId;
    if (!id) throw new Error('Target.getTargetInfo returned no targetId');
    return id;
  } finally {
    if (attachedByUs) {
      try { dbg.detach(); } catch { /* already detached */ }
    }
  }
}

function mimeFromExt(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown',
    json: 'application/json', html: 'text/html', xml: 'application/xml',
    yaml: 'application/x-yaml', yml: 'application/x-yaml',
    js: 'text/javascript', ts: 'application/typescript', py: 'text/x-python',
    zip: 'application/zip', tar: 'application/x-tar', gz: 'application/gzip',
  };
  return map[ext] ?? 'application/octet-stream';
}

type HarnessTarget = 'helpers' | 'tools';

type HarnessFileWatch = {
  path: string;
  basename: string;
  target: HarnessTarget;
  hash: string | null;
};

function hashFile(filePath: string): string | null | undefined {
  try {
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') return null;
    engineLogger.warn('engines.run.harnessWatch.hashFailed', {
      path: filePath,
      error: nodeErr.message,
    });
    return undefined;
  }
}

export async function runEngine(opts: RunEngineOptions): Promise<void> {
  const adapter: EngineAdapter | undefined = getAdapter(opts.engineId);
  if (!adapter) {
    opts.onEvent({ type: 'error', message: `unknown_engine: ${opts.engineId}` });
    return;
  }

  // 1. Resolve CDP target for the session's browser view.
  let targetId: string;
  try {
    targetId = await resolveTargetIdForWebContents(opts.webContents);
  } catch (err) {
    const msg = `Failed to resolve CDP target id: ${(err as Error).message}`;
    engineLogger.error('engines.run.resolveTarget.failed', { engineId: opts.engineId, error: msg });
    opts.onEvent({ type: 'error', message: msg });
    return;
  }

  // 2. Prepare uploads/ + outputs/ dirs, write attachments to disk.
  const uploadsDir = path.join(opts.harnessDir, 'uploads', opts.sessionId);
  const outputsDir = path.join(opts.harnessDir, 'outputs', opts.sessionId);
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.mkdirSync(outputsDir, { recursive: true });
  } catch (err) {
    engineLogger.warn('engines.run.mkdir.failed', { engineId: opts.engineId, error: (err as Error).message });
  }

  const attachmentRefs: Array<{ relPath: string; mime: string; size: number }> = [];
  for (const a of opts.attachments ?? []) {
    const buf = a.bytes instanceof Buffer ? a.bytes : Buffer.from(a.bytes);
    const safeName = a.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'upload';
    const filePath = path.join(uploadsDir, safeName);
    try {
      fs.writeFileSync(filePath, buf);
      attachmentRefs.push({
        relPath: path.relative(opts.harnessDir, filePath),
        mime: a.mime,
        size: buf.byteLength,
      });
    } catch (err) {
      engineLogger.warn('engines.run.attachmentWrite.failed', { name: a.name, error: (err as Error).message });
    }
  }

  // 3. Resolve auth. Per-engine keychain slots: Claude reads the Anthropic
  //    key via resolveAuth(), Codex reads its OpenAI slot. Each adapter gets
  //    the key appropriate to its provider so we can't accidentally send an
  //    Anthropic key to OpenAI (or vice versa).
  let savedApiKey: string | undefined;
  let providerId: string | undefined;
  let model: string | undefined;
  let cliAuthed = false;
  try {
    if (adapter.id === 'codex') {
      const k = await loadOpenAIKey();
      if (k) savedApiKey = k;
      cliAuthed = (await adapter.probeAuthed()).authed;
    } else if (adapter.id === 'browsercode') {
      const cfg = await loadBrowserCodeConfig();
      if (cfg?.apiKey) savedApiKey = cfg.apiKey;
      if (cfg?.providerId) providerId = cfg.providerId;
      if (cfg?.model) model = cfg.model;
      // BrowserCode is configured exclusively through provider API keys in
      // Settings. Do not classify a saved provider key as CLI-managed OAuth.
      cliAuthed = false;
    } else {
      const auth = await resolveAuth();
      if (auth?.type === 'apiKey') savedApiKey = auth.value;
      cliAuthed = (await adapter.probeAuthed()).authed;
    }
  } catch (err) {
    engineLogger.warn('engines.run.auth.resolveFailed', { error: (err as Error).message });
  }
  // Headline auth-path log — greppable: `session.auth.path`. Tells you
  // which of the three cases this session falls into:
  //   - 'apiKey'       → using saved API key (ANTHROPIC / OPENAI env var)
  //   - 'subscription' → using the CLI's own OAuth (Claude Keychain / Codex auth.json)
  //   - 'both'         → both are available; we chose `chosen` (apiKey wins
  //                      because the adapter's buildEnv sets the env var when
  //                      savedApiKey is present)
  const authPath: 'apiKey' | 'subscription' | 'both' | 'none' =
    savedApiKey && cliAuthed ? 'both'
    : savedApiKey ? 'apiKey'
    : cliAuthed ? 'subscription'
    : 'none';
  const chosen: 'apiKey' | 'subscription' | 'none' =
    savedApiKey ? 'apiKey' : cliAuthed ? 'subscription' : 'none';
  engineLogger.info('session.auth.path', {
    sessionId: opts.sessionId,
    engineId: adapter.id,
    path: authPath,
    chosen,
    hasSavedKey: Boolean(savedApiKey),
    cliAuthed,
  });

  // Resolve the (authMode, subscriptionType) snapshot for this session. Fires
  // onAuthResolved so SessionManager can stamp the session row. This is the
  // source of truth for per-session auth attribution — the global authStore
  // mode can change later without rewriting history.
  const resolvedAuthMode: 'apiKey' | 'subscription' | null = chosen === 'none' ? null : chosen;
  let resolvedSubType: string | null = null;
  if (resolvedAuthMode === 'subscription') {
    if (adapter.id === 'codex') {
      // Codex CLI does not expose Plus vs Pro locally; use a generic label.
      resolvedSubType = 'chatgpt';
    } else {
      try {
        resolvedSubType = await loadClaudeSubscriptionType();
      } catch (err) {
        engineLogger.warn('engines.run.subType.loadFailed', { error: (err as Error).message });
      }
    }
  }
  engineLogger.info('session.auth.resolved', {
    sessionId: opts.sessionId,
    engineId: adapter.id,
    authMode: resolvedAuthMode,
    subscriptionType: resolvedSubType,
  });
  if (opts.onAuthResolved) {
    try { opts.onAuthResolved({ authMode: resolvedAuthMode, subscriptionType: resolvedSubType }); }
    catch (err) { engineLogger.warn('engines.run.onAuthResolved.threw', { error: (err as Error).message }); }
  }
  if (model && opts.onModelResolved) {
    engineLogger.info('session.model.resolved', {
      sessionId: opts.sessionId,
      engineId: adapter.id,
      model,
      source: 'config',
      providerId,
    });
    try { opts.onModelResolved({ model, source: 'config' }); }
    catch (err) { engineLogger.warn('engines.run.onModelResolved.threw', { source: 'config', error: (err as Error).message }); }
  }

  // 4. Build spawn context + let adapter compose args/env/prompt.
  const spawnCtx: SpawnContext = {
    prompt: opts.prompt,
    harnessDir: opts.harnessDir,
    sessionId: opts.sessionId,
    targetId,
    cdpPort: opts.cdpPort,
    resumeSessionId: opts.resumeSessionId,
    savedApiKey,
    providerId,
    model,
    attachmentRefs,
  };
  const wrappedPrompt = adapter.wrapPrompt(spawnCtx);
  const args = adapter.buildSpawnArgs(spawnCtx, wrappedPrompt);
  const env = adapter.buildEnv(spawnCtx, { ...process.env });

  engineLogger.info('engines.run.spawn', {
    engineId: adapter.id,
    binary: adapter.binaryName,
    sessionId: opts.sessionId,
    targetId,
    cdpPort: opts.cdpPort,
    hasResume: !!opts.resumeSessionId,
    attachmentCount: attachmentRefs.length,
    providerId,
    model,
    authSource: savedApiKey ? 'savedApiKey' : 'cliManaged',
    args: args.map((a) => (a.length > 120 ? `${a.slice(0, 100)}…<${a.length}ch>` : a)),
    envAuthFlags: {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ? `set(${env.ANTHROPIC_API_KEY.length}ch)` : 'unset',
      ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN ? 'set' : 'unset',
      CLAUDE_CODE_USE_BEDROCK: env.CLAUDE_CODE_USE_BEDROCK ?? 'unset',
      CLAUDE_CODE_USE_VERTEX: env.CLAUDE_CODE_USE_VERTEX ?? 'unset',
    },
  });

  // If the adapter wants to feed the prompt via stdin (Windows-safe path —
  // see EngineAdapter.getStdinPayload), open stdin as a pipe instead of
  // ignoring it, then write+end after spawn.
  const stdinPayload = adapter.getStdinPayload?.(spawnCtx, wrappedPrompt);
  const stdinMode: 'pipe' | 'ignore' = stdinPayload != null ? 'pipe' : 'ignore';

  const harnessHelpersAbs = path.resolve(helpersPath());
  const harnessSkillAbs = path.resolve(skillPath());

  const watchedHarnessFiles: HarnessFileWatch[] = [
    { path: harnessHelpersAbs, basename: path.basename(harnessHelpersAbs), target: 'helpers', hash: hashFile(harnessHelpersAbs) ?? null },
    { path: harnessSkillAbs, basename: path.basename(harnessSkillAbs), target: 'tools', hash: hashFile(harnessSkillAbs) ?? null },
  ];

  const useProcessGroup = process.platform !== 'win32';
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnCli(adapter.binaryName, args, {
      cwd: opts.harnessDir,
      env,
      stdio: [stdinMode, 'pipe', 'pipe'],
      detached: useProcessGroup,
    });
    registerResourceOwner(child.pid, {
      kind: 'agent',
      component: adapter.id,
      sessionId: opts.sessionId,
      engineId: adapter.id,
      label: `${adapter.id}:${opts.sessionId.slice(0, 8)}`,
    });
  } catch (err) {
    opts.onEvent({ type: 'error', message: `spawn_failed: ${(err as Error).message}` });
    return;
  }

  let controlState: 'running' | 'paused' | 'terminated' = 'running';
  const signalRun = (signal: NodeJS.Signals): { ok: boolean; error?: string } => {
    if (!child.pid) return { ok: false, error: 'Agent process is not available yet.' };
    try {
      if (useProcessGroup) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
      return { ok: true };
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ESRCH') return { ok: false, error: 'Agent process has already exited.' };
      return { ok: false, error: nodeErr.message };
    }
  };
  const control: EngineRunControl = {
    pid: child.pid,
    canSuspend: useProcessGroup,
    pause: () => {
      if (!useProcessGroup) return { error: 'Pausing an in-flight agent is not supported on Windows yet.' };
      if (controlState === 'terminated') return { error: 'Agent process has already exited.' };
      if (controlState === 'paused') return { paused: true };
      const result = signalRun('SIGSTOP');
      if (!result.ok) return { error: result.error ?? 'Failed to pause agent process.' };
      controlState = 'paused';
      engineLogger.info('engines.run.control.pause', {
        engineId: adapter.id,
        sessionId: opts.sessionId,
        pid: child.pid,
      });
      return { paused: true };
    },
    resume: () => {
      if (!useProcessGroup) return { error: 'Resuming an in-flight agent is not supported on Windows yet.' };
      if (controlState === 'terminated') return { error: 'Agent process has already exited.' };
      if (controlState === 'running') return { resumed: true };
      const result = signalRun('SIGCONT');
      if (!result.ok) return { error: result.error ?? 'Failed to resume agent process.' };
      controlState = 'running';
      engineLogger.info('engines.run.control.resume', {
        engineId: adapter.id,
        sessionId: opts.sessionId,
        pid: child.pid,
      });
      return { resumed: true };
    },
    terminate: () => {
      if (controlState === 'terminated') return;
      if (controlState === 'paused' && useProcessGroup) {
        signalRun('SIGCONT');
      }
      controlState = 'terminated';
      signalRun('SIGTERM');
    },
  };
  opts.onRunControl?.(control);

  if (stdinPayload != null) {
    // Attach error listener BEFORE writing — if the child exits early (bad
    // args, missing auth, killed by SIGTERM), Node emits 'error' (EPIPE) on
    // stdin asynchronously. Without a listener it propagates as an unhandled
    // error and crashes the main process. The exit handler below already
    // surfaces the real failure to the user, so we just log here.
    child.stdin.on('error', (err) => {
      engineLogger.warn('engines.run.stdinPipe.error', { engineId: adapter.id, error: (err as NodeJS.ErrnoException).message, code: (err as NodeJS.ErrnoException).code });
    });
    try {
      child.stdin.end(stdinPayload, 'utf-8');
    } catch (err) {
      engineLogger.warn('engines.run.stdinWrite.failed', { engineId: adapter.id, error: (err as Error).message });
    }
  }

  let abortKillTimer: ReturnType<typeof setTimeout> | null = null;
  const clearAbortKillTimer = () => {
    if (!abortKillTimer) return;
    clearTimeout(abortKillTimer);
    abortKillTimer = null;
  };
  const onAbort = () => {
    control.terminate();
    clearAbortKillTimer();
    abortKillTimer = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      signalRun('SIGKILL');
    }, 1500);
    abortKillTimer.unref?.();
  };
  opts.signal?.addEventListener('abort', onAbort);

  // 5. Outputs watcher — emits file_output events for any file written to the
  //    session's outputs dir. Deduped by (name, size).
  const seenOutputs = new Map<string, number>();
  let outputsWatcher: ReturnType<typeof fs.watch> | null = null;
  let harnessWatcher: ReturnType<typeof fs.watch> | null = null;
  const harnessCheckTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const emitHarnessChanges = (files: HarnessFileWatch[]): void => {
    for (const file of files) {
      const nextHash = hashFile(file.path);
      if (nextHash === undefined || nextHash === file.hash) continue;
      const prevHash = file.hash;
      file.hash = nextHash;
      const action = prevHash === null && nextHash !== null ? 'write' : 'patch';
      let bytes: number | null;
      try {
        bytes = fs.statSync(file.path).size;
      } catch {
        bytes = null;
      }
      engineLogger.info('engines.run.harnessEdited.detected', {
        sessionId: opts.sessionId,
        engineId: adapter.id,
        target: file.target,
        action,
        path: file.path,
        relPath: path.relative(opts.harnessDir, file.path),
        previousHash: prevHash ? prevHash.slice(0, 12) : null,
        nextHash: nextHash ? nextHash.slice(0, 12) : null,
        bytes,
      });
      opts.onEvent({
        type: 'harness_edited',
        target: file.target,
        action,
        path: file.path,
      });
    }
  };

  const scheduleHarnessCheck = (files: HarnessFileWatch[]): void => {
    for (const file of files) {
      const existing = harnessCheckTimers.get(file.path);
      if (existing) clearTimeout(existing);
      harnessCheckTimers.set(file.path, setTimeout(() => {
        harnessCheckTimers.delete(file.path);
        emitHarnessChanges([file]);
      }, 75));
    }
  };

  const flushHarnessChanges = (): void => {
    for (const timer of harnessCheckTimers.values()) clearTimeout(timer);
    harnessCheckTimers.clear();
    emitHarnessChanges(watchedHarnessFiles);
  };

  const closeWatchers = (): void => {
    try { outputsWatcher?.close(); } catch { /* already closed */ }
    try { harnessWatcher?.close(); } catch { /* already closed */ }
    for (const timer of harnessCheckTimers.values()) clearTimeout(timer);
    harnessCheckTimers.clear();
  };

  try {
    outputsWatcher = fs.watch(outputsDir, { persistent: false }, (_ev, filename) => {
      if (!filename || typeof filename !== 'string') return;
      const filePath = path.join(outputsDir, filename);
      let stat;
      try { stat = fs.statSync(filePath); } catch { return; }
      if (!stat.isFile()) return;
      if (seenOutputs.get(filename) === stat.size) return;
      seenOutputs.set(filename, stat.size);
      opts.onEvent({
        type: 'file_output',
        name: filename,
        path: filePath,
        size: stat.size,
        mime: mimeFromExt(filename),
      });
    });
  } catch (err) {
    engineLogger.warn('engines.run.outputs.watchFailed', { outputsDir, error: (err as Error).message });
  }

  try {
    harnessWatcher = fs.watch(opts.harnessDir, { persistent: false }, (_ev, filename) => {
      if (!filename) {
        scheduleHarnessCheck(watchedHarnessFiles);
        return;
      }
      const changedName = String(filename);
      const changed = watchedHarnessFiles.filter((file) => file.basename === changedName);
      if (changed.length > 0) scheduleHarnessCheck(changed);
    });
  } catch (err) {
    engineLogger.warn('engines.run.harnessWatch.watchFailed', { harnessDir: opts.harnessDir, error: (err as Error).message });
  }

  // 6. Generic post-processor over tool_call events: detect skill edits and
  //    reads. Harness edits are emitted by the file watcher above, using actual
  //    file content as the source of truth instead of provider-specific tool
  //    metadata.
  function skillMetaFromPath(resolved: string): { domain: string; topic: string } | null {
    const rel = path.relative(opts.harnessDir, resolved).split(path.sep).join('/');
    if (rel.startsWith('domain-skills/') && rel.endsWith('.md')) {
      return { domain: 'domain', topic: rel.slice('domain-skills/'.length, -'.md'.length) };
    }
    if (rel.startsWith('interaction-skills/') && rel.endsWith('.md')) {
      return { domain: 'interaction', topic: rel.slice('interaction-skills/'.length, -'.md'.length) };
    }
    if (rel.startsWith('skills/') && rel.endsWith('/SKILL.md')) {
      return { domain: 'user', topic: rel.slice('skills/'.length, -'/SKILL.md'.length) };
    }
    return null;
  }

  function skillMetaFromSkillId(id: string): { domain: string; topic: string } | null {
    const cleaned = id.replace(/['"]+$/g, '');
    if (!cleaned || cleaned.startsWith('--')) return null;
    if (cleaned.startsWith('user/')) return { domain: 'user', topic: cleaned.slice('user/'.length) };
    const parts = cleaned.split('/');
    const domain = parts.shift() || 'skill';
    return { domain, topic: parts.join('/') || cleaned };
  }

  function skillMetaFromAgentSkillCommand(command: string): { kind: 'read' | 'write'; action?: 'write' | 'patch' | 'delete'; domain: string; topic: string } | null {
    const match = command.match(/\bagent-skill(?:\.cmd)?\s+(view|validate|create|patch|delete)\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
    if (!match) return null;
    const verb = match[1];
    const id = match[2] ?? match[3] ?? match[4] ?? '';
    if (!id || id.startsWith('--')) return null;
    if (verb === 'view' || verb === 'validate') {
      const meta = skillMetaFromSkillId(id);
      return meta ? { kind: 'read', domain: meta.domain, topic: meta.topic } : null;
    }
    return {
      kind: 'write',
      action: verb === 'patch' ? 'patch' : verb === 'delete' ? 'delete' : 'write',
      domain: 'user',
      topic: id.replace(/^user\//, ''),
    };
  }

  function skillMetaFromAgentSkillSearchOutput(preview: string): { domain: string; topic: string } | null {
    const lines = preview.split(/\r?\n/);
    const firstLine = lines[0]?.trim() ?? '';
    if (!lines[1]?.trim().startsWith('matched:')) return null;
    const match = firstLine.match(/^(domain|interaction|user)\/([^\s]+)$/);
    if (!match) return null;
    return { domain: match[1], topic: match[2] };
  }

  function postProcess(e: HlEvent): HlEvent[] {
    if (e.type === 'tool_result' && typeof e.preview === 'string') {
      const meta = skillMetaFromAgentSkillSearchOutput(e.preview);
      if (meta) return [e, { type: 'skill_used', path: 'agent-skill search result', domain: meta.domain, topic: meta.topic }];
      return [e];
    }
    if (e.type !== 'tool_call') return [e];
    const args = e.args as Record<string, unknown> | undefined;
    if (!args) return [e];
    const rawCommand = typeof args.command === 'string' ? args.command : undefined;
    if (rawCommand) {
      const meta = skillMetaFromAgentSkillCommand(rawCommand);
      if (meta?.kind === 'read') return [e, { type: 'skill_used', path: rawCommand, domain: meta.domain, topic: meta.topic }];
      if (meta?.kind === 'write') {
        return [e, {
          type: 'skill_written',
          path: rawCommand,
          domain: meta.domain,
          topic: meta.topic,
          bytes: 0,
          action: meta.action ?? 'write',
        }];
      }
    }
    const rawPath = typeof args.file_path === 'string' ? args.file_path
                  : typeof args.path === 'string' ? args.path
                  : typeof args.target_file === 'string' ? args.target_file
                  : undefined;
    if (!rawPath) return [e];
    const resolved = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(opts.harnessDir, rawPath);
    const isWrite = /^(write|edit|apply_patch|multiedit|write_file|patch_file)$/i.test(e.name);
    const isRead = /^(read|read_file)$/i.test(e.name);
    const extra: HlEvent[] = [];
    if (isWrite) {
      const action = /edit|patch/i.test(e.name) ? 'patch' : 'write';
      if (resolved !== harnessHelpersAbs && resolved !== harnessSkillAbs) {
        const m = skillMetaFromPath(resolved);
        if (m) extra.push({ type: 'skill_written', path: resolved, domain: m.domain, topic: m.topic, bytes: 0, action });
      }
    } else if (isRead) {
      const m = skillMetaFromPath(resolved);
      if (m) extra.push({ type: 'skill_used', path: resolved, domain: m.domain, topic: m.topic });
    }
    return [e, ...extra];
  }

  const parseCtx: ParseContext = {
    iter: 0,
    pendingTools: new Map(),
    harnessHelpersPath: harnessHelpersAbs,
    harnessToolsPath: '',
    harnessSkillPath: harnessSkillAbs,
  };

  let buf = '';
  let stderrBuf = '';
  let stdoutBuf = ''; // tail of raw stdout for diagnostics on early exit
  let lastResolvedModel = model;
  // Engines (esp. Claude CLI) have been observed to exit non-zero even after
  // emitting a successful `done`. Track whether we already saw one so the
  // close handler doesn't overwrite the completed session with an error.
  let doneEmitted = false;
  const emit = (ev: Parameters<typeof opts.onEvent>[0]): void => {
    if (ev.type === 'done' || ev.type === 'error') flushHarnessChanges();
    if (ev.type === 'done') doneEmitted = true;
    opts.onEvent(ev);
  };
  child.stderr.setEncoding('utf-8');
  child.stderr.on('data', (c: string) => { stderrBuf += c; if (stderrBuf.length > 8192) stderrBuf = stderrBuf.slice(-8192); });

  child.stdout.setEncoding('utf-8');
  child.stdout.on('data', (chunk: string) => {
    buf += chunk;
    stdoutBuf += chunk;
    if (stdoutBuf.length > 8192) stdoutBuf = stdoutBuf.slice(-8192);
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        const result = adapter.parseLine(line, parseCtx);
        if (result.capturedSessionId && opts.onSessionId) {
          try { opts.onSessionId(result.capturedSessionId); }
          catch (err) { engineLogger.warn('engines.run.onSessionId.threw', { error: (err as Error).message }); }
        }
        for (const raw of result.events) {
          for (const out of postProcess(raw)) emit(out);
        }
        if (parseCtx.currentModel && parseCtx.currentModel !== lastResolvedModel && opts.onModelResolved) {
          lastResolvedModel = parseCtx.currentModel;
          engineLogger.info('session.model.resolved', {
            sessionId: opts.sessionId,
            engineId: adapter.id,
            model: parseCtx.currentModel,
            source: 'engine',
            providerId,
          });
          try { opts.onModelResolved({ model: parseCtx.currentModel, source: 'engine' }); }
          catch (err) { engineLogger.warn('engines.run.onModelResolved.threw', { source: 'engine', error: (err as Error).message }); }
        }
      } catch (err) {
        engineLogger.warn('engines.run.parse.failed', {
          engineId: adapter.id,
          line: line.slice(0, 200),
          error: (err as Error).message,
        });
      }
    }
  });

  await new Promise<void>((resolve) => {
    child.on('close', (code, sig) => {
      controlState = 'terminated';
      unregisterResourceOwner(child.pid);
      opts.signal?.removeEventListener('abort', onAbort);
      clearAbortKillTimer();
      flushHarnessChanges();
      closeWatchers();
      engineLogger.info('engines.run.exit', {
        engineId: adapter.id,
        code,
        signal: sig,
        stderrTail: stderrBuf.slice(-800),
        stdoutTail: stdoutBuf.slice(-800),
        stdoutBytes: stdoutBuf.length,
      });
      if (opts.signal?.aborted) {
        opts.onEvent({ type: 'done', summary: 'Halted by user', iterations: 0 });
      } else if (code !== 0 && !doneEmitted) {
        const stderrTrim = stderrBuf.trim();
        const stdoutTrim = stdoutBuf.trim();
        const detail = stderrTrim || stdoutTrim || `exit_code=${code} (no stderr/stdout — check app.log engines.run.spawn + engines.run.exit)`;
        opts.onEvent({ type: 'error', message: `${adapter.id}_exit: ${detail.slice(-800)}` });
      } else if (code !== 0) {
        engineLogger.warn('engines.run.exit.postDoneNonZero', { engineId: adapter.id, code, stderrTail: stderrBuf.slice(-200) });
      } else if (!doneEmitted) {
        // Clean exit (code 0) but the adapter never emitted `done`. Without
        // this fallback the session would hang in 'running' until the stuck
        // timer fires, and follow-ups would fail (need 'idle' status).
        engineLogger.info('engines.run.exit.cleanNoDone', { engineId: adapter.id, msg: 'emitting synthetic done' });
        opts.onEvent({ type: 'done', summary: 'completed', iterations: 0 });
      }
      resolve();
    });
    child.on('error', (err) => {
      controlState = 'terminated';
      unregisterResourceOwner(child.pid);
      opts.signal?.removeEventListener('abort', onAbort);
      clearAbortKillTimer();
      flushHarnessChanges();
      closeWatchers();
      opts.onEvent({ type: 'error', message: `${adapter.id}_spawn_error: ${err.message}` });
      resolve();
    });
  });
}
