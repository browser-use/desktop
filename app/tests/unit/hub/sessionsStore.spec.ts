import { afterEach, describe, expect, it } from 'vitest';
import { useSessionsStore } from '../../../src/renderer/hub/state/sessionsStore';
import type { AgentSession } from '../../../src/renderer/hub/types';

function session(patch: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    prompt: 'kickoff',
    status: 'idle',
    createdAt: 1000,
    output: [],
    ...patch,
  };
}

describe('sessionsStore hydration', () => {
  afterEach(() => {
    useSessionsStore.getState().hydrate([]);
  });

  it('keeps hydrate as a replacement reset', () => {
    useSessionsStore.getState().hydrate([session()]);
    useSessionsStore.getState().hydrate([]);

    expect(useSessionsStore.getState().byId).toEqual({});
  });

  it('mergeHydrate preserves live output that arrived before listAll resolved', () => {
    const store = useSessionsStore.getState();
    const id = '11111111-1111-4111-8111-111111111111';

    store.upsertSession(session({ id, status: 'running' }));
    store.appendEvent(id, { type: 'thinking', text: 'live event' });
    store.mergeHydrate([session({ id, status: 'idle', output: [] })]);

    const merged = useSessionsStore.getState().byId[id];
    expect(merged.status).toBe('running');
    expect(merged.output).toEqual([{ type: 'thinking', text: 'live event' }]);
    expect(merged.outputTimestamps).toHaveLength(1);
  });
});
