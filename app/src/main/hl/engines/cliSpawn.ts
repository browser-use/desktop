import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { enrichedEnv, resolveCliSpawn } from './pathEnrich';

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

export function spawnCli(bin: string, args: readonly string[], opts: SpawnCliOptions = {}): ChildProcessWithoutNullStreams {
  const env = opts.env ?? enrichedEnv();
  const stdio = opts.stdio ?? ['ignore', 'pipe', 'pipe'];
  const resolved = resolveCliSpawn(bin, args, { env });
  return spawn(resolved.command, resolved.args, {
    cwd: opts.cwd,
    env,
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
    const trimTail = (value: string): string => value.length > 8192 ? value.slice(-8192) : value;
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout = trimTail(stdout + String(d)); });
    child.stderr.on('data', (d) => { stderr = trimTail(stderr + String(d)); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr, error: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}
