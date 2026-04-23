export type {
  SessionStatus,
  AgentSession,
  HlEvent,
  TabInfo,
  BrowserPoolStats,
  OutputEntry,
} from '../../shared/session-schemas';

export {
  AgentSessionSchema,
  HlEventSchema,
  TabInfoSchema,
  BrowserPoolStatsSchema,
  validateSession,
  validateSessionList,
  validateHlEvent,
  validateTabs,
  validatePoolStats,
} from '../../shared/session-schemas';

import type { AgentSession, HlEvent } from '../../shared/session-schemas';

export interface SessionEvents {
  'session-created': (session: AgentSession) => void;
  'session-updated': (session: AgentSession) => void;
  'session-completed': (session: AgentSession) => void;
  'session-error': (session: AgentSession) => void;
  'session-output': (id: string, event: HlEvent) => void;
  'session-output-term': (id: string, bytes: string) => void;
}
