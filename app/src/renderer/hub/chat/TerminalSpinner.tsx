import React, { useEffect, useState } from 'react';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_MS = 80;

interface TerminalSpinnerProps {
  size?: number;
}

export function TerminalSpinner({ size = 13 }: TerminalSpinnerProps): React.ReactElement {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % FRAMES.length), FRAME_MS);
    return () => clearInterval(t);
  }, []);
  return (
    <span
      className="chat-spinner"
      aria-label="working"
      style={{ fontSize: size, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: 1 }}
    >
      {FRAMES[i]}
    </span>
  );
}

interface ElapsedProps {
  since: number; // ms epoch
}

export function Elapsed({ since }: ElapsedProps): React.ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  const label = m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
  return <span className="chat-elapsed">{label}</span>;
}
