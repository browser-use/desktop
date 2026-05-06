import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import kimiLogo from './kimi-color.svg';
import minimaxLogo from './minimax-color.svg';
import qwenLogo from './qwen-color.svg';

interface BrowserCodeProvider {
  id: string;
  name: string;
  defaultModel: string;
  models: Array<{ id: string; label: string }>;
}

interface BrowserCodeStatus {
  keys: Record<string, { masked: string; lastModel?: string }>;
  active: string | null;
  installed?: { installed: boolean; version?: string; error?: string };
  providers: BrowserCodeProvider[];
}

interface BrowserCodeModelPickerProps {
  visible: boolean;
  compact?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function ChevronIcon(): React.ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProviderMark({ providerId }: { providerId: string }): React.ReactElement {
  if (providerId === 'minimax') {
    return <img className="browsercode-model-picker__logo" src={minimaxLogo} alt="" />;
  }
  if (providerId === 'alibaba') {
    return <img className="browsercode-model-picker__logo" src={qwenLogo} alt="" />;
  }
  if (providerId === 'moonshotai') {
    return <img className="browsercode-model-picker__logo" src={kimiLogo} alt="" />;
  }
  return <span className="browsercode-model-picker__mark">{providerId.slice(0, 1).toUpperCase()}</span>;
}

function modelLabel(providers: BrowserCodeProvider[], modelId: string | undefined): string {
  if (!modelId) return 'Model';
  for (const provider of providers) {
    const match = provider.models.find((model) => model.id === modelId);
    if (match) return match.label;
  }
  return modelId.includes('/') ? modelId.split('/').pop() ?? modelId : modelId;
}

export function BrowserCodeModelPicker({
  visible,
  compact = false,
  onOpenChange,
}: BrowserCodeModelPickerProps): React.ReactElement | null {
  const [status, setStatus] = useState<BrowserCodeStatus>({ keys: {}, active: null, providers: [] });
  const [open, setOpen] = useState(false);
  const [drilledProviderId, setDrilledProviderId] = useState<string | null>(null);
  const [savingModel, setSavingModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);

  useEffect(() => { if (!open) setDrilledProviderId(null); }, [open]);

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.settings?.browserCode;
    if (!api) return;
    try {
      const next = await api.getStatus();
      setStatus(next);
      setError(null);
      console.info('[BrowserCodeModelPicker] status', {
        connectedProviders: Object.keys(next.keys),
        active: next.active,
        installed: next.installed?.installed,
      });
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      console.warn('[BrowserCodeModelPicker] status.failed', { error: message });
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void refresh();
  }, [refresh, visible]);

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const currentProvider = useMemo(() => {
    const providerId = status.active ?? status.providers[0]?.id;
    return status.providers.find((provider) => provider.id === providerId) ?? status.providers[0];
  }, [status.active, status.providers]);

  const activeEntry = status.active ? status.keys[status.active] : undefined;
  const currentModel = activeEntry?.lastModel ?? currentProvider?.defaultModel;
  const currentModelLabel = modelLabel(status.providers, currentModel);
  const hasAnyKey = Object.keys(status.keys).length > 0;
  const canSwitchModels = hasAnyKey && status.installed?.installed !== false;

  const selectModel = useCallback(async (providerId: string, model: string) => {
    const api = window.electronAPI?.settings?.browserCode;
    if (!api) return;
    if (!status.keys[providerId]) {
      setOpen(false);
      await window.electronAPI?.settings?.open?.();
      return;
    }
    setSavingModel(model);
    setError(null);
    try {
      console.info('[BrowserCodeModelPicker] model.save.request', { providerId, model });
      await api.save({ providerId, lastModel: model, apiKey: '' });
      await api.setActive({ providerId });
      console.info('[BrowserCodeModelPicker] model.save.ok', { providerId, model });
      await refresh();
      setOpen(false);
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      console.warn('[BrowserCodeModelPicker] model.save.failed', { providerId, model, error: message });
    } finally {
      setSavingModel(null);
    }
  }, [refresh, status.keys]);

  if (!visible) return null;

