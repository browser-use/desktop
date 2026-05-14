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
export function BrowserPreview({ sessionId, onExpand }: BrowserPreviewProps): React.ReactElement | null {
  const sessionInfo = useSessionsStore(
    useShallow((s) => {
      const sess = s.byId[sessionId];
      if (!sess) return { hasBrowser: false, status: 'idle' as const, lastUrl: null as string | null };
      return { hasBrowser: !!sess.hasBrowser, status: sess.status, lastUrl: sess.lastUrl ?? null };
    }),
  );

  // Treat only real navigations as "we have a browser to show". about:blank,
  // chrome://newtab, data: / file: URLs and any pre-navigation state get
  // filtered out so the preview doesn't render an empty white tile.
  const isRealUrl = (() => {
    const u = sessionInfo.lastUrl;
    if (!u) return false;
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      if (!parsed.host) return false;
      return true;
    } catch {
      return false;
    }
  })();

  const hostLabel = (() => {
    if (!isRealUrl) return null;
    const u = sessionInfo.lastUrl as string;
    try { return new URL(u).host; } catch { return u; }
  })();

  const shouldShow = sessionInfo.hasBrowser && isRealUrl;

  const [frame, setFrame] = useState<string | null>(null);
  const [expanding, setExpanding] = useState(false);
  const cardRef = useRef<HTMLButtonElement>(null);

  // Diagnostic refs — kept out of state to avoid re-rendering on every frame.
  const lastFrameAtRef = useRef<number | null>(null);
  const lastFingerprintRef = useRef<string | null>(null);
  const dupCountRef = useRef(0);
  const frameCountRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const stallWarnedRef = useRef(false);

  // Listen for frames unconditionally — cheap, and a late-arriving stream
  // attaches without a remount.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    let lastLog = 0;
    return api.on.sessionPreviewFrame((id, dataB64) => {
      if (id !== sessionId) {
        // Different session's frame arriving on this subscription — diagnostic
        // signal in case routing ever crosses streams.
        console.debug('[BrowserPreview] frame.dropped.foreign-session', { mySession: sessionId, frameFor: id });
        return;
      }
      const now = Date.now();
      const prevAt = lastFrameAtRef.current;
      const gapMs = prevAt == null ? null : now - prevAt;
      lastFrameAtRef.current = now;
      frameCountRef.current += 1;

      // Cheap content fingerprint to catch "screencast running but page not
      // repainting" — captureScreenshot keeps returning the same JPEG bytes
      // when nothing on the page has changed (or when the WebContents is
      // suspended because its BrowserView is detached).
      const fp = `${dataB64.length}:${dataB64.slice(0, 32)}:${dataB64.slice(-16)}`;
      const dup = fp === lastFingerprintRef.current;
      if (dup) dupCountRef.current += 1; else dupCountRef.current = 0;
      lastFingerprintRef.current = fp;

      stallWarnedRef.current = false;

      if (now - lastLog > 5000) {
        lastLog = now;
        console.log('[BrowserPreview] frames.received', {
          sessionId,
          count: frameCountRef.current,
          bytes: dataB64.length,
          gapMs,
          dupCount: dupCountRef.current,
        });
      }
      if (dupCountRef.current === 5) {
        console.warn('[BrowserPreview] frames.stale.duplicates', {
          sessionId,
          dupCount: dupCountRef.current,
          message: 'Same screenshot bytes 5x in a row — page likely suspended or not repainting',
        });
      }
      setFrame(dataB64);
    });
  }, [sessionId]);

  // Start/stop the screencast in lockstep with shouldShow. We wait for an
  // actual http(s) navigation before starting — no point attaching the
  // debugger to capture about:blank.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api || !shouldShow) {
      if (!shouldShow && startedAtRef.current != null) {
        console.log('[BrowserPreview] hide: clearing frame', {
          sessionId,
          framesSeen: frameCountRef.current,
        });
      }
      startedAtRef.current = null;
      lastFrameAtRef.current = null;
      frameCountRef.current = 0;
      dupCountRef.current = 0;
      lastFingerprintRef.current = null;
      stallWarnedRef.current = false;
      setFrame(null);
      return;
    }
    let cancelled = false;
    const startedAt = Date.now();
    startedAtRef.current = startedAt;
    console.log('[BrowserPreview] previewStart.requested', { sessionId });
    api.sessions.previewStart(sessionId, { maxWidth: PREVIEW_W * 2, maxHeight: PREVIEW_H * 2 })
      .then((res) => {
        const elapsedMs = Date.now() - startedAt;
        if (cancelled) {
          console.log('[BrowserPreview] previewStart.cancelled-after-resolve', { sessionId, elapsedMs, ok: res.ok });
          api.sessions.previewStop(sessionId).catch(() => { /* ignore */ });
          return;
        }
        if (res.ok) {
          console.log('[BrowserPreview] previewStart.ok', { sessionId, elapsedMs });
        } else {
          console.warn('[BrowserPreview] previewStart.not-ok', { sessionId, elapsedMs, reason: res.reason });
        }
      })
      .catch((err) => console.error('[BrowserPreview] previewStart.threw', { sessionId, error: (err as Error).message }));

    return () => {
      cancelled = true;
      api.sessions.previewStop(sessionId).catch(() => { /* ignore */ });
    };
  }, [sessionId, shouldShow]);

  // Stall watchdog — when shouldShow is true and previewStart resolved, we
  // expect a frame within ~1.5s (poll interval is 1s). If nothing arrives
  // within 3s, log a STALL warning so the user can grep for it. The
  // common cause is the WebContents being suspended while detached from
  // the window — clicking through to the browser view forces a paint and
  // the next captureScreenshot picks it up.
  useEffect(() => {
    if (!shouldShow) return;
    const handle = setInterval(() => {
      const startedAt = startedAtRef.current;
      if (startedAt == null) return;
      const now = Date.now();
      const sinceStart = now - startedAt;
      const lastAt = lastFrameAtRef.current;
      const sinceLast = lastAt == null ? null : now - lastAt;

      // Case 1: never received a frame.
      if (lastAt == null && sinceStart > 3000 && !stallWarnedRef.current) {
        stallWarnedRef.current = true;
        console.warn('[BrowserPreview] STALL.no-first-frame', {
          sessionId,
          sinceStartMs: sinceStart,
          message: 'previewStart resolved but no session-preview-frame received — check SessionScreencast logs',
        });
        return;
      }
      // Case 2: had frames, then they stopped.
      if (sinceLast != null && sinceLast > 4000 && !stallWarnedRef.current) {
        stallWarnedRef.current = true;
        console.warn('[BrowserPreview] STALL.frames-stopped', {
          sessionId,
          sinceLastFrameMs: sinceLast,
          framesSeen: frameCountRef.current,
          message: 'Frames were flowing then stopped — debugger may have errored, see SessionScreencast.capture.error logs',
        });
      }
    }, 1000);
    return () => clearInterval(handle);
  }, [sessionId, shouldShow]);

  const onClick = useCallback(() => {
    setExpanding(true);
    setTimeout(() => onExpand(), 220);
  }, [onExpand]);

  // Don't render the rail at all until the agent has actually navigated to
  // a real URL. Prevents the dead/blank tile that appears while the browser
  // is still on about:blank.
  if (!shouldShow) return null;

  return (
    <div className="browser-preview__wrap">
      {hostLabel && (
        <span className="browser-preview__url" title={sessionInfo.lastUrl ?? undefined}>
          {hostLabel}
        </span>
      )}
      <button
        ref={cardRef}
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
