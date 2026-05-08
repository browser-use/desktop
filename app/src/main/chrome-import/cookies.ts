import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { pipeline } from 'node:stream/promises';
import { session } from 'electron';
import WebSocket from 'ws';
import { mainLogger } from '../logger';
import {
  chromiumBrowserExecutableCandidates,
  findDefaultChromiumBrowser,
  resolveChromeBrowserProfile,
} from './profiles';

type Platform = NodeJS.Platform;

interface ChromeBinaryOptions {
  platform?: Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}

const SKIP_DIRS = new Set([
  'Service Worker', 'Extensions', 'IndexedDB', 'Local Extension Settings',
  'Local Storage', 'GPUCache', 'Shared Dictionary', 'SharedCache',
]);
const SKIP_FILES = new Set([
  'SingletonLock', 'SingletonSocket', 'SingletonCookie',
  'lockfile', 'RunningChromeVersion', 'History',
]);

const CDP_STARTUP_TIMEOUT_MS = 15000;
const CDP_COOKIE_TIMEOUT_MS = 10000;

function cookieStorePaths(profilePath: string): string[] {
  return [
    path.join(profilePath, 'Cookies'),
    path.join(profilePath, 'Network', 'Cookies'),
  ];
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

async function copyFileByStream(src: string, dst: string): Promise<void> {
  await pipeline(fs.createReadStream(src), fs.createWriteStream(dst));
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
    for (const name of names) {
      const candidate = pathMod.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function chromeBinaryCandidates(opts: ChromeBinaryOptions = {}): string[] {
  return chromiumBrowserExecutableCandidates(opts);
}

export function findChromeBinary(opts: ChromeBinaryOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const browser = findDefaultChromiumBrowser(opts);
  if (browser) return browser.path;
  for (const p of chromeBinaryCandidates(opts)) {
    if (fs.existsSync(p)) return p;
  }
  const onPath = findOnPath(
    ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', ...executableNames('chrome', platform)],
    env,
    platform,
  );
  if (onPath) return onPath;
  throw new Error('Compatible Chromium browser not found. Install a supported browser to import cookies.');
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') { srv.close(); reject(new Error('no port')); return; }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export interface CookieImportResult {
  profileId: string;
  browserName: string;
  profileDirectory: string;
  total: number;
  imported: number;
  failed: number;
  skipped: number;
  domains: string[];
  failedDomains: string[];
  errorReasons: Record<string, number>;
  /** Cookies whose (name, domain, path) triple wasn't in the Electron jar
   *  before this sync. */
  newCookies: number;
  /** Cookies whose (name, domain, path) triple existed but value changed. */
  updatedCookies: number;
  /** Cookies whose (name, domain, path, value) matched what was already there. */
  unchangedCookies: number;
  /** Domains that had zero cookies in the Electron jar before this sync. */
  newDomains: string[];
  /** Domains that already had at least one cookie in the Electron jar. */
  updatedDomains: string[];
}

interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  size: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

function cdpSameSiteToElectron(value?: string): 'unspecified' | 'no_restriction' | 'lax' | 'strict' {
  switch (value) {
    case 'Strict': return 'strict';
    case 'Lax': return 'lax';
    case 'None': return 'no_restriction';
    default: return 'unspecified';
  }
}

async function copyProfileToTemp(profilePath: string, userDataDir: string): Promise<string> {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'chrome-profile-'));
  const destProfile = path.join(tempDir, 'Default');
  const copyFailures: Array<{ relativePath: string; code?: string; error: string }> = [];

  async function copyDir(src: string, dst: string): Promise<void> {
    await fsp.mkdir(dst, { recursive: true });
    let entries;
    try {
      entries = await fsp.readdir(src, { withFileTypes: true });
    } catch (err) {
      mainLogger.debug('chromeImport.copyProfile.readDirFailed', {
        src,
        error: (err as Error).message,
        code: (err as NodeJS.ErrnoException).code,
      });
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await copyDir(path.join(src, entry.name), path.join(dst, entry.name));
      } else {
        if (SKIP_FILES.has(entry.name)) continue;
        const sourceFile = path.join(src, entry.name);
        const destFile = path.join(dst, entry.name);
        try {
          await copyFileByStream(sourceFile, destFile);
        } catch (err) {
          const failure = {
            relativePath: path.relative(profilePath, sourceFile),
            code: (err as NodeJS.ErrnoException).code,
            error: (err as Error).message,
          };
          copyFailures.push(failure);
          if (entry.name === 'Cookies') {
            mainLogger.warn('chromeImport.copyProfile.cookieCopyFailed', {
              ...failure,
              sourceFile,
              destFile,
            });
          } else {
            mainLogger.debug('chromeImport.copyProfile.copyFileFailed', failure);
          }
        }
      }
    }
  }

  await copyDir(profilePath, destProfile);
  try {
    await copyFileByStream(path.join(userDataDir, 'Local State'), path.join(tempDir, 'Local State'));
  } catch {
    // Some profile-like directories do not have a Local State file. The
    // browser can still start with the copied profile, so keep this best-effort.
  }
  if (!cookieStorePaths(destProfile).some((cookiePath) => isReadableFile(cookiePath))) {
    mainLogger.warn('chromeImport.copyProfile.cookieStoreMissingAfterCopy', {
      profilePath,
      userDataDir,
      destProfile,
      attemptedCookieStores: cookieStorePaths(profilePath).map((cookiePath) => ({
        path: cookiePath,
        readable: isReadableFile(cookiePath),
      })),
      failedCopies: copyFailures.slice(0, 20),
      failedCopyCount: copyFailures.length,
    });
    fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw new Error('Could not copy the browser profile cookie store. Close the source browser and check profile file permissions, then try again.');
  }
  mainLogger.info('chromeImport.copyProfile', { src: profilePath, userDataDir, dest: tempDir });
  return tempDir;
}

