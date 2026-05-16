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

function createPreviewOwnerToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ownerHint(ownerToken: string): string {
  return ownerToken.slice(-8);
}

function previewLog(event: string, payload: Record<string, unknown>): void {
  console.info(`[BrowserPreview] ${event} ${JSON.stringify(payload)}`);
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
  const hasPreviewUrl = hostLabel !== null;
  const showFrame = frame !== null && hasPreviewUrl;

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    return api.on.sessionPreviewFrame((id, dataB64) => {
      if (id !== sessionId) return;
      frameCountRef.current += 1;
      const now = Date.now();
      if (frameCountRef.current === 1 || now - lastFrameLogAtRef.current >= 5000) {
        lastFrameLogAtRef.current = now;
        previewLog('frame', {
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
    const ownerToken = createPreviewOwnerToken();
    previewLog('start.request', {
      sessionId,
      owner: ownerHint(ownerToken),
      hasBrowser: sessionInfo.hasBrowser,
    });
    api.sessions.previewStart(sessionId, ownerToken)
      .then((res) => {
        previewLog('start.result', { sessionId, owner: ownerHint(ownerToken), ...res });
        if (active && !res.ok) setFrame(null);
      })
      .catch((err) => {
        console.warn(`[BrowserPreview] start.failed ${JSON.stringify({
          sessionId,
          owner: ownerHint(ownerToken),
          error: err instanceof Error ? err.message : String(err),
        })}`);
        if (active) setFrame(null);
      });

    return () => {
      active = false;
      previewLog('stop.request', {
        sessionId,
        owner: ownerHint(ownerToken),
        frames: frameCountRef.current,
      });
      api.sessions.previewStop(sessionId, ownerToken).catch(() => {});
    };
  }, [sessionId, sessionInfo.hasBrowser]);

  const onClick = useCallback(() => {
    previewLog('expand.click', { sessionId, frames: frameCountRef.current });
    setExpanding(true);
    setTimeout(() => onExpand(), 220);
  }, [onExpand, sessionId]);

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
        {showFrame ? (
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
