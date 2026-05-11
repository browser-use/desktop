import React, { useState } from 'react';
import { Markdown } from '../Markdown';
import type { OutputEntry } from '../types';
import type { Turn } from './groupIntoTurns';
import { ToolBlock } from './ToolBlock';
import { ToolGroup } from './ToolGroup';
import { useToast } from '@/renderer/components/base/Toast';

const USER_BUBBLE_CLAMP_LINES = 10;
const USER_BUBBLE_CLAMP_CHARS = 600;

function CopyIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4" y="2" width="9" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 5v8a1.5 1.5 0 0 0 1.5 1.5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function UserBubble({ content }: { content: string }): React.ReactElement {
  const lines = content.split('\n').length;
  const isLong = lines > USER_BUBBLE_CLAMP_LINES || content.length > USER_BUBBLE_CLAMP_CHARS;
  const [expanded, setExpanded] = useState(false);
  const clamped = isLong && !expanded;
  const toast = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.show({ variant: 'success', title: 'Copied to clipboard' });
    } catch {
      toast.show({ variant: 'error', title: 'Copy failed' });
    }
  };

  return (
    <div className="chat-bubble__wrap">
      <div className={`chat-bubble${clamped ? ' chat-bubble--clamped' : ''}`}>
        <div className="chat-bubble__text">{content}</div>
        {isLong && (
          <button
            type="button"
            className="chat-bubble__show-more"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Show less' : 'Show more'} <span aria-hidden>▾</span>
          </button>
        )}
      </div>
      <div className="chat-bubble__actions">
        <button
          type="button"
          aria-label="Copy message"
          onClick={() => { void handleCopy(); }}
        >
          <CopyIcon />
        </button>
      </div>
    </div>
  );
}

interface ChatTurnProps {
  turn: Turn;
}

function AgentEntry({ entry }: { entry: OutputEntry }): React.ReactElement | null {
  switch (entry.type) {
    case 'thinking':
      return <div className="chat-step__thinking">{entry.content}</div>;

    case 'tool_call':
      return <ToolBlock entry={entry} />;

    case 'tool_result': {
      // Orphaned tool_result (no preceding tool_call paired by adaptSession).
      // Codex emits these for top-level error items ({type:"error", message}).
      // Surface those as proper error cards; suppress all other orphans as noise.
      const text = entry.content;
      const errMatch = text.match(/"type"\s*:\s*"error"[\s\S]*?"message"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (errMatch) {
        const msg = errMatch[1]
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
        return <div className="chat-step__error">{msg}</div>;
      }
      return null;
    }

    case 'done':
      return (
        <div className="chat-step__assistant">
          <Markdown source={entry.content || '(done)'} />
        </div>
      );

    case 'error':
      return <div className="chat-step__error">{entry.content}</div>;

    case 'skill_used':
      return <span className="chat-step__chip">skill · {entry.content}</span>;

    case 'skill_written':
      return <span className="chat-step__chip">wrote skill · {entry.content}</span>;

    case 'harness_edited':
      return <span className="chat-step__chip">edited {entry.content}</span>;

    case 'file_output':
      return <span className="chat-step__chip">file · {entry.content}</span>;

    case 'notify':
      if (entry.level === 'blocking') {
        return <div className="chat-step__error">{entry.content}</div>;
      }
      return <span className="chat-step__chip">{entry.content}</span>;

    default:
      return null;
  }
}

/**
 * Walk through agent entries, batching consecutive `tool_call` runs into
 * `ToolGroup` blocks so a long agent turn renders as a few collapsed chips
 * instead of dozens of stacked tool pills. Non-tool entries (thinking, done,
 * skill_used, …) break the run and render in place.
 */
/** Normalize whitespace for comparing thinking/done content. */
function normalizeProse(s: string): string {
  return (s || '').trim().replace(/\s+/g, ' ');
}

function renderAgentEntries(entries: OutputEntry[]): React.ReactElement[] {
  const out: React.ReactElement[] = [];
  let batch: OutputEntry[] = [];
  const flush = () => {
    if (batch.length === 0) return;
    out.push(<ToolGroup key={`group-${batch[0].id}`} entries={batch} />);
    batch = [];
  };
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.type === 'tool_call') {
      batch.push(e);
      continue;
    }
    flush();
    // Agents (Claude Code in particular) often emit the same prose as a final
    // `thinking` event AND a `done.summary` — which renders twice. When the
    // immediately-following entry is `done` with identical content, skip the
    // thinking so the markdown-rendered `done` wins.
    if (e.type === 'thinking') {
      const next = entries[i + 1];
      if (next && next.type === 'done' && normalizeProse(next.content) === normalizeProse(e.content)) {
        continue;
      }
    }
    const rendered = <AgentEntry key={e.id} entry={e} />;
    if (rendered) out.push(rendered);
  }
  flush();
  return out;
}

export function ChatTurn({ turn }: ChatTurnProps): React.ReactElement {
  return (
    <div className="chat-turn">
      {turn.userEntry && <UserBubble content={turn.userEntry.content} />}
      {turn.agentEntries.length > 0 && (
        <div className="chat-agent">
          {renderAgentEntries(turn.agentEntries)}
        </div>
      )}
    </div>
  );
}
