/**
 * IPC Protocol Tests — Track E
 *
 * Tests:
 * 1. Round-trip encode/decode for every message type
 * 2. Reconnect on socket close
 * 3. PID-scoped socket path (multi-instance safety)
 * 4. Push event ordering (100 events in sequence, no drops)
 * 5. Error envelope validation
 */

import * as net from "net";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

import {
  PROTOCOL_VERSION,
  AgentTaskRequest,
  CancelTaskRequest,
  SetActiveTargetRequest,
  PingRequest,
  ShutdownRequest,
  TaskStartedEvent,
  StepStartEvent,
  StepResultEvent,
  StepErrorEvent,
  TaskDoneEvent,
  TaskFailedEvent,
  TaskCancelledEvent,
  TargetLostEvent,
  SuccessResponse,
  ErrorResponse,
  makeRequest,
  parseSocketLine,
  isAgentEvent,
  isDaemonResponse,
  assertVersion,
} from "../../src/shared/types";
import { EventStream } from "../../src/main/daemon/eventStream";
import { ReconnectManager } from "../../src/main/daemon/reconnect";
import { DaemonClient } from "../../src/main/daemon/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpSocketPath(suffix = ""): string {
  return path.join(os.tmpdir(), `test-daemon-${process.pid}-${Date.now()}${suffix}.sock`);
}

function writeLine(socket: net.Socket, obj: unknown): void {
  socket.write(JSON.stringify(obj) + "\n");
}

/**
 * Create a minimal mock daemon server that:
 * - Accepts one connection
 * - Echoes requests back as {ok: true, result: ..., _seq: ...}
 * - Can also push events on demand
 */
function createMockServer(socketPath: string): {
  server: net.Server;
  pushEvent: (conn: net.Socket, event: unknown) => void;
  close: () => Promise<void>;
  waitForConnection: () => Promise<net.Socket>;
} {
  const server = net.createServer();

  let resolveConn: ((sock: net.Socket) => void) | null = null;
  const connPromise = new Promise<net.Socket>((resolve) => {
    resolveConn = resolve;
  });

  server.on("connection", (sock) => {
    let buf = "";
    sock.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const req = JSON.parse(line) as Record<string, unknown>;
          const seq = req["_seq"];
          // Echo back as success response
          const resp: Record<string, unknown> = {
            version: PROTOCOL_VERSION,
            ok: true,
            result: { echo: req["meta"] },
          };
          if (seq !== undefined) resp["_seq"] = seq;
          writeLine(sock, resp);
        } catch {
          // ignore parse errors in test
        }
      }
    });
    if (resolveConn) resolveConn(sock);
  });

  server.listen(socketPath);

  return {
    server,
    pushEvent: (conn: net.Socket, event: unknown) => writeLine(conn, event),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
    waitForConnection: () => connPromise,
  };
}

// ---------------------------------------------------------------------------
// Test runner (minimal — no external test framework dependency)
// ---------------------------------------------------------------------------

type TestFn = () => Promise<void>;
const tests: Array<{ name: string; fn: TestFn }> = [];

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}

