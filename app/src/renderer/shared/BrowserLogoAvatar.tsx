import React from 'react';
import { browserLogoForKey } from './browserLogos';
import './BrowserLogoAvatar.css';

interface BrowserLogoAvatarProps {
  browserKey?: string;
  fallbackLabel: string;
  className?: string;
}

function fallbackInitial(label: string): string {
  return (label.trim().charAt(0) || '?').toUpperCase();
}

export function BrowserLogoAvatar({ browserKey, fallbackLabel, className = '' }: BrowserLogoAvatarProps) {
  const logo = browserLogoForKey(browserKey);
  const classes = ['browser-logo-avatar', className].filter(Boolean).join(' ');

  return (
    <span className={classes} aria-hidden="true">
      {logo ? (
        <img src={logo} alt="" draggable={false} />
      ) : (
        <span className="browser-logo-avatar__fallback">{fallbackInitial(fallbackLabel)}</span>
      )}
    </span>
  );
}
