export type SessionStatus = 'draft' | 'running' | 'stuck' | 'stopped';

export type HlEvent =
  | { type: 'thinking';    text: string }
  | { type: 'tool_call';   name: string; args: unknown; iteration: number }
  | { type: 'tool_result'; name: string; ok: boolean; preview: string; ms: number }
  | { type: 'done';        summary: string; iterations: number }
  | { type: 'error';       message: string };

export interface AgentSession {
  id: string;
  prompt: string;
  status: SessionStatus;
  createdAt: number;
  output: HlEvent[];
  error?: string;
  group?: string;
}

export interface OutputEntry {
  id: string;
  type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'error';
  timestamp: number;
  content: string;
  tool?: string;
  duration?: number;
}

let _adapterId = 0;

export function hlEventToOutputEntry(event: HlEvent, timestamp: number): OutputEntry {
  const id = `oe-${++_adapterId}`;

  switch (event.type) {
    case 'thinking':
      return { id, type: 'thinking', timestamp, content: event.text };
    case 'tool_call':
      return {
        id, type: 'tool_call', timestamp,
        tool: event.name,
        content: typeof event.args === 'string' ? event.args : JSON.stringify(event.args, null, 2),
      };
    case 'tool_result':
      return {
        id, type: 'tool_result', timestamp,
        tool: event.name,
        content: event.preview,
        duration: event.ms,
      };
    case 'done':
      return { id, type: 'text', timestamp, content: event.summary };
    case 'error':
      return { id, type: 'error', timestamp, content: event.message };
  }
}

export function adaptSession(session: AgentSession): {
  entries: OutputEntry[];
  toolCallCount: number;
  elapsedMs: number;
} {
  const entries = session.output.map((e, i) => hlEventToOutputEntry(e, session.createdAt + i));
  const toolCallCount = session.output.filter((e) => e.type === 'tool_call').length;
  const elapsedMs = Date.now() - session.createdAt;
  return { entries, toolCallCount, elapsedMs };
}
