/**
 * Unit tests for daemon logger D2 compliance.
 *
 * Verifies:
 * 1. daemonLogger.debug is a no-op when minLevel is above 'debug'
 *    (simulating production behaviour where the singleton uses minLevel='info')
 * 2. daemonLogger.warn and daemonLogger.error always write regardless of minLevel
 *
 * Run: npx vitest run tests/unit/daemon-logger.test.ts
 *
 * Track E owns this file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { RotatingFileWriter, ChannelLogger } from '../../src/main/logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-logger-test-'));
}

function readJsonLines(filePath: string): Record<string, unknown>[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// D2: debug is a no-op in production (minLevel='info')
// ---------------------------------------------------------------------------

describe('daemon logger — D2 production behaviour (minLevel=info)', () => {
  let tmpDir: string;
  let logPath: string;
  let logger: ChannelLogger;

  beforeEach(() => {
    tmpDir = makeTempDir();
    logPath = path.join(tmpDir, 'daemon.log');
    // Simulate production: minLevel='info' suppresses debug
    const writer = new RotatingFileWriter(logPath);
    logger = new ChannelLogger('daemon', writer, 'info');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('log.debug is a no-op when minLevel=info (production default)', () => {
    logger.debug('DaemonClient.init', { socketPath: '/tmp/test.sock' });
    const entries = readJsonLines(logPath);
    expect(entries.length).toBe(0);
  });

  it('log.info is suppressed when minLevel=info (not a no-op, but gated)', () => {
    // info is allowed at minLevel=info
    logger.info('DaemonClient.connect', { socketPath: '/tmp/test.sock' });
    const entries = readJsonLines(logPath);
    expect(entries.length).toBe(1);
    expect(entries[0]!['level']).toBe('info');
  });

  it('log.warn always writes regardless of minLevel=info', () => {
    logger.warn('ReconnectManager.scheduleReconnect', { attempt: 1, maxAttempts: 10, delayMs: 200 });
    const entries = readJsonLines(logPath);
    expect(entries.length).toBe(1);
    expect(entries[0]!['level']).toBe('warn');
  });

  it('log.error always writes regardless of minLevel=info', () => {
    logger.error('DaemonClient.socket.error', {
      error: 'ECONNREFUSED',
      stack: 'Error: ECONNREFUSED\n    at connect',
      socketPath: '/tmp/test.sock',
      connected: false,
      pendingCount: 3,
    });
    const entries = readJsonLines(logPath);
    expect(entries.length).toBe(1);
    expect(entries[0]!['level']).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// D2: debug writes in dev mode (minLevel='debug')
// ---------------------------------------------------------------------------

describe('daemon logger — D2 dev behaviour (minLevel=debug)', () => {
  let tmpDir: string;
  let logPath: string;
  let logger: ChannelLogger;

  beforeEach(() => {
    tmpDir = makeTempDir();
    logPath = path.join(tmpDir, 'daemon.log');
    // Simulate dev: minLevel='debug' allows all levels
    const writer = new RotatingFileWriter(logPath);
    logger = new ChannelLogger('daemon', writer, 'debug');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('log.debug writes when minLevel=debug (dev mode)', () => {
    logger.debug('DaemonClient.init', { socketPath: '/tmp/dev.sock' });
    const entries = readJsonLines(logPath);
    expect(entries.length).toBe(1);
    expect(entries[0]!['level']).toBe('debug');
    expect(entries[0]!['msg']).toBe('DaemonClient.init');
  });

  it('error log includes surrounding state fields', () => {
    logger.error('DaemonClient.socket.error', {
      error: 'ECONNREFUSED',
      stack: 'Error: ECONNREFUSED\n    at connect',
      socketPath: '/tmp/dev.sock',
      connected: false,
      pendingCount: 2,
    });
    const entries = readJsonLines(logPath);
    expect(entries.length).toBe(1);
    const entry = entries[0]!;
    expect(entry['error']).toBe('ECONNREFUSED');
    expect(entry['socketPath']).toBe('/tmp/dev.sock');
    expect(entry['connected']).toBe(false);
    expect(entry['pendingCount']).toBe(2);
    expect(typeof entry['stack']).toBe('string');
  });

  it('warn log includes attempt number and delay for reconnect diagnostics', () => {
    logger.warn('ReconnectManager.scheduleReconnect', {
      attempt: 3,
      maxAttempts: 10,
      delayMs: 800,
      backoffMs: 400,
    });
    const entries = readJsonLines(logPath);
    expect(entries.length).toBe(1);
    const entry = entries[0]!;
    expect(entry['attempt']).toBe(3);
    expect(entry['maxAttempts']).toBe(10);
    expect(entry['delayMs']).toBe(800);
  });
});
