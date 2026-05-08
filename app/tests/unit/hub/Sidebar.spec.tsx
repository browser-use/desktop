// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../../../src/renderer/hub/Sidebar';
import type { AgentSession } from '../../../src/renderer/hub/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function session(id: string, createdAt: number, status: AgentSession['status'] = 'idle'): AgentSession {
  return {
    id,
    createdAt,
    status,
    prompt: id,
    output: [],
  };
}

function renderSidebar(
  sessions: AgentSession[] = [session('first', 1), session('second', 2)],
  onRowAction = vi.fn(),
): { container: HTMLDivElement; root: Root; onRowAction: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <Sidebar
        sessions={sessions}
        selectedId={sessions.at(-1)?.id ?? null}
        onSelect={vi.fn()}
        onNewAgent={vi.fn()}
        onRowAction={onRowAction}
      />,
    );
  });
  return { container, root, onRowAction };
}

function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function menuButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('.sidebar__row-menu-btn');
  if (!button) throw new Error('Missing sidebar menu button');
  return button;
}

function menuItems(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.sidebar__row-menu-item'));
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

  it('shows pause for resumable running sessions', () => {
    const running = { ...session('running', 1, 'running'), canResume: true };
    const { container, root, onRowAction } = renderSidebar([running]);

    click(menuButton(container));
    const pause = menuItems(container).find((item) => item.textContent === 'Pause');

    expect(pause).toBeTruthy();
    expect(pause?.disabled).toBe(false);
    click(pause!);
    expect(onRowAction).toHaveBeenCalledWith('running', 'pause');

    act(() => root.unmount());
  });

  it('shows resume and stop for paused sessions without showing pause', () => {
    const paused = { ...session('paused', 1, 'paused'), canResume: true };
    const { container, root, onRowAction } = renderSidebar([paused]);

    click(menuButton(container));
    const labels = menuItems(container).map((item) => item.textContent);
    const resume = menuItems(container).find((item) => item.textContent === 'Resume');

    expect(labels).toContain('Resume');
    expect(labels).toContain('Stop');
    expect(labels).not.toContain('Pause');
    click(resume!);
    expect(onRowAction).toHaveBeenCalledWith('paused', 'resume');

    act(() => root.unmount());
  });
});
