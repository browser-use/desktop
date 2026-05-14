import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { AgentSession, HlEvent } from '../types';

type SessionsState = {
  byId: Record<string, AgentSession>;
  order: string[];
  hydrate: (sessions: readonly AgentSession[]) => void;
  mergeHydrate: (sessions: readonly AgentSession[]) => void;
  upsertSession: (s: AgentSession) => void;
  patchSession: (id: string, patch: Partial<AgentSession>) => void;
  appendEvent: (id: string, event: HlEvent) => void;
  removeSession: (id: string) => void;
};

function reorder(byId: Record<string, AgentSession>): string[] {
  return Object.values(byId)
    .sort((a, b) => (b.lastActivityAt ?? b.createdAt) - (a.lastActivityAt ?? a.createdAt))
    .map((s) => s.id);
}

function seedOutputTimestamps(s: AgentSession): AgentSession {
  return {
    ...s,
    outputTimestamps: s.outputTimestamps ?? s.output.map((_, i) => s.createdAt + i),
  };
}

export const useSessionsStore = create<SessionsState>()(
  subscribeWithSelector(
    immer((set) => ({
      byId: {},
      order: [],

      hydrate: (sessions) => set((state) => {
        const next: Record<string, AgentSession> = {};
        for (const s of sessions) next[s.id] = seedOutputTimestamps(s);
        state.byId = next;
        state.order = reorder(next);
        console.log('[sessionsStore] hydrate', { count: sessions.length });
      }),

      mergeHydrate: (sessions) => set((state) => {
        const next: Record<string, AgentSession> = { ...state.byId };
        for (const s of sessions) {
          const seeded = seedOutputTimestamps(s);
          const prev = state.byId[s.id];
          next[s.id] = prev
            ? {
                ...seeded,
                ...prev,
                output: prev.output.length > 0 ? prev.output : seeded.output,
                outputTimestamps: prev.outputTimestamps ?? seeded.outputTimestamps,
                hasBrowser: prev.hasBrowser ?? seeded.hasBrowser,
              }
            : seeded;
        }
        state.byId = next;
        state.order = reorder(next);
        console.log('[sessionsStore] mergeHydrate', { count: sessions.length });
      }),

      upsertSession: (s) => set((state) => {
        const prev = state.byId[s.id];
        // Seed outputTimestamps when missing. DB-loaded sessions don't carry
        // per-event timestamps yet (no schema column for it), so we fall back
        // to session.createdAt + index — stable but coarse. Live events that
        // arrive later via appendEvent will get real Date.now() stamps and
        // overwrite the per-index slot as they're appended.
        const seeded = seedOutputTimestamps(s);
        if (prev) {
          state.byId[s.id] = { ...prev, ...seeded, hasBrowser: seeded.hasBrowser ?? prev.hasBrowser };
        } else {
          state.byId[s.id] = seeded;
        }
        state.order = reorder(state.byId);
        console.log('[sessionsStore] upsertSession', { id: s.id, status: s.status });
      }),

      patchSession: (id, patch) => set((state) => {
        const prev = state.byId[id];
        if (!prev) {
          console.warn('[sessionsStore] patchSession missing id', id);
          return;
        }
        state.byId[id] = { ...prev, ...patch };
        if (patch.lastActivityAt !== undefined || patch.createdAt !== undefined) {
          state.order = reorder(state.byId);
        }
      }),

      appendEvent: (id, event) => set((state) => {
        const prev = state.byId[id];
        if (!prev) {
          console.warn('[sessionsStore] appendEvent missing id', id);
          return;
        }
        const now = Date.now();
        prev.output.push(event);
        if (!prev.outputTimestamps) prev.outputTimestamps = [];
        prev.outputTimestamps.push(now);
        prev.lastActivityAt = now;
        state.order = reorder(state.byId);
      }),

      removeSession: (id) => set((state) => {
        delete state.byId[id];
        state.order = state.order.filter((x) => x !== id);
        console.log('[sessionsStore] removeSession', { id });
      }),
    })),
  ),
);

// Selectors live with their consumers (ChatPane / ChatTranscript use
// inline useShallow). Add shared selectors here only when ≥2 components
// need the same slice — premature factoring just creates dead code.
