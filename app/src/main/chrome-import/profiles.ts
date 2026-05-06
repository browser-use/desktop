import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { mainLogger } from '../logger';

export interface ChromeProfile {
  /** Stable import/sync identity, e.g. "brave:Profile%201". */
  id: string;
  /** Legacy profile folder name, e.g. "Default" or "Profile 1". */
  directory: string;
  browserKey: string;
  browserName: string;
  name: string;
  email: string;
  avatarIcon: string;
}

export interface ResolvedChromeProfile {
  id: string;
  directory: string;
  browserKey: string;
  browserName: string;
  browserPath: string;
  userDataDir: string;
  profilePath: string;
}

type Platform = NodeJS.Platform;

interface ChromePathOptions {
  platform?: Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}

interface BrowserDefinition {
  key: string;
  name: string;
  executableCandidates: (opts: RequiredChromePathOptions) => string[];
  pathNames: string[];
  userDataDirCandidates: (opts: RequiredChromePathOptions) => string[];
}

interface BrowserInstall {
  key: string;
  name: string;
  path: string;
  userDataDir: string;
}

interface RequiredChromePathOptions {
  platform: Platform;
  env: NodeJS.ProcessEnv;
  homedir: string;
  pathMod: typeof path.posix;
}

function pathOptions(opts: ChromePathOptions = {}): RequiredChromePathOptions {
  const platform = opts.platform ?? process.platform;
  return {
    platform,
    env: opts.env ?? process.env,
    homedir: opts.homedir ?? os.homedir(),
    pathMod: platform === 'win32' ? path.win32 : path.posix,
  };
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function macApps(appName: string, executableName = appName, opts: RequiredChromePathOptions): string[] {
  return [
    `/Applications/${appName}.app/Contents/MacOS/${executableName}`,
    opts.pathMod.join(opts.homedir, 'Applications', `${appName}.app`, 'Contents', 'MacOS', executableName),
  ];
}

function browserDefinitions(): BrowserDefinition[] {
  return [
    {
      key: 'google-chrome',
      name: 'Google Chrome',
      executableCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        const programFiles = opts.env.ProgramFiles ?? 'C:\\Program Files';
        const programFilesX86 = opts.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
        if (opts.platform === 'darwin') return macApps('Google Chrome', 'Google Chrome', opts);
        if (opts.platform === 'win32') {
          return [
            opts.pathMod.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            opts.pathMod.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            opts.pathMod.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          ];
        }
        return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
      },
      pathNames: ['google-chrome', 'google-chrome-stable', 'chrome'],
      userDataDirCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        const configHome = opts.env.XDG_CONFIG_HOME ?? opts.pathMod.join(opts.homedir, '.config');
        if (opts.platform === 'darwin') {
          return [opts.pathMod.join(opts.homedir, 'Library', 'Application Support', 'Google', 'Chrome')];
        }
        if (opts.platform === 'win32') {
          return [opts.pathMod.join(localAppData, 'Google', 'Chrome', 'User Data')];
        }
        return [opts.pathMod.join(configHome, 'google-chrome')];
      },
    },
    {
      key: 'google-chrome-canary',
      name: 'Google Chrome Canary',
      executableCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        if (opts.platform === 'darwin') return macApps('Google Chrome Canary', 'Google Chrome Canary', opts);
        if (opts.platform === 'win32') {
          return [opts.pathMod.join(localAppData, 'Google', 'Chrome SxS', 'Application', 'chrome.exe')];
        }
        return ['/usr/bin/google-chrome-unstable'];
      },
      pathNames: ['google-chrome-unstable'],
      userDataDirCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        const configHome = opts.env.XDG_CONFIG_HOME ?? opts.pathMod.join(opts.homedir, '.config');
        if (opts.platform === 'darwin') {
          return [opts.pathMod.join(opts.homedir, 'Library', 'Application Support', 'Google', 'Chrome Canary')];
        }
        if (opts.platform === 'win32') {
          return [opts.pathMod.join(localAppData, 'Google', 'Chrome SxS', 'User Data')];
        }
        return [opts.pathMod.join(configHome, 'google-chrome-unstable')];
      },
    },
    {
      key: 'brave',
      name: 'Brave',
      executableCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        const programFiles = opts.env.ProgramFiles ?? 'C:\\Program Files';
        if (opts.platform === 'darwin') return macApps('Brave Browser', 'Brave Browser', opts);
        if (opts.platform === 'win32') {
          return [
            opts.pathMod.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
            opts.pathMod.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
          ];
        }
        return ['/usr/bin/brave-browser', '/usr/bin/brave', '/snap/bin/brave'];
      },
      pathNames: ['brave-browser', 'brave'],
      userDataDirCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        const configHome = opts.env.XDG_CONFIG_HOME ?? opts.pathMod.join(opts.homedir, '.config');
        if (opts.platform === 'darwin') {
          return [opts.pathMod.join(opts.homedir, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')];
        }
        if (opts.platform === 'win32') {
          return [opts.pathMod.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data')];
        }
        return [opts.pathMod.join(configHome, 'BraveSoftware', 'Brave-Browser')];
      },
    },
    {
      key: 'microsoft-edge',
      name: 'Microsoft Edge',
      executableCandidates: (opts) => {
        const programFiles = opts.env.ProgramFiles ?? 'C:\\Program Files';
        const programFilesX86 = opts.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
        if (opts.platform === 'darwin') return macApps('Microsoft Edge', 'Microsoft Edge', opts);
        if (opts.platform === 'win32') {
          return [
            opts.pathMod.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            opts.pathMod.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          ];
        }
        return ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'];
      },
      pathNames: ['microsoft-edge', 'microsoft-edge-stable', 'msedge'],
      userDataDirCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        const configHome = opts.env.XDG_CONFIG_HOME ?? opts.pathMod.join(opts.homedir, '.config');
        if (opts.platform === 'darwin') {
          return [opts.pathMod.join(opts.homedir, 'Library', 'Application Support', 'Microsoft Edge')];
        }
        if (opts.platform === 'win32') {
          return [opts.pathMod.join(localAppData, 'Microsoft', 'Edge', 'User Data')];
        }
        return [opts.pathMod.join(configHome, 'microsoft-edge')];
      },
    },
    {
      key: 'chromium',
      name: 'Chromium',
      executableCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        const programFiles = opts.env.ProgramFiles ?? 'C:\\Program Files';
        if (opts.platform === 'darwin') return macApps('Chromium', 'Chromium', opts);
        if (opts.platform === 'win32') {
          return [
            opts.pathMod.join(localAppData, 'Chromium', 'Application', 'chrome.exe'),
            opts.pathMod.join(programFiles, 'Chromium', 'Application', 'chrome.exe'),
          ];
        }
        return ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
      },
      pathNames: ['chromium', 'chromium-browser'],
      userDataDirCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        const configHome = opts.env.XDG_CONFIG_HOME ?? opts.pathMod.join(opts.homedir, '.config');
        if (opts.platform === 'darwin') {
          return [opts.pathMod.join(opts.homedir, 'Library', 'Application Support', 'Chromium')];
        }
        if (opts.platform === 'win32') {
          return [opts.pathMod.join(localAppData, 'Chromium', 'User Data')];
        }
        return [opts.pathMod.join(configHome, 'chromium')];
      },
    },
    {
      key: 'arc',
      name: 'Arc',
      executableCandidates: (opts) => opts.platform === 'darwin' ? macApps('Arc', 'Arc', opts) : [],
      pathNames: [],
      userDataDirCandidates: (opts) => opts.platform === 'darwin'
        ? [opts.pathMod.join(opts.homedir, 'Library', 'Application Support', 'Arc', 'User Data')]
        : [],
    },
    {
      key: 'opera',
      name: 'Opera',
      executableCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        const programFiles = opts.env.ProgramFiles ?? 'C:\\Program Files';
        if (opts.platform === 'darwin') return macApps('Opera', 'Opera', opts);
        if (opts.platform === 'win32') {
          return [
            opts.pathMod.join(localAppData, 'Programs', 'Opera', 'opera.exe'),
            opts.pathMod.join(programFiles, 'Opera', 'opera.exe'),
          ];
        }
        return ['/usr/bin/opera', '/snap/bin/opera'];
      },
      pathNames: ['opera'],
      userDataDirCandidates: (opts) => {
        const appData = opts.env.APPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Roaming');
        const configHome = opts.env.XDG_CONFIG_HOME ?? opts.pathMod.join(opts.homedir, '.config');
        if (opts.platform === 'darwin') {
          return [opts.pathMod.join(opts.homedir, 'Library', 'Application Support', 'com.operasoftware.Opera')];
        }
        if (opts.platform === 'win32') {
          return [opts.pathMod.join(appData, 'Opera Software', 'Opera Stable')];
        }
        return [opts.pathMod.join(configHome, 'opera')];
      },
    },
    {
      key: 'vivaldi',
      name: 'Vivaldi',
      executableCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        const programFiles = opts.env.ProgramFiles ?? 'C:\\Program Files';
        if (opts.platform === 'darwin') return macApps('Vivaldi', 'Vivaldi', opts);
        if (opts.platform === 'win32') {
          return [
            opts.pathMod.join(localAppData, 'Vivaldi', 'Application', 'vivaldi.exe'),
            opts.pathMod.join(programFiles, 'Vivaldi', 'Application', 'vivaldi.exe'),
          ];
        }
        return ['/usr/bin/vivaldi', '/usr/bin/vivaldi-stable', '/snap/bin/vivaldi'];
      },
      pathNames: ['vivaldi', 'vivaldi-stable'],
      userDataDirCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        const configHome = opts.env.XDG_CONFIG_HOME ?? opts.pathMod.join(opts.homedir, '.config');
        if (opts.platform === 'darwin') {
          return [opts.pathMod.join(opts.homedir, 'Library', 'Application Support', 'Vivaldi')];
        }
        if (opts.platform === 'win32') {
          return [opts.pathMod.join(localAppData, 'Vivaldi', 'User Data')];
        }
        return [opts.pathMod.join(configHome, 'vivaldi')];
      },
    },
    {
      key: 'yandex',
      name: 'Yandex',
      executableCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        if (opts.platform === 'darwin') return macApps('Yandex', 'Yandex', opts);
        if (opts.platform === 'win32') {
          return [opts.pathMod.join(localAppData, 'Yandex', 'YandexBrowser', 'Application', 'browser.exe')];
        }
        return ['/usr/bin/yandex-browser', '/usr/bin/yandex-browser-stable'];
      },
      pathNames: ['yandex-browser', 'yandex-browser-stable'],
      userDataDirCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        const configHome = opts.env.XDG_CONFIG_HOME ?? opts.pathMod.join(opts.homedir, '.config');
        if (opts.platform === 'darwin') {
          return [opts.pathMod.join(opts.homedir, 'Library', 'Application Support', 'Yandex', 'YandexBrowser')];
        }
        if (opts.platform === 'win32') {
          return [opts.pathMod.join(localAppData, 'Yandex', 'YandexBrowser', 'User Data')];
        }
        return [opts.pathMod.join(configHome, 'yandex-browser')];
      },
    },
    {
      key: 'iridium',
      name: 'Iridium',
      executableCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        if (opts.platform === 'darwin') return macApps('Iridium', 'Iridium', opts);
        if (opts.platform === 'win32') {
          return [opts.pathMod.join(localAppData, 'Iridium', 'Application', 'iridium.exe')];
        }
        return ['/usr/bin/iridium-browser'];
      },
      pathNames: ['iridium-browser', 'iridium'],
      userDataDirCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        const configHome = opts.env.XDG_CONFIG_HOME ?? opts.pathMod.join(opts.homedir, '.config');
        if (opts.platform === 'darwin') {
          return [opts.pathMod.join(opts.homedir, 'Library', 'Application Support', 'Iridium')];
        }
        if (opts.platform === 'win32') {
          return [opts.pathMod.join(localAppData, 'Iridium', 'User Data')];
        }
        return [opts.pathMod.join(configHome, 'iridium')];
      },
    },
    {
      key: 'ungoogled-chromium',
      name: 'Ungoogled Chromium',
      executableCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        if (opts.platform === 'darwin') return macApps('Chromium', 'Chromium', opts);
        if (opts.platform === 'win32') {
          return [opts.pathMod.join(localAppData, 'Chromium', 'Application', 'chrome.exe')];
        }
        return ['/usr/bin/ungoogled-chromium'];
      },
      pathNames: ['ungoogled-chromium'],
      userDataDirCandidates: (opts) => {
        const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
        const configHome = opts.env.XDG_CONFIG_HOME ?? opts.pathMod.join(opts.homedir, '.config');
        if (opts.platform === 'darwin') {
          return [opts.pathMod.join(opts.homedir, 'Library', 'Application Support', 'Chromium')];
        }
        if (opts.platform === 'win32') {
          return [opts.pathMod.join(localAppData, 'Chromium', 'User Data')];
        }
        return [opts.pathMod.join(configHome, 'chromium')];
      },
    },
    ...[
      ['comet', 'Comet'],
      ['helium', 'Helium'],
      ['dia', 'Dia'],
      ['sidekick', 'Sidekick'],
      ['thorium', 'Thorium'],
      ['sigmaos', 'SigmaOS'],
      ['wavebox', 'Wavebox'],
      ['ghost-browser', 'Ghost Browser'],
      ['blisk', 'Blisk'],
    ].map(([key, name]) => extraBrowserDefinition(key, name)),
  ];
}

