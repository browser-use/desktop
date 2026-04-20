import React, { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/renderer/components/base/Toast';
import { STATUS_LABEL } from './constants';
import { ContentRenderer, getPreview } from './ContentRenderer';
import { adaptSession } from './types';
import type { AgentSession, OutputEntry } from './types';

function formatElapsed(createdAt: number): string {
  const seconds = Math.floor((Date.now() - createdAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function BrowseIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 5.5h11" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function CodeIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M5 4L2 7l3 3M9 4l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CameraIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="3.5" width="11" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function NetworkIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 7h11M7 1.5c-2 2-2 5 0 5s2 3 0 5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function FileIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M8 1.5H4a1.5 1.5 0 00-1.5 1.5v8A1.5 1.5 0 004 12.5h6a1.5 1.5 0 001.5-1.5V5L8 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 1.5V5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function ToolGenericIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 1.5v2M7 10.5v2M1.5 7h2M10.5 7h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function ErrorIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 4.5v3M7 9.5v.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const BROWSER_KEYWORDS = /goto|nav|tab|click|scroll|hover|select|wait|back|forward|refresh|browse|page/i;
const CODE_KEYWORDS = /^js$|javascript|eval|exec|script|shell|bash|code|run_code/i;
const SCREENSHOT_KEYWORDS = /screen|capture|snap|photo/i;
const NETWORK_KEYWORDS = /http|fetch|request|api|curl|download|upload/i;
const FILE_KEYWORDS = /file|read|write|search|find|glob|grep|dir|folder|path/i;

function toolIcon(name?: string): React.ReactElement {
  if (!name) return <ToolGenericIcon />;
  if (CODE_KEYWORDS.test(name)) return <CodeIcon />;
  if (SCREENSHOT_KEYWORDS.test(name)) return <CameraIcon />;
  if (NETWORK_KEYWORDS.test(name)) return <NetworkIcon />;
  if (BROWSER_KEYWORDS.test(name)) return <BrowseIcon />;
  if (FILE_KEYWORDS.test(name)) return <FileIcon />;
  return <ToolGenericIcon />;
}

function ToolStep({ entry }: { entry: OutputEntry }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((o) => !o);

  const hasResult = !!entry.result;
  const dur = entry.result?.duration;

  return (
    <div className={`step step--tool${hasResult ? '' : ' step--tool-active'}`}>
      <div className="step__row" onClick={toggle} role="button" tabIndex={0} aria-expanded={open}>
        <span className="step__icon">{toolIcon(entry.tool)}</span>
        <span className="step__name">{entry.tool}</span>
        {!hasResult && <span className="step__spinner" />}
        <span className="step__fill" />
        {dur != null && <span className="step__dur">{formatDuration(dur)}</span>}
      </div>
      {open && (
        <div className="step__detail">
          <ContentRenderer content={entry.content} type="tool_call" />
          {hasResult && (
            <>
              <div className="step__divider" />
              <ContentRenderer content={entry.result!.content} type="tool_result" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ToolGroup({ entry }: { entry: OutputEntry }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((o) => !o);
  const count = entry.groupCount ?? 0;
  const children = entry.groupEntries ?? [];

  return (
    <div className="step step--tool-group">
      <div className="step__row" onClick={toggle} role="button" tabIndex={0} aria-expanded={open}>
        <span className="step__icon">{toolIcon(entry.tool)}</span>
        <span className="step__name">{entry.tool}</span>
        <span className="step__badge">{count}</span>
        <span className="step__fill" />
      </div>
      {open && (
        <div className="step__group-children">
          {children.map((child) => (
            <ToolStep key={child.id} entry={child} />
          ))}
        </div>
      )}
    </div>
  );
}

function OutputRow({ entry }: { entry: OutputEntry }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((o) => !o);

  if (entry.type === 'thinking') {
    return (
      <div className="step step--thinking">
        <span className="step__text">{entry.content}</span>
      </div>
    );
  }

  if (entry.type === 'tool_call') {
    if (entry.groupCount && entry.groupCount > 1) {
      return <ToolGroup entry={entry} />;
    }
    return <ToolStep entry={entry} />;
  }

  if (entry.type === 'tool_result') {
    const dur = entry.duration;
    return (
      <div className="step step--tool">
        <div className="step__row" onClick={toggle} role="button" tabIndex={0} aria-expanded={open}>
          <span className="step__icon">{toolIcon(entry.tool)}</span>
          <span className="step__name">{entry.tool}</span>
          <span className="step__fill" />
          {dur != null && <span className="step__dur">{formatDuration(dur)}</span>}
        </div>
        {open && (
          <div className="step__detail">
            <ContentRenderer content={entry.content} type="tool_result" />
          </div>
        )}
      </div>
    );
  }

  if (entry.type === 'skill_written') {
    return (
      <div className="step step--skill">
        <span className="step__icon">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 11.5V3a1.5 1.5 0 011.5-1.5h7A1.5 1.5 0 0112 3v7a1.5 1.5 0 01-1.5 1.5h-7L2 11.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M5 5h4M5 7.5h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="step__skill-label">Learned</span>
        <span className="step__skill-topic">{entry.content}</span>
      </div>
    );
  }

  if (entry.type === 'user_input') {
    return (
      <div className="step step--user-input">
        <span className="step__user-chevron">&rsaquo;</span>
        <span className="step__user-text">{entry.content}</span>
      </div>
    );
  }

  if (entry.type === 'done') {
    return (
      <div className="step step--done">
        <div className="step__done-divider" />
        <pre className="step__done-text">{entry.content}</pre>
      </div>
    );
  }

  if (entry.type === 'error') {
    return (
      <div className="step step--error">
        <span className="step__text">{entry.content}</span>
      </div>
    );
  }

  return (
    <div className="step step--output">
      <span className="step__text">{entry.content}</span>
    </div>
  );
}

function BrowserIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 5.5h11" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="3.5" cy="4" r="0.5" fill="currentColor" />
      <circle cx="5.5" cy="4" r="0.5" fill="currentColor" />
    </svg>
  );
}

function OutputIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path d="M3 4h8M3 7h6M3 10h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.5 4.5V3a1.5 1.5 0 00-1.5-1.5H3A1.5 1.5 0 001.5 3v5A1.5 1.5 0 003 9.5h1.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function RerunIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path d="M2 7a5 5 0 019.33-2.5M12 7a5 5 0 01-9.33 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M11 2v3h-3M3 12V9h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FollowUpInput({ sessionId, onUserInput }: { sessionId: string; onUserInput: (text: string) => void }): React.ReactElement {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    console.log('[FollowUpInput] sending follow-up', { id: sessionId, prompt: trimmed });
    onUserInput(trimmed);
    setValue('');
  }, [value, sessionId, onUserInput]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [value]);

  return (
    <div className="followup">
      <span className="followup__chevron">&rsaquo;</span>
      <textarea
        ref={textareaRef}
        className="followup__input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Follow up..."
        rows={1}
      />
    </div>
  );
}

function CloseIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

interface AgentPaneProps {
  session: AgentSession;
  focused?: boolean;
  onRerun?: (prompt: string) => void;
  onFollowUp?: (sessionId: string, prompt: string) => void;
  onDismiss?: (sessionId: string) => void;
  onCancel?: (sessionId: string) => void;
  onSelect?: (sessionId: string) => void;
  onOpenFollowUp?: () => void;
}

export function AgentPane({ session, focused, onRerun, onFollowUp, onDismiss, onCancel, onSelect, onOpenFollowUp }: AgentPaneProps): React.ReactElement {
  const toast = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserDead, setBrowserDead] = useState(false);
  const [showFollowUpBar, setShowFollowUpBar] = useState(false);
  const { entries } = useMemo(() => adaptSession(session), [session]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    api.sessions.viewIsAttached(session.id).then((attached) => {
      if (attached) setShowBrowser(true);
    }).catch(() => {});
    api.sessions.get(session.id).then((s) => {
      if (s && s.hasBrowser === false && session.status !== 'draft') {
        console.log('[AgentPane] browser dead on mount', { id: session.id, hasBrowser: false });
        setBrowserDead(true);
      }
    }).catch(() => {});
  }, [session.id, session.status]);

  const toggleBrowser = useCallback(async () => {
    if (browserDead) {
      setBrowserDead(false);
      return;
    }

    const api = window.electronAPI;
    if (!api) return;

    if (showBrowser) {
      console.log('[AgentPane] detaching browser view', { id: session.id });
      await api.sessions.viewDetach(session.id);
      setShowBrowser(false);
    } else {
      const el = paneRef.current?.querySelector('.pane__output') as HTMLElement | null;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      console.log('[AgentPane] attaching browser view', { id: session.id, bounds: rect });
      const ok = await api.sessions.viewAttach(session.id, {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
      if (ok) setShowBrowser(true);
      else setBrowserDead(true);
    }
  }, [showBrowser, session.id]);

  useEffect(() => {
    if (!showBrowser) return;
    const el = paneRef.current?.querySelector('.pane__output') as HTMLElement | null;
    if (!el) return;
    const api = window.electronAPI;
    if (!api) return;

    const updateBounds = () => {
      const rect = el.getBoundingClientRect();
      api.sessions.viewAttach(session.id, {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }).catch(() => {});
    };

    const observer = new ResizeObserver(updateBounds);
    observer.observe(el);
    return () => observer.disconnect();
  }, [showBrowser, session.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  const elapsed = formatElapsed(session.createdAt);
  const statusText = STATUS_LABEL[session.status] ?? session.status;

  return (
    <div ref={paneRef} className={`pane pane--${session.status}${focused ? ' pane--focused' : ''}`} onClick={() => onSelect?.(session.id)}>
      <div className="pane__header">
        <span className={`pane__dot pane__dot--${session.status}`} />
        <span className="pane__prompt">{session.prompt}</span>
        <div className="pane__actions">
          {browserDead ? (
            <span className="pane__action-btn pane__action-btn--disabled">
              <BrowserIcon />
              <span>Browser ended</span>
            </span>
          ) : (
            <button
              className={`pane__action-btn pane__action-btn--primary${showBrowser ? ' pane__action-btn--active' : ''}`}
              onClick={toggleBrowser}
            >
              {showBrowser ? <OutputIcon /> : <BrowserIcon />}
              <span>{showBrowser ? 'Output' : 'Browser'}</span>
            </button>
          )}
          <button
            className="pane__action-btn"
            onClick={() => {
              navigator.clipboard.writeText(session.prompt);
              toast.show({ variant: 'success', title: 'Copied to clipboard', duration: 2000 });
            }}
          >
            <CopyIcon />
            <span>Copy</span>
          </button>
          {onRerun && (
            <button
              className="pane__action-btn"
              onClick={() => onRerun(session.prompt)}
            >
              <RerunIcon />
              <span>Rerun</span>
            </button>
          )}
          {(session.status === 'running' || session.status === 'stuck') && onCancel && (
            <button
              className="pane__action-btn pane__action-btn--danger"
              onClick={() => onCancel(session.id)}
            >
              <CloseIcon />
              <span>Stop</span>
            </button>
          )}
          {session.status === 'idle' && onOpenFollowUp && (
            <button
              className="pane__action-btn pane__action-btn--primary"
              onClick={onOpenFollowUp}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span>Follow up</span>
            </button>
          )}
          {session.status !== 'running' && session.status !== 'stuck' && onDismiss && (
            <button
              className="pane__action-btn pane__action-btn--danger"
              onClick={() => onDismiss(session.id)}
            >
              <CloseIcon />
              <span>Close</span>
            </button>
          )}
        </div>
      </div>
      <div className="pane__meta">
        <span className="pane__status">{statusText}</span>
        <span className="pane__sep" />
        <span className="pane__elapsed">{elapsed}</span>
        {session.group && (
          <>
            <span className="pane__sep" />
            <span className="pane__group">{session.group}</span>
          </>
        )}
      </div>

      {session.status === 'running' && (
        <div className="pane__progress">
          <div className="pane__progress-bar" />
        </div>
      )}

      <div className="pane__output" ref={scrollRef} style={showBrowser ? { visibility: 'hidden' } : undefined}>
        {entries.length === 0 && session.status === 'draft' && (
          <div className="pane__output-empty">
            <p className="pane__output-empty-text">Not started yet</p>
          </div>
        )}
        {entries.length === 0 && session.status === 'running' && (
          <div className="pane__output-empty">
            <span className="pane__spinner" />
            <p className="pane__output-empty-text">Starting...</p>
          </div>
        )}
        {entries.map((entry) => (
          <OutputRow key={entry.id} entry={entry} />
        ))}
        {session.status === 'running' && entries.length > 0 && (
          <div className="pane__cursor-row">
            <span className="pane__cursor" />
          </div>
        )}
        {session.status === 'idle' && !session.error && onFollowUp && (
          <FollowUpInput
            sessionId={session.id}
            onUserInput={(text) => onFollowUp(session.id, text)}
          />
        )}
        {(session.status === 'stopped' || session.error) && onRerun && (
          <div className="pane__rerun">
            {session.error && <span className="pane__rerun-error">{session.error}</span>}
            <button className="pane__rerun-btn" onClick={() => onRerun(session.prompt)}>
              <RerunIcon />
              <span>Rerun task</span>
            </button>
          </div>
        )}
      </div>

      {showFollowUpBar && showBrowser && session.status === 'idle' && onFollowUp && (
        <div className="pane__browser-followup">
          <FollowUpInput
            sessionId={session.id}
            onUserInput={(text) => {
              onFollowUp(session.id, text);
              setShowFollowUpBar(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

export default AgentPane;
