import React from 'react';
import { ConnectionsPane } from './ConnectionsPane';
import type { ActionId, KeyBinding } from './keybindings';

interface SettingsPaneProps {
  open: boolean;
  onClose: () => void;
  keybindings: KeyBinding[];
  overrides: Record<string, string[]>;
  onUpdateBinding: (id: ActionId, keys: string[]) => void;
  onResetBinding: (id: ActionId) => void;
  onResetAll: () => void;
}

export function SettingsPane({ open, onClose, keybindings, overrides, onResetAll }: SettingsPaneProps): React.ReactElement | null {
  if (!open) return null;

  return (
    <div className="settings-pane__scrim" onClick={onClose}>
      <div className="settings-pane" onClick={(e) => e.stopPropagation()}>
        <div className="settings-pane__header">
          <span className="settings-pane__title">Settings</span>
          <button className="settings-pane__close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="settings-pane__body">
          <div className="settings-pane__section">
            <span className="settings-pane__section-title">Connections</span>
            <ConnectionsPane embedded />
          </div>
          <div className="settings-pane__section">
            <span className="settings-pane__section-title">Keybindings</span>
            {keybindings.map((kb) => {
              const isOverridden = kb.id in overrides;
              return (
                <div key={kb.id} className="settings-pane__row">
                  <span className="settings-pane__label">{kb.label}</span>
                  <span className="settings-pane__keys">
                    {kb.keys.map((k, i) => (
                      <kbd key={i} className="settings-pane__kbd">{k}</kbd>
                    ))}
                    {isOverridden && <span className="settings-pane__modified">modified</span>}
                  </span>
                </div>
              );
            })}
          </div>
          {Object.keys(overrides).length > 0 && (
            <button className="settings-pane__reset" onClick={onResetAll}>Reset all to defaults</button>
          )}
        </div>
      </div>
    </div>
  );
}
