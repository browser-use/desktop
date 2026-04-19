import React, { useCallback, useRef, useState } from 'react';
import { SessionCard } from './SessionCard';
import { APP_TITLE, INPUT_PLACEHOLDER, EMPTY_SIDEBAR_TITLE, EMPTY_SIDEBAR_BODY } from './constants';
import type { AgentSession } from './types';

interface SidebarProps {
  sessions: AgentSession[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCreateSession: (prompt: string) => void;
}

function SettingsIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M6.5 1.5L6.8 3.1C6.3 3.3 5.8 3.6 5.4 4L3.8 3.4L2.3 5.9L3.6 7C3.5 7.3 3.5 7.7 3.5 8C3.5 8.3 3.5 8.7 3.6 9L2.3 10.1L3.8 12.6L5.4 12C5.8 12.4 6.3 12.7 6.8 12.9L7.1 14.5H9.5L9.8 12.9C10.3 12.7 10.8 12.4 11.2 12L12.8 12.6L14.3 10.1L13 9C13.1 8.7 13.1 8.3 13.1 8C13.1 7.7 13.1 7.3 13 7L14.3 5.9L12.8 3.4L11.2 4C10.8 3.6 10.3 3.3 9.8 3.1L9.5 1.5H6.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="8.3" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

function PlusIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ArrowUpIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 12V3M3 6.5L7 2.5L11 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Sidebar({
  sessions,
  selectedSessionId,
  onSelectSession,
  onCreateSession,
}: SidebarProps): React.ReactElement {
  const [prompt, setPrompt] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    console.log('[Sidebar] handleSubmit', { prompt: trimmed });
    onCreateSession(trimmed);
    setPrompt('');
    textareaRef.current?.focus();
  }, [prompt, onCreateSession]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const runningCount = sessions.filter((s) => s.status === 'running').length;

  return (
    <aside className="hub-sidebar" aria-label="Sessions sidebar">
      <header className="hub-sidebar__header">
        <div className="hub-sidebar__header-left">
          <span className="hub-sidebar__title">{APP_TITLE}</span>
          {runningCount > 0 && (
            <span className="hub-sidebar__running-badge">{runningCount}</span>
          )}
        </div>
        <button
          className="hub-sidebar__new-btn"
          onClick={() => textareaRef.current?.focus()}
          title="New session"
          aria-label="New session"
        >
          <PlusIcon />
        </button>
      </header>

      <div className="hub-sidebar__session-list" role="list" aria-label="Session list">
        {sessions.length === 0 ? (
          <div className="hub-sidebar__empty">
            <div className="hub-sidebar__empty-icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <p className="hub-sidebar__empty-title">{EMPTY_SIDEBAR_TITLE}</p>
            <p className="hub-sidebar__empty-text">{EMPTY_SIDEBAR_BODY}</p>
          </div>
        ) : (
          sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              isSelected={session.id === selectedSessionId}
              onClick={() => onSelectSession(session.id)}
            />
          ))
        )}
      </div>

      <div className="hub-sidebar__footer">
        <div className={`hub-sidebar__input-wrapper${inputFocused ? ' hub-sidebar__input-wrapper--focused' : ''}`}>
          <textarea
            ref={textareaRef}
            className="hub-sidebar__input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder={INPUT_PLACEHOLDER}
            rows={2}
            aria-label="New session prompt"
          />
          <div className="hub-sidebar__input-actions">
            <span className="hub-sidebar__input-hint">
              {prompt.trim() ? '↵ send' : '⇧↵ newline'}
            </span>
            <button
              className="hub-sidebar__submit"
              onClick={handleSubmit}
              disabled={!prompt.trim()}
              aria-label="Start session"
              title="Start session (Enter)"
            >
              <ArrowUpIcon />
            </button>
          </div>
        </div>

        <div className="hub-sidebar__footer-bar">
          <button
            className="hub-sidebar__settings-btn"
            aria-label="Settings"
            title="Settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
