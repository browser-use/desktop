import React, { useCallback, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { TaskInput, type TaskInputSubmission } from '../TaskInput';
import { ChatTranscript } from './ChatTranscript';
import { BrowserPreview } from './BrowserPreview';
import { useSessionsStore } from '../state/sessionsStore';
import { STATUS_LABEL } from '../constants';
import claudeCodeLogo from '../claude-code-logo.svg';
import openaiLogo from '../openai-logo.svg';
import opencodeLogo from '../opencode-logo-light.svg';
import './chat.css';

interface ChatPaneProps {
  sessionId: string;
  onSwitchToBrowser: () => void;
  onExit: () => void;
}

function formatCost(usd?: number): string {
  if (usd === undefined) return '';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function ChatPane({ sessionId, onSwitchToBrowser, onExit }: ChatPaneProps): React.ReactElement {
  // sessions.listAll (used at boot) returns metadata only — output[] is empty
  // until something triggers hydrateOutput in the main process. Call
  // sessions.get on mount so the transcript repaints from the DB instead of
  // sitting on "No messages yet" after a reload.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    let cancelled = false;
    void api.sessions.get(sessionId).then((sess) => {
      if (cancelled || !sess) return;
      console.log('[ChatPane] hydrated output from sessions.get', { id: sessionId, eventCount: sess.output?.length ?? 0 });
      useSessionsStore.getState().upsertSession(sess);
    }).catch((err) => console.error('[ChatPane] sessions.get failed', err));
    return () => { cancelled = true; };
  }, [sessionId]);

  const header = useSessionsStore(
    useShallow((s): {
      prompt: string;
      status: string;
      engine: string | undefined;
      model: string | undefined;
      authMode: 'apiKey' | 'subscription' | undefined;
      subscriptionType: string | undefined;
      costUsd: number | undefined;
      costSource: 'exact' | 'estimated' | undefined;
      inputTokens: number | undefined;
      outputTokens: number | undefined;
      canResume: boolean | undefined;
    } | null => {
      const sess = s.byId[sessionId];
      if (!sess) return null;
      return {
        prompt: sess.prompt,
        status: sess.status,
        engine: sess.engine,
        model: sess.model,
        authMode: sess.authMode,
        subscriptionType: sess.subscriptionType,
        costUsd: sess.costUsd,
        costSource: sess.costSource,
        inputTokens: sess.inputTokens,
        outputTokens: sess.outputTokens,
        canResume: sess.canResume,
      };
    }),
  );

  const onSubmit = useCallback(
    async (sub: TaskInputSubmission) => {
      const api = window.electronAPI;
      if (!api) {
        console.warn('[ChatPane] no electronAPI');
        return;
      }
      console.log('[ChatPane] resume submit', { sessionId, promptLength: sub.prompt.length, attachments: sub.attachments.length });
      try {
        const res = await api.sessions.resume(sessionId, sub.prompt, sub.attachments);
        console.log('[ChatPane] resume result', res);
        if (res.error) console.error('[ChatPane] resume error', res.error);
      } catch (err) {
        console.error('[ChatPane] resume threw', err);
      }
    },
    [sessionId],
  );

  const onCancel = useCallback(() => {
    const api = window.electronAPI;
    if (!api) return;
    console.log('[ChatPane] cancel', { sessionId });
    api.sessions.cancel(sessionId).catch((err) => console.error('[ChatPane] cancel failed', err));
  }, [sessionId]);

  const composer = useMemo(() => {
    if (!header) return null;
    const isTerminal = header.canResume === false || header.status === 'stopped';
    const isBusy = header.status === 'running' || header.status === 'stuck';

    if (isTerminal) {
      return (
        <div className="chat-composer__terminal">
          <span>This session is finished. Start a new task from the dashboard.</span>
          <button className="chat-composer__cancel" onClick={onExit}>Back to dashboard</button>
        </div>
      );
    }

    // While running, still allow follow-ups — backend queues them (resume()
    // returns `queued: true` if mid-step). Show a small hint above the input.
    return (
      <>
        {isBusy && (
          <p className="chat-composer__hint">
            Agent is {header.status === 'stuck' ? 'stuck' : 'running'} — your message will be queued.
            {' '}
            <button
              className="chat-composer__cancel"
              style={{ marginLeft: 6, padding: '1px 8px', fontSize: 10 }}
              onClick={onCancel}
            >Cancel run</button>
          </p>
        )}
        <TaskInput onSubmit={onSubmit} />
      </>
    );
  }, [header, onSubmit, onCancel, onExit]);

  if (!header) {
    return (
      <div className="chat-pane">
        <div className="chat-empty">Session not found.</div>
      </div>
    );
  }

  const statusClass = `chat-pane__status chat-pane__status--${header.status}`;

  return (
    <div className="chat-pane">
      <div className="chat-pane__header">
        <div className="chat-pane__title" aria-hidden="true" />
        <div className="chat-pane__meta">
          {header.engine === 'codex' && (
            <img className="pane__engine-icon" src={openaiLogo} alt="Codex" title="Codex" />
          )}
          {header.engine === 'browsercode' && (
            <img className="pane__engine-icon" src={opencodeLogo} alt="BrowserCode" title="BrowserCode" />
          )}
          {header.engine === 'claude-code' && (
            <img className="pane__engine-icon" src={claudeCodeLogo} alt="Claude Code" title="Claude Code" />
          )}
          {header.model && header.engine === 'browsercode' && (
            <span className="pane__model-badge" title={`Model: ${header.model}`}>
              {header.model.includes('/') ? header.model.split('/').pop() : header.model}
            </span>
          )}
          {header.authMode && (
            <span
              className={`pane__auth-badge pane__auth-badge--${header.authMode}`}
              title={
                header.authMode === 'subscription'
                  ? `Ran under ${header.subscriptionType ?? 'subscription'} OAuth`
                  : 'Ran under saved API key'
              }
            >
              {header.authMode === 'subscription' ? 'SUBSCRIPTION' : 'KEY'}
            </span>
          )}
          {typeof header.costUsd === 'number' && header.costUsd > 0 && header.authMode !== 'subscription' && (
            <span
              className="pane__cost"
              title={
                header.costSource === 'estimated'
                  ? `Estimated from token count × local price table · ${header.inputTokens ?? 0} in / ${header.outputTokens ?? 0} out`
                  : `${header.inputTokens ?? 0} in / ${header.outputTokens ?? 0} out`
              }
            >
              {header.costSource === 'estimated' ? '~' : ''}
              {formatCost(header.costUsd)}
            </span>
          )}
          <span className={statusClass}>{STATUS_LABEL[header.status] ?? header.status}</span>
        </div>
      </div>
      <div className="chat-pane__column">
        <ChatTranscript sessionId={sessionId} />
        <div className="chat-preview-rail">
          <BrowserPreview sessionId={sessionId} onExpand={onSwitchToBrowser} />
        </div>
        <div className="chat-composer">{composer}</div>
      </div>
    </div>
  );
}
