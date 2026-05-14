import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSessionsStore } from '../state/sessionsStore';
import { adaptSession } from '../types';
import type { AgentSession } from '../types';
import { groupIntoTurns } from './groupIntoTurns';
import { ChatTurn } from './ChatTurn';
import { TerminalSpinner, Elapsed } from './TerminalSpinner';
import { useCyclingVerb } from './spinnerVerbs';

function ThinkingIndicator({ since }: { since: number }): React.ReactElement {
  const verb = useCyclingVerb();
  return (
    <div className="chat-thinking" aria-live="polite">
      <TerminalSpinner />
      <span className="chat-thinking__label">{verb}</span>
      <Elapsed since={since} />
    </div>
  );
}

interface ChatTranscriptProps {
  sessionId: string;
  onEditMessage?: (text: string, rawIdx?: number) => void;
  onShare?: () => void;
}

const PIN_THRESHOLD_PX = 32;

/**
 * Native `scrollTo({ behavior: 'smooth' })` is fast and uses a snappy curve
 * we can't tune. For the "new user message pushes everything up" moment we
 * want a slightly longer, softer ease so the prior turn feels like it
 * glides off rather than snapping. raf-based + ease-out-cubic.
 *
 * Aborts on user wheel/touch so manual scrolling always wins.
 */
function smoothScrollTo(el: HTMLElement, top: number, durationMs: number): void {
  const start = el.scrollTop;
  const delta = top - start;
  if (Math.abs(delta) < 1) { el.scrollTop = top; return; }
  const t0 = performance.now();
  let aborted = false;
  const abort = (): void => { aborted = true; cleanup(); };
  const cleanup = (): void => {
    el.removeEventListener('wheel', abort);
    el.removeEventListener('touchmove', abort);
  };
  el.addEventListener('wheel', abort, { passive: true });
  el.addEventListener('touchmove', abort, { passive: true });
  const ease = (x: number): number => 1 - Math.pow(1 - x, 3);
  const tick = (now: number): void => {
    if (aborted) return;
    const x = Math.min(1, (now - t0) / durationMs);
    el.scrollTop = start + delta * ease(x);
    if (x < 1) {
      requestAnimationFrame(tick);
    } else {
      cleanup();
    }
  };
  requestAnimationFrame(tick);
}

