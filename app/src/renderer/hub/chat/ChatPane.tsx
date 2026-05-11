import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { TaskInput, type TaskInputHandle, type TaskInputSubmission } from '../TaskInput';
import { ChatTranscript } from './ChatTranscript';
import { BrowserPreview } from './BrowserPreview';
import { useSessionsStore } from '../state/sessionsStore';
import { STATUS_LABEL } from '../constants';
import { useTextSelection } from './useTextSelection';
import { QuoteSelectionButton } from './QuoteSelectionButton';
import { formatUserMessageWithQuote } from './parseUserMessage';
import { useToast } from '@/renderer/components/base/Toast';
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

  // Text-selection quote system. Scoped to the transcript only — selecting in
  // the composer or sidebar doesn't trigger the floating Quote button.
  const transcriptRef = useRef<HTMLDivElement>(null);
  const taskInputRef = useRef<TaskInputHandle>(null);
  const selection = useTextSelection(transcriptRef);
  const [quotedText, setQuotedText] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const toast = useToast();

  // Clear the active quote when switching sessions so it doesn't leak across.
  useEffect(() => { setQuotedText(null); setEditing(false); }, [sessionId]);

  const onEditMessage = useCallback((text: string) => {
    console.log('[ChatPane] edit message', { length: text.length });
    setEditing(true);
    setQuotedText(null);
    taskInputRef.current?.setText(text);
  }, []);

  const onShare = useCallback(() => {
    toast.show({ variant: 'info', title: 'Share coming soon', message: 'HTML export is wired but not yet implemented.' });
  }, [toast]);

  const onQuote = useCallback((text: string) => {
    console.log('[ChatPane] quote', { length: text.length });
    setQuotedText(text);
  }, []);

  const onSubmit = useCallback(
    async (sub: TaskInputSubmission) => {
      const api = window.electronAPI;
      if (!api) {
        console.warn('[ChatPane] no electronAPI');
        return;
      }
      if (editing) {
        console.log('[ChatPane] editAndRerun submit', { sessionId, promptLength: sub.prompt.length });
        try {
          const res = await api.sessions.editAndRerun(sessionId, sub.prompt);
          if (res?.error) {
            console.error('[ChatPane] editAndRerun error', res.error);
            toast.show({ variant: 'error', title: 'Edit failed', message: res.error });
          } else {
            setEditing(false);
            setQuotedText(null);
            toast.show({ variant: 'success', title: 'Conversation reset with edited prompt' });
          }
        } catch (err) {
          console.error('[ChatPane] editAndRerun threw', err);
          toast.show({ variant: 'error', title: 'Edit failed', message: String(err) });
        }
        return;
      }
      const composed = formatUserMessageWithQuote(quotedText, sub.prompt);
      console.log('[ChatPane] resume submit', {
        sessionId,
        promptLength: composed.length,
        attachments: sub.attachments.length,
        hasQuote: !!quotedText,
      });
      try {
        const res = await api.sessions.resume(sessionId, composed, sub.attachments);
        console.log('[ChatPane] resume result', res);
        if (res.error) console.error('[ChatPane] resume error', res.error);
        else setQuotedText(null);
      } catch (err) {
        console.error('[ChatPane] resume threw', err);
      }
    },
    [sessionId, quotedText, editing, toast],
  );

  const onCancel = useCallback(() => {
    const api = window.electronAPI;
    if (!api) return;
    console.log('[ChatPane] cancel', { sessionId });
    api.sessions.cancel(sessionId).catch((err) => console.error('[ChatPane] cancel failed', err));
  }, [sessionId]);

  const onRerun = useCallback(() => {
    const api = window.electronAPI;
    if (!api) return;
    console.log('[ChatPane] rerun', { sessionId });
    api.sessions.rerun(sessionId).catch((err) => console.error('[ChatPane] rerun failed', err));
  }, [sessionId]);

  const onResumeRun = useCallback(() => {
    const api = window.electronAPI;
    if (!api) return;
    console.log('[ChatPane] resume (no new prompt)', { sessionId });
    // Mirror HubApp.handleResume's canned-prompt pattern so paused sessions
    // can be picked up without making the user type something.
    api.sessions.resume(sessionId, 'Continue from where you left off', [])
      .catch((err) => console.error('[ChatPane] resume failed', err));
  }, [sessionId]);

  const composer = useMemo(() => {
    if (!header) return null;
    const isTerminal = header.canResume === false || header.status === 'stopped';
    const isBusy = header.status === 'running' || header.status === 'stuck';

    if (isTerminal) {
      return (
        <div className="chat-composer__terminal">
          <span>This session is finished. Start a new task from the dashboard.</span>
          <div style={{ display: 'inline-flex', gap: 8 }}>
            <button className="chat-composer__cancel" onClick={onRerun}>Rerun</button>
            <button className="chat-composer__cancel" onClick={onExit}>Back to dashboard</button>
          </div>
        </div>
      );
    }

    const isPaused = header.status === 'paused';

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
        {isPaused && (
          <p className="chat-composer__hint">
            Agent is paused.
            {' '}
            <button
              className="chat-composer__cancel"
              style={{ marginLeft: 6, padding: '1px 8px', fontSize: 10 }}
              onClick={onResumeRun}
            >Resume</button>
          </p>
        )}
        {editing && (
          <p className="chat-composer__hint">
            Editing your first message — submitting will rewrite the conversation from here.
            {' '}
            <button
              className="chat-composer__cancel"
              style={{ marginLeft: 6, padding: '1px 8px', fontSize: 10 }}
              onClick={() => { setEditing(false); taskInputRef.current?.setText(''); }}
            >Cancel edit</button>
          </p>
        )}
        <TaskInput
          ref={taskInputRef}
          onSubmit={onSubmit}
          topSlot={quotedText ? (
            <div className="chat-quote-preview" role="region" aria-label="Quoted text">
              <div className="chat-quote-preview__bar" aria-hidden />
              <div className="chat-quote-preview__text">{quotedText}</div>
              <button
                type="button"
                className="chat-quote-preview__close"
                aria-label="Remove quote"
                onClick={() => setQuotedText(null)}
              >×</button>
            </div>
          ) : undefined}
        />
      </>
    );
  }, [header, onSubmit, onCancel, onExit, onRerun, onResumeRun, quotedText, editing]);

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
        <ChatTranscript
          sessionId={sessionId}
          ref={transcriptRef}
          onEditMessage={onEditMessage}
          onShare={onShare}
        />
        <div className="chat-composer">
          <div className="chat-preview-rail">
            <BrowserPreview sessionId={sessionId} onExpand={onSwitchToBrowser} />
          </div>
          {composer}
        </div>
      </div>
      <QuoteSelectionButton selection={selection} onQuote={onQuote} />
    </div>
  );
}
