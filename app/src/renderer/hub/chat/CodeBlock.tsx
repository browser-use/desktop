import React, { useState } from 'react';
import { Highlight, themes, type Language } from 'prism-react-renderer';
import { Markdown } from '../Markdown';

interface CodeBlockProps {
  label: string;
  code: string;
  language?: Language;
  /** When true, render body via the Markdown renderer instead of mono pre. */
  asMarkdown?: boolean;
  /** When true, render in destructive color regardless of theme. */
  isError?: boolean;
}

function CopyIcon(): React.ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
      <rect x="3.5" y="3.5" width="6" height="6" rx="1" stroke="currentColor" />
      <path d="M2 7.5V2.5a1 1 0 0 1 1-1h5" stroke="currentColor" />
    </svg>
  );
}

function CheckIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2.5 6.5l2.5 2.5L9.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Bordered, syntax-highlighted code block with a header bar (label + copy).
 * The header is sticky-feeling: matches the cloud's bash-code-block pattern.
 * Theme is dark-on-light by default and re-tints automatically via
 * prefers-color-scheme through the parent .chat-pane theme variables.
 */
export function CodeBlock({ label, code, language, asMarkdown, isError }: CodeBlockProps): React.ReactElement {
  const [copied, setCopied] = useState(false);
  // Detect dark mode via the parent's resolved color. We can't easily get the
  // theme name here so we sniff the bg color brightness on mount; not perfect
  // but cheap. The hub themes set --color-bg-base which we read.
  const isDark = (() => {
    if (typeof window === 'undefined') return false;
    const v = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-base').trim();
    if (!v) return false;
    // Parse hex / rgb to brightness < 128 → dark
    const m = v.match(/#?([0-9a-f]{6}|[0-9a-f]{3})/i);
    if (m) {
      const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return (r * 299 + g * 587 + b * 114) / 1000 < 128;
    }
    return false;
  })();

  const onCopy = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('[CodeBlock] copy failed', err);
    }
  };

  return (
    <div className="chat-code">
      <div className="chat-code__head">
        <span className="chat-code__label">{label}</span>
        <button type="button" className="chat-code__copy" onClick={onCopy} aria-label={`Copy ${label.toLowerCase()}`}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <div className={`chat-code__body${isError ? ' chat-code__body--error' : ''}`}>
        {asMarkdown ? (
          <div className="chat-code__md">
            <Markdown source={code} />
          </div>
        ) : language ? (
          <Highlight theme={isDark ? themes.oneDark : themes.github} code={code} language={language}>
            {({ tokens, getLineProps, getTokenProps }) => (
              <pre className="chat-code__pre">
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line })}>
                    {line.map((token, key) => (
                      <span key={key} {...getTokenProps({ token })} />
                    ))}
                  </div>
                ))}
              </pre>
            )}
          </Highlight>
        ) : (
          <pre className="chat-code__pre">{code}</pre>
        )}
      </div>
    </div>
  );
}
