/**
 * FindBar: Chrome-parity find-in-page overlay.
 *
 * Opens on Cmd+F (main sends 'find-open'). The renderer owns the input value
 * and the open/closed flag; main owns the actual search on webContents and
 * streams results back via 'find-result'.
 *
 * Behavior:
 *   Enter         → next match
 *   Shift+Enter   → previous match
 *   Esc           → close + clear selection
 *   input change  → new search (fires on every keystroke; Electron debounces)
 *   empty input   → stop + reset counter
 *
 * The counter shows activeMatchOrdinal / matches. While Chromium is still
 * scanning, finalUpdate=false events arrive with matches=0; we ignore those
 * and only update the visible counter on finalUpdate===true to prevent
 * flicker between 0 and the real count.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { FindResultPayload } from '../../main/tabs/TabManager';

declare const electronAPI: {
  find: {
    start: (text: string) => Promise<void>;
    next: () => Promise<void>;
    prev: () => Promise<void>;
    stop: () => Promise<void>;
    getLastQuery: () => Promise<string>;
  };
  on: {
    findOpen: (cb: (p: { lastQuery: string }) => void) => () => void;
    findResult: (cb: (p: FindResultPayload) => void) => () => void;
    tabActivated: (cb: (tabId: string) => void) => () => void;
  };
};

interface FindBarProps {
  activeTabId: string | null;
}

export function FindBar({ activeTabId }: FindBarProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeOrdinal, setActiveOrdinal] = useState(0);
  const [matches, setMatches] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // --- open / close ----------------------------------------------------------
  const close = useCallback(() => {
    setOpen(false);
    setActiveOrdinal(0);
    setMatches(0);
    electronAPI.find.stop();
  }, []);

  // Menu → Cmd+F asks us to open and pre-fills the last query for this tab.
  useEffect(() => {
    const unsub = electronAPI.on.findOpen(({ lastQuery }) => {
      setOpen(true);
      setQuery(lastQuery);
      // Re-issue the search so the highlight re-appears immediately.
      if (lastQuery) {
        electronAPI.find.start(lastQuery);
      }
      // Focus + select after paint so the user can type over or tweak.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    });
    return unsub;
  }, []);

  // --- result stream ---------------------------------------------------------
  useEffect(() => {
    const unsub = electronAPI.on.findResult((payload) => {
      // Only the final update carries an authoritative count. Intermediate
      // events report matches:0 while the scan is in flight and would blink
      // the counter to "0/0" on every keystroke.
      if (!payload.finalUpdate) return;
      setActiveOrdinal(payload.activeMatchOrdinal);
      setMatches(payload.matches);
    });
    return unsub;
  }, []);

  // --- tab switch → close ----------------------------------------------------
  // Chrome closes the find bar when the user switches tabs. We follow suit:
  // the bar is scoped to the active tab's WebContents and the counter would
  // be meaningless on a newly-focused tab.
  useEffect(() => {
    if (open) close();
    // Intentionally only reacts to activeTabId changes; close() is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  // --- input → live search ---------------------------------------------------
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (v) {
      electronAPI.find.start(v);
    } else {
      // Empty query clears the highlight and zeroes the counter locally;
      // main sees the empty string and calls stopFindInPage.
      electronAPI.find.start('');
      setActiveOrdinal(0);
      setMatches(0);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!query) return;
        if (e.shiftKey) {
          electronAPI.find.prev();
        } else {
          electronAPI.find.next();
        }
      }
    },
    [close, query],
  );

  if (!open) return null;

  // When there's no query yet we show nothing in the counter; when there's a
  // query but zero matches, we show "No results" so the user knows the search
  // ran (vs. "0/0" which reads as pre-search state).
  const counterLabel = !query
    ? ''
    : matches === 0
      ? 'No results'
      : `${activeOrdinal}/${matches}`;

  return (
    <div className="find-bar" role="search" aria-label="Find in page">
      <input
        ref={inputRef}
        className="find-bar__input"
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Find in page"
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        aria-label="Find in page"
      />
      <span className="find-bar__counter" aria-live="polite">
        {counterLabel}
      </span>
      <button
        type="button"
        className="find-bar__btn"
        onClick={() => electronAPI.find.prev()}
        disabled={!query || matches === 0}
        aria-label="Previous match"
        title="Previous (Shift+Enter)"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 7l3-3 3 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className="find-bar__btn"
        onClick={() => electronAPI.find.next()}
        disabled={!query || matches === 0}
        aria-label="Next match"
        title="Next (Enter)"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className="find-bar__btn find-bar__btn--close"
        onClick={close}
        aria-label="Close find bar"
        title="Close (Esc)"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
