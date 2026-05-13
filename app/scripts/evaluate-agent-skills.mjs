#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { homedir } from 'node:os';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stockRoot = path.join(appRoot, 'src', 'main', 'hl', 'stock');
const cli = path.join(stockRoot, 'agent-skill', 'agent-skill');
const runTaskCli = path.join(appRoot, 'scripts', 'run-task.mjs');

const TASKS = [
  {
    id: 'find-linkedin-invitations',
    mode: 'find',
    shouldWriteSkill: false,
    query: 'linkedin invitations accept ignore pending connection requests',
    expectedSkill: 'domain/linkedin/invitation-manager',
    requiredTerms: ['LinkedIn', 'invitation'],
  },
  {
    id: 'find-screenshot-verification',
    mode: 'find',
    shouldWriteSkill: false,
    query: 'capture screenshot png visual verification',
    expectedSkill: 'interaction/screenshots',
    requiredTerms: ['captureScreenshot'],
  },
  {
    id: 'find-file-upload',
    mode: 'find',
    shouldWriteSkill: false,
    query: 'upload a file input chooser setFileInputFiles',
    expectedSkill: 'interaction/uploads',
    requiredTerms: ['upload'],
  },
  {
    id: 'find-github-repo-actions',
    mode: 'find',
    shouldWriteSkill: false,
    query: 'github repository actions star fork issue pull request',
    expectedSkill: 'domain/github/repo-actions',
    requiredTerms: ['GitHub'],
  },
  {
    id: 'find-tiktok-upload',
    mode: 'find',
    shouldWriteSkill: false,
    query: 'tiktok upload video caption publish',
    expectedSkill: 'domain/tiktok/upload',
    requiredTerms: ['TikTok', 'upload'],
  },
  {
    id: 'create-recurring-crm-triage',
    mode: 'create',
    shouldWriteSkill: true,
    skillId: 'user/workflow/crm-triage',
    createName: 'workflow/crm-triage',
    description: 'Reusable CRM queue triage workflow after repeated account checks',
    body: [
      'Use when the user asks for the same CRM queue triage workflow again.',
      '',
      '1. Search the assigned queue and group records by account status.',
      '2. Check each ambiguous account before making changes.',
      '3. Verify the queue is reconciled and report the count changed.',
    ].join('\n'),
  },
  {
    id: 'create-provider-login-recovery',
    mode: 'create',
    shouldWriteSkill: true,
    skillId: 'user/debugging/provider-login-recovery',
    createName: 'debugging/provider-login-recovery',
    description: 'Recover provider login failures after CLI auth retries and path checks',
    body: [
      'Use after a provider CLI login failed and the fix required multiple checks.',
      '',
      '1. Run the provider auth status command and capture the exact error.',
      '2. Check PATH resolution for the CLI shim before changing credentials.',
      '3. Retry login only after verifying the selected auth mode.',
      '4. Verify the provider can run a no-op command successfully.',
    ].join('\n'),
  },
  {
    id: 'patch-existing-skill-after-learning',
    mode: 'patch',
    shouldWriteSkill: true,
    skillId: 'user/workflow/session-log-export',
    createName: 'workflow/session-log-export',
    description: 'Export session logs for repeated support diagnostics',
    seedBody: [
      'Use when support needs session logs.',
      '',
      '1. Export main logs.',
      '2. Verify the export file exists.',
    ].join('\n'),
    oldText: '1. Export main logs.',
    newText: '1. Export main, browser, renderer, and engine logs.',
    requiredTerms: ['browser, renderer, and engine logs'],
  },
  {
    id: 'skip-simple-one-off-conversion',
    mode: 'none',
    shouldWriteSkill: false,
    prompt: 'Convert 72 degrees Fahrenheit to Celsius in one sentence.',
    reason: 'A one-off calculation should not create procedural memory.',
  },
  {
    id: 'skip-secret-specific-login',
    mode: 'none',
    shouldWriteSkill: false,
    prompt: 'I pasted a temporary private account token by mistake: skills-eval-token-123. What should I do with it? Answer in one sentence.',
    reason: 'Secrets and one-time account details must not become skills.',
  },
];

