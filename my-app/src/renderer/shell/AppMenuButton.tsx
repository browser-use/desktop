/**
 * AppMenuButton: Chrome-style vertical ellipsis (⋮) menu button for non-macOS.
 * On click, triggers a native popup menu via IPC with all browser actions.
 * Hidden on macOS where the native menu bar serves the same purpose.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

declare const electronAPI: {
  shell: {
    getPlatform: () => Promise<string>;
  };
  menu: {
    showAppMenu: (bounds: { x: number; y: number }) => Promise<void>;
  };
};

export function AppMenuButton(): React.ReactElement | null {
  const [platform, setPlatform] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    electronAPI.shell.getPlatform().then((p) => {
      console.log('[AppMenuButton] Platform detected:', p);
      setPlatform(p);
    });
  }, []);

  const handleClick = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    console.log('[AppMenuButton] Opening app menu at', { x: rect.right, y: rect.bottom });
    electronAPI.menu.showAppMenu({
      x: rect.right - 200,
      y: rect.bottom + 4,
    });
  }, []);

  // Hide on macOS — the native menu bar handles everything
  if (platform === 'darwin') return null;
  // Don't render until platform is known to avoid flash
  if (platform === null) return null;

  return (
    <button
      ref={btnRef}
      type="button"
      className="app-menu-btn"
      aria-label="App menu"
      title="Customize and control"
      onClick={handleClick}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="3" r="1.25" fill="currentColor" />
        <circle cx="8" cy="8" r="1.25" fill="currentColor" />
        <circle cx="8" cy="13" r="1.25" fill="currentColor" />
      </svg>
    </button>
  );
}
