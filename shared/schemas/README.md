# IPC & Protocol Specification — Track E

**Version:** 1.0  
**Status:** Authoritative (do not edit without Track E owner review)

---

## Overview

All cross-process messages between Electron main and the Python agent daemon flow over a **Unix domain socket** using newline-delimited JSON (NDJSON). Every message carries a `version` field that must equal `"1.0"`.

This directory is the single source of truth. TypeScript types (`src/shared/types.ts`) and Python types (`python/agent/schemas.py`) are **generated** from these schemas — never edit them by hand.

---

## Transport

### Socket path

```
${app.getPath('userData')}/daemon-${process.pid}.sock
```

The PID is the Electron main process PID. This guarantees multi-instance safety — each Electron window gets its own daemon and socket. Two concurrent app instances cannot collide (Critic C10, plan §4).

### Wire format

- One JSON object per line (`\n` delimited, no trailing newline required on each message)
- UTF-8 encoding
- No binary framing; newline is the sole delimiter
- Max message size: 4 MB (enforced in client.ts)

### Direction

| Direction | Message types | Schema file |
|---|---|---|
| Main → Daemon | Requests (`agent_task`, `cancel_task`, `set_active_target`, `ping`, `shutdown`) | `agent_task.schema.json` |
| Daemon → Main | Responses (`ok: true/false`) | `agent_task.schema.json` |
| Daemon → Main | Push events (one per line, unsolicited) | `agent_events.schema.json` |
| Main → Renderer | Tab state events (via Electron IPC / contextBridge) | `tab_state.schema.json` |
| Renderer ↔ Main | Onboarding flow messages | `onboarding.schema.json` |

---

## Request/Response Protocol

### Requests (Main → Daemon)

All requests include `version: "1.0"` and a `meta` discriminant.

```jsonc
// Start an agent task on a specific tab
{
  "version": "1.0",
  "meta": "agent_task",
  "prompt": "scroll to the bottom of the page",
  "per_target_cdp_url": "ws://127.0.0.1:49152/devtools/page/ABC123",
  "task_id": "550e8400-e29b-41d4-a716-446655440000"
}

// Cancel a running task
{ "version": "1.0", "meta": "cancel_task", "task_id": "550e8400-..." }

// Notify daemon of newly active tab (no task started yet)
{ "version": "1.0", "meta": "set_active_target", "per_target_cdp_url": "ws://..." }

// Liveness check — daemon echoes {ok: true}
{ "version": "1.0", "meta": "ping" }

// Graceful shutdown request
{ "version": "1.0", "meta": "shutdown" }
```

**Key invariant:** `per_target_cdp_url` is always the **per-target** CDP WebSocket URL (`/devtools/page/{targetId}`), never the browser-level endpoint. This enforces active-tab-only access at the transport layer (plan principle #4).

### Responses (Daemon → Main, synchronous reply)

```jsonc
// Success
{ "version": "1.0", "ok": true, "result": { ... } }

// Failure — never exposes raw stacktraces
{
  "version": "1.0",
  "ok": false,
  "error": {
    "code": "TASK_ALREADY_RUNNING",
    "message": "A task is already running for this target",
    "retryable": false
  }
}
```

---

## Push Events (Daemon → Main)

The daemon writes events to the socket as they occur — **push-based, not polled**. The TS client subscribes via `onEvent()` and processes lines as they arrive.

All events include `version: "1.0"` and an `event` discriminant.

### Event reference

| Event | Trigger | Key fields |
|---|---|---|
| `task_started` | Daemon accepted the task | `task_id`, `started_at` (ISO 8601) |
| `step_start` | Agent begins a step | `task_id`, `step` (1-based), `plan` |
| `step_result` | Step completed successfully | `task_id`, `step`, `result`, `duration_ms` |
| `step_error` | Step raised an exception | `task_id`, `step`, `error` |
| `task_done` | Task completed successfully | `task_id`, `result`, `steps_used`, `tokens_used` |
| `task_failed` | Task terminated with failure | `task_id`, `reason`, `partial_result?` |
| `task_cancelled` | Cancel was received and honoured | `task_id` |
| `target_lost` | CDP `Target.detachedFromTarget` fired | `task_id`, `target_id` |

### Failure reasons

| `reason` | Meaning |
|---|---|
| `step_budget_exhausted` | Hit the 20-step default limit |
| `token_budget_exhausted` | Hit the 100k input-token default limit |
| `sandbox_violation` | `exec_sandbox` blocked malicious Python |
| `llm_error` | LLM API returned an error |
| `cdp_error` | CDP WebSocket error or disconnect |
| `internal_error` | Unexpected daemon error |

### Example event sequence

```
task_started
step_start (step=1)
step_result (step=1)
step_start (step=2)
step_error (step=2)       // agent self-corrects on next LLM call
step_start (step=3)
step_result (step=3)
task_done
```

---

## Versioning

- Every message includes `"version": "1.0"`.
- Breaking changes (field removal, type change) require a version bump to `"1.1"` (minor) or `"2.0"` (major).
- Additive changes (new optional fields) are backward-compatible within `"1.0"`.
- The TS client rejects messages with an unknown version and logs a warning; it does not crash.
- The daemon rejects requests with an unknown version and returns `{ok: false, error: {code: "VERSION_MISMATCH", ...}}`.

### Migration policy

1. Bump schema version field
2. Re-run `npm run codegen:schemas` in the project root
3. All consuming tracks re-run codegen before merging to `main`
4. Old version supported for one release cycle, then removed

---

## Code generation

```bash
# From app/ directory:
npm run codegen:schemas
```

Produces:
- `src/shared/types.ts` — TypeScript interfaces + Zod validators
- `python/agent/schemas.py` — Python TypedDict definitions

Never edit these generated files. Edit the `.schema.json` files instead.

---

## Multi-instance safety

Each Electron process uses its own PID in the socket path. The startup sequence is:

1. Main process starts → computes `socketPath = path.join(app.getPath('userData'), 'daemon-' + process.pid + '.sock')`
2. Daemon spawned via `utilityProcess.fork()` with `socketPath` as argv[1]
3. Daemon binds to `socketPath`; main connects
4. On quit: main sends `shutdown`, daemon removes socket file

Stale sockets from crashed processes are cleaned up on startup (any `.sock` file older than 60s with no listening process).

---

## Schema files

| File | Contents |
|---|---|
| `agent_task.schema.json` | Request shapes + response envelope |
| `agent_events.schema.json` | Push event shapes |
| `tab_state.schema.json` | Tab state events (main ↔ renderer) |
| `onboarding.schema.json` | Onboarding flow messages |
