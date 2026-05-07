// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../../../src/renderer/hub/Sidebar';
import type { AgentSession } from '../../../src/renderer/hub/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function session(id: string, createdAt: number): AgentSession {
  return {
    id,
    createdAt,
    status: 'idle',
    prompt: id,
    output: [],
  };
}

function renderSidebar(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <Sidebar
        sessions={[session('first', 1), session('second', 2)]}
        selectedId="second"
        onSelect={vi.fn()}
        onNewAgent={vi.fn()}
        onRowAction={vi.fn()}
      />,
    );
  });
  return { container, root };
}

describe('Sidebar focus behavior', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps sidebar action controls out of the tab order', () => {
    const { container, root } = renderSidebar();

    const focusableControls = Array.from(container.querySelectorAll<HTMLButtonElement>(
      '.sidebar__row, .sidebar__icon-btn, .sidebar__row-menu-btn',
    ));

    expect(focusableControls.length).toBeGreaterThan(0);
    expect(focusableControls.every((button) => button.tabIndex === -1)).toBe(true);

    act(() => root.unmount());
  });

  it('prevents mouse down from focusing sidebar rows', () => {
    const { container, root } = renderSidebar();
    const row = container.querySelector<HTMLButtonElement>('.sidebar__row');
    if (!row) throw new Error('Missing sidebar row');

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    row.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);

    act(() => root.unmount());
  });
});
