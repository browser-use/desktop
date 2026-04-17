/**
 * Track B — Presence stub for v0.2 Dynamic-Island / agent drawer.
 *
 * This module is intentionally a stub. The Dynamic-Island / agent-presence
 * drawer is deferred to v0.2 per plan §2 locked scope decisions #12.
 *
 * This file specifies the interface so v0.2 can implement against it without
 * breaking the rest of the codebase.
 *
 * D2: Minimal logging — stub only.
 */

// ---------------------------------------------------------------------------
// D2 — Dev-only structured logger
// ---------------------------------------------------------------------------

const DEV =
  process.env.NODE_ENV !== 'production' || process.env.AGENTIC_DEV === '1';

const log = {
  debug: DEV
    ? (comp: string, ctx: object) =>
        console.log(
          JSON.stringify({ ts: Date.now(), level: 'debug', component: comp, ...ctx }),
        )
    : (_comp: string, _ctx: object) => { /* no-op in production */ },
  info: DEV
    ? (comp: string, ctx: object) =>
        console.log(
          JSON.stringify({ ts: Date.now(), level: 'info', component: comp, ...ctx }),
        )
    : (_comp: string, _ctx: object) => { /* no-op in production */ },
  warn: (comp: string, ctx: object) =>
    console.warn(JSON.stringify({ ts: Date.now(), level: 'warn', component: comp, ...ctx })),
  error: (comp: string, ctx: object) =>
    console.error(
      JSON.stringify({ ts: Date.now(), level: 'error', component: comp, ...ctx }),
    ),
};

// ---------------------------------------------------------------------------
// Types (v0.2 interface — not yet implemented)
// ---------------------------------------------------------------------------

export type PresenceState =
  | 'idle'
  | 'working'        // agent running a task
  | 'done'           // task completed
  | 'error'          // task failed
  | 'target_lost';   // tab closed during task

export interface PresenceUpdate {
  state: PresenceState;
  taskId?: string;
  stepCount?: number;
  message?: string;
}

// ---------------------------------------------------------------------------
// v0.1 stub — no-op implementations
// ---------------------------------------------------------------------------

/**
 * Initialize the presence indicator.
 * v0.1: no-op. v0.2 will create a Dynamic-Island window here.
 */
export function initPresence(): void {
  log.info('presence.init', {
    message: 'Presence stub initialized (Dynamic-Island deferred to v0.2)',
  });
}

/**
 * Update the presence state (e.g., agent started working).
 * v0.1: no-op. v0.2 will animate the Dynamic-Island indicator.
 */
export function updatePresence(update: PresenceUpdate): void {
  log.debug('presence.update', {
    message: 'Presence update received (stub — no-op in v0.1)',
    ...update,
  });
}

/**
 * Tear down the presence indicator.
 * v0.1: no-op.
 */
export function destroyPresence(): void {
  log.info('presence.destroy', {
    message: 'Presence destroyed (stub)',
  });
}
