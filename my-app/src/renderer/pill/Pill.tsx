/**
 * Track B — Pill root component.
 *
 * Orchestrates the full pill UX state machine:
 *
 *   idle       → user types → submitting → running → done|failed|target_lost
 *
 * States:
 * - idle:       input only, autofocus, static accent dot
 * - submitting: input disabled, dot pulses (streaming state), progress bar
 * - running:    input disabled, ProgressToast, dot pulses
 * - done:       ✓ icon, ResultDisplay (done), auto-dismiss 4s, ⌘C chip
 * - error:      ✕ icon, ResultDisplay (failed/target_lost/cancelled), manual dismiss
 *
 * Visual state → data-state mapping (CSS drives appearance):
 *   idle        → data-state="idle"
 *   submitting  → data-state="streaming"
 *   running     → data-state="streaming"
 *   done        → data-state="done"
 *   error       → data-state="error"
 *
 * The "focused" data-state is applied reactively via onFocus/onBlur on the
 * input row — only in idle phase.
 *
 * IPC flow:
 * - Enter in PillInput → pillAPI.submit({ prompt }) → main process handles
 * - main process sends pill:event (AgentEvent) → ProgressToast updates
 * - task_done/failed/target_lost/cancelled → ResultDisplay
 * - Esc at any time → pillAPI.hide() → pill window hidden
 *
 * D2: console logging for all state transitions (dev-only).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PillInput } from './PillInput';
import { ProgressToast, applyEventToSteps } from './ProgressToast';
import type { ProgressStep } from './ProgressToast';
import { ResultDisplay } from './ResultDisplay';
import type { ResultState } from './ResultDisplay';
import type { AgentEvent } from '../../shared/types';

// ---------------------------------------------------------------------------
// D2 — Dev-only logger (renderer context)
// ---------------------------------------------------------------------------

const DEV =
  typeof process !== 'undefined'
    ? process.env.NODE_ENV !== 'production' || process.env.AGENTIC_DEV === '1'
    : true;

const log = {
  debug: DEV
    ? (comp: string, ctx: object) =>
        console.log(JSON.stringify({ ts: Date.now(), level: 'debug', component: comp, ...ctx }))
    : () => {},
  info: DEV
    ? (comp: string, ctx: object) =>
        console.log(JSON.stringify({ ts: Date.now(), level: 'info', component: comp, ...ctx }))
    : () => {},
  warn: (comp: string, ctx: object) =>
    console.warn(JSON.stringify({ ts: Date.now(), level: 'warn', component: comp, ...ctx })),
  error: (comp: string, ctx: object) =>
    console.error(JSON.stringify({ ts: Date.now(), level: 'error', component: comp, ...ctx })),
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Auto-dismiss delay for task_done results (4s per spec) */
const AUTO_DISMISS_MS = 4000 as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PillPhase =
  | 'idle'
  | 'submitting'
  | 'running'
  | 'done'
  | 'error';

/** CSS data-state values — drives all visual state via pill.css */
type PillDataState = 'idle' | 'focused' | 'streaming' | 'done' | 'error';

interface PillState {
  phase: PillPhase;
  inputValue: string;
  activeTaskId: string | null;
  steps: ProgressStep[];
  isStarting: boolean;
  result: ResultState | null;
  queuedTask: string | null;
}

const INITIAL_STATE: PillState = {
  phase: 'idle',
  inputValue: '',
  activeTaskId: null,
  steps: [],
  isStarting: false,
  result: null,
  queuedTask: null,
};

// ---------------------------------------------------------------------------
// pillAPI type — matches what preload/pill.ts exposes
// ---------------------------------------------------------------------------

interface PillAPI {
  submit: (prompt: string) => Promise<{ task_id: string }>;
  hide: () => void;
  onEvent: (cb: (event: AgentEvent) => void) => () => void;
  onHideRequest: (cb: () => void) => () => void;
  onQueuedTask: (cb: (data: { prompt: string; task_id: string }) => void) => () => void;
}

