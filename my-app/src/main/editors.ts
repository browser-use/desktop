/**
 * Detect installed code editors/IDEs and open files in them.
 * macOS-only for now (checks /Applications + ~/Applications).
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
  bundleName: string;
}

const KNOWN: KnownEditor[] = [
  { id: 'cursor', name: 'Cursor', bundleName: 'Cursor.app' },
  { id: 'windsurf', name: 'Windsurf', bundleName: 'Windsurf.app' },
  { id: 'vscode', name: 'VS Code', bundleName: 'Visual Studio Code.app' },
  { id: 'vscode-insiders', name: 'VS Code Insiders', bundleName: 'Visual Studio Code - Insiders.app' },
  { id: 'zed', name: 'Zed', bundleName: 'Zed.app' },
  { id: 'zed-preview', name: 'Zed Preview', bundleName: 'Zed Preview.app' },
  { id: 'sublime', name: 'Sublime Text', bundleName: 'Sublime Text.app' },
  { id: 'webstorm', name: 'WebStorm', bundleName: 'WebStorm.app' },
  { id: 'intellij', name: 'IntelliJ IDEA', bundleName: 'IntelliJ IDEA.app' },
  { id: 'intellij-ce', name: 'IntelliJ IDEA CE', bundleName: 'IntelliJ IDEA CE.app' },
  { id: 'pycharm', name: 'PyCharm', bundleName: 'PyCharm.app' },
  { id: 'pycharm-ce', name: 'PyCharm CE', bundleName: 'PyCharm CE.app' },
  { id: 'rider', name: 'Rider', bundleName: 'Rider.app' },
  { id: 'goland', name: 'GoLand', bundleName: 'GoLand.app' },
  { id: 'textmate', name: 'TextMate', bundleName: 'TextMate.app' },
  { id: 'nova', name: 'Nova', bundleName: 'Nova.app' },
  { id: 'bbedit', name: 'BBEdit', bundleName: 'BBEdit.app' },
  { id: 'textedit', name: 'TextEdit', bundleName: 'TextEdit.app' },
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

/**
 * Detect which editors are installed. Cached after first call per process.
 */
export function detectEditors(): DetectedEditor[] {
  if (cached) return cached;
  if (process.platform !== 'darwin') {
    cached = [];
    return cached;
  }
  const found: DetectedEditor[] = [];
  const dirs = appSearchDirs();
  for (const k of KNOWN) {
    const exists = dirs.some((d) => {
      try { return fs.existsSync(path.join(d, k.bundleName)); }
      catch { return false; }
    });
    if (exists) found.push({ id: k.id, name: k.name });
  }
  mainLogger.info('editors.detect', { count: found.length, ids: found.map((e) => e.id) });
  cached = found;
  return found;
}

/**
 * Open a file in the given editor via `open -a "<Editor>" <path>`.
 */
export async function openInEditor(editorId: string, filePath: string): Promise<void> {
  const editor = KNOWN.find((k) => k.id === editorId);
  if (!editor) throw new Error(`Unknown editor: ${editorId}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn('open', ['-a', editor.name, filePath], { stdio: 'ignore' });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`open -a ${editor.name} exit ${code}`))));
    child.on('error', reject);
  });
  mainLogger.info('editors.openInEditor', { editorId, filePath });
}
