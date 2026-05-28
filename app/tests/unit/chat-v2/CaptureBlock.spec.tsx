// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureBlock, deriveCaptureSubmission } from '@/renderer/hub/chat-v2/CaptureBlock';
import type { CapturePayload } from '@/renderer/hub/chat-v2/htmlBlocks';
import { _resetSubmissionCacheForTests } from '@/renderer/hub/chat-v2/optionListStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ResumeMock = ReturnType<typeof vi.fn>;

function installBridge(): ResumeMock {
  const resume: ResumeMock = vi.fn(async () => ({ ok: true }));
  (globalThis as unknown as { window: Window }).window = globalThis.window;
  // @ts-expect-error — minimal stub
  (globalThis as { window: Window }).window.electronAPI = { sessions: { resume } };
  return resume;
}

function renderCapture(payload: CapturePayload, sessionId = 'session-1', nextUserText?: string): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <CaptureBlock payload={payload} complete sessionId={sessionId} nextUserText={nextUserText} />,
    );
  });
  return { container, root };
}

function tiles(container: HTMLDivElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button.chatv2-capture__tile'));
}

function submitBtn(container: HTMLDivElement): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>('button.chatv2-capture__submit');
  if (!btn) throw new Error('submit button not found');
  return btn;
}

const basePayload: CapturePayload = {
  image: '/tmp/grid.png',
  prompt: 'Select motorcycles',
  rows: 3,
  cols: 3,
};

let mounted: Root | null = null;

beforeEach(() => {
  _resetSubmissionCacheForTests();
  installBridge();
});

afterEach(() => {
  if (mounted) {
    act(() => { mounted!.unmount(); });
    mounted = null;
  }
  document.body.innerHTML = '';
});

describe('CaptureBlock', () => {
  it('renders 9 tile buttons for a 3x3 grid', () => {
    const { container, root } = renderCapture(basePayload);
    mounted = root;
    expect(tiles(container)).toHaveLength(9);
  });

  it('positions each tile background by index', () => {
    const { container, root } = renderCapture(basePayload);
    mounted = root;
    const ts = tiles(container);
    expect(ts[0].style.backgroundPosition).toBe('0% 0%');
    expect(ts[4].style.backgroundPosition).toBe('50% 50%');
    expect(ts[8].style.backgroundPosition).toBe('100% 100%');
    expect(ts[0].style.backgroundSize).toBe('300% 300%');
  });

  it('embeds chatfile:// prefix for raw absolute paths', () => {
    const { container, root } = renderCapture(basePayload);
    mounted = root;
    const ts = tiles(container);
    expect(ts[0].style.backgroundImage).toContain('chatfile://files/tmp/grid.png');
  });

  it('toggles selection on click and submits sorted indices', async () => {
    const resume = installBridge();
    const { container, root } = renderCapture(basePayload);
    mounted = root;
    const ts = tiles(container);
    await act(async () => { ts[6].click(); });
    await act(async () => { ts[0].click(); });
    await act(async () => { ts[2].click(); });
    expect(ts[0].getAttribute('data-selected')).toBe('true');
    expect(ts[2].getAttribute('data-selected')).toBe('true');
    expect(ts[6].getAttribute('data-selected')).toBe('true');
    await act(async () => { submitBtn(container).click(); });
    // Allow the resume promise + state setState in the same microtask to flush.
    await act(async () => {});
    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith('session-1', 'Captcha selected tiles: 0, 2, 6');
  });

  it('submits "(none)" when no tiles are selected', async () => {
    const resume = installBridge();
    const { container, root } = renderCapture(basePayload);
    mounted = root;
    await act(async () => { submitBtn(container).click(); });
    await act(async () => {});
    expect(resume).toHaveBeenCalledWith('session-1', 'Captcha selected tiles: (none)');
  });

  it('hydrates the answered state from transcript text', () => {
    const { container, root } = renderCapture(basePayload, 'session-1', 'Captcha selected tiles: 1, 5');
    mounted = root;
    const ts = tiles(container);
    expect(ts[1].getAttribute('data-selected')).toBe('true');
    expect(ts[5].getAttribute('data-selected')).toBe('true');
    expect(ts[1].disabled).toBe(true);
    expect(submitBtn(container).disabled).toBe(true);
    expect(submitBtn(container).textContent).toContain('Sent to agent');
  });
});

describe('deriveCaptureSubmission', () => {
  it('parses (none) reply as an empty selection', () => {
    const out = deriveCaptureSubmission('Captcha selected tiles: (none)', 9);
    expect(out?.size).toBe(0);
  });

  it('ignores out-of-range indices', () => {
    const out = deriveCaptureSubmission('Captcha selected tiles: 0, 9, 42', 9);
    expect(out && Array.from(out)).toEqual([0]);
  });

  it('returns null for non-capture replies', () => {
    expect(deriveCaptureSubmission('hello there', 9)).toBeNull();
  });
});
