// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSessionsBridge } from '../../../src/renderer/hub/state/useSessionsBridge';
import { useSessionsStore } from '../../../src/renderer/hub/state/sessionsStore';
import type { AgentSession, HlEvent } from '../../../src/renderer/hub/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type BridgeHandlers = {
  sessionOutput?: (id: string, event: HlEvent) => void;
  sessionUpdated?: (session: AgentSession) => void;
  sessionBrowserGone?: (id: string) => void;
  sessionBrowserAttached?: (id: string) => void;
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function session(patch: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    prompt: 'kickoff',
    status: 'running',
    createdAt: 1000,
    output: [],
    ...patch,
  };
}

function BridgeHost(): null {
  useSessionsBridge();
  return null;
}

function renderBridge(): { root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<BridgeHost />);
  });
  return { root };
}

function installApi(listAll: Promise<AgentSession[]>): BridgeHandlers {
  const handlers: BridgeHandlers = {};
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      sessions: {
        listAll: vi.fn(() => listAll),
      },
      on: {
        sessionOutput: vi.fn((cb: BridgeHandlers['sessionOutput']) => {
          handlers.sessionOutput = cb;
          return vi.fn();
        }),
        sessionUpdated: vi.fn((cb: BridgeHandlers['sessionUpdated']) => {
          handlers.sessionUpdated = cb;
          return vi.fn();
        }),
        sessionBrowserGone: vi.fn((cb: BridgeHandlers['sessionBrowserGone']) => {
          handlers.sessionBrowserGone = cb;
          return vi.fn();
        }),
        sessionBrowserAttached: vi.fn((cb: BridgeHandlers['sessionBrowserAttached']) => {
          handlers.sessionBrowserAttached = cb;
          return vi.fn();
        }),
      },
    } as unknown as NonNullable<Window['electronAPI']>,
  });
  return handlers;
}

describe('useSessionsBridge', () => {
  afterEach(() => {
    useSessionsStore.getState().hydrate([]);
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
  });

  it('replays browser-attached events that arrive before hydration completes', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const listAll = deferred<AgentSession[]>();
    const handlers = installApi(listAll.promise);
    const { root } = renderBridge();

    act(() => {
      handlers.sessionBrowserAttached?.(id);
    });
    await act(async () => {
      listAll.resolve([session({ id, hasBrowser: false })]);
      await listAll.promise;
    });

    expect(useSessionsStore.getState().byId[id]?.hasBrowser).toBe(true);

    act(() => root.unmount());
  });

  it('replays browser-gone events that arrive before hydration completes', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const listAll = deferred<AgentSession[]>();
    const handlers = installApi(listAll.promise);
    const { root } = renderBridge();

    act(() => {
      handlers.sessionBrowserGone?.(id);
    });
    await act(async () => {
      listAll.resolve([session({ id, hasBrowser: true })]);
      await listAll.promise;
    });

    expect(useSessionsStore.getState().byId[id]?.hasBrowser).toBe(false);

    act(() => root.unmount());
  });

  it('buffers startup output until a session-updated event inserts the session', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const listAll = deferred<AgentSession[]>();
    const handlers = installApi(listAll.promise);
    const { root } = renderBridge();

    act(() => {
      handlers.sessionOutput?.(id, { type: 'thinking', text: 'first live token' });
    });
    await act(async () => {
      listAll.resolve([]);
      await listAll.promise;
    });

    expect(useSessionsStore.getState().byId[id]).toBeUndefined();

    act(() => {
      handlers.sessionUpdated?.(session({ id, status: 'running', output: [] }));
    });

    expect(useSessionsStore.getState().byId[id]?.output).toEqual([
      { type: 'thinking', text: 'first live token' },
    ]);

    act(() => root.unmount());
  });
});