async function launchChromiumHeadless(
  browserName: string,
  browserPath: string,
  tempUserDataDir: string,
  debugPort: number,
): Promise<ChildProcess> {
  mainLogger.info('chromeImport.launchChromium', { browserName, browserPath, tempUserDataDir, debugPort });

  const proc = spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${tempUserDataDir}`,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrBuf = '';
  proc.stderr?.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString(); });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`${browserName} headless did not start within ${CDP_STARTUP_TIMEOUT_MS}ms.\n\nstderr: ${stderrBuf.slice(0, 500)}`));
    }, CDP_STARTUP_TIMEOUT_MS);

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (text.includes('DevTools listening on')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`${browserName} exited with code ${code}.\n\nstderr: ${stderrBuf.slice(0, 500)}`));
    });
  });

  mainLogger.info('chromeImport.chromiumStarted', { browserName, debugPort });
  return proc;
}

async function getCookiesViaCdp(port: number): Promise<CdpCookie[]> {
  const versionRes = await fetch(`http://127.0.0.1:${port}/json/version`);
  const versionInfo = (await versionRes.json()) as { webSocketDebuggerUrl: string };
  const wsUrl = versionInfo.webSocketDebuggerUrl;

  mainLogger.info('chromeImport.cdpConnect', { wsUrl });

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('CDP cookie fetch timed out'));
    }, CDP_COOKIE_TIMEOUT_MS);

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Storage.getCookies', params: {} }));
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as {
          id?: number;
          result?: { cookies: CdpCookie[] };
          error?: { message: string };
        };
        if (msg.id === 1) {
          clearTimeout(timeout);
          ws.close();
          if (msg.error) reject(new Error(`CDP error: ${msg.error.message}`));
          else resolve(msg.result?.cookies ?? []);
        }
      } catch (err) {
        clearTimeout(timeout);
        ws.close();
        reject(err);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`CDP WebSocket error: ${err.message}`));
    });
  });
}

