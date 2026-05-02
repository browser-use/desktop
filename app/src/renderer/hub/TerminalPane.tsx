/**
 * TerminalPane — an xterm.js instance scoped to a single session.
 *
 * - Mounts imperatively on a ref (no React wrapper — same as VS Code).
 * - On mount, pulls the full translated event history from main for replay,
 *   then subscribes to the live `session-output-term` stream.
 * - Infinite-ish scrollback (100k lines). xterm virtualizes DOM rows
 *   internally so only visible rows live in the DOM.
 * - Read-only for v1: stdin is disabled. Follow-up still goes through the
 *   existing `FollowUpInput` → IPC path.
 * - Clickable link provider routes `outputs/<sessionId>/…` paths through the
 *   existing IDE/Finder IPC so parity with `FileOutputRow` is preserved.
 */
import React, { useEffect, useRef } from 'react';
import { Terminal, type ITerminalOptions, type IDisposable } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

const SCROLLBACK_LINES = 100_000;
const OUTPUT_PATH_RE = /(?:^|\s)(outputs\/[a-zA-Z0-9_-]{6,}\/[^\s]+)/g;

function readCssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}

function buildTheme(): NonNullable<ITerminalOptions['theme']> {
  return {
    background: readCssVar('--color-bg', '#0b0d10'),
    foreground: readCssVar('--color-fg', '#d6d8dc'),
    // Terminal is read-only — paint the cursor in the background color so
    // it disappears visually (WebGL renderer ignores `display:none` CSS).
    cursor: readCssVar('--color-bg', '#0b0d10'),
    cursorAccent: readCssVar('--color-bg', '#0b0d10'),
    selectionBackground: readCssVar('--color-selection', '#2a3340'),
    black: '#1a1d22',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#abb2bf',
    brightBlack: '#5c6370',
    brightRed: '#ff7b86',
    brightGreen: '#b0e08c',
    brightYellow: '#f2d08a',
    brightBlue: '#79c0ff',
    brightMagenta: '#d48cee',
    brightCyan: '#7dd3fc',
    brightWhite: '#e6eaee',
  };
}

interface TerminalPaneProps {
  sessionId: string;
}

export function TerminalPane({ sessionId }: TerminalPaneProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log('[TerminalPane] mount', { sessionId, hasHost: !!hostRef.current });
    const host = hostRef.current;
    if (!host) {
      console.warn('[TerminalPane] no host element, aborting mount', { sessionId });
      return;
    }

    const term = new Terminal({
      fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      theme: buildTheme(),
      cursorBlink: false,
      cursorStyle: 'bar',
      disableStdin: true,
      convertEol: true,
      scrollback: SCROLLBACK_LINES,
      allowTransparency: true,
      fontWeight: '400',
      fontWeightBold: '600',
      smoothScrollDuration: 0,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);

    const webLinks = new WebLinksAddon((_evt, uri) => {
      window.open(uri, '_blank', 'noopener,noreferrer');
    });
    term.loadAddon(webLinks);

    term.open(host);

    // WebGL renderer is best-effort — some GPUs / virtual displays reject it.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => { try { webgl.dispose(); } catch { /* already disposed */ } });
      term.loadAddon(webgl);
    } catch (err) {
      console.warn('[TerminalPane] webgl addon unavailable, falling back to DOM', err);
    }

    // Custom link provider for agent-produced files. Matches paths like
    // `outputs/<sessionId>/report.pdf` anywhere in the buffer and routes
    // clicks to the same IPC the FileOutputRow menu uses.
    const linkDisposable: IDisposable = term.registerLinkProvider({
      provideLinks: (y, callback) => {
        const line = term.buffer.active.getLine(y - 1);
        const text = line?.translateToString(true) ?? '';
        if (!text) return callback(undefined);
        const links: Array<{ range: { start: { x: number; y: number }; end: { x: number; y: number } }; text: string; activate: () => void }> = [];
        let m: RegExpExecArray | null;
        OUTPUT_PATH_RE.lastIndex = 0;
        while ((m = OUTPUT_PATH_RE.exec(text)) !== null) {
          const rel = m[1];
          const start = m.index + (m[0].length - rel.length) + 1; // 1-based column
          links.push({
            range: { start: { x: start, y }, end: { x: start + rel.length - 1, y } },
            text: rel,
            activate: () => {
              const api = window.electronAPI?.sessions;
              if (!api) return;
              api.revealOutput(rel).catch((e: unknown) => console.error('[TerminalPane] revealOutput', e));
            },
          });
        }
        callback(links.length ? links : undefined);
      },
    });

    // Order matters: the renderer needs the replay (which includes the user's
    // prompt synthesized from session.prompt) to be written BEFORE any live
    // bytes that start streaming as soon as the agent begins thinking.
    // We subscribe immediately so nothing is lost, but we buffer live bytes
    // until the replay resolves, then flush.
    let disposed = false;
    let replayApplied = false;
    const pending: string[] = [];
    const api = window.electronAPI;

    const offTerm = api?.on?.sessionOutputTerm?.((id, bytes) => {
      if (id !== sessionId) return;
      if (!replayApplied) {
        pending.push(bytes);
        return;
      }
      term.write(bytes);
    });

    (async () => {
      try {
        console.log('[TerminalPane] getTermReplay start', { sessionId, hasApi: !!api, hasSessions: !!api?.sessions });
        const replay = await api?.sessions?.getTermReplay?.(sessionId);
        console.log('[TerminalPane] getTermReplay result', { sessionId, length: typeof replay === 'string' ? replay.length : 'non-string' });
        if (disposed) return;
        if (replay) term.write(replay);
      } catch (err) {
        console.error('[TerminalPane] getTermReplay failed', err);
      }
      replayApplied = true;
      console.log('[TerminalPane] replay applied', { sessionId, pendingChunks: pending.length });
      if (pending.length > 0) {
        for (const chunk of pending) term.write(chunk);
        pending.length = 0;
      }
      try { fit.fit(); } catch { /* container not ready */ }
    })();

    // Coalesce resizes into a single rAF.
    let raf = 0;
    const onResize = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        try { fit.fit(); } catch { /* noop */ }
      });
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);
    const onLayoutChange = () => onResize();
    window.addEventListener('pane:layout-change', onLayoutChange);

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pane:layout-change', onLayoutChange);
      try { offTerm?.(); } catch { /* noop */ }
      try { linkDisposable.dispose(); } catch { /* noop */ }
      try { term.dispose(); } catch { /* noop */ }
    };
  }, [sessionId]);

  return <div className="pane__terminal" ref={hostRef} />;
}

export default TerminalPane;
