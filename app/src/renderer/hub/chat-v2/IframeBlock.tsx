/**
 * IframeBlock — embeds an arbitrary URL the agent emitted in a ```iframe
 * fence directly inside the chat turn. The user interacts with the real
 * remote document; when they click the foot button the agent resumes
 * with "Iframe interaction complete." as the next user turn.
 *
 * Pure read-only proxy: this component does not (and cannot) read the
 * iframe's contents back, so the agent learns *that* the user finished,
 * not *what* they did. See iframe-block.md for the limits of this model.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IframePayload } from './htmlBlocks';
import { getSubmissionRecord, recordSubmission, submissionKey } from './optionListStore';
import './iframeBlock.css';

interface Props {
  payload: IframePayload | null;
  complete: boolean;
  error?: string;
  sessionId?: string;
  nextUserText?: string | null;
}

const SUBMIT_PREFIX = 'Iframe interaction complete';
const SKIP_PREFIX = 'Iframe skipped';

export function IframeBlock(props: Props): React.ReactElement {
  const { payload, complete, error, sessionId, nextUserText } = props;
  if (!payload) {
    if (complete && error) {
      return (
        <div className="chatv2-iframe" data-testid="chatv2-iframe" data-state="error">
          <div className="chatv2-iframe__error">iframe block ignored: {error}</div>
        </div>
      );
    }
    return (
      <div className="chatv2-iframe" data-testid="chatv2-iframe" data-state="loading">
        <div className="chatv2-iframe__skel" />
      </div>
    );
  }
  return <IframeReady payload={payload} sessionId={sessionId} streaming={!complete} nextUserText={nextUserText} />;
}

interface ReadyProps {
  payload: IframePayload;
  sessionId?: string;
  streaming?: boolean;
  nextUserText?: string | null;
}

function IframeReady({ payload, sessionId, streaming, nextUserText }: ReadyProps): React.ReactElement {
  const { url, prompt, width, height, submitLabel } = payload;
  const cacheKey = useMemo(
    () => `iframe:${submissionKey(sessionId, [url])}`,
    [sessionId, url],
  );
  const cachedRecord = useMemo(() => getSubmissionRecord(cacheKey), [cacheKey]);

  const transcriptResolved = useMemo(() => deriveIframeSubmission(nextUserText), [nextUserText]);

  const [submitted, setSubmitted] = useState<boolean>(
    transcriptResolved !== null || cachedRecord !== null,
  );
  const [skipped, setSkipped] = useState<boolean>(
    (transcriptResolved && transcriptResolved.skipped) || (cachedRecord?.selectedIds?.[0] === 'skipped') || false,
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [localSubmit, setLocalSubmit] = useState<boolean>(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'errored'>('loading');
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!transcriptResolved || localSubmit) return;
    setSubmitted(true);
    setSkipped(transcriptResolved.skipped);
  }, [transcriptResolved, localSubmit]);

  const resume = useCallback(
    async (message: string, marker: string): Promise<void> => {
      if (submitted) return;
      if (!sessionId) {
        setSubmitError('no active session');
        return;
      }
      const sessionsResume = window.electronAPI?.sessions?.resume;
      if (!sessionsResume) {
        setSubmitError('sessions bridge unavailable');
        return;
      }
      setLocalSubmit(true);
      setSubmitted(true);
      setSubmitError(null);
      try {
        const result = await sessionsResume(sessionId, message);
        if (result?.error) {
          setSubmitError(result.error);
          setSubmitted(false);
          setLocalSubmit(false);
        } else {
          recordSubmission(cacheKey, [marker]);
        }
      } catch (err) {
        setSubmitError((err as Error).message);
        setSubmitted(false);
        setLocalSubmit(false);
      }
    },
    [submitted, sessionId, cacheKey],
  );

  const onDone = useCallback(() => {
    setSkipped(false);
    void resume(`${SUBMIT_PREFIX}.`, 'done');
  }, [resume]);

  const onSkip = useCallback(() => {
    setSkipped(true);
    void resume(`${SKIP_PREFIX}.`, 'skipped');
  }, [resume]);

  const buttonLabel = submitted
    ? skipped
      ? 'Skipped'
      : 'Sent to agent'
    : (submitLabel || "I'm done");

  return (
    <div
      className={`chatv2-iframe${submitted ? ' chatv2-iframe--submitted' : ''}`}
      data-testid="chatv2-iframe"
      data-state={streaming ? 'streaming' : submitted ? 'answered' : 'live'}
    >
      {prompt && <div className="chatv2-iframe__prompt">{prompt}</div>}
      <div
        className="chatv2-iframe__frame-wrap"
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        {loadState === 'loading' && (
          <div className="chatv2-iframe__overlay">loading <span className="chatv2-iframe__url">{hostOf(url)}</span>…</div>
        )}
        {loadState === 'errored' && (
          <div className="chatv2-iframe__overlay chatv2-iframe__overlay--err">
            unable to display {hostOf(url)} inside chat — the remote document refused embedding
          </div>
        )}
        <iframe
          ref={iframeRef}
          className="chatv2-iframe__frame"
          src={url}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          referrerPolicy="no-referrer-when-downgrade"
          onLoad={() => setLoadState('ready')}
          onError={() => setLoadState('errored')}
          title={prompt || hostOf(url)}
        />
      </div>
      <div className="chatv2-iframe__foot">
        <button
          type="button"
          className="chatv2-iframe__submit"
          disabled={submitted}
          onClick={onDone}
        >
          {buttonLabel}
        </button>
        {!submitted && (
          <button
            type="button"
            className="chatv2-iframe__skip"
            onClick={onSkip}
          >
            Skip
          </button>
        )}
        {submitError && (
          <span className="chatv2-iframe__hint chatv2-iframe__hint--err">{submitError}</span>
        )}
      </div>
    </div>
  );
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
}

/**
 * Reverse the submit format: "Iframe interaction complete." or
 * "Iframe skipped." → { skipped: boolean }. Returns null if the text
 * isn't an iframe-block reply.
 *
 * Exported for tests.
 */
export function deriveIframeSubmission(
  text: string | null | undefined,
): { skipped: boolean } | null {
  if (!text) return null;
  const head = text.trimStart();
  if (head.startsWith(SUBMIT_PREFIX)) return { skipped: false };
  if (head.startsWith(SKIP_PREFIX)) return { skipped: true };
  return null;
}
