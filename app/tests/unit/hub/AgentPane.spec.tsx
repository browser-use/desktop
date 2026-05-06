// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentPane } from '../../../src/renderer/hub/AgentPane';
import type { AgentSession } from '../../../src/renderer/hub/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
};

vi.mock('../../../src/renderer/hub/useSessionsQuery', () => ({
  useHydrateSession: vi.fn(),
}));

function makeSession(): AgentSession {
  return {
    id: 'session-1',
    createdAt: Date.now(),
    status: 'idle',
    prompt: 'Browse manually',
    output: [],
    hasBrowser: true,
  };
}

function installApi(overrides?: Partial<ElectronSessionAPI>): {
  navigate: ReturnType<typeof vi.fn>;
  back: ReturnType<typeof vi.fn>;
  forward: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  emitNavigation: (state: BrowserNavigationState) => void;
} {
  let navigationHandler: ((id: string, state: BrowserNavigationState) => void) | null = null;
  const navigate = vi.fn(async () => ({ ok: true, url: 'https://example.com/' }));
  const back = vi.fn(async () => ({ ok: true }));
  const forward = vi.fn(async () => ({ ok: true }));
  const reload = vi.fn(async () => ({ ok: true }));

  (window as unknown as { electronAPI: Partial<ElectronAPI> }).electronAPI = {
    sessions: {
      get: vi.fn(async () => null),
      viewDetach: vi.fn(async () => true),
      getNavigationState: vi.fn(async () => ({
        url: 'https://start.example/',
        title: 'Start',
        canGoBack: false,
        canGoForward: true,
        isLoading: false,
      })),
      navigate,
      back,
      forward,
      reload,
      ...overrides,
    } as Partial<ElectronSessionAPI> as ElectronSessionAPI,
    on: {
      sessionNavigationState: (cb: (id: string, state: BrowserNavigationState) => void) => {
        navigationHandler = cb;
        return () => { navigationHandler = null; };
      },
    } as Partial<ElectronOnAPI> as ElectronOnAPI,
  };

  return {
    navigate,
    back,
    forward,
    reload,
    emitNavigation: (state) => navigationHandler?.('session-1', state),
  };
}

function renderPane(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<AgentPane session={makeSession()} />);
  });
  return { container, root };
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Missing input value setter');
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('AgentPane browser address bar', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('renders navigation state and submits manual navigation input', async () => {
    const api = installApi();
    const { container, root } = renderPane();

    await act(async () => {
      await Promise.resolve();
    });

    const input = container.querySelector<HTMLInputElement>('.pane__address-input');
    if (!input) throw new Error('Missing address input');
    expect(input.value).toBe('https://start.example/');

    await act(async () => {
      setInput(input, 'example.com');
      input.form?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    });

    expect(api.navigate).toHaveBeenCalledWith('session-1', 'example.com');

    act(() => root.unmount());
  });

  it('updates address, title, and history controls from browser state events', async () => {
    const api = installApi();
    const { container, root } = renderPane();

    await act(async () => {
      await Promise.resolve();
      api.emitNavigation({
        url: 'https://next.example/page',
        title: 'Next Page',
        canGoBack: true,
        canGoForward: false,
        isLoading: false,
      });
    });

    const input = container.querySelector<HTMLInputElement>('.pane__address-input');
    const back = container.querySelector<HTMLButtonElement>('button[aria-label="Back"]');
    const forward = container.querySelector<HTMLButtonElement>('button[aria-label="Forward"]');
    const title = container.querySelector<HTMLElement>('.pane__address-title');

    expect(input?.value).toBe('https://next.example/page');
    expect(title?.textContent).toBe('Next Page');
    expect(back?.disabled).toBe(false);
    expect(forward?.disabled).toBe(true);

    act(() => root.unmount());
  });

  it('shows invalid navigation feedback from the IPC result', async () => {
    installApi({
      navigate: vi.fn(async () => ({ ok: false, error: 'Unsupported URL scheme: javascript' })),
    });
    const { container, root } = renderPane();

    await act(async () => {
      await Promise.resolve();
    });

    const input = container.querySelector<HTMLInputElement>('.pane__address-input');
    if (!input) throw new Error('Missing address input');

    await act(async () => {
      setInput(input, 'javascript:alert(1)');
      input.form?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Unsupported URL scheme: javascript');

    act(() => root.unmount());
  });
});
