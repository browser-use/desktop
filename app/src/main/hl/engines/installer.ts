import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mainLogger } from '../../logger';

export interface EngineInstallResult {
  opened: boolean;
  error?: string;
  command?: string;
  displayName?: string;
}

interface InstallSpec {
  displayName: string;
  command: (platform: NodeJS.Platform) => string;
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

function shellScript(displayName: string, command: string): string {
  return [
    posixPrintLine(`Installing ${displayName}...`),
    posixPrintLine(`$ ${command}`),
    command,
    'status=$?',
    posixPrintLine(''),
    'if [ "$status" -eq 0 ]; then',
    `  ${posixPrintLine(`${displayName} install finished. Return to Browser Use and refresh the connection.`)}`,
    'else',
    `  printf '%s%s.\\n' ${posixSingleQuote(`${displayName} install failed with exit code `)} "$status"`,
    'fi',
    posixPrintLine(''),
    'read -r -p "Press Enter to close this terminal..."',
  ].join('\n');
}

function posixSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function posixPrintLine(value: string): string {
  return `printf '%s\\n' ${posixSingleQuote(value)}`;
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function openMacTerminal(displayName: string, command: string): EngineInstallResult {
  const script = shellScript(displayName, command);
  const osa = spawn('osascript', [
    '-e', 'tell application "Terminal"',
    '-e', 'activate',
    '-e', `do script ${appleScriptString(script)}`,
    '-e', 'end tell',
  ], { detached: true, stdio: 'ignore' });
  osa.unref();
  return { opened: true, command, displayName };
}

function commandExists(bin: string): boolean {
  const r = spawnSync('sh', ['-lc', `command -v -- ${posixSingleQuote(bin)}`], { stdio: 'ignore' });
  return r.status === 0;
}

function openLinuxTerminal(displayName: string, command: string): EngineInstallResult {
  const script = shellScript(displayName, command);
  const candidates: Array<{ bin: string; args: string[] }> = [
    { bin: 'x-terminal-emulator', args: ['-e', 'sh', '-lc', script] },
    { bin: 'gnome-terminal', args: ['--', 'sh', '-lc', script] },
    { bin: 'konsole', args: ['-e', 'sh', '-lc', script] },
    { bin: 'xterm', args: ['-e', 'sh', '-lc', script] },
  ];
  const candidate = candidates.find((c) => commandExists(c.bin));
  if (!candidate) return { opened: false, error: 'No supported terminal emulator found', command, displayName };
  const child = spawn(candidate.bin, candidate.args, { detached: true, stdio: 'ignore' });
  child.unref();
  return { opened: true, command, displayName };
}

function escapeCmdEcho(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error('installer text contains unsupported control characters');
  return value
    .replace(/\^/g, '^^')
    .replace(/%/g, '%%')
    .replace(/&/g, '^&')
    .replace(/\|/g, '^|')
    .replace(/</g, '^<')
    .replace(/>/g, '^>')
    .replace(/\(/g, '^(')
    .replace(/\)/g, '^)');
}

function quoteCmdToken(value: string): string {
  if (/[\r\n\0"]/.test(value)) throw new Error('installer command token contains unsupported characters');
  return `"${value}"`;
}

function writeWindowsInstallScript(displayName: string, command: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-use-install-'));
  const scriptPath = path.join(dir, 'install.cmd');
  const body = [
    '@echo off',
    `echo ${escapeCmdEcho(`Installing ${displayName}...`)}`,
    `echo ${escapeCmdEcho(`$ ${command}`)}`,
    command,
    'set "status=%ERRORLEVEL%"',
    'echo.',
    'if "%status%"=="0" (',
    `  echo ${escapeCmdEcho(`${displayName} install finished. Return to Browser Use and refresh the connection.`)}`,
    ') else (',
    `  echo ${escapeCmdEcho(`${displayName} install failed with exit code`)} %status%.`,
    ')',
    'echo.',
    'pause',
  ].join('\r\n');
  fs.writeFileSync(scriptPath, body, 'utf-8');
  return scriptPath;
}

function openWindowsTerminal(displayName: string, command: string): EngineInstallResult {
  const scriptPath = writeWindowsInstallScript(displayName, command);
  const comspec = process.env.ComSpec || 'cmd.exe';
  const child = spawn(comspec, [
    '/d',
    '/s',
    '/c',
    `start ${quoteCmdToken(`${displayName} Installer`)} ${quoteCmdToken(comspec)} /k ${quoteCmdToken(scriptPath)}`,
  ], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return { opened: true, command, displayName };
}

export function openEngineInstallTerminal(engineId: string): EngineInstallResult {
  const spec = INSTALLERS[engineId];
  if (!spec) return { opened: false, error: `No installer configured for ${engineId}` };
  const command = spec.command(process.platform);
  mainLogger.info('engineInstaller.open.request', {
    engineId,
    displayName: spec.displayName,
    platform: process.platform,
    command,
  });
  try {
    if (process.platform === 'darwin') return openMacTerminal(spec.displayName, command);
    if (process.platform === 'win32') return openWindowsTerminal(spec.displayName, command);
    return openLinuxTerminal(spec.displayName, command);
  } catch (err) {
    const error = (err as Error).message;
    mainLogger.warn('engineInstaller.open.failed', { engineId, error });
    return { opened: false, error, command, displayName: spec.displayName };
  }
}
