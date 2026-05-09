import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ConnectionsPane, type SettingsProviderFocusRequest } from './ConnectionsPane';
import type { ActionId, KeyBinding } from './keybindings';
import { fallbackShortcutPlatform, keyboardEventToShortcut } from '../../shared/hotkeys';
import { useThemeMode } from '../design/useThemeMode';
import type { ThemeMode } from '../design/themeMode';

/**
 * Generic settings primitives. Add a new option type and every section that
 * uses it (Appearance, future Density / Accent / etc.) gets the same UI.
 */
interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface SettingsRowProps {
  label: string;
  sublabel?: string;
  children: React.ReactNode;
}

function SettingsRow({ label, sublabel, children }: SettingsRowProps): React.ReactElement {
  return (
    <div className="settings-pane__row">
      <div>
        <div className="settings-pane__label">{label}</div>
        {sublabel && <div className="settings-pane__sublabel">{sublabel}</div>}
      </div>
      {children}
    </div>
  );
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
}

function SegmentedControl<T extends string>({ value, options, onChange, ariaLabel }: SegmentedControlProps<T>): React.ReactElement {
  // Plain toggle-button group with aria-pressed, not role="radio". The radio
  // pattern requires roving tabindex + arrow-key nav; for a 3-option theme
  // picker that's overkill and a partial implementation is worse than none.
  return (
    <div className="settings-pane__segmented" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          className={`settings-pane__segment${value === opt.value ? ' settings-pane__segment--active' : ''}`}
          title={opt.hint}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const APPEARANCE_OPTIONS: ReadonlyArray<SegmentedOption<ThemeMode>> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System', hint: 'Follow your operating system' },
];

function AppearanceSection(): React.ReactElement {
  const { mode, setMode, resolved } = useThemeMode();
  return (
    <div className="settings-card">
      <SettingsRow
        label="Theme"
        sublabel={
          mode === 'system'
            ? `Following your system (${resolved}).`
            : 'Choose how Browser Use looks across windows.'
        }
      >
        <SegmentedControl
          value={mode}
          options={APPEARANCE_OPTIONS}
          onChange={setMode}
          ariaLabel="Theme"
        />
      </SettingsRow>
    </div>
  );
}

type ElectronPrivacyAPI = {
  get: () => Promise<{ telemetry: boolean; telemetryUpdatedAt: string | null; version: number }>;
  setTelemetry: (optedIn: boolean) => Promise<{ telemetry: boolean; telemetryUpdatedAt: string | null; version: number }>;
  openSystemNotifications: () => Promise<{ ok: boolean; error?: string }>;
};

type ElectronAppAPI = {
  getUpdateStatus: () => Promise<UpdateStatusEvent>;
  getInfo: () => Promise<{
    version: string;
    latestVersion: string | null;
    isLatestVersion: boolean | null;
    platform: string;
    packaged: boolean;
    updateSupported: boolean;
    canDownloadUpdate: boolean;
    updateFeedUrl: string;
  }>;
  downloadLatest: () => Promise<{
    ok: boolean;
    action: 'started-update-check' | 'unavailable';
    message: string;
  }>;
  installUpdate: () => Promise<{
    ok: boolean;
    action: 'install-started' | 'not-ready';
    message: string;
  }>;
  onUpdateStatus: (cb: (event: UpdateStatusEvent) => void) => () => void;
};

type UpdateStatusEvent = {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error' | 'unavailable';
  version?: string;
  message?: string;
  error?: string;
  progress?: {
    percent: number | null;
    transferred: number | null;
    total: number | null;
    bytesPerSecond: number | null;
  };
};

function AppSection(): React.ReactElement {
  const [info, setInfo] = useState<Awaited<ReturnType<ElectronAppAPI['getInfo']>> | null>(null);
  const [updateStatusEvent, setUpdateStatusEvent] = useState<UpdateStatusEvent>({ status: 'idle' });
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const api = window.electronAPI?.settings?.app;
  const onLatest = info?.isLatestVersion === true;
  const canDownloadUpdate = info?.canDownloadUpdate === true;
  const updateReady = updateStatusEvent.status === 'ready';
  const updateBusy = updateStatusEvent.status === 'checking' || updateStatusEvent.status === 'downloading';
  const updateActionDisabled = !api || !info || installing || (
    !updateReady && (checking || updateBusy || onLatest || !canDownloadUpdate)
  );
  const downloadProgress = updateStatusEvent.progress?.percent;
  const progressWidth = typeof downloadProgress === 'number'
    ? `${Math.max(2, Math.min(100, downloadProgress))}%`
    : updateStatusEvent.status === 'downloading'
      ? '18%'
      : '0%';
  const updateStatus = updateStatusEvent.message ?? (
    !info
      ? 'Checking latest version...'
      : updateReady
        ? 'Update is ready to install.'
        : updateBusy
          ? 'Checking for updates...'
          : onLatest
            ? 'You are on the latest version.'
            : info.latestVersion
              ? `Latest version is ${info.latestVersion}.`
              : canDownloadUpdate
                ? 'Checks on startup and every hour.'
                : 'In-app updates are available in packaged release builds.'
  );
  const buttonLabel = !info || checking
    ? 'Checking...'
    : installing
      ? 'Restarting...'
      : updateReady
        ? 'Restart to install'
        : onLatest
          ? 'On latest'
          : canDownloadUpdate
            ? 'Download update'
            : 'Unavailable';

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api?.getInfo() ?? Promise.resolve(null),
      api?.getUpdateStatus() ?? Promise.resolve<UpdateStatusEvent>({ status: 'idle' }),
    ])
      .then(([nextInfo, nextStatus]) => {
        if (cancelled) return;
        setInfo(nextInfo);
        setUpdateStatusEvent(nextStatus);
      })
      .catch(() => {
        if (cancelled) return;
        setInfo(null);
        setUpdateStatusEvent({ status: 'error', message: 'Could not read update status.' });
      });

    const unsubscribe = api?.onUpdateStatus((nextStatus) => {
      setUpdateStatusEvent(nextStatus);
      if (nextStatus.status !== 'ready') setInstalling(false);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [api]);

  const handleDownloadLatest = useCallback(async () => {
    if (!api || checking || installing || onLatest || updateBusy || updateReady || !canDownloadUpdate) return;
    setChecking(true);
    setUpdateStatusEvent({ status: 'checking', message: 'Checking for updates...' });
    try {
      const result = await api.downloadLatest();
      setUpdateStatusEvent((current) => (
        current.status === 'checking' ? { status: result.ok ? 'checking' : 'unavailable', message: result.message } : current
      ));
      const next = await api.getInfo();
      setInfo(next);
    } catch {
      setUpdateStatusEvent({ status: 'error', message: 'Could not start the in-app update check. Please try again later.' });
    } finally {
      setChecking(false);
    }
  }, [api, canDownloadUpdate, checking, installing, onLatest, updateBusy, updateReady]);

  const handleInstallUpdate = useCallback(async () => {
    if (!api || installing || !updateReady) return;
    setInstalling(true);
    try {
      const result = await api.installUpdate();
      setUpdateStatusEvent((current) => ({
        ...current,
        message: result.message,
      }));
      if (!result.ok) setInstalling(false);
    } catch {
      setUpdateStatusEvent({ status: 'error', message: 'Could not restart to install the update.' });
      setInstalling(false);
    }
  }, [api, installing, updateReady]);

  const handleUpdateClick = updateReady ? handleInstallUpdate : handleDownloadLatest;

  return (
    <div className="settings-card">
      <div className="settings-pane__row">
        <div>
          <div className="settings-pane__label">Version</div>
          <div className="settings-pane__sublabel">
            {info ? `Browser Use ${info.version}` : 'Detecting version...'}
          </div>
        </div>
        {info && <span className="settings-pane__value">v{info.version}</span>}
      </div>
      <div className="settings-pane__row">
        <div>
          <div className="settings-pane__label">Updates</div>
          <div className="settings-pane__sublabel">
            {updateStatus}
          </div>
          {(updateStatusEvent.status === 'downloading' || updateStatusEvent.status === 'ready') && (
            <div className="settings-pane__progress" aria-hidden="true">
              <span
                className="settings-pane__progress-fill"
                style={{ width: updateStatusEvent.status === 'ready' ? '100%' : progressWidth }}
              />
            </div>
          )}
        </div>
        <button
          className="conn-card__btn conn-card__btn--secondary"
          onClick={handleUpdateClick}
          disabled={updateActionDisabled}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

type TabsPosition = 'side' | 'top';

function readTabsPosition(): TabsPosition {
  try {
    return window.localStorage.getItem('hub-tabs-position') === 'top' ? 'top' : 'side';
  } catch {
    return 'side';
  }
}

function LayoutSection(): React.ReactElement {
  const [position, setPosition] = useState<TabsPosition>(readTabsPosition);

  const choose = useCallback((next: TabsPosition) => {
    setPosition(next);
    try { window.localStorage.setItem('hub-tabs-position', next); } catch { /* ignore */ }
    // HubApp listens for this and dispatches pane:layout-change AFTER React
    // commits the new DOM, so AgentPane re-measures the correct bounds.
    window.dispatchEvent(new CustomEvent('hub:tabs-position-change', { detail: { position: next } }));
  }, []);

  return (
    <div className="settings-card layout-section">
      <div className="layout-section__header">
        <div className="settings-pane__label">Tab layout</div>
        <div className="settings-pane__sublabel">
          Pick where the agent session tabs live. Top reclaims sidebar width for the browser viewport.
        </div>
      </div>
      <div className="layout-picker" role="radiogroup" aria-label="Tab layout">
        <button
          type="button"
          role="radio"
          aria-checked={position === 'side'}
          className={`layout-picker__card${position === 'side' ? ' layout-picker__card--selected' : ''}`}
          onClick={() => choose('side')}
        >
          <div className="layout-picker__mockup layout-picker__mockup--side" aria-hidden="true">
            <div className="layout-picker__mockup-header" />
            <div className="layout-picker__mockup-tabs">
              <span className="layout-picker__mockup-row layout-picker__mockup-row--active" />
              <span className="layout-picker__mockup-row" />
              <span className="layout-picker__mockup-row" />
              <span className="layout-picker__mockup-row" />
            </div>
            <div className="layout-picker__mockup-viewport" />
          </div>
          <div className="layout-picker__label">Side</div>
          <div className="layout-picker__desc">Vertical sidebar on the left. Roomy session labels.</div>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={position === 'top'}
          className={`layout-picker__card${position === 'top' ? ' layout-picker__card--selected' : ''}`}
          onClick={() => choose('top')}
        >
          <div className="layout-picker__mockup layout-picker__mockup--top" aria-hidden="true">
            <div className="layout-picker__mockup-header" />
            <div className="layout-picker__mockup-tabs">
              <span className="layout-picker__mockup-chip layout-picker__mockup-chip--active" />
              <span className="layout-picker__mockup-chip" />
              <span className="layout-picker__mockup-chip" />
              <span className="layout-picker__mockup-chip" />
            </div>
            <div className="layout-picker__mockup-viewport" />
          </div>
          <div className="layout-picker__label">Top</div>
          <div className="layout-picker__desc">Horizontal terminal-style strip. Wider browser viewport.</div>
        </button>
      </div>
    </div>
  );
}

function PrivacySection(): React.ReactElement {
  const [telemetry, setTelemetry] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const api = (window as unknown as { electronAPI: { settings: { privacy: ElectronPrivacyAPI } } }).electronAPI.settings.privacy;

  useEffect(() => {
    let cancelled = false;
    api.get().then((state) => {
      if (!cancelled) setTelemetry(state.telemetry);
    }).catch(() => { if (!cancelled) setTelemetry(false); });
    return () => { cancelled = true; };
  }, [api]);

  const handleToggle = useCallback(async () => {
    if (telemetry === null || saving) return;
    const next = !telemetry;
    setSaving(true);
    setTelemetry(next); // optimistic
    try {
      const res = await api.setTelemetry(next);
      setTelemetry(res.telemetry);
    } catch {
      setTelemetry(!next); // revert
    } finally {
      setSaving(false);
    }
  }, [telemetry, saving, api]);

  return (
    <div className="settings-card">
      <div className="settings-pane__row">
        <div>
          <div className="settings-pane__label">Allow telemetry to help us make this app better</div>
          <div className="settings-pane__sublabel">Anonymous only — app version, OS, feature usage, and crash reports.</div>
        </div>
        <button
          className="settings-pane__toggle"
          role="switch"
          aria-checked={telemetry === true}
          data-on={telemetry === true}
          onClick={handleToggle}
          disabled={telemetry === null || saving}
        >
          <span className="settings-pane__toggle-thumb" />
        </button>
      </div>

      <div className="settings-pane__row">
        <div>
          <div className="settings-pane__label">System notifications</div>
          <div className="settings-pane__sublabel">Managed by your operating system.</div>
        </div>
        <button
          className="conn-card__btn conn-card__btn--secondary"
          onClick={() => { void api.openSystemNotifications(); }}
        >
          Open system settings
        </button>
      </div>
    </div>
  );
}

export type SettingsSectionId =
  | 'settings-model-providers'
  | 'settings-connections'
  | 'settings-browser-sync'
  | 'settings-shortcuts'
  | 'settings-privacy'
  | 'settings-appearance'
  | 'settings-application';

export interface SettingsOpenIntent {
  requestId: number;
  sectionId?: SettingsSectionId;
  focusBrowserCodeProvider?: string;
}

const SETTINGS_TABS: Array<{ id: SettingsSectionId; label: string }> = [
  { id: 'settings-application', label: 'Application' },
  { id: 'settings-appearance', label: 'Appearance' },
  { id: 'settings-model-providers', label: 'Model providers' },
  { id: 'settings-connections', label: 'Connections' },
  { id: 'settings-browser-sync', label: 'Browser Sync' },
  { id: 'settings-shortcuts', label: 'Shortcuts' },
  { id: 'settings-privacy', label: 'Privacy' },
];

interface SettingsPaneProps {
  intent?: SettingsOpenIntent | null;
  keybindings: KeyBinding[];
  overrides: Record<string, string[]>;
  onUpdateBinding: (id: ActionId, keys: string[]) => Promise<boolean>;
  onResetBinding: (id: ActionId) => void;
  onResetAll: () => void;
  formatShortcut: (shortcut: string) => string;
}

interface KeybindRowProps {
  kb: KeyBinding;
  isOverridden: boolean;
  onUpdate: (id: ActionId, keys: string[]) => Promise<boolean>;
  onReset: (id: ActionId) => void;
  platform: string;
  formatShortcut: (shortcut: string) => string;
}

function KeybindRow({ kb, isOverridden, onUpdate, onReset, platform, formatShortcut }: KeybindRowProps): React.ReactElement {
  const [recording, setRecording] = useState(false);
  const [firstKey, setFirstKey] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const isGlobalShortcut = kb.id === 'action.createPane';

  const finishRecording = useCallback(async (keys: string[]) => {
    setRecording(false);
    setFirstKey(null);
    (document.activeElement as HTMLElement | null)?.blur?.();
    const ok = await onUpdate(kb.id, keys);
    setRecordingError(ok ? null : 'That shortcut is unavailable. Choose another one.');
  }, [kb.id, onUpdate]);

  useEffect(() => {
    if (!recording) return;
    const timer = setTimeout(() => {
      if (firstKey) {
        void finishRecording([firstKey]);
      } else {
        setRecording(false);
        setRecordingError('No shortcut was detected. Choose another combination.');
      }
    }, firstKey ? 700 : 8000);

    const handler = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecording(false);
        setFirstKey(null);
        setRecordingError(null);
        return;
      }

      if (e.key === 'Unidentified') {
        clearTimeout(timer);
        setRecording(false);
        setFirstKey(null);
        setRecordingError('That shortcut is unavailable. Choose another one.');
        return;
      }

      const combo = keyboardEventToShortcut(e, platform);
      if (!combo) return;

      if (isGlobalShortcut && !e.metaKey && !e.ctrlKey && !e.altKey) return;

      if (firstKey) {
        clearTimeout(timer);
        await finishRecording([`${firstKey} ${combo}`]);
        return;
      }

      // If modifier present, commit immediately. Else wait briefly for possible chord.
      if (e.metaKey || e.ctrlKey || e.altKey) {
        clearTimeout(timer);
        await finishRecording([combo]);
        return;
      }

      setRecordingError(null);
      setFirstKey(combo);
    };
    window.addEventListener('keydown', handler, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handler, true);
    };
  }, [finishRecording, firstKey, isGlobalShortcut, platform, recording]);

  return (
    <div className={`settings-pane__row${isOverridden ? ' settings-pane__row--modified' : ''}`}>
      <div className="settings-pane__label-block">
        <span className="settings-pane__label">{kb.label}</span>
        <span className="settings-pane__sublabel">{kb.category}</span>
      </div>
      <div className="settings-pane__row-right">
        <button
          className={`settings-pane__key-btn${recording ? ' settings-pane__key-btn--recording' : ''}`}
          onClick={() => {
            setRecordingError(null);
            setRecording(true);
            setFirstKey(null);
          }}
        >
          {recording ? (
            <span className="settings-pane__recording">
              {firstKey ? `${formatShortcut(firstKey)} + ...` : 'Press key...'}
            </span>
          ) : (
            kb.keys.map((k, i) => (
              <kbd key={i} className="settings-pane__kbd">{formatShortcut(k)}</kbd>
            ))
          )}
        </button>
        <button
          className="settings-pane__reset-btn"
          onClick={() => onReset(kb.id)}
          title="Reset to default"
          style={{ visibility: isOverridden && !recording ? 'visible' : 'hidden' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 4.5h4a3 3 0 010 6h-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4.5 2.5L2.5 4.5 4.5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {recordingError && <span className="settings-pane__key-error">{recordingError}</span>}
    </div>
  );
}

export function SettingsPane({ intent, keybindings, overrides, onUpdateBinding, onResetBinding, onResetAll, formatShortcut }: SettingsPaneProps): React.ReactElement {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('settings-application');
  const platform = window.electronAPI?.shell?.platform ?? fallbackShortcutPlatform();
  // Cookie sync is unsupported on Windows (Chromium ABE + DevTools hardening),
  // so the Browser Sync tab + section are hidden on win32.
  const tabs = platform === 'win32'
    ? SETTINGS_TABS.filter((tab) => tab.id !== 'settings-browser-sync')
    : SETTINGS_TABS;

  const scrollToSection = useCallback((id: SettingsSectionId, behavior: ScrollBehavior = 'smooth') => {
    const scroller = scrollerRef.current;
    const target = scroller?.querySelector<HTMLElement>(`#${id}`);
    if (!scroller || !target) return;
    const tabOffset = 96;
    scroller.scrollTo({
      top: Math.max(0, target.offsetTop - tabOffset),
      behavior,
    });
    setActiveSection(id);
  }, []);

  const updateActiveFromScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let next = tabs[0].id;
    const threshold = scroller.scrollTop + 112;
    for (const tab of tabs) {
      const section = scroller.querySelector<HTMLElement>(`#${tab.id}`);
      if (section && section.offsetTop <= threshold) next = tab.id;
    }
    setActiveSection(next);
  }, [tabs]);

  useEffect(() => {
    const sectionId = intent?.sectionId ?? (
      intent?.focusBrowserCodeProvider ? 'settings-model-providers' : undefined
    );
    if (!sectionId) return;
    requestAnimationFrame(() => scrollToSection(sectionId, 'auto'));
  }, [intent?.requestId, intent?.sectionId, intent?.focusBrowserCodeProvider, scrollToSection]);

  const providerFocus: SettingsProviderFocusRequest | null = intent?.focusBrowserCodeProvider
    ? { providerId: intent.focusBrowserCodeProvider, requestId: intent.requestId }
    : null;

  return (
    <div className="settings-page">
      <div className="settings-page__scroller" ref={scrollerRef} onScroll={updateActiveFromScroll}>
        <div className="settings-page__content">
          <header className="settings-page__header">
            <div>
              <span className="settings-page__eyebrow">Browser Use</span>
              <h1 className="settings-page__title">Settings</h1>
            </div>
          </header>

          <nav className="settings-page__tabs" aria-label="Settings sections">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`settings-page__tab${activeSection === tab.id ? ' settings-page__tab--active' : ''}`}
                onClick={() => scrollToSection(tab.id)}
                data-settings-tab={tab.id}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <section id="settings-application" className="settings-page__section">
            <div className="settings-section-header">
              <h2 className="settings-section-header__title">Application</h2>
            </div>
            <AppSection />
            <LayoutSection />
          </section>

          <section id="settings-appearance" className="settings-page__section">
            <div className="settings-section-header">
              <h2 className="settings-section-header__title">Appearance</h2>
            </div>
            <AppearanceSection />
          </section>

          <ConnectionsPane
            embedded
            providerSectionId="settings-model-providers"
            connectionsSectionId="settings-connections"
            browserSyncSectionId="settings-browser-sync"
            focusBrowserCodeProvider={providerFocus}
          />

          <section id="settings-shortcuts" className="settings-page__section">
            <div className="settings-section-header">
              <h2 className="settings-section-header__title">Shortcuts</h2>
              {Object.keys(overrides).length > 0 && (
                <button className="settings-pane__reset-all" onClick={onResetAll}>Reset all</button>
              )}
            </div>
            <div className="settings-card settings-card--shortcuts">
              {keybindings.map((kb) => (
                <KeybindRow
                  key={kb.id}
                  kb={kb}
                  isOverridden={kb.id in overrides}
                  onUpdate={onUpdateBinding}
                  onReset={onResetBinding}
                  platform={platform}
                  formatShortcut={formatShortcut}
                />
              ))}
            </div>
          </section>

          <section id="settings-privacy" className="settings-page__section settings-page__section--last">
            <div className="settings-section-header">
              <h2 className="settings-section-header__title">Privacy</h2>
            </div>
            <PrivacySection />
          </section>
        </div>
      </div>
    </div>
  );
}
