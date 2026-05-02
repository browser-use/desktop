import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { mainLogger } from '../logger';

export interface ChromeProfile {
  directory: string;
  name: string;
  email: string;
  avatarIcon: string;
}

type Platform = NodeJS.Platform;

interface ChromePathOptions {
  platform?: Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}

export function getChromeUserDataDirCandidates(opts: ChromePathOptions = {}): string[] {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const home = opts.homedir ?? os.homedir();
  const pathMod = platform === 'win32' ? path.win32 : path;

  if (platform === 'darwin') {
    return [
      pathMod.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
      pathMod.join(home, 'Library', 'Application Support', 'Chromium'),
      pathMod.join(home, 'Library', 'Application Support', 'Google', 'Chrome Canary'),
    ];
  }

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA ?? pathMod.join(home, 'AppData', 'Local');
    return [
      pathMod.join(localAppData, 'Google', 'Chrome', 'User Data'),
      pathMod.join(localAppData, 'Google', 'Chrome SxS', 'User Data'),
      pathMod.join(localAppData, 'Chromium', 'User Data'),
    ];
  }

  const configHome = env.XDG_CONFIG_HOME ?? pathMod.join(home, '.config');
  return [
    pathMod.join(configHome, 'google-chrome'),
    pathMod.join(configHome, 'google-chrome-beta'),
    pathMod.join(configHome, 'google-chrome-unstable'),
    pathMod.join(configHome, 'chromium'),
  ];
}

export function getChromeUserDataDir(opts: ChromePathOptions = {}): string {
  const candidates = getChromeUserDataDirCandidates(opts);
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'Local State'))) return candidate;
  }
  return candidates[0];
}

function hasCookieStore(userDataDir: string, profileDir: string): boolean {
  return [
    path.join(userDataDir, profileDir, 'Cookies'),
    path.join(userDataDir, profileDir, 'Network', 'Cookies'),
  ].some((cookiePath) => fs.existsSync(cookiePath));
}

export function resolveChromeProfilePath(profileDir: string, opts: ChromePathOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  const pathMod = platform === 'win32' ? path.win32 : path;
  if (!profileDir || pathMod.isAbsolute(profileDir)) {
    throw new Error('Invalid Chrome profile directory');
  }
  const userDataDir = getChromeUserDataDir(opts);
  const resolved = pathMod.resolve(userDataDir, profileDir);
  const root = pathMod.resolve(userDataDir);
  if (resolved !== root && resolved.startsWith(root + pathMod.sep)) return resolved;
  throw new Error('Invalid Chrome profile directory');
}

export function detectChromeProfiles(): ChromeProfile[] {
  const chromeUserDataDir = getChromeUserDataDir();
  const localStatePath = path.join(chromeUserDataDir, 'Local State');

  if (!fs.existsSync(localStatePath)) {
    mainLogger.warn('chromeImport.detectProfiles.noLocalState', {
      path: localStatePath,
    });
    return [];
  }

  let localState: {
    profile?: {
      info_cache?: Record<string, {
        name?: string;
        gaia_name?: string;
        user_name?: string;
        avatar_icon?: string;
      }>;
    };
  };

  try {
    const raw = fs.readFileSync(localStatePath, 'utf-8');
    localState = JSON.parse(raw);
  } catch (err) {
    mainLogger.error('chromeImport.detectProfiles.parseError', {
      error: (err as Error).message,
    });
    return [];
  }

  const infoCache = localState?.profile?.info_cache;
  if (!infoCache) {
    mainLogger.warn('chromeImport.detectProfiles.noInfoCache');
    return [];
  }

  const profiles: ChromeProfile[] = [];

  for (const [dir, info] of Object.entries(infoCache)) {
    if (!hasCookieStore(chromeUserDataDir, dir)) {
      mainLogger.debug('chromeImport.detectProfiles.noCookiesDb', { dir });
      continue;
    }

    profiles.push({
      directory: dir,
      name: info.gaia_name || info.name || dir,
      email: info.user_name || '',
      avatarIcon: info.avatar_icon || '',
    });
  }

  mainLogger.info('chromeImport.detectProfiles.ok', {
    profileCount: profiles.length,
    directories: profiles.map((p) => p.directory),
  });

  return profiles;
}
