/**
 * NavButtons: back, forward, reload/stop navigation controls.
 * Right-click or long-press (500ms) on back/forward opens a history dropdown.
 */

import React, { useCallback, useRef } from 'react';

const LONG_PRESS_MS = 500;

interface NavButtonsProps {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: (hard: boolean) => void;
  onBackContextMenu?: () => void;
  onForwardContextMenu?: () => void;
}

export function NavButtons({
  canGoBack,
  canGoForward,
  isLoading,
  onBack,
  onForward,
  onReload,
  onBackContextMenu,
  onForwardContextMenu,
}: NavButtonsProps): React.ReactElement {
  const backTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backFiredRef = useRef(false);
  const forwardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forwardFiredRef = useRef(false);

  const handleBackMouseDown = useCallback(() => {
    backFiredRef.current = false;
    backTimerRef.current = setTimeout(() => {
      backFiredRef.current = true;
      console.log('[NavButtons] Back long-press triggered, showing history menu');
      onBackContextMenu?.();
    }, LONG_PRESS_MS);
  }, [onBackContextMenu]);

  const handleBackMouseUp = useCallback(() => {
    if (backTimerRef.current) {
      clearTimeout(backTimerRef.current);
      backTimerRef.current = null;
    }
    if (!backFiredRef.current) {
      onBack();
    }
    backFiredRef.current = false;
  }, [onBack]);

  const handleBackMouseLeave = useCallback(() => {
    if (backTimerRef.current) {
      clearTimeout(backTimerRef.current);
      backTimerRef.current = null;
    }
  }, []);

  const handleBackContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    console.log('[NavButtons] Back right-click, showing history menu');
    onBackContextMenu?.();
  }, [onBackContextMenu]);

  const handleForwardMouseDown = useCallback(() => {
    forwardFiredRef.current = false;
    forwardTimerRef.current = setTimeout(() => {
      forwardFiredRef.current = true;
      console.log('[NavButtons] Forward long-press triggered, showing history menu');
      onForwardContextMenu?.();
    }, LONG_PRESS_MS);
  }, [onForwardContextMenu]);

  const handleForwardMouseUp = useCallback(() => {
    if (forwardTimerRef.current) {
      clearTimeout(forwardTimerRef.current);
      forwardTimerRef.current = null;
    }
    if (!forwardFiredRef.current) {
      onForward();
    }
    forwardFiredRef.current = false;
  }, [onForward]);

  const handleForwardMouseLeave = useCallback(() => {
    if (forwardTimerRef.current) {
      clearTimeout(forwardTimerRef.current);
      forwardTimerRef.current = null;
    }
  }, []);

  const handleForwardContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    console.log('[NavButtons] Forward right-click, showing history menu');
    onForwardContextMenu?.();
  }, [onForwardContextMenu]);

  return (
    <div className="nav-buttons">
      <button
        className="nav-buttons__btn"
        aria-label="Go back"
        disabled={!canGoBack}
        onMouseDown={canGoBack ? handleBackMouseDown : undefined}
        onMouseUp={canGoBack ? handleBackMouseUp : undefined}
        onMouseLeave={handleBackMouseLeave}
        onContextMenu={handleBackContextMenu}
        title="Back (right-click for history)"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M10 12L6 8l4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <button
        className="nav-buttons__btn"
        aria-label="Go forward"
        disabled={!canGoForward}
        onMouseDown={canGoForward ? handleForwardMouseDown : undefined}
        onMouseUp={canGoForward ? handleForwardMouseUp : undefined}
        onMouseLeave={handleForwardMouseLeave}
        onContextMenu={handleForwardContextMenu}
        title="Forward (right-click for history)"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M6 12l4-4-4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <button
        className="nav-buttons__btn"
        aria-label={isLoading ? 'Stop loading' : 'Reload page'}
        onClick={(e) => onReload(e.shiftKey)}
        title={isLoading ? 'Stop (Esc)' : 'Reload (Cmd+R, Shift-click to bypass cache)'}
      >
        {isLoading ? (
          /* Stop icon */
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="5" y="5" width="6" height="6" rx="1" fill="currentColor" opacity="0.7" />
          </svg>
        ) : (
          /* Reload icon */
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M13 8a5 5 0 1 1-1.46-3.54"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M11.5 4.5V2.5H13.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
