/**
 * Unit tests for src/main/telemetry.ts
 *
 * Tests are framework: vitest (no Electron dependency needed — telemetry.ts
 * falls back to os.tmpdir() when electron is not available).
 *
 * Run: npx vitest run tests/unit/telemetry.test.ts
 *
 * Track H owns this file.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  TelemetryEmitter,
  METRIC_THRESHOLDS,
  ThresholdViolation,
} from '../../src/main/telemetry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tel-test-'));
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe('TelemetryEmitter — observe()', () => {
  let tel: TelemetryEmitter;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    tel = new TelemetryEmitter({ userDataPath: tmpDir, mode: 'local' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 for p95 when no samples recorded', () => {
    expect(tel.getP95('pill_open_latency_ms')).toBe(0);
  });

  it('records a single observation and returns it as p95', () => {
    tel.observe('pill_open_latency_ms', 100);
    expect(tel.getP95('pill_open_latency_ms')).toBe(100);
  });

  it('maintains histogram in sorted order after multiple observations', () => {
    tel.observe('pill_open_latency_ms', 300);
    tel.observe('pill_open_latency_ms', 50);
    tel.observe('pill_open_latency_ms', 150);

    const samples = tel.getHistogram('pill_open_latency_ms');
    expect(samples).toEqual([50, 150, 300]);
  });

  it('computes p95 correctly for a known dataset', () => {
    // 20 samples: 1..20
    for (let i = 1; i <= 20; i++) {
      tel.observe('daemon_startup_ms', i * 100);
    }
    // p95 of [100, 200, ..., 2000] = value at index ceil(0.95*20)-1 = 18 → 1900
    const p95 = tel.getP95('daemon_startup_ms');
    expect(p95).toBe(1900);
  });

  it('computes p99 correctly for a known dataset', () => {
    for (let i = 1; i <= 100; i++) {
      tel.observe('agent_task_duration_ms', i);
    }
    // p99 = value at index ceil(0.99*100)-1 = 98 → 99
    const p99 = tel.getP99('agent_task_duration_ms');
    expect(p99).toBe(99);
  });

  it('writes observations to local JSONL file', () => {
    tel.observe('pill_open_latency_ms', 42);
    const logPath = path.join(tmpDir, 'telemetry.jsonl');
    expect(fs.existsSync(logPath)).toBe(true);
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.metric).toBe('pill_open_latency_ms');
    expect(entry.value).toBe(42);
    expect(entry.kind).toBe('histogram');
    expect(typeof entry.ts).toBe('string');
  });
});

describe('TelemetryEmitter — increment()', () => {
  let tel: TelemetryEmitter;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    tel = new TelemetryEmitter({ userDataPath: tmpDir, mode: 'local' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 for unknown counter', () => {
    expect(tel.getCounter('daemon_crash_count')).toBe(0);
  });

  it('increments counter by 1 by default', () => {
    tel.increment('daemon_crash_count');
    expect(tel.getCounter('daemon_crash_count')).toBe(1);
  });

  it('increments counter by a custom delta', () => {
    tel.increment('daemon_crash_count', 5);
    expect(tel.getCounter('daemon_crash_count')).toBe(5);
  });

  it('accumulates across multiple calls', () => {
    tel.increment('daemon_crash_count');
    tel.increment('daemon_crash_count');
    tel.increment('daemon_crash_count', 3);
    expect(tel.getCounter('daemon_crash_count')).toBe(5);
  });

  it('writes counter entry to local JSONL', () => {
    tel.increment('daemon_crash_count', 2);
    const lines = fs
      .readFileSync(path.join(tmpDir, 'telemetry.jsonl'), 'utf-8')
      .trim()
      .split('\n');
    const entry = JSON.parse(lines[lines.length - 1]!);
    expect(entry.metric).toBe('daemon_crash_count');
    expect(entry.kind).toBe('counter');
  });
});

describe('TelemetryEmitter — gauge()', () => {
  let tel: TelemetryEmitter;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    tel = new TelemetryEmitter({ userDataPath: tmpDir, mode: 'local' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns undefined for unset gauge', () => {
    expect(tel.getGauge('session_restore_success_rate')).toBeUndefined();
  });

  it('stores and retrieves a gauge value', () => {
    tel.gauge('session_restore_success_rate', 0.995);
    expect(tel.getGauge('session_restore_success_rate')).toBe(0.995);
  });

  it('overwrites previous gauge value with latest', () => {
    tel.gauge('session_restore_success_rate', 0.98);
    tel.gauge('session_restore_success_rate', 0.99);
    expect(tel.getGauge('session_restore_success_rate')).toBe(0.99);
  });
});

describe('TelemetryEmitter — threshold violations', () => {
  let tel: TelemetryEmitter;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    tel = new TelemetryEmitter({ userDataPath: tmpDir, mode: 'local' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits threshold-violation event when pill_open_latency_ms p95 exceeds 150ms', () => {
    const violations: ThresholdViolation[] = [];
    tel.on('threshold-violation', (v: ThresholdViolation) => violations.push(v));

    // Fill 100 samples all at 200ms (above p95 threshold of 150ms)
    for (let i = 0; i < 100; i++) {
      tel.observe('pill_open_latency_ms', 200);
    }

    const p95Violations = violations.filter(
      (v) => v.metric === 'pill_open_latency_ms' && v.percentile === 'p95',
    );
    expect(p95Violations.length).toBeGreaterThan(0);
    expect(p95Violations[0]!.threshold).toBe(150);
    expect(p95Violations[0]!.actual).toBeGreaterThan(150);
  });

  it('does NOT emit threshold-violation when pill_open_latency_ms p95 is within 150ms', () => {
    const violations: ThresholdViolation[] = [];
    tel.on('threshold-violation', (v: ThresholdViolation) => violations.push(v));

    // 100 samples all at 100ms (well under threshold)
    for (let i = 0; i < 100; i++) {
      tel.observe('pill_open_latency_ms', 100);
    }

    const p95Violations = violations.filter(
      (v) => v.metric === 'pill_open_latency_ms' && v.percentile === 'p95',
    );
    expect(p95Violations.length).toBe(0);
  });

  it('emits threshold-violation when daemon_startup_ms p95 exceeds 3000ms', () => {
    const violations: ThresholdViolation[] = [];
    tel.on('threshold-violation', (v: ThresholdViolation) => violations.push(v));

    for (let i = 0; i < 100; i++) {
      tel.observe('daemon_startup_ms', 4000);
    }

    const p95Violations = violations.filter(
      (v) => v.metric === 'daemon_startup_ms' && v.percentile === 'p95',
    );
    expect(p95Violations.length).toBeGreaterThan(0);
  });

  it('emits threshold-violation when session_restore_success_rate drops below 0.99', () => {
    const violations: ThresholdViolation[] = [];
    tel.on('threshold-violation', (v: ThresholdViolation) => violations.push(v));

    tel.gauge('session_restore_success_rate', 0.97);

    const minViolations = violations.filter(
      (v) => v.metric === 'session_restore_success_rate',
    );
    expect(minViolations.length).toBeGreaterThan(0);
    expect(minViolations[0]!.threshold).toBe(0.99);
    expect(minViolations[0]!.actual).toBe(0.97);
  });

  it('emits threshold-violation when daemon_crash_rate_per_session exceeds 0.01', () => {
    const violations: ThresholdViolation[] = [];
    tel.on('threshold-violation', (v: ThresholdViolation) => violations.push(v));

    tel.gauge('daemon_crash_rate_per_session', 0.05);

    const maxViolations = violations.filter(
      (v) => v.metric === 'daemon_crash_rate_per_session',
    );
    expect(maxViolations.length).toBeGreaterThan(0);
  });

  it('does NOT emit threshold-violation for histogram-only metrics (agent_task_duration_ms)', () => {
    const violations: ThresholdViolation[] = [];
    tel.on('threshold-violation', (v: ThresholdViolation) => violations.push(v));

    // agent_task_duration_ms has no threshold — only histogram storage
    for (let i = 0; i < 100; i++) {
      tel.observe('agent_task_duration_ms', 999_999);
    }

    const durationViolations = violations.filter(
      (v) => v.metric === 'agent_task_duration_ms',
    );
    expect(durationViolations.length).toBe(0);
  });
});

describe('TelemetryEmitter — reset()', () => {
  let tel: TelemetryEmitter;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    tel = new TelemetryEmitter({ userDataPath: tmpDir, mode: 'local' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('clears all histograms, counters, and gauges after reset()', () => {
    tel.observe('pill_open_latency_ms', 100);
    tel.increment('daemon_crash_count', 3);
    tel.gauge('session_restore_success_rate', 0.99);

    tel.reset();

    expect(tel.getHistogram('pill_open_latency_ms')).toEqual([]);
    expect(tel.getCounter('daemon_crash_count')).toBe(0);
    expect(tel.getGauge('session_restore_success_rate')).toBeUndefined();
  });
});

describe('METRIC_THRESHOLDS — completeness', () => {
  it('defines pill_open_latency_ms with p95=150 and p99=300', () => {
    expect(METRIC_THRESHOLDS['pill_open_latency_ms']?.p95).toBe(150);
    expect(METRIC_THRESHOLDS['pill_open_latency_ms']?.p99).toBe(300);
  });

  it('defines daemon_startup_ms with p95=3000', () => {
    expect(METRIC_THRESHOLDS['daemon_startup_ms']?.p95).toBe(3000);
  });

  it('defines daemon_crash_rate_per_session with max=0.01', () => {
    expect(METRIC_THRESHOLDS['daemon_crash_rate_per_session']?.max).toBe(0.01);
  });

  it('defines session_restore_success_rate with min=0.99', () => {
    expect(METRIC_THRESHOLDS['session_restore_success_rate']?.min).toBe(0.99);
  });

  it('defines agent_task_success_rate with min=0.80', () => {
    expect(METRIC_THRESHOLDS['agent_task_success_rate']?.min).toBe(0.80);
  });

  it('defines sandbox_violations_per_day with max=5', () => {
    expect(METRIC_THRESHOLDS['sandbox_violations_per_day']?.max).toBe(5);
  });

  it('defines agent_task_duration_ms with empty threshold (histogram only)', () => {
    expect(METRIC_THRESHOLDS['agent_task_duration_ms']).toBeDefined();
    expect(METRIC_THRESHOLDS['agent_task_duration_ms']?.p95).toBeUndefined();
    expect(METRIC_THRESHOLDS['agent_task_duration_ms']?.max).toBeUndefined();
  });
});
