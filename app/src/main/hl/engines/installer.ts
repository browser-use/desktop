import { spawn } from 'node:child_process';
import { mainLogger } from '../../logger';
import { enrichedEnv, resetPathEnrichmentCache } from './pathEnrich';

export interface EngineInstallResult {
  opened: boolean;
  completed?: boolean;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  error?: string;
  command?: string;
  displayName?: string;
  stdout?: string;
  stderr?: string;
}

interface InstallSpec {
  displayName: string;
  command: (platform: NodeJS.Platform) => string;
}

export interface InstallerSpawnSpec {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  spawnOptions: { windowsHide?: boolean };
}

const INSTALLERS: Record<string, InstallSpec> = {
  'claude-code': {
    displayName: 'Claude Code',
    command: (platform) => {
      if (platform === 'win32') return 'npm install -g @anthropic-ai/claude-code';
      return 'curl -fsSL https://claude.ai/install.sh | bash';
    },
  },
  codex: {
    displayName: 'Codex',
    command: () => 'npm install -g @openai/codex',
  },
  browsercode: {
    displayName: 'BrowserCode',
    command: (platform) => {
      if (platform === 'win32') {
        return 'curl -fsSL https://bcode.sh/install -o %TEMP%\\bcode-install.sh && bash %TEMP%\\bcode-install.sh';
      }
      return 'curl -fsSL https://bcode.sh/install | bash';
    },
  },
};

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_TAIL_LIMIT = 8192;

function trimTail(value: string): string {
  return value.length > OUTPUT_TAIL_LIMIT ? value.slice(-OUTPUT_TAIL_LIMIT) : value;
}

function installerExitError(displayName: string, exitCode: number | null, signal: NodeJS.Signals | null): string {
  if (signal) return `${displayName} installer exited from signal ${signal}`;
  return `${displayName} installer exited ${exitCode}`;
}

export function installerSpawnSpec(
  installCommand: string,
  opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): InstallerSpawnSpec {
  if (/[\r\n\0]/.test(installCommand)) throw new Error('installer command contains unsupported control characters');
  const platform = opts.platform ?? process.platform;
  const env = enrichedEnv(opts.env ?? process.env, { platform });
  if (platform === 'win32') {
    return {
      command: env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', installCommand],
      env,
      spawnOptions: { windowsHide: true },
    };
  }
  return {
    command: 'sh',
    args: ['-lc', installCommand],
    env,
    spawnOptions: {},
  };
}

export function runInstallCommand(
  displayName: string,
  installCommand: string,
  opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<EngineInstallResult> {
  const timeoutMs = opts.timeoutMs ?? INSTALL_TIMEOUT_MS;
  return new Promise((resolve) => {
    let spawnSpec: InstallerSpawnSpec;
    try {
      spawnSpec = installerSpawnSpec(installCommand, opts);
    } catch (err) {
      resolve({
        opened: false,
        completed: false,
        error: (err as Error).message,
        command: installCommand,
        displayName,
      });
      return;
    }

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(spawnSpec.command, spawnSpec.args, {
        env: spawnSpec.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...spawnSpec.spawnOptions,
      });
    } catch (err) {
      resolve({
        opened: false,
        completed: false,
        error: (err as Error).message,
        command: installCommand,
        displayName,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout>;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: EngineInstallResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resetPathEnrichmentCache();
      resolve(result);
    };

    timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* already closed */ }
      forceKillTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already closed */ }
      }, 1000);
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout = trimTail(stdout + String(chunk));
    });
    child.stderr?.on('data', (chunk) => {
      stderr = trimTail(stderr + String(chunk));
    });
    child.on('error', (err) => {
      finish({
        opened: false,
        completed: false,
        error: err.message,
        command: installCommand,
        displayName,
        stdout,
        stderr,
      });
    });
    child.on('close', (exitCode, signal) => {
      const ok = exitCode === 0 && !timedOut;
      finish({
        opened: ok,
        completed: !timedOut,
        exitCode,
        signal,
        error: ok
          ? undefined
          : timedOut
            ? `Installer timed out after ${timeoutMs}ms`
            : stderr.trim() || stdout.trim() || installerExitError(displayName, exitCode, signal),
        command: installCommand,
        displayName,
        stdout,
        stderr,
      });
    });
  });
}

export async function runEngineInstall(engineId: string): Promise<EngineInstallResult> {
  const spec = INSTALLERS[engineId];
  if (!spec) return { opened: false, completed: false, error: `No installer configured for ${engineId}` };
  const command = spec.command(process.platform);
  mainLogger.info('engineInstaller.start.request', {
    engineId,
    displayName: spec.displayName,
    platform: process.platform,
    command,
  });
  try {
    const result = await runInstallCommand(spec.displayName, command);
    mainLogger.info('engineInstaller.start.result', {
      engineId,
      displayName: spec.displayName,
      completed: result.completed,
      exitCode: result.exitCode,
      signal: result.signal,
      hasError: Boolean(result.error),
    });
    return result;
  } catch (err) {
    const error = (err as Error).message;
    mainLogger.warn('engineInstaller.start.failed', { engineId, error });
    return { opened: false, completed: false, error, command, displayName: spec.displayName };
  }
}
