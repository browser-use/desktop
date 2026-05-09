// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogsApp } from '../../src/renderer/logs/LogsApp';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../src/renderer/hub/TerminalPane', () => ({
  TerminalPane: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="terminal-pane">{sessionId}</div>
  ),
}));

type ActiveSessionChangedHandler = (id: string | null) => void;
type FocusFollowUpHandler = () => void;
type ModeChangedHandler = (mode: 'dot' | 'normal' | 'full') => void;

let activeSessionChangedHandler: ActiveSessionChangedHandler | null = null;
let focusFollowUpHandler: FocusFollowUpHandler | null = null;
let modeChangedHandler: ModeChangedHandler | null = null;

function installApis(): void {
  activeSessionChangedHandler = null;
  focusFollowUpHandler = null;
  modeChangedHandler = null;

  Object.defineProperty(window, 'logsAPI', {
    configurable: true,
    value: {
      close: vi.fn(),
      setMode: vi.fn(),
      onModeChanged: vi.fn((cb: ModeChangedHandler) => {
        modeChangedHandler = cb;
        return () => {
          if (modeChangedHandler === cb) modeChangedHandler = null;
        };
      }),
      onActiveSessionChanged: vi.fn((cb: ActiveSessionChangedHandler) => {
        activeSessionChangedHandler = cb;
        return () => {
          if (activeSessionChangedHandler === cb) activeSessionChangedHandler = null;
        };
      }),
      onFocusFollowUp: vi.fn((cb: FocusFollowUpHandler) => {
        focusFollowUpHandler = cb;
        return () => {
          if (focusFollowUpHandler === cb) focusFollowUpHandler = null;
        };
      }),
      followUp: vi.fn(async () => ({ resumed: true })),
    },
  });

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      sessions: {
        get: vi.fn(async (id: string) => ({
          id,
          status: 'running',
          engine: 'codex',
          output: [],
        })),
        cancel: vi.fn(async () => undefined),
        pause: vi.fn(async () => ({ paused: true })),
        listEditors: vi.fn(async () => []),
        openInEditor: vi.fn(),
        revealOutput: vi.fn(),
      },
      on: {
        sessionUpdated: vi.fn(() => undefined),
        sessionOutput: vi.fn(() => undefined),
      },
    },
  });
}

function renderLogsApp(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<LogsApp />);
  });
  return { container, root };
}

describe('LogsApp focus behavior', () => {
  beforeEach(() => {
    installApis();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('does not focus logs controls or the follow-up input on active session switch', async () => {
    const { container, root } = renderLogsApp();

    await act(async () => {
      activeSessionChangedHandler?.('session-1');
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(document.body);
    expect(container.querySelector('.logs-header__btn:focus')).toBeNull();
    expect(container.querySelector('.logs-followup__input:focus')).toBeNull();

    act(() => root.unmount());
  });

  it('keeps header chrome buttons out of the tab order', () => {
    const { container, root } = renderLogsApp();

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.logs-header__btn'));

    expect(buttons).toHaveLength(3);
    expect(buttons.every((button) => button.tabIndex === -1)).toBe(true);

    act(() => root.unmount());
  });

  it('still focuses the follow-up input for the explicit focus-followup request', async () => {
    const { container, root } = renderLogsApp();

    await act(async () => {
      activeSessionChangedHandler?.('session-1');
      await Promise.resolve();
    });

    await act(async () => {
      focusFollowUpHandler?.();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(document.activeElement).toBe(container.querySelector('.logs-followup__input'));

    act(() => root.unmount());
  });

  it('cancels the active session on Ctrl+C instead of minimizing logs', async () => {
    const { root } = renderLogsApp();

    await act(async () => {
      activeSessionChangedHandler?.('session-1');
      await Promise.resolve();
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    });

    expect(window.electronAPI.sessions.cancel).toHaveBeenCalledWith('session-1');
    expect(window.electronAPI.sessions.pause).not.toHaveBeenCalled();
    expect(window.logsAPI.setMode).not.toHaveBeenCalled();

    act(() => root.unmount());
  });

  it('keeps Ctrl+C available when the selected session is not cancellable', async () => {
    vi.mocked(window.electronAPI.sessions.get).mockResolvedValueOnce({
      id: 'session-1',
      prompt: 'done',
      status: 'stopped',
      engine: 'codex',
      output: [],
      createdAt: Date.now(),
    });
    const { root } = renderLogsApp();

    await act(async () => {
      activeSessionChangedHandler?.('session-1');
      await Promise.resolve();
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    });

    expect(window.electronAPI.sessions.cancel).not.toHaveBeenCalled();
    expect(window.electronAPI.sessions.pause).not.toHaveBeenCalled();
    expect(window.logsAPI.setMode).not.toHaveBeenCalled();

    act(() => root.unmount());
  });

  it('minimizes logs on Escape instead of pausing the active session', async () => {
    const { root } = renderLogsApp();

    await act(async () => {
      activeSessionChangedHandler?.('session-1');
      await Promise.resolve();
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(window.electronAPI.sessions.cancel).not.toHaveBeenCalled();
    expect(window.electronAPI.sessions.pause).not.toHaveBeenCalled();
    expect(window.logsAPI.setMode).toHaveBeenCalledWith('dot');

    act(() => root.unmount());
  });
});
