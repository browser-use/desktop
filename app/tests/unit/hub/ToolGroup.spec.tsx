// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolGroup } from '../../../src/renderer/hub/chat/ToolGroup';
import type { OutputEntry } from '../../../src/renderer/hub/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderGroup(entries: OutputEntry[]): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ToolGroup entries={entries} />);
  });
  return { container, root };
}

function completedBash(id: string, command: string): OutputEntry {
  return {
    id,
    type: 'tool_call',
    timestamp: 1000,
    tool: 'bash',
    content: JSON.stringify({ command }),
    result: { content: '', ok: true },
  };
}

describe('ToolGroup', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('summarizes bash groups from the full command instead of the truncated display value', () => {
    const longPrefix = `/tmp/${'very-long-directory-name-'.repeat(8)}`;
    const { container, root } = renderGroup([
      completedBash('bash-1', `/bin/zsh -lc "cd ${longPrefix} && git status --short"`),
      completedBash('bash-2', 'cat package.json'),
    ]);

    expect(container.querySelector('.chat-tool__label')?.textContent).toContain('Reviewed recent changes');
    act(() => root.unmount());
  });
});
