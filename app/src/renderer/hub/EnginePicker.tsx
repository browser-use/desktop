import React, { useCallback, useEffect, useRef, useState } from 'react';
import claudeLogoSrc from './claude-logo.svg?raw';
import openaiLogoDarkSrc from './openai-logo.svg?raw';
import openaiLogoLightSrc from './openai-logo-light.svg?raw';
import opencodeLogoDarkSrc from './opencode-logo-dark.svg?raw';
import opencodeLogoLightSrc from './opencode-logo-light.svg?raw';
import { BrowserCodeProviderSubmenu } from './BrowserCodeModelPicker';
import { useThemedAsset } from '../design/useThemedAsset';
import { pollInstalledStatus } from '../shared/installStatus';
import { closeAppPopup, openAnchoredAppPopup } from '../shared/appPopup';

export interface EngineInfo {
  id: string;
  displayName: string;
  binaryName: string;
}

export interface EngineStatus {
  id: string;
  displayName: string;
  installed: { installed: boolean; version?: string; error?: string };
  authed: { authed: boolean; error?: string };
}

export function EngineLogo({ id }: { id: string }): React.ReactElement {
  const openaiLogoSrc = useThemedAsset(openaiLogoDarkSrc, openaiLogoLightSrc);
  const opencodeLogoSrc = useThemedAsset(opencodeLogoDarkSrc, opencodeLogoLightSrc);
  if (id === 'claude-code') {
    return <span className="engine-logo" dangerouslySetInnerHTML={{ __html: claudeLogoSrc as string }} />;
  }
  if (id === 'codex') {
    return <span className="engine-logo" dangerouslySetInnerHTML={{ __html: openaiLogoSrc as string }} />;
  }
  if (id === 'browsercode') {
    return <span className="engine-logo" dangerouslySetInnerHTML={{ __html: opencodeLogoSrc as string }} />;
  }
  return (
    <span className="engine-logo">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </span>
  );
}

function ChevronIcon(): React.ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface EnginePickerProps {
  value: string;
  onChange: (engineId: string) => void;
  onOpenChange?: (open: boolean) => void;
}

async function fetchEngines(): Promise<EngineInfo[]> {
  return (await window.electronAPI?.sessions?.listEngines?.()) ?? [];
}

export function EnginePicker({ value, onChange, onOpenChange }: EnginePickerProps): React.ReactElement {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [statuses, setStatuses] = useState<Record<string, EngineStatus>>({});
  const [popupId, setPopupId] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const refreshStatus = useCallback(async (ids: string[]): Promise<EngineStatus[]> => {
    console.info('[EnginePicker] refreshStatus.request', { ids });
    const updates = await Promise.all(
      ids.map(async (id) => {
        try { return await window.electronAPI?.sessions?.engineStatus?.(id); }
        catch (err) {
          console.warn('[EnginePicker] refreshStatus.failed', { id, error: (err as Error).message });
          return null;
        }
      }),
    );
    const validUpdates = updates.filter((u): u is EngineStatus => Boolean(u));
    setStatuses((prev) => {
      const next = { ...prev };
      for (const u of validUpdates) next[u.id] = u;
      return next;
    });
    return validUpdates;
  }, []);

  const refreshEngines = useCallback(async (): Promise<void> => {
    try {
      const list = await fetchEngines();
      setEngines(list);
      if (list.length > 0) void refreshStatus(list.map((e) => e.id));
    } catch (err) {
      console.error('[EnginePicker] listEngines failed', err);
    }
  }, [refreshStatus]);

  useEffect(() => { void refreshEngines(); }, [refreshEngines]);

  const currentEngine = engines.find((e) => e.id === value) ?? engines[0];
  const currentStatus = currentEngine ? statuses[currentEngine.id] : undefined;
  const currentInstalled = currentStatus?.installed?.installed ?? true;
  const currentAuthed = currentStatus?.authed?.authed ?? true;

  const openMenu = useCallback(async () => {
    const button = buttonRef.current;
    if (!button) return;
    if (popupId) {
      closeAppPopup(popupId);
      return;
    }
    onOpenChange?.(true);
    const nextId = await openAnchoredAppPopup(
      button,
      {
        kind: 'engine-picker',
        value,
        placement: 'top-end',
        width: 266,
        maxHeight: 380,
      },
      {
        onAction: (action) => {
          if (action.kind === 'engine-select') onChange(action.engineId);
        },
        onClosed: () => {
          setPopupId(null);
          onOpenChange?.(false);
          void refreshEngines();
        },
      },
    );
    if (nextId) setPopupId(nextId);
    else onOpenChange?.(false);
  }, [onChange, onOpenChange, popupId, refreshEngines, value]);

  if (engines.length === 0) return <span className="engine-picker engine-picker--empty" />;

  return (
    <div className="engine-picker">
      <button
        ref={buttonRef}
        type="button"
        className="engine-picker__toggle"
        onClick={(e) => { e.stopPropagation(); void openMenu(); }}
        aria-haspopup="menu"
        aria-expanded={Boolean(popupId)}
        title={currentEngine ? `Engine: ${currentEngine.displayName}${!currentAuthed ? ' — not logged in' : ''}` : 'Pick engine'}
      >
        {currentEngine && <EngineLogo id={currentEngine.id} />}
        <span className="engine-picker__name">{currentEngine?.displayName ?? '…'}</span>
        {(!currentInstalled || !currentAuthed) && <span className="engine-picker__dot" aria-label="Needs setup" />}
        <ChevronIcon />
      </button>
    </div>
  );
}

