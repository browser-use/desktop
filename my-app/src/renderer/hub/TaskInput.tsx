import React, { useCallback, useRef, useState } from 'react';
import { INPUT_PLACEHOLDER } from './constants';

interface TaskInputProps {
  onSubmit: (prompt: string) => void;
}

function ArrowUpIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 12V3M3 6.5L7 2.5L11 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TaskInput({ onSubmit }: TaskInputProps): React.ReactElement {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    console.log('[TaskInput] submit', { prompt: trimmed });
    onSubmit(trimmed);
    setValue('');
    ref.current?.focus();
  }, [value, onSubmit]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    <div className="task-input">
      <div className={`task-input__box${focused ? ' task-input__box--focused' : ''}`}>
        <textarea
          ref={ref}
          className="task-input__textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={INPUT_PLACEHOLDER}
          rows={1}
          aria-label="New agent task"
        />
        <button
          className="task-input__send"
          onClick={submit}
          disabled={!value.trim()}
          aria-label="Start agent"
          title="Start agent (Enter)"
        >
          <ArrowUpIcon />
        </button>
      </div>
      <span className="task-input__hint">
        <kbd className="task-input__kbd">Enter</kbd> to send
        <span className="task-input__hint-sep" />
        <kbd className="task-input__kbd">Shift+Enter</kbd> for newline
      </span>
    </div>
  );
}

export default TaskInput;
