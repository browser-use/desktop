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

const CHROME_USER_DATA_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Google',
  'Chrome',
);

export function getChromeUserDataDir(): string {
  return CHROME_USER_DATA_DIR;
}

export function detectChromeProfiles(): ChromeProfile[] {
  const localStatePath = path.join(CHROME_USER_DATA_DIR, 'Local State');

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
    const cookiesPath = path.join(CHROME_USER_DATA_DIR, dir, 'Cookies');
    if (!fs.existsSync(cookiesPath)) {
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
