import React from 'react';
import { STATUS_LABEL } from './constants';
import type { AgentSession } from './types';

function formatElapsed(createdAt: number): string {
  const seconds = Math.floor((Date.now() - createdAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

interface SessionCardProps {
  session: AgentSession;
  isSelected: boolean;
  onClick: () => void;
}

export function SessionCard({ session, isSelected, onClick }: SessionCardProps): React.ReactElement {
  const elapsed = formatElapsed(session.createdAt);
  const label = STATUS_LABEL[session.status] ?? session.status;

  return (
    <button
      className={`session-card${isSelected ? ' session-card--selected' : ''}`}
      onClick={onClick}
      title={session.prompt}
      aria-selected={isSelected}
      aria-label={`Session: ${session.prompt}, status: ${session.status}`}
      role="listitem"
    >
      <span className={`session-card__dot session-card__dot--${session.status}`} aria-hidden="true" />
      <span className="session-card__body">
        <span className="session-card__prompt">{session.prompt}</span>
        <span className="session-card__meta">
          <span className="session-card__status">{label}</span>
          <span className="session-card__sep" aria-hidden="true" />
          <span className="session-card__elapsed">{elapsed}</span>
          {session.toolCallCount > 0 && (
            <>
              <span className="session-card__sep" aria-hidden="true" />
              <span className="session-card__tools">{session.toolCallCount} tools</span>
            </>
          )}
        </span>
      </span>
      {session.status === 'running' && (
        <span className="session-card__progress" aria-hidden="true">
          <span className="session-card__progress-bar" />
        </span>
      )}
    </button>
  );
}

export default SessionCard;
