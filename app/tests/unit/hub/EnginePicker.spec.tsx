// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineStatus } from '../../../src/renderer/hub/EnginePicker';
import { EnginePickerMenuContent } from '../../../src/renderer/hub/EnginePicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SessionsApi = {
  listEngines: ReturnType<typeof vi.fn>;
  engineStatus: ReturnType<typeof vi.fn>;
  engineInstall: ReturnType<typeof vi.fn>;
  engineLogin: ReturnType<typeof vi.fn>;
};

function installElectronApi(status: EngineStatus, sessionsOverrides?: Partial<SessionsApi>): SessionsApi {
  const sessions: SessionsApi = {
    listEngines: vi.fn(async () => [{
      id: status.id,
      displayName: status.displayName,
      binaryName: status.id,
    }]),
    engineStatus: vi.fn(async () => status),
    engineInstall: vi.fn(() => new Promise(() => undefined)),
    engineLogin: vi.fn(() => new Promise(() => undefined)),
    ...sessionsOverrides,
  };

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      sessions,
      settings: {
        open: vi.fn(),
      },
    },
  });

  return sessions;
}

function renderPicker(value: string): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<EnginePickerMenuContent value={value} onChange={vi.fn()} />);
  });
  return { container, root };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function getMenuItemButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('.engine-picker__menu button')).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing menu item: ${text}`);
  return button;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe('EnginePicker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not retrigger install while the same engine install is already in progress', async () => {
    const sessions = installElectronApi({
      id: 'codex',
      displayName: 'Codex',
      installed: { installed: false },
      authed: { authed: false },
    });
    const { container, root } = renderPicker('codex');

    await flush();

    act(() => {
      getMenuItemButton(container, 'Codex').click();
    });
    await flush();

    const installButton = getMenuItemButton(container, 'Codex');
    expect(installButton.disabled).toBe(true);

    act(() => {
      installButton.click();
    });

    expect(sessions.engineInstall).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });

  it('keeps install pending until the background installer process resolves', async () => {
    let status: EngineStatus = {
      id: 'codex',
      displayName: 'Codex',
      installed: { installed: false },
      authed: { authed: false },
    };
    const install = deferred<{ opened: boolean; completed: boolean; installed: { installed: boolean } }>();
    const sessions = installElectronApi(status, {
      engineStatus: vi.fn(async () => status),
      engineInstall: vi.fn(() => install.promise),
    });
    const { container, root } = renderPicker('codex');

    await flush();

    act(() => {
      getMenuItemButton(container, 'Codex').click();
    });
    await flush();

    expect(sessions.engineInstall).toHaveBeenCalledTimes(1);
    expect(getMenuItemButton(container, 'Codex').disabled).toBe(true);

    status = {
      id: 'codex',
      displayName: 'Codex',
      installed: { installed: true, version: '1.2.3' },
      authed: { authed: false },
    };
    await act(async () => {
      install.resolve({ opened: true, completed: true, installed: { installed: true } });
      await install.promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(sessions.engineStatus).toHaveBeenCalled();
    expect(getMenuItemButton(container, 'Codex').disabled).toBe(false);

    act(() => root.unmount());
  });

  it('keeps install pending while post-install CLI detection catches up', async () => {
    vi.useFakeTimers();
    let installed = false;
    const install = deferred<{ opened: boolean; completed: boolean; installed: { installed: boolean; error?: string } }>();
    const sessions = installElectronApi({
      id: 'codex',
      displayName: 'Codex',
      installed: { installed: false },
      authed: { authed: false },
    }, {
      engineStatus: vi.fn(async () => ({
        id: 'codex',
        displayName: 'Codex',
        installed: { installed },
        authed: { authed: false },
      })),
      engineInstall: vi.fn(() => install.promise),
    });
    const { container, root } = renderPicker('codex');

    await flush();

    act(() => {
      getMenuItemButton(container, 'Codex').click();
    });
    await flush();

    await act(async () => {
      install.resolve({ opened: true, completed: true, installed: { installed: false, error: 'codex not found on PATH' } });
      await install.promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(sessions.engineInstall).toHaveBeenCalledTimes(1);
    expect(getMenuItemButton(container, 'Codex').disabled).toBe(true);
    expect(getMenuItemButton(container, 'Codex').textContent).toContain('Installing');

    installed = true;
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(getMenuItemButton(container, 'Codex').disabled).toBe(false);
    expect(getMenuItemButton(container, 'Codex').textContent).toContain('Log in');

    act(() => root.unmount());
  });

  it('does not retrigger login while the same engine login is already in progress', async () => {
    const sessions = installElectronApi({
      id: 'claude-code',
      displayName: 'Claude Code',
      installed: { installed: true },
      authed: { authed: false },
    });
    const { container, root } = renderPicker('claude-code');

    await flush();

    act(() => {
      getMenuItemButton(container, 'Claude Code').click();
    });
    await flush();

    const loginButton = getMenuItemButton(container, 'Claude Code');
    expect(loginButton.disabled).toBe(true);

    act(() => {
      loginButton.click();
    });

    expect(sessions.engineLogin).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });
});
