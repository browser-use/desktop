import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HlEvent, SessionStatus } from '../../../src/shared/session-schemas';

type MockRow = {
  id: string;
  prompt: string;
  status: SessionStatus;
  created_at: number;
  error: string | null;
  group_name: string | null;
  updated_at: number;
  origin_channel: string | null;
  origin_conversation_id: string | null;
  primary_site: string | null;
  last_url: string | null;
  engine: string | null;
  engine_session_id: string | null;
  model: string | null;
  auth_mode: string | null;
  subscription_type: string | null;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  cost_source: string | null;
};

type MockStore = {
  rows: Map<string, MockRow>;
  events: Map<string, HlEvent[]>;
};

const mockState = vi.hoisted(() => ({
  stores: new Map<string, MockStore>(),
}));

vi.mock('../../../src/main/sessions/SessionDb', () => {
  class MockSessionDb {
    private store: MockStore;

    constructor(dbPath: string) {
      let store = mockState.stores.get(dbPath);
      if (!store) {
        store = { rows: new Map(), events: new Map() };
        mockState.stores.set(dbPath, store);
      }
      this.store = store;
    }

    recoverStaleSessions(): number { return 0; }

    listSessions(): MockRow[] {
      return Array.from(this.store.rows.values()).sort((a, b) => b.created_at - a.created_at);
    }

    insertSession(session: { id: string; prompt: string; status: SessionStatus; createdAt: number; error?: string; group?: string; originChannel?: string; originConversationId?: string }): void {
      this.store.rows.set(session.id, {
        id: session.id,
        prompt: session.prompt,
        status: session.status,
        created_at: session.createdAt,
        error: session.error ?? null,
        group_name: session.group ?? null,
        updated_at: Date.now(),
        origin_channel: session.originChannel ?? null,
        origin_conversation_id: session.originConversationId ?? null,
        primary_site: null,
        last_url: null,
        engine: null,
        engine_session_id: null,
        model: null,
        auth_mode: null,
        subscription_type: null,
        cost_usd: null,
        input_tokens: null,
        output_tokens: null,
        cached_input_tokens: null,
        cost_source: null,
      });
    }

    updateSessionStatus(id: string, status: SessionStatus, error?: string): void {
      const row = this.store.rows.get(id);
      if (!row) return;
      row.status = status;
      row.error = error ?? null;
      row.updated_at = Date.now();
    }

    updateSessionPrompt(id: string, prompt: string): void {
      const row = this.store.rows.get(id);
      if (!row) return;
      row.prompt = prompt;
      row.updated_at = Date.now();
    }

    updateCreatedAt(id: string, createdAt: number): void {
      const row = this.store.rows.get(id);
      if (!row) return;
      row.created_at = createdAt;
      row.updated_at = Date.now();
    }

    updateNavigation(id: string, site: string | null, lastUrl: string | null): void {
      const row = this.store.rows.get(id);
      if (!row) return;
      row.primary_site = site;
      row.last_url = lastUrl;
      row.updated_at = Date.now();
    }

    updateEngine(id: string, engine: string | null): void {
      const row = this.store.rows.get(id);
      if (row) row.engine = engine;
    }

    updateEngineSessionId(id: string, engineSessionId: string | null): void {
      const row = this.store.rows.get(id);
      if (row) row.engine_session_id = engineSessionId;
    }

    updateModel(): void {}
    updateAuth(): void {}
    updateUsage(): void {}
    saveMessages(): void {}
    getMessages(): unknown[] | null { return null; }

    getSessionOrigin(id: string): { originChannel: string | null; originConversationId: string | null } {
      const row = this.store.rows.get(id);
      return {
        originChannel: row?.origin_channel ?? null,
        originConversationId: row?.origin_conversation_id ?? null,
      };
    }

    appendEvent(sessionId: string, seq: number, event: HlEvent): void {
      const events = this.store.events.get(sessionId) ?? [];
      events[seq] = event;
      this.store.events.set(sessionId, events);
    }

    clearEvents(sessionId: string): void {
      this.store.events.set(sessionId, []);
    }

    getEvents(sessionId: string): HlEvent[] {
      return this.store.events.get(sessionId) ?? [];
    }

    deleteSession(id: string): void {
      this.store.rows.delete(id);
      this.store.events.delete(id);
    }

    getNextTurnIndex(): number { return 0; }
    saveAttachment(): number { return 1; }
    getAttachmentsMeta(): [] { return []; }
    getLatestTurnAttachments(): [] { return []; }
    close(): void {}
  }

  return { SessionDb: MockSessionDb };
});

const { SessionManager } = await import('../../../src/main/sessions/SessionManager');

let dbSeq = 0;

function tempDbPath(): string {
  dbSeq += 1;
  return `mock-session-db-${dbSeq}`;
}

