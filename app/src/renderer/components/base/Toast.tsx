/**
 * Toast.tsx — base toast notification component
 * Variants: info | success | warning | error | agent
 * Renders a stack of toasts via ToastProvider + useToast hook.
 * No !important, no Inter references.
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLOCK = 'agb-toast' as const;

const DEFAULT_DURATION_MS = 4000;
const MAX_TOASTS          = 5;

const VARIANT_CLASSES = {
  info:    `${BLOCK}--info`,
  success: `${BLOCK}--success`,
  warning: `${BLOCK}--warning`,
  error:   `${BLOCK}--error`,
  agent:   `${BLOCK}--agent`,
} as const;

const VARIANT_ICONS: Record<ToastVariant, string> = {
  info:    'ℹ',
  success: '✓',
  warning: '△',
  error:   '✕',
  agent:   '⌘',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastVariant = keyof typeof VARIANT_CLASSES;

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
  duration?: number;
  persistent?: boolean;
}

interface ToastContextValue {
  show: (item: Omit<ToastItem, 'id'>) => string;
  update: (id: string, patch: Partial<Omit<ToastItem, 'id'>>) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null);

// ---------------------------------------------------------------------------
// Individual Toast item
// ---------------------------------------------------------------------------

interface ToastEntryProps {
  item: ToastItem;
  onDismiss: (id: string) => void;
}

function ToastEntry({ item, onDismiss }: ToastEntryProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleDismiss = useCallback(() => {
    if (item.persistent) return;
    const ms = item.duration ?? DEFAULT_DURATION_MS;
    timerRef.current = setTimeout(() => onDismiss(item.id), ms);
  }, [item, onDismiss]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    scheduleDismiss();
    return clearTimer;
  }, [scheduleDismiss, clearTimer]);

  const classes = [
    BLOCK,
    VARIANT_CLASSES[item.variant],
  ].join(' ');

  return (
    <div
      className={classes}
      role={item.variant === 'error' ? 'alert' : 'status'}
      aria-live={item.variant === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      onMouseEnter={clearTimer}
      onMouseLeave={scheduleDismiss}
    >
      <span className={`${BLOCK}__icon`} aria-hidden="true">
        {VARIANT_ICONS[item.variant]}
      </span>
      <div className={`${BLOCK}__content`}>
        <span className={`${BLOCK}__title`}>{item.title}</span>
        {item.message && (
          <span className={`${BLOCK}__message`}>{item.message}</span>
        )}
      </div>
      <button
        className={`${BLOCK}__dismiss`}
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss notification"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path
            d="M1 1L9 9M9 1L1 9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((item: Omit<ToastItem, 'id'>): string => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => {
      const next = [...prev, { ...item, id }];
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    });
    return id;
  }, []);

  const update = useCallback((id: string, patch: Partial<Omit<ToastItem, 'id'>>) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  return (
    <ToastContext.Provider value={{ show, update, dismiss, dismissAll }}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            className={`${BLOCK}__stack`}
            role="region"
            aria-label="Notifications"
            aria-live="polite"
          >
            {toasts.map((item) => (
              <ToastEntry key={item.id} item={item} onDismiss={dismiss} />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return ctx;
}

export default ToastProvider;
