import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../src/main/consent', () => ({
  isTelemetryConsented: () => true,
}));

vi.mock('../../src/main/installId', () => ({
  getInstallId: () => 'test-install-id',
}));

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tel-remote-test-'));
}

describe('PostHog remote telemetry payloads', () => {
  let tmpDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = makeTempDir();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes distinct_id on metric events', async () => {
    const { TelemetryEmitter } = await import('../../src/main/telemetry');
    const tel = new TelemetryEmitter({ userDataPath: tmpDir, mode: 'remote' });

    tel.increment('daemon_crash_count', 1, { source: 'unit-test' });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({
      event: 'metric.daemon_crash_count',
      distinct_id: 'test-install-id',
    });
    expect(body.properties).toMatchObject({
      kind: 'counter',
      value: 1,
      source: 'unit-test',
    });
  });

  it('includes distinct_id on product capture events', async () => {
    const { captureEvent } = await import('../../src/main/telemetry');

    captureEvent('unit_test_event', { source: 'unit-test' });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({
      event: 'unit_test_event',
      distinct_id: 'test-install-id',
    });
    expect(body.properties).toMatchObject({
      source: 'unit-test',
    });
  });
});