function parseArgs(argv) {
  const opts = {
    json: false,
    keepFixtures: false,
    output: '',
    liveEngines: (process.env.SKILLS_EVAL_ENGINES || process.env.SKILLS_EVAL_ENGINE || 'codex')
      .split(',')
      .map((engine) => engine.trim())
      .filter(Boolean),
    userDataDir: process.env.AGB_USER_DATA_DIR || '',
    liveTimeoutMs: Number.parseInt(process.env.SKILLS_EVAL_TIMEOUT_MS || '180000', 10),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--keep-fixtures') opts.keepFixtures = true;
    else if (arg === '--output') {
      opts.output = argv[i + 1] || '';
      i += 1;
    } else if (arg === '--engine') {
      opts.liveEngines = [argv[i + 1]].filter(Boolean);
      i += 1;
    } else if (arg === '--engines') {
      opts.liveEngines = String(argv[i + 1] || '')
        .split(',')
        .map((engine) => engine.trim())
        .filter(Boolean);
      i += 1;
    } else if (arg === '--user-data-dir') {
      opts.userDataDir = argv[i + 1] || '';
      i += 1;
    } else if (arg === '--live-timeout-ms') {
      opts.liveTimeoutMs = Number.parseInt(argv[i + 1] || '', 10);
      i += 1;
    }
  }
  if (!Number.isFinite(opts.liveTimeoutMs) || opts.liveTimeoutMs <= 0) opts.liveTimeoutMs = 180000;
  return opts;
}

function readProductName() {
  const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf-8'));
  return pkg.productName ?? pkg.name ?? 'app';
}

function defaultUserDataDir(productName) {
  switch (process.platform) {
    case 'darwin':
      return path.join(homedir(), 'Library', 'Application Support', productName);
    case 'win32':
      return path.join(process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'), productName);
    default:
      return path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), productName);
  }
}

function resolveUserDataDir(opts) {
  return opts.userDataDir || defaultUserDataDir(readProductName());
}

function copyStockFixture(root) {
  fs.cpSync(path.join(stockRoot, 'domain-skills'), path.join(root, 'domain-skills'), { recursive: true });
  fs.cpSync(path.join(stockRoot, 'interaction-skills'), path.join(root, 'interaction-skills'), { recursive: true });
  fs.copyFileSync(path.join(stockRoot, 'AGENTS.md'), path.join(root, 'AGENTS.md'));
  fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
}

function runAgentSkill(root, args, input) {
  const started = performance.now();
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
    cwd: root,
    input,
    encoding: 'utf-8',
  });
  const elapsedMs = performance.now() - started;
  const raw = result.status === 0 ? result.stdout : result.stderr;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    parsed = { success: false, error: `invalid JSON: ${err.message}`, raw };
  }
  return {
    args,
    exitCode: result.status,
    elapsedMs,
    cliElapsedMs: typeof parsed.elapsed_ms === 'number' ? parsed.elapsed_ms : null,
    parsed,
  };
}

