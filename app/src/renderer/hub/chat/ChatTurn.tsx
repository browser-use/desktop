import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Markdown } from '../Markdown';
import type { OutputEntry } from '../types';
import type { Turn } from './groupIntoTurns';
import { ToolBlock } from './ToolBlock';
import { ToolGroup } from './ToolGroup';
import { Linkify } from './Linkify';
import { useToast } from '@/renderer/components/base/Toast';
import { TerminalSpinner, Elapsed } from './TerminalSpinner';
import { useCyclingVerb } from './spinnerVerbs';
import { formatUserMessageWithQuote, parseUserMessage } from './parseUserMessage';
import { FinderIcon } from '@/renderer/shared/editorIcons';
import { AttachmentList, type AttachmentItem } from '../chat-v2/Attachments';
import { extractAll } from '../chat-v2/htmlBlocks';
import { HtmlBlock } from '../chat-v2/HtmlBlock';
import { OptionList } from '../chat-v2/OptionList';
import { AskForm } from '../chat-v2/AskForm';

const USER_BUBBLE_CLAMP_LINES = 10;
const USER_BUBBLE_CLAMP_CHARS = 600;

function CopyIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4" y="2" width="9" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 5v8a1.5 1.5 0 0 0 1.5 1.5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ShareIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2v8M8 2L5.5 4.5M8 2l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 9v3.5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function EditIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M11 2.5l2.5 2.5L6 12.5l-3 .5.5-3L11 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UserBubble({ content, onEdit, onShare, sessionId, attachmentTurnIndex }: {
  content: string;
  onEdit?: (text: string) => void;
  onShare?: () => void;
  sessionId?: string;
  attachmentTurnIndex?: number;
}): React.ReactElement {
  const { t } = useTranslation();
  const { quote, message } = parseUserMessage(content);
  const body = message || ''; // message can be empty if user sent quote-only
  const lines = body.split('\n').length;
  const isLong = lines > USER_BUBBLE_CLAMP_LINES || body.length > USER_BUBBLE_CLAMP_CHARS;
  const [expanded, setExpanded] = useState(false);
  const clamped = isLong && !expanded;
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Files the user attached to this turn (pasted images, drag-drops).
  // Fetched lazily over IPC so we don't bloat the session payload.
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  useEffect(() => {
    if (!sessionId || attachmentTurnIndex === undefined) {
      setAttachments([]);
      return;
    }
    let cancelled = false;
    const api = (window as unknown as { electronAPI?: { sessions?: { getAttachmentsByTurn?: (s: string, t: number) => Promise<Array<{ id: number; name: string; mime: string; size: number; dataUrl?: string }>> } } }).electronAPI;
    const request = api?.sessions?.getAttachmentsByTurn?.(sessionId, attachmentTurnIndex);
    if (!request) return () => { cancelled = true; };
    request
      .then((rows) => {
        if (cancelled) return;
        setAttachments(rows.map((r) => ({
          key: String(r.id),
          name: r.name,
          mime: r.mime,
          src: r.mime.startsWith('image/') ? r.dataUrl : undefined,
          meta: formatBytes(r.size),
        })));
      })
      .catch((err) => { console.error('[UserBubble] getAttachmentsByTurn failed', err); });
    return () => { cancelled = true; };
  }, [sessionId, attachmentTurnIndex]);

  const resizeEditArea = (): void => {
    const ta = editTextareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };

  useEffect(() => { if (!editing) setDraft(body); }, [body, editing]);
  useEffect(() => {
    if (!editing) return;
    requestAnimationFrame(() => {
      const ta = editTextareaRef.current;
      if (!ta) return;
      resizeEditArea();
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  }, [editing]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.show({ variant: 'success', title: t('Copied to clipboard') });
    } catch {
      toast.show({ variant: 'error', title: t('Copy failed') });
    }
  };

  const startEdit = (): void => {
    setDraft(body);
    setEditing(true);
  };
  const cancelEdit = (): void => {
    setEditing(false);
    setDraft(body);
  };
  const submitEdit = (): void => {
    const next = draft.trim();
    if (!next || !onEdit) return;
    onEdit(formatUserMessageWithQuote(quote, next));
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="chat-bubble__wrap chat-bubble__wrap--editing">
        <div className="chat-bubble chat-bubble--editing">
          {quote && (
            <div className="chat-bubble__quote">{quote}</div>
          )}
          <textarea
            ref={editTextareaRef}
            className="chat-bubble__edit-input"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); resizeEditArea(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submitEdit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
              }
            }}
            placeholder={t('Edit your message...')}
          />
        </div>
        <div className="chat-bubble__edit-actions">
          <button type="button" className="chat-bubble__edit-cancel" onClick={cancelEdit}>{t('Cancel')}</button>
          <button
            type="button"
            className="chat-bubble__edit-send"
            onClick={submitEdit}
            disabled={draft.trim().length === 0 || draft.trim() === body.trim()}
          >{t('Send')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-bubble__wrap">
      {attachments.length > 0 && (
        <div className="chat-bubble__attachments">
          <AttachmentList items={attachments} variant="gallery" />
        </div>
      )}
      <div className={`chat-bubble${clamped ? ' chat-bubble--clamped' : ''}`}>
        {quote && (
          <div className="chat-bubble__quote">{quote}</div>
        )}
        {body && <div className="chat-bubble__text">{body}</div>}
        {isLong && (
          <button
            type="button"
            className="chat-bubble__show-more"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? t('Show less') : t('Show more')} <span aria-hidden>▾</span>
          </button>
        )}
      </div>
      <div className="chat-bubble__actions">
        <button
          type="button"
          aria-label={t('Copy message')}
          title={t('Copy')}
          onClick={() => { void handleCopy(); }}
        >
          <CopyIcon />
        </button>
        {onShare && (
          <button
            type="button"
            aria-label={t('Share conversation')}
            title={t('Share')}
            onClick={onShare}
          >
            <ShareIcon />
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            aria-label={t('Edit message')}
            title={t('Edit message')}
            onClick={startEdit}
          >
            <EditIcon />
          </button>
        )}
      </div>
    </div>
  );
}

