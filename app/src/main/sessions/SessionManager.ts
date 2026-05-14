import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mainLogger } from '../logger';
import type { HlEvent } from '../../shared/session-schemas';
import type { AgentSession, SessionStatus, SessionEvents } from './types';
import { SessionDb } from './SessionDb';
import { extractRegistrableDomain } from './domain';
import {
  hlEventToTermBytes,
  eventsToTermBytes,
  createTermTranslatorState,
  type TermTranslatorState,
} from '../hl/streamToTerm';

export type { AgentSession, SessionStatus, SessionEvents };

const STUCK_TIMEOUT_MS = 30_000;

type UserInputEvent = Extract<HlEvent, { type: 'user_input' }>;
type AttachmentRow = { id: number; name: string; mime: string; bytes: Buffer; size: number; turn_index: number };

function isRestorableUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'file:';
  } catch {
    return false;
  }
}

export class SessionManager extends EventEmitter {
  private sessions: Map<string, AgentSession> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private stuckTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  /**
   * Per-session provider conversation id (Claude `session_id`, Codex
   * `thread_id`, BrowserCode/OpenCode `sessionID`). Passed to the adapter on
   * follow-up so the provider continues its own local transcript.
   */
  private engineSessionIds: Map<string, string> = new Map();
  /**
   * Per-session engine id chosen at create time. Mirrored in the DB and
   * hydrated at startup so historical sessions resume on the same backend.
   */
  private sessionEngines: Map<string, string> = new Map();
  private termStates: Map<string, TermTranslatorState> = new Map();
  private db: SessionDb;

  constructor(dbPath: string) {
    super();
    this.db = new SessionDb(dbPath);
    this.loadPersistedSessions();
  }

  private hydratedOutputs = new Set<string>();

  private loadPersistedSessions(): void {
    const recoveredCount = this.db.recoverStaleSessions();
    if (recoveredCount > 0) {
      mainLogger.warn('SessionManager.loadPersistedSessions.recovered', { count: recoveredCount });
    }

    const rows = this.db.listSessions({ limit: 100 });
    mainLogger.info('SessionManager.loadPersistedSessions.rows', {
      rowCount: rows.length,
      statuses: rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {} as Record<string, number>),
    });
    for (const row of rows) {
      const session: AgentSession = {
        id: row.id,
        prompt: row.prompt,
        status: row.status as SessionStatus,
        createdAt: row.created_at,
        output: [],
        error: row.error ?? undefined,
        group: row.group_name ?? undefined,
        originChannel: row.origin_channel ?? undefined,
        originConversationId: row.origin_conversation_id ?? undefined,
        primarySite: row.primary_site ?? null,
        lastUrl: row.last_url ?? null,
        canResume: Boolean(row.engine_session_id),
        lastActivityAt: row.updated_at,
      };
      if (row.engine) {
        (session as AgentSession & { engine?: string }).engine = row.engine;
        this.sessionEngines.set(row.id, row.engine);
      }
      if (row.engine_session_id) {
        this.engineSessionIds.set(row.id, row.engine_session_id);
      }
      if (row.model) {
        session.model = row.model;
      }
      if (row.auth_mode === 'apiKey' || row.auth_mode === 'subscription') {
        session.authMode = row.auth_mode;
      }
      if (row.subscription_type) {
        session.subscriptionType = row.subscription_type;
      }
      if (typeof row.cost_usd === 'number') session.costUsd = row.cost_usd;
      if (typeof row.input_tokens === 'number') session.inputTokens = row.input_tokens;
      if (typeof row.output_tokens === 'number') session.outputTokens = row.output_tokens;
      if (typeof row.cached_input_tokens === 'number') session.cachedInputTokens = row.cached_input_tokens;
      if (row.cost_source === 'exact' || row.cost_source === 'estimated') {
        session.costSource = row.cost_source;
      }
      this.sessions.set(row.id, session);
    }

