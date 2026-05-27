/**
 * AskForm — questionnaire surface rendered for an `ask` fenced block.
 *
 * Each question is a small card with the question text + header chip,
 * a list of radio (single-select) or checkbox (multi-select) options,
 * plus an "Other…" affordance (unless the question opts out via
 * `allowOther: false`) with a text input the user types into.
 *
 * Submission flow mirrors OptionList — on submit we call
 * `window.electronAPI.sessions.resume(id, formattedAnswers)` which
 * lands as the next user turn. The agent reads structured answers and
 * continues.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AskFormPayload, AskQuestion } from './htmlBlocks';
import { getSubmissionRecord, recordSubmission, submissionKey } from './optionListStore';
import './askForm.css';

interface Props {
  payload: AskFormPayload | null;
  complete: boolean;
  error?: string;
  sessionId?: string;
  /** User reply turn that follows this form, if any. Used to reconstruct
   *  the submitted answers in historical sessions — see OptionList for the
   *  same pattern. */
  nextUserText?: string | null;
}

const OTHER_TOKEN = '__other__';
const TRAILING_SKELETONS_WHILE_STREAMING = 1;

function questionCacheKey(question: AskQuestion): string {
  return JSON.stringify([question.header ?? '', question.question]);
}

function encodeAskSelection(question: AskQuestion, label: string): string {
  return JSON.stringify([questionCacheKey(question), label]);
}

function decodeAskSelection(value: string): { question: string; label: string } | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      Array.isArray(parsed)
      && parsed.length === 2
      && typeof parsed[0] === 'string'
      && typeof parsed[1] === 'string'
    ) {
      return { question: parsed[0], label: parsed[1] };
    }
  } catch {
    // Fall through to the legacy delimiter format for in-memory entries
    // written by older component instances in the same renderer lifetime.
  }
  const [qPrefix, ...labelParts] = value.split('::');
  if (!qPrefix || labelParts.length === 0) return null;
  return { question: qPrefix, label: labelParts.join('::') };
}

export function AskForm(props: Props): React.ReactElement {
  const { t } = useTranslation();
  const { payload, complete, error, sessionId, nextUserText } = props;
  if (!payload) {
    if (complete && error) {
      return (
        <div className="chatv2-askform" data-testid="chatv2-askform" data-state="error">
          <div className="chatv2-askform__error">{t('ask block ignored', { '1': error })}</div>
        </div>
      );
    }
    return <AskFormSkeleton />;
  }
  return <AskFormReady payload={payload} sessionId={sessionId} streaming={!complete} nextUserText={nextUserText} />;
}

function AskFormSkeleton(): React.ReactElement {
  return (
    <div className="chatv2-askform" data-testid="chatv2-askform" data-state="loading">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="chatv2-askform__question chatv2-askform__skel">
          <div className="chatv2-askform__skel-line chatv2-askform__skel-line--med" />
          {Array.from({ length: 3 }).map((__, j) => (
            <div key={j} className="chatv2-askform__skel-line chatv2-askform__skel-line--short" />
          ))}
        </div>
      ))}
    </div>
  );
}

interface ReadyProps {
  payload: AskFormPayload;
  sessionId?: string;
  streaming?: boolean;
  nextUserText?: string | null;
}

