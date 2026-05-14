import { useEffect } from 'react';
import { useSessionsStore } from './sessionsStore';
import type { AgentSession, HlEvent } from '../types';

/**
 * Pure event-driven mirror of session state into the Zustand store.
 *
 * Path:
 *   1. one-time `sessions.listAll()` to seed the store (no polling, no query)
 *   2. `session-output` IPC → appendEvent (per-event delta, O(1), preserves
 *      referential stability of older entries so ChatTurn components don't
 *      re-render for new events in *other* sessions or earlier in the same one)
 *   3. `session-updated` IPC → patchSession (non-output fields: status,
 *      costUsd, lastActivityAt, etc). We never let this channel rewrite the
 *      output array — that's owned by sessionOutput so we don't double-append.
 *   4. `sessions:browser-gone` → patchSession({ hasBrowser: false })
 *
 * No useSessionsQuery dependency. Old grid/dashboard consumers keep their
 * own query in parallel; chat reads only from the store.
 */
export function useSessionsBridge(): void {
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    let cancelled = false;
    let hydrated = false;
    const pending: Array<() => void> = [];

    const enqueueOrRun = (fn: () => void): void => {
      if (hydrated) fn();
      else pending.push(fn);
    };

    const applyOutput = (id: string, event: HlEvent): void => {
      const store = useSessionsStore.getState();
      if (!store.byId[id]) {
        console.log('[useSessionsBridge] sessionOutput ignored (unknown session)', { id, type: event.type });
        return;
      }
      store.appendEvent(id, event);
    };

    const applyUpdated = (session: AgentSession): void => {
      const store = useSessionsStore.getState();
      const prev = store.byId[session.id];
      if (!prev) {
        // First time seeing this session (e.g. just created) — full insert.
        store.upsertSession(session);
        return;
      }
      // Patch only non-output fields. Output is driven by session-output.
      // hasBrowser is owned by the dedicated sessionBrowserAttached /
      // sessionBrowserGone channels — never let session-updated overwrite it
      // with undefined (it's computed lazily in sessions:list-all and isn't
      // stored on the in-memory session record).
      const { output: _o, hasBrowser: _hb, ...rest } = session;
      // Rerun: SessionManager bumps createdAt and clears session.output, then
      // emits session-updated. Without resetting here the transcript keeps
      // showing the prior run's messages until new events arrive.
      if (session.createdAt > prev.createdAt) {
        store.patchSession(session.id, { ...rest, output: [], outputTimestamps: [] });
      } else {
        store.patchSession(session.id, rest);
      }
    };

    api.sessions
      .listAll()
      .then((all) => {
        if (cancelled) return;
        console.log('[useSessionsBridge] initial hydrate', { count: all.length });
        useSessionsStore.getState().mergeHydrate(all);
        hydrated = true;
        pending.splice(0).forEach((fn) => fn());
      })
      .catch((err) => {
        console.error('[useSessionsBridge] listAll failed', err);
        if (cancelled) return;
        hydrated = true;
        pending.splice(0).forEach((fn) => fn());
      });

    const unsubOutput = api.on.sessionOutput((id, event) => {
      enqueueOrRun(() => applyOutput(id, event));
    });

    const unsubUpdated = api.on.sessionUpdated((session) => {
      enqueueOrRun(() => applyUpdated(session));
    });

    const unsubBrowserGone = api.on.sessionBrowserGone((id) => {
      const store = useSessionsStore.getState();
      if (!store.byId[id]) return;
      store.patchSession(id, { hasBrowser: false });
    });

    const unsubBrowserAttached = api.on.sessionBrowserAttached((id) => {
      const store = useSessionsStore.getState();
      if (!store.byId[id]) {
        console.log('[useSessionsBridge] browserAttached for unknown id', id);
        return;
      }
      console.log('[useSessionsBridge] browserAttached', { id });
      store.patchSession(id, { hasBrowser: true });
    });

    return () => {
      cancelled = true;
      unsubOutput();
      unsubUpdated();
      unsubBrowserGone();
      unsubBrowserAttached();
    };
  }, []);
}
