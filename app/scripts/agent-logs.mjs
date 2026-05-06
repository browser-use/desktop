#!/usr/bin/env node
/* global console, process, setInterval */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LINES = 200;
const POLL_MS = 750;
const useColor = process.env.LOG_COLOR
  ? process.env.LOG_COLOR !== '0'
  : process.env.FORCE_COLOR
  ? process.env.FORCE_COLOR !== '0'
  : !process.env.NO_COLOR;

process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

function readProductName() {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));
  return pkg.productName ?? pkg.name ?? 'app';
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

function usage() {
  console.error(`Usage: node app/scripts/agent-logs.mjs [--session <id>] [--lines <n>] [--no-follow] [--json]

Reads the durable agent transcript from sessions.db. If --session is omitted,
the latest session is used. SESSION_ID prefixes of at least 6 characters work.
`);
}

function parseArgs(argv) {
  const opts = {
    sessionId: undefined,
    lines: Number.parseInt(process.env.LINES ?? '', 10) || DEFAULT_LINES,
    follow: true,
    json: false,
    userDataDir: process.env.AGB_USER_DATA_DIR,
    dbPath: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--session') {
      opts.sessionId = argv[++i];
      continue;
    }
    if (arg?.startsWith('--session=')) {
      opts.sessionId = arg.slice('--session='.length);
      continue;
    }
    if (arg === '--lines') {
      opts.lines = Number.parseInt(argv[++i] ?? '', 10);
      continue;
    }
    if (arg?.startsWith('--lines=')) {
      opts.lines = Number.parseInt(arg.slice('--lines='.length), 10);
      continue;
    }
    if (arg === '--no-follow') {
      opts.follow = false;
      continue;
    }
    if (arg === '--follow') {
      opts.follow = true;
      continue;
    }
    if (arg === '--json') {
      opts.json = true;
      continue;
    }
    if (arg === '--user-data-dir') {
      opts.userDataDir = argv[++i];
      continue;
    }
    if (arg?.startsWith('--user-data-dir=')) {
      opts.userDataDir = arg.slice('--user-data-dir='.length);
      continue;
    }
    if (arg === '--db') {
      opts.dbPath = argv[++i];
      continue;
    }
    if (arg?.startsWith('--db=')) {
      opts.dbPath = arg.slice('--db='.length);
      continue;
    }
    if (!opts.sessionId) {
      opts.sessionId = arg;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!Number.isFinite(opts.lines) || opts.lines <= 0) opts.lines = DEFAULT_LINES;
  return opts;
}

function openDb(opts) {
  const userData = opts.userDataDir || defaultUserDataDir(readProductName());
  const dbPath = opts.dbPath || join(userData, 'sessions.db');
  if (!existsSync(dbPath)) {
    throw new Error(`No sessions.db found at ${dbPath}. Start the app or pass --db <path>.`);
  }
  return { dbPath };
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function query(dbPath, sql) {
  const result = spawnSync('sqlite3', ['-readonly', '-json', '--', dbPath, sql], {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error('sqlite3 CLI not found on PATH. Install sqlite3 or use a system image that includes it.');
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `sqlite3 exited ${result.status}`).trim());
  }
  const out = result.stdout.trim();
  if (!out) return [];
  return JSON.parse(out);
}