function assertTask(condition, message) {
  if (!condition) throw new Error(message);
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function syncOutputText(value) {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf-8');
  return '';
}

function querySqliteJson(dbPath, sql) {
  const result = spawnSync('sqlite3', ['-json', dbPath, sql], {
    encoding: 'utf-8',
  });
  const stdout = syncOutputText(result.stdout).trim();
  const stderr = syncOutputText(result.stderr).trim();
  if (result.error) {
    throw new Error(stderr || result.error.message || 'sqlite3 failed to start');
  }
  if (result.status !== 0) {
    throw new Error(stderr || stdout || `sqlite3 exited ${result.status ?? 'unknown'}`);
  }
  return stdout ? JSON.parse(stdout) : [];
}

function queryLiveSession(userDataDir, sessionId) {
  const dbPath = path.join(userDataDir, 'sessions.db');
  if (!fs.existsSync(dbPath)) throw new Error(`sessions.db not found at ${dbPath}`);
  const quotedId = sqlQuote(sessionId);
  const [session = null] = querySqliteJson(dbPath, `SELECT id,status,error,engine FROM sessions WHERE id = ${quotedId}`);
  const events = querySqliteJson(dbPath, `SELECT seq,type,payload FROM session_events WHERE session_id = ${quotedId} ORDER BY seq ASC`);
  return { dbPath, session, events };
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForLiveSession(userDataDir, sessionId, deadlineMs) {
  let latest = queryLiveSession(userDataDir, sessionId);
  for (;;) {
    const doneCount = latest.events.filter((event) => event.type === 'done').length;
    const status = latest.session?.status;
    if (doneCount > 0 || status === 'stopped' || status === 'paused') return latest;
    if (Date.now() >= deadlineMs) return latest;
    sleepSync(500);
    latest = queryLiveSession(userDataDir, sessionId);
  }
}

function runLiveNoWriteTask(task, opts) {
  const started = performance.now();
  const userDataDir = resolveUserDataDir(opts);
  const engines = opts.liveEngines.length > 0 ? opts.liveEngines : ['codex'];
  const runs = [];

  for (const engine of engines) {
    const runStarted = performance.now();
    const deadlineMs = Date.now() + opts.liveTimeoutMs;
    const result = spawnSync(process.execPath, [
      runTaskCli,
      '--json',
      '--engine',
      engine,
      '--user-data-dir',
      userDataDir,
      task.prompt,
    ], {
      cwd: path.dirname(appRoot),
      encoding: 'utf-8',
      timeout: Math.min(opts.liveTimeoutMs, 30000),
      env: { ...process.env, AGB_USER_DATA_DIR: userDataDir },
    });
    const raw = result.status === 0 ? result.stdout : result.stderr || result.stdout;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      parsed = { ok: false, error: `invalid JSON from run-task: ${err.message}`, raw };
    }
    const sessionId = parsed.id;
    const live = sessionId ? waitForLiveSession(userDataDir, sessionId, deadlineMs) : { dbPath: path.join(userDataDir, 'sessions.db'), session: null, events: [] };
    const eventTypes = live.events.map((event) => event.type);
    const skillWrittenEvents = live.events.filter((event) => event.type === 'skill_written');
    const skillUsedEvents = live.events.filter((event) => event.type === 'skill_used');
    const doneEvents = live.events.filter((event) => event.type === 'done');
    const errorEvents = live.events.filter((event) => event.type === 'error');
    runs.push({
      engine,
      exitCode: result.status,
      timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
      elapsedMs: performance.now() - runStarted,
      sessionId,
      status: live.session?.status ?? null,
      error: live.session?.error ?? parsed.error ?? null,
      eventTypes,
      skillWrittenEvents,
      skillUsedEvents,
      doneCount: doneEvents.length,
      errorCount: errorEvents.length,
      dbPath: live.dbPath,
    });
  }

  return {
    args: ['live-task', task.id, '--engines', engines.join(',')],
    exitCode: runs.every((run) => run.exitCode === 0 && run.doneCount > 0 && run.skillWrittenEvents.length === 0) ? 0 : 1,
    elapsedMs: performance.now() - started,
    cliElapsedMs: null,
    parsed: {
      prompt: task.prompt,
      userDataDir,
      runs,
    },
  };
}

function findEntry(parsed, id) {
  return Array.isArray(parsed.entries) ? parsed.entries.find((entry) => entry.id === id) : undefined;
}

function runTask(task, opts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `agent-skill-eval-${task.id}-`));
  copyStockFixture(root);
  const operations = [];
  const started = performance.now();
  try {
    if (task.mode === 'find') {
      const search = runAgentSkill(root, ['search', task.query, '--limit', '8']);
      operations.push(search);
      assertTask(search.exitCode === 0, `search failed: ${search.parsed.error || search.exitCode}`);
      assertTask(findEntry(search.parsed, task.expectedSkill), `expected ${task.expectedSkill} in search results`);
      assertTask(!JSON.stringify(search.parsed.entries).includes('"content"'), 'search results leaked full skill content');
      assertTask(Buffer.byteLength(JSON.stringify(search.parsed), 'utf-8') < 25_000, 'search output exceeded bloat budget');

      const view = runAgentSkill(root, ['view', task.expectedSkill]);
      operations.push(view);
      assertTask(view.exitCode === 0, `view failed: ${view.parsed.error || view.exitCode}`);
      for (const term of task.requiredTerms || []) {
        assertTask(String(view.parsed.content || '').toLowerCase().includes(term.toLowerCase()), `view missing term: ${term}`);
      }

      const validate = runAgentSkill(root, ['validate', task.expectedSkill]);
      operations.push(validate);
      assertTask(validate.exitCode === 0, `validate failed: ${validate.parsed.error || validate.exitCode}`);
      assertTask(validate.parsed.ok === true, `expected ${task.expectedSkill} to validate`);
    } else if (task.mode === 'create') {
      const created = runAgentSkill(root, ['create', task.createName, '--description', task.description], task.body);
      operations.push(created);
      assertTask(created.exitCode === 0, `create failed: ${created.parsed.error || created.exitCode}`);
      assertTask(created.parsed.entry?.id === task.skillId, `expected created id ${task.skillId}`);

      const validate = runAgentSkill(root, ['validate', task.skillId]);
      operations.push(validate);
      assertTask(validate.exitCode === 0 && validate.parsed.ok === true, 'created skill did not validate');
    } else if (task.mode === 'patch') {
      const created = runAgentSkill(root, ['create', task.createName, '--description', task.description], task.seedBody);
      operations.push(created);
      assertTask(created.exitCode === 0, `seed create failed: ${created.parsed.error || created.exitCode}`);

      const patched = runAgentSkill(root, ['patch', task.skillId, '--old', task.oldText, '--new', task.newText]);
      operations.push(patched);
      assertTask(patched.exitCode === 0, `patch failed: ${patched.parsed.error || patched.exitCode}`);

      const view = runAgentSkill(root, ['view', task.skillId]);
      operations.push(view);
      for (const term of task.requiredTerms || []) {
        assertTask(String(view.parsed.content || '').includes(term), `patched skill missing term: ${term}`);
      }

      const deleted = runAgentSkill(root, ['delete', task.skillId]);
      operations.push(deleted);
      assertTask(deleted.exitCode === 0, `delete failed: ${deleted.parsed.error || deleted.exitCode}`);
    } else if (task.mode === 'none') {
      const liveTask = runLiveNoWriteTask(task, opts);
      operations.push(liveTask);
      assertTask(liveTask.exitCode === 0, `live task failed: ${JSON.stringify(liveTask.parsed.runs)}`);
      for (const run of liveTask.parsed.runs) {
        assertTask(run.sessionId, `live task did not create a session for ${run.engine}`);
        assertTask(run.doneCount > 0, `live task did not finish for ${run.engine} session ${run.sessionId}`);
        assertTask(run.skillWrittenEvents.length === 0, `live task wrote a skill for ${run.engine} session ${run.sessionId}`);
      }

      const listedBefore = runAgentSkill(root, ['list']);
      operations.push(listedBefore);
      assertTask(listedBefore.exitCode === 0, `list failed: ${listedBefore.parsed.error || listedBefore.exitCode}`);
      const userEntries = listedBefore.parsed.entries.filter((entry) => entry.source === 'user');
      assertTask(userEntries.length === 0, 'no-write task unexpectedly created a user skill');
    } else {
      throw new Error(`unknown task mode: ${task.mode}`);
    }

    return {
      id: task.id,
      mode: task.mode,
      shouldWriteSkill: task.shouldWriteSkill,
      passed: true,
      elapsedMs: performance.now() - started,
      operationCount: operations.length,
      operations,
      fixture: opts.keepFixtures ? root : undefined,
    };
  } catch (err) {
    return {
      id: task.id,
      mode: task.mode,
      shouldWriteSkill: task.shouldWriteSkill,
      passed: false,
      elapsedMs: performance.now() - started,
      operationCount: operations.length,
      error: err.message,
      operations,
      fixture: opts.keepFixtures ? root : undefined,
    };
  } finally {
    if (!opts.keepFixtures) fs.rmSync(root, { recursive: true, force: true });
  }
}

