import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import kimiLogoDark from './kimi-color.svg';
import kimiLogoLight from './kimi-light.svg';
import minimaxLogo from './minimax-color.svg';
import qwenLogo from './qwen-color.svg';
import { useThemedAsset } from '../design/useThemedAsset';
import { closeAppPopup, openAnchoredAppPopup } from '../shared/appPopup';

export interface BrowserCodeProvider {
  id: string;
  name: string;
  defaultModel: string;
  models: Array<{ id: string; label: string }>;
}

export interface BrowserCodeStatus {
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

export function effectiveProviderModel(
  status: BrowserCodeStatus,
  provider: BrowserCodeProvider | undefined,
): string | undefined {
  if (!provider) return undefined;
  return status.keys[provider.id]?.lastModel ?? provider.defaultModel;
}

function ChevronIcon(): React.ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ProviderMark({ providerId }: { providerId: string }): React.ReactElement {
  const kimiLogo = useThemedAsset(kimiLogoDark, kimiLogoLight);
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

export function modelLabel(providers: BrowserCodeProvider[], modelId: string | undefined): string {
  if (!modelId) return 'Model';
  for (const provider of providers) {
    const match = provider.models.find((model) => model.id === modelId);
    if (match) return match.label;
  }
  return modelId.includes('/') ? modelId.split('/').pop() ?? modelId : modelId;
}

export function BrowserCodeSkeletonRows({ count = 3 }: { count?: number }): React.ReactElement {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="browsercode-model-picker__skeleton-item" aria-hidden="true">
          <span className="browsercode-model-picker__skeleton browsercode-model-picker__skeleton--mark" />
          <span className="browsercode-model-picker__skeleton browsercode-model-picker__skeleton--label" />
          <span className="browsercode-model-picker__skeleton browsercode-model-picker__skeleton--badge" />
        </div>
      ))}
    </>
  );
}

