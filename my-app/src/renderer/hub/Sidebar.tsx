import React, { useEffect, useMemo, useState } from 'react';
import type { AgentSession, SessionStatus } from './types';

const COLLAPSED_STORAGE_KEY = 'hub-sidebar-collapsed';

interface SidebarSession extends AgentSession {
  primarySite?: string | null;
  lastActivityAt?: number;
}

interface SidebarProps {
  sessions?: SidebarSession[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onNewAgent?: () => void;
}

const MOCK_SIDEBAR_SESSIONS: SidebarSession[] = [
  {
    id: 'mock-1',
    prompt: 'Reply to unread DMs on LinkedIn',
    status: 'running',
    createdAt: Date.now() - 1000 * 60 * 4,
    output: [],
    primarySite: 'linkedin.com',
    lastActivityAt: Date.now() - 1000 * 5,
  },
  {
    id: 'mock-2',
    prompt: 'Summarize latest X notifications',
    status: 'idle',
    createdAt: Date.now() - 1000 * 60 * 12,
    output: [],
    primarySite: 'x.com',
    lastActivityAt: Date.now() - 1000 * 60 * 2,
  },
  {
    id: 'mock-3',
    prompt: 'Find 10 SaaS founders hiring eng managers',
    status: 'stuck',
    createdAt: Date.now() - 1000 * 60 * 30,
    output: [],
    primarySite: 'google.com',
    lastActivityAt: Date.now() - 1000 * 60 * 8,
  },
  {
    id: 'mock-4',
    prompt: 'Draft a reply to Jessica from Tuesday',
    status: 'stopped',
    createdAt: Date.now() - 1000 * 60 * 60 * 2,
    output: [],
    primarySite: 'gmail.com',
    lastActivityAt: Date.now() - 1000 * 60 * 55,
  },
  {
    id: 'mock-5',
    prompt: 'Check Reddit for competitor mentions',
    status: 'stopped',
    createdAt: Date.now() - 1000 * 60 * 60 * 5,
    output: [],
    primarySite: 'reddit.com',
    lastActivityAt: Date.now() - 1000 * 60 * 60 * 4,
  },
  {
    id: 'mock-6',
    prompt: 'Old calendar cleanup run',
    status: 'stopped',
    createdAt: Date.now() - 1000 * 60 * 60 * 24,
    output: [],
    primarySite: 'calendar.google.com',
    lastActivityAt: Date.now() - 1000 * 60 * 60 * 23,
    hidden: true,
  },
];

const STATUS_DOT: Record<SessionStatus, { color: string; label: string }> = {
  running: { color: '#3fb950', label: 'Running' },
  idle:    { color: '#d29922', label: 'Waiting for input' },
  stuck:   { color: '#f85149', label: 'Stuck' },
  stopped: { color: '#6e7681', label: 'Stopped' },
  draft:   { color: '#6e7681', label: 'Draft' },
};

function formatRelative(ts: number): string {
  const delta = Date.now() - ts;
  const m = Math.floor(delta / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function faviconUrl(site: string | null | undefined): string | null {
  if (!site) return null;
  const clean = site.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return `https://www.google.com/s2/favicons?domain=${clean}&sz=64`;
}

function PlusIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="2" width="11" height="10" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <line x1="5.5" y1="2.5" x2="5.5" y2="11.5" stroke="currentColor" strokeWidth="1.2" />
      <path
        d={collapsed ? 'M8.5 5L10 7L8.5 9' : 'M10 5L8.5 7L10 9'}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ActiveGroupIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="3" fill="currentColor" />
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

function DoneGroupIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.8 6.2L5.3 7.7L8.2 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HiddenGroupIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M1 6s2-3.5 5-3.5S11 6 11 6s-2 3.5-5 3.5S1 6 1 6z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="6" cy="6" r="1.3" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 2l8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function TerminalFallbackIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 6l2 1.5L4 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 9h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 120ms' }}
    >
      <path d="M3.5 2.5 6.5 5l-3 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SessionRow({
  s,
  selected,
  onSelect,
  collapsed = false,
}: {
  s: SidebarSession;
  selected: boolean;
  onSelect?: (id: string) => void;
  collapsed?: boolean;
}): React.ReactElement {
  const dot = STATUS_DOT[s.status];
  const favicon = faviconUrl(s.primarySite);
  const last = s.lastActivityAt ?? s.createdAt;
  return (
    <button
      type="button"
      className={`sidebar__row${selected ? ' sidebar__row--active' : ''}${collapsed ? ' sidebar__row--collapsed has-tooltip' : ''}`}
      onClick={() => onSelect?.(s.id)}
      title={collapsed ? undefined : s.prompt}
      data-tooltip={collapsed ? s.prompt : undefined}
    >
      <span className="sidebar__row-icon">
        {favicon ? (
          <img src={favicon} alt="" width={18} height={18} />
        ) : (
          <span className="sidebar__row-icon-fallback" aria-label="No site">
            <TerminalFallbackIcon />
          </span>
        )}
        <span className="sidebar__row-dot" style={{ background: dot.color }} aria-label={dot.label} />
      </span>
      {!collapsed && (
        <>
          <span className="sidebar__row-title">{s.prompt}</span>
          <span className="sidebar__row-time">{formatRelative(last)}</span>
        </>
      )}
    </button>
  );
}

interface GroupProps {
  label: string;
  icon: React.ReactElement;
  tone: 'active' | 'done' | 'hidden';
  sessions: SidebarSession[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  defaultOpen?: boolean;
  collapsed?: boolean;
}

function Group({ label, icon, tone, sessions, selectedId, onSelect, defaultOpen = true, collapsed = false }: GroupProps): React.ReactElement | null {
  const [open, setOpen] = useState(defaultOpen);
  if (sessions.length === 0) return null;

  if (collapsed) {
    return (
      <div className={`sidebar__group sidebar__group--collapsed sidebar__group--${tone}`}>
        <div className={`sidebar__group-rail-icon sidebar__group-icon--${tone} has-tooltip`} data-tooltip={`${label} (${sessions.length})`}>
          {icon}
          <span className="sidebar__group-rail-count">{sessions.length}</span>
        </div>
        <div className="sidebar__group-body sidebar__group-body--collapsed">
          {sessions.map((s) => (
            <SessionRow key={s.id} s={s} selected={s.id === selectedId} onSelect={onSelect} collapsed />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar__group">
      <button
        type="button"
        className="sidebar__group-header"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`sidebar__group-icon sidebar__group-icon--${tone}`}>{icon}</span>
        <span className="sidebar__group-label">{label}</span>
        <span className="sidebar__group-count">{sessions.length}</span>
        <span className="sidebar__group-chevron"><ChevronIcon open={open} /></span>
      </button>
      {open && (
        <div className="sidebar__group-body">
          {sessions.map((s) => (
            <SessionRow key={s.id} s={s} selected={s.id === selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ sessions, selectedId, onSelect, onNewAgent }: SidebarProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }, [collapsed]);

  const data = sessions ?? MOCK_SIDEBAR_SESSIONS;

  const { active, done, hidden } = useMemo(() => {
    const sortByActivity = (a: SidebarSession, b: SidebarSession): number =>
      (b.lastActivityAt ?? b.createdAt) - (a.lastActivityAt ?? a.createdAt);
    const act: SidebarSession[] = [];
    const don: SidebarSession[] = [];
    const hid: SidebarSession[] = [];
    for (const s of data) {
      if (s.hidden) hid.push(s);
      else if (s.status === 'running' || s.status === 'idle' || s.status === 'stuck' || s.status === 'draft') act.push(s);
      else don.push(s);
    }
    act.sort(sortByActivity);
    don.sort(sortByActivity);
    hid.sort(sortByActivity);
    return { active: act, done: don, hidden: hid };
  }, [data]);

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`} aria-label="Agent sessions">
      <div className="sidebar__header">
        {!collapsed && <span className="sidebar__header-title">Agents</span>}
        <div className="sidebar__header-actions">
          {!collapsed && (
            <button
              type="button"
              className="sidebar__icon-btn has-tooltip"
              onClick={onNewAgent}
              aria-label="New agent"
              data-tooltip="New agent"
            >
              <PlusIcon />
            </button>
          )}
          <button
            type="button"
            className="sidebar__icon-btn has-tooltip"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            data-tooltip={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <SidebarToggleIcon collapsed={collapsed} />
          </button>
        </div>
      </div>

      <div className="sidebar__groups">
        <Group label="Active" tone="active" icon={<ActiveGroupIcon />} sessions={active} selectedId={selectedId} onSelect={onSelect} defaultOpen collapsed={collapsed} />
        <Group label="Done" tone="done" icon={<DoneGroupIcon />} sessions={done} selectedId={selectedId} onSelect={onSelect} defaultOpen collapsed={collapsed} />
        <Group label="Hidden" tone="hidden" icon={<HiddenGroupIcon />} sessions={hidden} selectedId={selectedId} onSelect={onSelect} defaultOpen={false} collapsed={collapsed} />
      </div>
    </aside>
  );
}

export default Sidebar;
