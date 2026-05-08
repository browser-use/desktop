import { useQuery, useQueryClient, QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { AgentSession } from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

const SESSIONS_KEY = ['sessions'] as const;

export function useSessionsQuery() {
  const qc = useQueryClient();

  const query = useQuery<AgentSession[]>({
    queryKey: SESSIONS_KEY,
    queryFn: async () => {
      const api = window.electronAPI;
      if (!api) return [];
      return api.sessions.listAll();
    },
  });

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const unsubUpdate = api.on.sessionUpdated((session) => {
      qc.setQueryData<AgentSession[]>(SESSIONS_KEY, (prev = []) => {
        const idx = prev.findIndex((s) => s.id === session.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...prev[idx], ...session, hasBrowser: session.hasBrowser ?? prev[idx].hasBrowser };
          return next;
        }
        return [...prev, session];
      });
    });

    return () => {
      unsubUpdate();
    };
  }, [qc]);

  return query;
}

export function useUpdateSession() {
  const qc = useQueryClient();
  return (id: string, update: Partial<AgentSession>) => {
    qc.setQueryData<AgentSession[]>(SESSIONS_KEY, (prev = []) =>
      prev.map((s) => (s.id === id ? { ...s, ...update } : s)),
    );
  };
}

export function useHydrateSession(id: string | null) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!id) return;
    const api = window.electronAPI;
    if (!api) return;

    const cached = qc.getQueryData<AgentSession[]>(SESSIONS_KEY);
    const existing = cached?.find((s) => s.id === id);
    if (existing && existing.output.length > 0) return;

    api.sessions.get(id).then((full) => {
      if (!full || full.output.length === 0) return;
      qc.setQueryData<AgentSession[]>(SESSIONS_KEY, (prev = []) =>
        prev.map((s) => (s.id === id ? { ...s, output: full.output } : s)),
      );
    }).catch(() => {});
  }, [id, qc]);
}
