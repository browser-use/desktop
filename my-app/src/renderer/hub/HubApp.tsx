import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AgentPane } from './AgentPane';
import { ListView } from './ListView';
import { Dashboard } from './Dashboard';
import { CommandBar } from './CommandBar';
import { KeybindingsOverlay } from './KeybindingsOverlay';
import { SettingsPane } from './SettingsPane';
import { useVimKeys } from './useVimKeys';
import { MOCK_SESSIONS } from './mock-data';
import type { AgentSession, HlEvent } from './types';
import type { ActionId } from './keybindings';

function groupSessions(sessions: AgentSession[]): { group: string; sessions: AgentSession[] }[] {
  const groups = new Map<string, AgentSession[]>();
  for (const s of sessions) {
    const key = s.group ?? 'ungrouped';
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  }
  return Array.from(groups, ([group, items]) => ({ group, sessions: items }));
}

type ViewMode = 'dashboard' | 'grid' | 'list';

let sessionCounter = MOCK_SESSIONS.length + 1;
let entryCounter = 1000;

function uid(prefix: string): string {
  return `${prefix}-${++entryCounter}`;
}

function PlusIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function GridIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8" y="1.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1.5" y="8" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8" y="8" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ListIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 3.5h10M2 7h10M2 10.5h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function DashboardIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="1.5" width="11" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1.5" y="8.5" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8.5" y="8.5" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function HubApp(): React.ReactElement {
  const [sessions, setSessions] = useState<AgentSession[]>(MOCK_SESSIONS);
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [cmdBarOpen, setCmdBarOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);

  const vimHandlers = useMemo<Partial<Record<ActionId, () => void>>>(() => ({
    'nav.down': () => setFocusIndex((i) => Math.min(i + 1, sessions.length - 1)),
    'nav.up': () => setFocusIndex((i) => Math.max(i - 1, 0)),
    'nav.top': () => setFocusIndex(0),
    'nav.bottom': () => setFocusIndex(sessions.length - 1),
    'nav.open': () => {
      console.log('[VimKeys] open session', sessions[focusIndex]?.id);
    },

    'goto.dashboard': () => setViewMode('dashboard'),
    'goto.agents': () => setViewMode('grid'),
    'goto.list': () => setViewMode('list'),
    'goto.settings': () => setSettingsOpen(true),

    'search.open': () => setCmdBarOpen(true),

    'action.create': () => setCmdBarOpen(true),

    'scroll.halfDown': () => {
      const el = document.querySelector('.hub-grid, .list-view__body, .dashboard');
      if (el) el.scrollBy({ top: el.clientHeight / 2, behavior: 'smooth' });
    },
    'scroll.halfUp': () => {
      const el = document.querySelector('.hub-grid, .list-view__body, .dashboard');
      if (el) el.scrollBy({ top: -(el.clientHeight / 2), behavior: 'smooth' });
    },

    'meta.help': () => setHelpOpen((prev) => !prev),
    'meta.commandPalette': () => setCmdBarOpen((prev) => !prev),
    'meta.escape': () => {
      if (helpOpen) { setHelpOpen(false); return; }
      if (settingsOpen) { setSettingsOpen(false); return; }
      if (cmdBarOpen) { setCmdBarOpen(false); return; }
    },
  }), [sessions, focusIndex, helpOpen, settingsOpen, cmdBarOpen]);

  const vim = useVimKeys(vimHandlers);

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { on?: { openSettings?: (cb: () => void) => () => void } } }).electronAPI;
    if (api?.on?.openSettings) {
      const unsub = api.on.openSettings(() => {
        console.log('[HubApp] open-settings via IPC');
        setSettingsOpen(true);
      });
      return unsub;
    }
  }, []);

  const handleCreateSession = useCallback((prompt: string) => {
    const id = `session-${++sessionCounter}`;
    const now = Date.now();

    const newSession: AgentSession = {
      id,
      prompt,
      status: 'running',
      createdAt: now,
      output: [
        { type: 'thinking', text: `Analyzing the task: "${prompt}". Let me break this down and determine the best approach.` },
      ],
    };

    console.log('[HubApp] createSession', { id, prompt });
    setSessions((prev) => [...prev, newSession]);

    const pushEvent = (event: HlEvent, statusOverride?: AgentSession['status']) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          const updated = { ...s, output: [...s.output, event] };
          if (statusOverride) updated.status = statusOverride;
          return updated;
        }),
      );
    };

    setTimeout(() => pushEvent({ type: 'tool_call', name: 'file.search', args: { pattern: '**/*.ts', query: prompt.split(' ').slice(0, 3).join(' ') }, iteration: 1 }), 2000);
    setTimeout(() => pushEvent({ type: 'tool_result', name: 'file.search', ok: true, preview: 'Found 7 relevant files across 3 directories.', ms: 1500 }), 3500);
    setTimeout(() => pushEvent({ type: 'thinking', text: 'I\'ve found the relevant files. Now analyzing the code structure and planning modifications.' }), 5000);
    setTimeout(() => pushEvent({ type: 'tool_call', name: 'file.read', args: { path: 'src/main/index.ts', lines: '1-50' }, iteration: 2 }), 7000);
    setTimeout(() => pushEvent({ type: 'tool_result', name: 'file.read', ok: true, preview: 'Read 50 lines from src/main/index.ts. Found the entry point configuration and module initialization.', ms: 800 }), 8000);
    setTimeout(() => pushEvent({ type: 'done', summary: 'Implementation complete. I\'ve made the following changes:\n\n1. Updated the module configuration\n2. Added proper error handling\n3. Refactored the initialization sequence\n\nAll changes have been saved.', iterations: 2 }, 'stopped'), 10000);
  }, []);

  const hasNoSessions = sessions.length === 0;

  const handleSelectSession = useCallback((id: string) => {
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx >= 0) setFocusIndex(idx);
    console.log('[HubApp] selectSession', { id });
  }, [sessions]);

  return (
    <div className="hub-root">
      <header className="hub-toolbar">
        <div className="hub-toolbar__left">
          <span className="hub-toolbar__title">Agent Hub</span>
        </div>
        <div className="hub-toolbar__right">
          <button
            className="hub-toolbar__new-btn"
            onClick={() => setCmdBarOpen(true)}
            aria-label="New agent"
            title="New agent"
          >
            <PlusIcon />
            <span className="hub-toolbar__new-label">New agent</span>
          </button>
          {sessions.length > 0 && (
            <div className="hub-toolbar__view-toggle" role="radiogroup" aria-label="View mode">
              <button
                className={`hub-toolbar__view-btn${viewMode === 'dashboard' ? ' hub-toolbar__view-btn--active' : ''}`}
                onClick={() => setViewMode('dashboard')}
                aria-label="Dashboard"
                title="Dashboard"
              >
                <DashboardIcon />
              </button>
              <button
                className={`hub-toolbar__view-btn${viewMode === 'grid' ? ' hub-toolbar__view-btn--active' : ''}`}
                onClick={() => setViewMode('grid')}
                aria-label="Grid view"
                title="Grid view"
              >
                <GridIcon />
              </button>
              <button
                className={`hub-toolbar__view-btn${viewMode === 'list' ? ' hub-toolbar__view-btn--active' : ''}`}
                onClick={() => setViewMode('list')}
                aria-label="List view"
                title="List view"
              >
                <ListIcon />
              </button>
            </div>
          )}
        </div>
      </header>

      {hasNoSessions ? (
        <div className="hub-empty-state">
          <div className="hub-empty-state__icon" aria-hidden="true">
            <PlusIcon />
          </div>
          <p className="hub-empty-state__title">Start your first agent session</p>
          <p className="hub-empty-state__body">Type a task below to begin</p>
        </div>
      ) : viewMode === 'dashboard' ? (
        <Dashboard sessions={sessions} onSwitchToGrid={() => setViewMode('grid')} />
      ) : viewMode === 'grid' ? (
        <div className="hub-grouped-grid">
          {groupSessions(sessions).map(({ group, sessions: groupSessions_ }) => (
            <div key={group} className="hub-group">
              <div className="hub-group__header">
                <span className="hub-group__name">{group}</span>
                <span className="hub-group__count">{groupSessions_.length}</span>
              </div>
              <div className="hub-grid" data-count={Math.min(groupSessions_.length, 4)}>
                {groupSessions_.map((session) => {
                  const globalIdx = sessions.findIndex((s) => s.id === session.id);
                  return (
                    <AgentPane
                      key={session.id}
                      session={session}
                      focused={globalIdx === focusIndex}
                      onRerun={handleCreateSession}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ListView
          sessions={sessions}
          onSelectSession={handleSelectSession}
          focusIndex={focusIndex}
        />
      )}

      {vim.chordPrefix && (
        <div className="chord-indicator">
          <kbd className="chord-indicator__key">{vim.chordPrefix}</kbd>
          <span className="chord-indicator__hint">...</span>
        </div>
      )}

      <CommandBar
        open={cmdBarOpen}
        onClose={() => setCmdBarOpen(false)}
        onSubmit={handleCreateSession}
      />

      <KeybindingsOverlay
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        keybindings={vim.keybindings}
        onOpenSettings={() => {
          setHelpOpen(false);
          setSettingsOpen(true);
        }}
      />

      <SettingsPane
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        keybindings={vim.keybindings}
        overrides={vim.overrides}
        onUpdateBinding={vim.updateBinding}
        onResetBinding={vim.resetBinding}
        onResetAll={vim.resetAll}
      />
    </div>
  );
}

export default HubApp;
