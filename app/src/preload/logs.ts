/**
 * Preload for the logs window. Exposes what TerminalPane needs plus a tiny
 * `logsAPI` for close/active-session signalling.
 */

import { contextBridge, ipcRenderer } from 'electron';

const DEBUG_LOGS_PRELOAD = process.env.BU_DEBUG_LOGS_PRELOAD === '1';
function debugLog(message: string, data?: Record<string, unknown>): void {
  if (!DEBUG_LOGS_PRELOAD) return;
  if (data) console.log(message, data);
  else console.log(message);
}

debugLog('[logs-preload] init');

contextBridge.exposeInMainWorld('electronAPI', {
  sessions: {
    getTermReplay: async (id: string): Promise<string> => {
      debugLog('[logs-preload] getTermReplay', { id });
      const replay = await ipcRenderer.invoke('sessions:get-term-replay', id);
      debugLog('[logs-preload] getTermReplay result', {
        id,
        length: typeof replay === 'string' ? replay.length : 'non-string',
      });
      return replay;
    },
    revealOutput: (filePath: string): Promise<{ revealed: boolean }> =>
      ipcRenderer.invoke('sessions:reveal-output', filePath),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('sessions:get', id),
    cancel: (id: string): Promise<void> =>
      ipcRenderer.invoke('sessions:cancel', { id, source: 'logs-ctrl-c' }),
    pause: (id: string): Promise<{ paused?: boolean; error?: string }> =>
      ipcRenderer.invoke('sessions:pause', { id, source: 'logs-ctrl-c' }),
    listEditors: (): Promise<Array<{ id: string; name: string }>> =>
      ipcRenderer.invoke('sessions:list-editors'),
    openInEditor: (editorId: string, filePath: string): Promise<{ opened: boolean }> =>
      ipcRenderer.invoke('sessions:open-in-editor', { editorId, filePath }),
    downloadOutput: (filePath: string): Promise<{ opened: boolean }> =>
      ipcRenderer.invoke('sessions:download-output', filePath),
  },
  on: {
    sessionOutputTerm: (cb: (id: string, bytes: string) => void): (() => void) => {
      debugLog('[logs-preload] subscribe sessionOutputTerm');
      const handler = (_e: unknown, id: string, bytes: string) => {
        debugLog('[logs-preload] session-output-term received', {
          id,
          byteLen: bytes?.length ?? 0,
        });
        if (typeof id === 'string' && typeof bytes === 'string') cb(id, bytes);
      };
      ipcRenderer.on('session-output-term', handler);
      return () => {
        debugLog('[logs-preload] unsubscribe sessionOutputTerm');
        ipcRenderer.removeListener('session-output-term', handler);
      };
    },
    // Session object updates — logs window uses this to render file_output
    // rows under the terminal.
    sessionUpdated: (cb: (session: unknown) => void): (() => void) => {
      const handler = (_e: unknown, session: unknown) => cb(session);
      ipcRenderer.on('session-updated', handler);
      return () => ipcRenderer.removeListener('session-updated', handler);
    },
    // Structured per-event stream (file_output, done, error, etc.). Needed
    // for live file rows — session-updated snapshots lag since appendOutput
    // only emits session-output, not session-updated.
    sessionOutput: (cb: (id: string, event: unknown) => void): (() => void) => {
      const handler = (_e: unknown, id: string, event: unknown) => {
        debugLog('[logs-preload] session-output received', {
          id,
          type: (event as { type?: string })?.type,
        });
        if (typeof id === 'string') cb(id, event);
      };
      ipcRenderer.on('session-output', handler);
      return () => ipcRenderer.removeListener('session-output', handler);
    },
  },
});

contextBridge.exposeInMainWorld('logsAPI', {
  close: (): void => {
    debugLog('[logs-preload] close');
    ipcRenderer.send('logs:close');
  },
  setMode: (mode: 'dot' | 'normal' | 'full'): void => {
    debugLog('[logs-preload] setMode', { mode });
    ipcRenderer.send('logs:set-mode', mode);
  },
  onModeChanged: (cb: (mode: 'dot' | 'normal' | 'full') => void): (() => void) => {
    const handler = (_e: unknown, m: string) => {
      if (m === 'dot' || m === 'normal' || m === 'full') {
        debugLog('[logs-preload] mode-changed', { mode: m });
        cb(m);
      }
    };
    ipcRenderer.on('logs:mode-changed', handler);
    return () => ipcRenderer.removeListener('logs:mode-changed', handler);
  },
  onActiveSessionChanged: (cb: (sessionId: string | null) => void): (() => void) => {
    debugLog('[logs-preload] subscribe onActiveSessionChanged');
    const handler = (_e: unknown, id: string | null) => {
      debugLog('[logs-preload] active-session-changed', { id });
      cb(id);
    };
    ipcRenderer.on('logs:active-session-changed', handler);
    return () => ipcRenderer.removeListener('logs:active-session-changed', handler);
  },
  // Fired when the hub asks us to take focus (user pressed 'f' on a card).
  onFocusFollowUp: (cb: () => void): (() => void) => {
    const handler = () => {
      debugLog('[logs-preload] focus-followup');
      cb();
    };
    ipcRenderer.on('logs:focus-followup', handler);
    return () => ipcRenderer.removeListener('logs:focus-followup', handler);
  },
  // Follow-up input from inside the logs window — routes through the same
  // sessions:resume IPC the pane's FollowUpInput uses so replies land in
  // the same session without the main hub needing focus.
  followUp: (sessionId: string, prompt: string): Promise<{ resumed?: boolean; queued?: boolean; error?: string }> =>
    ipcRenderer.invoke('sessions:resume', { id: sessionId, prompt }),
});

debugLog('[logs-preload] ready');
