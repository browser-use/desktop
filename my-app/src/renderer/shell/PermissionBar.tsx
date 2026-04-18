/**
 * PermissionBar — Chrome-parity infobar anchored below the toolbar.
 *
 * Shows when a site requests a permission (camera, mic, geolocation, etc.).
 * Three actions: Allow (permanent), Allow this time (session grant), Never (deny).
 * Slides in/out with a CSS transition.
 */

import React, { useCallback, useEffect, useState } from 'react';

// -------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------

const PERMISSION_LABELS: Record<string, string> = {
  camera: 'use your camera',
  microphone: 'use your microphone',
  geolocation: 'know your location',
  notifications: 'show notifications',
  midi: 'use your MIDI devices',
  'clipboard-read': 'read your clipboard',
  sensors: 'use motion sensors',
  'idle-detection': 'know when you\'re idle',
  openExternal: 'open external applications',
  unknown: 'use a feature',
};

const PERMISSION_ICONS: Record<string, string> = {
  camera: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
  microphone: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z',
  geolocation: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z',
  notifications: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
};

interface PermissionPromptData {
  id: string;
  tabId: string | null;
  origin: string;
  permissionType: string;
  isMainFrame: boolean;
}

declare const electronAPI: {
  permissions: {
    respond: (promptId: string, decision: string) => Promise<void>;
    dismiss: (promptId: string) => Promise<void>;
  };
  on: {
    permissionPrompt: (cb: (data: PermissionPromptData) => void) => () => void;
    permissionPromptDismiss: (cb: (promptId: string) => void) => () => void;
  };
};

interface PermissionBarProps {
  activeTabId: string | null;
}

export function PermissionBar({ activeTabId }: PermissionBarProps): React.ReactElement | null {
  const [prompts, setPrompts] = useState<PermissionPromptData[]>([]);

  useEffect(() => {
    const unsubPrompt = electronAPI.on.permissionPrompt((data) => {
      console.log('[PermissionBar] Received prompt:', data.id, data.origin, data.permissionType);
      setPrompts((prev) => {
        if (prev.some((p) => p.id === data.id)) return prev;
        return [...prev, data];
      });
    });

    const unsubDismiss = electronAPI.on.permissionPromptDismiss((promptId) => {
      console.log('[PermissionBar] Dismissed:', promptId);
      setPrompts((prev) => prev.filter((p) => p.id !== promptId));
    });

    return () => {
      unsubPrompt();
      unsubDismiss();
    };
  }, []);

  // Only show prompts for the active tab
  const visiblePrompts = prompts.filter((p) => p.tabId === activeTabId);
  const current = visiblePrompts[0] ?? null;

  const handleDecision = useCallback((promptId: string, decision: string) => {
    console.log('[PermissionBar] User decision:', promptId, decision);
    electronAPI.permissions.respond(promptId, decision);
    setPrompts((prev) => prev.filter((p) => p.id !== promptId));
  }, []);

  const handleDismiss = useCallback((promptId: string) => {
    console.log('[PermissionBar] User dismissed:', promptId);
    electronAPI.permissions.dismiss(promptId);
    setPrompts((prev) => prev.filter((p) => p.id !== promptId));
  }, []);

  if (!current) return null;

  const label = PERMISSION_LABELS[current.permissionType] ?? PERMISSION_LABELS.unknown;
  const iconPath = PERMISSION_ICONS[current.permissionType];
  let displayOrigin = current.origin;
  try {
    displayOrigin = new URL(current.origin).hostname;
  } catch { /* use raw origin */ }

  return (
    <div
      className="permission-bar"
      role="alertdialog"
      aria-label={`${displayOrigin} wants to ${label}`}
    >
      <div className="permission-bar__content">
        {/* Permission icon */}
        {iconPath && (
          <svg
            className="permission-bar__icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {iconPath.split(' M').map((segment, i) => (
              <path key={i} d={i === 0 ? segment : `M${segment}`} />
            ))}
          </svg>
        )}

        <span className="permission-bar__message">
          <strong>{displayOrigin}</strong> wants to {label}
        </span>
      </div>

      <div className="permission-bar__actions">
        <button
          type="button"
          className="permission-bar__btn permission-bar__btn--secondary"
          onClick={() => handleDecision(current.id, 'deny')}
        >
          Never
        </button>
        <button
          type="button"
          className="permission-bar__btn permission-bar__btn--secondary"
          onClick={() => handleDecision(current.id, 'allow-once')}
        >
          Allow this time
        </button>
        <button
          type="button"
          className="permission-bar__btn permission-bar__btn--primary"
          onClick={() => handleDecision(current.id, 'allow')}
        >
          Allow
        </button>
        <button
          type="button"
          className="permission-bar__dismiss"
          onClick={() => handleDismiss(current.id)}
          aria-label="Dismiss permission prompt"
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
    </div>
  );
}