interface ChatTurnProps {
  turn: Turn;
  inflightSince?: number;
  onEditMessage?: (text: string) => void;
  onShare?: () => void;
  isLatest?: boolean;
  /** Threaded through to UserBubble so it can fetch attachments persisted
   *  in session_attachments for this turn's `attachmentTurnIndex`. */
  sessionId?: string;
  /** Text of the user's reply that follows this turn (i.e. the next turn's
   *  userEntry.content). Forwarded to OptionList/AskForm so they can detect
   *  historical submissions from the transcript itself — no client cache. */
  nextUserText?: string | null;
}

function AssistantActions({
  content,
  onShare,
}: {
  content: string;
  onShare?: () => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content);
      toast.show({ variant: 'success', title: t('Copied to clipboard') });
    } catch {
      toast.show({ variant: 'error', title: t('Copy failed') });
    }
  };
  if (!content) return null;
  return (
    <div className="chat-assistant-actions">
      <button
        type="button"
        aria-label={t('Copy response')}
        title={t('Copy')}
        onClick={() => { void handleCopy(); }}
      >
        <CopyIcon />
      </button>
      {onShare && (
        <button
          type="button"
          aria-label={t('Share conversation')}
          title={t('Share')}
          onClick={onShare}
        >
          <ShareIcon />
        </button>
      )}
    </div>
  );
}

/**
 * Reveal `target` character-by-character at a steady rate. Per-word reveal
 * (the previous strategy) looked chunky on long tokens like LaTeX runs and
 * code: a 40-character word landed in a single frame, then a pause, then the
 * next big jump. Per-character at a high rate reads as smooth motion while
 * still letting the parent block's mask gradient soften the leading edge.
 *
 * Adapts upward when upstream gets far ahead so lag stays bounded. Idles raf
 * once caught up.
 */
