// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVimKeys, type VimKeysReturn } from '../../../src/renderer/hub/useVimKeys';
import type { ActionId } from '../../../src/renderer/hub/keybindings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function installElectronApi(accelerator = 'CommandOrControl+Alt+Space', platform = 'darwin'): void {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      shell: { platform },
      hotkeys: {
        getGlobalCmdbar: vi.fn(async () => accelerator),
        setGlobalCmdbar: vi.fn(async (next: string) => ({ ok: true, accelerator: next })),
      },
      on: {
        globalCmdbarChanged: vi.fn(() => undefined),
      },
      pill: {
        toggle: vi.fn(),
      },
    },
  });
}

function Harness({
  handlers,
  onReady,
}: {
  handlers: Partial<Record<ActionId, () => void>>;
  onReady?: (vim: VimKeysReturn) => void;
}): React.ReactElement {
  const vim = useVimKeys(handlers);
  onReady?.(vim);
  return <input data-testid="task-input" />;
}

function renderShortcutHarness(
  handlers: Partial<Record<ActionId, () => void>>,
  onReady?: (vim: VimKeysReturn) => void,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Harness handlers={handlers} onReady={onReady} />);
  });
  return { container, root };
}

function renderHarness(onCreatePane: () => void, onReady?: (vim: VimKeysReturn) => void): { container: HTMLDivElement; root: Root } {
  return renderShortcutHarness({ 'action.createPane': onCreatePane }, onReady);
}

function dispatchKey(key: string, code: string, init?: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    code,
    bubbles: true,
    cancelable: true,
    ...init,
  }));
}

describe('useVimKeys global command fallback', () => {
  beforeEach(() => {
    installElectronApi();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('fires the configured command shortcut even when an input has focus', async () => {
    const onCreatePane = vi.fn();
    const { container, root } = renderHarness(onCreatePane);
    const input = container.querySelector<HTMLInputElement>('[data-testid="task-input"]');
    if (!input) throw new Error('Missing input');

    await act(async () => {
      await Promise.resolve();
    });
    input.focus();

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: '\u00A0',
        code: 'Space',
        metaKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(onCreatePane).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });

  it('resets the global command shortcut to the shared desktop default on Linux', async () => {
    installElectronApi('Alt+Space', 'linux');
    let vim: VimKeysReturn | null = null;
    const { root } = renderHarness(vi.fn(), (next) => { vim = next; });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      vim?.resetBinding('action.createPane');
    });

    expect(window.electronAPI?.hotkeys?.setGlobalCmdbar).toHaveBeenCalledWith('CommandOrControl+Shift+Space');

    act(() => root.unmount());
  });
});

describe('useVimKeys app shortcuts', () => {
  beforeEach(() => {
    installElectronApi();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('matches lowercase vim navigation keys from real browser key events', async () => {
    const onDown = vi.fn();
    const onUp = vi.fn();
    const { root } = renderShortcutHarness({
      'nav.down': onDown,
      'nav.up': onUp,
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      dispatchKey('j', 'KeyJ');
      dispatchKey('k', 'KeyK');
    });

    expect(onDown).toHaveBeenCalledTimes(1);
    expect(onUp).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });

  it('keeps lowercase g as a chord prefix instead of jumping to the last session', async () => {
    const onDashboard = vi.fn();
    const onBottom = vi.fn();
    const { root } = renderShortcutHarness({
      'goto.dashboard': onDashboard,
      'nav.bottom': onBottom,
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      dispatchKey('g', 'KeyG');
    });
    expect(onBottom).not.toHaveBeenCalled();

    await act(async () => {
      dispatchKey('d', 'KeyD');
    });

    expect(onDashboard).toHaveBeenCalledTimes(1);
    expect(onBottom).not.toHaveBeenCalled();

    act(() => root.unmount());
  });

  it('still treats shift-g as the vim shortcut for the last session', async () => {
    const onBottom = vi.fn();
    const { root } = renderShortcutHarness({
      'nav.bottom': onBottom,
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      dispatchKey('G', 'KeyG', { shiftKey: true });
    });

    expect(onBottom).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });
});
