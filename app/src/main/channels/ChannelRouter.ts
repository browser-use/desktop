import { mainLogger } from '../logger';
import type { SessionManager } from '../sessions/SessionManager';
import type { WhatsAppAdapter } from './WhatsAppAdapter';
import type { InboundMessage } from './types';

export type StartSessionFn = (id: string) => Promise<void>;

export class ChannelRouter {
  private sentMessageToSession = new Map<string, string>();
  private stuckNotified = new Set<string>();
  private startSessionFn: StartSessionFn | null = null;

  setStartSession(fn: StartSessionFn): void {
    this.startSessionFn = fn;
  }

  constructor(
    private sessionManager: SessionManager,
    private adapter: WhatsAppAdapter,
  ) {
    adapter.onMessage((msg) => this.handleInbound(msg));

    sessionManager.onEvent('session-completed', (session) => {
      const origin = sessionManager.getSessionOrigin(session.id);
      if (origin.originChannel !== 'whatsapp' || !origin.originConversationId) return;

      const doneEvent = session.output.find(
        (e: { type: string }) => e.type === 'done',
      ) as { type: string; summary?: string } | undefined;
      const summary = doneEvent?.summary ?? 'Task completed';
      const prompt = session.prompt.slice(0, 60);
      const text = `Done: "${prompt}"\n${summary.slice(0, 80)}`;

      mainLogger.info('channelRouter.notify.completed', {
        sessionId: session.id,
        convId: origin.originConversationId,
      });

      this.sendAndTrack(session.id, origin.originConversationId, text);
    });

    sessionManager.onEvent('session-error', (session) => {
      const origin = sessionManager.getSessionOrigin(session.id);
      if (origin.originChannel !== 'whatsapp' || !origin.originConversationId) return;

      const prompt = session.prompt.slice(0, 60);
      const text = `Failed: "${prompt}"\n${session.error ?? 'Unknown error'}`;

      mainLogger.info('channelRouter.notify.error', {
        sessionId: session.id,
        convId: origin.originConversationId,
      });

      this.sendAndTrack(session.id, origin.originConversationId, text);
    });

    sessionManager.onEvent('session-updated', (session) => {
      if (session.status !== 'stuck') return;
      if (this.stuckNotified.has(session.id)) return;

      const origin = sessionManager.getSessionOrigin(session.id);
      if (origin.originChannel !== 'whatsapp' || !origin.originConversationId) return;

      this.stuckNotified.add(session.id);
      mainLogger.info('channelRouter.notify.stuck', {
        sessionId: session.id,
        convId: origin.originConversationId,
      });

      const prompt = session.prompt.slice(0, 60);
      this.sendAndTrack(session.id, origin.originConversationId, `Needs input \u2014 "${prompt}"\nCheck the hub`);
    });
  }

  handleInbound(msg: InboundMessage): void {
    if (msg.replyToMessageId) {
      const sessionId = this.sentMessageToSession.get(msg.replyToMessageId);
      if (sessionId) {
        mainLogger.info('channelRouter.replyResume', {
          sessionId,
          replyToMessageId: msg.replyToMessageId,
          textLength: msg.text.length,
        });

        try {
          this.sessionManager.resumeSession(sessionId, msg.text);
          if (this.startSessionFn) {
            this.startSessionFn(sessionId).catch((err) => {
              mainLogger.error('channelRouter.resumeStartFailed', {
                sessionId,
                error: (err as Error).message,
              });
            });
          }
          return;
        } catch (err) {
          mainLogger.warn('channelRouter.resumeFailed', {
            sessionId,
            error: (err as Error).message,
          });
        }
      }
    }

    this.createNewSession(msg);
  }

  private createNewSession(msg: InboundMessage): void {
    const t0 = Date.now();
    try {
      const id = this.sessionManager.createSession(msg.text, {
        originChannel: 'whatsapp',
        originConversationId: msg.conversationId,
      });
      const t1 = Date.now();

      mainLogger.info('channelRouter.newSession', {
        sessionId: id,
        conversationId: msg.conversationId,
        from: msg.fromName,
        promptLength: msg.text.length,
        createMs: t1 - t0,
      });

      if (this.startSessionFn) {
        this.startSessionFn(id).catch((err) => {
          mainLogger.error('channelRouter.startSessionFailed', {
            sessionId: id,
            error: (err as Error).message,
          });
        });
      } else {
        this.sessionManager.startSession(id);
      }
    } catch (err) {
      mainLogger.error('channelRouter.createSessionFailed', {
        error: (err as Error).message,
        conversationId: msg.conversationId,
      });
    }
  }

  private sendAndTrack(sessionId: string, convId: string, text: string): void {
    this.adapter.send(convId, text)
      .then((sentId) => {
        if (sentId) {
          this.sentMessageToSession.set(sentId, sessionId);
          mainLogger.info('channelRouter.tracked', { sentId, sessionId });
        }
      })
      .catch((err) => {
        mainLogger.error('channelRouter.notify.sendFailed', {
          error: (err as Error).message,
        });
      });
  }

  destroy(): void {
    this.sentMessageToSession.clear();
    this.stuckNotified.clear();
  }
}