function printTable(summary) {
  console.log(`agent-skill evals: ${summary.passed}/${summary.total} passed in ${summary.elapsedMs.toFixed(1)}ms`);
  for (const task of summary.tasks) {
    const mark = task.passed ? 'ok' : 'fail';
    const write = task.shouldWriteSkill ? 'write' : 'no-write';
    const ops = task.operations.map((op) => `${op.args[0]}=${op.elapsedMs.toFixed(1)}ms`).join(', ');
    console.log(`${mark.padEnd(4)} ${task.id.padEnd(36)} ${task.mode.padEnd(6)} ${write.padEnd(8)} ${task.elapsedMs.toFixed(1)}ms  ${ops}`);
    if (!task.passed) console.log(`     ${task.error}`);
  }
}

const opts = parseArgs(process.argv.slice(2));
const suiteStarted = performance.now();
const tasks = TASKS.map((task) => runTask(task, opts));
const summary = {
  suite: 'agent-skills',
  total: tasks.length,
  passed: tasks.filter((task) => task.passed).length,
  failed: tasks.filter((task) => !task.passed).length,
  elapsedMs: performance.now() - suiteStarted,
  tasks,
};

if (opts.output) {
  fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
  fs.writeFileSync(opts.output, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
}

if (opts.json) console.log(JSON.stringify(summary, null, 2));
else printTable(summary);

if (summary.failed > 0) process.exitCode = 1;
