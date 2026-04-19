import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  formatKeyForDisplay,
  CATEGORY_ORDER,
  DEFAULT_KEYBINDINGS,
  type ActionId,
  type KeyBinding,
  type KeyBindingOverrides,
  type KeyCategory,
} from './keybindings';

interface SettingsPaneProps {
  open: boolean;
  onClose: () => void;
  keybindings: KeyBinding[];
  overrides: KeyBindingOverrides;
  onUpdateBinding: (id: ActionId, keys: string) => void;
  onResetBinding: (id: ActionId) => void;
  onResetAll: () => void;
}

function groupByCategory(bindings: KeyBinding[]): Map<KeyCategory, KeyBinding[]> {
  const groups = new Map<KeyCategory, KeyBinding[]>();
  for (const cat of CATEGORY_ORDER) {
    const items = bindings.filter((b) => b.category === cat);
    if (items.length > 0) groups.set(cat, items);
  }
  return groups;
}

function captureKeyCombo(e: KeyboardEvent): string | null {
  if (e.key === 'Escape' || e.key === 'Tab') return null;

  const parts: string[] = [];
  if (e.metaKey) parts.push('meta');
  if (e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey && e.key.length > 1) parts.push('shift');

  let key = e.key.toLowerCase();
  if (e.shiftKey && key.length === 1) {
    parts.push('shift');
  }
  if (key === ' ') key = 'space';
  if (key === 'control' || key === 'meta' || key === 'alt' || key === 'shift') return null;

  parts.push(key);
  return parts.join('+');
}

function isModified(id: ActionId, overrides: KeyBindingOverrides): boolean {
  return id in overrides;
}

function getDefault(id: ActionId): string {
  const def = DEFAULT_KEYBINDINGS.find((b) => b.id === id);
  return def ? def.keys : '';
}

function RecordingRow({
  binding,
  overrides,
  onUpdate,
  onReset,
}: {
  binding: KeyBinding;
  overrides: KeyBindingOverrides;
  onUpdate: (id: ActionId, keys: string) => void;
  onReset: (id: ActionId) => void;
}): React.ReactElement {
  const [recording, setRecording] = useState(false);
  const [firstKey, setFirstKey] = useState<string | null>(null);
  const cellRef = useRef<HTMLButtonElement>(null);
  const modified = isModified(binding.id, overrides);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!recording) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecording(false);
        setFirstKey(null);
        if (timerRef.current) clearTimeout(timerRef.current);
        return;
      }

      const combo = captureKeyCombo(e);
      if (!combo) return;

      if (firstKey) {
        if (timerRef.current) clearTimeout(timerRef.current);
        onUpdate(binding.id, `${firstKey} ${combo}`);
        setRecording(false);
        setFirstKey(null);
        return;
      }

      if (!e.metaKey && !e.ctrlKey && !e.altKey && combo.length <= 8) {
        setFirstKey(combo);
        timerRef.current = setTimeout(() => {
          onUpdate(binding.id, combo);
          setRecording(false);
          setFirstKey(null);
        }, 800);
        return;
      }

      onUpdate(binding.id, combo);
      setRecording(false);
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recording, firstKey, binding.id, onUpdate]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className={`settings__row${modified ? ' settings__row--modified' : ''}`}>
      <span className="settings__row-label">{binding.label}</span>
      <div className="settings__row-keys">
        <button
          ref={cellRef}
          className={`settings__key-cell${recording ? ' settings__key-cell--recording' : ''}`}
          onClick={() => {
            setRecording(true);
            setFirstKey(null);
          }}
          title="Click to rebind"
        >
          {recording ? (
            <span className="settings__recording-text">
              {firstKey ? `${formatKeyForDisplay(firstKey)} + ...` : 'Press key...'}
            </span>
          ) : (
            formatKeyForDisplay(binding.keys).split(' ').map((part, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="settings__then">then</span>}
                <kbd className="settings__kbd">{part}</kbd>
              </React.Fragment>
            ))
          )}
        </button>
        {modified && (
          <button
            className="settings__reset-btn"
            onClick={() => onReset(binding.id)}
            title={`Reset to default (${formatKeyForDisplay(getDefault(binding.id))})`}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 4.5h4a3 3 0 010 6h-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4.5 2.5L2.5 4.5 4.5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

export function SettingsPane({
  open,
  onClose,
  keybindings,
  overrides,
  onUpdateBinding,
  onResetBinding,
  onResetAll,
}: SettingsPaneProps): React.ReactElement | null {
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const filtered = useCallback(() => {
    if (!search.trim()) return keybindings;
    const q = search.toLowerCase();
    return keybindings.filter(
      (b) =>
        b.label.toLowerCase().includes(q) ||
        b.category.toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q)
    );
  }, [keybindings, search]);

  if (!open) return null;

  const groups = new Map<KeyCategory, KeyBinding[]>();
  for (const cat of CATEGORY_ORDER) {
    const items = filtered().filter((b) => b.category === cat);
    if (items.length > 0) groups.set(cat, items);
  }

  const hasOverrides = Object.keys(overrides).length > 0;

  return (
    <div className="settings-pane__scrim" onClick={onClose}>
      <div className="settings-pane" onClick={(e) => e.stopPropagation()}>
        <div className="settings-pane__header">
          <span className="settings-pane__title">Keybindings</span>
          <div className="settings-pane__header-right">
            {hasOverrides && (
              <button className="settings-pane__reset-all" onClick={onResetAll}>
                Reset all
              </button>
            )}
            <button className="settings-pane__close" onClick={onClose} aria-label="Close settings">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="settings-pane__search">
          <input
            ref={searchRef}
            className="settings-pane__search-input"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search keybindings..."
          />
        </div>

        <div className="settings-pane__body">
          {Array.from(groups.entries()).map(([category, bindings]) => (
            <div key={category} className="settings__group">
              <span className="settings__group-title">{category}</span>
              {bindings.map((binding) => (
                <RecordingRow
                  key={binding.id}
                  binding={binding}
                  overrides={overrides}
                  onUpdate={onUpdateBinding}
                  onReset={onResetBinding}
                />
              ))}
            </div>
          ))}
          {groups.size === 0 && (
            <div className="settings__empty">No matching keybindings</div>
          )}
        </div>

        <div className="settings-pane__footer">
          <span className="settings-pane__footer-hint">
            Click a binding to record a new key. Press <kbd className="settings__kbd">Esc</kbd> to cancel.
          </span>
        </div>
      </div>
    </div>
  );
}

export default SettingsPane;
