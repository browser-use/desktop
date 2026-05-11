import { useEffect, useState, type RefObject } from 'react';

export interface TextSelectionSnapshot {
  text: string;
  rect: DOMRect;
}

/**
 * Track the current text selection inside a scoped container. Returns
 * `null` when the selection is collapsed, zero-dimension, or falls outside
 * the container.
 *
 * Mirrors `browser_use_cloud/.../useTextSelection.ts`:
 *   - listens to selectionchange + mouseup on document
 *   - uses Selection API + range.getBoundingClientRect()
 *   - filters out collapsed and zero-dim selections (programmatic
 *     selections, focus/blur artifacts)
 *
 * Scope: only fires when the entire selection is anchored *and* extended
 * inside `containerRef`. That prevents the floating Quote button from
 * showing when the user selects text in the composer textarea or the
 * sidebar.
 */
export function useTextSelection(containerRef: RefObject<HTMLElement | null>): TextSelectionSnapshot | null {
  const [snap, setSnap] = useState<TextSelectionSnapshot | null>(null);

  useEffect(() => {
    const compute = (): void => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSnap(null);
        return;
      }
      const container = containerRef.current;
      if (!container) {
        setSnap(null);
        return;
      }
      // Restrict to selections fully inside the transcript container.
      const anchor = sel.anchorNode;
      const focus = sel.focusNode;
      if (!anchor || !focus) {
        setSnap(null);
        return;
      }
      if (!container.contains(anchor) || !container.contains(focus)) {
        setSnap(null);
        return;
      }
      const text = sel.toString();
      if (!text.trim()) {
        setSnap(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setSnap(null);
        return;
      }
      setSnap({ text, rect });
    };

    const onSelectionChange = (): void => compute();
    const onMouseUp = (): void => compute();
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [containerRef]);

  return snap;
}

export function clearSelection(): void {
  try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
}
