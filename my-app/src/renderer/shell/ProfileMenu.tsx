/**
 * ProfileMenu: Chrome-style avatar button + dropdown in the top-right toolbar.
 * Shows current profile, sign-in chip, profile list, and management actions.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

interface Profile {
  id: string;
  name: string;
  email: string | null;
  avatarColor: string;
  isActive: boolean;
}

const DEFAULT_PROFILE: Profile = {
  id: 'default',
  name: 'Default',
  email: null,
  avatarColor: '#5B8DEF',
  isActive: true,
};

const AVATAR_COLORS = [
  '#5B8DEF',
  '#EF6B6B',
  '#4ECB71',
  '#F0A030',
  '#B07CD8',
  '#E06090',
  '#40C0C0',
  '#8B8B8B',
];

function getInitial(name: string): string {
  return (name[0] ?? '?').toUpperCase();
}

export function ProfileMenu(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([DEFAULT_PROFILE]);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const activeProfile = profiles.find((p) => p.isActive) ?? profiles[0];

  const toggle = useCallback(() => {
    console.log('[ProfileMenu] Toggle dropdown, currently:', open ? 'open' : 'closed');
    setOpen((prev) => !prev);
  }, [open]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const menu = menuRef.current;
      const btn = btnRef.current;
      if (menu && !menu.contains(e.target as Node) && btn && !btn.contains(e.target as Node)) {
        console.log('[ProfileMenu] Outside click, closing');
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        console.log('[ProfileMenu] Escape pressed, closing');
        setOpen(false);
      }
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSwitchProfile = useCallback((id: string) => {
    console.log('[ProfileMenu] Switch to profile:', id);
    setProfiles((prev) =>
      prev.map((p) => ({ ...p, isActive: p.id === id })),
    );
    setOpen(false);
  }, []);

  const handleAddProfile = useCallback(() => {
    const newId = `profile-${Date.now()}`;
    const colorIndex = profiles.length % AVATAR_COLORS.length;
    const name = `Person ${profiles.length + 1}`;
    console.log('[ProfileMenu] Adding new profile:', name);
    setProfiles((prev) => [
      ...prev.map((p) => ({ ...p, isActive: false })),
      {
        id: newId,
        name,
        email: null,
        avatarColor: AVATAR_COLORS[colorIndex],
        isActive: true,
      },
    ]);
    setOpen(false);
  }, [profiles.length]);

  const handleOpenGuest = useCallback(() => {
    console.log('[ProfileMenu] Opening guest window');
    setOpen(false);
  }, []);

  const handleManageProfiles = useCallback(() => {
    console.log('[ProfileMenu] Opening profile manager');
    setOpen(false);
  }, []);

  const handleManageAccount = useCallback(() => {
    console.log('[ProfileMenu] Opening Google Account management');
    setOpen(false);
  }, []);

  return (
    <div className="profile-menu">
      <button
        ref={btnRef}
        type="button"
        className="profile-menu__avatar-btn"
        aria-label="Profile"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={toggle}
        title={activeProfile.name}
      >
        <span
          className="profile-menu__avatar"
          style={{ background: activeProfile.avatarColor }}
        >
          {getInitial(activeProfile.name)}
        </span>
      </button>

      {open && (
        <div
          ref={menuRef}
          className="profile-menu__dropdown"
          role="menu"
          aria-label="Profile menu"
        >
          {/* Current profile header */}
          <div className="profile-menu__current">
            <span
              className="profile-menu__current-avatar"
              style={{ background: activeProfile.avatarColor }}
            >
              {getInitial(activeProfile.name)}
            </span>
            <div className="profile-menu__current-info">
              <span className="profile-menu__current-name">
                {activeProfile.name}
              </span>
              {activeProfile.email ? (
                <span className="profile-menu__current-email">
                  {activeProfile.email}
                </span>
              ) : (
                <button
                  type="button"
                  className="profile-menu__sign-in-chip"
                  role="menuitem"
                  onClick={() => {
                    console.log('[ProfileMenu] Sign in clicked');
                    setOpen(false);
                  }}
                >
                  Sign in
                </button>
              )}
            </div>
          </div>

          {/* Manage Google Account link (only if signed in) */}
          {activeProfile.email && (
            <button
              type="button"
              className="profile-menu__manage-account"
              role="menuitem"
              onClick={handleManageAccount}
            >
              Manage your Google Account
            </button>
          )}

          <div className="profile-menu__divider" />

          {/* Profile list for quick switch */}
          {profiles.length > 1 && (
            <>
              <div className="profile-menu__section-label">Other profiles</div>
              {profiles
                .filter((p) => !p.isActive)
                .map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    className="profile-menu__item"
                    role="menuitem"
                    onClick={() => handleSwitchProfile(profile.id)}
                  >
                    <span
                      className="profile-menu__item-avatar"
                      style={{ background: profile.avatarColor }}
                    >
                      {getInitial(profile.name)}
                    </span>
                    <span className="profile-menu__item-name">
                      {profile.name}
                    </span>
                  </button>
                ))}
              <div className="profile-menu__divider" />
            </>
          )}

          {/* Add profile + Guest */}
          <button
            type="button"
            className="profile-menu__item"
            role="menuitem"
            onClick={handleAddProfile}
          >
            <span className="profile-menu__item-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 3v10M3 8h10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="profile-menu__item-name">Add</span>
          </button>

          <button
            type="button"
            className="profile-menu__item"
            role="menuitem"
            onClick={handleOpenGuest}
          >
            <span className="profile-menu__item-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle
                  cx="8"
                  cy="6"
                  r="2.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M3.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="profile-menu__item-name">Open Guest</span>
          </button>

          <div className="profile-menu__divider" />

          {/* Manage profiles */}
          <button
            type="button"
            className="profile-menu__item"
            role="menuitem"
            onClick={handleManageProfiles}
          >
            <span className="profile-menu__item-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 10a3 3 0 100-6 3 3 0 000 6z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.1 3.1l.7.7M12.2 12.2l.7.7M3.1 12.9l.7-.7M12.2 3.8l.7-.7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="profile-menu__item-name">Manage profiles</span>
          </button>
        </div>
      )}
    </div>
  );
}
