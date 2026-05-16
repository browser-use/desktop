// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserPreview } from '../../../src/renderer/hub/chat/BrowserPreview';
import { useSessionsStore } from '../../../src/renderer/hub/state/sessionsStore';
import type { AgentSession } from '../../../src/renderer/hub/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PreviewFrameHandler = (id: string, dataB64: string) => void;

const SESSION: AgentSession = {
  id: 'session-1',
  prompt: 'open a page',
  status: 'running',
  createdAt: 1000,
  output: [],
  hasBrowser: true,
  lastUrl: null,
};

function renderPreview(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<BrowserPreview sessionId={SESSION.id} onExpand={vi.fn()} />);
  });
  return { container, root };
}

describe('BrowserPreview', () => {
  let frameHandler: PreviewFrameHandler | null = null;

  beforeEach(() => {
    frameHandler = null;
    useSessionsStore.getState().hydrate([SESSION]);
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        on: {
          sessionPreviewFrame: vi.fn((cb: PreviewFrameHandler) => {
            frameHandler = cb;
            return vi.fn();
          }),
        },
        sessions: {
          previewStart: vi.fn(async () => ({ ok: true })),
          previewStop: vi.fn(async () => undefined),
        },
      },
    });
  });

  afterEach(() => {
    useSessionsStore.getState().hydrate([]);
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('keeps the browser icon placeholder while there is no URL, even after blank frames arrive', async () => {
    const { container, root } = renderPreview();

    await act(async () => {
      frameHandler?.(SESSION.id, 'blank-frame');
    });

    expect(container.querySelector('.browser-preview__placeholder')).not.toBeNull();
    expect(container.querySelector('.browser-preview__img')).toBeNull();

    act(() => root.unmount());
  });

  it('shows the captured frame after a URL is known', async () => {
    const { container, root } = renderPreview();

    act(() => {
      useSessionsStore.getState().patchSession(SESSION.id, { lastUrl: 'https://x.com/' });
    });
    await act(async () => {
      frameHandler?.(SESSION.id, 'real-frame');
    });

    expect(container.querySelector('.browser-preview__img')).not.toBeNull();
    expect(container.querySelector('.browser-preview__placeholder')).toBeNull();

    act(() => root.unmount());
  });
});
