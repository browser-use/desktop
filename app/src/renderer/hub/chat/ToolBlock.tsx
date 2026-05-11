import React, { useState } from 'react';
import type { OutputEntry } from '../types';
import { CodeBlock } from './CodeBlock';
import { TerminalSpinner } from './TerminalSpinner';
import {
  getToolType,
  getToolLabel,
  getToolDisplayValue,
  parseBashResult,
  summarizeBashCommand,
  stripShellWrapper,
} from './toolLabels';

interface ToolBlockProps {
  entry: OutputEntry;
}

function ChevronDown({ rotated }: { rotated: boolean }): React.ReactElement {
  return (
    <svg
      className="chat-tool__chev"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      style={{ transform: rotated ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 150ms ease' }}
    >
      <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TerminalIcon(): React.ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
      <path d="M2 3l2.5 2L2 7M6.5 8h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Try to pretty-print JSON results. Returns the input unchanged when not JSON.
 */
function formatGenericResult(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch { /* not JSON */ }
  }
  return raw;
}

type OutputRender =
  | { mode: 'markdown'; code: string }
  | { mode: 'json'; code: string }
  | { mode: 'yaml'; code: string }
  | { mode: 'text'; code: string };

/**
 * YAML-ish flattening of a parsed JSON value. Long / multi-line string fields
 * are emitted as `key: |` block scalars so embedded \n actually render as
 * real line breaks — that's the readability problem with browser-harness-js
 * payloads like `{url, title, bodyText}` where bodyText is multi-paragraph.
 */
function toReadableYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);

  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') {
    if (value.includes('\n') || value.length > 80) {
      const inner = value.split('\n').map((l) => `${pad}  ${l}`).join('\n');
      return `|\n${inner}`;
    }
    // Short string — inline quoted for visual distinction from keys
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value.map((v) => `${pad}- ${toReadableYaml(v, indent + 1).replace(/^\n/, '')}`).join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return entries
      .map(([k, v], i) => {
        const child = toReadableYaml(v, indent + 1);
        const prefix = i === 0 && indent === 0 ? '' : pad;
        if (child.startsWith('|\n') || child.includes('\n')) return `${prefix}${k}: ${child}`;
        return `${prefix}${k}: ${child}`;
      })
      .join('\n');
  }
  return String(value);
}

/**
 * Heuristically pick how to render bash/script output.
 * - JSON object with any multi-line string value → YAML render (so \n inside
 *   strings becomes a real newline instead of a literal escape)
 * - Other valid JSON → pretty-print + json highlighting
 * - Starts with a markdown heading or has fenced code blocks → markdown render
 * - Otherwise → plain monospace text
 */
function detectOutputRender(raw: string): OutputRender {
  const trimmed = raw.trim();
  if (!trimmed) return { mode: 'text', code: '' };

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      // Walk shallow values — if any string contains a newline OR is long
      // enough to wrap awkwardly inside JSON, prefer YAML rendering.
      const values = Array.isArray(parsed)
        ? parsed
        : (parsed && typeof parsed === 'object' ? Object.values(parsed) : []);
      const hasMultiline = values.some(
        (v) => typeof v === 'string' && (v.includes('\n') || v.length > 200),
      );
      if (hasMultiline) {
        return { mode: 'yaml', code: toReadableYaml(parsed) };
      }
      return { mode: 'json', code: JSON.stringify(parsed, null, 2) };
    } catch { /* fall through */ }
  }

  const hasHeading = /^#{1,6}\s/m.test(trimmed);
  const hasFence = /```/.test(trimmed);
  const hasListAndProse = /^\s*[-*]\s/m.test(trimmed) && /[.!?]\s/.test(trimmed);
  if (hasHeading || hasFence || hasListAndProse) {
    return { mode: 'markdown', code: trimmed };
  }

  return { mode: 'text', code: raw };
}

export function ToolBlock({ entry }: ToolBlockProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const inFlight = !entry.result;
  const status = inFlight ? 'running' : 'completed';
  const type = getToolType(entry.tool);
  let label = getToolLabel(entry.tool, status);
  let displayValue = getToolDisplayValue(entry.tool, entry.content);

  // For bash, keep the original (unwrapped) command separate from the friendly
  // chip value — the expansion's "Command" block should show what actually ran,
  // not the summary phrase.
  const rawBashCommand = type === 'bash' ? stripShellWrapper(displayValue || entry.content || '') : '';

  if (type === 'bash') {
    const summary = summarizeBashCommand(displayValue || entry.content);
    if (summary) {
      label = inFlight ? summary.active : summary.completed;
      displayValue = summary.value;
    } else {
      // Unrecognized bash — hide the raw command from the pill. The full
      // command is still visible inside the expansion's Command block.
      displayValue = '';
    }
  }

  // For bash, parse the backend wrapper to surface stdout cleanly.
  const bash = type === 'bash' && entry.result ? parseBashResult(entry.result.content) : null;
  const durationMs = bash?.durationMs ?? entry.duration;

  const expandedBody = (() => {
    if (type === 'bash') {
      const command = rawBashCommand;
      const output = bash && bash.output ? detectOutputRender(bash.output) : null;
      return (
        <>
          <CodeBlock label="Command" code={command} language="bash" />
          {output && output.code && (
            output.mode === 'markdown'
              ? <CodeBlock label="Output" code={output.code} asMarkdown isError={bash?.isError} />
              : output.mode === 'json'
                ? <CodeBlock label="Output" code={output.code} language="json" isError={bash?.isError} />
                : output.mode === 'yaml'
                  ? <CodeBlock label="Output" code={output.code} language="yaml" isError={bash?.isError} />
                  : <CodeBlock label="Output" code={output.code} isError={bash?.isError} />
          )}
        </>
      );
    }

    // Generic: pretty-print args + result
    const args = formatGenericResult(entry.content);
    const result = entry.result ? formatGenericResult(entry.result.content) : '';
    return (
      <>
        <CodeBlock label="Parameters" code={args} language="json" />
        {result && <CodeBlock label="Result" code={result} language="json" />}
      </>
    );
  })();

  return (
    <div className="chat-tool">
      <button
        type="button"
        className="chat-tool__pill"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="chat-tool__icon">
          {inFlight ? <TerminalSpinner size={11} /> : <TerminalIcon />}
        </span>
        <span className="chat-tool__label">{label}</span>
        {displayValue && (
          <span className="chat-tool__value">{displayValue}</span>
        )}
        {durationMs !== undefined && (
          <span className="chat-tool__duration">{formatDuration(durationMs)}</span>
        )}
        <ChevronDown rotated={expanded} />
      </button>
      {expanded && (
        <div className="chat-tool__expanded">
          {expandedBody}
        </div>
      )}
    </div>
  );
}
