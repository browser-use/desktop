import React, { useCallback, useEffect, useRef, useState } from 'react';
import claudeLogoSrc from './claude-logo.svg?raw';
import openaiLogoSrc from './openai-logo.svg?raw';
import cursorLogoSrc from './cursor-logo.svg?raw';
import opencodeLogoSrc from './opencode-logo-dark.svg?raw';
import { BrowserCodeProviderSubmenu } from './BrowserCodeModelPicker';
import { pollInstalledStatus } from '../shared/installStatus';

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

export interface EngineModelInfo {
  id: string;
  displayName: string;
  description?: string;
  source: string;
  isDefault?: boolean;
  isCurrent?: boolean;
  hidden?: boolean;
  supportedReasoningEfforts?: string[];
}

export interface EngineModelList {
  engineId: string;
  models: EngineModelInfo[];
  source: string;
  error?: string;
  cached?: boolean;
  cachedAt?: number;
  expiresAt?: number;
}

interface ModelLoadState {
  loading: boolean;
  response?: EngineModelList;
  error?: string;
}

type MenuView = 'providers' | 'models';

function EngineLogo({ id }: { id: string }): React.ReactElement {
  if (id === 'claude-code') {
    return <span className="engine-logo" dangerouslySetInnerHTML={{ __html: claudeLogoSrc as string }} />;
  }
  if (id === 'codex') {
    return <span className="engine-logo" dangerouslySetInnerHTML={{ __html: openaiLogoSrc as string }} />;
  }
  if (id === 'cursor-agent') {
    return <span className="engine-logo" dangerouslySetInnerHTML={{ __html: cursorLogoSrc as string }} />;
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

function RefreshIcon(): React.ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M10 5.2A4 4 0 1 0 8.7 8.1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M10 2.5v2.7H7.3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BackIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ForwardIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface EnginePickerProps {
  value: string;
  onChange: (engineId: string) => void;
  model?: string;
  modelByEngine?: Record<string, string | undefined>;
  onModelChange?: (modelId: string | undefined, engineId: string) => void;
  labelMode?: 'engine-model' | 'model';
  /** Fires when the dropdown opens/closes. Used by hosts (e.g. the pill
   *  renderer) that need to grow their window so the menu isn't clipped.
   *  The menu's pixel height is the exported MENU_HEIGHT constant — hosts
   *  that auto-size can rely on it being fixed. */
  onOpenChange?: (open: boolean) => void;
}

/** Fixed height of the dropdown menu (in CSS px). Exported so hosts that
 *  auto-size their window (the pill) can compute the height they need to
 *  reserve for the menu. Keep in sync with `.engine-picker__menu` in hub.css. */
export const ENGINE_PICKER_MENU_HEIGHT = 200;

export function EnginePicker({
  value,
  onChange,
  model,
  modelByEngine,
  onModelChange,
  labelMode = 'engine-model',
  onOpenChange,
}: EnginePickerProps): React.ReactElement {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [statuses, setStatuses] = useState<Record<string, EngineStatus>>({});
  const [modelLists, setModelLists] = useState<Record<string, ModelLoadState>>({});
  const [open, setOpen] = useState(false);
  const [menuView, setMenuView] = useState<MenuView>('providers');
  const [modelViewEngineId, setModelViewEngineId] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [loggingIn, setLoggingIn] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [browserCodeFlyoutOpen, setBrowserCodeFlyoutOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const loggingInRef = useRef<string | null>(null);
  const installingRef = useRef<string | null>(null);
  const [direction, setDirection] = useState<'up' | 'down'>('up');

  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);

  // Pick open direction based on available space above the toggle. The menu
  // has a fixed height (ENGINE_PICKER_MENU_HEIGHT) — if there isn't enough
  // upward room, open downward. Hosts that auto-size (the pill) will grow
  // their window to make the downward room.
  useEffect(() => {
    if (!open) return;
    const btn = toggleRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setDirection(r.top >= ENGINE_PICKER_MENU_HEIGHT ? 'up' : 'down');
  }, [open]);

  useEffect(() => {
    if (!open) {
      setMenuView('providers');
      setModelViewEngineId(null);
      setModelSearch('');
    }
  }, [open]);

  const refreshStatus = useCallback(async (ids: string[]): Promise<EngineStatus[]> => {
    const updates = await Promise.all(
      ids.map(async (id) => {
        try { return await window.electronAPI?.sessions?.engineStatus?.(id); }
        catch { return null; }
      }),
    );
    setStatuses((prev) => {
      const next = { ...prev };
      for (const u of updates) if (u) next[u.id] = u;
      return next;
    });
    return updates.filter((u): u is EngineStatus => Boolean(u));
  }, []);

  const refreshModels = useCallback(async (engineId: string, force = false) => {
    if (!onModelChange) return;
    const existing = modelLists[engineId];
    const isFresh = Boolean(existing?.response && (!existing.response.expiresAt || Date.now() < existing.response.expiresAt));
    if (!force && (existing?.loading || isFresh)) return;
    setModelLists((prev) => ({
      ...prev,
      [engineId]: { ...prev[engineId], loading: true, error: undefined },
    }));
    try {
      const response = await window.electronAPI?.sessions?.listEngineModels?.(engineId, { forceRefresh: force });
      setModelLists((prev) => ({
        ...prev,
        [engineId]: {
          loading: false,
          response: response ?? { engineId, models: [], source: 'static', error: 'Model listing unavailable' },
          error: response?.error,
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list models';
      setModelLists((prev) => ({
        ...prev,
        [engineId]: {
          loading: false,
          response: { engineId, models: [], source: 'static', error: message },
          error: message,
        },
      }));
    }
  }, [modelLists, onModelChange]);

  // Mount: fetch engine list + initial statuses.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = (await window.electronAPI?.sessions?.listEngines?.()) ?? [];
        if (cancelled) return;
        setEngines(list);
        if (list.length > 0) void refreshStatus(list.map((e) => e.id));
      } catch (err) { console.error('[EnginePicker] listEngines failed', err); }
    })();
    return () => { cancelled = true; };
  }, [refreshStatus]);

  // Re-probe auth whenever the menu opens so a just-completed login flow is
  // reflected without needing to re-mount the component.
  useEffect(() => {
    if (!open) return;
    if (engines.length === 0) return;
    void refreshStatus(engines.map((e) => e.id));
  }, [open, engines, refreshStatus]);

  useEffect(() => {
    if (!installing) return;
    if (statuses[installing]?.installed?.installed) {
      installingRef.current = null;
      setInstalling(null);
    }
  }, [installing, statuses]);

  // Background-load model catalogs once connection checks say an engine is
  // installed and authenticated. The main process cache keeps this cheap.
  useEffect(() => {
    if (!onModelChange) return;
    for (const engine of engines) {
      const st = statuses[engine.id];
      if (!st?.installed?.installed || !st?.authed?.authed) continue;
      void refreshModels(engine.id);
    }
  }, [engines, statuses, onModelChange, refreshModels]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // While a login is pending, poll auth status until it flips to `true` or
  // the user gives up (stops interacting for ~2 min).
  useEffect(() => {
    if (!loggingIn) return;
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      if (cancelled) return;
      attempts++;
      const updates = await refreshStatus([loggingIn]);
      const st = updates.find((u) => u.id === loggingIn) ?? statuses[loggingIn];
      if (st?.authed?.authed) {
        loggingInRef.current = null;
        setLoggingIn(null);
        return;
      }
      if (attempts >= 40) {
        loggingInRef.current = null;
        setLoggingIn(null);
        return;
      }
      setTimeout(tick, 3000);
    };
    const id = setTimeout(tick, 2000);
    return () => { cancelled = true; clearTimeout(id); };
    // statuses intentionally excluded — we only poll while loggingIn flag is set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggingIn, refreshStatus]);

  const currentEngine = engines.find((e) => e.id === value) ?? engines[0];
  const currentStatus = currentEngine ? statuses[currentEngine.id] : undefined;
  const currentInstalled = currentStatus?.installed?.installed ?? true;
  const currentAuthed = currentStatus?.authed?.authed ?? true;
  const currentModels = value ? modelLists[value]?.response?.models ?? [] : [];
  const currentModel = model ? currentModels.find((m) => m.id === model) : undefined;
  const currentModelLabel = model ? (currentModel?.displayName ?? model) : 'Default';
  const modelOnlyLabel = labelMode === 'model';

  const modelLabelFor = (engineId: string): string | null => {
    const m = modelByEngine ? modelByEngine[engineId] : (engineId === value ? model : undefined);
    if (!m) return null;
    const list = modelLists[engineId]?.response?.models ?? [];
    const found = list.find((x) => x.id === m);
    return found?.displayName ?? m;
  };

  const selectEngine = (id: string) => {
    onChange(id);
    setSelectedProviderId(id);
    setOpen(false);
    setBrowserCodeFlyoutOpen(false);
  };

  const openModelsForEngine = (id: string) => {
    if (!onModelChange) {
      // No model picker — selecting a provider here is the commit point.
      selectEngine(id);
      return;
    }
    // Just navigate; don't commit engine until the user picks a model.
    setModelViewEngineId(id);
    setMenuView('models');
    setModelSearch('');
    const st = statuses[id];
    if (st?.installed?.installed && st?.authed?.authed) void refreshModels(id);
  };

  const selectModel = (modelId: string | undefined) => {
    const engineId = modelViewEngineId ?? value;
    if (engineId && engineId !== value) onChange(engineId);
    setSelectedProviderId(engineId);
    if (engineId) onModelChange?.(modelId, engineId);
    setOpen(false);
  };

  const onLoginClick = async (id: string) => {
    if (loggingInRef.current === id) return;
    loggingInRef.current = id;
    setLoggingIn(id);
    try {
      const result = await window.electronAPI?.sessions?.engineLogin?.(id);
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

  const openBrowserCodeSetup = async () => {
    selectEngine('browsercode');
    try {
      await window.electronAPI?.settings?.open?.();
    } catch (err) {
      console.error('[EnginePicker] browsercode.setup.openSettings.failed', err);
    }
  };

  const onInstallClick = async (id: string) => {
    if (installingRef.current === id) return;
    installingRef.current = id;
    setInstalling(id);
    try {
      const result = await window.electronAPI?.sessions?.engineInstall?.(id);
      if (result?.opened) {
        const status = await pollInstalledStatus(async () => {
          const updates = await refreshStatus([id]);
          return updates.find((u) => u.id === id)?.installed ?? null;
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

  const onProviderClick = (id: string, installed: boolean, authed: boolean) => {
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
      selectEngine(id);
      return;
    }
    openModelsForEngine(id);
  };

  if (engines.length === 0) return <span className="engine-picker engine-picker--empty" />;

  const modelEngineId = modelViewEngineId ?? value;
  const modelEngine = engines.find((e) => e.id === modelEngineId) ?? currentEngine;
  const pageModel = modelEngine
    ? (modelByEngine ? modelByEngine[modelEngine.id] : (modelEngine.id === value ? model : undefined))
    : undefined;
  const isCommittedEngine = modelEngine?.id === value;
  const modelStatus = modelEngine ? statuses[modelEngine.id] : undefined;
  const modelInstalled = modelStatus?.installed?.installed ?? true;
  const modelAuthed = modelStatus?.authed?.authed ?? true;
  const modelConnected = modelInstalled && modelAuthed;
  const modelState = modelEngine ? modelLists[modelEngine.id] : undefined;
  const modelResponse = modelState?.response;
  const models = modelResponse?.models ?? [];
  const normalizedSearch = modelSearch.trim().toLowerCase();
  const visibleModels = normalizedSearch
    ? models.filter((m) => {
      const haystack = `${m.displayName} ${m.id} ${m.description ?? ''}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    })
    : models;
  const showModelSearch = modelConnected && models.length > 10;
  const selectedEngineId = selectedProviderId ?? value ?? null;

  return (
    <div className="engine-picker" ref={menuRef}>
      <button
        ref={toggleRef}
        type="button"
        className={`engine-picker__toggle${modelOnlyLabel ? ' engine-picker__toggle--model-only' : ''}`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={currentEngine ? `Engine: ${currentEngine.displayName} · Model: ${currentModelLabel}${!currentAuthed ? ' — not logged in' : ''}` : 'Pick engine'}
      >
        {currentEngine && <EngineLogo id={currentEngine.id} />}
        <span className="engine-picker__label">
          {modelOnlyLabel ? (
            <span className="engine-picker__name">{currentModelLabel}</span>
          ) : (
            <span className="engine-picker__name">{currentEngine?.displayName ?? '…'}</span>
          )}
        </span>
        {(!currentInstalled || !currentAuthed) && <span className="engine-picker__dot" aria-label="Needs setup" />}
        <ChevronIcon />
      </button>
      {open && (
        <div className={`engine-picker__menu engine-picker__menu--${menuView} engine-picker__menu--${direction}`} role="menu">
          {menuView === 'providers' && engines.map((e) => {
            const st = statuses[e.id];
            const installed = st?.installed?.installed ?? true;
            const authed = st?.authed?.authed ?? true;
            const needsSetup = !installed || !authed;
            const selected = e.id === selectedEngineId;
            const actionPending = installing === e.id || loggingIn === e.id;
            const isBrowserCode = e.id === 'browsercode';
            const setupLabel = isBrowserCode ? 'Set up' : 'Log in';
            const installLabel = installing === e.id ? 'Installing…' : 'Install';
            const showBrowserCodeSubmenu = isBrowserCode && installed && authed && browserCodeFlyoutOpen;
            return (
              <div
                key={e.id}
                className="engine-picker__item-wrap"
                onMouseEnter={() => { if (isBrowserCode && installed && authed) setBrowserCodeFlyoutOpen(true); else setBrowserCodeFlyoutOpen(false); }}
              >
                <button
                  type="button"
                  className={`engine-picker__item engine-picker__item-select${selected ? ' engine-picker__item--selected' : ''}${actionPending ? ' engine-picker__item--disabled' : ''}`}
                  onClick={() => onProviderClick(e.id, installed, authed)}
                  disabled={actionPending}
                  title={!installed ? st?.installed?.error ?? `Install ${e.displayName}` : !authed ? st?.authed?.error ?? 'Start setup' : `Use ${e.displayName}`}
                  role="menuitem"
                >
                  <span className="engine-picker__item-check" aria-hidden={!selected}>
                    {selected ? '✓' : ''}
                  </span>
                  <EngineLogo id={e.id} />
                  <span className="engine-picker__item-text">
                    <span className="engine-picker__item-name">{e.displayName}</span>
                    {selected && (
                      <span className="engine-picker__item-sub">{modelLabelFor(e.id) ?? 'Default'}</span>
                    )}
                  </span>
                  {needsSetup && installed && (
                    <span className="engine-picker__item-login">
                      {loggingIn === e.id ? 'Waiting…' : setupLabel}
                    </span>
                  )}
                  {!installed && (
                    <span className="engine-picker__item-login">{installLabel}</span>
                  )}
                  {!needsSetup && isBrowserCode && (
                    <span className="engine-picker__chevron-right" aria-hidden="true"><ForwardIcon /></span>
                  )}
                  {!needsSetup && !isBrowserCode && (
                    <span className="engine-picker__item-arrow"><ForwardIcon /></span>
                  )}
                </button>
                {showBrowserCodeSubmenu && (
                  <div className="engine-picker__flyout">
                    <BrowserCodeProviderSubmenu onSelected={() => { onChange('browsercode'); setOpen(false); setBrowserCodeFlyoutOpen(false); }} />
                  </div>
                )}
              </div>
            );
          })}
          {menuView === 'models' && modelEngine && (
            <div className="engine-picker__models">
              <div className="engine-picker__models-title">
                <button
                  type="button"
                  className="engine-picker__models-back"
                  onClick={() => { setMenuView('providers'); setModelSearch(''); }}
                  aria-label="Back to engines"
                  title="Back to engines"
                >
                  <BackIcon />
                </button>
                <span className="engine-picker__models-provider">
                  <EngineLogo id={modelEngine.id} />
                  <span>{modelEngine.displayName}</span>
                </span>
                <span className="engine-picker__models-title-actions">
                  {!modelInstalled && <span className="engine-picker__models-status">Not installed</span>}
                  {modelInstalled && !modelAuthed && <span className="engine-picker__models-status">Connect first</span>}
                  {modelConnected && modelState?.loading && <span className="engine-picker__models-status">Loading</span>}
                  {modelConnected && (
                    <button
                      type="button"
                      className="engine-picker__models-refresh"
                      onClick={() => refreshModels(modelEngine.id, true)}
                      disabled={modelState?.loading}
                      aria-label={`Refresh ${modelEngine.displayName} models`}
                      title="Refresh model list"
                    >
                      <RefreshIcon />
                    </button>
                  )}
                </span>
              </div>
              {showModelSearch && (
                <div className="engine-picker__model-search">
                  <input
                    type="search"
                    className="engine-picker__model-search-input"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    placeholder={`Search models (${models.length} available)`}
                    aria-label={`Search ${modelEngine.displayName} models (${models.length} available)`}
                    autoFocus
                  />
                </div>
              )}
              <div className="engine-picker__models-list">
                <button
                  type="button"
                  className="engine-picker__model-option"
                  onClick={() => selectModel(undefined)}
                >
                  <span className="engine-picker__model-option-main">
                    <span className="engine-picker__model-option-name">Default</span>
                    <span className="engine-picker__model-option-id">Use {modelEngine.displayName}'s configured default</span>
                  </span>
                  {isCommittedEngine && !pageModel && <span className="engine-picker__check">✓</span>}
                </button>
                {isCommittedEngine && pageModel && !models.some((m) => m.id === pageModel) && (
                  <button
                    type="button"
                    className="engine-picker__model-option engine-picker__model-option--active"
                    onClick={() => selectModel(pageModel)}
                  >
                    <span className="engine-picker__model-option-main">
                      <span className="engine-picker__model-option-name">{pageModel}</span>
                      <span className="engine-picker__model-option-id">Selected model</span>
                    </span>
                    <span className="engine-picker__check">✓</span>
                  </button>
                )}
                {visibleModels.map((m) => {
                  const isSelected = isCommittedEngine && pageModel === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`engine-picker__model-option${isSelected ? ' engine-picker__model-option--active' : ''}`}
                      onClick={() => selectModel(m.id)}
                      title={m.description || m.id}
                    >
                      <span className="engine-picker__model-option-main">
                        <span className="engine-picker__model-option-name">{m.displayName}</span>
                        <span className="engine-picker__model-option-id">
                          {m.id}{m.isDefault ? ' · default' : ''}{m.isCurrent ? ' · current' : ''}
                        </span>
                      </span>
                      {isSelected && <span className="engine-picker__check">✓</span>}
                    </button>
                  );
                })}
                {showModelSearch && visibleModels.length === 0 && (
                  <div className="engine-picker__model-empty">No matching models</div>
                )}
              </div>
              {(modelResponse?.error || modelState?.error) && (
                <div className="engine-picker__model-error" title={modelResponse?.error ?? modelState?.error}>
                  Using fallback model list
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