export async function importChromeProfileCookies(profileId: string): Promise<CookieImportResult> {
  mainLogger.info('chromeImport.importCookies.start', { profileId });

  const sourceProfile = resolveChromeBrowserProfile(profileId);
  const tempDir = await copyProfileToTemp(sourceProfile.profilePath, sourceProfile.userDataDir);
  const debugPort = await getFreePort();

  let proc: ChildProcess | null = null;
  let cookies: CdpCookie[];

  try {
    proc = await launchChromiumHeadless(sourceProfile.browserName, sourceProfile.browserPath, tempDir, debugPort);
    cookies = await getCookiesViaCdp(debugPort);
  } finally {
    if (proc) proc.kill();
    fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  mainLogger.info('chromeImport.importCookies.cookiesFetched', {
    total: cookies.length,
  });

  const electronSession = session.defaultSession;
  let imported = 0;
  let failed = 0;
  let skipped = 0;
  const importedDomains = new Set<string>();
  const failedDomainSet = new Set<string>();
  const errorReasons: Record<string, number> = {};

  // Conservative re-sync: for every domain present in the new Chrome export,
  // wipe the Electron jar's existing cookies on that domain before writing the
  // fresh set. Without this, re-syncing only updates cookies whose
  // (name, domain, path) triple still exists in Chrome — stale cookies (e.g.
  // logged-out sessions, rotated names) linger forever and the agent keeps
  // using outdated state. We only touch domains the user is actually
  // re-importing — cookies for unrelated sites (e.g. ones the agent set
  // itself during a session) are preserved.
  const targetDomains = new Set<string>();
  for (const c of cookies) {
    const d = c.domain.startsWith('.') ? c.domain.substring(1) : c.domain;
    if (d) targetDomains.add(d);
  }

  // Snapshot the pre-clear state so we can diff after import:
  //  - priorValueByKey[key] → previous value (for new vs updated detection)
  //  - priorCountByDomain[domain] → cookie count (for new vs updated domain)
  // Key = `${normalizedDomain}|${path}|${name}`, matching how new cookies are
  // keyed below.
  const priorValueByKey = new Map<string, string>();
  const priorCountByDomain = new Map<string, number>();
  let cleared = 0;
  for (const domain of targetDomains) {
    let existing: Electron.Cookie[];
    try {
      existing = await electronSession.cookies.get({ domain });
    } catch (err) {
      mainLogger.warn('chromeImport.preClear.getFailed', {
        domain,
        error: (err as Error).message,
      });
      continue;
    }
    for (const ec of existing) {
      const host = ec.domain?.startsWith('.') ? ec.domain.substring(1) : ec.domain;
      if (!host) continue;
      const path = ec.path ?? '/';
      const scheme = ec.secure ? 'https' : 'http';
      const url = `${scheme}://${host}${path}`;
      const key = `${host}|${path}|${ec.name}`;
      priorValueByKey.set(key, ec.value);
      priorCountByDomain.set(host, (priorCountByDomain.get(host) ?? 0) + 1);
      try {
        await electronSession.cookies.remove(url, ec.name);
        cleared++;
      } catch (err) {
        mainLogger.debug('chromeImport.preClear.removeFailed', {
          domain: ec.domain,
          name: ec.name,
          error: (err as Error).message,
        });
      }
    }
  }
  mainLogger.info('chromeImport.preClear.done', {
    targetDomains: targetDomains.size,
    cleared,
  });

  let newCookies = 0;
  let updatedCookies = 0;
  let unchangedCookies = 0;

  for (const cookie of cookies) {
    if (!cookie.value || !cookie.name) {
      skipped++;
      continue;
    }

    const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
    const scheme = cookie.secure ? 'https' : 'http';
    const url = `${scheme}://${domain}${cookie.path}`;

    try {
      await electronSession.cookies.set({
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cdpSameSiteToElectron(cookie.sameSite),
        ...(cookie.session ? {} : { expirationDate: cookie.expires }),
      });
      imported++;
      importedDomains.add(domain);

      // Diff against the pre-clear snapshot so the UI can show
      // "X new / Y updated" instead of just a flat imported count.
      const key = `${domain}|${cookie.path}|${cookie.name}`;
      const prior = priorValueByKey.get(key);
      if (prior === undefined) {
        newCookies++;
      } else if (prior !== cookie.value) {
        updatedCookies++;
      } else {
        unchangedCookies++;
      }
    } catch (err) {
      failed++;
      failedDomainSet.add(domain);
      const reason = (err as Error).message || 'Unknown error';
      errorReasons[reason] = (errorReasons[reason] || 0) + 1;
      if (failed <= 20) {
        mainLogger.info('chromeImport.cookieFail', {
          name: cookie.name,
          domain: cookie.domain,
          secure: cookie.secure,
          sameSite: cookie.sameSite,
          error: reason,
        });
      }
    }
  }

  const domains = Array.from(importedDomains);
  const failedDomains = Array.from(failedDomainSet).filter((d) => !importedDomains.has(d));

  // A domain is "new" if the Electron jar held zero cookies for it pre-clear,
  // and "updated" if it held at least one. Failed-only domains aren't counted
  // either way since nothing landed for them.
  const newDomains: string[] = [];
  const updatedDomains: string[] = [];
  for (const d of domains) {
    if ((priorCountByDomain.get(d) ?? 0) > 0) updatedDomains.push(d);
    else newDomains.push(d);
  }

  const result: CookieImportResult = {
    profileId: sourceProfile.id,
    browserName: sourceProfile.browserName,
    profileDirectory: sourceProfile.directory,
    total: cookies.length,
    imported,
    failed,
    skipped,
    domains,
    failedDomains,
    errorReasons,
    newCookies,
    updatedCookies,
    unchangedCookies,
    newDomains,
    updatedDomains,
  };

  mainLogger.info('chromeImport.importCookies.done', {
    total: result.total,
    imported: result.imported,
    failed: result.failed,
    skipped: result.skipped,
    newCookies,
    updatedCookies,
    unchangedCookies,
    newDomainCount: newDomains.length,
    updatedDomainCount: updatedDomains.length,
  });
  return result;
}

export interface SessionCookie {
  name: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  /** Unix seconds, or null for session cookies */
  expires: number | null;
  sameSite: string;
}

/** List every cookie in the app's default Electron session jar. Used by the
 *  Settings + Onboarding cookie viewer so the user can see (and search) what
 *  was actually imported. Read-only — values are not returned. */
export async function listSessionCookies(): Promise<SessionCookie[]> {
  const electronSession = session.defaultSession;
  const all = await electronSession.cookies.get({});
  return all.map((c) => ({
    name: c.name,
    domain: c.domain ?? '',
    path: c.path ?? '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    expires: typeof c.expirationDate === 'number' ? c.expirationDate : null,
    sameSite: c.sameSite ?? 'unspecified',
  }));
}
