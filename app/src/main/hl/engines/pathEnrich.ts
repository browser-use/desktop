/**
 * Electron apps launched from a GUI often inherit a minimal PATH that excludes
 * user-installed CLIs. macOS is the worst case (Dock/Finder omit Homebrew,
 * Volta, asdf, etc.), but Windows can also expose PATH as `Path` instead of
 * `PATH`, and Linux desktop launchers may miss ~/.local/bin.
 *
 * `enrichedPath()` returns a platform-delimited PATH string that adds common
 * user-level binary directories on top of whatever PATH the process was given.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

type Platform = NodeJS.Platform;

interface EnrichOptions {
  platform?: Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}

interface CliLaunchOptions extends EnrichOptions {
  env?: NodeJS.ProcessEnv;
}

type PosixPathMod = typeof path.posix;
type WindowsPathMod = typeof path.win32;
type ExtraDirResult = string | string[] | null;

/**
 * Spawn the user's login shell once and capture its PATH. Catches custom
 * dirs set in ~/.zshrc / ~/.bashrc / chruby / mise / asdf / etc. that
 * hard-coded lists can never anticipate.
 *
 * Cached for process lifetime — shells take 50–200 ms and we don't want
 * to pay that on every probe.
 */
let cachedShellPath: string | null = null;
let cachedShellPathTried = false;

function queryLoginShellPath(env: NodeJS.ProcessEnv = process.env, platform: Platform = process.platform): string | null {
  if (platform === 'win32') return null;
  if (cachedShellPathTried) return cachedShellPath;
  cachedShellPathTried = true;
  const sh = env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  try {
    // -i (interactive) so aliases/function-setting init files run;
    // -l (login) so profile files like .zprofile / .bash_profile run.
    // `echo -n` avoids a trailing newline we'd then have to strip.
    const r = spawnSync(sh, ['-ilc', 'printf %s "$PATH"'], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (r.status === 0 && typeof r.stdout === 'string' && r.stdout.length > 0) {
      cachedShellPath = r.stdout.trim();
    }
  } catch { /* ignore — fall through to hardcoded list */ }
  return cachedShellPath;
}

function existingChildBins(root: string, pathMod: PosixPathMod | WindowsPathMod, childToBin: (child: string) => string): string[] {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => childToBin(pathMod.join(root, entry.name)))
      .filter((dir) => {
        try { return fs.statSync(dir).isDirectory(); }
        catch { return false; }
      })
      .sort();
  } catch {
    return [];
  }
}

function envPath(env: NodeJS.ProcessEnv, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = env[key];
    if (value) return value;
  }
  return null;
}

const POSIX_EXTRA_DIRS_FNS: Array<(home: string, platform: Platform, env: NodeJS.ProcessEnv, pathMod: PosixPathMod) => ExtraDirResult> = [
  (_home, _platform, env) => envPath(env, 'PNPM_HOME'),
  (_home, _platform, env, pathMod) => {
    const prefix = envPath(env, 'NPM_CONFIG_PREFIX', 'npm_config_prefix');
    return prefix ? pathMod.join(prefix, 'bin') : null;
  },
  () => '/opt/homebrew/bin',
  () => '/opt/homebrew/sbin',
  () => '/usr/local/bin',
  () => '/usr/local/sbin',
  (_home, _platform, _env, pathMod) => platformDir(pathMod, '/snap/bin'),
  (home, _platform, _env, pathMod) => pathMod.join(home, '.npm-global', 'bin'),
  (home, _platform, _env, pathMod) => pathMod.join(home, '.npm-packages', 'bin'),
  (home, _platform, _env, pathMod) => pathMod.join(home, '.volta', 'bin'),
  (home, _platform, _env, pathMod) => existingChildBins(pathMod.join(home, '.nvm', 'versions', 'node'), pathMod, (child) => pathMod.join(child, 'bin')),
  (home, _platform, _env, pathMod) => pathMod.join(home, '.nodebrew', 'current', 'bin'),
  (home, _platform, _env, pathMod) => pathMod.join(home, '.n', 'bin'),
  (home, _platform, _env, pathMod) => existingChildBins(pathMod.join(home, '.fnm', 'node-versions'), pathMod, (child) => pathMod.join(child, 'installation', 'bin')),
  (home, _platform, _env, pathMod) => existingChildBins(pathMod.join(home, '.local', 'share', 'fnm', 'node-versions'), pathMod, (child) => pathMod.join(child, 'installation', 'bin')),
  (home, _platform, _env, pathMod) => pathMod.join(home, '.asdf', 'shims'),
  (home, _platform, _env, pathMod) => pathMod.join(home, '.local', 'share', 'mise', 'shims'),
  (home, _platform, _env, pathMod) => pathMod.join(home, '.local', 'share', 'rtx', 'shims'),
  (home, platform, _env, pathMod) => platform === 'darwin' ? pathMod.join(home, 'Library', 'pnpm') : null,
  (home, _platform, _env, pathMod) => pathMod.join(home, '.local', 'share', 'pnpm'),
  (home, _platform, _env, pathMod) => pathMod.join(home, '.bun', 'bin'),
  (home, _platform, _env, pathMod) => pathMod.join(home, '.bcode', 'bin'),
  (home, _platform, _env, pathMod) => pathMod.join(home, '.deno', 'bin'),
  (home, _platform, _env, pathMod) => pathMod.join(home, '.cargo', 'bin'),
  (home, _platform, _env, pathMod) => pathMod.join(home, '.local', 'bin'),
  (home, _platform, _env, pathMod) => pathMod.join(home, '.yarn', 'bin'),
  (home, _platform, _env, pathMod) => pathMod.join(home, '.config', 'yarn', 'global', 'node_modules', '.bin'),
  (home, _platform, _env, pathMod) => pathMod.join(home, 'bin'),
];

