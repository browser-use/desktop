// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTranscript } from '../../../src/renderer/hub/chat/ChatTranscript';
import { useSessionsStore } from '../../../src/renderer/hub/state/sessionsStore';
import type { AgentSession } from '../../../src/renderer/hub/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../src/renderer/hub/chat/ChatTurn', async () => {
  const ReactModule = await import('react');
  return {
    ChatTurn: ({ turn, isLatest }: { turn: { userEntry: { content: string } | null; agentEntries: Array<{ content: string }> }; isLatest?: boolean }) =>
      ReactModule.createElement(
        'div',
        { 'data-testid': 'turn', className: `chat-turn${isLatest ? ' chat-turn--latest' : ''}` },
        turn.userEntry
          ? ReactModule.createElement('div', { className: 'chat-bubble__wrap' }, turn.userEntry.content)
          : null,
        ReactModule.createElement(
          'div',
          { className: 'chat-agent' },
          ...turn.agentEntries.map((entry) => ReactModule.createElement('span', { key: entry.content }, entry.content)),
        ),
      ),
  };
});

class NoopResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

function session(patch: Partial<AgentSession>): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    prompt: 'kickoff',
    status: 'idle',
    createdAt: 1000,
    output: [],
    ...patch,
  };
}

function renderTranscript(sessionId: string): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ChatTranscript sessionId={sessionId} />);
  });
  return { container, root };
}

function setTranscriptMetrics(el: HTMLElement): void {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 1000 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 400 });
  el.style.paddingTop = '20px';
  el.style.paddingBottom = '80px';
  el.scrollTop = 0;
}

describe('ChatTranscript prompt fallback', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', NoopResizeObserver);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getBoundingClientRect() {
      const top = this.classList.contains('chat-bubble__wrap') ? 160 : 0;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        right: 300,
        bottom: top + 40,
        width: 300,
        height: 40,
        toJSON: () => ({}),
      } as DOMRect;
    });
  });

  afterEach(() => {
    useSessionsStore.getState().hydrate([]);
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not synthesize sessions.prompt when event log entries exist', () => {
    const sess = session({
      prompt: 'tell me about it.',
      output: [
        { type: 'thinking', text: 'Initial answer from the agent.' },
        { type: 'user_input', text: 'go to a wikipedia page' },
      ],
    });
    useSessionsStore.getState().hydrate([sess]);

    const { container, root } = renderTranscript(sess.id);

    expect(container.textContent).toContain('go to a wikipedia page');
    expect(container.textContent).not.toContain('tell me about it.');

    act(() => root.unmount());
  });

  it('keeps the legacy prompt fallback for sessions with no event log', () => {
    const sess = session({
      prompt: 'legacy kickoff',
      output: [],
    });
    useSessionsStore.getState().hydrate([sess]);

    const { container, root } = renderTranscript(sess.id);

    expect(container.textContent).toContain('legacy kickoff');

    act(() => root.unmount());
  });
});

describe('ChatTranscript scroll behavior', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', NoopResizeObserver);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getBoundingClientRect() {
      const top = this.classList.contains('chat-bubble__wrap') ? 160 : 0;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        right: 300,
        bottom: top + 40,
        width: 300,
        height: 40,
        toJSON: () => ({}),
      } as DOMRect;
    });
  });

  afterEach(() => {
    useSessionsStore.getState().hydrate([]);
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('snaps to the bottom when a selected empty session hydrates its transcript', () => {
    const sess = session({
      output: [],
    });
    useSessionsStore.getState().hydrate([sess]);

    const { container, root } = renderTranscript(sess.id);
    const transcript = container.querySelector<HTMLElement>('.chat-transcript');
    expect(transcript).not.toBeNull();
    setTranscriptMetrics(transcript!);

    act(() => {
      useSessionsStore.getState().upsertSession(session({
        output: [
          { type: 'user_input', text: 'initial prompt' },
          { type: 'thinking', text: 'first answer' },
          { type: 'user_input', text: 'latest follow up' },
          { type: 'thinking', text: 'latest answer that should be visible at bottom' },
        ],
      }));
    });

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(transcript!.scrollTop).toBe(1000);

    act(() => root.unmount());
  });
});