function useTypewriter(target: string, baseCharsPerSec = 110, startInstant = false): string {
  // shownLen is ONLY used to trigger re-renders. The raf loop reads/writes
  // shownLenRef exclusively — never shownLen directly — so React re-renders
  // can't race with in-flight raf advances.
  const [shownLen, setShownLen] = useState<number>(() => (startInstant ? target.length : 0));

  // shownLenRef is the single source of truth for the revealed position.
  // Only written by the raf loop or the shrink handler. Never from render body.
  const shownLenRef = useRef(shownLen);

  // targetRef lets the raf loop read the latest target without a dep.
  const targetRef = useRef(target);
  targetRef.current = target;

  // rafRef holds the active requestAnimationFrame id (0 = idle).
  const rafRef = useRef(0);

  // Shared tick logic stored in a ref so both the initial effect and the
  // resume effect reuse the exact same function without duplication.
  const tickStateRef = useRef({ last: null as number | null, accum: 0 });
  const tickRef = useRef<FrameRequestCallback>(() => {});
  tickRef.current = (ts: number) => {
    const state = tickStateRef.current;
    const dt = state.last == null ? 16 : ts - state.last;
    state.last = ts;

    const tgt = targetRef.current;
    const prev = shownLenRef.current;

    if (prev < tgt.length) {
      const gap = tgt.length - prev;
      // Adaptive rate: catch up faster when far behind, cap at 3×.
      const rate = Math.min(baseCharsPerSec * 3, baseCharsPerSec + gap * 0.4);
      state.accum += (dt / 1000) * rate;
      const advance = Math.floor(state.accum);
      if (advance > 0) {
        state.accum -= advance;
        const next = Math.min(tgt.length, prev + advance);
        shownLenRef.current = next;
        setShownLen(next);
      }
      rafRef.current = requestAnimationFrame(tickRef.current);
    } else {
      // Caught up — idle. Resume effect restarts when target grows.
      state.accum = 0;
      state.last = null;
      rafRef.current = 0;
    }
  };

  // Start the raf loop once on mount (or if baseCharsPerSec changes).
  useEffect(() => {
    tickStateRef.current = { last: null, accum: 0 };
    rafRef.current = requestAnimationFrame(tickRef.current);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [baseCharsPerSec]);

  // Handle target shrinking (rerun / edit): reset to 0.
  // useEffect, not render body, to avoid setState-during-render warning.
  useEffect(() => {
    if (target.length < shownLenRef.current) {
      shownLenRef.current = 0;
      setShownLen(0);
      // Restart the loop from the beginning.
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      tickStateRef.current = { last: null, accum: 0 };
      rafRef.current = requestAnimationFrame(tickRef.current);
    }
  }, [target]);

  // Restart the idle loop when new target text arrives.
  useEffect(() => {
    if (target.length > shownLenRef.current && rafRef.current === 0) {
      tickStateRef.current = { last: null, accum: 0 };
      rafRef.current = requestAnimationFrame(tickRef.current);
    }
  }, [target.length]);

  return target.slice(0, shownLenRef.current);
}

/**
 * Patch up a streaming markdown substring so the parser doesn't bleed an open
 * construct into the rest of the document while typing. We don't try to make
 * the *rendered* output look perfect mid-stream — just to keep the rendering
 * locally stable so previously-rendered structure doesn't shift as more chars
 * arrive.
 *
 * - Triple-backtick fence: close it on its own line if the count is odd.
 * - Single-backtick inline code: close it if there's an odd unmatched one.
 */
function stableMarkdown(s: string): string {
  if (!s) return s;
  let out = s;
  // Strip fenced runs first so we count inline backticks only outside fences.
  const fenceMatches = out.match(/```/g);
  if (fenceMatches && fenceMatches.length % 2 === 1) {
    out = out + (out.endsWith('\n') ? '```' : '\n```');
  }
  // Count remaining single backticks (with fenced spans already balanced).
  const outsideFences = out.replace(/```[\s\S]*?```/g, '');
  const singleTicks = (outsideFences.match(/`/g) ?? []).length;
  if (singleTicks % 2 === 1) out = out + '`';
  return out;
}

/**
 * Streaming-aware assistant prose block. Renders the trailing live text via
 * the typewriter regardless of whether it's currently a `thinking` (still
 * streaming) or `done` (finalized) entry. Same component instance persists
 * across the thinking→done transition (stable key from caller) so the
 * typewriter cursor doesn't reset when the run completes.
 */
