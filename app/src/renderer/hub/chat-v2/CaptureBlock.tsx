/**
 * CaptureBlock — recaptcha-style NxM tile picker rendered from a single
 * screenshot the agent emitted in a ```capture fence.
 *
 * The one image is sliced into rows×cols equal tiles purely via CSS
 * (`background-size` + `background-position`). The user toggles tiles;
 * submission returns the selected tile indices as the next user turn
 * shaped as:
 *
 *   Captcha selected tiles: 0, 2, 6
 *
 * The agent retains the captcha's page coordinates (it captured them
 * to clip the screenshot) and converts indices into per-tile click
 * coordinates on its side — the renderer never sends pixels back.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CapturePayload } from './htmlBlocks';
import { getSubmissionRecord, recordSubmission, submissionKey } from './optionListStore';
import './captureBlock.css';

interface Props {
  payload: CapturePayload | null;
  complete: boolean;
  error?: string;
  sessionId?: string;
  nextUserText?: string | null;
}

const SUBMIT_PREFIX = 'Captcha selected tiles:';

export function CaptureBlock(props: Props): React.ReactElement {
  const { payload, complete, error, sessionId, nextUserText } = props;
  if (!payload) {
    if (complete && error) {
      return (
        <div className="chatv2-capture" data-testid="chatv2-capture" data-state="error">
          <div className="chatv2-capture__error">capture block ignored: {error}</div>
        </div>
      );
    }
    return <CaptureSkeleton />;
  }
  return <CaptureReady payload={payload} sessionId={sessionId} streaming={!complete} nextUserText={nextUserText} />;
}

function CaptureSkeleton(): React.ReactElement {
  return (
    <div className="chatv2-capture" data-testid="chatv2-capture" data-state="loading">
      <div className="chatv2-capture__grid chatv2-capture__grid--skel" style={{ ['--rows' as string]: 3, ['--cols' as string]: 3 }}>
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="chatv2-capture__tile chatv2-capture__tile--skel" />
        ))}
      </div>
    </div>
  );
}

interface ReadyProps {
  payload: CapturePayload;
  sessionId?: string;
  streaming?: boolean;
  nextUserText?: string | null;
}

function CaptureReady({ payload, sessionId, streaming, nextUserText }: ReadyProps): React.ReactElement {
  const { image, prompt, target, targetImage, rows, cols } = payload;
  const tileCount = rows * cols;
  // Three-line reCAPTCHA banner: small lead-in / big bold target /
  // small trailer ("Click verify once there are none left."). When the
  // agent emits an explicit `target`, we trust it and treat `prompt` as
  // the lead. Otherwise we try to auto-split the prompt sentence to
  // recover the same layout from Google's standard phrasing.
  const parts = useMemo(
    () => splitCapturePrompt(prompt, target),
    [prompt, target],
  );
  const hasBanner = Boolean(parts.lead || parts.bold || parts.trailer);

  // Stable cache key so re-mounts in the same renderer session preserve state.
  const cacheKey = useMemo(
    () => `capture:${submissionKey(sessionId, [image, String(rows), String(cols)])}`,
    [sessionId, image, rows, cols],
  );
  const cachedRecord = useMemo(() => getSubmissionRecord(cacheKey), [cacheKey]);

  // Transcript-derived submission — reconstruct selection from a prior
  // "Captcha selected tiles: …" reply. Wins over the in-memory cache so
  // reopened sessions stay correct without DB persistence.
  const transcriptSelection = useMemo(
    () => deriveCaptureSubmission(nextUserText, tileCount),
    [nextUserText, tileCount],
  );

  const [selected, setSelected] = useState<Set<number>>(() => {
    if (transcriptSelection) return new Set(transcriptSelection);
    if (cachedRecord) {
      const set = new Set<number>();
      for (const id of cachedRecord.selectedIds) {
        const n = Number.parseInt(id, 10);
        if (Number.isInteger(n) && n >= 0 && n < tileCount) set.add(n);
      }
      return set;
    }
    return new Set<number>();
  });
  const [submitted, setSubmitted] = useState<boolean>(
    transcriptSelection !== null || cachedRecord !== null,
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [localSubmit, setLocalSubmit] = useState<boolean>(false);
  // Per-tile press-animation state so the scale-down feels tactile rather
  // than relying on CSS :active (which doesn't trigger on keyboard activation).
  const [pressing, setPressing] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  // Late-arriving transcript hydration — same pattern as AskForm.
  useEffect(() => {
    if (!transcriptSelection || localSubmit) return;
    setSelected(new Set(transcriptSelection));
    setSubmitted(true);
  }, [transcriptSelection, localSubmit]);

  const toggle = useCallback((idx: number): void => {
    if (submitted) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, [submitted]);

  const submit = useCallback(async (): Promise<void> => {
    if (submitted) return;
    if (!sessionId) {
      setSubmitError('no active session');
      return;
    }
    const sortedIndices = Array.from(selected).sort((a, b) => a - b);
    const message = sortedIndices.length === 0
      ? `${SUBMIT_PREFIX} (none)`
      : `${SUBMIT_PREFIX} ${sortedIndices.join(', ')}`;
    setLocalSubmit(true);
    setSubmitted(true);
    setSubmitError(null);
    try {
      const resume = window.electronAPI?.sessions?.resume;
      if (!resume) {
        setSubmitError('sessions bridge unavailable');
        setSubmitted(false);
        setLocalSubmit(false);
        return;
      }
      const result = await resume(sessionId, message);
      if (result?.error) {
        setSubmitError(result.error);
        setSubmitted(false);
        setLocalSubmit(false);
      } else {
        recordSubmission(cacheKey, sortedIndices.map((n) => String(n)));
      }
    } catch (err) {
      setSubmitError((err as Error).message);
      setSubmitted(false);
      setLocalSubmit(false);
    }
  }, [submitted, sessionId, selected, cacheKey]);

  const imageSrc = useMemo(() => {
    // The image path may already be a URL (chatfile://, data:, http(s):); only
    // wrap raw absolute paths into chatfile://files<abs>.
    if (/^[a-z]+:/i.test(image)) return image;
    return `chatfile://files${encodeURI(image)}`;
  }, [image]);

  const submitLabel = submitted
    ? 'Sent to agent'
    : selected.size === 0
      ? 'Confirm (no tiles)'
      : `Confirm ${selected.size} tile${selected.size === 1 ? '' : 's'}`;

  return (
    <div
      className={`chatv2-capture${submitted ? ' chatv2-capture--submitted' : ''}`}
      data-testid="chatv2-capture"
      data-state={streaming ? 'streaming' : submitted ? 'answered' : 'live'}
    >
      {hasBanner && (
        <div className="chatv2-capture__header" role="presentation">
          <div className="chatv2-capture__header-text">
            {parts.lead && <div className="chatv2-capture__header-prompt">{parts.lead}</div>}
            {parts.bold && <div className="chatv2-capture__header-target">{parts.bold}</div>}
            {parts.trailer && <div className="chatv2-capture__header-trailer">{parts.trailer}</div>}
          </div>
          {targetImage && (
            <img
              className="chatv2-capture__header-thumb"
              src={targetImage}
              alt=""
              loading="lazy"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          )}
        </div>
      )}
      <div
        ref={gridRef}
        className="chatv2-capture__grid"
        style={{
          ['--rows' as string]: rows,
          ['--cols' as string]: cols,
        }}
        role="group"
        aria-label={prompt ?? 'captcha tile selection'}
      >
        {Array.from({ length: tileCount }).map((_, i) => {
          const row = Math.floor(i / cols);
          const col = i % cols;
          // CSS background-size of (cols*100%, rows*100%) tiles the same image
          // at native size across all cells; background-position picks the slice.
          const bgX = cols === 1 ? 0 : (col / (cols - 1)) * 100;
          const bgY = rows === 1 ? 0 : (row / (rows - 1)) * 100;
          const isSel = selected.has(i);
          const isPressing = pressing === i;
          return (
            <button
              key={i}
              type="button"
              className="chatv2-capture__tile"
              data-selected={isSel ? 'true' : 'false'}
              data-pressing={isPressing ? 'true' : 'false'}
              aria-pressed={isSel}
              aria-label={`tile ${i + 1}`}
              disabled={submitted}
              style={{
                backgroundImage: `url("${imageSrc}")`,
                backgroundSize: `${cols * 100}% ${rows * 100}%`,
                backgroundPosition: `${bgX}% ${bgY}%`,
                ['--tile-index' as string]: i,
              }}
              onPointerDown={() => setPressing(i)}
              onPointerUp={() => setPressing((cur) => (cur === i ? null : cur))}
              onPointerLeave={() => setPressing((cur) => (cur === i ? null : cur))}
              onPointerCancel={() => setPressing((cur) => (cur === i ? null : cur))}
              onClick={() => toggle(i)}
            >
              <span className="chatv2-capture__check" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="14" height="14">
                  <path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
          );
        })}
      </div>
      <div className="chatv2-capture__foot">
        <button
          type="button"
          className="chatv2-capture__submit"
          disabled={submitted}
          onClick={() => { void submit(); }}
        >
          {submitLabel}
        </button>
        {submitError && (
          <span className="chatv2-capture__hint chatv2-capture__hint--err">{submitError}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Split a reCAPTCHA-style prompt into the three banner lines Google uses:
 *   - lead:    "Select all images with"
 *   - bold:    "a fire hydrant"   (the target subject, rendered large/bold)
 *   - trailer: "Click verify once there are none left."
 *
 * If the caller passed an explicit `target`, trust it and treat the rest of
 * `prompt` as lead/trailer. Otherwise regex-split the prompt at the first
 * "with X." pattern, which covers ~all standard challenges.
 *
 * Exported for tests.
 */
