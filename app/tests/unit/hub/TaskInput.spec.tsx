// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskInput } from '../../../src/renderer/hub/TaskInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../src/renderer/hub/EnginePicker', () => ({
  EnginePicker: ({ value }: { value: string }): React.ReactElement => (
    <div data-testid="engine-picker">{value}</div>
  ),
}));

function renderTaskInput(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<TaskInput onSubmit={vi.fn()} />);
  });

  return { container, root };
}

function getTextarea(container: HTMLElement): HTMLTextAreaElement {
  const textarea = container.querySelector('.task-input__textarea');
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Missing task textarea');
  return textarea;
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Missing textarea value setter');
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('TaskInput', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('expands the textarea to fit newline content', () => {
    const { container, root } = renderTaskInput();
    const textarea = getTextarea(container);
    let scrollHeight = 24;
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });

    act(() => {
      scrollHeight = 96;
      setTextareaValue(textarea, 'line one\nline two\nline three\nline four');
    });

    expect(textarea.style.height).toBe('96px');
    expect(textarea.style.overflowY).toBe('hidden');

    act(() => root.unmount());
  });

  it('caps textarea growth and enables internal scroll at max height', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ maxHeight: '64px' } as CSSStyleDeclaration);
    const { container, root } = renderTaskInput();
    const textarea = getTextarea(container);
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => 128,
    });

    act(() => {
      setTextareaValue(textarea, 'one\ntwo\nthree\nfour\nfive\nsix');
    });

    expect(textarea.style.height).toBe('64px');
    expect(textarea.style.overflowY).toBe('auto');

    act(() => root.unmount());
  });
});