function StreamingProse({
  target,
  done,
  sessionId,
  nextUserText,
}: {
  target: string;
  done: boolean;
  sessionId?: string;
  nextUserText?: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  // Run the block extractor over the full target. Recognizes `html`,
  // `htmlview`, and `options` fences and emits structured events for
  // each. Cheap to run (regex-based, pure) — re-execute on every render.
  const events = extractAll([target]);
  const hasStructuredBlock = events.some((e) => e.kind === 'html_block' || e.kind === 'option_list' || e.kind === 'ask_form');
  // Hook must run unconditionally (rules-of-hooks); result is only consumed
  // on the no-structured-block branch below.
  const shown = useTypewriter(target, 110, done);

  // If the model didn't emit any structured blocks, preserve the
  // existing typewriter + stable-markdown flow exactly as it was.
  if (!hasStructuredBlock) {
    const caughtUp = shown.length >= target.length;
    const stillStreaming = !done || !caughtUp;
    return (
      <div className={`chat-step__assistant${stillStreaming ? ' chat-step__assistant--streaming' : ''}`}>
        <Markdown source={stableMarkdown(shown) || (done ? t('(done)') : '')} />
      </div>
    );
  }

  // Structured blocks present — skip the typewriter (it doesn't
  // compose well with iframe artifacts or interactive pickers) and
  // render each segment in document order.
  return (
    <div className={`chat-step__assistant${!done ? ' chat-step__assistant--streaming' : ''}`}>
      {events.map((e, i) => {
        if (e.kind === 'text') {
          return e.text.trim().length === 0
            ? null
            : <Markdown key={i} source={stableMarkdown(e.text)} />;
        }
        if (e.kind === 'html_block') {
          return <HtmlBlock key={i} content={e.content} complete={e.complete} tag={e.tag} />;
        }
        if (e.kind === 'ask_form') {
          return (
            <AskForm
              key={i}
              payload={e.parsed}
              complete={e.complete}
              error={e.error}
              sessionId={sessionId}
              nextUserText={nextUserText}
            />
          );
        }
        return (
          <OptionList
            key={i}
            payload={e.parsed}
            complete={e.complete}
            error={e.error}
            sessionId={sessionId}
            nextUserText={nextUserText}
          />
        );
      })}
    </div>
  );
}

function FloatedImage({ entry }: { entry: OutputEntry }): React.ReactElement {
  const absPath = entry.tool ?? '';
  const src = `chatfile://files${encodeURI(absPath)}`;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="chat-step__image chat-step__image--floated">
      <img src={src} alt={entry.content} loading="lazy" />
    </a>
  );
}

function formatBytes(n?: number): string {
  if (!n || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v < 10 && u > 0 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

function FileCard({ entry }: { entry: OutputEntry }): React.ReactElement {
  const { t } = useTranslation();
  const absPath = entry.tool ?? '';
  const name = entry.content || absPath.split('/').pop() || 'file';
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : '';
  const isImage = entry.fileMime?.startsWith('image/');
  const sizeLabel = formatBytes(entry.fileSize);
  const metaParts = [ext, sizeLabel].filter(Boolean);
  const reveal = (e?: React.MouseEvent): void => {
    e?.preventDefault();
    void window.electronAPI?.sessions?.revealOutput?.(absPath)
      .catch((err) => console.error('[FileCard] revealOutput failed', err));
  };
  const download = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    void window.electronAPI?.sessions?.downloadOutput?.(absPath)
      .catch((err) => console.error('[FileCard] downloadOutput failed', err));
  };
  return (
    <div
      className="chat-file-card"
      role="button"
      tabIndex={0}
      onClick={reveal}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(); } }}
      title={t('Reveal {{name}} in file manager', { name })}
    >
      <div className="chat-file-card__thumb">
        {isImage && absPath ? (
          <img src={`chatfile://files${encodeURI(absPath)}`} alt="" loading="lazy" />
        ) : (
          <span className="chat-file-card__ext">{ext || t('FILE')}</span>
        )}
      </div>
      <div className="chat-file-card__body">
        <div className="chat-file-card__name">{name}</div>
        {metaParts.length > 0 && (
          <div className="chat-file-card__meta">{metaParts.join(' · ')}</div>
        )}
      </div>
      <button
        type="button"
        className="chat-file-card__download"
        onClick={download}
        aria-label={t('Open {{name}}', { name })}
        title={t('Open file')}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 2v8m0 0l-3-3m3 3l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 12.5v.5A1.5 1.5 0 004.5 14.5h7a1.5 1.5 0 001.5-1.5v-.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

type SkillMeta =
  | { ok: true; path: string; filename: string; sizeBytes: number; mtimeMs: number; lineCount: number; title: string; description: string; body: string; truncated: boolean }
  | { ok: false; error: string };

