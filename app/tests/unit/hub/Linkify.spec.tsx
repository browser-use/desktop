// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Linkify } from '../../../src/renderer/hub/chat/Linkify';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderLinkify(text: string): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Linkify>{text}</Linkify>);
  });
  return { container, root };
}

function outputLink(container: HTMLElement): HTMLButtonElement {
  const link = container.querySelector('.chat-path-link');
  if (!(link instanceof HTMLButtonElement)) throw new Error('Missing output path link');
  return link;
}

describe('Linkify', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
  });

  it('does not throw when optional revealOutput returns no promise', () => {
    const revealOutput = vi.fn(() => undefined);
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        sessions: { revealOutput },
      } as unknown as NonNullable<Window['electronAPI']>,
    });
    const { container, root } = renderLinkify('saved to outputs/run-123/screenshot.png');

    expect(() => {
      act(() => {
        outputLink(container).click();
      });
    }).not.toThrow();
    expect(revealOutput).toHaveBeenCalledWith('outputs/run-123/screenshot.png');

    act(() => root.unmount());
  });

  it('catches rejected revealOutput promises', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        sessions: { revealOutput: vi.fn(() => Promise.reject(new Error('denied'))) },
      } as unknown as NonNullable<Window['electronAPI']>,
    });
    const { container, root } = renderLinkify('saved to outputs/run-123/screenshot.png');

    await act(async () => {
      outputLink(container).click();
      await Promise.resolve();
    });

    expect(warn).toHaveBeenCalledWith('[Linkify] revealOutput failed', expect.any(Error));

    act(() => root.unmount());
  });
});
