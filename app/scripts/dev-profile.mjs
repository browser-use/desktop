#!/usr/bin/env node
/**
 * Manage local development userData profiles.
 *
 * Default per-worktree profiles live under:
 *   <repo>/.task/user-data/<current-branch>
 *
 * Quit Browser Use before copy/clean operations. SQLite and Electron can keep
 * files open while the app is running, and local-task-server.json is per-run
 * control state that must not be cloned between profiles.
 */

import { execFileSync, execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(__dirname, '..');
const REPO_ROOT = resolve(APP_DIR, '..');
const DEV_PROFILE_ROOT = join(REPO_ROOT, '.task', 'user-data');
const SESSION_SCHEMA_MANIFEST = join(APP_DIR, 'src', 'main', 'sessions', 'schema-manifest.json');
const SESSION_SCHEMA_QUERY = `
  SELECT type, name, tbl_name, sql
  FROM sqlite_schema
  WHERE name NOT LIKE 'sqlite_%'
    AND type IN ('table', 'index', 'view', 'trigger')
  ORDER BY type, name, tbl_name
`.trim();

const VOLATILE_ENTRIES = new Set([
  'Crashpad',
  'harness',
  'local-task-server.json',
  'logs',
  'telemetry.jsonl',
]);

function readProductName() {
  const pkg = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8'));
  return pkg.productName ?? pkg.name ?? 'app';
}

function readSchemaManifest() {
  return JSON.parse(readFileSync(SESSION_SCHEMA_MANIFEST, 'utf8'));
}

function defaultUserDataDir(productName) {
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', productName);
    case 'win32':
      return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), productName);
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), productName);
  }
}

