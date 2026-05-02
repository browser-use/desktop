/**
 * Harness directory bootstrap: seeds `<userData>/harness/` with the stock
 * `helpers.js` + `SKILL.md`. The agent (Claude Code subprocess) reads and
 * edits these files freely. No tool schema, no dispatcher — helpers.js is
 * a plain Node library that the agent invokes from its own shell tool.
 *
 * Stock content is bundled via Vite's `?raw` import modifier.
 *
 * Domain skills (`./stock/domain-skills/`) are a separate, read-only
 * reference folder pulled from browser-use/harnessless. Unlike helpers.js,
 * they are fully re-materialized on every launch — the agent consults them
 * but must not edit them (upgrades will clobber any changes).
 */

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { mainLogger } from '../logger';

import STOCK_HELPERS_JS from './stock/helpers.js?raw';
import STOCK_TOOLS_JSON from './stock/TOOLS.json?raw';
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

export function harnessDir(): string {
  return path.join(app.getPath('userData'), 'harness');
}

export function helpersPath(): string { return path.join(harnessDir(), 'helpers.js'); }
export function toolsPath(): string { return path.join(harnessDir(), 'TOOLS.json'); }
export function skillPath(): string { return path.join(harnessDir(), 'AGENTS.md'); }
export function domainSkillsDir(): string { return path.join(harnessDir(), 'domain-skills'); }

/**
 * Ensure `<userData>/harness/` exists and contains the stock files.
 * - Writes helpers.js if missing OR if the on-disk version is the legacy
 *   dispatcher-style (didn't export `createContext`).
 * - Writes SKILL.md if missing.
 * - Writes TOOLS.json if missing (retained for the legacy Anthropic-SDK
 *   agent loop; safe to ignore under the claude-subprocess path).
 * - Fully replaces `<userData>/harness/domain-skills/` from the bundle.
 * User edits to the up-to-date helpers.js / SKILL.md are preserved.
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
    try { return !fs.readFileSync(hp, 'utf-8').includes('createContext'); }
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
  const sentinel = 'Domain skills (read-only reference)';
  const needsSkill = !fs.existsSync(sp) || (() => {
    try { return !fs.readFileSync(sp, 'utf-8').includes(sentinel); }
    catch { return true; }
  })();
  if (needsSkill) {
    fs.writeFileSync(sp, STOCK_SKILL_MD as string, 'utf-8');
    mainLogger.info('harness.bootstrap.wroteSkill', { path: sp, bytes: (STOCK_SKILL_MD as string).length });
  }

  const tp = toolsPath();
  if (!fs.existsSync(tp)) {
    fs.writeFileSync(tp, STOCK_TOOLS_JSON as string, 'utf-8');
    mainLogger.info('harness.bootstrap.wroteTools', { path: tp, bytes: (STOCK_TOOLS_JSON as string).length });
  }

  materializeDomainSkills();
}

/**
 * Wipe and rewrite `<userData>/harness/domain-skills/` from the bundled
 * stock. Domain skills are upstream-owned reference material; full replace
 * on every launch keeps users in lockstep with whatever shipped in this
 * app version and lets us delete retired skills.
 */
function materializeDomainSkills(): void {
  const target = domainSkillsDir();
  const entries = Object.entries(STOCK_DOMAIN_SKILLS);
  if (entries.length === 0) {
    mainLogger.warn('harness.bootstrap.domainSkills.empty', { hint: 'run `yarn sync-domain-skills` to populate stock/' });
    return;
  }

  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (err) {
    mainLogger.error('harness.bootstrap.domainSkills.clear.failed', { target, error: (err as Error).message });
    throw err;
  }

  let bytes = 0;
  for (const [modulePath, content] of entries) {
    const rel = modulePath.slice(DOMAIN_SKILLS_PREFIX.length);
    const outPath = path.join(target, rel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, 'utf-8');
    bytes += content.length;
  }

  mainLogger.info('harness.bootstrap.domainSkills.wrote', { target, files: entries.length, bytes });
}
