#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stockRoot = path.join(appRoot, 'src', 'main', 'hl', 'stock');
const cli = path.join(stockRoot, 'agent-skill', 'agent-skill');

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
    id: 'skip-simple-one-off-weather',
    mode: 'none',
    shouldWriteSkill: false,
    guard: 'one-off',
    prompt: 'Tell me the weather in San Francisco today.',
    reason: 'A one-off fact lookup should not create procedural memory.',
  },
  {
    id: 'skip-secret-specific-login',
    mode: 'none',
    shouldWriteSkill: false,
    guard: 'secret',
    prompt: 'Use this temporary token to log into my private account once.',
    reason: 'Secrets and one-time account details must not become skills.',
  },
];

function parseArgs(argv) {
  const opts = { json: false, keepFixtures: false, output: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--keep-fixtures') opts.keepFixtures = true;
    else if (arg === '--output') {
      opts.output = argv[i + 1] || '';
      i += 1;
    }
  }
  return opts;
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

function runPromptDecision(root, task) {
  const started = performance.now();
  const prompt = String(task.prompt || '').toLowerCase();
  const rules = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf-8').toLowerCase();
  const reasons = [];
  if (task.guard === 'one-off') {
    if (rules.includes('simple one-off') && rules.includes('temporary facts')) reasons.push('simple-one-off');
  }
  if (task.guard === 'secret') {
    if (rules.includes('user-specific secrets') && rules.includes('temporary')) reasons.push('secret-specific');
  }
  const promptLooksGuarded = task.guard === 'one-off'
    ? /\b(weather|today|one-off|fact)\b/.test(prompt)
    : /\b(secret|token|private account|temporary)\b/.test(prompt);
  const shouldWriteSkill = !(promptLooksGuarded && reasons.length > 0);
  const proposedCommands = shouldWriteSkill
    ? [`agent-skill create ${task.id.replace(/^skip-/, 'general/')} --description "Reusable workflow"`]
    : [];
  return {
    args: ['prompt-decision', task.id],
    exitCode: 0,
    elapsedMs: performance.now() - started,
    cliElapsedMs: null,
    parsed: {
      shouldWriteSkill,
      reasons,
      proposedCommands,
      prompt: task.prompt,
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
      const promptDecision = runPromptDecision(root, task);
      operations.push(promptDecision);
      assertTask(promptDecision.parsed.shouldWriteSkill === false, `prompt decision would write a skill: ${promptDecision.parsed.proposedCommands.join(', ')}`);
      assertTask(promptDecision.parsed.reasons.length > 0, 'prompt decision did not match any no-write lifecycle rule');
      assertTask(!promptDecision.parsed.proposedCommands.some((command) => /\bagent-skill\s+(create|patch|delete)\b/.test(command)), 'no-write task proposed a write command');

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
