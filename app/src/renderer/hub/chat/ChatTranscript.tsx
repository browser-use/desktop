import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSessionsStore } from '../state/sessionsStore';
import { adaptSession } from '../types';
import type { AgentSession } from '../types';
import { groupIntoTurns } from './groupIntoTurns';
import { ChatTurn } from './ChatTurn';
import { TerminalSpinner, Elapsed } from './TerminalSpinner';

function ThinkingIndicator({ since }: { since: number }): React.ReactElement {
  return (
    <div className="chat-thinking" aria-live="polite">
      <TerminalSpinner />
      <span className="chat-thinking__label">Working</span>
      <Elapsed since={since} />
    </div>
  );
}

interface ChatTranscriptProps {
  sessionId: string;
  onEditMessage?: (text: string) => void;
  onShare?: () => void;
}

const PIN_THRESHOLD_PX = 32;

export const ChatTranscript = forwardRef<HTMLDivElement, ChatTranscriptProps>(function ChatTranscript({ sessionId, onEditMessage, onShare }, fwdRef): React.ReactElement | null {
  // Subscribe only to this session's output + createdAt. Other sessions'
  // updates do not re-render this component.
  const sessionSlice = useSessionsStore(
    useShallow((s): { output: AgentSession['output']; createdAt: number; status: AgentSession['status']; prompt: string } | null => {
      const sess = s.byId[sessionId];
      if (!sess) return null;
      return { output: sess.output, createdAt: sess.createdAt, status: sess.status, prompt: sess.prompt };
    }),
  );

  const containerRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(fwdRef, () => containerRef.current as HTMLDivElement, []);
  const pinnedRef = useRef(true);
  const lastTurnsLenRef = useRef(0);

  const turns = useMemo(() => {
    if (!sessionSlice) return [];
    const fake: AgentSession = {
      id: sessionId,
      prompt: sessionSlice.prompt,
      status: 'idle',
      createdAt: sessionSlice.createdAt,
      output: sessionSlice.output,
    };
    const { entries } = adaptSession(fake);
    // SessionManager is supposed to emit `session.prompt` as a leading
    // user_input event, but in older sessions and some adapter paths that
    // entry is missing — leaving the chat with no opening user bubble.
    // Synthesize one from session.prompt when needed so the kickoff message
    // is always visible at the top.
    if (sessionSlice.prompt && (entries.length === 0 || entries[0].type !== 'user_input')) {
      entries.unshift({
        id: `prompt-${sessionId}`,
        type: 'user_input',
        timestamp: sessionSlice.createdAt,
        content: sessionSlice.prompt,
      });
    }
    return groupIntoTurns(entries);
  }, [sessionId, sessionSlice]);

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
    // Force-pin when a new user_input lands (new turn).
    const newUserTurn = turns.length > lastTurnsLenRef.current
      && turns[turns.length - 1]?.userEntry !== null;
    if (newUserTurn) pinnedRef.current = true;
    lastTurnsLenRef.current = turns.length;

    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [turns]);

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
  // Elapsed counter shows time since the most recent activity — prefer an
  // in-flight tool_call (what the user is waiting on), then the latest agent
  // entry of any kind, then the turn-start user_input, then session creation.
  let since = lastTurn?.userEntry?.timestamp ?? sessionSlice.createdAt;
  if (lastTurn && lastTurn.agentEntries.length > 0) {
    const last = lastTurn.agentEntries[lastTurn.agentEntries.length - 1];
    since = last.timestamp;
    for (let i = lastTurn.agentEntries.length - 1; i >= 0; i--) {
      const e = lastTurn.agentEntries[i];
      if (e.type === 'tool_call' && !e.result) {
        since = e.timestamp;
        break;
      }
    }
  }

  if (turns.length === 0) {
    return (
      <div className="chat-transcript" ref={containerRef}>
        {showThinking ? <ThinkingIndicator since={since} /> : <div className="chat-empty">No messages yet.</div>}
      </div>
    );
  }

  // Only the very first user_input can be edited end-to-end today — the
  // backend rerun primitive replays the conversation from session.prompt, so
  // editing a follow-up message would silently discard everything after it.
  // Find the index of the first turn with a real user entry.
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
        />
      ))}
    </div>
  );
});
