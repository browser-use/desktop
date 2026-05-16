import React from 'react';
import { clearSelection, type TextSelectionSnapshot } from './useTextSelection';

interface QuoteSelectionButtonProps {
  selection: TextSelectionSnapshot | null;
  onQuote: (text: string) => void;
  /** Button label. Defaults to "Quote"; terminal sessions pass "Reference in new chat". */
  label?: string;
}

const BTN_HEIGHT = 28;
const GAP = 8;
const HORIZONTAL_MARGIN = 8;

function QuoteIcon(): React.ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M3.5 4h2v2h-1c-.55 0-1 .45-1 1v2h-1V6c0-1.1.9-2 2-2h-1Zm5 0h2v2h-1c-.55 0-1 .45-1 1v2h-1V6c0-1.1.9-2 2-2h-1Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Floating "Quote" button anchored to the current selection's bounding rect.
 * Centered horizontally above the selection; falls back below when above
 * would clip the viewport. Horizontally clamped to viewport bounds.
 *
 * Click prevents-default on mousedown so the browser doesn't drop the
 * selection before our handler runs.
 */
export function QuoteSelectionButton({ selection, onQuote, label = 'Quote' }: QuoteSelectionButtonProps): React.ReactElement | null {
  if (!selection) return null;

  const { rect, text } = selection;
  // Measure-after-paint isn't easy here; use a known approximate width. The
  // CSS sets min-width and the inner content centers, so a slight
  // mis-measurement just shifts a few px. Long labels (e.g. "Reference in
  // new chat") get a wider estimate so we don't clip into the viewport edge.
  const approxWidth = label.length > 6 ? 7 * label.length + 36 : 76;

  let top = rect.top - BTN_HEIGHT - GAP;
  if (top < HORIZONTAL_MARGIN) top = rect.bottom + GAP;
  const centerX = rect.left + rect.width / 2;
  let left = centerX - approxWidth / 2;
  const maxLeft = Math.max(HORIZONTAL_MARGIN, window.innerWidth - approxWidth - HORIZONTAL_MARGIN);
  if (left < HORIZONTAL_MARGIN) left = HORIZONTAL_MARGIN;
  if (left > maxLeft) left = maxLeft;

  return (
    <button
      type="button"
      className="chat-quote-btn"
      style={{ top, left }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onQuote(text);
        clearSelection();
      }}
    >
      <QuoteIcon />
      <span>{label}</span>
    </button>
  );
}