export const ChatTranscript = forwardRef<HTMLDivElement, ChatTranscriptProps>(function ChatTranscript({ sessionId, onEditMessage, onShare }, fwdRef): React.ReactElement | null {
  // Subscribe only to this session's output + createdAt. Other sessions'
  // updates do not re-render this component.
  const sessionSlice = useSessionsStore(
    useShallow((s): { output: AgentSession['output']; outputTimestamps: number[] | undefined; createdAt: number; status: AgentSession['status']; prompt: string } | null => {
      const sess = s.byId[sessionId];
      if (!sess) return null;
      return { output: sess.output, outputTimestamps: sess.outputTimestamps, createdAt: sess.createdAt, status: sess.status, prompt: sess.prompt };
    }),
  );

  const containerRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(fwdRef, () => containerRef.current as HTMLDivElement, []);
  const pinnedRef = useRef(true);
  const lastTurnsLenRef = useRef(0);
  const lastSessionIdRef = useRef<string | null>(null);
  const hasLoadedTurnsRef = useRef(false);
  // Tracks the wall-clock time of the most recent agent activity (any change
  // to the latest entry — new entry, streamed token, tool_result landing).
  // Entry timestamps are set at creation, so a long streaming "text" entry
  // would otherwise leave the Working timer counting from when streaming
  // started; we want it to read time-since-last-token instead.
  const lastActivityRef = useRef<{ key: string; at: number }>({ key: '', at: 0 });

  const turns = useMemo(() => {
    if (!sessionSlice) return [];
    const fake: AgentSession = {
      id: sessionId,
      prompt: sessionSlice.prompt,
      status: 'idle',
      createdAt: sessionSlice.createdAt,
      output: sessionSlice.output,
      outputTimestamps: sessionSlice.outputTimestamps,
    };
    const { entries } = adaptSession(fake);
    // The event log is the source of truth for user turns. Only synthesize the
    // legacy prompt when there is no transcript at all; otherwise a stale
    // sessions.prompt value can make a later follow-up look like the kickoff.
    if (sessionSlice.prompt && entries.length === 0) {
      entries.unshift({
        id: `prompt-${sessionId}`,
        type: 'user_input',
        timestamp: sessionSlice.createdAt,
        content: sessionSlice.prompt,
      });
    }
    return groupIntoTurns(entries);
  }, [sessionId, sessionSlice]);
  const hasStoredOutput = (sessionSlice?.output.length ?? 0) > 0;

  // Maintain a CSS variable for the latest turn's agent area min-height so
  // that, when the new user bubble snaps to TOP_GAP_PX below the viewport
  // top, the agent area below it fills the viewport and its bottom rests
  // exactly at the transcript's bottom padding (which keeps content above
  // the composer). Recomputes when the container resizes OR when the
  // latest user bubble's height changes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = (): void => {
      const cs = getComputedStyle(el);
      const padTop = parseFloat(cs.paddingTop) || 0;
      const padBot = parseFloat(cs.paddingBottom) || 0;
      const latest = el.querySelector('.chat-turn--latest') as HTMLElement | null;
      const bubble = latest?.querySelector('.chat-bubble__wrap') as HTMLElement | null;
      const bubbleH = bubble ? bubble.offsetHeight : 0;
      // After scrolling so the bubble's TOP sits at padTop in viewport,
      // the agent area starts at padTop + bubbleH and should extend to
      // clientHeight - padBot. So required agent height = clientHeight -
      // padTop - bubbleH - padBot.
      const needed = el.clientHeight - padTop - bubbleH - padBot;
      el.style.setProperty('--chat-agent-latest-h', `${Math.max(0, needed)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    // Re-measure when the latest bubble itself resizes (long messages, edits).
    const bubble = el.querySelector('.chat-turn--latest .chat-bubble__wrap') as HTMLElement | null;
    if (bubble) ro.observe(bubble);
    return () => ro.disconnect();
  }, [turns]);

  // Scroll-pin: stay glued to bottom when user is at the bottom; release
  // when user scrolls up. New user_input forces re-pin.
  const onScroll = (): void => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
    pinnedRef.current = distance <= PIN_THRESHOLD_PX;
  };

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sessionChanged = lastSessionIdRef.current !== sessionId;
    if (sessionChanged) {
      lastSessionIdRef.current = sessionId;
      lastTurnsLenRef.current = hasStoredOutput ? turns.length : 0;
      hasLoadedTurnsRef.current = hasStoredOutput && turns.length > 0;
      pinnedRef.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }

    const previousTurnsLen = lastTurnsLenRef.current;
    const hadLoadedTurns = hasLoadedTurnsRef.current;
    lastTurnsLenRef.current = turns.length;

    if (!hadLoadedTurns) {
      hasLoadedTurnsRef.current = hasStoredOutput && turns.length > 0;
      if (pinnedRef.current) {
        el.scrollTop = el.scrollHeight;
      }
      return;
    }

    // When a new user turn lands, scroll so the latest turn sits at the top
    // of the viewport (ChatGPT-style). The .chat-turn--latest min-height in
    // chat.css reserves enough space below for that scroll to be possible.
    const newUserTurn = turns.length > previousTurnsLen
      && turns[turns.length - 1]?.userEntry != null;

    if (newUserTurn) {
      const latest = el.querySelector('.chat-turn--latest') as HTMLElement | null;
      if (latest) {
        // Anchor on the *top* of the latest user bubble. The transcript's
        // top padding (~28px) acts as TOP_GAP between viewport top and the
        // bubble. The agent area min-height (set by the ResizeObserver
        // above) guarantees there's enough scroll content to reach this
        // target, so the bubble lands exactly TOP_GAP from the viewport
        // top and the agent's response fills the rest of the viewport
        // above the composer-clearance bottom padding.
        const latestUserBubble = latest.querySelector('.chat-bubble__wrap') as HTMLElement | null;

        const containerRect = el.getBoundingClientRect();
        const padTop = parseFloat(getComputedStyle(el).paddingTop) || 0;
        let top: number;
        if (latestUserBubble) {
          const bubbleRect = latestUserBubble.getBoundingClientRect();
          // Bubble top in scroll-content coords:
          const bubbleTop = bubbleRect.top - containerRect.top + el.scrollTop;
          // Place that top at exactly padTop below viewport top.
          top = bubbleTop - padTop;
        } else {
          top = latest.offsetTop - padTop;
        }
        smoothScrollTo(el, Math.max(0, top), 520);
      } else {
        el.scrollTop = el.scrollHeight;
      }
      pinnedRef.current = false;
      return;
    }

    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [sessionId, hasStoredOutput, turns]);

  useEffect(() => {
    // On session switch, snap to bottom.
    const el = containerRef.current;
    if (!el) return;
    pinnedRef.current = true;
    el.scrollTop = el.scrollHeight;
  }, [sessionId]);

  if (!sessionSlice) return null;

  const isRunning = sessionSlice.status === 'running' || sessionSlice.status === 'stuck';
  // Always show the Working indicator while running. Earlier we hid it
  // whenever the latest entry was an in-flight tool_call (to avoid double
  // indicators), but that caused the indicator to flicker on/off as tool
  // calls landed and resolved — the layout shift was worse than the duplication.
  const lastTurn = turns[turns.length - 1];
  const showThinking = isRunning;
  // Elapsed counter shows time since the current step began. A "step" boundary
  // is a new agent entry appearing OR a tool_call's result landing. We do NOT
  // key on streamed content length — otherwise every token would reset the
  // marker and the timer would stick at 0s during long streams.
  let activityKey = `turn:${lastTurn?.id ?? ''}|user:${lastTurn?.userEntry?.id ?? ''}`;
  if (lastTurn && lastTurn.agentEntries.length > 0) {
    const last = lastTurn.agentEntries[lastTurn.agentEntries.length - 1];
    activityKey += `|n:${lastTurn.agentEntries.length}|id:${last.id}|r:${last.result ? '1' : '0'}`;
  }
  const now = Date.now();
  if (lastActivityRef.current.key !== activityKey) {
    lastActivityRef.current = { key: activityKey, at: now };
  }
  // Fallback chain: last activity → first user message → session createdAt.
  // (Activity ref is 0 on first render before any output exists.)
  const since = lastActivityRef.current.at > 0
    ? lastActivityRef.current.at
    : (lastTurn?.userEntry?.timestamp ?? sessionSlice.createdAt);

  if (turns.length === 0) {
    return (
      <div className="chat-transcript" ref={containerRef}>
        {showThinking ? <ThinkingIndicator since={since} /> : <div className="chat-empty">No messages yet.</div>}
      </div>
    );
  }

  const firstUserTurnIdx = turns.findIndex((t) => t.userEntry !== null);

  return (
    <div className="chat-transcript" ref={containerRef} onScroll={onScroll}>
      {turns.map((t, i) => (
        <ChatTurn
          key={t.id}
          turn={t}
          inflightSince={showThinking && i === turns.length - 1 ? since : undefined}
          onEditMessage={i === firstUserTurnIdx ? onEditMessage : undefined}
          onShare={i === firstUserTurnIdx ? onShare : undefined}
          isLatest={turns.length > 1 && i === turns.length - 1}
        />
      ))}
    </div>
  );
});