export function splitCapturePrompt(
  prompt: string | undefined,
  target: string | undefined,
): { lead: string; bold: string; trailer: string } {
  const p = (prompt || '').trim();
  const t = (target || '').trim();

  if (t) {
    if (!p) return { lead: 'Select all images with', bold: t, trailer: '' };
    // Try to find the target inside the prompt to recover lead/trailer.
    const idx = p.toLowerCase().indexOf(t.toLowerCase());
    if (idx >= 0) {
      const lead = p.slice(0, idx).replace(/[\s.]+$/, '').trim();
      const rest = p.slice(idx + t.length).replace(/^[\s.]+/, '').trim();
      return { lead: lead || 'Select all images with', bold: t, trailer: rest };
    }
    return { lead: p, bold: t, trailer: '' };
  }

  if (!p) return { lead: '', bold: '', trailer: '' };

  // Standard reCAPTCHA shape: "<lead> with <subject>. <trailer>"
  const withPeriod = p.match(/^(.*?\bwith)\s+(.+?)\.\s*(.*)$/i);
  if (withPeriod) {
    return {
      lead: withPeriod[1].trim(),
      bold: withPeriod[2].trim(),
      trailer: withPeriod[3].trim(),
    };
  }
  // Shape without trailer sentence: "<lead> with <subject>"
  const noPeriod = p.match(/^(.*?\bwith)\s+(.+)$/i);
  if (noPeriod) {
    return {
      lead: noPeriod[1].trim(),
      bold: noPeriod[2].trim(),
      trailer: '',
    };
  }
  // No recognizable shape — render the whole sentence at the small lead size.
  return { lead: p, bold: '', trailer: '' };
}

/**
 * Reverse of the submit format: parse "Captcha selected tiles: 0, 2, 6"
 * (or "Captcha selected tiles: (none)") into a Set<number> of tile
 * indices. Returns null when text isn't a capture reply.
 *
 * Exported for tests.
 */
export function deriveCaptureSubmission(
  text: string | null | undefined,
  tileCount: number,
): Set<number> | null {
  if (!text) return null;
  const head = text.trimStart();
  if (!head.startsWith(SUBMIT_PREFIX)) return null;
  const rest = head.slice(SUBMIT_PREFIX.length).trim();
  if (rest.length === 0) return new Set();
  if (rest.toLowerCase() === '(none)') return new Set();
  const out = new Set<number>();
  for (const part of rest.split(/[,\s]+/)) {
    if (!part) continue;
    const n = Number.parseInt(part, 10);
    if (Number.isInteger(n) && n >= 0 && n < tileCount) out.add(n);
  }
  return out;
}
