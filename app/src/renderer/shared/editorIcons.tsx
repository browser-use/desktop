import React from 'react';
import cursorLogoSrc from '../hub/cursor-logo.svg?raw';
import vscodeLogo from '../hub/vscode-logo.svg';

export function EditorIcon({ id }: { id: string }): React.ReactElement {
  if (id === 'cursor') {
    return (
      <span
        className="editor-logo editor-logo--cursor"
        dangerouslySetInnerHTML={{ __html: cursorLogoSrc as string }}
      />
    );
  }
  if (id === 'vscode' || id === 'vscode-insiders') {
    return <img src={vscodeLogo} alt="" width={14} height={14} />;
  }
  if (id === 'zed' || id === 'zed-preview') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="#9a62ff" />
        <path d="M8 8h8L8 16h8" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }
  if (id === 'windsurf') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 16c4-3 6-3 8 0s6 3 8 0" stroke="#39c4b5" strokeWidth="2" strokeLinecap="round" fill="none" />
        <path d="M4 10c4-3 6-3 8 0s6 3 8 0" stroke="#39c4b5" strokeWidth="2" strokeLinecap="round" fill="none" />
      </svg>
    );
  }
  if (id === 'sublime') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 5v14l14-4V1L5 5Z" fill="#FF9800" />
      </svg>
    );
  }
  if (['webstorm', 'intellij', 'intellij-ce', 'pycharm', 'pycharm-ce', 'rider', 'goland'].includes(id)) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="3" fill="#000" />
        <path d="M7 17h6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="11" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 11.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function FinderIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 4.5v6A1.5 1.5 0 003.5 12h7A1.5 1.5 0 0012 10.5V5.5A1.5 1.5 0 0010.5 4H7L5.5 2.5h-2A1.5 1.5 0 002 4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
