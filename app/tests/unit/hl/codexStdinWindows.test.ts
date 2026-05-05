import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCliSpawn } from '../../../src/main/hl/engines/pathEnrich';

const onWindows = process.platform === 'win32';

const MULTILINE_PROMPT = [
  'You are driving a specific Chromium browser view on this machine.',
  'Your target is CDP target_id=abc123 on port 9222.',
  'Read `./AGENTS.md` for how to drive the browser in this harness.',
  '',
  'Task: start google',
].join('\n');

describe.skipIf(!onWindows)('codex stdin path on Windows', () => {
  it('round-trips a multi-line prompt through a .cmd shim without word-splitting', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-stdin-'));
    const argvOut = path.join(tmp, 'argv.txt');
    const stdinOut = path.join(tmp, 'stdin.txt');

    // The shim uses `more` (not `findstr`) to capture stdin: findstr returns
    // exit code 1 when the input lacks a trailing newline, which would mask
    // a real test failure as a fake one. `more` always exits 0 after copying
    // stdin to stdout. Trailing `exit /b 0` is belt-and-suspenders.
    const shim = path.join(tmp, 'codex.cmd');
    fs.writeFileSync(
      shim,
      [
        '@echo off',
        `(for %%A in (%*) do @echo %%A) > "${argvOut}"`,
        `more > "${stdinOut}"`,
        'exit /b 0',
      ].join('\r\n'),
      'utf-8',
    );

    const env = { ...process.env, Path: `${tmp};${process.env.Path ?? ''}` };
    const resolved = resolveCliSpawn('codex', ['exec', '--json', '--yolo', '-'], { env, platform: 'win32' });
    expect(resolved.viaCmdShell).toBe(true);

    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      const child = spawn(resolved.command, resolved.args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
      child.on('error', rejectSpawn);
      child.on('close', () => resolveSpawn());
      child.stdin.end(MULTILINE_PROMPT, 'utf-8');
    });

    const argv = fs.readFileSync(argvOut, 'utf-8').trim().split(/\r?\n/);
    expect(argv).toEqual(['exec', '--json', '--yolo', '-']);

    const stdinSeen = fs.readFileSync(stdinOut, 'utf-8').replace(/\r\n/g, '\n').replace(/\n$/, '');
    expect(stdinSeen).toBe(MULTILINE_PROMPT);
    expect(stdinSeen.split('\n').length).toBeGreaterThan(1);
  });
});