function SkillCard({ entry, variant }: { entry: OutputEntry; variant: 'used' | 'written' }): React.ReactElement {
  const { t } = useTranslation();
  // `content` is shaped "domain/topic" (e.g. "user/fun/page-word-count").
  // For skill_used domain may be omitted; in that case the whole string is the topic.
  const raw = entry.content || '';
  const absPath = entry.tool || '';
  const domainTopic = /^(user|domain|interaction)\//.test(raw)
    ? raw
    : (raw ? `user/${raw}` : undefined);
  const action = entry.harnessAction;
  const label = variant === 'written'
    ? (action === 'delete' ? t('Skill deleted') : action === 'patch' ? t('Skill updated') : t('Skill written'))
    : t('Skill used');

  const [expanded, setExpanded] = useState(false);
  const [meta, setMeta] = useState<SkillMeta | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const api = window.electronAPI?.sessions?.readSkill;
    if (!api) {
      setMeta({ ok: false, error: 'readSkill API unavailable' });
      return;
    }
    setLoading(true);
    try {
      const isAbs = absPath.startsWith('/') && absPath.endsWith('.md');
      const res = await api({
        domainTopic,
        absPath: isAbs ? absPath : undefined,
      });
      console.log('[SkillCard] readSkill', { raw, absPath, ok: res.ok });
      setMeta(res);
    } catch (err) {
      console.error('[SkillCard] readSkill threw', err);
      setMeta({ ok: false, error: String(err) });
    } finally {
      setLoading(false);
    }
  }, [raw, absPath, domainTopic]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback((): void => {
    setExpanded((prev) => !prev);
  }, []);

  const displayTitle = meta?.ok
    ? (meta.title || meta.filename.replace(/\.md$/i, '') || t('Untitled skill'))
    : (meta == null || loading ? t('Loading skill...') : t('Skill unavailable'));

  return (
    <div
      className={`chat-skill-card chat-skill-card--${variant}${action ? ` chat-skill-card--${action}` : ''}${expanded ? ' chat-skill-card--expanded' : ''}`}
    >
      <button
        type="button"
        className="chat-skill-card__head"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={`skill-body-${entry.id}`}
        title={expanded ? t('Collapse') : t('Show details')}
      >
        <span className="chat-skill-card__label">{label}</span>
        <span className="chat-skill-card__title">{displayTitle}</span>
        <span className="chat-skill-card__chev" aria-hidden>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div id={`skill-body-${entry.id}`} className="chat-skill-card__body">
          {loading && <div className="chat-skill-card__loading">{t('Loading...')}</div>}
          {meta?.ok === false && (
            <div className="chat-skill-card__error">{t('Could not read this skill:')} {meta.error}</div>
          )}
          {meta?.ok === true && (
            <>
              <div className="chat-skill-card__desc">
                {meta.description || <span className="chat-skill-card__desc-empty">{t('No description.')}</span>}
              </div>
              <div className="chat-skill-card__actions">
                <button
                  type="button"
                  className="chat-skill-card__btn chat-skill-card__btn--finder"
                  aria-label={t('Reveal {{title}} in Finder', { title: displayTitle })}
                  title={t('Reveal in Finder')}
                  onClick={() => {
                    void window.electronAPI?.sessions?.revealOutput?.(meta.path)
                      .catch((err) => console.error('[SkillCard] revealOutput failed', err));
                  }}
                >
                  <FinderIcon />
                  <span>{t('Reveal in Finder')}</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AgentEntry({
  entry,
}: {
  entry: OutputEntry;
}): React.ReactElement | null {
  const { t } = useTranslation();
  switch (entry.type) {
    case 'thinking':
      // Intermediate thinking (between tool calls). The trailing live thinking
      // is intercepted before reaching here and rendered via <StreamingProse>.
      return <div className="chat-step__thinking"><Linkify>{entry.content}</Linkify></div>;

    case 'tool_call':
      return <ToolBlock entry={entry} />;

    case 'tool_result': {
      // Orphaned tool_result (no preceding tool_call paired by adaptSession).
      // Codex emits these for top-level error items ({type:"error", message}).
      // Surface those as proper error cards; suppress all other orphans as noise.
      const text = entry.content;
      const errMatch = text.match(/"type"\s*:\s*"error"[\s\S]*?"message"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (errMatch) {
        const msg = errMatch[1]
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
        return <div className="chat-step__error"><Linkify>{msg}</Linkify></div>;
      }
      return null;
    }

    case 'done':
      // Unreachable in practice — done is intercepted by renderAgentEntries
      // and rendered via <StreamingProse>. Kept as a defensive fallback in
      // case a `done` arrives without being marked as the trailing prose.
      return (
        <div className="chat-step__assistant">
          <Markdown source={entry.content || t('(done)')} />
        </div>
      );

    case 'error':
      return <div className="chat-step__error"><Linkify>{entry.content}</Linkify></div>;

    case 'skill_used':
      return <SkillCard entry={entry} variant="used" />;

    case 'skill_written':
      return <SkillCard entry={entry} variant="written" />;

    case 'harness_edited':
      return <span className="chat-step__chip">{t('edited')} {entry.content}</span>;

    case 'file_output': {
      const isImage = entry.fileMime?.startsWith('image/');
      const absPath = entry.tool;
      if (isImage && absPath) {
        // Fixed "files" host so Chromium's standard-scheme URL parser doesn't
        // swallow the first path segment as the authority (which lowercases
        // it). The handler ignores the host and reads from pathname.
        const src = `chatfile://files${encodeURI(absPath)}`;
        return (
          <a href={src} target="_blank" rel="noreferrer" className="chat-step__image">
            <img src={src} alt={entry.content} loading="lazy" />
          </a>
        );
      }
      return <FileCard entry={entry} />;
    }

    case 'notify':
      if (entry.level === 'blocking') {
        return <div className="chat-step__error"><Linkify>{entry.content}</Linkify></div>;
      }
      return <span className="chat-step__chip"><Linkify>{entry.content}</Linkify></span>;

    default:
      return null;
  }
}

/**
 * Walk through agent entries, batching consecutive `tool_call` runs into
 * `ToolGroup` blocks so a long agent turn renders as a few collapsed chips
 * instead of dozens of stacked tool pills. Non-tool entries (thinking, done,
 * skill_used, …) break the run and render in place.
 */
/** Normalize whitespace for comparing thinking/done content. */
function normalizeProse(s: string): string {
  return (s || '').trim().replace(/\s+/g, ' ');
}

function renderAgentEntries(entries: OutputEntry[], isLive: boolean, sessionId?: string, nextUserText?: string | null): React.ReactElement[] {
  // Find the trailing prose target: the last `done`, or the trailing live
  // `thinking` if no `done` has landed yet. Both get suppressed from regular
  // per-entry rendering and collapsed into a single <StreamingProse> at the
  // tail, with a stable key so the typewriter cursor persists across the
  // thinking→done swap.
  let lastDoneIdx = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === 'done') { lastDoneIdx = i; break; }
  }
  let trailingThinkingIdx = -1;
  if (lastDoneIdx === -1 && entries.length > 0 && entries[entries.length - 1].type === 'thinking') {
    trailingThinkingIdx = entries.length - 1;
  }
  const proseTargetIdx = lastDoneIdx >= 0 ? lastDoneIdx : trailingThinkingIdx;
  const proseTarget = proseTargetIdx >= 0 ? entries[proseTargetIdx].content : '';
  // Prose counts as "done" if a done event landed OR if this turn isn't the
  // live one (session is idle/stopped/paused, or this isn't the trailing turn).
  // Without the !isLive branch, re-opening a finished session where the agent
  // emitted only thinking events (no final `done`) would replay the typewriter
  // from scratch.
  const proseDone = lastDoneIdx >= 0 || !isLive;

  // Magazine-style float anchor. The first image file_output stays put at
  // the position it was emitted (mid-session, when the screenshot was taken)
  // and the rest of the turn — subsequent tool groups, thinking, and the
  // trailing streaming prose — lives inside a `display: flow-root` wrapper
  // so it wraps around the float. Nothing reflows when `done` lands; the
  // prose just keeps growing alongside the same floated image.
  const before: React.ReactElement[] = [];
  const after: React.ReactElement[] = [];
  let firstImage: OutputEntry | null = null;
  let target = before;
  let batch: OutputEntry[] = [];
  let fileBatch: OutputEntry[] = [];
  const flush = (): void => {
    if (batch.length === 0) return;
    target.push(<ToolGroup key={`group-${batch[0].id}`} entries={batch} />);
    batch = [];
  };
  // AI SDK Elements–shaped Attachments: collapse a run of consecutive
  // file_output entries (that aren't acting as the float anchor) into one
  // grid instead of one FileCard per row.
  const flushFiles = (): void => {
    if (fileBatch.length === 0) return;
    const items: AttachmentItem[] = fileBatch.map((e) => {
      const absPath = e.tool ?? '';
      const name = e.content || absPath.split('/').pop() || 'file';
      const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : '';
      const sizeLabel = formatBytes(e.fileSize);
      const meta = [ext, sizeLabel].filter(Boolean).join(' · ');
      const src = e.fileMime?.startsWith('image/') && absPath
        ? `chatfile://files${encodeURI(absPath)}`
        : undefined;
      return {
        key: e.id,
        name,
        mime: e.fileMime,
        meta,
        src,
        onClick: absPath
          ? () => {
              const request = window.electronAPI?.sessions?.revealOutput?.(absPath);
              request?.catch((err) => console.error('[Attachments] revealOutput failed', err));
            }
          : undefined,
      };
    });
    target.push(<AttachmentList key={`files-${fileBatch[0].id}`} items={items} variant="grid" />);
    fileBatch = [];
  };
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.type === 'tool_call') {
      flushFiles();
      batch.push(e);
      continue;
    }
    flush();
    // Agents (Claude Code in particular) often emit the same prose as a final
    // `thinking` event AND a `done.summary` — which renders twice. When the
    // immediately-following entry is `done` with identical content, skip the
    // thinking so the markdown-rendered `done` wins.
    if (e.type === 'thinking') {
      const next = entries[i + 1];
      if (next && next.type === 'done' && normalizeProse(next.content) === normalizeProse(e.content)) {
        continue;
      }
    }
    // Suppress the trailing thinking and done — they get collapsed into the
    // single <StreamingProse> appended after the loop.
    if (i === proseTargetIdx) continue;

    // First image becomes the float anchor: switch the render target so
    // everything after the image lives inside the float context. The image
    // itself is rendered as the first child of the wrapper below.
    if (
      !firstImage
      && e.type === 'file_output'
      && e.fileMime?.startsWith('image/')
      && e.tool
    ) {
      flushFiles();
      firstImage = e;
      target = after;
      continue;
    }

    if (e.type === 'file_output') {
      fileBatch.push(e);
      continue;
    }
    flushFiles();
    const rendered = <AgentEntry key={e.id} entry={e} />;
    if (rendered) target.push(rendered);
  }
  flush();
  flushFiles();

  if (proseTarget) {
    target.push(
      <StreamingProse
        key="prose-tail"
        target={proseTarget}
        done={proseDone}
        sessionId={sessionId}
        nextUserText={nextUserText}
      />,
    );
  }

  if (!firstImage) return before;

  return [
    ...before,
    <div key="image-flow" className="chat-step__image-flow">
      <FloatedImage entry={firstImage} />
      {after}
    </div>,
  ];
}

