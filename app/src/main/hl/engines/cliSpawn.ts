import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { resolveCliLaunch } from './pathEnrich';

export type CliStdinMode = 'ignore' | 'pipe';

export interface SpawnCliOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: [CliStdinMode, 'pipe', 'pipe'];
}

export interface CliCaptureResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

function assertSafeExecutable(value: string, label: string): void {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`spawn_failed: empty ${label}`);
  if (trimmed !== value) throw new Error(`spawn_failed: unsupported ${label}: ${value}`);
  if (/[\r\n\0]/.test(trimmed)) throw new Error(`spawn_failed: unsafe ${label}`);

  // Adapter binary names are expected to be simple command names like
  // `claude`, `codex`, or `bcode`. Tests may pass an absolute Node path.
  if (/^[A-Za-z0-9._-]+$/.test(trimmed)) return;
  if (path.isAbsolute(trimmed) && !/["']/.test(trimmed)) return;

  throw new Error(`spawn_failed: unsupported ${label}: ${value}`);
}

export function spawnCli(bin: string, args: readonly string[], opts: SpawnCliOptions = {}): ChildProcessWithoutNullStreams {
  assertSafeExecutable(bin, 'executable name');
  const stdio = opts.stdio ?? ['ignore', 'pipe', 'pipe'];
  const resolved = resolveCliLaunch(bin, args, { env: opts.env });
  assertSafeExecutable(resolved.command, 'resolved executable');
  return spawn(resolved.command, resolved.args, {
    cwd: opts.cwd,
    env: resolved.env,
    stdio,
    ...resolved.spawnOptions,
  }) as ChildProcessWithoutNullStreams;
}

export function runCliCapture(bin: string, args: readonly string[], timeoutMs = 5000, opts: Omit<SpawnCliOptions, 'stdio'> = {}): Promise<CliCaptureResult> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnCli(bin, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: '', error: (err as Error).message });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    const trimTail = (value: string): string => value.length > 8192 ? value.slice(-8192) : value;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
      forceKillTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
      }, 250);
      fallbackTimer = setTimeout(() => {
        settle({ ok: false, stdout, stderr, error: `Timed out after ${timeoutMs}ms` });
      }, 1000);
    }, timeoutMs);
    const settle = (result: CliCaptureResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      resolve(result);
    };

    child.stdout.on('data', (d) => { stdout = trimTail(stdout + String(d)); });
    child.stderr.on('data', (d) => { stderr = trimTail(stderr + String(d)); });
    child.on('error', (err) => {
      settle({ ok: false, stdout, stderr, error: err.message });
    });
    child.on('close', (code) => {
      settle(timedOut
        ? { ok: false, stdout, stderr, error: `Timed out after ${timeoutMs}ms` }
        : { ok: code === 0, stdout, stderr });
    });
  });
}
