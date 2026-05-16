// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTurn } from '../../../src/renderer/hub/chat/ChatTurn';
import { ToastProvider } from '../../../src/renderer/components/base/Toast';
import type { Turn } from '../../../src/renderer/hub/chat/groupIntoTurns';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderTurn(turn: Turn, props: Partial<React.ComponentProps<typeof ChatTurn>> = {}): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ToastProvider>
        <ChatTurn turn={turn} {...props} />
      </ToastProvider>,
    );
  });
  return { container, root };
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Missing textarea value setter');
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ChatTurn', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('keeps quote context when submitting an edited user message', () => {
    const onEdit = vi.fn();
    const turn: Turn = {
      id: 'turn-1',
      userEntry: {
        id: 'user-1',
        type: 'user_input',
        timestamp: 1000,
        content: '> Original page text\n\nold reply',
      },
      agentEntries: [],
    };
    const { container, root } = renderTurn(turn, { onEditMessage: onEdit });

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Edit message"]')?.click();
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('.chat-bubble__edit-input');
    expect(textarea).not.toBeNull();
    act(() => {
      setTextareaValue(textarea!, 'new reply');
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('.chat-bubble__edit-send')?.click();
    });

    expect(onEdit).toHaveBeenCalledWith('> Original page text\n\nnew reply');
    act(() => root.unmount());
  });

  it('renders image outputs inline while waiting for a done entry', () => {
    const turn: Turn = {
      id: 'turn-1',
      userEntry: null,
      agentEntries: [
        {
          id: 'image-1',
          type: 'file_output',
          timestamp: 1000,
          content: 'screenshot.png',
          tool: '/tmp/session/screenshot.png',
          fileMime: 'image/png',
          fileSize: 1234,
        },
      ],
    };
    const { container, root } = renderTurn(turn, { isLatest: true });

    const image = container.querySelector<HTMLImageElement>('.chat-step__image img');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toBe('chatfile://files/tmp/session/screenshot.png');
    act(() => root.unmount());
  });
});