  return (
    <div className={`browsercode-model-picker${compact ? ' browsercode-model-picker--compact' : ''}`} ref={menuRef}>
      <button
        type="button"
        className="browsercode-model-picker__toggle"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title={hasAnyKey ? `BrowserCode model: ${currentModelLabel}` : 'Set up BrowserCode model'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {currentProvider && <ProviderMark providerId={currentProvider.id} />}
        <span className="browsercode-model-picker__label">{currentModelLabel}</span>
        <ChevronIcon />
      </button>
      {open && (
        <div className="browsercode-model-picker__menu" role="menu">
          {!canSwitchModels && (
            <button
              type="button"
              className="browsercode-model-picker__setup"
              onClick={() => {
                setOpen(false);
                void window.electronAPI?.settings?.open?.();
              }}
              role="menuitem"
            >
              Set up BrowserCode in Settings
            </button>
          )}
          {drilledProviderId === null
            ? status.providers.map((provider) => {
                const isConfigured = !!status.keys[provider.id];
                const isActiveProvider = status.active === provider.id;
                return (
                  <button
                    key={provider.id}
                    type="button"
                    className={`browsercode-model-picker__item${isActiveProvider ? ' browsercode-model-picker__item--active' : ''}`}
                    onClick={() => {
                      if (!isConfigured) {
                        setOpen(false);
                        void window.electronAPI?.settings?.open?.({ focusBrowserCodeProvider: provider.id });
                        return;
                      }
                      setDrilledProviderId(provider.id);
                    }}
                    role="menuitem"
                    title={isConfigured ? provider.name : `Add a ${provider.name} key in Settings`}
                  >
                    <ProviderMark providerId={provider.id} />
                    <span className="browsercode-model-picker__item-name">{provider.name}</span>
                    {isActiveProvider && <span className="browsercode-model-picker__check">✓</span>}
                    {!isConfigured && <span className="browsercode-model-picker__locked">Settings</span>}
                    <span className="browsercode-model-picker__chevron-right" aria-hidden="true">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M4 2.5L6.5 5L4 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                );
              })
            : (() => {
                const provider = status.providers.find((p) => p.id === drilledProviderId);
                if (!provider) return null;
                const isConfiguredProvider = !!status.keys[provider.id];
                return (
                  <>
                    <button
                      type="button"
                      className="browsercode-model-picker__back"
                      onClick={() => setDrilledProviderId(null)}
                      role="menuitem"
                    >
                      <span className="browsercode-model-picker__chevron-left" aria-hidden="true">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M6 2.5L3.5 5L6 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <ProviderMark providerId={provider.id} />
                      <span className="browsercode-model-picker__item-name">{provider.name}</span>
                    </button>
                    {provider.models.map((model) => {
                      const isActive = status.active === provider.id && currentModel === model.id;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          className={`browsercode-model-picker__item${isActive ? ' browsercode-model-picker__item--active' : ''}`}
                          onClick={() => { void selectModel(provider.id, model.id); }}
                          disabled={savingModel === model.id}
                          role="menuitem"
                          title={isConfiguredProvider ? `Use ${model.label}` : `Add a ${provider.name} key in Settings`}
                        >
                          <span className="browsercode-model-picker__item-name">{model.label}</span>
                          {isActive && <span className="browsercode-model-picker__check">✓</span>}
                          {!isConfiguredProvider && <span className="browsercode-model-picker__locked">Settings</span>}
                        </button>
                      );
                    })}
                  </>
                );
              })()}
          {error && <div className="browsercode-model-picker__error">{error}</div>}
        </div>
      )}
    </div>
  );
}

interface BrowserCodeProviderSubmenuProps {
  onSelected?: () => void;
}

export function BrowserCodeProviderSubmenu({ onSelected }: BrowserCodeProviderSubmenuProps): React.ReactElement {
  const [status, setStatus] = useState<BrowserCodeStatus>({ keys: {}, active: null, providers: [] });
  const [drilledProviderId, setDrilledProviderId] = useState<string | null>(null);
  const [savingModel, setSavingModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.settings?.browserCode;
    if (!api) return;
    try {
      const next = await api.getStatus();
      setStatus(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeEntry = status.active ? status.keys[status.active] : undefined;
  const currentModel = activeEntry?.lastModel;

  const selectModel = useCallback(async (providerId: string, model: string) => {
    const api = window.electronAPI?.settings?.browserCode;
    if (!api) return;
    if (!status.keys[providerId]) {
      void window.electronAPI?.settings?.open?.({ focusBrowserCodeProvider: providerId });
      onSelected?.();
      return;
    }
    setSavingModel(model);
    try {
      await api.save({ providerId, lastModel: model, apiKey: '' });
      await api.setActive({ providerId });
      await refresh();
      onSelected?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingModel(null);
    }
  }, [refresh, status.keys, onSelected]);

  if (drilledProviderId === null) {
    return (
      <div className="browsercode-submenu" role="menu">
        {status.providers.map((provider) => {
          const isConfigured = !!status.keys[provider.id];
          const isActive = status.active === provider.id;
          return (
            <button
              key={provider.id}
              type="button"
              className={`browsercode-model-picker__item${isActive ? ' browsercode-model-picker__item--active' : ''}`}
              onClick={() => {
                if (!isConfigured) {
                  void window.electronAPI?.settings?.open?.({ focusBrowserCodeProvider: provider.id });
                  onSelected?.();
                  return;
                }
                setDrilledProviderId(provider.id);
              }}
              role="menuitem"
            >
              <ProviderMark providerId={provider.id} />
              <span className="browsercode-model-picker__item-name">{provider.name}</span>
              {isActive && <span className="browsercode-model-picker__check">✓</span>}
              {!isConfigured && <span className="browsercode-model-picker__locked">Settings</span>}
              <span className="browsercode-model-picker__chevron-right" aria-hidden="true">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M4 2.5L6.5 5L4 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
          );
        })}
        {error && <div className="browsercode-model-picker__error">{error}</div>}
      </div>
    );
  }

  const provider = status.providers.find((p) => p.id === drilledProviderId);
  if (!provider) return <div className="browsercode-submenu" />;

  return (
    <div className="browsercode-submenu" role="menu">
      <button
        type="button"
        className="browsercode-model-picker__back"
        onClick={() => setDrilledProviderId(null)}
        role="menuitem"
      >
        <span className="browsercode-model-picker__chevron-left" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M6 2.5L3.5 5L6 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <ProviderMark providerId={provider.id} />
        <span className="browsercode-model-picker__item-name">{provider.name}</span>
      </button>
      {provider.models.map((model) => {
        const isActive = status.active === provider.id && currentModel === model.id;
        return (
          <button
            key={model.id}
            type="button"
            className={`browsercode-model-picker__item${isActive ? ' browsercode-model-picker__item--active' : ''}`}
            onClick={() => { void selectModel(provider.id, model.id); }}
            disabled={savingModel === model.id}
            role="menuitem"
          >
            <span className="browsercode-model-picker__item-name">{model.label}</span>
            {isActive && <span className="browsercode-model-picker__check">✓</span>}
          </button>
        );
      })}
      {error && <div className="browsercode-model-picker__error">{error}</div>}
    </div>
  );
}
