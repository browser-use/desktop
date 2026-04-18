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
 *   3. Default (userData: Electron's platform default; CDP port: 9222 so
 *      the Docker agent containers can reach `host.docker.internal:9222`)
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

/** Default CDP port kept for Docker agent containers that hardcode 9222. */
export const DEFAULT_CDP_PORT = 9222;

export interface ResolvedCdpPort {
  /**
   * Port Electron will advertise via `remote-debugging-port`. `0` means
   * Chromium will pick a free port at runtime — the real value has to be
   * discovered from stdout / `/json/version` after launch.
   */
  port: number;
  /** Whether the caller supplied a port (so we should NOT pick the default). */
  source: 'cli' | 'default';
}

/**
 * Resolve the CDP remote-debugging port.
 *
 * - `--remote-debugging-port=<N>` on argv wins. `0` (OS-assigned) is honored.
 * - Otherwise returns `DEFAULT_CDP_PORT` (9222) so the Docker agent
 *   containers that hardcode `host.docker.internal:9222` keep working.
 *
 * An invalid or negative port in argv is rejected (falls back to default)
 * rather than silently crashing Electron at launch.
 */
export function resolveCdpPort(argv: readonly string[]): ResolvedCdpPort {
  const raw = extractFlagValue(argv, 'remote-debugging-port');
  if (raw === null) {
    return { port: DEFAULT_CDP_PORT, source: 'default' };
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > 65535 || String(n) !== raw) {
    return { port: DEFAULT_CDP_PORT, source: 'default' };
  }
  return { port: n, source: 'cli' };
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

let announcedCdpPort: number = DEFAULT_CDP_PORT;

export function setAnnouncedCdpPort(port: number): void {
  announcedCdpPort = port;
}

export function getAnnouncedCdpPort(): number {
  return announcedCdpPort;
}
