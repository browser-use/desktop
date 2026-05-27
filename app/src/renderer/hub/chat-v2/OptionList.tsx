/**
 * OptionList — selectable picker rendered for an `options` fenced block.
 *
 * The shopping agent emits a fence carrying a JSON payload describing
 * which products the user should choose between (see the
 * `options-block` interaction skill). The agent ends its turn after
 * emitting the fence; this component drives the human-in-the-loop
 * selection and, on submit, resumes the same session with a structured
 * "Selected: …" message that the agent reads on its next turn.
 *
 * States:
 *   - skeleton:   the fence is still streaming (or just opened) and we
 *                 don't have a parsed payload yet — render shimmer cards.
 *   - error:      the closed block failed to parse — show a small
 *                 explanation; the agent itself sees its own bad emission
 *                 and can recover.
 *   - live:       the latest block, session is idle waiting for a pick —
 *                 cards are clickable, Choose buttons wired.
 *   - chosen:     user picked one of the listed options — compact receipt
 *                 (44px thumb + "Chose: X" + site · price).
 *   - other-chosen: user used the Other affordance.
 *   - cancelled:  session ended before any pick — cards dim, no interaction.
 *
 * NOTE: If an `options-block` interaction skill doc exists in the repo,
 * it needs updating to reflect: url required, site required (brand token
 * only — "Amazon" not "amazon.co.uk"), allowOther defaults to false.
 *
 * Keyboard:
 *   ← →  ↑ ↓   move focus
 *   space      toggle (multi-select)
 *   enter      single-select: pick + submit; multi-select: submit when valid
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OptionItem, OptionListPayload, OptionListSection } from './htmlBlocks';
import { getSubmission, getSubmissionRecord, recordSubmission, submissionKey } from './optionListStore';
import './optionList.css';

interface Props {
  payload: OptionListPayload | null;
  complete: boolean;
  error?: string;
  sessionId?: string;
  /** When true, the session ended before any pick was made. Cards are
   *  dimmed and non-interactive; a banner replaces the foot. */
  cancelled?: boolean;
  /** Text of the user message immediately following this picker's turn,
   *  if any. When it matches the "Selected from options: …" format the
   *  picker initialises in submitted state with that selection — that's
   *  how reopened/historical sessions get the collapsed receipt view
   *  without any client-side cache. */
  nextUserText?: string | null;
}

const SKELETON_COUNT = 3;

export function OptionList(props: Props): React.ReactElement {
  const { t } = useTranslation();
  const { payload, complete, error, sessionId, cancelled, nextUserText } = props;

  // Streaming with no options parsed yet — show a full skeleton screen.
  if (!payload) {
    if (complete && error) {
      return (
        <div className="chatv2-optlist" data-testid="chatv2-optlist" data-state="error">
          <div className="chatv2-optlist__error">{t('options block ignored: $1', { '1': error })}</div>
        </div>
      );
    }
    return <OptionListSkeleton />;
  }

  return (
    <OptionListReady
      payload={payload}
      sessionId={sessionId}
      streaming={!complete}
      cancelled={cancelled}
      nextUserText={nextUserText}
    />
  );
}

