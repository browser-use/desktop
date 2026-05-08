// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionsPane } from '../../../src/renderer/hub/ConnectionsPane';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const notAuthedCliStatus = {
  id: 'claude-code',
  displayName: 'Claude Code',
  installed: { installed: true },
  authed: { authed: false },
};

const notAuthedCodexStatus = {
  id: 'codex',
  displayName: 'Codex',
  installed: { installed: true },
  authed: { authed: false },
};

function installElectronApi(): {
  anthropic: Deferred<{ type: 'none' }>;
  claudeCli: Deferred<typeof notAuthedCliStatus>;
  openai: Deferred<{ present: false }>;
  codex: Deferred<typeof notAuthedCodexStatus>;
} {
  const anthropic = deferred<{ type: 'none' }>();
  const claudeCli = deferred<typeof notAuthedCliStatus>();
  const openai = deferred<{ present: false }>();
  const codex = deferred<typeof notAuthedCodexStatus>();

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      channels: {
        whatsapp: {
          status: vi.fn(async () => ({ status: 'disconnected', identity: null })),
          connect: vi.fn(),
          clearAuth: vi.fn(),
          disconnect: vi.fn(),
        },
      },
      on: {
        channelStatus: vi.fn(() => undefined),
        whatsappQr: vi.fn(() => undefined),
      },
      sessions: {
        engineStatus: vi.fn(async () => claudeCli.promise),
        engineInstall: vi.fn(),
      },
      settings: {
        apiKey: {
          getStatus: vi.fn(async () => anthropic.promise),
          test: vi.fn(),
          save: vi.fn(),
          delete: vi.fn(),
        },
        claudeCode: {
          available: vi.fn(async () => ({ available: false })),
          use: vi.fn(),
          login: vi.fn(),
          logout: vi.fn(),
        },
        openaiKey: {
          getStatus: vi.fn(async () => openai.promise),
          test: vi.fn(),
          save: vi.fn(),
          delete: vi.fn(),
        },
        codex: {
          status: vi.fn(async () => codex.promise),
          login: vi.fn(),
          logout: vi.fn(),
        },
        browserCode: {
          getStatus: vi.fn(async () => ({ keys: {}, active: null, installed: { installed: true }, providers: [] })),
          save: vi.fn(),
          test: vi.fn(),
          delete: vi.fn(),
          setActive: vi.fn(),
        },
      },
    },
  });

  return { anthropic, claudeCli, openai, codex };
}

function renderConnectionsPane(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ConnectionsPane embedded />);
  });
  return { container, root };
}

function cardByName(container: HTMLElement, name: string): HTMLElement {
  const card = Array.from(container.querySelectorAll<HTMLElement>('.conn-card')).find(
    (candidate) => candidate.textContent?.includes(name),
  );
  if (!card) throw new Error(`Missing card: ${name}`);
  return card;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) => (
    candidate.textContent?.includes(text)
  ));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${text}`);
  return button;
}

describe('ConnectionsPane provider loading', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps Anthropic and OpenAI cards in fixed skeleton states until status probes resolve', async () => {
    const status = installElectronApi();
    const { container, root } = renderConnectionsPane();

    expect(container.textContent).toContain('Browser Sync');

    const anthropicCard = cardByName(container, 'Anthropic');
    const openaiCard = cardByName(container, 'OpenAI');
    expect(anthropicCard.getAttribute('aria-busy')).toBe('true');
    expect(openaiCard.getAttribute('aria-busy')).toBe('true');
    expect(anthropicCard.querySelector('.conn-card__skeleton--subtitle')).not.toBeNull();
    expect(openaiCard.querySelector('.conn-card__skeleton--subtitle')).not.toBeNull();
    expect(anthropicCard.querySelector('.conn-card__skeleton--button-wide')).not.toBeNull();
    expect(openaiCard.querySelector('.conn-card__skeleton--button-wide')).not.toBeNull();

    await act(async () => {
      status.anthropic.resolve({ type: 'none' });
      status.claudeCli.resolve(notAuthedCliStatus);
      status.openai.resolve({ present: false });
      status.codex.resolve(notAuthedCodexStatus);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(anthropicCard.getAttribute('aria-busy')).toBe('false');
    expect(openaiCard.getAttribute('aria-busy')).toBe('false');
    expect(anthropicCard.querySelector('.conn-card__skeleton--subtitle')).toBeNull();
    expect(openaiCard.querySelector('.conn-card__skeleton--subtitle')).toBeNull();

    act(() => root.unmount());
  });

  it('keeps install failure hidden while CLI detection catches up after installer exit', async () => {
    vi.useFakeTimers();
    let claudeInstalled = false;

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        channels: {
          whatsapp: {
            status: vi.fn(async () => ({ status: 'disconnected', identity: null })),
            connect: vi.fn(),
            clearAuth: vi.fn(),
            disconnect: vi.fn(),
          },
        },
        on: {
          channelStatus: vi.fn(() => undefined),
          whatsappQr: vi.fn(() => undefined),
        },
        sessions: {
          engineStatus: vi.fn(async (engineId: string) => ({
            id: engineId,
            displayName: engineId === 'claude-code' ? 'Claude Code' : 'Codex',
            installed: { installed: engineId === 'claude-code' ? claudeInstalled : true },
            authed: { authed: false },
          })),
          engineInstall: vi.fn(async () => ({
            opened: true,
            completed: true,
            installed: { installed: false, error: 'codex not found on PATH' },
          })),
        },
        settings: {
          apiKey: {
            getStatus: vi.fn(async () => ({ type: 'none' })),
            test: vi.fn(),
            save: vi.fn(),
            delete: vi.fn(),
          },
          claudeCode: {
            available: vi.fn(async () => ({ available: false })),
            use: vi.fn(),
            login: vi.fn(),
            logout: vi.fn(),
          },
          openaiKey: {
            getStatus: vi.fn(async () => ({ present: false })),
            test: vi.fn(),
            save: vi.fn(),
            delete: vi.fn(),
          },
          codex: {
            status: vi.fn(async () => ({
              id: 'codex',
              displayName: 'Codex',
              installed: { installed: true },
              authed: { authed: false },
            })),
            login: vi.fn(),
            logout: vi.fn(),
          },
          browserCode: {
            getStatus: vi.fn(async () => ({ keys: {}, active: null, installed: { installed: true }, providers: [] })),
            save: vi.fn(),
            test: vi.fn(),
            delete: vi.fn(),
            setActive: vi.fn(),
          },
        },
      },
    });

    const { container, root } = renderConnectionsPane();
    await flush();

    act(() => {
      buttonByText(container, 'Install Claude Code').click();
    });
    await flush();

    expect(container.textContent).not.toContain('codex not found on PATH');

    claudeInstalled = true;
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(container.textContent).not.toContain('codex not found on PATH');
    expect(container.textContent).not.toContain('Installer finished but claude-code was not detected.');
    expect(container.textContent).toContain('Sign in with Claude');

    act(() => root.unmount());
  });
});