function AskFormReady({ payload, sessionId, streaming, nextUserText }: ReadyProps): React.ReactElement {
  const { t } = useTranslation();
  const { questions, prompt } = payload;
  const formRef = useRef<HTMLDivElement | null>(null);

  // Stable cache key — survives tab switches. Derived from sessionId +
  // the questions' text concatenated, since question text is stable for
  // the lifetime of the form's emission.
  const cacheKey = useMemo(() => {
    const ids = questions.map((q) => q.question);
    return `ask:${submissionKey(sessionId, ids)}`;
  }, [sessionId, questions]);
  const cachedRecord = useMemo(() => getSubmissionRecord(cacheKey), [cacheKey]);

  // Transcript-derived submission — read the user's next-turn reply for
  // an "Answered: …" block and reconstruct selection. Wins over the
  // in-memory cache so reopened sessions stay correct without persistence.
  const transcriptSubmission = useMemo(
    () => deriveAskSubmission(nextUserText, questions),
    [nextUserText, questions],
  );

  // Per-question selected labels. Use `Set<string>` so single + multi
  // share the same state shape; "Other" picks store the literal
  // OTHER_TOKEN. Per-question typed-other text in a parallel array.
  const [selectedByQuestion, setSelectedByQuestion] = useState<Set<string>[]>(
    () => questions.map((q, i) => {
      if (transcriptSubmission) return new Set(transcriptSubmission.selection[i]);
      if (!cachedRecord) return new Set();
      const qKey = questionCacheKey(q);
      const restored = new Set<string>();
      const validLabels = new Set([...q.options.map((o) => o.label), OTHER_TOKEN]);
      for (const id of cachedRecord.selectedIds) {
        const decoded = decodeAskSelection(id);
        if ((decoded?.question === qKey || decoded?.question === q.question) && validLabels.has(decoded.label)) {
          restored.add(decoded.label);
        }
      }
      return restored;
    }),
  );
  const [otherTextByQuestion, setOtherTextByQuestion] = useState<string[]>(
    () => questions.map((q) => (
      transcriptSubmission?.otherTextByKey[questionCacheKey(q)]
      ?? cachedRecord?.otherTextByKey?.[questionCacheKey(q)]
      ?? ''
    )),
  );
  const [submitted, setSubmitted] = useState<boolean>(
    transcriptSubmission !== null || cachedRecord !== null,
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Tracks "user clicked Confirm in this mount" vs "bootstrapped from
  // cache". Only a local submit makes our state authoritative — a cache
  // bootstrap is just a hint and should yield to a later-arriving
  // transcript, which is the durable source of truth. State (not a ref)
  // so toggling it back after a failed submit re-runs the hydration
  // effect to pick up any transcript that was already waiting.
  const [localSubmit, setLocalSubmit] = useState<boolean>(false);

  const locked = submitted;

  // Late-arriving transcript: if nextUserText hydrates after first paint
  // (streaming session restore, async transcript fetch), apply the derived
  // submission. Skip only when the user has submitted locally in this
  // mount — bootstrap-from-cache must not block transcript hydration.
  useEffect(() => {
    if (!transcriptSubmission || localSubmit) return;
    setSelectedByQuestion(questions.map((_, i) => new Set(transcriptSubmission.selection[i])));
    setOtherTextByQuestion(questions.map((q) => (
      transcriptSubmission.otherTextByKey[questionCacheKey(q)] ?? ''
    )));
    setSubmitted(true);
  }, [transcriptSubmission, localSubmit, questions]);

  const togglePick = useCallback((qIdx: number, label: string): void => {
    const q = questions[qIdx];
    if (!q) return;
    setSelectedByQuestion((prev) => {
      const next = prev.slice();
      const set = new Set(prev[qIdx]);
      if (q.multiSelect) {
        if (set.has(label)) set.delete(label);
        else set.add(label);
      } else {
        set.clear();
        set.add(label);
      }
      next[qIdx] = set;
      return next;
    });
  }, [questions]);

  const setOtherText = useCallback((qIdx: number, text: string): void => {
    setOtherTextByQuestion((prev) => {
      const next = prev.slice();
      next[qIdx] = text;
      return next;
    });
  }, []);

  // Each question must have AT LEAST one selection, and if "Other" is
  // picked the text must be non-empty.
  const canSubmit = useMemo(() => {
    return questions.length > 0 && questions.every((q, i) => {
      const sel = selectedByQuestion[i];
      if (!sel || sel.size === 0) return false;
      if (q.multiSelect) {
        if (sel.has(OTHER_TOKEN) && (otherTextByQuestion[i] ?? '').trim().length === 0) return false;
        return true;
      }
      // single-select
      if (sel.size !== 1) return false;
      if (sel.has(OTHER_TOKEN) && (otherTextByQuestion[i] ?? '').trim().length === 0) return false;
      return true;
    });
  }, [questions, selectedByQuestion, otherTextByQuestion]);

  const submitLabel = useMemo(() => {
    if (submitted) return t('Sent to agent');
    if (canSubmit) return t('Confirm answers');
    const unanswered = questions.reduce((n, _, i) => {
      const sel = selectedByQuestion[i];
      return n + (sel && sel.size > 0 ? 0 : 1);
    }, 0);
    if (unanswered === questions.length) return t('Answer to continue');
    if (unanswered > 0) return unanswered === 1 ? t('1 question left') : t('$1 questions left', { '1': unanswered });
    return t('Type your "Other" answer');
  }, [t, submitted, canSubmit, questions, selectedByQuestion]);

  const submit = useCallback(async (): Promise<void> => {
    if (!canSubmit || locked) return;
    if (!sessionId) {
      setSubmitError(t('no active session'));
      return;
    }
    const message = formatAnswerMessage(questions, selectedByQuestion, otherTextByQuestion, t);
    setLocalSubmit(true);
    setSubmitted(true);
    setSubmitError(null);
    try {
      const result = await window.electronAPI?.sessions?.resume(sessionId, message);
      if (result?.error) {
        setSubmitError(result.error);
        setSubmitted(false);
        setLocalSubmit(false);
      } else {
        // Persist enough to restore submitted view on remount.
        const flat: string[] = [];
        const otherTextByKey: Record<string, string> = {};
        for (let i = 0; i < questions.length; i++) {
          const sel = selectedByQuestion[i] ?? new Set<string>();
          const question = questions[i];
          for (const label of sel) flat.push(encodeAskSelection(question, label));
          otherTextByKey[questionCacheKey(question)] = otherTextByQuestion[i] ?? '';
        }
        recordSubmission(cacheKey, flat, { otherTextByKey });
      }
    } catch (err) {
      setSubmitError((err as Error).message);
      setSubmitted(false);
      setLocalSubmit(false);
    }
  }, [t, canSubmit, locked, sessionId, questions, selectedByQuestion, otherTextByQuestion, cacheKey]);

  // Auto-focus the first question on mount so kbd flow starts there.
  useEffect(() => {
    if (!submitted && formRef.current) {
      const firstInput = formRef.current.querySelector('input');
      if (firstInput instanceof HTMLInputElement) firstInput.focus({ preventScroll: true });
    }
  }, [submitted]);

  if (submitted) {
    return (
      <div className="chatv2-askform chatv2-askform--answered" data-testid="chatv2-askform" data-state="answered">
        <div className="chatv2-askform__head">
          <div className="chatv2-askform__prompt">{t('Answered:')}</div>
        </div>
        {questions.map((q, qi) => {
          const sel = selectedByQuestion[qi] ?? new Set<string>();
          if (sel.size === 0) return null;
          const labels: string[] = [];
          for (const label of sel) {
            if (label === OTHER_TOKEN) labels.push(t('Other: $1', { '1': otherTextByQuestion[qi] ?? '' }));
            else labels.push(label);
          }
          return (
            <div key={qi} className="chatv2-askform__answer">
              <div className="chatv2-askform__answer-label">{q.header || q.question}</div>
              <div className="chatv2-askform__answer-value">{labels.join(', ')}</div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={formRef}
      className="chatv2-askform"
      data-testid="chatv2-askform"
      data-state={streaming ? 'streaming' : 'live'}
    >
      {prompt && (
        <div className="chatv2-askform__head">
          <div className="chatv2-askform__prompt">{prompt}</div>
        </div>
      )}

      {questions.map((q, qi) => (
        <QuestionCard
          key={qi}
          question={q}
          selected={selectedByQuestion[qi] ?? new Set()}
          otherText={otherTextByQuestion[qi] ?? ''}
          locked={locked}
          onToggle={(label) => togglePick(qi, label)}
          onOtherChange={(text) => setOtherText(qi, text)}
        />
      ))}

      {streaming && Array.from({ length: TRAILING_SKELETONS_WHILE_STREAMING }).map((_, i) => (
        <div key={`skel-${i}`} className="chatv2-askform__question chatv2-askform__skel" aria-hidden="true">
          <div className="chatv2-askform__skel-line chatv2-askform__skel-line--med" />
          <div className="chatv2-askform__skel-line chatv2-askform__skel-line--short" />
        </div>
      ))}

      <div className="chatv2-askform__foot">
        <button
          type="button"
          className="chatv2-askform__submit"
          disabled={!canSubmit || locked}
          onClick={() => { void submit(); }}
        >
          {submitLabel}
        </button>
        {submitError && (
          <span className="chatv2-askform__hint" style={{ color: '#ff7a7a' }}>{submitError}</span>
        )}
      </div>
    </div>
  );
}

interface QuestionProps {
  question: AskQuestion;
  selected: Set<string>;
  otherText: string;
  locked: boolean;
  onToggle: (label: string) => void;
  onOtherChange: (text: string) => void;
}

function QuestionCard({ question, selected, otherText, locked, onToggle, onOtherChange }: QuestionProps): React.ReactElement {
  const { t } = useTranslation();
  const inputType = question.multiSelect ? 'checkbox' : 'radio';
  return (
    <div className="chatv2-askform__question">
      <div className="chatv2-askform__question-head">
        <span className="chatv2-askform__question-text">{question.question}</span>
      </div>
      <ul className="chatv2-askform__options" role={question.multiSelect ? 'group' : 'radiogroup'}>
        {question.options.map((opt, oi) => (
          <li key={oi} className="chatv2-askform__option">
            <label className="chatv2-askform__row">
              <input
                type={inputType}
                checked={selected.has(opt.label)}
                disabled={locked}
                onChange={() => onToggle(opt.label)}
              />
              <span className="chatv2-askform__option-label">{opt.label}</span>
              {opt.description && (
                <span className="chatv2-askform__option-desc">{opt.description}</span>
              )}
            </label>
          </li>
        ))}
        {question.allowOther && (
          <li className="chatv2-askform__option chatv2-askform__option--other">
            <label className="chatv2-askform__row">
              <input
                type={inputType}
                checked={selected.has(OTHER_TOKEN)}
                disabled={locked}
                onChange={() => onToggle(OTHER_TOKEN)}
              />
              <span className="chatv2-askform__option-label">{t('Other')}</span>
              <input
                type="text"
                className="chatv2-askform__other-input"
                placeholder={t('type your answer…')}
                value={otherText}
                disabled={locked || !selected.has(OTHER_TOKEN)}
                onChange={(e) => onOtherChange(e.target.value)}
                onFocus={() => { if (!selected.has(OTHER_TOKEN)) onToggle(OTHER_TOKEN); }}
              />
            </label>
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * Reverse of formatAnswerMessage: parse the user-reply turn that follows
 * this form and reconstruct which options were chosen per question.
 * Returns null when the text isn't an "Answered: …" reply for this form.
 *
 * Exported for tests.
 */
export function deriveAskSubmission(
  text: string | null | undefined,
  questions: AskQuestion[],
): { selection: Set<string>[]; otherTextByKey: Record<string, string> } | null {
  if (!text) return null;
  const head = text.trimStart();
  if (!head.startsWith('Answered:')) return null;

  const selection: Set<string>[] = questions.map(() => new Set<string>());
  const otherTextByKey: Record<string, string> = {};

  for (const rawLine of text.split('\n')) {
    const m = rawLine.match(/^-\s*([^:]+):\s*(.+)$/);
    if (!m) continue;
    const labelPrefix = m[1].trim();
    const valuesStr = m[2].trim();
    const qIdx = questions.findIndex((q) => (q.header || q.question) === labelPrefix);
    if (qIdx < 0) continue;

    // Values are comma-separated. A free-text `Other: <text>` answer can
    // itself contain commas, so we can't blindly split. Strategy: find
    // ", Other:" (or a leading "Other:") and treat everything from there
    // to the end of the line as a single Other value. The remainder is
    // safe to split on /,\s+/ because predefined option labels are
    // controlled by the agent and don't carry user free text.
    let valuesPart = valuesStr;
    let otherTail: string | null = null;
    const otherIdx = (() => {
      const leading = valuesPart.match(/^Other(?::|$)/);
      if (leading) return 0;
      const m = valuesPart.match(/,\s+Other(?::|$)/);
      return m && m.index !== undefined ? m.index + m[0].indexOf('Other') : -1;
    })();
    if (otherIdx >= 0) {
      otherTail = valuesPart.slice(otherIdx);
      valuesPart = valuesPart.slice(0, otherIdx).replace(/,\s*$/, '');
    }
    for (const raw of valuesPart.split(/,\s+/)) {
      const v = raw.trim();
      if (!v) continue;
      selection[qIdx].add(v);
    }
    if (otherTail !== null) {
      selection[qIdx].add(OTHER_TOKEN);
      if (otherTail.startsWith('Other:')) {
        otherTextByKey[questionCacheKey(questions[qIdx])] = otherTail.slice('Other:'.length).trim();
      }
    }
  }

  if (selection.every((s) => s.size === 0)) return null;
  return { selection, otherTextByKey };
}

function formatAnswerMessage(
  questions: AskQuestion[],
  selectedByQuestion: Set<string>[],
  otherTextByQuestion: string[],
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const lines: string[] = [];
  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi];
    const sel = selectedByQuestion[qi] ?? new Set<string>();
    if (sel.size === 0) continue;
    const labelPrefix = q.header || q.question;
    const values: string[] = [];
    for (const label of sel) {
      if (label === OTHER_TOKEN) {
        const text = otherTextByQuestion[qi]?.trim() ?? '';
        values.push(text ? t('Other: $1', { '1': text }) : t('Other'));
      } else {
        values.push(label);
      }
    }
    lines.push(`- ${labelPrefix}: ${values.join(', ')}`);
  }
  return `${t('Answered:')}\n${lines.join('\n')}`;
}
