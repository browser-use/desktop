/**
 * RecentlyClosedDropdown: a small popover anchored below the toolbar history
 * button. Shows up to 10 recently closed tabs (favicon + title + relative
 * timestamp). Click an entry to restore that specific tab (not just the top).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClosedTabRecord } from '../../main/tabs/TabManager';

const MAX_VISIBLE = 10;

interface Props {
  open: boolean;
  onClose: () => void;
  entries: ClosedTabRecord[];
  onRestore: (index: number) => void;
}

function formatRelative(ms: number): string {
  const delta = Math.max(0, Date.now() - ms);
  const s = Math.floor(delta / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function RecentlyClosedDropdown({
  open,
  onClose,
  entries,
  onRestore,
}: Props): React.ReactElement | null {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside-click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // defer to next tick so the trigger click that opened us doesn't immediately close
    const t = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const visible = useMemo(() => entries.slice(0, MAX_VISIBLE), [entries]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="recently-closed"
      role="menu"
      aria-label="Recently closed tabs"
    >
      <div className="recently-closed__header">Recently closed</div>
      {visible.length === 0 ? (
        <div className="recently-closed__empty">No recently closed tabs</div>
      ) : (
        <ul className="recently-closed__list">
          {visible.map((entry, index) => (
            <li key={`${entry.id}-${entry.closedAt}`}>
              <button
                type="button"
                className="recently-closed__item"
                role="menuitem"
                onClick={() => {
                  onRestore(index);
                  onClose();
                }}
                title={entry.url}
              >
                <span className="recently-closed__favicon" aria-hidden="true">
                  {entry.favicon ? (
                    <img src={entry.favicon} alt="" />
                  ) : (
                    <span className="recently-closed__favicon-placeholder" />
                  )}
                </span>
                <span className="recently-closed__title">
                  {entry.title || entry.url || 'Untitled'}
                </span>
                <span className="recently-closed__time">
                  {formatRelative(entry.closedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
