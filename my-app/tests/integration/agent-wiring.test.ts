/**
 * Integration tests for agent wiring: daemonLifecycle, agentApiKey, pill:submit/cancel.
 *
 * D1 (TDD): written BEFORE implementation — tests define the contract.
 *
 * Strategy:
 *   - Mock child_process.spawn (daemon binary)
 *   - Mock KeychainStore + AccountStore (API key sourcing)
 *   - Mock DaemonClient (socket communication)
 *   - Verify lifecycle: spawn, connect, restart on crash, stop on quit
 *   - Verify pill:submit sends correct agent_task to daemon
 *   - Verify pill:cancel sends cancel_task
 *   - Verify API key is never logged
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

// ---------------------------------------------------------------------------
// vi.hoisted() — variables for vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockSpawn,
  mockDaemonClientInstance,
  MockDaemonClient,
  mockKeychainStoreInstance,
  MockKeychainStore,
  mockAccountStoreInstance,
  MockAccountStore,
  mockForwardAgentEvent,
  mockApp,
} = vi.hoisted(() => {
  const mockDaemonClientInstance = {
    connect: vi.fn(() => Promise.resolve()),
    send: vi.fn(() => Promise.resolve({ ok: true, version: '1.0' })),
    onEvent: vi.fn(() => vi.fn()),
    shutdown: vi.fn(() => Promise.resolve()),
    isConnected: vi.fn(() => true),
    getSocketPath: vi.fn(() => '/tmp/test-daemon.sock'),
    reconnect: { stop: vi.fn() },
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  };

  const mockAccountStoreInstance = {
    load: vi.fn(() => ({ email: 'test@example.com', agent_name: 'TestAgent' })),
    isOnboardingComplete: vi.fn(() => true),
  };

  const mockKeychainStoreInstance = {
    getToken: vi.fn(() => Promise.resolve(null)),
    setToken: vi.fn(() => Promise.resolve()),
    deleteToken: vi.fn(() => Promise.resolve()),
  };

  return {
    mockSpawn: vi.fn(),
    mockDaemonClientInstance,
    MockDaemonClient: vi.fn(() => mockDaemonClientInstance),
    mockKeychainStoreInstance,
    MockKeychainStore: vi.fn(() => mockKeychainStoreInstance),
    mockAccountStoreInstance,
    MockAccountStore: vi.fn(() => mockAccountStoreInstance),
    mockForwardAgentEvent: vi.fn(),
    mockApp: {
      getPath: vi.fn((name: string) => {
        if (name === 'userData') return '/tmp/agentic-test';
        return '/tmp';
      }),
      getAppPath: vi.fn(() => '/test/app'),
      isPackaged: false,
    },
  };
});

// ---------------------------------------------------------------------------
// vi.mock() declarations
// ---------------------------------------------------------------------------

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('electron', () => ({
  app: mockApp,
}));

vi.mock('../../src/main/daemon/client', () => ({
  DaemonClient: MockDaemonClient,
}));

vi.mock('../../src/main/identity/KeychainStore', () => ({
  KeychainStore: MockKeychainStore,
  KEYCHAIN_SERVICE: 'com.agenticbrowser.oauth',
}));

vi.mock('../../src/main/identity/AccountStore', () => ({
  AccountStore: MockAccountStore,
}));

vi.mock('../../src/main/pill', () => ({
  forwardAgentEvent: mockForwardAgentEvent,
}));

vi.mock('../../src/main/logger', () => ({
  mainLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  daemonLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Tests: agentApiKey
// ---------------------------------------------------------------------------

describe('agentApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns API key from keytar when available', async () => {
    const { getApiKey } = await import('../../src/main/agentApiKey');

    // Mock keytar returning a key
    const mockKeytar = {
      getPassword: vi.fn(() => Promise.resolve('sk-ant-test-key-123')),
      setPassword: vi.fn(),
      deletePassword: vi.fn(),
    };

    // Test the function with a keytar override
    const key = await getApiKey({
      keytarModule: mockKeytar,
      accountEmail: 'test@example.com',
    });
    expect(key).toBe('sk-ant-test-key-123');
    expect(mockKeytar.getPassword).toHaveBeenCalledWith(
      'com.agenticbrowser.anthropic',
      'test@example.com',
    );
  });

  it('falls back to ANTHROPIC_API_KEY env var when keytar returns null', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-key-456';
    const { getApiKey } = await import('../../src/main/agentApiKey');

    const key = await getApiKey({
      keytarModule: {
        getPassword: vi.fn(() => Promise.resolve(null)),
        setPassword: vi.fn(),
        deletePassword: vi.fn(),
      },
      accountEmail: 'test@example.com',
    });
    expect(key).toBe('sk-ant-env-key-456');
  });

  it('returns null when no key source available', async () => {
    const { getApiKey } = await import('../../src/main/agentApiKey');

    const key = await getApiKey({
      keytarModule: {
        getPassword: vi.fn(() => Promise.resolve(null)),
        setPassword: vi.fn(),
        deletePassword: vi.fn(),
      },
      accountEmail: 'test@example.com',
    });
    expect(key).toBeNull();
  });

  it('falls back to env var when keytar throws', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fallback-789';
    const { getApiKey } = await import('../../src/main/agentApiKey');

    const key = await getApiKey({
      keytarModule: {
        getPassword: vi.fn(() => Promise.reject(new Error('Keychain access denied'))),
        setPassword: vi.fn(),
        deletePassword: vi.fn(),
      },
      accountEmail: 'test@example.com',
    });
    expect(key).toBe('sk-ant-fallback-789');
  });

  it('never logs the API key value', async () => {
    const loggerModule = await import('../../src/main/logger');
    const { getApiKey } = await import('../../src/main/agentApiKey');

    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-999';
    await getApiKey({
      keytarModule: {
        getPassword: vi.fn(() => Promise.resolve(null)),
        setPassword: vi.fn(),
        deletePassword: vi.fn(),
      },
      accountEmail: 'test@example.com',
    });

    // Check that no log call includes the actual key value
    const allLogCalls = [
      ...((loggerModule.mainLogger.debug as ReturnType<typeof vi.fn>).mock?.calls ?? []),
      ...((loggerModule.mainLogger.info as ReturnType<typeof vi.fn>).mock?.calls ?? []),
      ...((loggerModule.mainLogger.warn as ReturnType<typeof vi.fn>).mock?.calls ?? []),
      ...((loggerModule.mainLogger.error as ReturnType<typeof vi.fn>).mock?.calls ?? []),
    ];

    for (const call of allLogCalls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain('sk-ant-secret-999');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: daemonLifecycle
// ---------------------------------------------------------------------------

describe('daemonLifecycle', () => {
  let mockProcess: EventEmitter & { pid: number; kill: ReturnType<typeof vi.fn>; stdout: EventEmitter; stderr: EventEmitter };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a mock child process
    mockProcess = Object.assign(new EventEmitter(), {
      pid: 12345,
      kill: vi.fn(),
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });

    mockSpawn.mockReturnValue(mockProcess);
  });

  it('startDaemon spawns the daemon binary with correct env', async () => {
    const { startDaemon, stopDaemon } = await import('../../src/main/daemonLifecycle');

    const result = await startDaemon({
      apiKey: 'sk-test',
      daemonClient: mockDaemonClientInstance as any,
      skipConnect: true,
    });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const spawnArgs = mockSpawn.mock.calls[0];
    // Should pass DAEMON_SOCKET_PATH in env
    expect(spawnArgs[2]?.env?.DAEMON_SOCKET_PATH).toBeDefined();
    expect(spawnArgs[2]?.env?.ANTHROPIC_API_KEY).toBe('sk-test');

    await stopDaemon();
  });

  it('stopDaemon kills the daemon process', async () => {
    const { startDaemon, stopDaemon } = await import('../../src/main/daemonLifecycle');

    await startDaemon({
      apiKey: 'sk-test',
      daemonClient: mockDaemonClientInstance as any,
      skipConnect: true,
    });

    await stopDaemon();
    expect(mockProcess.kill).toHaveBeenCalled();
  });

  it('restarts daemon on crash with exponential backoff (max 5 tries)', async () => {
    vi.useFakeTimers();
    const { startDaemon, stopDaemon, _getRestartCount } = await import('../../src/main/daemonLifecycle');

    // Set up fresh mock processes for each spawn call
    const makeProc = (pid: number) => Object.assign(new EventEmitter(), {
      pid,
      kill: vi.fn(),
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });

    const proc1 = makeProc(11111);
    const proc2 = makeProc(22222);
    mockSpawn
      .mockReturnValueOnce(proc1)
      .mockReturnValue(proc2);

    await startDaemon({
      apiKey: 'sk-test',
      daemonClient: mockDaemonClientInstance as any,
      skipConnect: true,
    });

    // Initial spawn: restartCount=0, spawn called once
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(_getRestartCount()).toBe(0);

    // Simulate first crash — scheduleRestart increments restartCount to 1,
    // delay = INITIAL_RESTART_DELAY_MS * BACKOFF_FACTOR^0 = 500ms
    proc1.emit('exit', 1, null);
    expect(_getRestartCount()).toBe(1);
    // Spawn not yet called again (timer is pending)
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    // Advance past the 500ms backoff delay → spawn fires
    await vi.advanceTimersByTimeAsync(600);
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    await stopDaemon();
    vi.useRealTimers();
  });

  it('_getRestartCount increments to 1, 2, 3 across 3 consecutive crashes', async () => {
    vi.useFakeTimers();
    const { startDaemon, stopDaemon, _getRestartCount } = await import('../../src/main/daemonLifecycle');

    const makeProc = (pid: number) => Object.assign(new EventEmitter(), {
      pid,
      kill: vi.fn(),
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });

    // Pre-load spawn mock with a process for each restart
    const procs = [10001, 10002, 10003, 10004].map(makeProc);
    let procIdx = 0;
    mockSpawn.mockImplementation(() => procs[procIdx++] ?? procs[procs.length - 1]);

    await startDaemon({
      apiKey: 'sk-test',
      daemonClient: mockDaemonClientInstance as any,
      skipConnect: true,
    });

    expect(mockSpawn).toHaveBeenCalledTimes(1); // initial spawn
    expect(_getRestartCount()).toBe(0);

    // Crash 1: restartCount → 1, delay 500ms
    procs[0].emit('exit', 1, null);
    expect(_getRestartCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    // Crash 2: restartCount → 2, delay 1000ms
    procs[1].emit('exit', 1, null);
    expect(_getRestartCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(1100);
    expect(mockSpawn).toHaveBeenCalledTimes(3);

    // Crash 3: restartCount → 3, delay 2000ms
    procs[2].emit('exit', 1, null);
    expect(_getRestartCount()).toBe(3);
    await vi.advanceTimersByTimeAsync(2100);
    expect(mockSpawn).toHaveBeenCalledTimes(4);

    await stopDaemon();
    vi.useRealTimers();
  });

  it('does not log API key in spawn env', async () => {
    const loggerModule = await import('../../src/main/logger');
    const { startDaemon, stopDaemon } = await import('../../src/main/daemonLifecycle');

    await startDaemon({
      apiKey: 'sk-ant-super-secret',
      daemonClient: mockDaemonClientInstance as any,
      skipConnect: true,
    });

    const allLogCalls = [
      ...((loggerModule.mainLogger.debug as ReturnType<typeof vi.fn>).mock?.calls ?? []),
      ...((loggerModule.mainLogger.info as ReturnType<typeof vi.fn>).mock?.calls ?? []),
    ];

    for (const call of allLogCalls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain('sk-ant-super-secret');
    }

    await stopDaemon();
  });
});

// ---------------------------------------------------------------------------
// Tests: pill:submit and pill:cancel wiring
// ---------------------------------------------------------------------------

describe('pill:submit / pill:cancel IPC wiring', () => {
  it('pill:submit returns error when no active tab CDP URL', async () => {
    const { handlePillSubmit } = await import('../../src/main/daemonLifecycle');

    const result = await handlePillSubmit({
      prompt: 'test prompt',
      getActiveTabCdpUrl: async () => null,
      daemonClient: mockDaemonClientInstance as any,
      getApiKey: async () => 'sk-test',
    });

    expect(result).toEqual(expect.objectContaining({ error: 'no_active_tab' }));
  });

  it('pill:submit returns error when no API key', async () => {
    const { handlePillSubmit } = await import('../../src/main/daemonLifecycle');

    const result = await handlePillSubmit({
      prompt: 'test prompt',
      getActiveTabCdpUrl: async () => 'ws://localhost:9222/devtools/page/ABC',
      daemonClient: mockDaemonClientInstance as any,
      getApiKey: async () => null,
    });

    expect(result).toEqual(expect.objectContaining({ error: 'missing_api_key' }));
  });

  it('pill:submit sends agent_task to daemon and returns task_id', async () => {
    const { handlePillSubmit } = await import('../../src/main/daemonLifecycle');

    mockDaemonClientInstance.send.mockResolvedValueOnce({ ok: true, version: '1.0' });

    const result = await handlePillSubmit({
      prompt: 'scroll to bottom',
      getActiveTabCdpUrl: async () => 'ws://localhost:9222/devtools/page/ABC',
      daemonClient: mockDaemonClientInstance as any,
      getApiKey: async () => 'sk-test',
    });

    expect(result.task_id).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(mockDaemonClientInstance.send).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: 'agent_task',
        prompt: 'scroll to bottom',
        per_target_cdp_url: 'ws://localhost:9222/devtools/page/ABC',
      }),
    );
  });

  it('pill:cancel sends cancel_task to daemon', async () => {
    const { handlePillCancel } = await import('../../src/main/daemonLifecycle');

    mockDaemonClientInstance.send.mockResolvedValueOnce({ ok: true, version: '1.0' });

    const result = await handlePillCancel({
      task_id: 'test-task-123',
      daemonClient: mockDaemonClientInstance as any,
    });

    expect(result).toEqual({ ok: true });
    expect(mockDaemonClientInstance.send).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: 'cancel_task',
        task_id: 'test-task-123',
      }),
    );
  });

  it('pill:submit returns error when daemon is not connected', async () => {
    const { handlePillSubmit } = await import('../../src/main/daemonLifecycle');

    mockDaemonClientInstance.send.mockRejectedValueOnce(
      new Error('DaemonClient: Not connected to daemon'),
    );

    const result = await handlePillSubmit({
      prompt: 'test prompt',
      getActiveTabCdpUrl: async () => 'ws://localhost:9222/devtools/page/ABC',
      daemonClient: mockDaemonClientInstance as any,
      getApiKey: async () => 'sk-test',
    });

    expect(result.error).toBe('daemon_unavailable');
  });
});