declare global {
  interface Window {
    pillAPI: PillAPI;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeDataState(phase: PillPhase, isFocused: boolean): PillDataState {
  switch (phase) {
    case 'idle':
      return isFocused ? 'focused' : 'idle';
    case 'submitting':
    case 'running':
      return 'streaming';
    case 'done':
      return 'done';
    case 'error':
      return 'error';
  }
}

// ---------------------------------------------------------------------------
// Leading slot — dot (idle/focused/streaming) or result icon (done/error)
// ---------------------------------------------------------------------------

function LeadingDot({ state }: { state: PillDataState }): React.ReactElement {
  if (state === 'done') {
    return (
      <span className="pill-result-lead-icon pill-result-lead-icon--done" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M4.5 7.5L6.5 9.5L9.5 5.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  if (state === 'error') {
    return (
      <span className="pill-result-lead-icon pill-result-lead-icon--error" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M7 4.5V7.5M7 9V9.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }

  // idle / focused / streaming — accent dot
  return <span className="pill-dot" aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Pill(): React.ReactElement {
  const [state, setState] = useState<PillState>(INITIAL_STATE);
  const [isFocused, setIsFocused] = useState(false);
  const stateRef = useRef<PillState>(state);
  stateRef.current = state;

  const dataState = computeDataState(state.phase, isFocused);

  // -------------------------------------------------------------------------
  // IPC event subscription
  // -------------------------------------------------------------------------

  useEffect(() => {
    log.info('Pill.mount', { message: 'Pill component mounted — subscribing to events' });

    const unsubEvent = window.pillAPI.onEvent((event: AgentEvent) => {
      log.debug('Pill.onEvent', {
        message: 'Agent event received',
        eventType: event.event,
        task_id: event.task_id,
        phase: stateRef.current.phase,
      });

      setState((prev) => {
        if (prev.activeTaskId && event.task_id !== prev.activeTaskId) {
          log.warn('Pill.onEvent.mismatch', {
            message: 'Event task_id does not match active task — ignoring',
            eventTaskId: event.task_id,
            activeTaskId: prev.activeTaskId,
          });
          return prev;
        }

        switch (event.event) {
          case 'task_started':
            log.info('Pill.task_started', { task_id: event.task_id });
            return {
              ...prev,
              phase: 'running',
              isStarting: false,
              steps: [],
            };

          case 'step_start':
          case 'step_result':
          case 'step_error':
            return {
              ...prev,
              phase: 'running',
              steps: applyEventToSteps(prev.steps, event),
            };

          case 'task_done':
            log.info('Pill.task_done', {
              task_id: event.task_id,
              steps_used: event.steps_used,
              tokens_used: event.tokens_used,
            });
            return {
              ...prev,
              phase: 'done',
              result: {
                kind: 'done',
                result: event.result,
                stepsUsed: event.steps_used,
                tokensUsed: event.tokens_used,
              },
            };

          case 'task_failed':
            log.warn('Pill.task_failed', {
              task_id: event.task_id,
              reason: event.reason,
            });
            return {
              ...prev,
              phase: 'error',
              result: { kind: 'failed', reason: event.reason },
            };

          case 'target_lost':
            log.warn('Pill.target_lost', {
              task_id: event.task_id,
              target_id: event.target_id,
            });
            return {
              ...prev,
              phase: 'error',
              result: { kind: 'target_lost' },
            };

          case 'task_cancelled':
            log.info('Pill.task_cancelled', { task_id: event.task_id });
            return {
              ...prev,
              phase: 'error',
              result: { kind: 'cancelled' },
            };

          default:
            return prev;
        }
      });
    });

    const unsubHide = window.pillAPI.onHideRequest(() => {
      log.info('Pill.onHideRequest', { message: 'Main requested hide — resetting pill' });
      setState(INITIAL_STATE);
      setIsFocused(false);
    });

    const unsubQueued = window.pillAPI.onQueuedTask((data) => {
      log.info('Pill.onQueuedTask', {
        message: 'Task queued while another is running',
        task_id: data.task_id,
      });
      setState((prev) => ({ ...prev, queuedTask: data.prompt }));
    });

    return () => {
      log.info('Pill.unmount', { message: 'Pill component unmounting — unsubscribing' });
      unsubEvent();
      unsubHide();
      unsubQueued();
    };
  }, []);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleSubmit = useCallback(async (prompt: string) => {
    log.info('Pill.handleSubmit', {
      message: 'Submitting prompt',
      promptLength: prompt.length,
      currentPhase: stateRef.current.phase,
    });

    setState((prev) => ({
      ...prev,
      phase: 'submitting',
      isStarting: true,
      inputValue: prompt, // keep prompt visible while streaming
      steps: [],
      result: null,
      queuedTask: null,
    }));
    setIsFocused(false);

    try {
      const { task_id } = await window.pillAPI.submit(prompt);
      log.info('Pill.handleSubmit.submitted', {
        message: 'Task submitted successfully',
        task_id,
      });
      setState((prev) => ({
        ...prev,
        activeTaskId: task_id,
        phase: 'submitting',
      }));
    } catch (err) {
      log.error('Pill.handleSubmit.error', {
        message: 'Failed to submit task',
        error: (err as Error).message,
      });
      setState((prev) => ({
        ...prev,
        phase: 'error',
        isStarting: false,
        result: { kind: 'failed', reason: 'submit_error' },
      }));
    }
  }, []);

  const handleEscape = useCallback(() => {
    log.info('Pill.handleEscape', {
      message: 'Escape pressed — hiding pill',
      phase: stateRef.current.phase,
    });
    setState(INITIAL_STATE);
    setIsFocused(false);
    window.pillAPI.hide();
  }, []);

  const handleDismiss = useCallback(() => {
    log.info('Pill.handleDismiss', {
      message: 'Auto-dismiss triggered — hiding pill',
    });
    setState(INITIAL_STATE);
    setIsFocused(false);
    window.pillAPI.hide();
  }, []);

  // -------------------------------------------------------------------------
  // Derived booleans
  // -------------------------------------------------------------------------

  const isInputDisabled =
    state.phase === 'submitting' || state.phase === 'running';
  const showToast =
    state.phase === 'submitting' || state.phase === 'running';
  const showResult =
    (state.phase === 'done' || state.phase === 'error') && state.result !== null;

  // ↵ chip: show when idle/focused + has text
  const showSubmitChip =
    (state.phase === 'idle') && state.inputValue.trim().length > 0;

  // ⌘C chip: show when done
  const showCopyChip = state.phase === 'done';

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      className="pill-container"
      data-state={dataState}
      data-phase={state.phase}
      data-testid="pill-container"
      onFocus={() => {
        if (state.phase === 'idle') setIsFocused(true);
      }}
      onBlur={() => setIsFocused(false)}
    >
      <PillInput
        value={state.inputValue}
        onChange={(v) => setState((prev) => ({ ...prev, inputValue: v }))}
        onSubmit={handleSubmit}
        onEscape={handleEscape}
        disabled={isInputDisabled}
        leadingSlot={<LeadingDot state={dataState} />}
        showSubmitChip={showSubmitChip}
        showCopyChip={showCopyChip}
      />

      {(showToast || showResult) && (
        <div className="pill-divider" aria-hidden="true" />
      )}

      {showToast && (
        <ProgressToast
          steps={state.steps}
          isStarting={state.isStarting}
          taskId={state.activeTaskId}
        />
      )}

      {showResult && state.result !== null && (
        <ResultDisplay
          state={state.result}
          onDismiss={handleDismiss}
          autoDismissMs={AUTO_DISMISS_MS}
        />
      )}

      {state.queuedTask && (
        <div className="pill-toast" style={{ paddingTop: 4 }}>
          <span className="pill-queued-badge">
            Next: {state.queuedTask}
          </span>
        </div>
      )}
    </div>
  );
}
