import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSessionsStore } from '../state/sessionsStore';

interface BrowserPreviewProps {
  sessionId: string;
  onExpand: () => void;
}

function hostFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.host || null;
  } catch {
    return null;
  }
}

export function BrowserPreview({ sessionId, onExpand }: BrowserPreviewProps): React.ReactElement | null {
  const sessionInfo = useSessionsStore(
    useShallow((s) => {
      const sess = s.byId[sessionId];
      return {
        hasBrowser: !!sess?.hasBrowser,
        lastUrl: sess?.lastUrl ?? null,
      };
    }),
  );

  const [frame, setFrame] = useState<string | null>(null);
  const [expanding, setExpanding] = useState(false);
  const frameCountRef = useRef(0);
  const lastFrameLogAtRef = useRef(0);
  const hostLabel = hostFromUrl(sessionInfo.lastUrl);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    return api.on.sessionPreviewFrame((id, dataB64) => {
      if (id !== sessionId) return;
      frameCountRef.current += 1;
      const now = Date.now();
      if (frameCountRef.current === 1 || now - lastFrameLogAtRef.current >= 5000) {
        lastFrameLogAtRef.current = now;
        console.info('[BrowserPreview] frame', {
          sessionId,
          frames: frameCountRef.current,
          bytes: dataB64.length,
        });
      }
      setFrame(dataB64);
    });
  }, [sessionId]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api || !sessionInfo.hasBrowser) {
      setFrame(null);
      return;
    }

    let active = true;
    setFrame(null);
    frameCountRef.current = 0;
    lastFrameLogAtRef.current = 0;
    api.sessions.previewStart(sessionId)
      .then((res) => {
        console.info('[BrowserPreview] previewStart', { sessionId, ...res });
        if (active && !res.ok) setFrame(null);
      })
      .catch((err) => {
        console.warn('[BrowserPreview] previewStart.failed', { sessionId, error: err instanceof Error ? err.message : String(err) });
        if (active) setFrame(null);
      });

    return () => {
      active = false;
      api.sessions.previewStop(sessionId).catch(() => {});
    };
  }, [sessionId, sessionInfo.hasBrowser]);

  const onClick = useCallback(() => {
    setExpanding(true);
    setTimeout(() => onExpand(), 220);
  }, [onExpand]);

  if (!sessionInfo.hasBrowser) return null;

  return (
    <div className="browser-preview__wrap">
      {hostLabel && (
        <span className="browser-preview__url" title={sessionInfo.lastUrl ?? undefined}>
          {hostLabel}
        </span>
      )}
      <button
        type="button"
        className={`browser-preview${expanding ? ' browser-preview--expanding' : ''}`}
        onClick={onClick}
        title="Open browser view"
        aria-label="Open browser view"
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
            <svg width="14" height="10" viewBox="0 0 22 16" fill="none" aria-hidden>
              <rect x="1" y="1" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.4" />
              <path d="M1 5h20" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </div>
        )}
      </button>
    </div>
  );
}