interface EnginePickerMenuContentProps {
  value: string;
  onChange: (engineId: string) => void;
  onClose?: () => void;
}

export function EnginePickerMenuContent({
  value,
  onChange,
  onClose,
}: EnginePickerMenuContentProps): React.ReactElement {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [statuses, setStatuses] = useState<Record<string, EngineStatus>>({});
  const [loggingIn, setLoggingIn] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [drilledIntoBrowserCode, setDrilledIntoBrowserCode] = useState(false);
  const loggingInRef = useRef<string | null>(null);
  const installingRef = useRef<string | null>(null);

  const refreshStatus = useCallback(async (ids: string[]): Promise<EngineStatus[]> => {
    console.info('[EnginePicker] refreshStatus.request', { ids });
    const updates = await Promise.all(
      ids.map(async (id) => {
        try { return await window.electronAPI?.sessions?.engineStatus?.(id); }
        catch (err) {
          console.warn('[EnginePicker] refreshStatus.failed', { id, error: (err as Error).message });
          return null;
        }
      }),
    );
    console.info('[EnginePicker] refreshStatus.result', {
      updates: updates.filter(Boolean).map((u) => ({
        id: u?.id,
        installed: u?.installed?.installed,
        installedError: u?.installed?.error,
        authed: u?.authed?.authed,
        authError: u?.authed?.error,
      })),
    });
    const validUpdates = updates.filter((u): u is EngineStatus => Boolean(u));
    setStatuses((prev) => {
      const next = { ...prev };
      for (const u of validUpdates) next[u.id] = u;
      return next;
    });
    return validUpdates;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchEngines();
        if (cancelled) return;
        setEngines(list);
        if (list.length > 0) void refreshStatus(list.map((e) => e.id));
      } catch (err) { console.error('[EnginePicker] listEngines failed', err); }
    })();
    return () => { cancelled = true; };
  }, [refreshStatus]);

  useEffect(() => {
    if (engines.length === 0) return;
    void refreshStatus(engines.map((e) => e.id));
  }, [engines, refreshStatus]);

  useEffect(() => {
    if (!installing) return;
    if (statuses[installing]?.installed?.installed) {
      installingRef.current = null;
      setInstalling(null);
    }
  }, [installing, statuses]);

  useEffect(() => {
    if (!loggingIn) return;
    let cancelled = false;
    let attempts = 0;
    const tick = async (): Promise<void> => {
      if (cancelled) return;
      attempts++;
      const updates = await refreshStatus([loggingIn]);
      const st = updates.find((u) => u.id === loggingIn) ?? statuses[loggingIn];
      if (st?.authed?.authed || attempts >= 40) {
        loggingInRef.current = null;
        setLoggingIn(null);
        return;
      }
      setTimeout(() => { void tick(); }, 3000);
    };
    const id = setTimeout(() => { void tick(); }, 2000);
    return () => { cancelled = true; clearTimeout(id); };
    // statuses intentionally excluded; polling reads the latest refresh result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggingIn, refreshStatus]);

  const selectEngine = (id: string): void => {
    console.info('[EnginePicker] selectEngine', { id });
    onChange(id);
    onClose?.();
  };

  const onLoginClick = async (id: string): Promise<void> => {
    if (loggingInRef.current === id) return;
    console.info('[EnginePicker] login.request', { id });
    loggingInRef.current = id;
    setLoggingIn(id);
    try {
      const result = await window.electronAPI?.sessions?.engineLogin?.(id);
      console.info('[EnginePicker] login.result', { id, result });
      if (!result?.opened) {
        loggingInRef.current = null;
        setLoggingIn(null);
      }
    } catch (err) {
      console.error('[EnginePicker] engineLogin failed', err);
      loggingInRef.current = null;
      setLoggingIn(null);
    }
  };

  const openBrowserCodeSetup = async (): Promise<void> => {
    console.info('[EnginePicker] browsercode.setup.openSettings');
    onChange('browsercode');
    onClose?.();
    try {
      await window.electronAPI?.settings?.open?.();
    } catch (err) {
      console.error('[EnginePicker] browsercode.setup.openSettings.failed', err);
    }
  };

  const onInstallClick = async (id: string): Promise<void> => {
    if (installingRef.current === id) return;
    console.info('[EnginePicker] install.request', { id });
    installingRef.current = id;
    setInstalling(id);
    try {
      const result = await window.electronAPI?.sessions?.engineInstall?.(id);
      console.info('[EnginePicker] install.result', { id, result });
      if (result?.opened) {
        const status = await pollInstalledStatus(async () => {
          const updates = await refreshStatus([id]);
          const next = updates.find((u) => u.id === id);
          return next?.installed ?? null;
        }, { initialInstalled: result.installed });
        if (!status?.installed) console.warn('[EnginePicker] engineInstall failed', { id, result });
      } else {
        console.warn('[EnginePicker] engineInstall failed', { id, result });
        await refreshStatus([id]);
      }
    } catch (err) {
      console.error('[EnginePicker] engineInstall failed', err);
    } finally {
      installingRef.current = null;
      setInstalling((current) => (current === id ? null : current));
    }
  };

  const onItemClick = (id: string, installed: boolean, authed: boolean): void => {
    console.info('[EnginePicker] item.click', { id, installed, authed });
    if (installingRef.current === id || loggingInRef.current === id) return;
    if (!installed) {
      void onInstallClick(id);
      return;
    }
    if (id === 'browsercode' && !authed) {
      void openBrowserCodeSetup();
      return;
    }
    if (!authed) {
      void onLoginClick(id);
      return;
    }
    if (id === 'browsercode') {
      setDrilledIntoBrowserCode(true);
      return;
    }
    selectEngine(id);
  };

  if (drilledIntoBrowserCode) {
    return (
      <div className="engine-picker__menu" role="menu">
        <button
          type="button"
          className="engine-picker__back"
          onClick={() => setDrilledIntoBrowserCode(false)}
          role="menuitem"
        >
          <span className="engine-picker__chevron-left" aria-hidden="true">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M6 2.5L3.5 5L6 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <EngineLogo id="browsercode" />
          <span className="engine-picker__item-name">BrowserCode</span>
        </button>
        <BrowserCodeProviderSubmenu onSelected={() => {
          onChange('browsercode');
          setDrilledIntoBrowserCode(false);
          onClose?.();
        }} />
      </div>
    );
  }

  return (
    <div className="engine-picker__menu" role="menu">
      {engines.map((e) => {
        const st = statuses[e.id];
        const installed = st?.installed?.installed ?? true;
        const authed = st?.authed?.authed ?? true;
        const needsSetup = !installed || !authed;
        const actionPending = installing === e.id || loggingIn === e.id;
        const setupLabel = e.id === 'browsercode' ? 'Set up' : 'Log in';
        const installLabel = installing === e.id ? 'Installing…' : 'Install';
        const isBrowserCode = e.id === 'browsercode';
        return (
          <button
            key={e.id}
            type="button"
            className={`engine-picker__item${e.id === value ? ' engine-picker__item--active' : ''}${actionPending ? ' engine-picker__item--disabled' : ''}`}
            onClick={() => onItemClick(e.id, installed, authed)}
            disabled={actionPending}
            title={!installed ? st?.installed?.error ?? `Install ${e.displayName}` : !authed ? st?.authed?.error ?? 'Start setup' : `Use ${e.displayName}`}
            role="menuitem"
          >
            <EngineLogo id={e.id} />
            <span className="engine-picker__item-name">{e.displayName}</span>
            {e.id === value && !isBrowserCode && <span className="engine-picker__check">✓</span>}
            {needsSetup && installed && (
              <span className="engine-picker__item-login">
                {loggingIn === e.id ? 'Waiting…' : setupLabel}
              </span>
            )}
            {!installed && (
              <span className="engine-picker__item-login">{installLabel}</span>
            )}
            {isBrowserCode && installed && authed && (
              <span className="engine-picker__chevron-right" aria-hidden="true">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M4 2.5L6.5 5L4 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
