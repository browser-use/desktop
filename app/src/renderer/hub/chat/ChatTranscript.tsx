import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
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
}

const PIN_THRESHOLD_PX = 32;

export function ChatTranscript({ sessionId }: ChatTranscriptProps): React.ReactElement | null {
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
  // Show the thinking indicator while running unless the latest agent entry
  // is an unpaired tool_call (that already has its own spinner) — avoids
  // double-indicating activity.
  const lastTurn = turns[turns.length - 1];
  const lastAgent = lastTurn?.agentEntries[lastTurn.agentEntries.length - 1];
  const lastIsInflightTool = lastAgent?.type === 'tool_call' && !lastAgent.result;
  const showThinking = isRunning && !lastIsInflightTool;
  // Elapsed counter resets at each turn — start counting from the last
  // user_input timestamp, or session creation if there is none yet.
  const since = lastTurn?.userEntry?.timestamp ?? sessionSlice.createdAt;

  if (turns.length === 0) {
    return (
      <div className="chat-transcript" ref={containerRef}>
        {showThinking ? <ThinkingIndicator since={since} /> : <div className="chat-empty">No messages yet.</div>}
      </div>
    );
  }

  return (
    <div className="chat-transcript" ref={containerRef} onScroll={onScroll}>
      {turns.map((t) => (
        <ChatTurn key={t.id} turn={t} />
      ))}
      {showThinking && <ThinkingIndicator since={since} />}
    </div>
  );
}
