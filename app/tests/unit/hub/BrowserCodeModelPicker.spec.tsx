// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserCodeProviderSubmenu } from '../../../src/renderer/hub/BrowserCodeModelPicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function installElectronApi(): void {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      settings: {
        browserCode: {
          getStatus: vi.fn(async () => ({
            keys: {
              moonshotai: { masked: 'msk-1234' },
            },
            active: 'moonshotai',
            providers: [
              {
                id: 'moonshotai',
                name: 'Moonshot AI',
                defaultModel: 'moonshotai/kimi-k2.6',
                models: [
                  { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6' },
                  { id: 'moonshotai/kimi-k2-thinking', label: 'Kimi K2 Thinking' },
                ],
              },
            ],
          })),
          save: vi.fn(),
          setActive: vi.fn(),
        },
        open: vi.fn(),
      },
    },
  });
}

function renderSubmenu(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<BrowserCodeProviderSubmenu />);
  });
  return { container, root };
}

function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${text}`);
  return button;
}

describe('BrowserCodeProviderSubmenu', () => {
  beforeEach(() => {
    installElectronApi();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('highlights the provider default model when the active provider has no saved lastModel', async () => {
    const { container, root } = renderSubmenu();

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      findButtonByText(container, 'Moonshot AI').click();
    });

    const defaultModelButton = findButtonByText(container, 'Kimi K2.6');
    expect(defaultModelButton.className).toContain('browsercode-model-picker__item--active');
    expect(defaultModelButton.textContent).toContain('✓');

    act(() => root.unmount());
  });
});
