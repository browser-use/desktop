import { describe, expect, test, vi } from 'vitest';

const electronMocks = vi.hoisted(() => {
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  return {
    getAppMetrics: vi.fn(),
    spawnSync: vi.fn(() => ({ status: 0, stdout: '' })),
    userData: path.join(os.tmpdir(), 'BrowserUseDesktop-resource-monitor-test'),
  };
});

vi.mock('node:child_process', () => ({
  spawnSync: electronMocks.spawnSync,
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronMocks.userData),
    getAppMetrics: electronMocks.getAppMetrics,
  },
}));

const { snapshotResourceUsage } = await import('../../src/main/resourceMonitor');

describe('resourceMonitor snapshotResourceUsage', () => {
  test('attributes Electron renderer metrics to browser sessions by pid', () => {
    electronMocks.getAppMetrics.mockReturnValue([
      {
        pid: 101,
        type: 'Browser',
        memory: { workingSetSize: 204_800, privateBytes: 102_400 },
        cpu: { percentCPUUsage: 2.4 },
      },
      {
        pid: 202,
        type: 'Tab',
        memory: { workingSetSize: 512_000, privateBytes: 300_000 },
        cpu: { percentCPUUsage: 11.25 },
      },
    ]);

    const snapshot = snapshotResourceUsage({
      browserSessions: () => [{ sessionId: 'session-1', attached: true, createdAt: 1, pid: 202 }],
      sessionInfo: (sessionId) => sessionId === 'session-1'
        ? { prompt: 'Open example.com and summarize it', status: 'running', engine: 'codex' }
        : undefined,
    });

    expect(snapshot.total).toMatchObject({
      rssMb: 700,
      cpuPercent: 13.7,
      processCount: 2,
      electronProcessCount: 2,
    });
    expect(snapshot.byKind['app-main']).toMatchObject({ rssMb: 200, cpuPercent: 2.4, processCount: 1 });
    expect(snapshot.byKind['browser-session']).toMatchObject({ rssMb: 500, cpuPercent: 11.3, processCount: 1 });
    expect(snapshot.bySession['session-1']).toMatchObject({
      rssMb: 500,
      cpuPercent: 11.3,
      processCount: 1,
      status: 'running',
      engine: 'codex',
      label: 'Open example.com and summarize it',
    });
    expect(snapshot.processes.find((p) => p.pid === 202)).toMatchObject({
      kind: 'browser-session',
      sessionId: 'session-1',
      engineId: 'codex',
      label: 'Open example.com and summarize it',
    });
  });
});
