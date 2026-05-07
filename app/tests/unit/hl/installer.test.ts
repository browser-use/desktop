import { describe, expect, it } from 'vitest';
import { installerSpawnSpec, runInstallCommand } from '../../../src/main/hl/engines/installer';

const posixIt = process.platform === 'win32' ? it.skip : it;

function nodeCommand(script: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

describe('engine installer background runner', () => {
  it('routes Windows installs through hidden cmd.exe without opening a terminal', () => {
    const command = 'npm install -g @openai/codex';

    const spec = installerSpawnSpec(command, {
      platform: 'win32',
      env: {
        Path: 'C:\\Windows\\System32',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      },
    });

    expect(spec.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(spec.args).toEqual(['/d', '/s', '/c', command]);
    expect(spec.spawnOptions).toEqual({ windowsHide: true });
    expect(spec.args.join(' ')).not.toContain('start');
    expect(spec.args.join(' ')).not.toContain('Installer');
  });

  it('routes POSIX installs through a background shell command runner', () => {
    const command = 'curl -fsSL https://claude.ai/install.sh | bash';

    const spec = installerSpawnSpec(command, {
      platform: 'linux',
      env: { PATH: '/usr/bin' },
    });

    expect(spec.command).toBe('sh');
    expect(spec.args).toEqual(['-lc', command]);
    expect(spec.spawnOptions).toEqual({});
  });

  it('resolves after the installer process exits successfully', async () => {
    const result = await runInstallCommand(
      'Test Installer',
      nodeCommand("process.stdout.write('installed');"),
      { timeoutMs: 5000 },
    );

    expect(result).toMatchObject({
      opened: true,
      completed: true,
      exitCode: 0,
      signal: null,
      displayName: 'Test Installer',
    });
    expect(result.stdout).toContain('installed');
    expect(result.error).toBeUndefined();
  });

  it('returns installer stderr and exit code when the process fails', async () => {
    const result = await runInstallCommand(
      'Test Installer',
      nodeCommand("process.stderr.write('no permission'); process.exit(7);"),
      { timeoutMs: 5000 },
    );

    expect(result).toMatchObject({
      opened: false,
      completed: true,
      exitCode: 7,
      signal: null,
      displayName: 'Test Installer',
      stderr: 'no permission',
      error: 'no permission',
    });
  });

  posixIt('uses the signal in the fallback error when the installer is externally killed', async () => {
    const result = await runInstallCommand(
      'Test Installer',
      'kill -TERM $$',
      { timeoutMs: 5000 },
    );

    expect(result).toMatchObject({
      opened: false,
      completed: true,
      exitCode: null,
      signal: 'SIGTERM',
      displayName: 'Test Installer',
      error: 'Test Installer installer exited from signal SIGTERM',
    });
  });
});