function platformDir(pathMod: PosixPathMod, dir: string): string {
  return pathMod.normalize(dir);
}

const WINDOWS_EXTRA_DIRS_FNS: Array<(home: string, env: NodeJS.ProcessEnv, pathMod: WindowsPathMod) => ExtraDirResult> = [
  (_home, env) => envPath(env, 'PNPM_HOME'),
  (_home, env, pathMod) => {
    const prefix = envPath(env, 'NPM_CONFIG_PREFIX', 'npm_config_prefix');
    return prefix ? pathMod.join(prefix, 'bin') : null;
  },
  (_home, env, pathMod) => env.LOCALAPPDATA ? pathMod.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'bin') : null,
  (_home, env, pathMod) => env.LOCALAPPDATA ? pathMod.join(env.LOCALAPPDATA, 'Programs', 'cursor', 'resources', 'app', 'bin') : null,
  (_home, env, pathMod) => env.LOCALAPPDATA ? pathMod.join(env.LOCALAPPDATA, 'Programs', 'Windsurf', 'resources', 'app', 'bin') : null,
  (_home, env, pathMod) => env.LOCALAPPDATA ? pathMod.join(env.LOCALAPPDATA, 'pnpm') : null,
  (_home, env, pathMod) => env.LOCALAPPDATA ? pathMod.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps') : null,
  (_home, env, pathMod) => env.APPDATA ? pathMod.join(env.APPDATA, 'npm') : null,
  (_home, env, pathMod) => env.APPDATA ? existingChildBins(pathMod.join(env.APPDATA, 'fnm', 'node-versions'), pathMod, (child) => pathMod.join(child, 'installation')) : null,
  (home, _env, pathMod) => pathMod.join(home, 'AppData', 'Roaming', 'npm'),
  (home, _env, pathMod) => pathMod.join(home, '.npm-global'),
  (home, _env, pathMod) => pathMod.join(home, '.npm-packages', 'bin'),
  (home, _env, pathMod) => pathMod.join(home, '.volta', 'bin'),
  (home, _env, pathMod) => existingChildBins(pathMod.join(home, '.fnm', 'node-versions'), pathMod, (child) => pathMod.join(child, 'installation')),
  (home, _env, pathMod) => pathMod.join(home, '.bun', 'bin'),
  (home, _env, pathMod) => pathMod.join(home, '.bcode', 'bin'),
  (home, _env, pathMod) => pathMod.join(home, '.deno', 'bin'),
  (home, _env, pathMod) => pathMod.join(home, '.cargo', 'bin'),
  (home, _env, pathMod) => pathMod.join(home, 'scoop', 'shims'),
  (_home, env, pathMod) => env.ProgramData ? pathMod.join(env.ProgramData, 'scoop', 'shims') : pathMod.join('C:\\', 'ProgramData', 'scoop', 'shims'),
  (_home, env, pathMod) => env.ChocolateyInstall ? pathMod.join(env.ChocolateyInstall, 'bin') : pathMod.join('C:\\', 'ProgramData', 'chocolatey', 'bin'),
];

function pathValueFromEnv(env: NodeJS.ProcessEnv, platform: Platform): string {
  if (platform === 'win32') {
    const values = [env.Path, env.PATH].filter((value): value is string => Boolean(value));
    return Array.from(new Set(values)).join(';');
  }
  return env.PATH ?? '';
}