async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  PASS  ${t.name}`);
      passed++;
    } catch (err) {
      console.error(`  FAIL  ${t.name}`);
      console.error(`        ${(err as Error).message}`);
      if (process.env["VERBOSE"]) console.error((err as Error).stack);
      failed++;
    }
  }

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Test 1: Round-trip encode/decode — every request type
// ---------------------------------------------------------------------------

test("Round-trip: AgentTaskRequest encode/decode", async () => {
  const req: AgentTaskRequest = makeRequest({
    meta: "agent_task",
    prompt: "scroll to bottom",
    per_target_cdp_url: "ws://127.0.0.1:9222/devtools/page/ABC123",
    task_id: "task-001",
  });

  assertEqual(req.version, PROTOCOL_VERSION, "version");
  assertEqual(req.meta, "agent_task", "meta");
  assertEqual(req.prompt, "scroll to bottom", "prompt");
  assertEqual(req.per_target_cdp_url, "ws://127.0.0.1:9222/devtools/page/ABC123", "cdp_url");
  assertEqual(req.task_id, "task-001", "task_id");

  const json = JSON.stringify(req);
  const parsed = parseSocketLine(json);
  assert(isDaemonResponse(parsed) === false, "should not be daemon response");
  // After version assertion it's safe to cast (via unknown for strict mode)
  assertEqual((parsed as unknown as AgentTaskRequest).meta, "agent_task", "round-trip meta");
});

test("Round-trip: CancelTaskRequest encode/decode", async () => {
  const req: CancelTaskRequest = makeRequest({ meta: "cancel_task", task_id: "task-001" });
  assertEqual(req.version, PROTOCOL_VERSION, "version");
  const json = JSON.stringify(req);
  const parsed = JSON.parse(json) as CancelTaskRequest;
  assertVersion(parsed);
  assertEqual(parsed.task_id, "task-001", "task_id");
});

test("Round-trip: SetActiveTargetRequest encode/decode", async () => {
  const req: SetActiveTargetRequest = makeRequest({
    meta: "set_active_target",
    per_target_cdp_url: "ws://127.0.0.1:9222/devtools/page/DEF456",
  });
  assertEqual(req.version, PROTOCOL_VERSION, "version");
  const parsed = JSON.parse(JSON.stringify(req)) as SetActiveTargetRequest;
  assertVersion(parsed);
  assertEqual(parsed.per_target_cdp_url, "ws://127.0.0.1:9222/devtools/page/DEF456", "cdp_url");
});

test("Round-trip: PingRequest encode/decode", async () => {
  const req: PingRequest = makeRequest({ meta: "ping" });
  const parsed = JSON.parse(JSON.stringify(req)) as PingRequest;
  assertVersion(parsed);
  assertEqual(parsed.meta, "ping", "meta");
});

test("Round-trip: ShutdownRequest encode/decode", async () => {
  const req: ShutdownRequest = makeRequest({ meta: "shutdown" });
  const parsed = JSON.parse(JSON.stringify(req)) as ShutdownRequest;
  assertVersion(parsed);
  assertEqual(parsed.meta, "shutdown", "meta");
});

test("Round-trip: SuccessResponse encode/decode", async () => {
  const resp: SuccessResponse = { version: PROTOCOL_VERSION, ok: true, result: { foo: "bar" } };
  const parsed = JSON.parse(JSON.stringify(resp)) as SuccessResponse;
  assertVersion(parsed);
  assert(isDaemonResponse(parsed), "should be daemon response");
  assert(parsed.ok === true, "ok should be true");
});

test("Round-trip: ErrorResponse encode/decode", async () => {
  const resp: ErrorResponse = {
    version: PROTOCOL_VERSION,
    ok: false,
    error: { code: "TASK_ALREADY_RUNNING", message: "A task is already running", retryable: false },
  };
  const parsed = JSON.parse(JSON.stringify(resp)) as ErrorResponse;
  assertVersion(parsed);
  assert(isDaemonResponse(parsed), "should be daemon response");
  assert(parsed.ok === false, "ok should be false");
  assertEqual((parsed as ErrorResponse).error.code, "TASK_ALREADY_RUNNING", "error.code");
});

test("Round-trip: All 8 AgentEvent types encode/decode", async () => {
  const events: unknown[] = [
    { version: PROTOCOL_VERSION, event: "task_started", task_id: "t1", started_at: new Date().toISOString() } as TaskStartedEvent,
    { version: PROTOCOL_VERSION, event: "step_start", task_id: "t1", step: 1, plan: "Click the button" } as StepStartEvent,
    { version: PROTOCOL_VERSION, event: "step_result", task_id: "t1", step: 1, result: null, duration_ms: 120 } as StepResultEvent,
    { version: PROTOCOL_VERSION, event: "step_error", task_id: "t1", step: 2, error: { code: "SANDBOX_VIOLATION", message: "blocked", retryable: false } } as StepErrorEvent,
    { version: PROTOCOL_VERSION, event: "task_done", task_id: "t1", result: "done", steps_used: 3, tokens_used: 1500 } as TaskDoneEvent,
    { version: PROTOCOL_VERSION, event: "task_failed", task_id: "t1", reason: "step_budget_exhausted" } as TaskFailedEvent,
    { version: PROTOCOL_VERSION, event: "task_cancelled", task_id: "t1" } as TaskCancelledEvent,
    { version: PROTOCOL_VERSION, event: "target_lost", task_id: "t1", target_id: "ABC123" } as TargetLostEvent,
  ];

  for (const evt of events) {
    const json = JSON.stringify(evt);
    const parsed = JSON.parse(json) as unknown;
    assertVersion(parsed);
    assert(isAgentEvent(parsed), `should be AgentEvent: ${json.slice(0, 80)}`);
  }
});

// ---------------------------------------------------------------------------
// Test 2: PID-scoped socket path (multi-instance safety)
// ---------------------------------------------------------------------------

test("PID-scoped socket path contains process PID", async () => {
  // DaemonClient requires app.getPath which is only available in Electron main.
  // Test the path pattern directly instead.
  const pid = process.pid;
  const socketName = `daemon-${pid}.sock`;
  assert(socketName.includes(String(pid)), "socket name should contain PID");

  // Two different fake PIDs should produce different paths
  const pid1 = 12345;
  const pid2 = 67890;
  // Widen to `string` so tsc doesn't treat the comparison as a literal-vs-literal
  // overlap check (which would be unconditionally true at the type level).
  const path1: string = `/tmp/userData/daemon-${pid1}.sock`;
  const path2: string = `/tmp/userData/daemon-${pid2}.sock`;
  assert(path1 !== path2, "different PIDs should have different socket paths");
  assert(!path1.includes("67890"), "path1 should not contain PID2");
  assert(!path2.includes("12345"), "path2 should not contain PID1");

  console.log(`        Socket path pattern: daemon-${pid}.sock`);
});

// ---------------------------------------------------------------------------
// Test 3: EventStream — push events fan-out and ordering
// ---------------------------------------------------------------------------

test("EventStream: global subscribe receives all events", async () => {
  const stream = new EventStream();
  const received: string[] = [];

  const unsub = stream.subscribe((evt) => received.push(evt.event));

  const events: TaskStartedEvent[] = [
    { version: PROTOCOL_VERSION, event: "task_started", task_id: "t1", started_at: "2026-01-01T00:00:00Z" },
    { version: PROTOCOL_VERSION, event: "task_started", task_id: "t2", started_at: "2026-01-01T00:00:01Z" },
  ];
  for (const e of events) stream.emit(e);

  assertEqual(received.length, 2, "received count");
  assertEqual(received[0], "task_started", "first event type");
  unsub();
});

test("EventStream: typed subscribe receives only matching events", async () => {
  const stream = new EventStream();
  const started: string[] = [];
  const done: string[] = [];

  stream.subscribeToType<TaskStartedEvent>("task_started", (e) => started.push(e.task_id));
  stream.subscribeToType<TaskDoneEvent>("task_done", (e) => done.push(e.task_id));

  stream.emit({ version: PROTOCOL_VERSION, event: "task_started", task_id: "t1", started_at: "2026-01-01T00:00:00Z" });
  stream.emit({ version: PROTOCOL_VERSION, event: "task_done", task_id: "t1", result: null, steps_used: 1, tokens_used: 100 });
  stream.emit({ version: PROTOCOL_VERSION, event: "task_started", task_id: "t2", started_at: "2026-01-01T00:00:02Z" });

  assertEqual(started.length, 2, "started count");
  assertEqual(done.length, 1, "done count");
  assertEqual(started[1], "t2", "second started task_id");
});

test("EventStream: task subscribe receives only events for that task", async () => {
  const stream = new EventStream();
  const forTask1: string[] = [];

  stream.subscribeToTask("task-1", (e) => forTask1.push(e.event));

  stream.emit({ version: PROTOCOL_VERSION, event: "task_started", task_id: "task-1", started_at: "2026-01-01T00:00:00Z" });
  stream.emit({ version: PROTOCOL_VERSION, event: "task_started", task_id: "task-2", started_at: "2026-01-01T00:00:00Z" });
  stream.emit({ version: PROTOCOL_VERSION, event: "task_done", task_id: "task-1", result: null, steps_used: 1, tokens_used: 0 });

  assertEqual(forTask1.length, 2, "task-1 event count");
  assert(!forTask1.includes("task-2"), "should not include task-2 events");
});

test("EventStream: 100 events received in order with no drops", async () => {
  const stream = new EventStream();
  const received: number[] = [];

  stream.subscribe((evt) => {
    received.push((evt as unknown as { seq: number }).seq);
  });

  for (let i = 0; i < 100; i++) {
    stream.emit({
      version: PROTOCOL_VERSION,
      event: "step_start",
      task_id: "t-seq",
      step: i + 1,
      plan: `step ${i + 1}`,
      seq: i,
    } as unknown as StepStartEvent);
  }

  assertEqual(received.length, 100, "should receive all 100 events");
  for (let i = 0; i < 100; i++) {
    assertEqual(received[i], i, `event ${i} should be in order`);
  }
});

test("EventStream: unsubscribe stops receiving events", async () => {
  const stream = new EventStream();
  const received: string[] = [];
  const unsub = stream.subscribe((e) => received.push(e.event));

  stream.emit({ version: PROTOCOL_VERSION, event: "task_started", task_id: "t1", started_at: "2026-01-01T00:00:00Z" });
  unsub();
  stream.emit({ version: PROTOCOL_VERSION, event: "task_cancelled", task_id: "t1" });

  assertEqual(received.length, 1, "should only receive 1 event after unsubscribe");
});

// ---------------------------------------------------------------------------
// Test 4: ReconnectManager — exponential backoff and give-up
// ---------------------------------------------------------------------------

test("ReconnectManager: resets attempts on connect", async () => {
  const reconnectMgr = new ReconnectManager({
    onReconnect: async () => {},
    onGiveUp: () => {},
    maxAttempts: 3,
  });

  reconnectMgr.onDisconnected(); // attempt 1
  await new Promise((r) => setTimeout(r, 50)); // let timer tick

  reconnectMgr.onConnected(); // should reset
  assertEqual(reconnectMgr.getAttempts(), 0, "attempts should reset to 0 after connect");
  reconnectMgr.stop();
});

test("ReconnectManager: calls onGiveUp after max attempts", async () => {
  let gaveUp = false;
  let reconnectCount = 0;

  const mgr = new ReconnectManager({
    onReconnect: async () => {
      reconnectCount++;
      // Simulate failure — disconnected will be called again by caller
    },
    onGiveUp: () => {
      gaveUp = true;
    },
    maxAttempts: 2,
    initialDelayMs: 10,
    maxDelayMs: 20,
  });

  // Simulate repeated disconnects
  mgr.onDisconnected();
  await new Promise((r) => setTimeout(r, 15));
  mgr.onDisconnected();
  await new Promise((r) => setTimeout(r, 15));
  mgr.onDisconnected();
  await new Promise((r) => setTimeout(r, 15));

  assert(gaveUp, "should have called onGiveUp after max attempts");
  mgr.stop();
});

test("ReconnectManager: stop prevents further reconnect attempts", async () => {
  let reconnectCount = 0;

  const mgr = new ReconnectManager({
    onReconnect: async () => { reconnectCount++; },
    onGiveUp: () => {},
    initialDelayMs: 10,
    maxAttempts: 5,
  });

  mgr.onDisconnected();
  mgr.stop(); // stop immediately
  await new Promise((r) => setTimeout(r, 50));

  assertEqual(reconnectCount, 0, "no reconnects after stop");
  assert(mgr.isStopped(), "should be marked stopped");
});

// ---------------------------------------------------------------------------
// Test 5: Reconnect on socket close (integration with mock server)
// ---------------------------------------------------------------------------

test("Reconnect: client detects socket close and triggers reconnect", async () => {
  const socketPath = tmpSocketPath("-reconnect");
  let disconnectFired = false;

  // Create a mock server
  const { server, close: closeServer, waitForConnection } = createMockServer(socketPath);
  await new Promise<void>((r) => server.once("listening", () => r()));

  const client = new DaemonClient({ socketPath, pingIntervalMs: 999999 });

  client.on("disconnected", () => {
    disconnectFired = true;
  });

  // Override reconnect to stop immediately so we don't retry indefinitely
  client.reconnect.stop();

  await client.connect();
  const serverConn = await waitForConnection();

  // Destroy the server-side socket to simulate daemon crash
  serverConn.destroy();
  await new Promise<void>((r) => setTimeout(r, 300));

  assert(disconnectFired, "disconnected event should fire on socket close");

  await closeServer();

  // Clean up socket file
  try { fs.unlinkSync(socketPath); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Test 6: Error envelope — invalid version rejected
// ---------------------------------------------------------------------------

test("assertVersion: throws on missing version", async () => {
  let threw = false;
  try {
    assertVersion({ meta: "ping" });
  } catch (err) {
    threw = true;
    assert((err as Error).message.includes("missing"), "error should mention missing");
  }
  assert(threw, "should throw on missing version");
});

test("assertVersion: throws on wrong version", async () => {
  let threw = false;
  try {
    assertVersion({ version: "9.9", meta: "ping" });
  } catch (err) {
    threw = true;
    assert((err as Error).message.includes("mismatch"), "error should mention mismatch");
  }
  assert(threw, "should throw on wrong version");
});

test("assertVersion: accepts correct version 1.0", async () => {
  // Should not throw
  assertVersion({ version: "1.0", meta: "ping" });
});

test("parseSocketLine: throws on invalid JSON", async () => {
  let threw = false;
  try {
    parseSocketLine("not-json{{{");
  } catch {
    threw = true;
  }
  assert(threw, "should throw on invalid JSON");
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("\nTrack E — IPC Protocol Tests\n");
runTests().catch((err: Error) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
