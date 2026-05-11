import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { AgentSession, HlEvent } from '../types';

type SessionsState = {
  byId: Record<string, AgentSession>;
  order: string[];
  hydrate: (sessions: readonly AgentSession[]) => void;
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

export const useSessionsStore = create<SessionsState>()(
  subscribeWithSelector(
    immer((set) => ({
      byId: {},
      order: [],

      hydrate: (sessions) => set((state) => {
        const next: Record<string, AgentSession> = {};
        for (const s of sessions) next[s.id] = s;
        state.byId = next;
        state.order = reorder(next);
        console.log('[sessionsStore] hydrate', { count: sessions.length });
      }),

      upsertSession: (s) => set((state) => {
        const prev = state.byId[s.id];
        if (prev) {
          // Merge — preserve fields the patch doesn't carry
          state.byId[s.id] = { ...prev, ...s, hasBrowser: s.hasBrowser ?? prev.hasBrowser };
        } else {
          state.byId[s.id] = s;
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
        prev.output.push(event);
        prev.lastActivityAt = Date.now();
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
