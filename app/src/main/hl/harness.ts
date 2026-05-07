/**
 * Harness directory bootstrap: seeds `<userData>/harness/` with the Browser
 * Harness JS runtime and app-specific AGENTS.md. Agents drive the assigned
 * browser target through the vendored `browser-harness-js` CLI. No tool schema,
 * no dispatcher.
 *
 * Stock content is bundled via Vite's `?raw` import modifier.
 *
 * Domain skills (`./stock/domain-skills/`) and interaction skills
 * (`./stock/interaction-skills/`) are separate, read-only reference folders.
 * They are fully re-materialized on every launch — the agent consults them but
 * must not edit them (upgrades will clobber any changes).
 */

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { mainLogger } from '../logger';

import STOCK_HELPERS_JS from './stock/helpers.js?raw';
import STOCK_SKILL_MD from './stock/AGENTS.md?raw';

// Bundled domain-skills tree. Vite eagerly inlines every file under
// stock/domain-skills/ as a raw string at build time. Keys are the full
// module path; strip the prefix to get the in-tree relative path.
const DOMAIN_SKILLS_PREFIX = './stock/domain-skills/';
const STOCK_DOMAIN_SKILLS = import.meta.glob('./stock/domain-skills/**/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const INTERACTION_SKILLS_PREFIX = './stock/interaction-skills/';
const STOCK_INTERACTION_SKILLS = import.meta.glob('./stock/interaction-skills/**/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const BROWSER_HARNESS_JS_PREFIX = './stock/browser-harness-js/';
const STOCK_BROWSER_HARNESS_JS = import.meta.glob('./stock/browser-harness-js/**/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export function harnessDir(): string {
  return path.join(app.getPath('userData'), 'harness');
}

export function helpersPath(): string { return path.join(harnessDir(), 'helpers.js'); }
export function toolsPath(): string { return path.join(harnessDir(), 'TOOLS.json'); }
export function skillPath(): string { return path.join(harnessDir(), 'AGENTS.md'); }
export function domainSkillsDir(): string { return path.join(harnessDir(), 'domain-skills'); }
export function interactionSkillsDir(): string { return path.join(harnessDir(), 'interaction-skills'); }
export function browserHarnessJsDir(): string { return path.join(harnessDir(), 'browser-harness-js'); }

/**
 * Ensure `<userData>/harness/` exists and contains the stock files.
 * - Writes helpers.js if missing OR if the on-disk version predates the
 *   browser-harness-js bridge.
 * - Writes AGENTS.md if missing or stale.
 * - Removes stale TOOLS.json from the legacy dispatcher path.
 * - Fully replaces Browser Harness JS runtime, domain skills, and interaction
 *   skills from the bundle.
 * Manual edits to the up-to-date helpers.js / AGENTS.md are preserved as an
 * escape hatch, but app-spawned agents should normally use the bundled CLI.
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
  const needsHelpers = !fs.existsSync(hp) || (() => {
    try { return !fs.readFileSync(hp, 'utf-8').includes('browser-harness-js bridge'); }
    catch { return true; }
  })();
  if (needsHelpers) {
    fs.writeFileSync(hp, STOCK_HELPERS_JS as string, 'utf-8');
    mainLogger.info('harness.bootstrap.wroteHelpers', { path: hp, bytes: (STOCK_HELPERS_JS as string).length });
  }

  const sp = skillPath();
  // Staleness marker bumps force a one-time rewrite of AGENTS.md for
  // existing users. AGENTS.md is the harness manual, not agent-editable
  // state — safe to overwrite so new sections (domain-skills, etc.) land
  // without the user deleting their userData.
  const sentinel = 'Browser Harness JS';
  const needsSkill = !fs.existsSync(sp) || (() => {
    try { return !fs.readFileSync(sp, 'utf-8').includes(sentinel); }
    catch { return true; }
  })();
  if (needsSkill) {
    fs.writeFileSync(sp, STOCK_SKILL_MD as string, 'utf-8');
    mainLogger.info('harness.bootstrap.wroteSkill', { path: sp, bytes: (STOCK_SKILL_MD as string).length });
  }

  removeLegacyToolsJson();

  materializeBrowserHarnessJs();
  materializeInteractionSkills();
  materializeDomainSkills();
}

/**
 * Wipe and rewrite `<userData>/harness/domain-skills/` from the bundled
 * stock. Domain skills are upstream-owned reference material; full replace
 * on every launch keeps users in lockstep with whatever shipped in this
 * app version and lets us delete retired skills.
 */
function materializeDomainSkills(): void {
  materializeRawTree({
    target: domainSkillsDir(),
    prefix: DOMAIN_SKILLS_PREFIX,
    entries: Object.entries(STOCK_DOMAIN_SKILLS),
    logName: 'domainSkills',
    emptyHint: 'run `yarn sync-domain-skills` to populate stock/',
  });
}

function materializeInteractionSkills(): void {
  materializeRawTree({
    target: interactionSkillsDir(),
    prefix: INTERACTION_SKILLS_PREFIX,
    entries: Object.entries(STOCK_INTERACTION_SKILLS),
    logName: 'interactionSkills',
  });
}

function materializeBrowserHarnessJs(): void {
  materializeRawTree({
    target: browserHarnessJsDir(),
    prefix: BROWSER_HARNESS_JS_PREFIX,
    entries: Object.entries(STOCK_BROWSER_HARNESS_JS),
    logName: 'browserHarnessJs',
    executableBasenames: new Set(['browser-harness-js']),
  });
}

function removeLegacyToolsJson(): void {
  const tp = toolsPath();
  if (!fs.existsSync(tp)) return;
  try {
    fs.rmSync(tp, { force: true });
    mainLogger.info('harness.bootstrap.removedLegacyTools', { path: tp });
  } catch (err) {
    mainLogger.warn('harness.bootstrap.removeLegacyTools.failed', { path: tp, error: (err as Error).message });
  }
}

function materializeRawTree(opts: {
  target: string;
  prefix: string;
  entries: Array<[string, string]>;
  logName: string;
  emptyHint?: string;
  executableBasenames?: Set<string>;
}): void {
  const { target, prefix, entries, logName, emptyHint, executableBasenames } = opts;
  if (entries.length === 0) {
    mainLogger.warn(`harness.bootstrap.${logName}.empty`, emptyHint ? { hint: emptyHint } : {});
    return;
  }

  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (err) {
    mainLogger.error(`harness.bootstrap.${logName}.clear.failed`, { target, error: (err as Error).message });
    throw err;
  }

  let bytes = 0;
  for (const [modulePath, content] of entries) {
    const rel = modulePath.slice(prefix.length);
    const outPath = path.join(target, rel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, 'utf-8');
    if (executableBasenames?.has(path.basename(outPath))) fs.chmodSync(outPath, 0o755);
    bytes += content.length;
  }

  mainLogger.info(`harness.bootstrap.${logName}.wrote`, { target, files: entries.length, bytes });
}
