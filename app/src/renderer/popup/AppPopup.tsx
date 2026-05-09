import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  AppPopupAction,
  AppPopupMenuItem,
  AppPopupOpenRequest,
} from '../../shared/app-popup';
import { EnginePickerMenuContent } from '../hub/EnginePicker';
import { BrowserCodeModelMenuContent } from '../hub/BrowserCodeModelPicker';
import { MemoryIndicatorContent } from '../hub/MemoryIndicator';
import { EditorIcon, FinderIcon } from '../shared/editorIcons';

declare global {
  interface Window {
    popupHostAPI: {
      ready: () => void;
      onRender: (cb: (request: AppPopupOpenRequest) => void) => () => void;
      contentReady: (popupId: string) => void;
      resize: (size: { popupId: string; width: number; height: number }) => void;
      action: (action: AppPopupAction) => void;
      close: (popupId: string, reason?: string) => void;
    };
  }
}

function useMeasuredPopup(request: AppPopupOpenRequest | null, ref: React.RefObject<HTMLDivElement>): void {
  useLayoutEffect(() => {
    if (!request) return;
    const node = ref.current;
    if (!node) return;
    const measure = (): void => {
      const rect = node.getBoundingClientRect();
      const width = Math.ceil(Math.max(rect.width, node.scrollWidth));
      const height = Math.ceil(Math.max(rect.height, node.scrollHeight));
      window.popupHostAPI.resize({
        popupId: request.id ?? '',
        width,
        height: Math.min(height, request.maxHeight ?? 380),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    const observed = new Set<Element>();
    const observeContent = (): void => {
      for (const element of [node, ...Array.from(node.querySelectorAll<HTMLElement>('*'))]) {
        if (observed.has(element)) continue;
        observed.add(element);
        observer.observe(element);
      }
    };
    observeContent();
    const mutationObserver = new MutationObserver(() => {
      observeContent();
      measure();
    });
    mutationObserver.observe(node, { childList: true, subtree: true });
    return () => {
      mutationObserver.disconnect();
      observer.disconnect();
    };
  }, [request, ref]);
}

function MenuIcon({ item }: { item: AppPopupMenuItem }): React.ReactElement | null {
  if (!item.icon) return null;
  if (item.icon.type === 'editor') return <EditorIcon id={item.icon.id} />;
  if (item.icon.type === 'finder') return <FinderIcon />;
  return null;
}

function GenericMenu({
  request,
}: {
  request: Extract<AppPopupOpenRequest, { kind: 'menu' }>;
}): React.ReactElement {
  const popupId = request.id ?? '';
  const select = (item: AppPopupMenuItem): void => {
    if (item.disabled) return;
    window.popupHostAPI.action({
      popupId,
      kind: 'menu-select',
      itemId: item.id,
    });
  };

  return (
    <div className="app-popup-menu" role="menu">
      {request.items.map((item) => (
        <React.Fragment key={item.id}>
          {item.separatorBefore && <div className="app-popup-menu__sep" />}
          <button
            type="button"
            className={`app-popup-menu__item${item.tone === 'danger' ? ' app-popup-menu__item--danger' : ''}`}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => select(item)}
          >
            <span className="app-popup-menu__icon"><MenuIcon item={item} /></span>
            <span className="app-popup-menu__label">{item.label}</span>
            {item.checked && <span className="app-popup-menu__check">✓</span>}
            {item.hint && <span className="app-popup-menu__hint">{item.hint}</span>}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

export function AppPopup(): React.ReactElement {
  const [request, setRequest] = useState<AppPopupOpenRequest | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useMeasuredPopup(request, contentRef);

  useEffect(() => {
    const cleanup = window.popupHostAPI.onRender((next) => {
      setRequest(next);
    });
    window.popupHostAPI.ready();
    return cleanup;
  }, []);

  useLayoutEffect(() => {
    if (!request) return;
    window.popupHostAPI.contentReady(request.id ?? '');
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        window.popupHostAPI.close(request.id ?? '', 'escape');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [request]);

  const emitEngineSelect = useCallback((engineId: string): void => {
    if (!request) return;
    window.popupHostAPI.action({
      popupId: request.id ?? '',
      kind: 'engine-select',
      engineId,
    });
  }, [request]);

  const closeFromContent = useCallback((): void => {
    if (!request) return;
    window.popupHostAPI.close(request.id ?? '', 'request');
  }, [request]);

  const emitBrowserCodeChange = useCallback((): void => {
    if (!request) return;
    window.popupHostAPI.action({
      popupId: request.id ?? '',
      kind: 'browsercode-model-changed',
    });
  }, [request]);

  return (
    <div ref={contentRef} className={`app-popup app-popup--${request?.kind ?? 'empty'}`}>
      {request?.kind === 'menu' && <GenericMenu request={request} />}
      {request?.kind === 'engine-picker' && (
        <EnginePickerMenuContent
          value={request.value}
          onChange={emitEngineSelect}
          onClose={closeFromContent}
        />
      )}
      {request?.kind === 'browsercode-model-picker' && (
        <BrowserCodeModelMenuContent
          onChanged={emitBrowserCodeChange}
          onClose={closeFromContent}
        />
      )}
      {request?.kind === 'memory-indicator' && <MemoryIndicatorContent />}
    </div>
  );
}