afterEach(() => {
  mockState.stores.clear();
});

describe('SessionManager persistence', () => {
  it('hydrates provider resume ids and the last restorable URL after restart', () => {
    const dbPath = tempDbPath();
    const first = new SessionManager(dbPath);
    const id = first.createSession('Open example.com');

    first.setSessionEngine(id, 'codex');
    first.setEngineSessionId(id, 'thread-123');
    first.updateNavigationFromUrl(id, 'https://example.com/docs?tab=api');
    first.updateNavigationFromUrl(id, 'about:blank');
    first.destroy();

    const second = new SessionManager(dbPath);
    const session = second.getSession(id);

    expect(session?.primarySite).toBe('example.com');
    expect(session?.lastUrl).toBe('https://example.com/docs?tab=api');
    expect(session?.canResume).toBe(true);
    expect(second.getSessionEngine(id)).toBe('codex');
    expect(second.getEngineSessionId(id)).toBe('thread-123');

    second.destroy();
  });

  it('allows a stopped session to accept a follow-up after its browser is gone', () => {
    const manager = new SessionManager(tempDbPath());
    const id = manager.createSession('Open example.com');

    manager.dismissSession(id);
    const abortController = manager.resumeSession(id, 'Continue from here');
    const session = manager.getSession(id);

    expect(abortController.signal.aborted).toBe(false);
    expect(session?.status).toBe('running');
    expect(session?.error).toBeUndefined();
    expect(session?.output.at(-1)).toEqual({ type: 'user_input', text: 'Continue from here' });

    manager.destroy();
  });

  it('reruns a session with an edited prompt as a fresh conversation', () => {
    const manager = new SessionManager(tempDbPath());
    const id = manager.createSession('Open example.com');

    manager.startSession(id);
    manager.setEngineSessionId(id, 'thread-123');
    const abortController = manager.rerunSession(id, 'Open example.org instead');
    const session = manager.getSession(id);

    expect(abortController.signal.aborted).toBe(false);
    expect(session?.prompt).toBe('Open example.org instead');
    expect(session?.status).toBe('running');
    expect(session?.canResume).toBe(false);
    expect(session?.output).toEqual([]);
    expect(manager.getEngineSessionId(id)).toBeUndefined();

    manager.destroy();
  });

  it('pauses a running session without aborting the live run and resumes it in place', () => {
    const manager = new SessionManager(tempDbPath());
    const id = manager.createSession('Open example.com');
    const runningController = manager.startSession(id);
    manager.setEngineSessionId(id, 'thread-123');

    const result = manager.pauseSession(id);
    const paused = manager.getSession(id);

    expect(result).toEqual({ paused: true });
    expect(runningController.signal.aborted).toBe(false);
    expect(paused?.status).toBe('paused');
    expect(paused?.error).toBeUndefined();
    expect(paused?.canResume).toBe(true);
    expect(paused?.output.at(-1)).toMatchObject({
      type: 'notify',
      message: 'Agent paused. Resume when you are ready.',
    });
    expect(manager.getEngineSessionId(id)).toBe('thread-123');

    const resumeResult = manager.resumePausedSession(id);
    const resumed = manager.getSession(id);

    expect(resumeResult).toEqual({ resumed: true });
    expect(runningController.signal.aborted).toBe(false);
    expect(resumed?.status).toBe('running');
    expect(resumed?.error).toBeUndefined();
    expect(resumed?.output.at(-1)).toMatchObject({
      type: 'notify',
      message: 'Agent paused. Resume when you are ready.',
    });
    expect(manager.getEngineSessionId(id)).toBe('thread-123');

    manager.destroy();
  });

  it('keeps paused sessions paused after restart', () => {
    const dbPath = tempDbPath();
    const first = new SessionManager(dbPath);
    const id = first.createSession('Open example.com');

    first.startSession(id);
    first.setEngineSessionId(id, 'thread-123');
    first.pauseSession(id);
    first.destroy();

    const second = new SessionManager(dbPath);
    const session = second.getSession(id);

    expect(session?.status).toBe('paused');
    expect(session?.canResume).toBe(true);
    expect(second.getEngineSessionId(id)).toBe('thread-123');

    second.destroy();
  });

  it('lets stop terminate a paused session distinctly from pause', () => {
    const manager = new SessionManager(tempDbPath());
    const id = manager.createSession('Open example.com');

    manager.startSession(id);
    manager.setEngineSessionId(id, 'thread-123');
    manager.pauseSession(id);
    manager.cancelSession(id);

    const session = manager.getSession(id);
    expect(session?.status).toBe('stopped');
    expect(session?.error).toBe('Cancelled by user');
    expect(manager.getAbortController(id)).toBeUndefined();

    manager.destroy();
  });
});
