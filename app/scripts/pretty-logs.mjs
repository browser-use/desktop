#!/usr/bin/env node
/* global console, process */

import readline from 'node:readline';

const args = process.argv.slice(2);
const mode = readArg('--mode') ?? 'all';
const sessionFilter = readArg('--session');
const minLevelFilter = readArg('--level');
const useColor = process.env.LOG_COLOR
  ? process.env.LOG_COLOR !== '0'
  : process.env.FORCE_COLOR
  ? process.env.FORCE_COLOR !== '0'
  : !process.env.NO_COLOR;

process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

function readArg(name) {
  const prefix = `${name}=`;
  const value = args.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
}

function color(code, text) {
  const value = String(text);
  return useColor ? `\u001b[${code}m${value}\u001b[0m` : value;
}

function dim(text) { return color('2', text); }
function underline(text) { return color('4', text); }
function cyan(text) { return color('36', text); }
function magenta(text) { return color('35', text); }
function yellow(text) { return color('33', text); }
function red(text) { return color('31', text); }
function green(text) { return color('32', text); }

const channelColors = {
  app: '34',
  browser: '36',
  engine: '33',
  main: '34',
  renderer: '35',
};

function channelColor(channel) {
  return channelColors[channel] ?? '37';
}

function levelColor(level) {
  const normalized = normalizeLevel(level);
  if (normalized === 'error') return '1;31';
  if (normalized === 'warn') return '1;33';
  if (normalized === 'debug') return '2';
  return '32';
}

function normalizeLevel(level) {
  if (typeof level === 'number') {
    if (level === 0 || level === 1) return 'debug';
    if (level === 2) return 'info';
    if (level === 3) return 'warn';
    return 'error';
  }
  return String(level ?? 'info').toLowerCase();
}

function levelRank(level) {
  const normalized = normalizeLevel(level);
  if (normalized === 'debug') return 0;
  if (normalized === 'info') return 1;
  if (normalized === 'warn' || normalized === 'warning') return 2;
  return 3;
}

function matchesSession(entry, sessionId) {
  const candidates = [
    entry.sessionId,
    entry.session_id,
    entry.id,
    entry.task_id,
    entry.taskId,
  ];
  return candidates.some((value) => {
    if (typeof value !== 'string') return false;
    return value === sessionId || (sessionId.length >= 6 && value.startsWith(sessionId));
  });
}

function timingEventColor(event) {
  const value = String(event);
  if (/fail|error/i.test(value)) return color('1;31', value);
  if (/finish|ready|navigate|resolved|exit/i.test(value)) return green(value);
  return color('37', value);
}

function ms(value) {
  return value == null ? '-' : `${value}ms`;
}

function metric(name, value, code) {
  return `${dim(`${name}=`)}${color(code, ms(value))}`;
}

function formatTimestamp(ts) {
  const value = String(ts ?? '');
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})?$/);
  if (!match) return dim(value);
  return `${dim(match[1])} ${cyan(match[2])}${dim(match[3] ?? '')}`;
}

function shortSession(sessionId) {
  return sessionId ? String(sessionId).slice(0, 8) : '';
}

function shouldPrint(entry) {
  if (sessionFilter && !matchesSession(entry, sessionFilter)) return false;
  if (minLevelFilter && levelRank(entry.level) < levelRank(minLevelFilter)) return false;
  if (mode === 'startup') {
    return entry.area === 'startup' || String(entry.msg ?? '').startsWith('BrowserPool.startup');
  }
  if (mode === 'navigation') {
    return entry.area === 'navigation' || String(entry.msg ?? '').startsWith('BrowserPool.navigation');
  }
  return true;
}

function formatStartup(entry) {
  return [
    formatTimestamp(entry.ts),
    color('36', 'startup'),
    timingEventColor(entry.event ?? entry.msg),
    metric('total', entry.msSinceSessionStart, '1;33'),
    metric('browser', entry.msSinceCreate, '34'),
    `${dim('url=')}${color('4', entry.url ?? '-')}`,
    dim(`session=${shortSession(entry.sessionId)}`),
  ].join(' ');
}

function formatNavigation(entry) {
  const url = entry.url ?? entry.validatedURL ?? '-';
  return [
    formatTimestamp(entry.ts),
    color('36', 'nav'),
    timingEventColor(entry.event ?? entry.msg),
    metric('total', entry.msSinceSessionStart, '1;33'),
    metric('browser', entry.msSinceBrowserCreate, '34'),
    metric('nav', entry.msSinceNavigationStart, '35'),
    `${dim('url=')}${color('4', url)}`,
    dim(`session=${shortSession(entry.sessionId)}`),
  ].join(' ');
}

function formatGeneric(entry) {
  const channel = String(entry.channel ?? 'log');
  const level = normalizeLevel(entry.level);
  const parts = [
    formatTimestamp(entry.ts),
    color(channelColor(channel), channel.padEnd(8)),
    color(levelColor(level), level.padEnd(5)),
    color(levelColor(level), entry.msg ?? ''),
  ];

  for (const [key, value] of usefulFields(entry)) {
    parts.push(formatField(key, value));
  }

  return parts.filter(Boolean).join(' ');
}

