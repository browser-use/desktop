import React, { useState, useEffect, useCallback } from 'react';
import { ConnectionsPane } from './ConnectionsPane';
import type { ActionId, KeyBinding } from './keybindings';
import { fallbackShortcutPlatform, keyboardEventToShortcut } from '../../shared/hotkeys';

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
    <div className="settings-pane__section">
      <span className="settings-pane__section-title">Application</span>
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

function CdpUrlSection(): React.ReactElement {
  const [url, setUrl] = useState('');
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [alwaysAllow, setAlwaysAllow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const api = (window as unknown as { electronAPI: { settings: { cdpUrl: {
    get: () => Promise<{ url: string | null; alwaysAllow: boolean }>;
    set: (url: string | null) => Promise<{ url: string | null; alwaysAllow: boolean }>;
    test: (url: string) => Promise<{ ok: boolean; error?: string }>;
    getAlwaysAllow: () => Promise<{ alwaysAllow: boolean }>;
    setAlwaysAllow: (value: boolean) => Promise<{ alwaysAllow: boolean }>;
  } } } }).electronAPI.settings.cdpUrl;

  useEffect(() => {
    let cancelled = false;
    api.get().then((state) => {
      if (cancelled) return;
      setSavedUrl(state.url);
      setUrl(state.url ?? '');
      setAlwaysAllow(state.alwaysAllow);
    }).catch(() => { if (!cancelled) setSavedUrl(null); });
    return () => { cancelled = true; };
  }, [api]);

  return (
    <div className="settings-pane__section">
      <span className="settings-pane__section-title">Browser</span>
      <p className="settings-pane__hint">
        Connect to an existing Chrome / Chromium via CDP WebSocket instead of launching a built-in browser.
        Leave empty to use the default embedded browser.
      </p>
      <div className="settings-pane__row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <input
          className="settings-pane__input"
          type="text"
          placeholder="ws://127.0.0.1:9222"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg-elevated)', color: 'inherit' }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="conn-card__btn"
            style={savedUrl ? { backgroundColor: 'var(--color-error)', color: '#fff', borderColor: 'var(--color-error)' } : {}}
            onClick={async () => {
              if (testing || saving) return;
              if (savedUrl) {
                // Disconnect
                setSaving(true);
                setTestResult(null);
                try {
                  const res = await api.set(null);
                  setSavedUrl(res.url);
                  setAlwaysAllow(res.alwaysAllow);
                  setTestResult({ ok: true, message: 'Disconnected — will use built-in browser.' });
                } catch (err) {
                  setTestResult({ ok: false, message: (err as Error).message ?? 'Failed to disconnect' });
                } finally {
                  setSaving(false);
                }
              } else {
                // Connect: test first, then save
                const trimmed = url.trim();
                if (!trimmed) return;
                setTesting(true);
                setTestResult(null);
                try {
                  const testRes = await api.test(trimmed);
                  if (!testRes.ok) {
                    setTestResult({ ok: false, message: testRes.error ?? 'Connection failed' });
                    return;
                  }
                  setTesting(false);
                  setSaving(true);
                  const saveRes = await api.set(trimmed);
                  setSavedUrl(saveRes.url);
                  setUrl(saveRes.url ?? '');
                  setAlwaysAllow(saveRes.alwaysAllow);
                  setTestResult({ ok: true, message: 'Connected — using external browser.' });
                } catch (err) {
                  setTestResult({ ok: false, message: (err as Error).message ?? 'Connection failed' });
                } finally {
                  setTesting(false);
                  setSaving(false);
                }
              }
            }}
            disabled={testing || saving || (!savedUrl && !url.trim())}
          >
            {testing ? 'Connecting…' : saving ? (savedUrl ? 'Disconnecting…' : 'Connecting…') : (savedUrl ? 'Disconnect' : 'Connect')}
          </button>
          {savedUrl && (
            <span className="settings-pane__sublabel" style={{ marginLeft: 8 }}>
              Active: {savedUrl}
            </span>
          )}
        </div>
        {testResult && (
          <div className="settings-pane__sublabel" style={{ color: testResult.ok ? 'var(--color-success)' : 'var(--color-error)' }}>
            {testResult.message}
          </div>
        )}
        {savedUrl && (
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 6, padding: '4px 0' }}
            title="Keep the browser connection alive across sessions so you only see the Allow dialog once."
          >
            <input
              type="checkbox"
              checked={alwaysAllow}
              disabled={saving}
              onChange={async (e) => {
                const next = e.target.checked;
                setAlwaysAllow(next);
                try {
                  await api.setAlwaysAllow(next);
                } catch (err) {
                  setAlwaysAllow(!next);
                }
              }}
            />
            <span className="settings-pane__sublabel">Keep browser connection alive across sessions</span>
          </label>
        )}
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
    <div className="settings-pane__section">
      <span className="settings-pane__section-title">Privacy</span>
      <p className="settings-pane__hint">
        Control what leaves your machine. No prompts, credentials, or file contents are ever collected.
      </p>

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

interface SettingsPaneProps {
  open: boolean;
  onClose: () => void;
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
      <span className="settings-pane__label">{kb.label}</span>
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

export function SettingsPane({ open, onClose, keybindings, overrides, onUpdateBinding, onResetBinding, onResetAll, formatShortcut }: SettingsPaneProps): React.ReactElement | null {
  if (!open) return null;
  const platform = window.electronAPI?.shell?.platform ?? fallbackShortcutPlatform();

  return (
    <div className="settings-pane__scrim" onClick={onClose}>
      <div className="settings-pane" onClick={(e) => e.stopPropagation()}>
        <div className="settings-pane__header">
          <span className="settings-pane__title">Settings</span>
          <button className="settings-pane__close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="settings-pane__body">
          <AppSection />
          <div className="settings-pane__section">
            <span className="settings-pane__section-title">Connections</span>
            <ConnectionsPane embedded />
          </div>
          <CdpUrlSection />
          <PrivacySection />
          <div className="settings-pane__section">
            <div className="settings-pane__section-header">
              <span className="settings-pane__section-title">Keybindings</span>
              {Object.keys(overrides).length > 0 && (
                <button className="settings-pane__reset-all" onClick={onResetAll}>Reset all</button>
              )}
            </div>
            <p className="settings-pane__hint">Click a binding to record a new key. Press Esc to cancel.</p>
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
        </div>
      </div>
    </div>
  );
}
