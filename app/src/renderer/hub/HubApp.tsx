import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentPane } from './AgentPane';
import { Dashboard } from './Dashboard';
import { KeybindingsOverlay } from './KeybindingsOverlay';
import { CommandBar } from './CommandBar';
import { SettingsPane } from './SettingsPane';
import { useVimKeys } from './useVimKeys';
import { useSessionsQuery, useUpdateSession } from './useSessionsQuery';
import { MemoryIndicator } from './MemoryIndicator';
import { Sidebar } from './Sidebar';
import { MOCK_SESSIONS } from './mock-data';
import type { AgentSession, HlEvent } from './types';
import type { ActionId } from './keybindings';
import type { SettingsOpenIntent, SettingsSectionId } from './SettingsPane';
import { orderSessionsForSidebar } from './sessionOrdering';
import { ChatPane } from './chat/ChatPane';
import { useUIStore } from './state/uiStore';
import { useSessionsBridge } from './state/useSessionsBridge';

type ViewMode = 'dashboard' | 'grid' | 'chat' | 'settings';
type SettingsOpenPayload = {
  sectionId?: SettingsSectionId;
  focusBrowserCodeProvider?: string;
};

let sessionCounter = MOCK_SESSIONS.length + 1;

function PlusIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function HubApp(): React.ReactElement {
  const isMock = import.meta.env.VITE_MOCK_MODE === '1';
  const [mockSessions, setMockSessions] = useState<AgentSession[]>(isMock ? MOCK_SESSIONS : []);
  const sessionsQuery = useSessionsQuery();
  const updateSession = useUpdateSession();
  const sessions = isMock ? mockSessions : (sessionsQuery.data ?? []);
  const setSessions = isMock ? setMockSessions : () => {};

  // Mirror sessions into Zustand for the chat view + future fine-grained
  // subscribers. Uses the same per-event `session-output` IPC stream that the
  // logs pane uses (not the heavier `session-updated` snapshot channel), so
  // chat updates are true push events. Old consumers (Sidebar, AgentPane,
  // Dashboard) keep reading from useSessionsQuery — no behavior change for
  // grid mode.
  useSessionsBridge();

  // Chat target lives in useUIStore so the selection persists across reloads.
  // viewMode itself remains HubApp-local for now (avoids a full migration of
  // every other view-mode consumer); we just extend it with 'chat'.
  const chatSessionId = useUIStore((s) => s.chatSessionId);
  const setChatSession = useUIStore((s) => s.setChatSession);

  useEffect(() => {
    console.log('[HubApp] sessions changed', { count: sessions.length, ts: Date.now(), ids: sessions.map((s) => s.id.slice(0, 8)) });
  }, [sessions.length]);

  useEffect(() => {
    console.log('[HubApp] mount -> detaching all browser views to clear stale state');
    window.electronAPI?.sessions.viewsDetachAll?.().catch((err) => {
      console.warn('[HubApp] viewsDetachAll failed', err);
    });
  }, []);

  const [viewMode, setViewModeRaw] = useState<ViewMode>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('hub-view-mode') : null;
    if (saved === 'dashboard' || saved === 'grid') return saved;
    return 'dashboard';
  });
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeRaw(mode);
    // Browser views are only used by AgentPane (grid mode). Hide everywhere else
    // so they don't bleed through the chat/dashboard/settings UI.
    const shouldShowBrowserViews = mode === 'grid';
    window.electronAPI?.sessions?.viewsSetVisible?.(shouldShowBrowserViews)?.catch(() => {});
    if (mode === 'dashboard' || mode === 'grid') {
      try { window.localStorage.setItem('hub-view-mode', mode); } catch { /* ignore */ }
    }
  }, []);
  const enterChat = useCallback((id: string) => {
    console.log('[HubApp] enterChat', { id });
    setChatSession(id);
    setViewMode('chat');
  }, [setChatSession, setViewMode]);
  const openPill = useCallback(() => { window.electronAPI?.pill.toggle(); }, []);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsIntent, setSettingsIntent] = useState<SettingsOpenIntent | null>(null);
  const settingsRequestIdRef = useRef(0);
  const [focusIndex, setFocusIndex] = useState(0);
  const [zoomFactor, setZoomFactor] = useState(1.0);
  // Grid is permanently 1x1 (gridColumns = 1), but gridPage is real state —
  // it's what selects WHICH session is currently rendered. We repurpose it
  // as "which single session to render" and let the existing focusIndex-
  // driven effect keep it in sync with the focused session.
  const gridColumns = 1;
  const [gridPage, setGridPage] = useState(0);
  const [cmdBarVisible, setCmdBarVisible] = useState<boolean>(() => {
    try { return window.localStorage.getItem('hub-cmdbar-visible') !== '0'; } catch { return true; }
  });
  const [tabsPosition, setTabsPositionRaw] = useState<'side' | 'top'>(() => {
    try {
      const saved = window.localStorage.getItem('hub-tabs-position');
      return saved === 'top' ? 'top' : 'side';
    } catch { return 'side'; }
  });
  useEffect(() => {
    const onChange = (e: Event): void => {
      const next = (e as CustomEvent<{ position: 'side' | 'top' }>).detail?.position;
      if (next === 'side' || next === 'top') setTabsPositionRaw(next);
    };
    window.addEventListener('hub:tabs-position-change', onChange as EventListener);
    return () => window.removeEventListener('hub:tabs-position-change', onChange as EventListener);
  }, []);
  // Fire pane:layout-change AFTER React commits the new layout so AgentPane
  // re-measures bounds against the updated DOM (otherwise BrowserView keeps
  // the pre-toggle rect and leaves a gap where the sidebar used to be).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('pane:layout-change'));
      });
    });
    return () => cancelAnimationFrame(id);
  }, [tabsPosition]);
  const hideCmdBar = useCallback(() => {
    setCmdBarVisible(false);
    try { window.localStorage.setItem('hub-cmdbar-visible', '0'); } catch { /* ignore */ }
  }, []);

  const restoreBrowserViewsForCurrentMode = useCallback(() => {
    window.electronAPI?.sessions?.viewsSetVisible?.(viewMode === 'grid')?.catch(() => {});
  }, [viewMode]);

  const openSettingsPage = useCallback((payload?: SettingsOpenPayload) => {
    window.electronAPI?.pill.hide();
    settingsRequestIdRef.current += 1;
    setSettingsIntent({
      requestId: settingsRequestIdRef.current,
      sectionId: payload?.sectionId ?? (payload?.focusBrowserCodeProvider ? 'settings-model-providers' : undefined),
      focusBrowserCodeProvider: payload?.focusBrowserCodeProvider,
    });
    setViewMode('settings');
  }, [setViewMode]);

  const visibleSessionCount = sessions.length;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('pane:layout-change'));
  }, [visibleSessionCount, gridColumns, gridPage, viewMode]);

  const orderedSessions = useMemo(() => orderSessionsForSidebar(sessions), [sessions]);

  const vimHandlers = useMemo<Partial<Record<ActionId, () => void>>>(() => ({
    'nav.down': () => {
      const visible = orderedSessions;
      if (!visible.length) return;
      const currVis = visible.findIndex((v) => v.id === sessions[focusIndex]?.id);
      const nextVis = Math.min((currVis < 0 ? 0 : currVis + 1), visible.length - 1);
      const nextGlobal = sessions.findIndex((s) => s.id === visible[nextVis].id);
      console.log('[VimKeys] nav.down', { from: focusIndex, to: nextGlobal, visIdx: nextVis });
      setFocusIndex(nextGlobal);
    },
    'nav.up': () => {
      const visible = orderedSessions;
      if (!visible.length) return;
      const currVis = visible.findIndex((v) => v.id === sessions[focusIndex]?.id);
      const nextVis = Math.max((currVis < 0 ? 0 : currVis - 1), 0);
      const nextGlobal = sessions.findIndex((s) => s.id === visible[nextVis].id);
      console.log('[VimKeys] nav.up', { from: focusIndex, to: nextGlobal, visIdx: nextVis });
      setFocusIndex(nextGlobal);
    },
    'nav.top': () => {
      const visible = orderedSessions;
      if (!visible.length) return;
      const nextGlobal = sessions.findIndex((s) => s.id === visible[0].id);
      setFocusIndex(nextGlobal);
    },
    'nav.bottom': () => {
      const visible = orderedSessions;
      if (!visible.length) return;
      const lastVis = visible.length - 1;
      const nextGlobal = sessions.findIndex((s) => s.id === visible[lastVis].id);
      setFocusIndex(nextGlobal);
    },
    'nav.open': () => {
      console.log('[VimKeys] open session', sessions[focusIndex]?.id);
    },
    'goto.dashboard': () => setViewMode('dashboard'),
    'goto.agents': () => setViewMode('grid'),
    'goto.settings': () => { openSettingsPage(); },
    'search.open': () => { window.electronAPI?.pill.toggle(); },
    'action.create': () => { window.electronAPI?.pill.toggle(); },
    'action.createPane': () => { window.electronAPI?.pill.toggle(); },
    'action.dismiss': () => {
      const s = sessions[focusIndex];
      if (!s) return;
      console.log('[VimKeys] dismiss session', s.id);
      window.electronAPI?.sessions.dismiss(s.id).catch((err) => console.error('[VimKeys] dismiss failed', err));
      setFocusIndex((i) => Math.min(i, sessions.length - 2));
    },
    // grid.nextPage / grid.prevPage removed — single-pane layout, no paging.
    'action.cancel': () => {
      const s = sessions[focusIndex];
      if (!s || (s.status !== 'running' && s.status !== 'stuck')) return;
      const api = window.electronAPI;
      if (!api) return;
      console.log('[VimKeys] cancel session', s.id);
      api.sessions.cancel(s.id).catch((err) => console.error('[VimKeys] cancel failed', err));
    },
    'action.followUp': () => {
      const s = sessions[focusIndex];
      if (!s || s.status !== 'idle') return;
      console.log('[VimKeys] follow up → logs focus', s.id);
      window.electronAPI?.logs.focusFollowUp(s.id);
    },
    'scroll.halfDown': () => {
      const el = document.querySelector('.hub-grid, .dashboard');
      if (el) el.scrollBy({ top: el.clientHeight / 2, behavior: 'smooth' });
    },
    'scroll.halfUp': () => {
      const el = document.querySelector('.hub-grid, .dashboard');
      if (el) el.scrollBy({ top: -(el.clientHeight / 2), behavior: 'smooth' });
    },
    'meta.help': () => { openSettingsPage({ sectionId: 'settings-shortcuts' }); },
    'meta.commandPalette': () => { window.electronAPI?.pill.toggle(); },
    'meta.escape': () => {
      if (helpOpen) {
        setHelpOpen(false);
        restoreBrowserViewsForCurrentMode();
        return;
      }
      setFocusIndex(-1);
    },
  }), [sessions, orderedSessions, focusIndex, helpOpen, setViewMode, openSettingsPage, restoreBrowserViewsForCurrentMode]);

  const vim = useVimKeys(vimHandlers);

  const shortcutFor = (actionId: ActionId): string => {
    const kb = vim.keybindings.find((b) => b.id === actionId);
    return kb?.keys[0] ? vim.formatShortcut(kb.keys[0]) : '';
  };

  const tip = (label: string, actionId: ActionId): string => {
    const key = shortcutFor(actionId);
    return key ? `${label}  (${key})` : label;
  };


  useEffect(() => {
    const unsub = window.electronAPI?.on?.openSettings?.((payload) => {
      openSettingsPage(payload);
    });
    return unsub;
  }, [openSettingsPage]);

  useEffect(() => {
    const unsub = window.electronAPI?.on?.pillToggled?.(() => {
      setHelpOpen(false);
      restoreBrowserViewsForCurrentMode();
    });
    return unsub;
  }, [restoreBrowserViewsForCurrentMode]);

  // Main-process signal (e.g. fired by onboarding:complete after Skip) telling
  // the hub to switch to a specific view regardless of the saved preference.
  useEffect(() => {
    const unsub = window.electronAPI?.on?.forceViewMode?.((mode) => {
      if (mode === 'dashboard' || mode === 'grid') setViewMode(mode);
    });
    return unsub;
  }, [setViewMode]);

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { on?: { zoomChanged?: (cb: (f: number) => void) => () => void } } }).electronAPI;
    const saved = localStorage.getItem('hub-zoom-factor');
    if (saved) {
      const f = parseFloat(saved);
      if (f >= 0.5 && f <= 2.0) setZoomFactor(f);
    }
    if (api?.on?.zoomChanged) {
      return api.on.zoomChanged((f: number) => {
        setZoomFactor(f);
        localStorage.setItem('hub-zoom-factor', String(f));
      });
    }
  }, []);

  // Grid density auto-clamp removed — grid is always 1x1.

  useEffect(() => {
    const api = window.electronAPI;
    if (!api || isMock) return;
    sessions.forEach((s) => {
      api.sessions.viewDetach(s.id).catch(() => {});
    });
  }, [viewMode, gridColumns, gridPage]);

  // Logs overlay is anchored to the AgentPane, which only renders in 'grid'
  // view. Hide it whenever the user switches away so it doesn't float over
  // the dashboard / list UI.
  useEffect(() => {
    if (viewMode === 'grid') return;
    window.electronAPI?.logs?.close?.().catch(() => {});
  }, [viewMode]);

  const pendingFocusIdRef = useRef<string | null>(null);

  useEffect(() => {
    const pendingId = pendingFocusIdRef.current;
    if (!pendingId) return;
    const globalIdx = sessions.findIndex((s) => s.id === pendingId);
    if (globalIdx < 0) return;
    console.log('[HubApp] focusing pending new session', { pendingId, globalIdx });
    setFocusIndex(globalIdx);
    pendingFocusIdRef.current = null;
  }, [sessions]);

  const knownIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (knownIdsRef.current === null) {
      knownIdsRef.current = new Set(sessions.map((s) => s.id));
      console.log('[HubApp] initialize knownIds', { count: knownIdsRef.current.size });
      return;
    }
    const known = knownIdsRef.current;
    const newSession = sessions.find((s) => !known.has(s.id));
    knownIdsRef.current = new Set(sessions.map((s) => s.id));
    if (!newSession) return;
    const globalIdx = sessions.findIndex((s) => s.id === newSession.id);
    console.log('[HubApp] new session detected -> chat', { id: newSession.id, globalIdx });
    enterChat(newSession.id);
    setFocusIndex(globalIdx);
  }, [sessions, enterChat]);

  useEffect(() => {
    const visible = sessions;
    if (!visible.length) return;
    const focused = sessions[focusIndex];
    if (!focused) return;
    const visIdx = visible.findIndex((v) => v.id === focused.id);
    if (visIdx < 0) return;
    const pageSize = Math.max(1, gridColumns);
    const correctPage = Math.floor(visIdx / pageSize);
    if (correctPage !== gridPage) {
      console.log('[HubApp] auto-correct gridPage', { from: gridPage, to: correctPage, focusIndex, visIdx, gridColumns });
      setGridPage(correctPage);
    }
  }, [focusIndex, sessions, gridColumns, gridPage]);

  const handleCreateSession = useCallback(async (input: string | { prompt: string; attachments?: Array<{ name: string; mime: string; bytes: Uint8Array }>; engine?: string }) => {
    const prompt = typeof input === 'string' ? input : input.prompt;
    const attachments = typeof input === 'string' ? [] : (input.attachments ?? []);
    const engine = typeof input === 'string' ? undefined : input.engine;
    if (isMock) {
      const id = `session-${++sessionCounter}`;
      const now = Date.now();
      const newSession: AgentSession = {
        id, prompt, status: 'running', createdAt: now,
        output: [{ type: 'thinking', text: `Analyzing the task: "${prompt}". Let me break this down and determine the best approach.` }],
      };
      console.log('[HubApp] createSession (mock)', { id, prompt });
      pendingFocusIdRef.current = id;
      enterChat(id);
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
      setTimeout(() => pushEvent({ type: 'thinking', text: 'I\'ve found the relevant files. Now analyzing the code structure.' }), 5000);
      setTimeout(() => pushEvent({ type: 'tool_call', name: 'file.read', args: { path: 'src/main/index.ts', lines: '1-50' }, iteration: 2 }), 7000);
      setTimeout(() => pushEvent({ type: 'tool_result', name: 'file.read', ok: true, preview: 'Read 50 lines. Found entry point configuration.', ms: 800 }), 8000);
      setTimeout(() => pushEvent({ type: 'done', summary: 'Implementation complete.', iterations: 2 }, 'stopped'), 10000);
      return;
    }

    const api = window.electronAPI;
    if (!api) { console.error('[HubApp] electronAPI not available'); return; }

    try {
      console.log('[HubApp] createSession (live)', { prompt, attachmentCount: attachments.length });
      const id = await api.sessions.create(
        attachments.length > 0 || engine
          ? { prompt, attachments, engine }
          : prompt,
      );
      console.log('[HubApp] session created', { id });
      pendingFocusIdRef.current = id;
      enterChat(id);
      await api.sessions.start(id);
      console.log('[HubApp] session started', { id });
    } catch (err) {
      console.error('[HubApp] createSession failed', err);
    }
  }, [isMock, setViewMode, enterChat]);


  const handleFollowUp = useCallback(async (
    sessionId: string,
    prompt: string,
    attachments?: Array<{ name: string; mime: string; bytes: Uint8Array }>,
  ) => {
    if (!isMock) {
      const api = window.electronAPI;
      if (!api) return;
      try {
        console.log('[HubApp] followUp', { sessionId, prompt, attachmentCount: attachments?.length ?? 0 });
        const result = await api.sessions.resume(sessionId, prompt, attachments);
        if (result?.error) {
          console.warn('[HubApp] followUp error', { sessionId, error: result.error });
          updateSession(sessionId, { status: 'stopped' as const, error: result.error });
        }
      } catch (err) {
        console.error('[HubApp] followUp failed', err);
      }
    }
  }, [isMock, updateSession]);

  const handleResume = useCallback(async (sessionId: string) => {
    if (isMock) return;
    const api = window.electronAPI;
    if (!api) return;
    try {
      console.log('[HubApp] resume', { sessionId });
      const result = await api.sessions.resume(sessionId, 'Continue from where you left off.');
      if (result?.error) {
        console.warn('[HubApp] resume error', { sessionId, error: result.error });
        updateSession(sessionId, { status: 'stopped' as const, error: result.error });
      }
    } catch (err) {
      console.error('[HubApp] resume failed', err);
    }
  }, [isMock, updateSession]);

  const handlePause = useCallback(async (sessionId: string) => {
    if (isMock) return;
    const api = window.electronAPI;
    if (!api) return;
    try {
      console.log('[HubApp] pause', { sessionId });
      const result = await api.sessions.pause(sessionId);
      if (result?.error) {
        console.warn('[HubApp] pause error', { sessionId, error: result.error });
      }
    } catch (err) {
      console.error('[HubApp] pause failed', err);
    }
  }, [isMock]);

  const handleSelectSession = useCallback((id: string) => {
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx >= 0) setFocusIndex(idx);
    console.log('[HubApp] selectSession', { id });
  }, [sessions]);

  const selectedSessionId = sessions[focusIndex]?.id ?? null;

  return (
    <div className="hub-root">
      <header className="hub-toolbar">
        <div className="hub-toolbar__left">
          <span className="hub-toolbar__title">Browser Use</span>
          <MemoryIndicator
            onOpenSettings={() => openSettingsPage()}
            settingsShortcut={shortcutFor('goto.settings')}
          />
        </div>
        <div className="hub-toolbar__center" />
        <div className="hub-toolbar__right">
          {/* Grid density + pager removed — single-pane (1x1) layout. */}
          {viewMode !== 'dashboard' && (
            <button
              className="hub-toolbar__new-btn"
              onClick={() => openPill()}
              aria-label="New agent"
              data-tip={tip('New agent', 'action.createPane')}
            >
              <PlusIcon />
              <span className="hub-toolbar__new-label">New agent</span>
            </button>
          )}
          {zoomFactor !== 1.0 && (
            <button
              className="hub-toolbar__zoom"
              onClick={() => {
                setZoomFactor(1.0);
                localStorage.setItem('hub-zoom-factor', '1');
              }}
              title={`Reset zoom (${vim.formatShortcut('CommandOrControl+0')})`}
            >
              {Math.round(zoomFactor * 100)}%
            </button>
          )}
        </div>
      </header>

      <div className="hub-body" data-tabs-position={tabsPosition}>
      <Sidebar
        mode={tabsPosition}
        sessions={sessions}
        selectedId={viewMode === 'grid' ? selectedSessionId : viewMode === 'chat' ? chatSessionId : null}
        onSelect={(id) => {
          handleSelectSession(id);
          enterChat(id);
        }}
        onNewAgent={() => openPill()}
        onRowAction={(id, action) => {
          console.log('[HubApp] sidebar row action', { id, action });
          switch (action) {
            case 'rerun':
              window.electronAPI?.sessions.rerun(id).catch((err) => console.error('[HubApp] rerun failed', err));
              break;
            case 'stop':
              window.electronAPI?.sessions.cancel(id).catch(() => {});
              break;
            case 'pause':
              handlePause(id);
              break;
            case 'resume':
              handleResume(id);
              break;
          }
        }}
      />
      <div className="hub-main">
      {viewMode === 'settings' ? (
        <SettingsPane
          intent={settingsIntent}
          keybindings={vim.keybindings}
          overrides={vim.overrides}
          onUpdateBinding={vim.updateBinding}
          onResetBinding={vim.resetBinding}
          onResetAll={vim.resetAll}
          formatShortcut={vim.formatShortcut}
        />
      ) : viewMode === 'chat' ? (
        chatSessionId
          ? <ChatPane
              sessionId={chatSessionId}
              onExit={() => setViewMode('dashboard')}
              onSwitchToBrowser={() => {
                handleSelectSession(chatSessionId);
                setViewMode('grid');
              }}
            />
          : <div className="chat-empty">No session selected. <button className="chat-pane__back" onClick={() => setViewMode('dashboard')}>Back to dashboard</button></div>
      ) : viewMode === 'dashboard' ? (
        <Dashboard
          sessions={sessions}
          onSubmitTask={(submission) => { handleCreateSession(submission); }}
        />
      ) : (
        (() => {
          const visibleSessions = sessions;
          const pageSize = gridColumns;
          const totalPages = Math.max(1, Math.ceil(visibleSessions.length / pageSize));
          const safePage = Math.min(gridPage, totalPages - 1);
          const pageStart = safePage * pageSize;
          const pageSessions = visibleSessions.slice(pageStart, pageStart + pageSize);
          if (visibleSessions.length === 0) {
            const shortcut = shortcutFor('action.createPane');
            return (
              <div className="hub-grid-container">
                <button
                  type="button"
                  className="hub-grid__empty"
                  onClick={() => window.electronAPI?.pill.toggle()}
                >
                  press {shortcut ? <kbd className="hub-grid__empty-kbd">{shortcut}</kbd> : 'the global command'} to start a new task
                </button>
              </div>
            );
          }
          return (
            <div className="hub-grid-container">
              <div className="hub-grid" data-count={String(gridColumns)}>
                {pageSessions.map((session) => {
                  const globalIdx = sessions.findIndex((s) => s.id === session.id);
                  return (
                    <AgentPane
                      key={session.id}
                      session={session}
                      focused={globalIdx === focusIndex}
                      onRerun={(id) => {
                        window.electronAPI?.sessions.rerun(id).catch((err) => console.error('[HubApp] rerun failed', err));
                      }}
                      onResume={handleResume}
                      onPause={handlePause}
                      onFollowUp={handleFollowUp}
                      onDismiss={(id) => {
                        // Real dismiss: flips session status to 'stopped' AND tears down the
                        // pool entry. The previous viewDetach-only path left the WebContents
                        // alive (so rerun talked to a stale browser) and only hid the card
                        // locally — status stayed 'idle'.
                        window.electronAPI?.sessions.dismiss(id).catch((err) =>
                          console.error('[HubApp] dismiss failed', err),
                        );
                      }}
                      onCancel={(id) => {
                        window.electronAPI?.sessions.cancel(id).catch(() => {});
                      }}
                      onSelect={handleSelectSession}
                      onOpenFollowUp={() => {
                        window.electronAPI?.logs.focusFollowUp(session.id);
                      }}
                      onOpenSettings={() => {
                        openSettingsPage();
                      }}
                      onOpenChat={enterChat}
                      followUpShortcut={shortcutFor('action.followUp')}
                    />
                  );
                })}
              </div>
            </div>
          );
        })()
      )}

      </div>
      </div>

      {vim.chordPrefix && (
        <div className="chord-indicator">
          <kbd className="chord-indicator__key">{vim.formatShortcut(vim.chordPrefix)}</kbd>
          <span className="chord-indicator__hint">...</span>
        </div>
      )}

      {cmdBarVisible && (
        <CommandBar
          screen={viewMode}
          keybindings={vim.keybindings}
          onClose={hideCmdBar}
          onInvoke={(id) => vimHandlers[id]?.()}
          formatShortcut={vim.formatShortcut}
        />
      )}

      <KeybindingsOverlay
        open={helpOpen}
        onClose={() => {
          setHelpOpen(false);
          restoreBrowserViewsForCurrentMode();
        }}
        keybindings={vim.keybindings}
        onOpenSettings={() => {
          setHelpOpen(false);
          openSettingsPage({ sectionId: 'settings-shortcuts' });
        }}
        formatShortcut={vim.formatShortcut}
      />
    </div>
  );
}

export default HubApp;