function isAppRunning(productName) {
  if (process.platform !== 'darwin') return false;
  try {
    const out = execSync(`pgrep -fl "${productName}.app" || true`, { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function currentBranchName() {
  try {
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    if (branch) return branch;
  } catch {
    // Fall through to commit-based name.
  }

  try {
    return `detached-${execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim()}`;
  } catch {
    return 'default';
  }
}

function sanitizeName(name) {
  const cleaned = name
    .trim()
    .replace(/[/\\:]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || 'default';
}

function expandHome(value) {
  if (value === '~') return homedir();
  if (value.startsWith(`~${sep}`) || value.startsWith('~/')) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

function branchProfilePath(name) {
  return join(DEV_PROFILE_ROOT, sanitizeName(name));
}

function looksLikePath(ref) {
  return ref.startsWith('.') || ref.startsWith('~') || isAbsolute(ref);
}

function resolveProfileRef(ref, productName) {
  if (!ref) return branchProfilePath(process.env.NAME || currentBranchName());
  const value = ref;
  if (value === 'default') return defaultUserDataDir(productName);
  if (value.startsWith('branch:')) return branchProfilePath(value.slice('branch:'.length));
  if (value.startsWith('name:')) return branchProfilePath(value.slice('name:'.length));
  if (value.startsWith('path:')) return resolve(REPO_ROOT, expandHome(value.slice('path:'.length)));
  if (looksLikePath(value)) return resolve(REPO_ROOT, expandHome(value));
  return branchProfilePath(value);
}

function parseArgs(argv) {
  const opts = {
    allowRunning: process.env.ALLOW_RUNNING === '1',
    dbOnly: process.env.DB_ONLY === '1',
    force: process.env.FORCE === '1',
    from: process.env.FROM,
    json: process.env.JSON === '1',
    name: process.env.NAME,
    target: process.env.TARGET,
    to: process.env.TO,
  };

  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--allow-running') opts.allowRunning = true;
    else if (arg === '--db-only') opts.dbOnly = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--from') opts.from = argv[++i];
    else if (arg.startsWith('--from=')) opts.from = arg.slice('--from='.length);
    else if (arg === '--json') opts.json = true;
    else if (arg === '--name') opts.name = argv[++i];
    else if (arg.startsWith('--name=')) opts.name = arg.slice('--name='.length);
    else if (arg === '--target') opts.target = argv[++i];
    else if (arg.startsWith('--target=')) opts.target = arg.slice('--target='.length);
    else if (arg === '--to') opts.to = argv[++i];
    else if (arg.startsWith('--to=')) opts.to = arg.slice('--to='.length);
    else positional.push(arg);
  }

  return { command: positional[0] ?? 'path', opts };
}

function ensureAppStopped(productName, opts) {
  if (opts.allowRunning || !isAppRunning(productName)) return;
  console.error(`[dev-profile] ERROR: ${productName} appears to be running. Quit it before copying or cleaning profiles.`);
  console.error('[dev-profile] Re-run with ALLOW_RUNNING=1 only if you know the source and target profiles are not in use.');
  process.exit(1);
}

function profileFilter(sourceRoot) {
  return (src) => {
    const rel = src === sourceRoot ? '' : src.slice(sourceRoot.length + 1);
    const first = rel.split(/[\\/]/)[0];
    if (!first) return true;
    return !VOLATILE_ENTRIES.has(first);
  };
}

function copyDbFiles(source, target, force) {
  const mainDb = join(source, 'sessions.db');
  if (!existsSync(mainDb)) {
    throw new Error(`Source profile has no sessions.db: ${mainDb}`);
  }

  mkdirSync(target, { recursive: true });
  for (const fileName of ['sessions.db', 'sessions.db-wal', 'sessions.db-shm']) {
    const src = join(source, fileName);
    const dest = join(target, fileName);
    if (!existsSync(src)) continue;
    if (existsSync(dest) && !force) {
      throw new Error(`${dest} already exists; pass FORCE=1 or --force to replace DB files`);
    }
    if (existsSync(dest)) rmSync(dest, { force: true });
    cpSync(src, dest);
  }
}

function sessionSchemaId(version, hash) {
  return `sessions:v${version}:sha256-${hash}`;
}

async function computeDbSchemaIdentity(dbPath) {
  const { createHash } = await import('node:crypto');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const version = db.pragma('user_version', { simple: true }) ?? 0;
    const objects = db.prepare(SESSION_SCHEMA_QUERY).all().map((row) => ({
      type: row.type,
      name: row.name,
      tblName: row.tbl_name,
      sql: row.sql,
    }));
    const hash = createHash('sha256').update(JSON.stringify(objects)).digest('hex');
    return {
      version,
      hash,
      id: sessionSchemaId(version, hash),
      objects: objects.length,
    };
  } finally {
    db.close();
  }
}

async function doctorProfile(target) {
  const manifest = readSchemaManifest();
  const dbPath = join(target, 'sessions.db');

  if (!existsSync(dbPath)) {
    return {
      ok: false,
      level: 'missing',
      message: `No sessions.db at ${dbPath}. Run task db:worktree:copy FROM=default or start the app with this profile.`,
      profile: target,
      dbPath,
    };
  }

  const identity = await computeDbSchemaIdentity(dbPath);
  if (identity.version > manifest.version) {
    return {
      ok: false,
      level: 'newer',
      message: `Profile DB is newer than this checkout (${identity.version} > ${manifest.version}). Use a newer branch/main checkout, or copy from a compatible profile.`,
      profile: target,
      dbPath,
      identity,
      manifest,
    };
  }

  if (identity.version < manifest.version) {
    return {
      ok: true,
      level: 'older',
      message: `Profile DB is older than this checkout (${identity.version} < ${manifest.version}); the app should migrate it on next launch.`,
      profile: target,
      dbPath,
      identity,
      manifest,
    };
  }

  if (identity.id !== manifest.schemaId) {
    return {
      ok: false,
      level: 'drift',
      message: `Profile DB has DB_SCHEMA_VERSION ${identity.version}, but its schema ID differs from this checkout. If the checkout changed SessionDb intentionally, run task db:schema:update; otherwise copy from a compatible profile or branch.`,
      profile: target,
      dbPath,
      identity,
      manifest,
    };
  }

  return {
    ok: true,
    level: 'match',
    message: `Profile DB matches ${manifest.schemaId}`,
    profile: target,
    dbPath,
    identity,
    manifest,
  };
}

function copyProfile(source, target, opts) {
  if (!existsSync(source)) throw new Error(`Source profile does not exist: ${source}`);

  if (opts.dbOnly) {
    copyDbFiles(source, target, opts.force);
    return;
  }

  if (existsSync(target)) {
    if (!opts.force) {
      throw new Error(`Target profile already exists: ${target}. Pass FORCE=1 or --force to replace it.`);
    }
    rmSync(target, { recursive: true, force: true });
  }

  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, {
    recursive: true,
    filter: profileFilter(source),
  });
}

function cleanProfile(target, opts) {
  if (!existsSync(target)) {
    console.log(`[dev-profile] already clean: ${target}`);
    return;
  }
  if (!opts.force) {
    throw new Error(`Refusing to delete ${target} without FORCE=1 or --force`);
  }
  rmSync(target, { recursive: true, force: true });
}

function printResult(opts, payload) {
  if (opts.json) console.log(JSON.stringify(payload, null, 2));
  else if (payload.path) console.log(payload.path);
  else console.log(`[dev-profile] ${payload.message}`);
}

function printDoctorResult(opts, result) {
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`[dev-profile] ${result.message}`);
  console.log(`[dev-profile] profile=${result.profile}`);
  if (result.identity) {
    console.log(`[dev-profile] db=${result.identity.id}`);
    console.log(`[dev-profile] expected=${result.manifest.schemaId}`);
  }
}

function usage() {
  console.log(`Usage:
  node scripts/dev-profile.mjs path [--name <branch-or-name>] [--json]
  node scripts/dev-profile.mjs copy [--from <ref>] [--to <ref>] [--force] [--db-only]
  node scripts/dev-profile.mjs doctor [--target <ref>] [--json]
  node scripts/dev-profile.mjs clean [--target <ref>] [--force]

Refs:
  default       platform default Electron userData
  branch:<name>  .task/user-data/<name>
  name:<name>    .task/user-data/<name>
  path:<path>  explicit filesystem path
  ./<path>     explicit filesystem path
  /<path>      explicit filesystem path
  <name>       shorthand for .task/user-data/<name>
`);
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  const productName = readProductName();

  if (command === 'path') {
    const path = resolveProfileRef(opts.name, productName);
    printResult(opts, { path, name: opts.name ?? currentBranchName() });
    return;
  }

  if (command === 'copy') {
    ensureAppStopped(productName, opts);
    const source = resolveProfileRef(opts.from ?? 'default', productName);
    const target = resolveProfileRef(opts.to ?? opts.name ?? currentBranchName(), productName);
    copyProfile(source, target, opts);
    const result = {
      message: `copied ${opts.dbOnly ? 'session DB' : 'profile'} from ${source} to ${target}`,
      source,
      target,
    };
    printResult(opts, result);
    if (opts.dbOnly) {
      const doctor = await doctorProfile(target);
      printDoctorResult(opts, doctor);
      if (!doctor.ok) process.exitCode = 1;
    }
    return;
  }

  if (command === 'doctor') {
    const target = resolveProfileRef(opts.target ?? opts.name ?? currentBranchName(), productName);
    const result = await doctorProfile(target);
    printDoctorResult(opts, result);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'clean') {
    ensureAppStopped(productName, opts);
    const target = resolveProfileRef(opts.target ?? opts.name ?? currentBranchName(), productName);
    cleanProfile(target, opts);
    printResult(opts, { message: `cleaned ${target}`, target });
    return;
  }

  usage();
  process.exit(command === 'help' || command === '--help' ? 0 : 2);
}

try {
  await main();
} catch (err) {
  console.error(`[dev-profile] ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
