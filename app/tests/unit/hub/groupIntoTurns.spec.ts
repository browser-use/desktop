import { describe, expect, it } from 'vitest';
import { groupIntoTurns } from '../../../src/renderer/hub/chat/groupIntoTurns';
import type { OutputEntry } from '../../../src/renderer/hub/types';

function entry(id: string, type: OutputEntry['type'], content = ''): OutputEntry {
  return { id, type, timestamp: 0, content };
}

describe('groupIntoTurns', () => {
  it('returns empty array for empty input', () => {
    expect(groupIntoTurns([])).toEqual([]);
  });

  it('groups entries into a single turn when there is one user_input', () => {
    const entries = [
      entry('1', 'user_input', 'hello'),
      entry('2', 'thinking', 'pondering'),
      entry('3', 'done', 'all set'),
    ];
    const turns = groupIntoTurns(entries);
    expect(turns).toHaveLength(1);
    expect(turns[0].userEntry?.id).toBe('1');
    expect(turns[0].agentEntries.map((e) => e.id)).toEqual(['2', '3']);
  });

  it('starts a new turn at each user_input', () => {
    const entries = [
      entry('u1', 'user_input', 'first'),
      entry('t1', 'thinking'),
      entry('d1', 'done'),
      entry('u2', 'user_input', 'second'),
      entry('t2', 'thinking'),
    ];
    const turns = groupIntoTurns(entries);
    expect(turns).toHaveLength(2);
    expect(turns[0].userEntry?.id).toBe('u1');
    expect(turns[0].agentEntries.map((e) => e.id)).toEqual(['t1', 'd1']);
    expect(turns[1].userEntry?.id).toBe('u2');
    expect(turns[1].agentEntries.map((e) => e.id)).toEqual(['t2']);
  });

  it('emits a leading null-user turn when entries precede the first user_input', () => {
    const entries = [
      entry('orphan', 'thinking'),
      entry('u1', 'user_input', 'hello'),
      entry('d1', 'done'),
    ];
    const turns = groupIntoTurns(entries);
    expect(turns).toHaveLength(2);
    expect(turns[0].userEntry).toBeNull();
    expect(turns[0].agentEntries.map((e) => e.id)).toEqual(['orphan']);
    expect(turns[1].userEntry?.id).toBe('u1');
  });

  it('handles consecutive user_inputs (each starts a new turn even with no agent entries)', () => {
    const entries = [
      entry('u1', 'user_input', 'a'),
      entry('u2', 'user_input', 'b'),
    ];
    const turns = groupIntoTurns(entries);
    expect(turns).toHaveLength(2);
    expect(turns[0].agentEntries).toEqual([]);
    expect(turns[1].agentEntries).toEqual([]);
  });
});
