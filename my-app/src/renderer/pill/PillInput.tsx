/**
 * Track B — PillInput component.
 *
 * Text input that blends seamlessly into the pill surface.
 * No magnifier icon — the pill shape is the affordance.
 * Single ↵ kbd chip (right side) appears only when input has text.
 * Esc is universal — no chip needed.
 *
 * Keyboard:
 *   Enter   → submit (when not disabled + value not empty)
 *   Escape  → hide pill
 *
 * Accessibility:
 *   - input has aria-label
 *   - kbd chip has aria-hidden="true" (decorative)
 *   - disabled state sets aria-busy="true" on the row
 */

import React, { useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLACEHOLDER_TEXT = 'Ask, search, or jump to a tab…' as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PillInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (prompt: string) => void;
  onEscape: () => void;
  disabled: boolean;
  placeholder?: string;
  /** Left-side dot/icon slot — rendered by parent for state awareness */
  leadingSlot?: React.ReactNode;
  /** Whether to show the ↵ kbd chip (parent controls based on pill state) */
  showSubmitChip?: boolean;
  /** Whether to show a ⌘C chip instead (done state) */
  showCopyChip?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PillInput({
  value,
  onChange,
  onSubmit,
  onEscape,
  disabled,
  placeholder = PLACEHOLDER_TEXT,
  leadingSlot,
  showSubmitChip,
  showCopyChip,
}: PillInputProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Re-focus when task completes
  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed && !disabled) {
        onSubmit(trimmed);
      }
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape();
    }
  }

  const hasText = value.trim().length > 0;
  // Show ↵ chip: parent can override, but default = has text + not disabled
  const enterChipVisible = showSubmitChip !== undefined ? showSubmitChip : (hasText && !disabled);

  return (
    <div
      className="pill-input-row"
      aria-busy={disabled}
      data-testid="pill-input-row"
    >
      {/* Leading slot — agent dot or result icon, injected by Pill.tsx */}
      {leadingSlot}

      <input
        ref={inputRef}
        className="pill-input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        aria-label="Agent command input — ask, search, or jump to a tab"
        data-testid="pill-input"
      />

      {/* Progress bar — absolutely positioned, rendered by parent via CSS state */}
      <div className="pill-progress-bar" aria-hidden="true" />

      {/* Kbd chip — right side, single chip, contextual */}
      {showCopyChip ? (
        <kbd
          className="pill-kbd-chip"
          data-chip="copy"
          aria-hidden="true"
        >
          ⌘C
        </kbd>
      ) : (
        <kbd
          className="pill-kbd-chip"
          data-chip="enter"
          data-visible={enterChipVisible ? 'true' : 'false'}
          aria-hidden="true"
        >
          ↵
        </kbd>
      )}
    </div>
  );
}
