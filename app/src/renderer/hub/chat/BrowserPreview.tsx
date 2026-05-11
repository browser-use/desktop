import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSessionsStore } from '../state/sessionsStore';

interface BrowserPreviewProps {
  sessionId: string;
  onExpand: () => void;
}

const PREVIEW_W = 200;
const PREVIEW_H = 125;

/**
 * Live browser thumbnail driven by CDP Page.startScreencast on the main side.
 * Always rendered above the composer so the user has a stable target. The
 * browser-attached signal comes from session.hasBrowser, which the main
 * process derives from BrowserPool.getWebContents(id) — single source of
 * truth, no shadow state.
 */
export function BrowserPreview({ sessionId, onExpand }: BrowserPreviewProps): React.ReactElement {
  const sessionInfo = useSessionsStore(
    useShallow((s) => {
      const sess = s.byId[sessionId];
      if (!sess) return { hasBrowser: false, status: 'idle' as const };
      return { hasBrowser: !!sess.hasBrowser, status: sess.status };
    }),
  );

  const [frame, setFrame] = useState<string | null>(null);
  const [expanding, setExpanding] = useState(false);
  const cardRef = useRef<HTMLButtonElement>(null);

  // Listen for frames unconditionally — cheap, and a late-arriving stream
  // attaches without a remount.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    let count = 0;
    let lastLog = 0;
    return api.on.sessionPreviewFrame((id, dataB64) => {
      if (id !== sessionId) return;
      count += 1;
      const now = Date.now();
      if (now - lastLog > 5000) {
        lastLog = now;
        console.log('[BrowserPreview] frames received', { sessionId, count, bytes: dataB64.length });
      }
      setFrame(dataB64);
    });
  }, [sessionId]);

  // Start/stop the screencast in lockstep with hasBrowser. When the agent
  // creates a browser later, hasBrowser flips true and this effect re-runs.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api || !sessionInfo.hasBrowser) {
      setFrame(null);
      return;
    }
    let cancelled = false;
    api.sessions.previewStart(sessionId, { maxWidth: PREVIEW_W * 2, maxHeight: PREVIEW_H * 2 })
      .then((res) => {
        if (cancelled) {
          api.sessions.previewStop(sessionId).catch(() => { /* ignore */ });
          return;
        }
        if (!res.ok) {
          console.warn('[BrowserPreview] previewStart not ok', { sessionId, reason: res.reason });
        }
      })
      .catch((err) => console.error('[BrowserPreview] previewStart threw', err));

    return () => {
      cancelled = true;
      api.sessions.previewStop(sessionId).catch(() => { /* ignore */ });
    };
  }, [sessionId, sessionInfo.hasBrowser]);

  const onClick = useCallback(() => {
    if (!sessionInfo.hasBrowser) return;
    setExpanding(true);
    setTimeout(() => onExpand(), 220);
  }, [sessionInfo.hasBrowser, onExpand]);

  const disabled = !sessionInfo.hasBrowser;
  return (
    <button
      ref={cardRef}
      type="button"
      className={`browser-preview${expanding ? ' browser-preview--expanding' : ''}${disabled ? ' browser-preview--disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Browser will appear when the agent starts one' : 'Open browser view'}
      aria-label={disabled ? 'Browser not attached' : 'Open browser view'}
    >
      {frame ? (
        <img
          className="browser-preview__img"
          src={`data:image/jpeg;base64,${frame}`}
          alt=""
          draggable={false}
        />
      ) : (
        <div className="browser-preview__placeholder">
          <svg width="22" height="16" viewBox="0 0 22 16" fill="none" aria-hidden>
            <rect x="1" y="1" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.2" />
            <path d="M1 5h20" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="3.5" cy="3" r="0.6" fill="currentColor" />
            <circle cx="5.5" cy="3" r="0.6" fill="currentColor" />
            <circle cx="7.5" cy="3" r="0.6" fill="currentColor" />
          </svg>
        </div>
      )}
      {!disabled && (
        <div className="browser-preview__overlay">
          <span className="browser-preview__expand-hint">↗ Open</span>
        </div>
      )}
    </button>
  );
}