function findSession(dbPath, sessionId) {
  if (!sessionId) {
    return query(dbPath, 'SELECT * FROM sessions ORDER BY created_at DESC LIMIT 1')[0];
  }

  const exact = query(dbPath, `SELECT * FROM sessions WHERE id = ${sqlString(sessionId)}`)[0];
  if (exact) return exact;

  if (sessionId.length < 6) return null;
  const matches = query(
    dbPath,
    `SELECT * FROM sessions WHERE id LIKE ${sqlString(`${sessionId}%`)} ORDER BY created_at DESC LIMIT 2`,
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Session prefix ${sessionId} is ambiguous; use more characters.`);
  }
  return null;
}

function getInitialEvents(dbPath, sessionId, lines) {
  return query(
    dbPath,
    `
      SELECT seq, type, payload
      FROM (
        SELECT seq, type, payload
        FROM session_events
        WHERE session_id = ${sqlString(sessionId)}
        ORDER BY seq DESC
        LIMIT ${Number(lines)}
      )
      ORDER BY seq ASC
    `,
  );
}

function getEventsAfter(dbPath, sessionId, seq) {
  return query(
    dbPath,
    `
      SELECT seq, type, payload
      FROM session_events
      WHERE session_id = ${sqlString(sessionId)} AND seq > ${Number(seq)}
      ORDER BY seq ASC
      LIMIT 500
    `,
  );
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function color(code, text) {
  const value = String(text);
  return useColor ? `\u001b[${code}m${value}\u001b[0m` : value;
}

function dim(text) { return color('2', text); }
function cyan(text) { return color('36', text); }
function magenta(text) { return color('35', text); }
function yellow(text) { return color('33', text); }
function red(text) { return color('31', text); }
function green(text) { return color('32', text); }
function underline(text) { return color('4', text); }

function label(text) {
  return dim(`${text}=`);
}

function pair(key, value, formatter = String) {
  return `${label(key)}${formatter(value)}`;
}

function formatTimestamp(ts) {
  const value = String(ts ?? '');
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})?$/);
  if (!match) return dim(value);
  return `${dim(match[1])} ${cyan(match[2])}${dim(match[3] ?? '')}`;
}

function statusColor(value) {
  const normalized = String(value ?? '').toLowerCase();
  if (/error|fail|stopped|crash/.test(normalized)) return red(value);
  if (/idle|running|ready|done|complete|ok|success/.test(normalized)) return green(value);
  if (/stuck|warn|pending/.test(normalized)) return yellow(value);
  return color('37', value);
}

function typeColor(type) {
  if (type === 'error') return '1;31';
  if (type === 'done') return '1;32';
  if (type === 'tool_call') return '36';
  if (type === 'tool_result') return '35';
  if (type === 'thinking') return '2';
  if (type === 'turn_usage') return '33';
  if (type === 'file_output') return '34';
  if (type === 'user_input') return '32';
  return '37';
}

function truncate(value, max = 260) {
  const text = clean(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function jsonPreview(value, max = 320) {
  try {
    return truncate(JSON.stringify(value), max);
  } catch {
    return truncate(String(value), max);
  }
}

function formatSize(n) {
  if (typeof n !== 'number') return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function parseEvent(row) {
  try {
    return JSON.parse(row.payload);
  } catch (err) {
    return { type: row.type, parseError: err.message, raw: row.payload };
  }
}

function formatEvent(row) {
  const event = parseEvent(row);
  const type = event.type ?? row.type ?? 'event';
  const prefix = `${dim(String(row.seq).padStart(4, ' '))} ${color(typeColor(type), String(type).padEnd(14, ' '))}`;

  switch (type) {
    case 'user_input':
      return `${prefix} ${green(truncate(event.text, 500))}`;
    case 'thinking':
      return `${prefix} ${dim(truncate(event.text, 360))}`;
    case 'tool_call':
      return `${prefix} ${cyan(event.name ?? '-')} ${dim(jsonPreview(event.args))}`;
    case 'tool_result': {
      const state = event.ok ? green('ok') : red('failed');
      const ms = typeof event.ms === 'number' ? yellow(`${event.ms}ms`) : dim('-');
      return `${prefix} ${state} ${magenta(event.name ?? '-')} ${ms} ${truncate(event.preview, 360)}`;
    }
    case 'file_output':
      return `${prefix} ${color('34', event.name ?? '-')} ${magenta(formatSize(event.size))} ${underline(color('34', event.path ?? ''))}`.trimEnd();
    case 'harness_edited':
      return `${prefix} ${yellow(event.action ?? '-')} ${magenta(event.target ?? '-')} ${underline(color('34', event.path ?? ''))}`.trimEnd();
    case 'skill_written':
      return `${prefix} ${yellow(event.action ?? '-')} ${cyan(event.domain ?? '-')} ${magenta(event.topic ?? '-')} ${underline(color('34', event.path ?? ''))}`.trimEnd();
    case 'skill_used':
      return `${prefix} ${cyan(event.domain ?? '-')} ${magenta(event.topic ?? '-')} ${underline(color('34', event.path ?? ''))}`.trimEnd();
    case 'notify':
      return `${prefix} ${statusColor(event.level ?? 'info')} ${truncate(event.message, 360)}`;
    case 'turn_usage':
      return [
        prefix,
        pair('model', event.model ?? '-', magenta),
        pair('input', event.inputTokens ?? 0, cyan),
        pair('output', event.outputTokens ?? 0, cyan),
        pair('cached', event.cachedInputTokens ?? 0, cyan),
        pair('cost', event.costUsd ?? 0, magenta),
        pair('source', event.source ?? '-', cyan),
      ].join(' ');
    case 'done':
      return `${prefix} ${green(truncate(event.summary ?? 'completed', 500))} ${pair('iterations', event.iterations ?? 0, yellow)}`;
    case 'error':
      return `${prefix} ${red(truncate(event.message ?? event.error ?? 'unknown error', 500))}`;
    default:
      return `${prefix} ${dim(jsonPreview(event, 520))}`;
  }
}

function printHeader(session, dbPath, opts) {
  if (opts.json) return;
  const created = session.created_at ? new Date(session.created_at).toISOString() : '-';
  const engine = session.engine ?? '-';
  const model = session.model ?? '-';
  console.log(`${color('1;36', 'Agent session')} ${cyan(session.id)}`);
  console.log([
    pair('status', session.status ?? '-', statusColor),
    pair('engine', engine, yellow),
    pair('model', model, magenta),
    pair('created', formatTimestamp(created), (v) => v),
  ].join(' '));
  console.log(`${label('db')}${underline(color('34', dbPath))}`);
  if (session.prompt) console.log(`${label('prompt')}${truncate(session.prompt, 500)}`);
  if (session.error) console.log(`${label('error')}${red(truncate(session.error, 500))}`);
  console.log('');
}

function printRow(row, session, opts) {
  if (opts.json) {
    console.log(JSON.stringify({
      sessionId: session.id,
      seq: row.seq,
      type: row.type,
      event: parseEvent(row),
    }));
    return;
  }
  console.log(formatEvent(row));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { dbPath } = openDb(opts);
  const session = findSession(dbPath, opts.sessionId);
  if (!session) {
    throw new Error(opts.sessionId ? `Session not found: ${opts.sessionId}` : 'No sessions found.');
  }

  printHeader(session, dbPath, opts);

  let lastSeq = -1;
  const rows = getInitialEvents(dbPath, session.id, opts.lines);
  for (const row of rows) {
    printRow(row, session, opts);
    lastSeq = Math.max(lastSeq, row.seq);
  }

  if (!opts.follow) {
    return;
  }

  if (!opts.json && rows.length === 0) {
    console.log('(waiting for agent events...)');
  }

  setInterval(() => {
    const nextRows = getEventsAfter(dbPath, session.id, lastSeq);
    for (const row of nextRows) {
      printRow(row, session, opts);
      lastSeq = Math.max(lastSeq, row.seq);
    }
  }, POLL_MS);
}

main().catch((err) => {
  console.error(`[agent-logs] ERROR: ${err.message}`);
  process.exit(1);
});
