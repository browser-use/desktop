/**
 * OfflineBanner — top-of-window banner shown when navigator.onLine === false.
 *
 * Warm yellow (#f59e0b) — status-warning from shell palette.
 * Dismissible. Listens to online/offline window events.
 * No !important, no Inter font, no sparkles icon.
 */

import React, { useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OFFLINE_MESSAGE  = "You're offline. Some features may not work." as const;
const DISMISS_LABEL    = 'Dismiss offline banner'                       as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OfflineBanner(): React.ReactElement | null {
  const [isOffline, setIsOffline]   = useState<boolean>(!navigator.onLine);
  const [dismissed, setDismissed]   = useState<boolean>(false);

  const handleOnline  = useCallback(() => { setIsOffline(false); setDismissed(false); }, []);
  const handleOffline = useCallback(() => { setIsOffline(true);  setDismissed(false); }, []);

  useEffect(() => {
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  if (!isOffline || dismissed) return null;

  return (
    <div
      className="offline-banner"
      role="status"
      aria-live="polite"
      aria-label={OFFLINE_MESSAGE}
    >
      {/* Warning icon */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
        className="offline-banner__icon"
      >
        <path
          d="M7 1.5L13 12.5H1L7 1.5Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <line
          x1="7" y1="6"
          x2="7" y2="9"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <circle cx="7" cy="10.5" r="0.6" fill="currentColor" />
      </svg>

      <span className="offline-banner__message">{OFFLINE_MESSAGE}</span>

      <button
        type="button"
        className="offline-banner__dismiss"
        onClick={() => setDismissed(true)}
        aria-label={DISMISS_LABEL}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path
            d="M1 1l8 8M9 1L1 9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

export default OfflineBanner;
