export type SessionStatus = 'draft' | 'running' | 'stuck' | 'stopped';

export interface OutputEntry {
  id: string;
  type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'error';
  timestamp: number;
  content: string;
  tool?: string;
  duration?: number;
}

export interface AgentSession {
  id: string;
  prompt: string;
  status: SessionStatus;
  createdAt: number;
  output: OutputEntry[];
  elapsedMs: number;
  toolCallCount: number;
}
