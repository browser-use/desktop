import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

interface ProcessInfo {
  label: string;
  type: string;
  mb: number;
  sessionId?: string;
}

interface MemoryData {
  totalMb: number;
  sessions: Array<{ id: string; mb: number; status: string }>;
  processes: ProcessInfo[];
  processCount: number;
}

function formatGb(mb: number): string {
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function statusDotClass(status: string): string {
  switch (status) {
    case 'running': return 'mem__dot--running';
    case 'stuck': return 'mem__dot--stuck';
    case 'idle': return 'mem__dot--idle';
    default: return 'mem__dot--stopped';
  }
}

export function MemoryIndicator(): React.ReactElement | null {
  const [open, setOpen] = useState(false);

  const { data } = useQuery<MemoryData>({
    queryKey: ['memory'],
    queryFn: async () => {
      const api = window.electronAPI;
      if (!api) return { totalMb: 0, sessions: [], processes: [], processCount: 0 };
      return api.sessions.memory();
    },
    refetchInterval: 5000,
    staleTime: 4000,
  });

  if (!data) return null;

  return (
    <div className="mem-indicator">
      <button
        className="mem-indicator__btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <rect x="2" y="1.5" width="10" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="4" y="7" width="2" height="3.5" rx="0.5" fill="currentColor" opacity="0.5" />
          <rect x="7.5" y="4.5" width="2" height="6" rx="0.5" fill="currentColor" opacity="0.7" />
        </svg>
        <span>{formatGb(data.totalMb)}</span>
      </button>
      {open && (
        <>
          <div className="mem-indicator__scrim" onClick={() => setOpen(false)} />
          <div className="mem-indicator__dropdown">
            <div className="mem__header">
              <span className="mem__title">Memory usage</span>
              <span className="mem__total">{formatGb(data.totalMb)}</span>
            </div>
            <div className="mem__processes">
              {(data.processes ?? [])
                .sort((a, b) => {
                  if (a.sessionId && !b.sessionId) return -1;
                  if (!a.sessionId && b.sessionId) return 1;
                  return b.mb - a.mb;
                })
                .map((p, i) => (
                  <div key={i} className="mem__session-row">
                    <span className={`mem__dot ${p.sessionId ? statusDotClass(data.sessions.find((s) => s.id === p.sessionId)?.status ?? 'stopped') : 'mem__dot--system'}`} />
                    <span className="mem__session-id">
                      {p.label}
                    </span>
                    <span className="mem__session-mb">{Math.round(p.mb)} MB</span>
                    {p.sessionId && (
                      <button
                        className="mem__kill-btn"
                        onClick={() => {
                          const api = window.electronAPI;
                          if (!api || !p.sessionId) return;
                          api.sessions.cancel(p.sessionId).catch(() => {});
                          api.sessions.hide(p.sessionId).catch(() => {});
                        }}
                        aria-label="Stop session"
                      >
                        <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                          <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