function pathKeyForEnv(env: NodeJS.ProcessEnv, platform: Platform): 'PATH' | 'Path' {
  if (platform === 'win32' && Object.prototype.hasOwnProperty.call(env, 'Path')) return 'Path';
  return 'PATH';
}

export function enrichedPath(base?: string, opts: EnrichOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const home = opts.homedir ?? os.homedir();
  const pathMod = platform === 'win32' ? path.win32 : path.posix;
  const delimiter = platform === 'win32' ? ';' : ':';
  const existing = (base ?? pathValueFromEnv(env, platform)).split(delimiter).filter(Boolean);
  const set = new Set(existing);
  const out = [...existing];

  const addDir = (dir: string): void => {
    if (!set.has(dir)) {
      set.add(dir);
      out.push(dir);
    }
  };

  // First: anything the user's login shell knows about on POSIX — covers
  // custom setups like chruby, asdf, mise, direnv, or ad-hoc PATH exports.
  const shellPath = queryLoginShellPath(env, platform);
  if (shellPath) {
    for (const dir of shellPath.split(delimiter).filter(Boolean)) {
      addDir(dir);
    }
  }

  // Second: a conservative safety net of common binary dirs in case the
  // shell query failed or the platform has no login-shell convention.
  const extraFns = platform === 'win32'
    ? WINDOWS_EXTRA_DIRS_FNS.map((fn) => () => fn(home, env, pathMod))
    : POSIX_EXTRA_DIRS_FNS.map((fn) => () => fn(home, platform, env, pathMod));
  for (const fn of extraFns) {
    const result = fn();
    const dirs = Array.isArray(result) ? result : result ? [result] : [];
    for (const dir of dirs) {
      addDir(dir);
    }
  }
  return out.join(delimiter);
}

export function enrichedEnv(baseEnv: NodeJS.ProcessEnv = process.env, opts: Omit<EnrichOptions, 'env'> = {}): NodeJS.ProcessEnv {
  const platform = opts.platform ?? process.platform;
  const key = pathKeyForEnv(baseEnv, platform);
  return {
    ...baseEnv,
    [key]: enrichedPath(pathValueFromEnv(baseEnv, platform), {
      platform,
      env: baseEnv,
      homedir: opts.homedir,
    }),
  };
}

/**
 * Windows CreateProcess can't execute `.cmd` / `.bat` shims directly — it only
 * runs true `.exe` files. npm-installed CLIs (like `codex`) ship as `.cmd`
 * shims with no `.exe`, so a plain `spawn('codex', …)` returns ENOENT (-4058)
 * even though the command works fine in any shell.
 *
 * `resolveCliSpawn` finds the actual file the OS would run (PATHEXT order),
 * and if it's a `.cmd`/`.bat`, rewrites the call to go through `cmd.exe` with
 * `/d /s /c` so each user-supplied arg stays a separate argv element. This is
 * safer than `shell: true`, which would word-split prompts containing spaces
 * or quotes.
 *
 * On non-Windows platforms it's a no-op (returns the inputs unchanged).
 */
const WIN_SHIM_EXTS = ['.cmd', '.bat', '.ps1'] as const;

function findOnWindowsPath(name: string, env: NodeJS.ProcessEnv): string | null {
  const pathStr = pathValueFromEnv(env, 'win32');
  if (!pathStr) return null;
  const dirs = pathStr.split(';').filter(Boolean);
  // PATHEXT is the canonical search order. We always check `.exe` first so
  // a native binary wins over an npm shim with the same stem.
  const pathExt = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase()).filter(Boolean);
  // Always include .ps1 since npm-installed global CLIs may ship as PowerShell
  // scripts on Windows (e.g. Claude Code's claude.ps1). Insert it before .bat/.cmd
  // so native binaries still win, but working .ps1 shims take precedence over
  // potentially broken/dummy .cmd stubs generated by older npm versions.
  if (!pathExt.includes('.ps1')) {
    const batIdx = pathExt.findIndex((e) => e === '.bat' || e === '.cmd');
    if (batIdx >= 0) pathExt.splice(batIdx, 0, '.ps1');
    else pathExt.push('.ps1');
  }
  const exts = name.includes('.') && pathExt.includes(path.win32.extname(name).toLowerCase())
    ? ['']
    : pathExt;
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.win32.join(dir, name + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* not here, keep looking */ }
    }
  }
  return null;
}

