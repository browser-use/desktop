import type {
  AppPopupAction,
  AppPopupClosed,
  AppPopupOpenRequest,
  AppPopupOpenResult,
} from '../../shared/app-popup';

type AppPopupRequestWithoutAnchor<T extends AppPopupOpenRequest = AppPopupOpenRequest> =
  T extends AppPopupOpenRequest ? Omit<T, 'anchor'> : never;

interface AppPopupCallbacks {
  onAction?: (action: AppPopupAction) => void;
  onClosed?: (event: AppPopupClosed) => void;
  cleanup?: () => void;
}

const handlers = new Map<string, AppPopupCallbacks>();
let listening = false;

function popupId(): string {
  return `popup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ensureListeners(): void {
  if (listening) return;
  const popupApi = window.electronAPI?.popup;
  if (!popupApi) return;
  popupApi.onAction((action) => {
    handlers.get(action.popupId)?.onAction?.(action);
  });
  popupApi.onClosed((event) => {
    const callbacks = handlers.get(event.popupId);
    handlers.delete(event.popupId);
    callbacks?.cleanup?.();
    callbacks?.onClosed?.(event);
  });
  listening = true;
}

function rectFromElement(anchor: Element): { x: number; y: number; width: number; height: number } {
  const rect = anchor.getBoundingClientRect();
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

export async function openAnchoredAppPopup(
  anchor: Element,
  request: AppPopupRequestWithoutAnchor,
  callbacks: AppPopupCallbacks = {},
): Promise<string | null> {
  const popupApi = window.electronAPI?.popup;
  if (!popupApi) return null;
  ensureListeners();

  const id = request.id ?? popupId();
  const onPointerDown = (event: MouseEvent): void => {
    if (anchor.contains(event.target as Node)) return;
    closeAppPopup(id);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') closeAppPopup(id);
  };
  const cleanup = (): void => {
    window.removeEventListener('mousedown', onPointerDown, true);
    window.removeEventListener('keydown', onKeyDown, true);
  };
  handlers.set(id, { ...callbacks, cleanup });

  try {
    const result: AppPopupOpenResult = await popupApi.open({
      ...request,
      id,
      anchor: rectFromElement(anchor),
    } as AppPopupOpenRequest);
    window.setTimeout(() => {
      window.addEventListener('mousedown', onPointerDown, true);
      window.addEventListener('keydown', onKeyDown, true);
    }, 0);
    return result.id;
  } catch (err) {
    handlers.get(id)?.cleanup?.();
    handlers.delete(id);
    console.warn('[app-popup] open failed', err);
    return null;
  }
}

export function closeAppPopup(id: string | null | undefined): void {
  if (!id) return;
  handlers.get(id)?.cleanup?.();
  window.electronAPI?.popup?.close(id).catch((err) => {
    console.warn('[app-popup] close failed', err);
  });
}
