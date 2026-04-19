import React, { useRef, useEffect, useState } from 'react';
import { STATUS_LABEL, EMPTY_TITLE, EMPTY_BODY, OUTPUT_TYPE_LABEL } from './constants';
import type { AgentSession, OutputEntry } from './types';

interface SessionPanelProps {
  session: AgentSession | null;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ThinkingIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 6.5C5.5 5.5 6 5 7 5s1.5.5 1.5 1.5c0 .7-.5 1-1 1.3-.2.1-.5.3-.5.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="7" cy="10" r="0.6" fill="currentColor" />
    </svg>
  );
}

function ToolIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 10l4-4M8 4l4-4M6 6l2 2M10 2l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="1" y="9" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ResultIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 7l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ErrorIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 4.5v3M7 9.5v.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TextIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 4h8M3 7h6M3 10h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function getEntryIcon(type: OutputEntry['type']): React.ReactElement {
  switch (type) {
    case 'thinking': return <ThinkingIcon />;
    case 'tool_call': return <ToolIcon />;
    case 'tool_result': return <ResultIcon />;
    case 'error': return <ErrorIcon />;
    default: return <TextIcon />;
  }
}

function OutputEntryRow({ entry }: { entry: OutputEntry }): React.ReactElement {
  const [collapsed, setCollapsed] = useState(entry.type === 'thinking');

  const isCollapsible = entry.type === 'thinking' || entry.type === 'tool_result';
  const label = entry.tool
    ? `${OUTPUT_TYPE_LABEL[entry.type]} — ${entry.tool}`
    : OUTPUT_TYPE_LABEL[entry.type] ?? entry.type;

  return (
    <div className={`output-entry output-entry--${entry.type}`}>
      <div
        className={`output-entry__header${isCollapsible ? ' output-entry__header--clickable' : ''}`}
        onClick={isCollapsible ? () => setCollapsed((c) => !c) : undefined}
        role={isCollapsible ? 'button' : undefined}
        tabIndex={isCollapsible ? 0 : undefined}
        aria-expanded={isCollapsible ? !collapsed : undefined}
        onKeyDown={isCollapsible ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed((c) => !c); } } : undefined}
      >
        <span className="output-entry__icon" aria-hidden="true">
          {getEntryIcon(entry.type)}
        </span>
        <span className="output-entry__label">{label}</span>
        {entry.duration != null && (
          <span className="output-entry__duration">{formatDuration(entry.duration)}</span>
        )}
        <span className="output-entry__time">{formatTimestamp(entry.timestamp)}</span>
        {isCollapsible && (
          <span className={`output-entry__chevron${collapsed ? '' : ' output-entry__chevron--open'}`} aria-hidden="true">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
      </div>
      {!collapsed && (
        <div className="output-entry__content">
          <pre className="output-entry__pre">{entry.content}</pre>
        </div>
      )}
    </div>
  );
}

export function SessionPanel({ session }: SessionPanelProps): React.ReactElement {
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [session?.output.length]);

  if (!session) {
    return (
      <div className="hub-main">
        <div className="hub-empty" role="status" aria-label={EMPTY_TITLE}>
          <div className="hub-empty__icon" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="4" y="4" width="24" height="24" rx="6" stroke="currentColor" strokeWidth="1.5" />
              <path d="M12 16h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M16 12v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <p className="hub-empty__title">{EMPTY_TITLE}</p>
          <p className="hub-empty__body">{EMPTY_BODY}</p>
          <p className="hub-empty__hint">Press <kbd className="hub-empty__kbd">Ctrl</kbd> + <kbd className="hub-empty__kbd">N</kbd> to start a new session</p>
        </div>
      </div>
    );
  }

  const statusLabel = STATUS_LABEL[session.status] ?? session.status;

  return (
    <div className="hub-main">
      <div className="session-panel">
        <header className="session-panel__header">
          <div className="session-panel__header-left">
            <span className={`session-panel__dot session-panel__dot--${session.status}`} aria-hidden="true" />
            <span className="session-panel__status-label">{statusLabel}</span>
          </div>
          <div className="session-panel__header-prompt">
            <p className="session-panel__prompt" title={session.prompt}>
              {session.prompt}
            </p>
          </div>
          <div className="session-panel__header-meta">
            {session.toolCallCount > 0 && (
              <span className="session-panel__meta-item">{session.toolCallCount} tool calls</span>
            )}
            <span className="session-panel__meta-item">{formatElapsedLong(session.createdAt)}</span>
          </div>
        </header>

        {session.status === 'running' && (
          <div className="session-panel__progress-track" aria-hidden="true">
            <div className="session-panel__progress-fill" />
          </div>
        )}

        <div className="session-panel__output" ref={outputRef} role="log" aria-live="polite" aria-label="Session output">
          {session.output.length === 0 ? (
            <div className="session-panel__output-empty">
              {session.status === 'draft' ? (
                <p className="session-panel__output-empty-text">Session not started yet. Press Enter to submit.</p>
              ) : (
                <>
                  <span className="session-panel__output-spinner" aria-hidden="true" />
                  <p className="session-panel__output-empty-text">Waiting for agent output...</p>
                </>
              )}
            </div>
          ) : (
            session.output.map((entry) => (
              <OutputEntryRow key={entry.id} entry={entry} />
            ))
          )}
          {session.status === 'running' && session.output.length > 0 && (
            <div className="session-panel__cursor-line">
              <span className="session-panel__cursor" aria-hidden="true" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatElapsedLong(createdAt: number): string {
  const seconds = Math.floor((Date.now() - createdAt) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default SessionPanel;