/** Quote one arg the way `cmd.exe` expects when it parses `/c "<cmdline>"`. */
function quoteForCmdExe(arg: string): string {
  if (arg === '') return '""';
  // If no whitespace and no cmd metacharacters, no quoting needed.
  if (!/[\s"&|<>^()%!]/.test(arg)) return arg;
  // Escape embedded double-quotes by doubling them, then wrap in quotes.
  return '"' + arg.replace(/"/g, '""') + '"';
}

export interface ResolvedCli {
  command: string;
  args: string[];
  /** True iff we rewrote the call to go through cmd.exe. */
  viaCmdShell: boolean;
  /** Spread into spawn options. Carries `windowsVerbatimArguments: true`
   *  whenever we hand-built the cmd.exe command line — without it, Node's
   *  libuv `quote_cmd_arg` will re-quote our already-quoted cmdline arg
   *  and cmd.exe ends up trying to execute the entire quoted blob as a
   *  single program name. */
  spawnOptions: { windowsVerbatimArguments?: boolean };
}

export function resolveCliSpawn(
  name: string,
  args: readonly string[],
  opts: { platform?: Platform; env?: NodeJS.ProcessEnv } = {},
): ResolvedCli {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'win32') return { command: name, args: [...args], viaCmdShell: false, spawnOptions: {} };

  const env = opts.env ?? enrichedEnv(process.env, { platform });
  const resolved = findOnWindowsPath(name, env);
  if (!resolved) return { command: name, args: [...args], viaCmdShell: false, spawnOptions: {} };

  const ext = path.win32.extname(resolved).toLowerCase();
  if (!WIN_SHIM_EXTS.includes(ext as (typeof WIN_SHIM_EXTS)[number])) {
    // Native .exe (or .com) — spawn it directly. Use the resolved absolute
    // path so we're not at the mercy of PATH ordering at exec time.
    return { command: resolved, args: [...args], viaCmdShell: false, spawnOptions: {} };
  }

  if (ext === '.ps1') {
    // PowerShell scripts: route through powershell.exe so execution policy
    // and profile loading don't block npm-installed CLIs like claude.ps1.
    return {
      command: 'powershell.exe',
      args: ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', resolved, ...args],
      viaCmdShell: false,
      spawnOptions: {},
    };
  }

  // .cmd / .bat: route through cmd.exe. Each token is quoted independently
  // and joined into ONE string after `/c`, which is the form cmd.exe expects.
  // Wrap the whole cmdline in an extra pair of quotes so `cmd.exe /s` strips
  // the outer layer and leaves the inner quoted tokens intact for parsing.
  // Without this, a leading quote (from a space-containing path like
  // "C:\Program Files\...") gets stripped by /s, breaking the command.
  //
  // CRITICAL: callers MUST spread spawnOptions onto their spawn() call.
  // `windowsVerbatimArguments: true` disables Node's libuv arg re-quoting,
  // which would otherwise wrap our already-quoted cmdline in a SECOND pair
  // of escaped quotes — cmd.exe then sees `"\"path args\""`, the backslashes
  // are literal (cmd doesn't recognize `\"` as an escape), and the whole
  // mess is treated as a single program name. Verified against Win11 +
  // GitHub Actions windows-latest in tests/unit/hl/codexStdinWindows.test.ts.
  const cmdline = [resolved, ...args].map(quoteForCmdExe).join(' ');
  return {
    command: env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${cmdline}"`],
    viaCmdShell: true,
    spawnOptions: { windowsVerbatimArguments: true },
  };
}

export interface CliLaunchSpec extends ResolvedCli {
  env: NodeJS.ProcessEnv;
}

/**
 * High-level router for launching user-installed CLIs from the Electron app.
 *
 * Every call gets a GUI-safe PATH first. On macOS/Linux, that is the main
 * compatibility fix: CLIs installed by Homebrew, pnpm, Volta, asdf, npm,
 * mise, etc. become visible even when the app was opened outside a shell.
 *
 * Windows gets the same PATH enrichment, then adds shim resolution for npm's
 * `.cmd`/`.ps1` launchers so callers can keep passing plain names like
 * `codex` or `claude` without knowing how the package manager installed them.
 */
export function resolveCliLaunch(
  name: string,
  args: readonly string[],
  opts: CliLaunchOptions = {},
): CliLaunchSpec {
  const platform = opts.platform ?? process.platform;
  const env = enrichedEnv(opts.env ?? process.env, {
    platform,
    homedir: opts.homedir,
  });
  const resolved = resolveCliSpawn(name, args, { platform, env });
  return { ...resolved, env };
}
