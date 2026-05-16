/**
 * Startup CLI-flag parsing helpers.
 *
 * Two flags are honored before any store is constructed:
 *
 *   --user-data-dir=<path>    Override userData directory
 *   --remote-debugging-port=<port>  Pick the CDP port exposed by Electron/Chromium
 *
 * Precedence (highest → lowest):
 *   1. CLI flag (`--user-data-dir=…`, `--remote-debugging-port=…`)
 *   2. Env var (`AGB_USER_DATA_DIR`)
 *   3. Default (userData: Electron's platform default; CDP port: random
 *      high localhost port; set AGB_CDP_PORT when a fixed port is required)
 *
 * Kept as a standalone module so it can be unit-tested without booting Electron.
 */

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Extract a `--<flag>=<value>` or `--<flag> <value>` pair from an argv array.
 * Returns `null` when the flag is absent or the value is empty.
 */
export function extractFlagValue(argv: readonly string[], flag: string): string | null {
  const prefix = `--${flag}=`;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith(prefix)) {
      const v = arg.slice(prefix.length);
      return v.length > 0 ? v : null;
    }
    if (arg === `--${flag}`) {
      const next = argv[i + 1];
      if (next !== undefined && next.length > 0 && !next.startsWith('-')) {
        return next;
      }
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// --user-data-dir
// ---------------------------------------------------------------------------

export interface ResolvedUserDataDir {
  value: string | null;
  /** One of 'cli' | 'env' | null — null means caller should leave default. */
  source: 'cli' | 'env' | null;
}

/**
 * Resolve the userData override with explicit precedence.
 *
 * - `--user-data-dir=<path>` on argv wins.
 * - Otherwise `AGB_USER_DATA_DIR` env var (dev fallback for start:fresh scripts).
 * - Otherwise returns `{ value: null, source: null }` so the caller preserves
 *   Electron's platform default.
 */
export function resolveUserDataDir(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): ResolvedUserDataDir {
  const cli = extractFlagValue(argv, 'user-data-dir');
  if (cli) return { value: cli, source: 'cli' };
  const envVal = env.AGB_USER_DATA_DIR;
  if (envVal && envVal.length > 0) return { value: envVal, source: 'env' };
  return { value: null, source: null };
}

// ---------------------------------------------------------------------------
// --remote-debugging-port
// ---------------------------------------------------------------------------

/** Pick from the private/dynamic range by default. 9222 is the Chrome
 *  remote-debugging convention and the first place anti-automation scripts
 *  probe, so only use it when explicitly requested via CLI/env. */
const DEFAULT_MIN_PORT = 49_152;
const DEFAULT_MAX_PORT = 65_535;
/** Sanity cap so a broken port-probe doesn't spin forever; in practice
 *  the first random high-port attempt almost always succeeds. */
const MAX_PORT_WALK = 500;

export interface ResolvedCdpPort {
  /**
   * Port Electron will advertise via `remote-debugging-port`. `0` means
   * Chromium will pick a free port at runtime — the real value has to be
   * discovered from stdout / `/json/version` after launch.
   */
  port: number;
  /** Provenance of the port.
   *   - 'cli'      → --remote-debugging-port=<N> on argv
   *   - 'env'      → AGB_CDP_PORT env var
   *   - 'random'   → started at a random high port, first free port wins
   *   - 'fallback' → the walk hit MAX_PORT_WALK; we returned the start port
   *                  as a last resort and verifyCdpOwnership will surface
   *                  any collision. */
  source: 'cli' | 'env' | 'random' | 'fallback';
  /** When source === 'random', how many ports we skipped before finding one.
   *  0 means the random start port was free on first try. Used in startup logs
   *  to spot chronic collisions without needing a separate metric. */
  walkedFrom?: number;
}

/**
 * Resolve the CDP remote-debugging port.
 *
 * - `--remote-debugging-port=<N>` on argv wins (dev / power-user override).
 * - `AGB_CDP_PORT=<N>` env var second (CI / Docker pinning).
 * - Otherwise choose a random high port and walk until we find a free port.
 *   This avoids advertising a browser automation endpoint on the conventional
 *   Chrome debugging port unless a developer explicitly asks for that.
 */
export function resolveCdpPort(argv: readonly string[]): ResolvedCdpPort {
  const raw = extractFlagValue(argv, 'remote-debugging-port');
  if (raw !== null) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 65535 && String(n) === raw) {
      return { port: n, source: 'cli' };
    }
    // Fall through to env / random high-port selection on a bogus value rather than crashing.
  }
  const envVal = process.env.AGB_CDP_PORT;
  if (envVal) {
    const n = Number.parseInt(envVal, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 65535 && String(n) === envVal) {
      return { port: n, source: 'env' };
    }
  }
  const startPort = randomDefaultCdpPort();
  for (let i = 0; i < MAX_PORT_WALK; i++) {
    const p = DEFAULT_MIN_PORT + ((startPort - DEFAULT_MIN_PORT + i) % (DEFAULT_MAX_PORT - DEFAULT_MIN_PORT + 1));
    if (isPortFreeSync(p)) {
      return { port: p, source: 'random', walkedFrom: i };
    }
  }
  return { port: startPort, source: 'fallback' };
}

function randomDefaultCdpPort(): number {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomInt } = require('node:crypto') as typeof import('node:crypto');
  return randomInt(DEFAULT_MIN_PORT, DEFAULT_MAX_PORT + 1);
}

