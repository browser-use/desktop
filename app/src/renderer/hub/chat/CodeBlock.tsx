import React, { useState } from 'react';
import { Highlight, themes, type Language } from 'prism-react-renderer';
import { Markdown } from '../Markdown';
import { useThemeMode } from '../../design/useThemeMode';

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
 */
export function CodeBlock({ label, code, language, asMarkdown, isError }: CodeBlockProps): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const { resolved } = useThemeMode();
  const isDark = resolved === 'dark';

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
