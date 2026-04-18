/**
 * DownloadButton: toolbar icon with animated progress ring.
 * Shows a download arrow icon; when downloads are active, an SVG ring
 * animates around it showing aggregate progress.
 */

import React from 'react';

interface DownloadButtonProps {
  hasActiveDownloads: boolean;
  progress: number;
  downloadCount: number;
  onClick: () => void;
}

const RING_RADIUS = 11;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function DownloadButton({
  hasActiveDownloads,
  progress,
  downloadCount,
  onClick,
}: DownloadButtonProps): React.ReactElement {
  const dashOffset = RING_CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, progress)));

  return (
    <button
      className={`nav-buttons__btn download-btn${hasActiveDownloads ? ' download-btn--active' : ''}`}
      aria-label={hasActiveDownloads ? `Downloads (${downloadCount} active)` : 'Downloads'}
      title="Downloads"
      onClick={onClick}
    >
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        {/* Progress ring (only visible during active downloads) */}
        {hasActiveDownloads && (
          <circle
            className="download-btn__ring"
            cx="14"
            cy="14"
            r={RING_RADIUS}
            stroke="var(--color-accent-default)"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 14 14)"
          />
        )}
        {/* Download arrow icon */}
        <path
          d="M14 7v8m0 0l-3-3m3 3l3-3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9 19h10"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