function InflightLabel({ since }: { since: number }): React.ReactElement {
  const verb = useCyclingVerb();
  return (
    <div className="chat-thinking" aria-live="polite">
      <TerminalSpinner />
      <span className="chat-thinking__label">{verb}</span>
      <Elapsed since={since} />
    </div>
  );
}

export function ChatTurn({ turn, inflightSince, onEditMessage, onShare, isLatest, sessionId, nextUserText }: ChatTurnProps): React.ReactElement {
  const showInflight = inflightSince !== undefined;
  return (
    <div className={`chat-turn${isLatest ? ' chat-turn--latest' : ''}`}>
      {turn.userEntry && (
        <UserBubble
          content={turn.userEntry.content}
          onEdit={onEditMessage}
          onShare={onShare}
          sessionId={sessionId}
          attachmentTurnIndex={turn.userEntry.attachmentTurnIndex}
        />
      )}
      {(showInflight || turn.agentEntries.length > 0 || isLatest) && (
        <div className="chat-agent">
          {showInflight && <InflightLabel since={inflightSince!} />}
          {renderAgentEntries(turn.agentEntries, showInflight, sessionId, nextUserText)}
          {!showInflight && isLatest && (
            <AssistantActions
              content={turn.agentEntries.find((e) => e.type === 'done')?.content ?? ''}
              onShare={onShare}
            />
          )}
        </div>
      )}
    </div>
  );
}
