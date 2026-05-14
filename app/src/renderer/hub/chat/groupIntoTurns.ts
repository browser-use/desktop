import type { OutputEntry } from '../types';

export type Turn = {
  id: string;
  userEntry: OutputEntry | null;
  agentEntries: OutputEntry[];
};

/**
 * Group a flat OutputEntry[] into conversational turns.
 *
 * A turn starts at a `user_input` entry and continues until the next
 * `user_input` (or end). Entries before the first user_input go into a
 * leading "system" turn with userEntry = null (legacy sessions can be missing
 * their kickoff event; new sessions persist it as user_input).
 */
export function groupIntoTurns(entries: readonly OutputEntry[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;

  for (const entry of entries) {
    if (entry.type === 'user_input') {
      if (current) turns.push(current);
      current = { id: entry.id, userEntry: entry, agentEntries: [] };
      continue;
    }
    if (!current) {
      current = { id: `pre-${entry.id}`, userEntry: null, agentEntries: [entry] };
      continue;
    }
    current.agentEntries.push(entry);
  }

  if (current) turns.push(current);
  return turns;
}