/**
 * Synchronously check whether a TCP port is already bound on localhost.
 *
 * Uses the OS's native listing command because Node's `net.createServer`
 * is async and we need a blocking answer before `app.commandLine.appendSwitch`
 * runs. `lsof` on POSIX and `netstat` on Windows are installed by default
 * and resolve in ~20ms, so probing a handful of ports is barely perceptible
 * at startup.
 *
 * On any error we return `true` (= port is free). Being optimistic on probe
 * failure keeps startup moving; verifyCdpOwnership() post-boot catches a
 * real collision and logs loudly.
 */
/**
 * Sync probe: is `port` already bound on localhost?
 *
 * Uses OS-native listing tools (`lsof` on POSIX, `netstat` on Windows)
 * because we MUST NOT spawn `process.execPath` here — Electron Forge's
 * `RunAsNode: false` fuse blocks `ELECTRON_RUN_AS_NODE` in packaged
 * builds, so spawning the Electron binary launches the full app
 * (recursive window storm) instead of running our inline script.
 *
 * Probe candidates use absolute paths first (Electron's PATH at launch
 * is often missing /usr/sbin where lsof lives). If no candidate is
 * available we return TRUE (= probably free) and rely on
 * verifyCdpOwnership() to surface real collisions post-boot.
 */
function isPortFreeSync(port: number): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsSync = require('node:fs') as typeof import('node:fs');

  if (process.platform === 'win32') {
    try {
      const res = spawnSync('netstat', ['-an'], { encoding: 'utf8', timeout: 2000 });
      if (res.status !== 0 || !res.stdout) return true;
      const needle = `:${port} `;
      return !res.stdout
        .split(/\r?\n/)
        .some((line) => line.includes(needle) && /LISTENING/i.test(line));
    } catch {
      return true;
    }
  }

  // POSIX: hunt for an absolute lsof path before falling back to PATH.
  const candidates = ['/usr/sbin/lsof', '/usr/bin/lsof'];
  let bin: string | null = null;
  for (const c of candidates) {
    try { if (fsSync.existsSync(c)) { bin = c; break; } } catch { /* try next */ }
  }
  if (!bin) {
    // No absolute lsof found; try PATH lookup as last resort. ENOENT means
    // we can't probe — be optimistic so the walk doesn't spin pointlessly.
    bin = 'lsof';
  }
  try {
    const res = spawnSync(bin, ['-i', `:${port}`, '-sTCP:LISTEN', '-n', '-P'], {
      encoding: 'utf8',
      timeout: 2000,
    });
    // status null/undefined ⇒ ENOENT or signal — be optimistic and let
    // verifyCdpOwnership catch a real collision post-boot.
    if (res.error || res.status === null) return true;
    // lsof exits 1 with empty stdout when there are no matches = port free.
    return (res.stdout ?? '').trim().length === 0;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Module-level shared CDP port
// ---------------------------------------------------------------------------
//
// TabManager and src/main/chrome/ipc.ts both need the CDP port that was
// announced to Electron. They live in separate modules that can't easily
// import from index.ts without creating a cycle, so we stash the resolved
// port here and expose a getter.
//
// index.ts calls setAnnouncedCdpPort() immediately after appending the
// --remote-debugging-port switch; consumers call getAnnouncedCdpPort() at
// use-time. When `port === 0` (OS-assigned) consumers must fall back to
// runtime discovery via `/json/version`.
// ---------------------------------------------------------------------------

// Sentinel until setAnnouncedCdpPort is called at startup. Zero is valid for
// "OS-assigned" too; consumers that see 0 must discover the actual port via
// /json/version rather than use 0 as a TCP port.
let announcedCdpPort: number = 0;

export function setAnnouncedCdpPort(port: number): void {
  announcedCdpPort = port;
}

export function getAnnouncedCdpPort(): number {
  return announcedCdpPort;
}

// ---------------------------------------------------------------------------
// CDP ownership verification
// ---------------------------------------------------------------------------

/**
 * Probe http://127.0.0.1:<port>/json/version and confirm the Browser field
 * looks like an Electron instance (not the user's Chrome). Used at startup
 * to catch port collisions that would otherwise silently hand the agent the
 * wrong CDP endpoint.
 *
 * Returns { ok: true } when the endpoint reports the expected app-level UA,
 * or when it falls back to the Electron/BrowserUse ownership heuristic.
 * Caller is responsible for logging + surfacing errors.
 */
export async function verifyCdpOwnership(
  port: number,
  timeoutMs = 2000,
  expectedUserAgent?: string,
): Promise<{ ok: boolean; browser?: string; userAgent?: string; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const http = require('node:http') as typeof import('node:http');
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/json/version', timeout: timeoutMs },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(buf) as { Browser?: string; 'User-Agent'?: string };
            const browser = parsed.Browser ?? 'unknown';
            const userAgent = parsed['User-Agent'] ?? '';
            // Electron reports its underlying Chromium version in the Browser
            // field (e.g. "Chrome/146.0.7680.188") — the Electron identity is
            // only visible in User-Agent (".../Electron/41.2.1 ..."). Also
            // accept our productName so a renamed/rebranded build is
            // recognised when Electron/ slips.
            const ok = expectedUserAgent
              ? userAgent === expectedUserAgent
              : /\bElectron\//.test(userAgent) || /\bBrowserUse\//.test(userAgent);
            resolve({ ok, browser, userAgent });
          } catch (err) {
            resolve({ ok: false, error: `parse failed: ${(err as Error).message}` });
          }
        });
      },
    );
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}
