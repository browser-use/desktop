import React, { useState } from 'react';
import type { OutputEntry } from '../types';
import { ToolBlock } from './ToolBlock';
import { TerminalSpinner } from './TerminalSpinner';
import {
  getToolType,
  getToolLabel,
  getToolDisplayValue,
  getToolBashCommand,
  summarizeBashCommand,
} from './toolLabels';

interface ToolGroupProps {
  entries: OutputEntry[];
}

interface Phrase {
  label: string;
  value: string;
}

function describeEntry(entry: OutputEntry, status: 'running' | 'completed'): Phrase {
  // entry.content for a bash tool_call is JSON.stringify(args) — e.g.
  // `{"preview":"/bin/zsh …","command":"/bin/zsh …"}`. Run it through
  // getToolDisplayValue first so summarizeBashCommand sees the raw shell
  // command, not the JSON wrapper.
  const display = getToolDisplayValue(entry.tool, entry.content || '');
  if (getToolType(entry.tool) === 'bash') {
    const fullCommand = getToolBashCommand(entry.tool, entry.content || '');
    const s = summarizeBashCommand(fullCommand || display || entry.content || '');
    if (s) return { label: status === 'running' ? s.active : s.completed, value: s.value };
  }
  return {
    label: getToolLabel(entry.tool, status),
    value: display,
  };
}

function joinPhrases(phrases: string[]): string {
  if (phrases.length === 0) return '';
  if (phrases.length === 1) return phrases[0];
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(', ')}, and ${phrases[phrases.length - 1]}`;
}

/**
 * Build a slug summary from completed entries:
 *   - One phrase per unique label (specific identifiers are dropped — too long).
 *   - Unrecognized bash commands are pooled into "ran N command(s)".
 *   - First phrase is capitalized; the rest are lowercased to read as prose.
 *
 * Example: [connect, read file, unrecognized bash] → "Connected to browser,
 * read file, and ran 1 command". Click-to-expand reveals the per-tool details.
 */
function summarizeCompleted(entries: OutputEntry[]): string {
  const seen = new Set<string>();
  const phrases: string[] = [];
  let unmappedBash = 0;

  for (const e of entries) {
    const p = describeEntry(e, 'completed');
    // "Ran command" is the generic getToolLabel fallback for bash — the matcher
    // didn't recognize it. Pool these rather than expose raw commands inline.
    if (p.label === 'Ran command') {
      unmappedBash++;
      continue;
    }
    const key = p.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    phrases.push(p.label);
  }

  if (unmappedBash > 0) {
    phrases.push(`ran ${unmappedBash} command${unmappedBash === 1 ? '' : 's'}`);
  }

  const formatted = phrases.map((p, i) => (i === 0 ? p : p.charAt(0).toLowerCase() + p.slice(1)));
  return joinPhrases(formatted);
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

export function ToolGroup({ entries }: ToolGroupProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  // A single tool isn't a group — render it as a standalone ToolBlock so the
  // header doesn't read "Read AGENTS.md" twice (once in the group chip, once
  // inside the expanded body).
  if (entries.length === 1) return <ToolBlock entry={entries[0]} />;

  const runningIdx = entries.findIndex((e) => !e.result);
  const isInFlight = runningIdx !== -1;

  const headerText = (() => {
    if (isInFlight) {
      const running = entries[runningIdx];
      const p = describeEntry(running, 'running');
      return p.value ? `${p.label} ${p.value}…` : `${p.label}…`;
    }
    return summarizeCompleted(entries);
  })();

  return (
    <div className="chat-tool chat-tool--group">
      <button
        type="button"
        className="chat-tool__pill"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {isInFlight && (
          <span className="chat-tool__icon chat-tool__icon--bare">
            <TerminalSpinner size={11} />
          </span>
        )}
        <span className="chat-tool__label">{headerText}</span>
        <ChevronDown rotated={expanded} />
      </button>
      {expanded && (
        <div className="chat-tool__expanded chat-tool__group-list">
          {entries.map((e) => (
            <ToolBlock key={e.id} entry={e} />
          ))}
        </div>
      )}
    </div>
  );
}