    mainLogger.info('SessionManager.loadPersistedSessions', {
      totalLoaded: this.sessions.size,
      recovered: recoveredCount,
    });
  }

  private hydrateOutput(id: string): void {
    if (this.hydratedOutputs.has(id)) return;
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.output.length > 0) {
      this.hydratedOutputs.add(id);
      return;
    }
    const events = this.db.getEvents(id);
    if (events.length > 0) {
      session.output = events;
      const kickoff = this.firstUserInput(session)?.text;
      if (kickoff) session.prompt = kickoff;
      mainLogger.info('SessionManager.hydrateOutput', { id, eventCount: events.length });
    }
    this.hydratedOutputs.add(id);
  }

  // -- typed emit/on helpers ------------------------------------------------

  emitEvent<K extends keyof SessionEvents>(event: K, ...args: Parameters<SessionEvents[K]>): boolean {
    return this.emit(event, ...args);
  }

  onEvent<K extends keyof SessionEvents>(event: K, listener: SessionEvents[K]): this {
    return this.on(event, listener as (...args: unknown[]) => void);
  }

  private createUserInputEvent(text: string, attachmentTurnIndex?: number): UserInputEvent {
    const event: UserInputEvent = { type: 'user_input', text };
    if (attachmentTurnIndex !== undefined) {
      event.attachmentTurnIndex = attachmentTurnIndex;
    }
    return event;
  }

  private firstUserInput(session: AgentSession): UserInputEvent | undefined {
    return session.output.find((event): event is UserInputEvent => event.type === 'user_input');
  }

  private appendUserInputToLog(
    id: string,
    text: string,
    opts: { emit?: boolean; attachmentTurnIndex?: number } = {},
  ): UserInputEvent | null {
    const session = this.sessions.get(id);
    if (!session) {
      mainLogger.warn('SessionManager.appendUserInputToLog', { id, reason: 'not_found' });
      return null;
    }
    const event = this.createUserInputEvent(text, opts.attachmentTurnIndex);
    session.output.push(event);
    const seq = session.output.length - 1;
    this.db.appendEvent(id, seq, event);
    mainLogger.info('SessionManager.appendOutput.event', {
      id,
      seq,
      type: event.type,
      engine: session.engine ?? this.getSessionEngine(id),
      model: session.model ?? null,
      detail: this.describeEventForLog(event),
    });
    if (opts.emit !== false) {
      this.emitEvent('session-output', id, event);
      this.emitTermBytes(id, event);
    }
    return event;
  }

  getInitialPrompt(id: string): string | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    this.hydrateOutput(id);
    return this.firstUserInput(session)?.text ?? (session.prompt || undefined);
  }

  private getSnapshotPrompt(session: AgentSession): string {
    return this.firstUserInput(session)?.text
      ?? this.db.getFirstUserInputText(session.id)
      ?? session.prompt;
  }

  // -- public API -----------------------------------------------------------

  createSession(prompt: string, opts?: { originChannel?: string; originConversationId?: string; attachmentTurnIndex?: number }): string {
    const id = randomUUID();
    const now = Date.now();
    const session: AgentSession = {
      id,
      prompt,
      status: 'draft',
      createdAt: now,
      output: [],
      originChannel: opts?.originChannel,
      originConversationId: opts?.originConversationId,
    };
    this.sessions.set(id, session);
    this.db.insertSession({ id, prompt, status: 'draft', createdAt: now, originChannel: opts?.originChannel, originConversationId: opts?.originConversationId });
    this.appendUserInputToLog(id, prompt, { emit: false, attachmentTurnIndex: opts?.attachmentTurnIndex });
    mainLogger.info('SessionManager.createSession', { id, promptLength: prompt.length, originChannel: opts?.originChannel ?? null });
    this.emitEvent('session-created', { ...session });
    return id;
  }

  getSessionOrigin(id: string): { originChannel: string | null; originConversationId: string | null } {
    return this.db.getSessionOrigin(id);
  }

  startSession(id: string): AbortController {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }
    if (session.status !== 'draft' && session.status !== 'idle') {
      throw new Error(`Session ${id} is ${session.status}, expected draft or idle`);
    }

    const resumed = session.status === 'idle';
    session.status = 'running';
    this.db.updateSessionStatus(id, 'running');
    const abortController = new AbortController();
    this.abortControllers.set(id, abortController);

    this.resetStuckTimer(id);

    if (session.output.length === 0 && session.prompt) {
      this.appendUserInputToLog(id, session.prompt, { emit: false });
    }

    mainLogger.info('SessionManager.startSession', {
      id,
      resumed,
      engine: session.engine ?? this.getSessionEngine(id),
      model: session.model ?? null,
    });
    this.emitEvent('session-updated', { ...session });
    return abortController;
  }

  /** Called when the session's WebContents is gone (closed by user or crashed)
   *  while the agent itself isn't running. An idle session whose browser has
   *  been torn down is functionally over — flip status to 'stopped' so the UI
   *  stops showing "Idle" and renders the proper ended state. */
  markBrowserEnded(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.status !== 'idle') return;
    session.status = 'stopped';
    this.db.updateSessionStatus(id, 'stopped');
    mainLogger.info('SessionManager.markBrowserEnded', { id });
    this.emitEvent('session-updated', { ...session });
  }

  cancelSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      mainLogger.warn('SessionManager.cancelSession', { id, reason: 'not_found' });
      return;
    }
    if (session.status !== 'running' && session.status !== 'stuck' && session.status !== 'paused') {
      mainLogger.warn('SessionManager.cancelSession', { id, status: session.status, reason: 'not_cancellable' });
      return;
    }

    const ctrl = this.abortControllers.get(id);
    if (ctrl) {
      ctrl.abort();
      this.abortControllers.delete(id);
    }

    this.clearStuckTimer(id);
    session.status = 'stopped';
    session.error = 'Cancelled by user';
    this.db.updateSessionStatus(id, 'stopped', 'Cancelled by user');
    mainLogger.info('SessionManager.cancelSession', { id });
    this.emitEvent('session-updated', { ...session });
  }

  pauseSession(id: string, opts: { notify?: boolean } = {}): { paused?: boolean; error?: string } {
    const session = this.sessions.get(id);
    if (!session) {
      mainLogger.warn('SessionManager.pauseSession', { id, reason: 'not_found' });
      return { error: 'Session not found' };
    }
    if (session.status === 'paused') return { paused: true };
    if (session.status !== 'running' && session.status !== 'stuck') {
      const error = `Session ${id} is ${session.status}, expected running or stuck`;
      mainLogger.warn('SessionManager.pauseSession', { id, status: session.status, reason: 'not_pausable' });
      return { error };
    }
    this.clearStuckTimer(id);
    session.status = 'paused';
    session.error = undefined;
    session.canResume = true;
    this.db.updateSessionStatus(id, 'paused');
    if (opts.notify !== false) {
      this.appendOutput(id, { type: 'notify', level: 'info', message: 'Agent paused. Resume when you are ready.' });
    }
    mainLogger.info('SessionManager.pauseSession', {
      id,
      engine: session.engine ?? this.getSessionEngine(id),
      model: session.model ?? null,
    });
    this.emitEvent('session-updated', { ...session });
    return { paused: true };
  }

  resumePausedSession(id: string): { resumed?: boolean; error?: string } {
    const session = this.sessions.get(id);
    if (!session) {
      mainLogger.warn('SessionManager.resumePausedSession', { id, reason: 'not_found' });
      return { error: 'Session not found' };
    }
    if (session.status !== 'paused') {
      const error = `Session ${id} is ${session.status}, expected paused`;
      mainLogger.warn('SessionManager.resumePausedSession', { id, status: session.status, reason: 'not_paused' });
      return { error };
    }

    session.status = 'running';
    session.error = undefined;
    session.canResume = true;
    this.db.updateSessionStatus(id, 'running');
    this.resetStuckTimer(id);
    mainLogger.info('SessionManager.resumePausedSession', {
      id,
      engine: session.engine ?? this.getSessionEngine(id),
      model: session.model ?? null,
    });
    this.emitEvent('session-updated', { ...session });
    return { resumed: true };
  }

  appendOutput(id: string, event: HlEvent): void {
    const session = this.sessions.get(id);
    if (!session) {
      mainLogger.warn('SessionManager.appendOutput', { id, reason: 'not_found' });
      return;
    }
    session.output.push(event);
    const seq = session.output.length - 1;
    this.db.appendEvent(id, seq, event);

    if (event.type !== 'thinking') {
      mainLogger.info('SessionManager.appendOutput.event', {
        id,
        seq,
        type: event.type,
        engine: session.engine ?? this.getSessionEngine(id),
        model: session.model ?? null,
        detail: this.describeEventForLog(event),
      });
    }

    // turn_usage is telemetry — roll up into cumulative totals on the session
    // row so the UI can show a single number without scanning every event.
    // 'exact' beats 'estimated' if the session has a mix (shouldn't happen
    // since source is engine-specific, but be defensive).
    if (event.type === 'turn_usage') {
      session.costUsd = (session.costUsd ?? 0) + event.costUsd;
      session.inputTokens = (session.inputTokens ?? 0) + event.inputTokens;
      session.outputTokens = (session.outputTokens ?? 0) + event.outputTokens;
      session.cachedInputTokens = (session.cachedInputTokens ?? 0) + event.cachedInputTokens;
      if (event.source === 'exact' || !session.costSource) session.costSource = event.source;
      this.db.updateUsage(id, {
        costUsd: session.costUsd,
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        cachedInputTokens: session.cachedInputTokens,
        costSource: session.costSource,
      });
      mainLogger.info('SessionManager.turnUsage', {
        id,
        addedCostUsd: event.costUsd,
        totalCostUsd: session.costUsd,
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        source: event.source,
        model: event.model,
      });
      this.emitEvent('session-updated', { ...session });
    }

    if (session.status === 'stuck') {
      session.status = 'running';
      this.db.updateSessionStatus(id, 'running');
      mainLogger.info('SessionManager.appendOutput', { id, recovered: true });
      this.emitEvent('session-updated', { ...session });
    }

    if (session.status === 'running') {
      this.resetStuckTimer(id);
    }

    this.emitEvent('session-output', id, event);
    this.emitTermBytes(id, event);
  }

  private emitTermBytes(id: string, event: HlEvent): void {
    let state = this.termStates.get(id);
    if (!state) {
      state = createTermTranslatorState();
      this.termStates.set(id, state);
    }
    const bytes = hlEventToTermBytes(event, state);
    if (bytes) this.emitEvent('session-output-term', id, bytes);
  }

  /**
   * Build the full terminal replay stream for a session from its persisted
   * event history. Called when a renderer pane mounts (or remounts) and needs
   * to repaint its xterm.
   */
  getTermReplay(id: string): string {
    const session = this.sessions.get(id);
    if (!session) return '';
    this.hydrateOutput(id);
    const events: HlEvent[] = [];
    events.push(...session.output);
    if (events.length === 0 && session.prompt) {
      events.push({ type: 'user_input', text: session.prompt });
    }
    return eventsToTermBytes(events);
  }

  /** Update the session's latest restorable browser URL and primarySite.
   *  Called by index.ts when BrowserPool fires a navigation event — the
   *  browser is the source of truth for what page the session is on. */
  updateNavigationFromUrl(id: string, url: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (!isRestorableUrl(url)) return;
    const domain = extractRegistrableDomain(url);
    const nextSite = domain ?? session.primarySite ?? null;
    if (session.primarySite === nextSite && session.lastUrl === url) return;
    const from = session.primarySite ?? null;
    session.primarySite = nextSite;
    session.lastUrl = url;
    session.lastActivityAt = Date.now();
    this.db.updateNavigation(session.id, nextSite, url);
    mainLogger.info('SessionManager.navigation.update', { id: session.id, from, to: nextSite, url });
    this.emitEvent('session-updated', { ...session });
  }

  /** Back-compat for callers/tests that only cared about the display domain. */
  updatePrimarySiteFromUrl(id: string, url: string): void {
    this.updateNavigationFromUrl(id, url);
  }

  completeSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      mainLogger.warn('SessionManager.completeSession', { id, reason: 'not_found' });
      return;
    }
    if (session.status === 'paused' || session.status === 'stopped') {
      mainLogger.info('SessionManager.completeSession.ignored', { id, status: session.status });
      this.clearStuckTimer(id);
      this.abortControllers.delete(id);
      return;
    }
    this.clearStuckTimer(id);
    this.abortControllers.delete(id);
    session.status = 'idle';
    this.db.updateSessionStatus(id, 'idle');
    mainLogger.info('SessionManager.completeSession', {
      id,
      outputLines: session.output.length,
      engine: session.engine ?? this.getSessionEngine(id),
      model: session.model ?? null,
      authMode: session.authMode ?? null,
      costUsd: session.costUsd ?? null,
    });
    this.emitEvent('session-completed', { ...session });
  }

  resumeSession(id: string, prompt: string, opts: { attachmentTurnIndex?: number } = {}): AbortController {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }
    if (session.status !== 'idle' && session.status !== 'stopped' && session.status !== 'paused') {
      throw new Error(`Session ${id} is ${session.status}, expected idle, paused, or stopped`);
    }

    this.hydrateOutput(id);
    this.appendUserInputToLog(id, prompt, { attachmentTurnIndex: opts.attachmentTurnIndex });

    session.status = 'running';
    session.error = undefined;
    this.db.updateSessionStatus(id, 'running');
    const abortController = new AbortController();
    this.abortControllers.set(id, abortController);

    this.resetStuckTimer(id);

    mainLogger.info('SessionManager.resumeSession', {
      id,
      promptLength: prompt.length,
      engine: session.engine ?? this.getSessionEngine(id),
      model: session.model ?? null,
    });
    this.emitEvent('session-updated', { ...session });
    return abortController;
  }

  dismissSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      mainLogger.warn('SessionManager.dismissSession', { id, reason: 'not_found' });
      return;
    }
    session.status = 'stopped';
    this.db.updateSessionStatus(id, 'stopped');
    mainLogger.info('SessionManager.dismissSession', { id });
    this.emitEvent('session-updated', { ...session });
  }

  deleteSession(id: string): void {
    const session = this.sessions.get(id);
    if (session && (session.status === 'running' || session.status === 'stuck' || session.status === 'paused')) {
      this.cancelSession(id);
    }
    this.clearStuckTimer(id);
    this.abortControllers.delete(id);
    this.sessions.delete(id);
    this.termStates.delete(id);
    this.db.deleteSession(id);
    mainLogger.info('SessionManager.deleteSession', { id });
  }

  rerunSession(id: string, kickoffOverride?: string): AbortController {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    this.hydrateOutput(id);

    const ctrl = this.abortControllers.get(id);
    if (ctrl) { ctrl.abort(); this.abortControllers.delete(id); }
    this.clearStuckTimer(id);

    const originalUserInput = this.firstUserInput(session);
    const nextPrompt = kickoffOverride ?? originalUserInput?.text ?? session.prompt;
    const attachmentTurnIndex = originalUserInput?.attachmentTurnIndex;
    if (session.prompt !== nextPrompt) {
      session.prompt = nextPrompt;
      this.db.updateSessionPrompt(id, nextPrompt);
    }
    session.output = [];
    session.error = undefined;
    session.status = 'running';
    session.createdAt = Date.now();
    this.db.updateCreatedAt(id, session.createdAt);
    this.db.updateSessionStatus(id, 'running');
    this.db.saveMessages(id, []);
    this.db.clearEvents(id);
    this.termStates.delete(id);
    this.emitEvent('session-output-term', id, '\x1bc');
    // Rerun starts a fresh conversation — clear any provider resume id so the
    // next spawn doesn't attempt resume against a now-invalid thread.
    this.engineSessionIds.delete(id);
    session.canResume = false;
    this.db.updateEngineSessionId(id, null);

    const abortController = new AbortController();
    this.abortControllers.set(id, abortController);
    this.resetStuckTimer(id);

    this.emitEvent('session-updated', { ...session });
    this.appendUserInputToLog(id, nextPrompt, { attachmentTurnIndex });

    mainLogger.info('SessionManager.rerunSession', { id, promptLength: nextPrompt.length });
    return abortController;
  }

  saveMessages(id: string, messages: unknown[]): void {
    this.db.saveMessages(id, messages);
  }

  getMessages(id: string): unknown[] | null {
    return this.db.getMessages(id);
  }

  getNextAttachmentTurnIndex(sessionId: string): number {
    return this.db.getNextTurnIndex(sessionId);
  }

  saveAttachment(sessionId: string, a: { name: string; mime: string; bytes: Buffer | Uint8Array }, turnIndex: number): number {
    return this.db.saveAttachment(sessionId, a, turnIndex);
  }

  getAttachmentsMeta(sessionId: string): Array<{ id: number; name: string; mime: string; size: number; created_at: number; turn_index: number }> {
    return this.db.getAttachmentsMeta(sessionId);
  }

  loadAttachmentsForRun(sessionId: string): AttachmentRow[] {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.hydrateOutput(sessionId);
      const kickoff = this.firstUserInput(session);
      if (kickoff) {
        return kickoff.attachmentTurnIndex === undefined
          ? []
          : this.db.getAttachmentsByTurnIndex(sessionId, kickoff.attachmentTurnIndex);
      }
    }
    return this.db.getLatestTurnAttachments(sessionId);
  }

  failSession(id: string, error: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      mainLogger.warn('SessionManager.failSession', { id, reason: 'not_found' });
      return;
    }
    this.clearStuckTimer(id);
    this.abortControllers.delete(id);
    session.status = 'stopped';
    session.error = error;
    this.db.updateSessionStatus(id, 'stopped', error);
    mainLogger.info('SessionManager.failSession', {
      id,
      error,
      engine: session.engine ?? this.getSessionEngine(id),
      model: session.model ?? null,
    });
    this.emitEvent('session-error', { ...session });
  }

  getSession(id: string): AgentSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    this.hydrateOutput(id);
    return { ...session, prompt: this.getSnapshotPrompt(session) };
  }

  getResourceInfo(id: string): { prompt: string; status: SessionStatus; engine: string | null } | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    return {
      prompt: this.getSnapshotPrompt(session),
      status: session.status,
      engine: session.engine ?? this.getSessionEngine(id),
    };
  }

  getSessionStatus(id: string): SessionStatus | undefined {
    return this.sessions.get(id)?.status;
  }

  listSessions(): AgentSession[] {
    const list = Array.from(this.sessions.values());
    mainLogger.info('SessionManager.listSessions', {
      returning: list.length,
    });
    return list
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({ ...s, prompt: this.getSnapshotPrompt(s), output: [] }));
  }

  /** Store the provider conversation id reported by the engine stream. */
  setEngineSessionId(id: string, engineSessionId: string): void {
    this.engineSessionIds.set(id, engineSessionId);
    const session = this.sessions.get(id);
    if (session) session.canResume = true;
    this.db.updateEngineSessionId(id, engineSessionId);
    mainLogger.info('SessionManager.setEngineSessionId', { id, engineSessionId });
  }

  /** Retrieve a previously-captured provider conversation id, if any. */
  getEngineSessionId(id: string): string | undefined {
    return this.engineSessionIds.get(id);
  }

  /** Back-compat wrappers for older call sites. */
  setClaudeSessionId(id: string, claudeSessionId: string): void {
    this.setEngineSessionId(id, claudeSessionId);
  }

  getClaudeSessionId(id: string): string | undefined {
    return this.getEngineSessionId(id);
  }

  /** Record the engine id chosen for this session. Also stamps
   *  `session.engine` so every future snapshot carries the provider id to the
   *  renderer for header icon rendering. */
  setSessionEngine(id: string, engineId: string): void {
    this.sessionEngines.set(id, engineId);
    const session = this.sessions.get(id);
    if (session) {
      (session as AgentSession & { engine?: string }).engine = engineId;
      this.db.updateEngine(id, engineId);
      mainLogger.info('SessionManager.setSessionEngine', { id, engineId });
      this.emitEvent('session-updated', { ...session });
    }
  }

  /** Retrieve the per-session engine id, or null if never set. */
  getSessionEngine(id: string): string | null {
    return this.sessionEngines.get(id) ?? null;
  }

  setSessionModel(id: string, model: string | null): void {
    const session = this.sessions.get(id);
    if (!session) {
      mainLogger.warn('SessionManager.setSessionModel.notFound', { id, model });
      return;
    }
    session.model = model ?? undefined;
    this.db.updateModel(id, model);
    mainLogger.info('SessionManager.setSessionModel', {
      id,
      engine: session.engine ?? this.getSessionEngine(id),
      model,
    });
    this.emitEvent('session-updated', { ...session });
  }

  /** Snapshot the auth mode + subscription type that actually ran this session.
   *  Called once at spawn by runEngine via the onAuthResolved callback. Frozen
   *  for the life of the session — later global auth-mode changes do not
   *  retroactively rewrite historical sessions. */
  setSessionAuth(id: string, authMode: 'apiKey' | 'subscription' | null, subscriptionType: string | null): void {
    const session = this.sessions.get(id);
    if (!session) {
      mainLogger.warn('SessionManager.setSessionAuth.notFound', { id });
      return;
    }
    session.authMode = authMode ?? undefined;
    session.subscriptionType = subscriptionType ?? undefined;
    this.db.updateAuth(id, authMode, subscriptionType);
    mainLogger.info('SessionManager.setSessionAuth', { id, authMode, subscriptionType });
    this.emitEvent('session-updated', { ...session });
  }

  getAbortController(id: string): AbortController | undefined {
    return this.abortControllers.get(id);
  }

  // -- stuck detection ------------------------------------------------------

  private resetStuckTimer(id: string): void {
    this.clearStuckTimer(id);
    const timer = setTimeout(() => {
      const session = this.sessions.get(id);
      if (session && session.status === 'running') {
        session.status = 'stuck';
        this.db.updateSessionStatus(id, 'stuck');
        const lastEvent = session.output.at(-1);
        mainLogger.warn('SessionManager.stuckDetected', {
          id,
          timeoutMs: STUCK_TIMEOUT_MS,
          engine: session.engine ?? this.getSessionEngine(id),
          model: session.model ?? null,
          outputLines: session.output.length,
          lastEventType: lastEvent?.type ?? null,
          lastActivityAt: session.lastActivityAt ?? null,
        });
        this.emitEvent('session-updated', { ...session });
      }
    }, STUCK_TIMEOUT_MS);
    timer.unref();
    this.stuckTimers.set(id, timer);
  }

  private clearStuckTimer(id: string): void {
    const timer = this.stuckTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.stuckTimers.delete(id);
    }
  }

  private describeEventForLog(event: HlEvent): Record<string, unknown> {
    switch (event.type) {
      case 'tool_call':
        return { name: event.name, iteration: event.iteration };
      case 'tool_result':
        return { name: event.name, ok: event.ok, ms: event.ms, previewLength: event.preview.length };
      case 'harness_edited':
        return { target: event.target, action: event.action, path: event.path };
      case 'skill_written':
        return { domain: event.domain, topic: event.topic, action: event.action, path: event.path };
      case 'skill_used':
        return { domain: event.domain ?? null, topic: event.topic, path: event.path };
      case 'file_output':
        return { name: event.name, path: event.path, size: event.size, mime: event.mime };
      case 'turn_usage':
        return {
          model: event.model ?? null,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cachedInputTokens: event.cachedInputTokens,
          costUsd: event.costUsd,
          source: event.source,
        };
      case 'done':
        return { iterations: event.iterations, summaryLength: event.summary.length };
      case 'error':
        return { message: event.message.slice(0, 400) };
      case 'notify':
        return { level: event.level, messageLength: event.message.length };
      case 'user_input':
        return { textLength: event.text.length, attachmentTurnIndex: event.attachmentTurnIndex ?? null };
      case 'thinking':
        return { textLength: event.text.length };
    }
  }

  // -- cleanup --------------------------------------------------------------

  destroy(): void {
    for (const [id, ctrl] of this.abortControllers) {
      ctrl.abort();
      mainLogger.info('SessionManager.destroy.abort', { id });
    }
    this.abortControllers.clear();

    for (const timer of this.stuckTimers.values()) {
      clearTimeout(timer);
    }
    this.stuckTimers.clear();

    this.removeAllListeners();
    this.db.close();
    mainLogger.info('SessionManager.destroy', { sessionCount: this.sessions.size });
  }
}
