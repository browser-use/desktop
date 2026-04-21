/**
 * Editable harness: bootstrap + hot-reload of `helpers.js` + `TOOLS.json` from
 * `<userData>/harness/`.
 *
 * The agent can edit `helpers.js` (write new functions, patch existing ones)
 * and update `TOOLS.json` (add/remove tool schemas). The loader re-reads both
 * files every iteration — a pristine `require` for the JS module and a fresh
 * `JSON.parse` for the schemas. Changes land in the very next iteration.
 *
 * Stock content (shipped with the app binary) is embedded via Vite's `?raw`
 * import modifier — no forge asset-copy config needed. On first run, or if
 * the user hits "Reset harness" in settings, the stock content is written to
 * disk. After that, the files are user-owned.
 */

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { mainLogger } from '../logger';
import type { HlContext } from './context';

// Vite's `?raw` suffix bundles the file contents as a string at build time.
// This keeps the stock helpers in source control (editable .js / .json) and
// ships them with the app without any extra-resource wiring.
// @ts-expect-error — Vite raw-import modifier
import STOCK_HELPERS_JS from './stock/helpers.js?raw';
// @ts-expect-error — Vite raw-import modifier
import STOCK_TOOLS_JSON from './stock/TOOLS.json?raw';

export interface HarnessTool {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export interface LoadedHarness {
  /** Tool definitions as the Anthropic API expects them. */
  tools: HarnessTool[];
  /** Dispatch a tool call by name. Throws if the name is unknown. */
  dispatch: (ctx: HlContext, name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Absolute path of the loaded helpers.js (for system-prompt injection). */
  helpersPath: string;
  /** Absolute path of the loaded TOOLS.json. */
  toolsPath: string;
}

function harnessDir(): string {
  return path.join(app.getPath('userData'), 'harness');
}

export function helpersPath(): string {
  return path.join(harnessDir(), 'helpers.js');
}

export function toolsPath(): string {
  return path.join(harnessDir(), 'TOOLS.json');
}

/**
 * Ensure `<userData>/harness/` exists and contains helpers.js + TOOLS.json.
 * Does NOT overwrite existing files — user edits survive app upgrades.
 * Call once at app startup.
 */
export function bootstrapHarness(): void {
  const dir = harnessDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    mainLogger.error('harness.bootstrap.mkdir.failed', { dir, error: (err as Error).message });
    throw err;
  }

  const hp = helpersPath();
  if (!fs.existsSync(hp)) {
    fs.writeFileSync(hp, STOCK_HELPERS_JS as string, 'utf-8');
    mainLogger.info('harness.bootstrap.wroteHelpers', { path: hp, bytes: (STOCK_HELPERS_JS as string).length });
  }

  const tp = toolsPath();
  if (!fs.existsSync(tp)) {
    fs.writeFileSync(tp, STOCK_TOOLS_JSON as string, 'utf-8');
    mainLogger.info('harness.bootstrap.wroteTools', { path: tp, bytes: (STOCK_TOOLS_JSON as string).length });
  }
}

/**
 * Restore helpers.js + TOOLS.json to stock. Destroys user edits —
 * caller is expected to confirm with the user first.
 */
export function resetHarness(): void {
  const hp = helpersPath();
  const tp = toolsPath();
  fs.writeFileSync(hp, STOCK_HELPERS_JS as string, 'utf-8');
  fs.writeFileSync(tp, STOCK_TOOLS_JSON as string, 'utf-8');
  mainLogger.warn('harness.reset', { helpersPath: hp, toolsPath: tp });
}

/**
 * Load harness fresh: invalidate require cache for helpers.js, re-read
 * TOOLS.json from disk. Returns a `dispatch` function bound to the newly
 * loaded module. Call this EVERY agent iteration before sending to the API
 * so edits take effect immediately.
 *
 * Errors in helpers.js (e.g. SyntaxError) are thrown — the caller handles
 * surfacing them to the model as a tool_result with is_error=true.
 */
export function loadHarness(): LoadedHarness {
  const hp = helpersPath();
  const tp = toolsPath();

  // Read tool schemas fresh.
  const rawTools = fs.readFileSync(tp, 'utf-8');
  let tools: HarnessTool[];
  try {
    tools = JSON.parse(rawTools) as HarnessTool[];
  } catch (err) {
    throw new Error(`harness TOOLS.json parse error: ${(err as Error).message}`);
  }
  if (!Array.isArray(tools)) throw new Error('harness TOOLS.json must be an array');

  // Invalidate the require cache so the next require() returns a fresh module.
  // We use resolve+delete rather than uncache'ing the whole tree because the
  // helpers require Node's built-ins — those should stay cached.
  const resolved = require.resolve(hp);
  delete require.cache[resolved];

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(resolved) as {
    dispatch?: Record<string, (ctx: HlContext, args: Record<string, unknown>) => Promise<unknown>>;
  };
  const table = mod.dispatch;
  if (!table || typeof table !== 'object') {
    throw new Error(`harness helpers.js must export a \`dispatch\` object keyed by tool name`);
  }

  const dispatch = async (ctx: HlContext, name: string, args: Record<string, unknown>): Promise<unknown> => {
    const fn = table[name];
    if (typeof fn !== 'function') {
      throw new Error(`harness has no dispatcher for tool "${name}". Add one to helpers.js module.exports.dispatch.`);
    }
    return fn(ctx, args);
  };

  return { tools, dispatch, helpersPath: hp, toolsPath: tp };
}
