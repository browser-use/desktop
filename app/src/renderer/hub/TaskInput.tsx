import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { INPUT_PLACEHOLDER } from './constants';
import { EnginePicker, EngineLogo } from './EnginePicker';

const ENGINE_DISPLAY_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  browsercode: 'BrowserCode',
};
import {
  classifyAttachmentMime,
  maxBytesForAttachmentMime,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_TOTAL_ATTACHMENT_BYTES,
  formatBytes,
} from '../../shared/attachments';

export interface TaskInputAttachment {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface TaskInputSubmission {
  prompt: string;
  attachments: TaskInputAttachment[];
  engine: string;
}

interface TaskInputProps {
  onSubmit: (input: TaskInputSubmission) => void;
  /** Optional content rendered inside the input box, above the textarea
   *  and below the chips row. Used by the chat composer to host the quoted-
   *  text preview so it visually extends the box rather than floating
   *  awkwardly above it. */
  topSlot?: React.ReactNode;
  /** When supplied, the engine picker is hidden and submissions report this
   *  engine id. Used by the chat composer on existing sessions because the
   *  backend's resume path is hard-locked to `getSessionEngine(id)` — showing
   *  a picker would imply you could switch mid-session, which you cannot. */
  lockedEngine?: string;
}

const ENGINE_STORAGE_KEY = 'hub.selectedEngine';
const DEFAULT_ENGINE = 'claude-code';

function loadStoredEngine(): string {
  try {
    const v = localStorage.getItem(ENGINE_STORAGE_KEY);
    return v && v.length > 0 ? v : DEFAULT_ENGINE;
  } catch {
    return DEFAULT_ENGINE;
  }
}

export interface TaskInputHandle {
  addFiles: (files: FileList | File[]) => Promise<void>;
  focus: () => void;
  setText: (text: string) => void;
}

function ArrowUpIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 12V3M3 6.5L7 2.5L11 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PaperclipIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M9.5 3.5L4.5 8.5a2 2 0 1 0 2.83 2.83L11.5 7.5a3 3 0 0 0-4.24-4.24L2.5 8.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon(): React.ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

export const TaskInput = forwardRef<TaskInputHandle, TaskInputProps>(function TaskInput({ onSubmit, topSlot, lockedEngine }, ref) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [attachments, setAttachments] = useState<TaskInputAttachment[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [engine, setEngine] = useState<string>(() => loadStoredEngine());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    const maxHeight = Number.parseFloat(window.getComputedStyle(textarea).maxHeight);
    const nextHeight = Number.isFinite(maxHeight) && maxHeight > 0
      ? Math.min(textarea.scrollHeight, maxHeight)
      : textarea.scrollHeight;

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > nextHeight + 1 ? 'auto' : 'hidden';
  }, []);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [resizeTextarea, value]);

  useEffect(() => {
    window.addEventListener('resize', resizeTextarea);
    return () => window.removeEventListener('resize', resizeTextarea);
  }, [resizeTextarea]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setErrorMsg(null);
    const list = Array.from(files);
    const next = [...attachments];
    let total = next.reduce((s, a) => s + a.bytes.byteLength, 0);
    for (const f of list) {
      if (next.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
        setErrorMsg(`Max ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`);
        break;
      }
      const mime = f.type || 'application/octet-stream';
      const kind = classifyAttachmentMime(mime);
      const max = maxBytesForAttachmentMime(mime);
      if (f.size > max) {
        setErrorMsg(`${f.name} is ${formatBytes(f.size)} — exceeds ${formatBytes(max)} ${kind} limit`);
        continue;
      }
      if (f.size === 0) {
        setErrorMsg(`${f.name} is empty`);
        continue;
      }
      if (total + f.size > MAX_TOTAL_ATTACHMENT_BYTES) {
        setErrorMsg(`Total size would exceed ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)}`);
        break;
      }
      const bytes = await readFileBytes(f);
      next.push({ name: f.name, mime, bytes });
      total += f.size;
      console.log('[TaskInput] attach', { name: f.name, mime, size: f.size });
    }
    setAttachments(next);
  }, [attachments]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed && attachments.length === 0) return;
    console.log('[TaskInput] submit', { promptLength: trimmed.length, attachmentCount: attachments.length });
    onSubmit({ prompt: trimmed, attachments, engine: lockedEngine ?? engine });
    setValue('');
    setAttachments([]);
    setErrorMsg(null);
    textareaRef.current?.focus();
  }, [value, attachments, engine, lockedEngine, onSubmit]);

  const onEngineChange = useCallback((id: string) => {
    setEngine(id);
    try { localStorage.setItem(ENGINE_STORAGE_KEY, id); } catch { /* ignore */ }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        textareaRef.current?.blur();
      }
    },
    [submit],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        void addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback(() => setDragActive(false), []);

  const canSubmit = value.trim().length > 0 || attachments.length > 0;

  useImperativeHandle(ref, () => ({
    addFiles: (files) => addFiles(files),
    focus: () => textareaRef.current?.focus(),
    setText: (text: string) => {
      setValue(text);
      // Focus and move caret to end on the next frame so the height resize
      // (driven by the value-dep effect) has run before we measure.
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        const end = text.length;
        ta.setSelectionRange(end, end);
      });
    },
  }), [addFiles]);

  const focusTextareaOnBoxClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      textareaRef.current?.focus();
    }
  }, []);

  return (
    <div className="task-input">
      <div
        className={`task-input__box${focused ? ' task-input__box--focused' : ''}${dragActive ? ' task-input__box--drag' : ''}`}
        onClick={focusTextareaOnBoxClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        {attachments.length > 0 && (
          <div className="task-input__chips">
            {attachments.map((a, i) => (
              <span key={`${a.name}-${i}`} className="task-input__chip" title={`${a.mime} · ${formatBytes(a.bytes.byteLength)}`}>
                <span className="task-input__chip-name">{a.name}</span>
                <span className="task-input__chip-size">{formatBytes(a.bytes.byteLength)}</span>
                <button
                  type="button"
                  className="task-input__chip-remove"
                  onClick={() => removeAttachment(i)}
                  aria-label={`Remove ${a.name}`}
                >
                  <CloseIcon />
                </button>
              </span>
            ))}
          </div>
        )}
        {topSlot}
        {errorMsg && <div className="task-input__error">{errorMsg}</div>}
        <textarea
          ref={textareaRef}
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
        <div className="task-input__actions" onClick={focusTextareaOnBoxClick}>
          <button
            type="button"
            className="task-input__attach has-tooltip"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files"
            data-tooltip="Attach files"
          >
            <PaperclipIcon />
          </button>
          {lockedEngine
            ? (
              <span
                className="engine-picker engine-picker--locked has-tooltip"
                data-tooltip={`Engine can't be changed mid-run - locked to ${ENGINE_DISPLAY_NAMES[lockedEngine] ?? lockedEngine} for this session`}
              >
                <span className="engine-picker__toggle engine-picker__toggle--readonly">
                  <EngineLogo id={lockedEngine} />
                  <span className="engine-picker__name">{ENGINE_DISPLAY_NAMES[lockedEngine] ?? lockedEngine}</span>
                </span>
              </span>
            )
            : <EnginePicker value={engine} onChange={onEngineChange} />
          }
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            className="task-input__send"
            onClick={submit}
            disabled={!canSubmit}
            aria-label="Start agent"
            title="Start agent (Enter)"
          >
            <ArrowUpIcon />
          </button>
        </div>
      </div>
    </div>
  );
});

export default TaskInput;
