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

function UserBubble({ content }: { content: string }): React.ReactElement {
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
          onClick={() => { void handleCopy(); }}
        >
          <CopyIcon />
        </button>
      </div>
    </div>
  );
}

interface ChatTurnProps {
  turn: Turn;
  inflightSince?: number;
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
  // Lazy init: if the prose is already finalized when this component mounts
  // (re-opening a completed task, scrolling back to an old turn), skip the
  // animation and render full-text immediately. Otherwise start at 0 and let
  // the raf loop type it out.
  const [shownLen, setShownLen] = useState<number>(() => (startInstant ? target.length : 0));
  const lastResetTargetRef = useRef(target);

  if (target.length < shownLen && target !== lastResetTargetRef.current) {
    lastResetTargetRef.current = target;
    setShownLen(0);
  }

  useEffect(() => {
    if (shownLen >= target.length) return;
    let raf = 0;
    let last: number | null = null;
    let accum = 0; // fractional character budget
    const tick = (ts: number): void => {
      const dt = last == null ? 16 : ts - last;
      last = ts;
      setShownLen((prev) => {
        if (prev >= target.length) return prev;
        const gap = target.length - prev;
        // Adaptive rate: the further behind we are, the faster we catch up.
        // Cap at 6× base so a huge late chunk doesn't snap instantly.
        const rate = Math.min(baseCharsPerSec * 2.5, baseCharsPerSec + gap * 0.4);
        accum += (dt / 1000) * rate;
        const advance = Math.floor(accum);
        if (advance <= 0) return prev;
        accum -= advance;
        return Math.min(target.length, prev + advance);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, shownLen, baseCharsPerSec]);

  return target.slice(0, Math.min(shownLen, target.length));
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

export function ChatTurn({ turn, inflightSince }: ChatTurnProps): React.ReactElement {
  const showInflight = inflightSince !== undefined;
  return (
    <div className="chat-turn">
      {turn.userEntry && <UserBubble content={turn.userEntry.content} />}
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
