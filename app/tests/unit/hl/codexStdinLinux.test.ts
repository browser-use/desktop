import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { spawnCli } from '../../../src/main/hl/engines/cliSpawn';
import { resolveCliSpawn } from '../../../src/main/hl/engines/pathEnrich';

const onLinux = process.platform === 'linux';

const MULTILINE_PROMPT = [
  'You are driving a specific Chromium browser view on this machine.',
  'Your target is CDP target_id=abc123 on port 9222.',
  'Read `./AGENTS.md` for how to drive the browser in this harness.',
  '',
  'Task: start google',
].join('\n');

describe.skipIf(!onLinux)('codex stdin path on Linux', () => {
  it('leaves POSIX CLI execution shell-free', () => {
    const resolved = resolveCliSpawn('codex', ['exec', '--json', '--yolo', '-'], { platform: 'linux' });

    expect(resolved).toEqual({
      command: 'codex',
      args: ['exec', '--json', '--yolo', '-'],
      viaCmdShell: false,
      spawnOptions: {},
    });
  });

  it('round-trips a multi-line prompt through a POSIX executable on PATH', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-linux-stdin-'));
    const argvOut = path.join(tmp, 'argv.txt');
    const stdinOut = path.join(tmp, 'stdin.txt');
    const shim = path.join(tmp, 'codex');
    fs.writeFileSync(
      shim,
      [
        '#!/usr/bin/env sh',
        'set -eu',
        `printf '%s\\n' "$@" > "${argvOut}"`,
        `cat > "${stdinOut}"`,
      ].join('\n'),
      'utf-8',
    );
    fs.chmodSync(shim, 0o755);

    const env = { ...process.env, PATH: `${tmp}:${process.env.PATH ?? ''}` };
    let stdoutBuf = '';
    let stderrBuf = '';
    const exitCode = await new Promise<number | null>((resolveSpawn, rejectSpawn) => {
      const child = spawnCli('codex', ['exec', '--json', '--yolo', '-'], {
        env,
        cwd: tmp,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (c: Buffer) => { stdoutBuf += c.toString('utf-8'); });
      child.stderr.on('data', (c: Buffer) => { stderrBuf += c.toString('utf-8'); });
      child.on('error', rejectSpawn);
      child.on('close', (code) => resolveSpawn(code));
      child.stdin.end(MULTILINE_PROMPT, 'utf-8');
    });

    const diag = `\nexit: ${exitCode}\nstdout: ${stdoutBuf}\nstderr: ${stderrBuf}\ntmp: ${tmp}`;
    expect(exitCode, diag).toBe(0);
    expect(fs.existsSync(argvOut), `argv file not created${diag}`).toBe(true);
    expect(fs.existsSync(stdinOut), `stdin file not created${diag}`).toBe(true);

    const argv = fs.readFileSync(argvOut, 'utf-8').trim().split(/\r?\n/);
    expect(argv).toEqual(['exec', '--json', '--yolo', '-']);

    const stdinSeen = fs.readFileSync(stdinOut, 'utf-8').replace(/\r\n/g, '\n');
    expect(stdinSeen).toBe(MULTILINE_PROMPT);
    expect(stdinSeen.split('\n').length).toBeGreaterThan(1);
  });
});