function usefulFields(entry) {
  const skip = new Set(['ts', 'level', 'channel', 'msg', 'area', 'event']);
  const noisy = new Set(['args', 'envAuthFlags']);
  const prioritized = [
    'sessionId',
    'session_id',
    'id',
    'task_id',
    'taskId',
    'engineId',
    'extra_level',
    'model',
    'providerId',
    'authMode',
    'subscriptionType',
    'status',
    'window',
    'source',
    'message',
    'extra_msg',
    'url',
    'validatedURL',
    'path',
    'filePath',
    'mode',
    'step',
    'count',
    'total',
    'imported',
    'failed',
    'skipped',
    'costUsd',
    'inputTokens',
    'outputTokens',
    'cachedInputTokens',
    'latency_ms',
    'duration_ms',
    'ms',
    'timeoutMs',
    'code',
    'signal',
    'error',
    'reason',
    'line',
    'sourceId',
    'stderrTail',
    'stdoutTail',
  ];

  const output = [];
  const seen = new Set();
  for (const key of prioritized) {
    if (key in entry && !noisy.has(key)) {
      output.push([key, entry[key]]);
      seen.add(key);
    }
  }

  for (const [key, value] of Object.entries(entry)) {
    if (skip.has(key) || noisy.has(key) || seen.has(key)) continue;
    output.push([key, value]);
  }

  return output.filter(([, value]) => value !== '' && value != null).slice(0, 10);
}

function formatField(key, value) {
  return `${fieldKeyColor(key, `${key}=`)}${formatValue(value, key)}`;
}

function fieldKeyColor(key, text) {
  if (isIdentityKey(key)) return color('2;36', text);
  if (key === 'model' || key === 'providerId') return color('2;35', text);
  if (key === 'engineId') return color('2;33', text);
  if (isTimeKey(key)) return color('2;33', text);
  if (isErrorKey(key)) return color('2;31', text);
  if (isPathKey(key) || key === 'url' || key === 'validatedURL' || key === 'sourceId') return color('2;34', text);
  return dim(text);
}

function formatValue(value, key) {
  if (isIdentityKey(key)) {
    return color('2;36', shortSession(value));
  }
  if (typeof value === 'string') return colorForValue(truncate(clean(value)), key);
  if (typeof value === 'number') return colorForNumber(value, key);
  if (typeof value === 'boolean') return value ? green(value) : red(value);
  return dim(truncate(JSON.stringify(value)));
}

function colorForValue(value, key) {
  if (isErrorKey(key)) return red(value);
  if (key === 'message') return color('37', value);
  if (key === 'extra_level') return color(levelColor(value), normalizeLevel(value));
  if (key === 'model' || key === 'providerId') return magenta(value);
  if (key === 'engineId') return yellow(value);
  if (key === 'authMode' || key === 'subscriptionType' || key === 'source') return cyan(value);
  if (key === 'window') return magenta(value);
  if (key === 'status') return statusColor(value);
  if (key === 'mode' || key === 'step' || key === 'signal') return yellow(value);
  if (isPathKey(key) || key === 'url' || key === 'validatedURL' || key === 'sourceId') return underline(color('34', value));
  return color('37', value);
}

function colorForNumber(value, key) {
  if (key === 'extra_level') return color(levelColor(value), normalizeLevel(value));
  if (isTimeKey(key)) return yellow(value);
  if (key === 'costUsd') return magenta(value);
  if (/tokens/i.test(key)) return cyan(value);
  if (/count|total|imported|failed|skipped|line|pid|wcId/i.test(key)) return color('37', value);
  return color('37', value);
}

function statusColor(value) {
  const normalized = String(value).toLowerCase();
  if (/error|fail|stopped|crash|rejected/.test(normalized)) return red(value);
  if (/running|ready|ok|success|idle|completed|complete/.test(normalized)) return green(value);
  if (/stuck|warn|pending/.test(normalized)) return yellow(value);
  return color('37', value);
}

function isIdentityKey(key) {
  return key === 'sessionId' || key === 'session_id' || key === 'id' || key === 'task_id' || key === 'taskId';
}

function isPathKey(key) {
  return key === 'path' || key === 'filePath' || key.endsWith('Path') || key.endsWith('Dir');
}

function isTimeKey(key) {
  return key === 'ms' || key.endsWith('Ms') || key.endsWith('_ms') || key.startsWith('msSince');
}

function isErrorKey(key) {
  return key === 'error' || key === 'reason' || key === 'stderrTail' || /error/i.test(key);
}

function clean(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value, max = 220) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function formatEntry(entry) {
  if (entry.area === 'startup' || String(entry.msg ?? '').startsWith('BrowserPool.startup')) {
    return formatStartup(entry);
  }
  if (entry.area === 'navigation' || String(entry.msg ?? '').startsWith('BrowserPool.navigation')) {
    return formatNavigation(entry);
  }
  return formatGeneric(entry);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  if (trimmed.startsWith('==>') && trimmed.endsWith('<==')) {
    console.log(color('2;36', trimmed.replace(/^==>\s*/, '').replace(/\s*<==$/, '')));
    return;
  }

  try {
    const entry = JSON.parse(trimmed);
    if (shouldPrint(entry)) console.log(formatEntry(entry));
  } catch {
    console.log(dim(trimmed));
  }
});
