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

interface ListViewProps {
  sessions: AgentSession[];
  onSelectSession: (id: string) => void;
  focusIndex?: number;
}

export function ListView({ sessions, onSelectSession, focusIndex }: ListViewProps): React.ReactElement {
  return (
    <div className="list-view">
      <div className="list-view__header">
        <span className="list-view__col list-view__col--status">Status</span>
        <span className="list-view__col list-view__col--group">Group</span>
        <span className="list-view__col list-view__col--prompt">Prompt</span>
        <span className="list-view__col list-view__col--elapsed">Time</span>
      </div>
      <div className="list-view__body">
        {sessions.map((session, i) => (
          <button
            key={session.id}
            className={`list-view__row${i === focusIndex ? ' list-view__row--focused' : ''}`}
            onClick={() => onSelectSession(session.id)}
          >
            <span className="list-view__col list-view__col--status">
              <span className={`list-view__dot list-view__dot--${session.status}`} />
              <span className="list-view__status-text">{STATUS_LABEL[session.status]}</span>
            </span>
            <span className="list-view__col list-view__col--group">
              {session.group
                ? <span className="list-view__group-tag">{session.group}</span>
                : <span className="list-view__no-group">—</span>}
            </span>
            <span className="list-view__col list-view__col--prompt">
              <span className="list-view__prompt-text">{session.prompt}</span>
            </span>
            <span className="list-view__col list-view__col--elapsed">
              {formatElapsed(session.createdAt)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default ListView;
