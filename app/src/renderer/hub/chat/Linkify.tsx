import React from 'react';

/**
 * Detects file paths in chat prose and turns them into clickable links that
 * reveal the file in the OS file manager (Finder / Explorer / nautilus etc.).
 *
 * Scope: only `outputs/<id>/<file>.<ext>` paths (with optional path prefix and
 * leading drive/slash) — that matches what the harness writes and what
 * `sessions:reveal-output` is allowed to reveal. Other paths are ignored;
 * showing them as links would set up dead clicks (the backend rejects
 * anything outside the harness outputs root).
 *
 * Cross-platform: the backend uses `shell.showItemInFolder`, which on macOS
 * opens Finder, on Windows opens Explorer, on Linux defers to the desktop
 * environment's file manager. No renderer-side platform branching needed.
 */

// One regex covers:
//   outputs/<uuid>/file.png
//   ./outputs/<uuid>/file.png
//   /Users/.../outputs/<uuid>/file.png
//   C:\…\outputs\<uuid>\file.png
//
// The path body stops at whitespace, common terminators, or a closing quote.
const PATH_RE = /((?:[A-Za-z]:[\\/]|\/|\.{1,2}[\\/])?(?:[\w.~+-]+[\\/])*outputs[\\/][\w-]{4,}[\\/][^\s"'`)\]<>,;]+?\.[A-Za-z0-9]{1,8})/g;

function reveal(rawPath: string): void {
  // Trim a stray trailing punctuation that escaped the regex (rare — the regex
  // tries to avoid trailing dots/commas, but markdown-y prose can still grab
  // a `.` after a filename when the extension is also a sentence end).
  const clean = rawPath.replace(/[.,;:!?)\]]+$/, '');
  console.log('[Linkify] reveal', clean);
  const revealResult = window.electronAPI?.sessions?.revealOutput?.(clean);
  if (revealResult && typeof revealResult.catch === 'function') {
    void revealResult.catch((err) => console.warn('[Linkify] revealOutput failed', err));
  }
}

interface LinkifyProps {
  children: string;
}

// Inline styles keep this self-contained — no chat.css coupling required.
const LINK_STYLE: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  margin: 0,
  font: 'inherit',
  color: 'var(--color-accent-default)',
  cursor: 'pointer',
  textDecoration: 'underline',
  textDecorationStyle: 'dotted',
  textUnderlineOffset: '2px',
  wordBreak: 'break-all',
};

export function Linkify({ children }: LinkifyProps): React.ReactElement {
  const text = children ?? '';
  if (!text) return <></>;

  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_RE.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    const p = m[1];
    parts.push(
      <button
        key={`path-${m.index}`}
        type="button"
        className="chat-path-link"
        style={LINK_STYLE}
        onClick={() => reveal(p)}
        title={`Reveal ${p} in file manager`}
      >
        {p}
      </button>,
    );
    lastIdx = m.index + p.length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return <>{parts}</>;
}
