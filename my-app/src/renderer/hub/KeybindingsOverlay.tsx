import React, { useEffect, useRef } from 'react';
import { formatKeyForDisplay, CATEGORY_ORDER, type KeyBinding, type KeyCategory } from './keybindings';

interface KeybindingsOverlayProps {
  open: boolean;
  onClose: () => void;
  keybindings: KeyBinding[];
  onOpenSettings: () => void;
}

function groupByCategory(bindings: KeyBinding[]): Map<KeyCategory, KeyBinding[]> {
  const groups = new Map<KeyCategory, KeyBinding[]>();
  for (const cat of CATEGORY_ORDER) {
    const items = bindings.filter((b) => b.category === cat);
    if (items.length > 0) groups.set(cat, items);
  }
  return groups;
}

export function KeybindingsOverlay({
  open,
  onClose,
  keybindings,
  onOpenSettings,
}: KeybindingsOverlayProps): React.ReactElement | null {
  const ref = useRef<HTMLDivElement>(null);

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

  if (!open) return null;

  const groups = groupByCategory(keybindings);

  return (
    <div className="keys-overlay__scrim" onClick={onClose}>
      <div className="keys-overlay" ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="keys-overlay__header">
          <span className="keys-overlay__title">Keyboard shortcuts</span>
          <button className="keys-overlay__settings-btn" onClick={onOpenSettings}>
            Customize
          </button>
        </div>
        <div className="keys-overlay__body">
          {Array.from(groups.entries()).map(([category, bindings]) => (
            <div key={category} className="keys-overlay__group">
              <span className="keys-overlay__group-title">{category}</span>
              <div className="keys-overlay__list">
                {bindings.map((binding) => (
                  <div key={binding.id} className="keys-overlay__row">
                    <span className="keys-overlay__label">{binding.label}</span>
                    <span className="keys-overlay__keys">
                      {formatKeyForDisplay(binding.keys).split(' ').map((part, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && <span className="keys-overlay__then">then</span>}
                          <kbd className="keys-overlay__kbd">{part}</kbd>
                        </React.Fragment>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="keys-overlay__footer">
          <span className="keys-overlay__hint">Press <kbd className="keys-overlay__kbd">Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}

export default KeybindingsOverlay;
