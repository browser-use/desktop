import { describe, expect, it } from 'vitest';
import { orderSessionsForSidebar } from '../../../src/renderer/hub/sessionOrdering';
import type { AgentSession } from '../../../src/renderer/hub/types';

function session(id: string, status: AgentSession['status'], createdAt: number, lastActivityAt?: number): AgentSession {
  return {
    id,
    status,
    createdAt,
    lastActivityAt,
    prompt: id,
    output: [],
  };
}

describe('orderSessionsForSidebar', () => {
  it('orders sessions chronologically by the sidebar timestamp', () => {
    const sessions = [
      session('old-running', 'running', 10, 20),
      session('new-stopped', 'stopped', 70),
      session('new-idle', 'idle', 30, 90),
      session('old-stopped', 'stopped', 50),
      session('stuck', 'stuck', 60, 80),
    ];

    expect(orderSessionsForSidebar(sessions).map((s) => s.id)).toEqual([
      'new-idle',
      'stuck',
      'new-stopped',
      'old-stopped',
      'old-running',
    ]);
  });
});