export function supportedChromiumBrowserKeys(): string[] {
  return browserDefinitions().map((definition) => definition.key);
}

function extraBrowserDefinition(key: string, name: string): BrowserDefinition {
  return {
    key,
    name,
    executableCandidates: (opts) => {
      const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
      if (opts.platform === 'darwin') return macApps(name, name, opts);
      if (opts.platform === 'win32') {
        const executableByKey: Record<string, string> = {
          sidekick: opts.pathMod.join(localAppData, 'Sidekick', 'Application', 'sidekick.exe'),
          thorium: opts.pathMod.join(localAppData, 'Thorium', 'Application', 'thorium.exe'),
          wavebox: opts.pathMod.join(localAppData, 'WaveboxApp', 'Application', 'wavebox.exe'),
          blisk: opts.pathMod.join(localAppData, 'Blisk', 'Application', 'blisk.exe'),
        };
        return executableByKey[key] ? [executableByKey[key]] : [];
      }
      const linuxByKey: Record<string, string[]> = {
        sidekick: [opts.pathMod.join(opts.homedir, '.local', 'share', 'sidekick', 'sidekick')],
        thorium: ['/usr/bin/thorium-browser'],
        wavebox: ['/usr/bin/wavebox'],
      };
      return linuxByKey[key] ?? [];
    },
    pathNames: key === 'thorium' ? ['thorium-browser'] : [key],
    userDataDirCandidates: (opts) => {
      const localAppData = opts.env.LOCALAPPDATA ?? opts.pathMod.join(opts.homedir, 'AppData', 'Local');
      const configHome = opts.env.XDG_CONFIG_HOME ?? opts.pathMod.join(opts.homedir, '.config');
      if (opts.platform === 'darwin') {
        const dirByKey: Record<string, string> = {
          sigmaos: opts.pathMod.join(opts.homedir, 'Library', 'Application Support', 'SigmaOS', 'User Data'),
          wavebox: opts.pathMod.join(opts.homedir, 'Library', 'Application Support', 'WaveboxApp'),
        };
        return [dirByKey[key] ?? opts.pathMod.join(opts.homedir, 'Library', 'Application Support', name)];
      }
      if (opts.platform === 'win32') {
        const dirByKey: Record<string, string> = {
          sidekick: opts.pathMod.join(localAppData, 'Sidekick', 'User Data'),
          thorium: opts.pathMod.join(localAppData, 'Thorium', 'User Data'),
          wavebox: opts.pathMod.join(localAppData, 'WaveboxApp', 'User Data'),
          blisk: opts.pathMod.join(localAppData, 'Blisk', 'User Data'),
        };
        return dirByKey[key] ? [dirByKey[key]] : [];
      }
      const dirByKey: Record<string, string> = {
        sidekick: opts.pathMod.join(configHome, 'Sidekick'),
        thorium: opts.pathMod.join(configHome, 'thorium'),
        wavebox: opts.pathMod.join(configHome, 'Wavebox'),
      };
      return dirByKey[key] ? [dirByKey[key]] : [];
    },
  };
}

