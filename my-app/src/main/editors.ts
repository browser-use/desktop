/**
 * Detect installed code editors/IDEs and open files in them.
 * Uses app bundles on macOS, common install locations/PATH on Windows, and
 * PATH command lookup on Linux.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mainLogger } from './logger';

export interface DetectedEditor {
  id: string;
  name: string;
}

interface KnownEditor {
  id: string;
  name: string;
  macBundleName?: string;
  commands: string[];
  windowsCandidates?: (env: NodeJS.ProcessEnv, home: string) => string[];
}

const KNOWN: KnownEditor[] = [
  {
    id: 'cursor',
    name: 'Cursor',
    macBundleName: 'Cursor.app',
    commands: ['cursor', 'cursor.cmd', 'Cursor.exe'],
    windowsCandidates: (env, home) => [
      path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Programs', 'Cursor', 'Cursor.exe'),
      path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Programs', 'cursor', 'Cursor.exe'),
    ],
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    macBundleName: 'Windsurf.app',
    commands: ['windsurf', 'windsurf.cmd', 'Windsurf.exe'],
    windowsCandidates: (env, home) => [
      path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Programs', 'Windsurf', 'Windsurf.exe'),
    ],
  },
  {
    id: 'vscode',
    name: 'VS Code',
    macBundleName: 'Visual Studio Code.app',
    commands: ['code', 'code.cmd', 'Code.exe'],
    windowsCandidates: (env, home) => [
      path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Programs', 'Microsoft VS Code', 'Code.exe'),
      path.join(env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe'),
    ],
  },
  {
    id: 'vscode-insiders',
    name: 'VS Code Insiders',
    macBundleName: 'Visual Studio Code - Insiders.app',
    commands: ['code-insiders', 'code-insiders.cmd', 'Code - Insiders.exe'],
    windowsCandidates: (env, home) => [
      path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
    ],
  },
  { id: 'zed', name: 'Zed', macBundleName: 'Zed.app', commands: ['zed'] },
  { id: 'zed-preview', name: 'Zed Preview', macBundleName: 'Zed Preview.app', commands: ['zed-preview'] },
  {
    id: 'sublime',
    name: 'Sublime Text',
    macBundleName: 'Sublime Text.app',
    commands: ['subl', 'subl.cmd', 'sublime_text.exe'],
    windowsCandidates: (env) => [
      path.join(env.ProgramFiles ?? 'C:\\Program Files', 'Sublime Text', 'sublime_text.exe'),
    ],
  },
  { id: 'webstorm', name: 'WebStorm', macBundleName: 'WebStorm.app', commands: ['webstorm', 'webstorm64.exe'] },
  { id: 'intellij', name: 'IntelliJ IDEA', macBundleName: 'IntelliJ IDEA.app', commands: ['idea', 'idea64.exe'] },
  { id: 'intellij-ce', name: 'IntelliJ IDEA CE', macBundleName: 'IntelliJ IDEA CE.app', commands: ['idea', 'idea64.exe'] },
  { id: 'pycharm', name: 'PyCharm', macBundleName: 'PyCharm.app', commands: ['pycharm', 'pycharm64.exe'] },
  { id: 'pycharm-ce', name: 'PyCharm CE', macBundleName: 'PyCharm CE.app', commands: ['pycharm', 'pycharm64.exe'] },
  { id: 'rider', name: 'Rider', macBundleName: 'Rider.app', commands: ['rider', 'rider64.exe'] },
  { id: 'goland', name: 'GoLand', macBundleName: 'GoLand.app', commands: ['goland', 'goland64.exe'] },
  { id: 'textmate', name: 'TextMate', macBundleName: 'TextMate.app', commands: ['mate'] },
  { id: 'nova', name: 'Nova', macBundleName: 'Nova.app', commands: ['nova'] },
  { id: 'bbedit', name: 'BBEdit', macBundleName: 'BBEdit.app', commands: ['bbedit'] },
  { id: 'textedit', name: 'TextEdit', macBundleName: 'TextEdit.app', commands: [] },
];

function appSearchDirs(): string[] {
  return [
    '/Applications',
    '/System/Applications',
    '/System/Applications/Utilities',
    path.join(os.homedir(), 'Applications'),
  ];
}

let cached: DetectedEditor[] | null = null;

function findOnPath(commands: string[], env: NodeJS.ProcessEnv = process.env): string | null {
  const pathValue = process.platform === 'win32' ? env.Path ?? env.PATH ?? '' : env.PATH ?? '';
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const command of commands) {
      const candidate = path.join(dir, command);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function windowsCandidateExists(editor: KnownEditor): string | null {
  const home = os.homedir();
  for (const candidate of editor.windowsCandidates?.(process.env, home) ?? []) {
    try { if (fs.existsSync(candidate)) return candidate; }
    catch { /* try next */ }
  }
  return findOnPath(editor.commands);
}

function shouldUseShell(command: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
}

/**
 * Detect which editors are installed. Cached after first call per process.
 */
export function detectEditors(): DetectedEditor[] {
  if (cached) return cached;
  const found: DetectedEditor[] = [];
  if (process.platform === 'darwin') {
    const dirs = appSearchDirs();
    for (const k of KNOWN) {
      if (!k.macBundleName) continue;
      const exists = dirs.some((d) => {
        try { return fs.existsSync(path.join(d, k.macBundleName)); }
        catch { return false; }
      });
      if (exists) found.push({ id: k.id, name: k.name });
    }
  } else if (process.platform === 'win32') {
    for (const k of KNOWN) {
      if (windowsCandidateExists(k)) found.push({ id: k.id, name: k.name });
    }
  } else {
    for (const k of KNOWN) {
      if (findOnPath(k.commands)) found.push({ id: k.id, name: k.name });
    }
  }
  mainLogger.info('editors.detect', { count: found.length, ids: found.map((e) => e.id) });
  cached = found;
  return found;
}

/**
 * Open a file in the given editor.
 */
export async function openInEditor(editorId: string, filePath: string): Promise<void> {
  const editor = KNOWN.find((k) => k.id === editorId);
  if (!editor) throw new Error(`Unknown editor: ${editorId}`);
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? windowsCandidateExists(editor) ?? editor.commands[0]
      : findOnPath(editor.commands) ?? editor.commands[0];
  const args = process.platform === 'darwin' ? ['-a', editor.name, filePath] : [filePath];
  if (!command) throw new Error(`Editor is not available: ${editorId}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', shell: shouldUseShell(command) });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exit ${code}`))));
    child.on('error', reject);
  });
  mainLogger.info('editors.openInEditor', { editorId, filePath });
}
