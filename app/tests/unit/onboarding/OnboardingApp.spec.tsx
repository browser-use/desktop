// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingApp } from '../../../src/renderer/onboarding/OnboardingApp';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type OnboardingApi = Window['onboardingAPI'];
type InstallResult = Awaited<ReturnType<OnboardingApi['installEngine']>>;

function installOnboardingApi(overrides: Partial<OnboardingApi> = {}): OnboardingApi {
  const api = {
    detectChromeProfiles: vi.fn(async () => []),
    importChromeProfileCookies: vi.fn(),
    listSessionCookies: vi.fn(async () => []),
    getChromeProfileSyncs: vi.fn(async () => ({})),
    saveApiKey: vi.fn(async () => undefined),
    testApiKey: vi.fn(async () => ({ success: true })),
    saveOpenAIKey: vi.fn(async () => undefined),
    testOpenAIKey: vi.fn(async () => ({ success: true })),
    detectClaudeCode: vi.fn(async () => ({
      available: true,
      installed: false,
      authed: false,
      version: null,
      subscriptionType: null,
    })),
    useClaudeCode: vi.fn(async () => ({ subscriptionType: null })),
    runClaudeLogin: vi.fn(async () => ({ ok: true })),
    openClaudeLoginTerminal: vi.fn(async () => ({ opened: true })),
    detectCodex: vi.fn(async () => ({
      available: true,
      installed: false,
      authed: false,
      version: null,
    })),
    useCodex: vi.fn(async () => ({ ok: true })),
    openCodexLoginTerminal: vi.fn(async () => ({ opened: true })),
    installEngine: vi.fn(async () => ({
      opened: true,
      completed: true,
      installed: { installed: false },
    })),
    openExternal: vi.fn(async () => ({ opened: true })),
    requestNotifications: vi.fn(async () => ({ supported: true })),
    platform: 'darwin',
    getPlatform: vi.fn(async () => 'darwin'),
    listenShortcut: vi.fn(async () => ({ ok: true, accelerator: 'CommandOrControl+Alt+Space' })),
    setShortcut: vi.fn(async (accelerator: string) => ({ ok: true, accelerator })),
    triggerShortcut: vi.fn(async () => ({ ok: true })),
    onShortcutActivated: vi.fn(() => () => undefined),
    onTaskSubmitted: vi.fn(() => () => undefined),
    onPillShown: vi.fn(() => () => undefined),
    onPillHidden: vi.fn(() => () => undefined),
    getConsent: vi.fn(async () => ({ telemetry: false, telemetryUpdatedAt: null, version: 1 })),
    setTelemetryConsent: vi.fn(async (telemetry: boolean) => ({ telemetry, telemetryUpdatedAt: null, version: 1 })),
    capture: vi.fn(),
    complete: vi.fn(async () => undefined),
    getState: vi.fn(async () => ({ lastStep: 'apikey' })),
    setStep: vi.fn(async () => undefined),
    whatsapp: {
      connect: vi.fn(async () => ({ status: 'connected' })),
      disconnect: vi.fn(async () => ({ status: 'disconnected' })),
      status: vi.fn(async () => ({ status: 'disconnected', identity: null })),
    },
    onWhatsappQr: vi.fn(() => () => undefined),
    onChannelStatus: vi.fn(() => () => undefined),
    ...overrides,
  } satisfies OnboardingApi;

  Object.defineProperty(window, 'onboardingAPI', {
    configurable: true,
    value: api,
  });

  return api;
}

function renderOnboarding(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<OnboardingApp />);
  });
  return { container, root };
}

async function flush(times = 4): Promise<void> {
  await act(async () => {
    for (let i = 0; i < times; i++) await Promise.resolve();
  });
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) => (
    candidate.textContent?.includes(text)
  ));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${text}`);
  return button;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe('OnboardingApp provider installs', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps each install button pending independently when provider installs overlap', async () => {
    const claudeInstall = deferred<InstallResult>();
    const codexInstall = deferred<InstallResult>();
    const api = installOnboardingApi({
      installEngine: vi.fn((engineId: 'claude-code' | 'codex') => (
        engineId === 'claude-code' ? claudeInstall.promise : codexInstall.promise
      )),
    });
    const { container, root } = renderOnboarding();

    await flush();
    expect(container.textContent).toContain('Vendor setup');

    act(() => {
      buttonByText(container, 'Install Claude Code').click();
    });
    await flush();

    expect(buttonByText(container, 'Installing Claude Code').disabled).toBe(true);
    expect(buttonByText(container, 'Install Codex CLI').disabled).toBe(false);

    act(() => {
      buttonByText(container, 'Install Codex CLI').click();
    });
    await flush();

    expect(api.installEngine).toHaveBeenCalledTimes(2);
    expect(api.installEngine).toHaveBeenNthCalledWith(1, 'claude-code');
    expect(api.installEngine).toHaveBeenNthCalledWith(2, 'codex');
    expect(buttonByText(container, 'Installing Claude Code').disabled).toBe(true);
    expect(buttonByText(container, 'Installing Codex').disabled).toBe(true);

    act(() => root.unmount());
  });

  it('describes the Codex install button as an automatic background installer', async () => {
    installOnboardingApi();
    const { container, root } = renderOnboarding();

    await flush();
    const codexButton = buttonByText(container, 'Install Codex CLI');

    expect(codexButton.textContent).toContain('Runs the installer in the background. We\u2019ll detect it when it finishes.');
    expect(codexButton.textContent).not.toContain('npm i -g @openai/codex');

    act(() => root.unmount());
  });
});