function executableNames(name: string, platform: Platform): string[] {
  if (platform !== 'win32') return [name];
  const lower = name.toLowerCase();
  return lower.endsWith('.exe') ? [name] : [name, `${name}.exe`];
}

function findOnPath(names: string[], env: NodeJS.ProcessEnv, platform: Platform): string | null {
  const pathValue = platform === 'win32' ? env.Path ?? env.PATH ?? '' : env.PATH ?? '';
  const delimiter = platform === 'win32' ? ';' : ':';
  const pathMod = platform === 'win32' ? path.win32 : path;
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    for (const name of names.flatMap((n) => executableNames(n, platform))) {
      const candidate = pathMod.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function findBrowserExecutable(definition: BrowserDefinition, opts: RequiredChromePathOptions): string | null {
  for (const candidate of definition.executableCandidates(opts)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return findOnPath(definition.pathNames, opts.env, opts.platform);
}

function detectInstalledChromiumBrowsers(opts: ChromePathOptions = {}): BrowserInstall[] {
  const resolved = pathOptions(opts);
  const installs: BrowserInstall[] = [];
  const seen = new Set<string>();

  for (const definition of browserDefinitions()) {
    const browserPath = findBrowserExecutable(definition, resolved);
    if (!browserPath) continue;

    for (const userDataDir of definition.userDataDirCandidates(resolved)) {
      if (!fs.existsSync(userDataDir)) continue;
      const key = `${definition.key}\0${resolved.pathMod.resolve(userDataDir)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      installs.push({
        key: definition.key,
        name: definition.name,
        path: browserPath,
        userDataDir,
      });
    }
  }

  return installs;
}

export function chromiumBrowserExecutableCandidates(opts: ChromePathOptions = {}): string[] {
  const resolved = pathOptions(opts);
  return uniq(browserDefinitions().flatMap((definition) => definition.executableCandidates(resolved)));
}

export function findDefaultChromiumBrowser(opts: ChromePathOptions = {}): BrowserInstall | null {
  return detectInstalledChromiumBrowsers(opts)[0] ?? null;
}

export function getChromeUserDataDirCandidates(opts: ChromePathOptions = {}): string[] {
  const resolved = pathOptions(opts);
  return uniq(browserDefinitions().flatMap((definition) => definition.userDataDirCandidates(resolved)));
}

export function getChromeUserDataDir(opts: ChromePathOptions = {}): string {
  const candidates = getChromeUserDataDirCandidates(opts);
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'Local State'))) return candidate;
  }
  return candidates[0];
}

function isReadableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function hasReadableCookieStore(userDataDir: string, profileDir: string): boolean {
  return [
    path.join(userDataDir, profileDir, 'Cookies'),
    path.join(userDataDir, profileDir, 'Network', 'Cookies'),
  ].some((cookiePath) => isReadableFile(cookiePath));
}

function isLikelyProfile(userDataDir: string, profileDir: string): boolean {
  return [
    path.join(userDataDir, profileDir, 'Preferences'),
    path.join(userDataDir, profileDir, 'History'),
    path.join(userDataDir, profileDir, 'Cookies'),
    path.join(userDataDir, profileDir, 'Network', 'Cookies'),
  ].some((candidate) => fs.existsSync(candidate));
}

function assertProfileDirectory(profileDir: string): void {
  if (!profileDir || path.isAbsolute(profileDir) || path.win32.isAbsolute(profileDir)) {
    throw new Error('Invalid browser profile directory');
  }
  if (profileDir.includes('/') || profileDir.includes('\\') || profileDir === '.' || profileDir === '..') {
    throw new Error('Invalid browser profile directory');
  }
}

function resolveProfilePath(userDataDir: string, profileDir: string, opts: ChromePathOptions = {}): string {
  const resolvedOpts = pathOptions(opts);
  assertProfileDirectory(profileDir);
  const resolved = resolvedOpts.pathMod.resolve(userDataDir, profileDir);
  const root = resolvedOpts.pathMod.resolve(userDataDir);
  if (resolved !== root && resolved.startsWith(root + resolvedOpts.pathMod.sep)) return resolved;
  throw new Error('Invalid browser profile directory');
}

export function resolveChromeProfilePath(profileDir: string, opts: ChromePathOptions = {}): string {
  const userDataDir = getChromeUserDataDir(opts);
  return resolveProfilePath(userDataDir, profileDir, opts);
}

function makeProfileId(browserKey: string, profileDir: string): string {
  return `${browserKey}:${encodeURIComponent(profileDir)}`;
}

function parseProfileId(profileRef: string): { browserKey: string; profileDir: string } | null {
  const separator = profileRef.indexOf(':');
  if (separator < 1) return null;
  const browserKey = profileRef.slice(0, separator);
  const encodedProfileDir = profileRef.slice(separator + 1);
  if (!browserKey || !encodedProfileDir) return null;
  try {
    return { browserKey, profileDir: decodeURIComponent(encodedProfileDir) };
  } catch {
    throw new Error('Invalid browser profile directory');
  }
}

function naturalLess(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) < 0;
}

interface LocalStateProfile {
  name?: string;
  gaia_name?: string;
  user_name?: string;
  avatar_icon?: string;
}

function loadProfileInfo(userDataDir: string): Record<string, LocalStateProfile> {
  const localStatePath = path.join(userDataDir, 'Local State');
  if (!fs.existsSync(localStatePath)) return {};

  try {
    const raw = fs.readFileSync(localStatePath, 'utf-8');
    const localState = JSON.parse(raw) as {
      profile?: {
        info_cache?: Record<string, LocalStateProfile>;
      };
    };
    return localState.profile?.info_cache ?? {};
  } catch (err) {
    mainLogger.warn('chromeImport.detectProfiles.parseLocalStateError', {
      path: localStatePath,
      error: (err as Error).message,
    });
    return {};
  }
}

function detectProfilesForBrowser(browser: BrowserInstall): ChromeProfile[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(browser.userDataDir, { withFileTypes: true });
  } catch (err) {
    mainLogger.debug('chromeImport.detectProfiles.readUserDataDirFailed', {
      browser: browser.name,
      userDataDir: browser.userDataDir,
      error: (err as Error).message,
    });
    return [];
  }

  const infoCache = loadProfileInfo(browser.userDataDir);
  const profiles: ChromeProfile[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const profileDir = entry.name;
    if (!isLikelyProfile(browser.userDataDir, profileDir)) continue;
    if (!hasReadableCookieStore(browser.userDataDir, profileDir)) {
      mainLogger.debug('chromeImport.detectProfiles.noReadableCookiesDb', {
        browser: browser.name,
        dir: profileDir,
      });
      continue;
    }

    const info = infoCache[profileDir] ?? {};
    profiles.push({
      id: makeProfileId(browser.key, profileDir),
      directory: profileDir,
      browserKey: browser.key,
      browserName: browser.name,
      name: info.gaia_name || info.name || profileDir,
      email: info.user_name || '',
      avatarIcon: info.avatar_icon || '',
    });
  }

  profiles.sort((a, b) => {
    if (a.directory === 'Default') return -1;
    if (b.directory === 'Default') return 1;
    return naturalLess(a.directory, b.directory) ? -1 : 1;
  });

  return profiles;
}

export function detectChromeProfiles(opts: ChromePathOptions = {}): ChromeProfile[] {
  const browsers = detectInstalledChromiumBrowsers(opts);
  const profiles = browsers.flatMap((browser) => detectProfilesForBrowser(browser));

  mainLogger.info('chromeImport.detectProfiles.ok', {
    browserCount: browsers.length,
    profileCount: profiles.length,
    profiles: profiles.map((profile) => ({
      id: profile.id,
      browserKey: profile.browserKey,
      browser: profile.browserName,
      directory: profile.directory,
    })),
  });

  return profiles;
}

export function resolveChromeBrowserProfile(profileRef: string, opts: ChromePathOptions = {}): ResolvedChromeProfile {
  const resolvedOpts = pathOptions(opts);
  const parsed = parseProfileId(profileRef);

  if (parsed) {
    assertProfileDirectory(parsed.profileDir);
    const browser = detectInstalledChromiumBrowsers(opts).find((install) => install.key === parsed.browserKey);
    if (!browser) throw new Error('Browser profile source not found. Refresh profiles and try again.');
    const profilePath = resolveProfilePath(browser.userDataDir, parsed.profileDir, opts);
    if (!fs.existsSync(profilePath)) throw new Error('Browser profile source not found. Refresh profiles and try again.');
    return {
      id: makeProfileId(browser.key, parsed.profileDir),
      directory: parsed.profileDir,
      browserKey: browser.key,
      browserName: browser.name,
      browserPath: browser.path,
      userDataDir: browser.userDataDir,
      profilePath,
    };
  }

  // Backward-compatible path for callers that still pass only "Default".
  assertProfileDirectory(profileRef);
  const profilePath = resolveChromeProfilePath(profileRef, opts);
  if (!fs.existsSync(profilePath)) throw new Error('Browser profile source not found. Refresh profiles and try again.');
  const userDataDir = resolvedOpts.pathMod.dirname(profilePath);
  const browser = detectInstalledChromiumBrowsers(opts).find((install) => (
    resolvedOpts.pathMod.resolve(install.userDataDir) === resolvedOpts.pathMod.resolve(userDataDir)
  )) ?? findDefaultChromiumBrowser(opts);

  if (!browser) throw new Error('Compatible Chromium browser not found. Install a supported browser to import cookies.');

  return {
    id: makeProfileId(browser.key, profileRef),
    directory: profileRef,
    browserKey: browser.key,
    browserName: browser.name,
    browserPath: browser.path,
    userDataDir,
    profilePath,
  };
}