export function BrowserCodeModelPicker({
  visible,
  compact = false,
  onOpenChange,
}: BrowserCodeModelPickerProps): React.ReactElement | null {
  const [status, setStatus] = useState<BrowserCodeStatus>({ keys: {}, active: null, providers: [] });
  const [loaded, setLoaded] = useState(false);
  const [popupId, setPopupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.settings?.browserCode;
    if (!api) {
      setLoaded(true);
      return;
    }
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
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void refresh();
  }, [refresh, visible]);

  useEffect(() => {
    if (visible) return;
    closeAppPopup(popupId);
    setPopupId(null);
  }, [popupId, visible]);

  const currentProvider = useMemo(() => {
    const providerId = status.active ?? status.providers[0]?.id;
    return status.providers.find((provider) => provider.id === providerId) ?? status.providers[0];
  }, [status.active, status.providers]);

  const currentModel = effectiveProviderModel(status, currentProvider);
  const currentModelLabel = modelLabel(status.providers, currentModel);
  const hasAnyKey = Object.keys(status.keys).length > 0;
  const loadingStatus = !loaded && status.providers.length === 0;

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
        kind: 'browsercode-model-picker',
        placement: 'bottom-end',
        width: 292,
        maxHeight: 380,
      },
      {
        onAction: (action) => {
          if (action.kind === 'browsercode-model-changed') void refresh();
        },
        onClosed: () => {
          setPopupId(null);
          onOpenChange?.(false);
          void refresh();
        },
      },
    );
    if (nextId) setPopupId(nextId);
    else onOpenChange?.(false);
  }, [onOpenChange, popupId, refresh]);

  if (!visible) return null;

  return (
    <div className={`browsercode-model-picker${compact ? ' browsercode-model-picker--compact' : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        className="browsercode-model-picker__toggle"
        onClick={(e) => { e.stopPropagation(); void openMenu(); }}
        title={loadingStatus ? 'Loading BrowserCode model' : hasAnyKey ? `BrowserCode model: ${currentModelLabel}` : 'Set up BrowserCode model'}
        aria-haspopup="menu"
        aria-expanded={Boolean(popupId)}
        aria-busy={loadingStatus}
      >
        {loadingStatus ? (
          <>
            <span className="browsercode-model-picker__skeleton browsercode-model-picker__skeleton--mark" aria-hidden="true" />
            <span className="browsercode-model-picker__skeleton browsercode-model-picker__skeleton--toggle-label" aria-hidden="true" />
          </>
        ) : (
          <>
            {currentProvider && <ProviderMark providerId={currentProvider.id} />}
            <span className="browsercode-model-picker__label">{error ?? currentModelLabel}</span>
          </>
        )}
        <ChevronIcon />
      </button>
    </div>
  );
}

interface BrowserCodeModelMenuContentProps {
  onChanged?: () => void;
  onClose?: () => void;
}

export function BrowserCodeModelMenuContent({
  onChanged,
  onClose,
}: BrowserCodeModelMenuContentProps): React.ReactElement {
  const [status, setStatus] = useState<BrowserCodeStatus>({ keys: {}, active: null, providers: [] });
  const [loaded, setLoaded] = useState(false);
  const [drilledProviderId, setDrilledProviderId] = useState<string | null>(null);
  const [savingModel, setSavingModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.settings?.browserCode;
    if (!api) {
      setLoaded(true);
      return;
    }
    try {
      const next = await api.getStatus();
      setStatus(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectModel = useCallback(async (providerId: string, model: string) => {
    const api = window.electronAPI?.settings?.browserCode;
    if (!api) return;
    if (!status.keys[providerId]) {
      await window.electronAPI?.settings?.open?.({ focusBrowserCodeProvider: providerId });
      onClose?.();
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
      onChanged?.();
      onClose?.();
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      console.warn('[BrowserCodeModelPicker] model.save.failed', { providerId, model, error: message });
    } finally {
      setSavingModel(null);
    }
  }, [onChanged, onClose, refresh, status.keys]);

  const loadingStatus = !loaded && status.providers.length === 0;
  const canSwitchModels = Object.keys(status.keys).length > 0 && status.installed?.installed !== false;

  return (
    <div className="browsercode-model-picker__menu" role="menu">
      {loadingStatus ? (
        <div className="browsercode-submenu browsercode-submenu--loading" aria-label="Loading BrowserCode providers">
          <BrowserCodeSkeletonRows />
        </div>
      ) : !canSwitchModels && (
        <button
          type="button"
          className="browsercode-model-picker__setup"
          onClick={() => {
            void window.electronAPI?.settings?.open?.();
            onClose?.();
          }}
          role="menuitem"
        >
          Set up BrowserCode in Settings
        </button>
      )}

      {!loadingStatus && canSwitchModels && (drilledProviderId === null
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
                    void window.electronAPI?.settings?.open?.({ focusBrowserCodeProvider: provider.id });
                    onClose?.();
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
                  const isActive = status.active === provider.id && effectiveProviderModel(status, provider) === model.id;
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
          })())}
      {error && <div className="browsercode-model-picker__error">{error}</div>}
    </div>
  );
}

interface BrowserCodeProviderSubmenuProps {
  onSelected?: () => void;
}

export function BrowserCodeProviderSubmenu({ onSelected }: BrowserCodeProviderSubmenuProps): React.ReactElement {
  const [status, setStatus] = useState<BrowserCodeStatus>({ keys: {}, active: null, providers: [] });
  const [loaded, setLoaded] = useState(false);
  const [drilledProviderId, setDrilledProviderId] = useState<string | null>(null);
  const [savingModel, setSavingModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.settings?.browserCode;
    if (!api) {
      setLoaded(true);
      return;
    }
    try {
      const next = await api.getStatus();
      setStatus(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

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

  const loadingStatus = !loaded && status.providers.length === 0;

  if (drilledProviderId === null) {
    return (
      <div className={`browsercode-submenu${loadingStatus ? ' browsercode-submenu--loading' : ''}`} role="menu" aria-busy={loadingStatus}>
        {loadingStatus ? <BrowserCodeSkeletonRows /> : status.providers.map((provider) => {
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
        const isActive = status.active === provider.id && effectiveProviderModel(status, provider) === model.id;
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
