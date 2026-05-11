import React, { useEffect, useRef, useState } from 'react';
import { Markdown } from '../Markdown';
import type { OutputEntry } from '../types';
import type { Turn } from './groupIntoTurns';
import { ToolBlock } from './ToolBlock';
import { ToolGroup } from './ToolGroup';
import { Linkify } from './Linkify';
import { useToast } from '@/renderer/components/base/Toast';
import { TerminalSpinner, Elapsed } from './TerminalSpinner';
import { parseUserMessage } from './parseUserMessage';

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

function UserBubble({ content, onEdit, onShare }: {
  content: string;
  onEdit?: (text: string) => void;
  onShare?: () => void;
}): React.ReactElement {
  const { quote, message } = parseUserMessage(content);
  const body = message || ''; // message can be empty if user sent quote-only
  const lines = body.split('\n').length;
  const isLong = lines > USER_BUBBLE_CLAMP_LINES || body.length > USER_BUBBLE_CLAMP_CHARS;
  const [expanded, setExpanded] = useState(false);
  const clamped = isLong && !expanded;
  const toast = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.show({ variant: 'success', title: 'Copied to clipboard' });
    } catch {
      toast.show({ variant: 'error', title: 'Copy failed' });
    }
  };

  return (
    <div className="chat-bubble__wrap">
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
            {expanded ? 'Show less' : 'Show more'} <span aria-hidden>▾</span>
          </button>
        )}
      </div>
      <div className="chat-bubble__actions">
        <button
          type="button"
          aria-label="Copy message"
          title="Copy"
          onClick={() => { void handleCopy(); }}
        >
          <CopyIcon />
        </button>
        {onShare && (
          <button
            type="button"
            aria-label="Share conversation"
            title="Share"
            onClick={onShare}
          >
            <ShareIcon />
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            aria-label="Edit message"
            title="Edit message"
            onClick={() => onEdit(body)}
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
function useTypewriter(target: string, baseCharsPerSec = 70, startInstant = false): string {
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
      // Adaptive rate: catch up faster when far behind, cap at 2.5×.
      const rate = Math.min(baseCharsPerSec * 2.5, baseCharsPerSec + gap * 0.4);
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
  hoistedImages,
  done,
}: {
  target: string;
  hoistedImages?: OutputEntry[];
  done: boolean;
}): React.ReactElement {
  // If we mount with `done` already true (re-opening a finished task), skip
  // the animation entirely. Without this the typewriter would re-stream every
  // completed message from scratch each time you reopen the chat.
  const shown = useTypewriter(target, 70, done);
  const caughtUp = shown.length >= target.length;
  const stillStreaming = !done || !caughtUp;
  return (
    <div className={`chat-step__assistant${stillStreaming ? ' chat-step__assistant--streaming' : ''}`}>
      {hoistedImages?.map((img) => <FloatedImage key={img.id} entry={img} />)}
      {/* Render markdown of the typewritten substring, with any unclosed
          fences temporarily closed so the parser doesn't flip the rest of the
          document into a code block as it streams in. Avoids both the
          "partial-markdown rewriting" jitter AND the streaming→markdown
          handoff layout shift, by keeping one consistent renderer the whole
          time. */}
      <Markdown source={stableMarkdown(shown) || (done ? '(done)' : '')} />
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

function AgentEntry({
  entry,
}: {
  entry: OutputEntry;
}): React.ReactElement | null {
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
          <Markdown source={entry.content || '(done)'} />
        </div>
      );

    case 'error':
      return <div className="chat-step__error"><Linkify>{entry.content}</Linkify></div>;

    case 'skill_used':
      return <span className="chat-step__chip">skill · {entry.content}</span>;

    case 'skill_written':
      return <span className="chat-step__chip">wrote skill · {entry.content}</span>;

    case 'harness_edited':
      return <span className="chat-step__chip">edited {entry.content}</span>;

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
      return <span className="chat-step__chip">file · <Linkify>{entry.content}</Linkify></span>;
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

function renderAgentEntries(entries: OutputEntry[], isLive: boolean): React.ReactElement[] {
  // Defer ALL image file_outputs until the trailing `done` block exists, then
  // float them inside it (magazine layout). Rendering them in-place as they
  // stream in causes a visible jump: image lands as a standalone block during
  // streaming, then snaps to a floated inset once `done` arrives. Better to
  // wait — the image appears once, in its final spot.
  let lastDoneIdx = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === 'done') { lastDoneIdx = i; break; }
  }

  // Trailing "streaming prose": the live `thinking` that's currently growing
  // (last entry, no `done` yet) OR the `done` entry once it lands. Both get
  // suppressed from regular per-entry rendering and collapsed into a single
  // <StreamingProse> at the tail, with a stable key so the typewriter cursor
  // persists across the thinking→done swap.
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

  const hoistedImages: OutputEntry[] = [];
  const hoistedIds = new Set<string>();
  for (const e of entries) {
    if (e.type === 'file_output' && e.fileMime?.startsWith('image/')) {
      hoistedIds.add(e.id);
      if (lastDoneIdx >= 0) hoistedImages.push(e);
    }
  }

  const out: React.ReactElement[] = [];
  let batch: OutputEntry[] = [];
  const flush = () => {
    if (batch.length === 0) return;
    out.push(<ToolGroup key={`group-${batch[0].id}`} entries={batch} />);
    batch = [];
  };
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.type === 'tool_call') {
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
    // Skip file_output entries that were hoisted into the trailing done block.
    if (hoistedIds.has(e.id)) continue;
    // Suppress the trailing thinking and done — they get collapsed into the
    // single <StreamingProse> appended after the loop.
    if (i === proseTargetIdx) continue;
    const rendered = <AgentEntry key={e.id} entry={e} />;
    if (rendered) out.push(rendered);
  }
  flush();

  if (proseTarget) {
    out.push(
      <StreamingProse
        key="prose-tail"
        target={proseTarget}
        done={proseDone}
        hoistedImages={hoistedImages}
      />,
    );
  }
  return out;
}

export function ChatTurn({ turn, inflightSince, onEditMessage, onShare }: ChatTurnProps): React.ReactElement {
  const showInflight = inflightSince !== undefined;
  return (
    <div className="chat-turn">
      {turn.userEntry && (
        <UserBubble
          content={turn.userEntry.content}
          onEdit={onEditMessage}
          onShare={onShare}
        />
      )}
      {(showInflight || turn.agentEntries.length > 0) && (
        <div className="chat-agent">
          {showInflight && (
            <div className="chat-thinking" aria-live="polite">
              <TerminalSpinner />
              <span className="chat-thinking__label">Working</span>
              <Elapsed since={inflightSince!} />
            </div>
          )}
          {renderAgentEntries(turn.agentEntries, showInflight)}
        </div>
      )}
    </div>
  );
}