function OptionListSkeleton(): React.ReactElement {
  return (
    <div className="chatv2-optlist" data-testid="chatv2-optlist" data-state="loading">
      <div className="chatv2-optlist__head">
        <div className="chatv2-optlist__skel-line chatv2-optlist__skel-line--med" />
      </div>
      <div className="chatv2-optlist__grid" aria-hidden="true">
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <div key={i} className="chatv2-optlist__skel-card">
            <div className="chatv2-optlist__skel-panel" />
            <div className="chatv2-optlist__skel-body">
              <div className="chatv2-optlist__skel-line chatv2-optlist__skel-line--med" />
              <div className="chatv2-optlist__skel-line chatv2-optlist__skel-line--short" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ReadyProps {
  payload: OptionListPayload;
  sessionId?: string;
  streaming?: boolean;
  cancelled?: boolean;
  nextUserText?: string | null;
}

const OTHER_TOKEN = '__other__';

/** Returns a Google favicon URL for a given product URL. Falls back to
 *  undefined when the URL cannot be parsed. */
function siteFaviconUrl(url: string): string | undefined {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
  } catch {
    return undefined;
  }
}

function canSubmitSelection(
  sections: OptionListSection[],
  selectedBySection: Set<string>[],
  otherTextBySection: string[],
): boolean {
  return sections.every((sec, i) => {
    const sel = selectedBySection[i] ?? new Set<string>();
    const n = sel.size;
    const boundsOk = sec.multiSelect ? (n >= sec.min && n <= sec.max) : (n === 1);
    if (!boundsOk) return false;
    if (sel.has(OTHER_TOKEN) && (otherTextBySection[i] ?? '').trim().length === 0) return false;
    return true;
  });
}

/** Subtitle rendered under the section's source line when multi-select is
 *  enabled. Tells the user upfront how many they can pick + tracks the
 *  running count as they Add cards. */
function multiSelectHint(sec: OptionListSection, picked: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const total = sec.options.length;
  let prefix: string;
  if (sec.min === sec.max && sec.min > 0) prefix = t('Pick exactly $1', { '1': sec.min });
  else if (sec.min > 0 && sec.max < total) prefix = t('Pick $1–$2', { '1': sec.min, '2': sec.max });
  else if (sec.min > 0) prefix = t('Pick at least $1', { '1': sec.min });
  else prefix = t('Pick any');
  const count = picked > 0 ? ` · ${t('$1 added', { '1': picked })}` : '';
  return `${prefix}${count}`;
}

function OptionListReady({ payload, sessionId, streaming, cancelled, nextUserText }: ReadyProps): React.ReactElement {
  const { t } = useTranslation();
  const { sections, prompt } = payload;
  const multi = sections.length > 1;

  // Effective field schema per section: agent-declared (preserves intent
  // + order), else the union of every option's field keys in first-seen
  // order across that section. Missing fields are simply omitted per card.
  const effectiveSchemas = useMemo<string[][]>(() => sections.map((sec) => {
    if (sec.fieldSchema && sec.fieldSchema.length > 0) return sec.fieldSchema;
    const seen: string[] = [];
    for (const opt of sec.options) {
      if (!opt.fields) continue;
      for (const key of Object.keys(opt.fields)) {
        if (!seen.includes(key)) seen.push(key);
      }
    }
    return seen;
  }), [sections]);

  // Per-section: detect whether all cards share the same site so we can
  // hoist a single source attribution line into the section head.
  const sectionSingleSite = useMemo<(string | null)[]>(() => sections.map((sec) => {
    if (sec.options.length === 0) return null;
    const first = sec.options[0].site;
    return sec.options.every((o) => o.site === first) ? first : null;
  }), [sections]);

  // Stable cache key — covers ChatTurn unmounts on tab switch (in-memory
  // only; cross-reload state is derived from the transcript below).
  const cacheKey = useMemo(() => {
    const allIds: string[] = [];
    for (const sec of sections) for (const o of sec.options) allIds.push(o.id);
    return submissionKey(sessionId, allIds);
  }, [sessionId, sections]);
  const cachedSelection = useMemo(() => getSubmission(cacheKey), [cacheKey]);
  const cachedRecord = useMemo(() => getSubmissionRecord(cacheKey), [cacheKey]);

  // Source of truth across reloads: the user's reply turn directly after
  // this picker's turn. If it matches the "Selected from options: …" format
  // and references any of THIS picker's option IDs, treat the picker as
  // submitted with that selection — no client cache required.
  const transcriptSubmission = useMemo(
    () => deriveSubmissionFromTranscript(nextUserText, sections),
    [nextUserText, sections],
  );

  // Per-section selected ids. Transcript wins over the in-memory cache so
  // historical sessions render identically across reloads.
  const [selectedBySection, setSelectedBySection] = useState<Set<string>[]>(
    () => sections.map((sec, i) => {
      if (transcriptSubmission) return new Set(transcriptSubmission.selection[i]);
      if (!cachedSelection) return new Set<string>();
      const valid = new Set([...sec.options.map((o) => o.id), OTHER_TOKEN]);
      return new Set([...cachedSelection].filter((id) => valid.has(id)));
    }),
  );
  const [otherTextBySection, setOtherTextBySection] = useState<string[]>(
    () => sections.map((_, i) => (
      transcriptSubmission?.otherText[i] ?? cachedRecord?.otherText?.[i] ?? ''
    )),
  );
  const [cursor, setCursor] = useState<{ section: number; option: number }>({ section: 0, option: 0 });
  const [submitted, setSubmitted] = useState<boolean>(
    transcriptSubmission !== null || cachedSelection !== null,
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const gridRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Tracks "user clicked submit in this mount" vs "bootstrapped from
  // cache". Only a local submit makes our state authoritative — a cache
  // bootstrap is just a hint and should yield to a later-arriving
  // transcript, which is the durable source of truth. State (not a ref)
  // so toggling it back after a failed submit re-runs the hydration
  // effect to pick up any transcript that was already waiting.
  const [localSubmit, setLocalSubmit] = useState<boolean>(false);

  // Late-arriving transcript: if nextUserText hydrates after first paint
  // (streaming restore / async transcript fetch), apply the derived
  // submission. Skip only when the user has submitted locally in this
  // mount — bootstrap-from-cache must not block transcript hydration.
  useEffect(() => {
    if (!transcriptSubmission || localSubmit) return;
    setSelectedBySection(sections.map((_, i) => new Set(transcriptSubmission.selection[i])));
    setOtherTextBySection(transcriptSubmission.otherText.slice());
    setSubmitted(true);
  }, [transcriptSubmission, localSubmit, sections]);

  const locked = submitted || (cancelled ?? false);

  const toggle = useCallback((sectionIdx: number, optionIdx: number): void => {
    const sec = sections[sectionIdx];
    const opt = sec?.options[optionIdx];
    if (!opt) return;
    setSelectedBySection((prev) => {
      const next = prev.slice();
      const set = new Set(prev[sectionIdx]);
      if (sec.multiSelect) {
        if (set.has(opt.id)) set.delete(opt.id);
        else if (set.size < sec.max) set.add(opt.id);
      } else {
        set.clear();
        set.add(opt.id);
      }
      next[sectionIdx] = set;
      return next;
    });
  }, [sections]);

  const canSubmit = useMemo(() => {
    return canSubmitSelection(sections, selectedBySection, otherTextBySection);
  }, [sections, selectedBySection, otherTextBySection]);

  const totalSelected = useMemo(
    () => selectedBySection.reduce((sum, s) => sum + s.size, 0),
    [selectedBySection],
  );

  const submit = useCallback(async (selectionOverride?: Set<string>[]): Promise<void> => {
    const selected = selectionOverride ?? selectedBySection;
    if (!canSubmitSelection(sections, selected, otherTextBySection) || locked) return;
    if (!sessionId) {
      setSubmitError(t('no active session'));
      return;
    }
    const pickedAcross: { section: OptionListSection; picked: OptionItem[]; otherText: string }[] = sections.map((sec, i) => {
      const ids = selected[i] ?? new Set<string>();
      const otherText = ids.has(OTHER_TOKEN) ? (otherTextBySection[i] ?? '').trim() : '';
      return { section: sec, picked: sec.options.filter((o) => ids.has(o.id)), otherText };
    });
    const message = formatSelectionMessage(pickedAcross, t);
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
        const flat: string[] = [];
        for (let i = 0; i < sections.length; i++) {
          const ids = selected[i] ?? new Set<string>();
          for (const id of ids) flat.push(id);
        }
        recordSubmission(cacheKey, flat, { otherText: otherTextBySection });
      }
    } catch (err) {
      setSubmitError((err as Error).message);
      setSubmitted(false);
      setLocalSubmit(false);
    }
  }, [locked, sessionId, sections, selectedBySection, otherTextBySection, cacheKey]);

  // Per-card choose handler for single-select: pick + submit immediately.
  const chooseCard = useCallback((sectionIdx: number, optionIdx: number): void => {
    if (locked) return;
    const sec = sections[sectionIdx];
    if (!sec?.options[optionIdx]) return;
    if (!sec.multiSelect) {
      // Single-select: set selection and submit immediately.
      const opt = sec.options[optionIdx];
      const next = selectedBySection.map((set, idx) => (
        idx === sectionIdx ? new Set<string>([opt.id]) : new Set(set)
      ));
      setSelectedBySection(next);
      void submit(next);
    } else {
      // Multi-select: just toggle; foot Confirm aggregates.
      toggle(sectionIdx, optionIdx);
    }
  }, [locked, sections, selectedBySection, submit, toggle]);

  const handleSectionKey = useCallback((sectionIdx: number, e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (locked) return;
    const sec = sections[sectionIdx];
    if (!sec || sec.options.length === 0) return;
    const n = sec.options.length;
    const cur = cursor.section === sectionIdx ? cursor.option : 0;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        setCursor({ section: sectionIdx, option: (cur + 1) % n });
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        setCursor({ section: sectionIdx, option: (cur - 1 + n) % n });
        break;
      case ' ':
        e.preventDefault();
        toggle(sectionIdx, cur);
        break;
      case 'Enter':
        e.preventDefault();
        if (multi) {
          if (canSubmit) void submit();
        } else if (sec.multiSelect) {
          if (canSubmit) void submit();
        } else {
          const opt = sec.options[cur];
          if (!opt) return;
          const next = selectedBySection.map((set, idx) => (
            idx === sectionIdx ? new Set<string>([opt.id]) : new Set(set)
          ));
          setSelectedBySection(next);
          void submit(next);
        }
        break;
      default:
        break;
    }
  }, [locked, sections, cursor, multi, canSubmit, selectedBySection, submit, toggle]);

  // Auto-focus the first section's grid on mount.
  useEffect(() => {
    if (!submitted && !cancelled && gridRefs.current[0]) {
      gridRefs.current[0].focus({ preventScroll: true });
    }
  }, [submitted, cancelled]);

  // Post-submit: compact receipt view.
  if (submitted) {
    return (
      <div
        className="chatv2-optlist chatv2-optlist--chosen"
        data-testid="chatv2-optlist"
        data-state="chosen"
        data-multi={multi}
      >
        {sections.map((sec, sIdx) => {
          const sel = selectedBySection[sIdx] ?? new Set<string>();
          const chosen = sec.options.filter((o) => sel.has(o.id));
          const otherPicked = sel.has(OTHER_TOKEN);
          if (chosen.length === 0 && !otherPicked) return null;
          return (
            <div key={sIdx} className="chatv2-optlist__section">
              {(multi && sec.label) && (
                <div className="chatv2-optlist__section-label">{sec.label}</div>
              )}
              {chosen.map((opt) => (
                <ChosenReceipt key={opt.id} opt={opt} />
              ))}
              {otherPicked && (
                <div className="chatv2-optlist__chosen-receipt chatv2-optlist__chosen-receipt--other">
                  <div className="chatv2-optlist__chosen-thumb chatv2-optlist__chosen-thumb--other">
                    <span aria-hidden="true">✎</span>
                  </div>
                  <div className="chatv2-optlist__chosen-text">
                    <div className="chatv2-optlist__chosen-label">
                      <span className="chatv2-optlist__chosen-title">{t('Other')}</span>
                    </div>
                    {(otherTextBySection[sIdx] ?? '').trim() && (
                      <div className="chatv2-optlist__chosen-meta">{otherTextBySection[sIdx]}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Cancelled state — session ended before pick.
  if (cancelled) {
    return (
      <div
        className="chatv2-optlist chatv2-optlist--cancelled"
        data-testid="chatv2-optlist"
        data-state="cancelled"
      >
        <div className="chatv2-optlist__head">
          {prompt && <div className="chatv2-optlist__prompt">{prompt}</div>}
        </div>
        {sections.map((sec, sIdx) => (
          <div key={sIdx} className="chatv2-optlist__section">
            {multi && sec.label && (
              <div className="chatv2-optlist__section-label">{sec.label}</div>
            )}
            <div className="chatv2-optlist__grid" aria-hidden="true">
              {sec.options.map((opt) => (
                <OptionCard
                  key={opt.id}
                  opt={opt}
                  fieldSchema={effectiveSchemas[sIdx] ?? []}
                  selected={false}
                  focused={false}
                  disabled
                  isConfirmed={false}
                  multiSelect={sec.multiSelect}
                  onClick={() => { /* cancelled */ }}
                  onHover={() => { /* cancelled */ }}
                  onChoose={() => { /* cancelled */ }}
                />
              ))}
            </div>
          </div>
        ))}
        <div className="chatv2-optlist__cancelled-banner">{t('Session ended — no choice made.')}</div>
      </div>
    );
  }

  // Live state.
  const submitLabel = (() => {
    if (canSubmit) return t('Confirm $1 pick$2', { '1': totalSelected, '2': totalSelected === 1 ? '' : 's' });
    const missingOther = sections.findIndex((_, i) => {
      const sel = selectedBySection[i] ?? new Set<string>();
      return sel.has(OTHER_TOKEN) && (otherTextBySection[i] ?? '').trim().length === 0;
    });
    if (missingOther >= 0) return t('Type your "Other" answer');
    const idx = sections.findIndex((sec, i) => {
      const n = selectedBySection[i]?.size ?? 0;
      return sec.multiSelect ? (n < sec.min || n > sec.max) : (n !== 1);
    });
    if (idx < 0) return t('Pick options to continue');
    const sec = sections[idx];
    const label = sec?.label ?? t('section $1', { '1': idx + 1 });
    return t('Pick from "$1" to continue', { '1': label });
  })();

  return (
    <div
      className="chatv2-optlist"
      data-testid="chatv2-optlist"
      data-state={streaming ? 'streaming' : 'live'}
      data-multi={multi}
    >
      <div className="chatv2-optlist__head">
        {prompt && <div className="chatv2-optlist__prompt">{prompt}</div>}
      </div>

      {sections.map((sec, sIdx) => {
        const sel = selectedBySection[sIdx] ?? new Set<string>();
        const sharedSite = sectionSingleSite[sIdx];
        const siteIconUrl = sharedSite && sec.options[0]?.url
          ? siteFaviconUrl(sec.options[0].url)
          : undefined;

        return (
          <div key={sIdx} className="chatv2-optlist__section">
            <div className="chatv2-optlist__section-head">
              {multi && sec.label && (
                <div className="chatv2-optlist__section-label">{sec.label}</div>
              )}
              {sharedSite && (
                <div className="chatv2-optlist__source">
                  {siteIconUrl && (
                    <img
                      className="chatv2-optlist__source-icon"
                      src={siteIconUrl}
                      alt=""
                      width={14}
                      height={14}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <span className="chatv2-optlist__source-label">{t('Results from')} <b className="chatv2-optlist__source-name">{sharedSite}</b></span>
                </div>
              )}
              {sec.multiSelect && (
                <div className="chatv2-optlist__multi-hint">
                  {multiSelectHint(sec, sel.size, t)}
                </div>
              )}
              {streaming && (
                <div className="chatv2-optlist__streaming-hint">
                  {t('scraping $1…', { '1': sharedSite ?? t('results') })}
                </div>
              )}
            </div>

            <div
              ref={(el) => { gridRefs.current[sIdx] = el; }}
              className="chatv2-optlist__grid"
              tabIndex={locked ? -1 : 0}
              onKeyDown={(e) => handleSectionKey(sIdx, e)}
            >
              {sec.options.map((opt, idx) => {
                const isConfirmed = sel.has(opt.id);
                return (
                  <OptionCard
                    key={opt.id}
                    opt={opt}
                    fieldSchema={effectiveSchemas[sIdx] ?? []}
                    selected={isConfirmed}
                    focused={!locked && cursor.section === sIdx && cursor.option === idx}
                    disabled={locked}
                    isConfirmed={isConfirmed}
                    multiSelect={sec.multiSelect}
                    showPerCardFavicon={!sharedSite}
                    onClick={() => {
                      if (locked) return;
                      setCursor({ section: sIdx, option: idx });
                      toggle(sIdx, idx);
                      gridRefs.current[sIdx]?.focus({ preventScroll: true });
                    }}
                    onHover={() => { if (!locked) setCursor({ section: sIdx, option: idx }); }}
                    onChoose={() => chooseCard(sIdx, idx)}
                  />
                );
              })}
            </div>

            {sec.allowOther && (
              <OtherLink
                disabled={locked}
                onClick={() => {
                  // Focus the chat input so the user can type their custom answer.
                  // Try the window event first (Electron bridge); fall back to DOM query.
                  try {
                    window.dispatchEvent(new CustomEvent('chatv2:focus-input'));
                  } catch {
                    // ignore
                  }
                  const input = document.querySelector<HTMLElement>('[data-chat-input]');
                  input?.focus();
                }}
              />
            )}
          </div>
        );
      })}

      {/* Foot Confirm — only for multi-select sections, and only once the
          user has picked enough to actually submit. The disabled placeholder
          ("Pick from … to continue") is visual noise — better to show nothing
          until there's a real action to take. */}
      {sections.some((sec) => sec.multiSelect) && canSubmit && !locked && (
        <div className="chatv2-optlist__foot">
          <button
            type="button"
            className="chatv2-optlist__submit"
            onClick={() => { void submit(); }}
          >
            {submitLabel}
          </button>
        </div>
      )}
      {/* Show submit error in its own foot when present, regardless of mode. */}
      {submitError && (
        <div className="chatv2-optlist__foot">
          <span className="chatv2-optlist__submit-error">{submitError}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ChosenReceipt({ opt }: { opt: OptionItem }): React.ReactElement {
  const [imgBroken, setImgBroken] = useState(false);
  const [faviconBroken, setFaviconBroken] = useState(false);
  const priceField = opt.fields?.Price ?? opt.fields?.price;
  const faviconSrc = siteFaviconUrl(opt.url);

  return (
    <div className="chatv2-optlist__chosen-receipt">
      <div className="chatv2-optlist__chosen-thumb">
        {!imgBroken ? (
          <img
            src={opt.image}
            alt=""
            className="chatv2-optlist__chosen-img"
            onError={() => setImgBroken(true)}
          />
        ) : (
          <span className="chatv2-optlist__chosen-thumb-broken" aria-hidden="true">🖼</span>
        )}
      </div>
      <div className="chatv2-optlist__chosen-text">
        <div className="chatv2-optlist__chosen-label">
          <span className="chatv2-optlist__chosen-title">{opt.title}</span>
        </div>
        <div className="chatv2-optlist__chosen-meta">
          {faviconSrc && !faviconBroken && (
            <img
              className="chatv2-optlist__chosen-favicon"
              src={faviconSrc}
              alt=""
              width={12}
              height={12}
              onError={() => setFaviconBroken(true)}
            />
          )}
          <span className="chatv2-optlist__chosen-site">{opt.site}</span>
          {priceField && (
            <>
              <span className="chatv2-optlist__chosen-sep" aria-hidden="true">·</span>
              <span className="chatv2-optlist__chosen-price">{priceField}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface CardProps {
  opt: OptionItem;
  fieldSchema: string[];
  selected: boolean;
  focused: boolean;
  disabled: boolean;
  isConfirmed: boolean;
  /** Multi-select mode: button reads "Add"/"Added", stays clickable to toggle off. */
  multiSelect: boolean;
  showPerCardFavicon?: boolean;
  onClick: () => void;
  onHover: () => void;
  onChoose: () => void;
}

function OptionCard({
  opt, fieldSchema, selected, focused, disabled, isConfirmed, multiSelect,
  showPerCardFavicon, onClick, onHover, onChoose,
}: CardProps): React.ReactElement {
  const { t } = useTranslation();
  const [broken, setBroken] = useState<boolean>(false);
  const [faviconBroken, setFaviconBroken] = useState<boolean>(false);

  const faviconSrc = showPerCardFavicon ? siteFaviconUrl(opt.url) : undefined;

  return (
    <div
      className="chatv2-optlist__card"
      data-selected={selected}
      data-focused={focused}
      onClick={onClick}
      onMouseEnter={onHover}
    >
      <div className="chatv2-optlist__panel">
        {!broken ? (
          <img
            className="chatv2-optlist__img"
            src={opt.image}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="chatv2-optlist__img chatv2-optlist__img--broken" />
        )}
        <span className="chatv2-optlist__pin" aria-hidden="true">✓</span>
      </div>
      <div className="chatv2-optlist__body">
        <div className="chatv2-optlist__title-row">
          {faviconSrc && !faviconBroken && (
            <img
              className="chatv2-optlist__card-favicon"
              src={faviconSrc}
              alt=""
              width={12}
              height={12}
              onError={() => setFaviconBroken(true)}
            />
          )}
          <div className="chatv2-optlist__title">{opt.title}</div>
        </div>
        {opt.description && <p className="chatv2-optlist__desc">{opt.description}</p>}
        {(fieldSchema.length > 0 || opt.url) && (
          <dl className="chatv2-optlist__fields">
            {fieldSchema.map((label) => {
              const value = opt.fields?.[label];
              if (value === undefined) return null;
              return (
                <div key={label} className="chatv2-optlist__field">
                  <dt className="chatv2-optlist__field-label">{label}</dt>
                  <dd className="chatv2-optlist__field-value">{value}</dd>
                </div>
              );
            })}
            {/* Source row — content-level "View on X" link. Peer to Price,
                not a competing action button. Click opens the listing in
                the user's default browser. */}
            <div className="chatv2-optlist__field">
              <dt className="chatv2-optlist__field-label">{t('Source')}</dt>
              <dd className="chatv2-optlist__field-value">
                <a
                  className="chatv2-optlist__source-link"
                  href={opt.url}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try { window.electronAPI?.shell?.openExternal?.(opt.url); } catch { /* ignore */ }
                  }}
                >
                  {!faviconBroken && (
                    <img
                      className="chatv2-optlist__source-link-favicon"
                      src={siteFaviconUrl(opt.url)}
                      alt=""
                      width={13}
                      height={13}
                      onError={() => setFaviconBroken(true)}
                    />
                  )}
                  {t('View on $1', { '1': opt.site })}
                  <svg
                    className="chatv2-optlist__source-link-arrow"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 17 L17 7 M9 7 H17 V15" />
                  </svg>
                </a>
              </dd>
            </div>
          </dl>
        )}
        <div className="chatv2-optlist__actions">
          <button
            type="button"
            className={`chatv2-optlist__choose${isConfirmed ? ' is-confirmed' : ''}`}
            // Only the parent-level `disabled` (= picker locked after submit)
            // should block clicks. Single-select selection is transient until
            // submit runs; selecting a card then clicking Choose is the
            // intended mouse path, so we must NOT disable on isConfirmed here.
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onChoose();
            }}
            aria-pressed={isConfirmed}
          >
            <span className="chatv2-optlist__choose-label">{multiSelect ? t('Add') : t('Choose')}</span>
            <span className="chatv2-optlist__choose-confirm">
              <svg
                className="chatv2-optlist__choose-check"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M5 12 L10 17 L19 7" />
              </svg>
              <span>{multiSelect ? t('Added') : t('Chosen')}</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function OtherLink({ disabled, onClick }: { disabled: boolean; onClick: () => void }): React.ReactElement {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="chatv2-optlist__other-link"
      disabled={disabled}
      onClick={onClick}
    >
      {t('none of these? describe what you want')}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reverse of formatSelectionMessage: parse the user-reply turn that follows
 * this picker and reconstruct which options were selected. Returns null when
 * the text is not a selection reply for this picker (no matching IDs, no
 * "Other:" mention, or wrong prefix entirely).
 *
 * Exported for tests.
 */
export function deriveSubmissionFromTranscript(
  text: string | null | undefined,
  sections: OptionListSection[],
): { selection: Set<string>[]; otherText: string[] } | null {
  if (!text) return null;
  const head = text.trimStart();
  if (!head.startsWith('Selected from options:')) return null;

  const selection: Set<string>[] = sections.map(() => new Set<string>());
  const otherText: string[] = sections.map(() => '');

  // Pull every `(id: <id>)` occurrence and route each to the section that
  // owns that id. IDs are unique within a picker, so first-match wins.
  const idMatches = Array.from(text.matchAll(/\(id:\s*([^)]+)\)/g));
  for (const m of idMatches) {
    const id = m[1].trim();
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].options.some((o) => o.id === id)) {
        selection[i].add(id);
        break;
      }
    }
  }

  // "Other: <text>" reply. Single-section pickers map unambiguously to
  // section 0. Multi-section requires a label prefix to attribute the
  // answer; if the label is missing or doesn't match any known section,
  // drop the entry rather than guess — guessing risks rendering a
  // historical receipt as if a different section had been chosen.
  const otherMatches = Array.from(text.matchAll(/(?:^|\n)[^\n]*?Other:\s*([^\n]+)/g));
  for (const m of otherMatches) {
    let target: number;
    if (sections.length === 1) {
      target = 0;
    } else {
      const line = m[0];
      const labelMatch = line.match(/(?:^|\n)-\s*([^:]+):\s*Other:/);
      const label = labelMatch?.[1].trim();
      const idx = label ? sections.findIndex((s) => s.label === label) : -1;
      if (idx < 0) continue;
      target = idx;
    }
    selection[target].add(OTHER_TOKEN);
    otherText[target] = m[1].trim();
  }

  if (selection.every((s) => s.size === 0)) return null;
  return { selection, otherText };
}

function formatSelectionMessage(
  pickedAcross: { section: OptionListSection; picked: OptionItem[]; otherText: string }[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const totalCount = pickedAcross.reduce((n, { picked, otherText }) => n + picked.length + (otherText ? 1 : 0), 0);
  if (totalCount === 0) return t('Selected: (none)');

  const totalSections = pickedAcross.length;
  if (totalSections === 1 && totalCount === 1) {
    const sec = pickedAcross[0];
    if (sec.picked.length === 1) {
      const p = sec.picked[0];
      return t('Selected from options: $1 (id: $2)', { '1': p.title, '2': p.id });
    }
    return t('Selected from options: Other: $1', { '1': sec.otherText });
  }

  const lines: string[] = [];
  for (const { section, picked, otherText } of pickedAcross) {
    const prefix = totalSections > 1 && section.label ? `${section.label}: ` : '';
    for (const p of picked) {
      lines.push(t('- $1$2 (id: $3)', { '1': prefix, '2': p.title, '3': p.id }));
    }
    if (otherText) {
      lines.push(t('- $1Other: $2', { '1': prefix, '2': otherText }));
    }
  }
  return `${t('Selected from options:')}\n${lines.join('\n')}`;
}
