import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { KeyManager } from './KeyManager';
import {
  resolveKeybindings,
  loadUserOverrides,
  saveUserOverrides,
  type ActionId,
  type KeyBindingOverrides,
  type KeyBinding,
} from './keybindings';

export interface VimKeysState {
  chordPrefix: string | null;
  keybindings: KeyBinding[];
  overrides: KeyBindingOverrides;
  updateBinding: (id: ActionId, keys: string) => void;
  resetBinding: (id: ActionId) => void;
  resetAll: () => void;
}

export function useVimKeys(
  handlers: Partial<Record<ActionId, () => void>>
): VimKeysState {
  const [overrides, setOverrides] = useState<KeyBindingOverrides>(loadUserOverrides);
  const [chordPrefix, setChordPrefix] = useState<string | null>(null);

  const keybindings = useMemo(() => resolveKeybindings(overrides), [overrides]);

  const managerRef = useRef<KeyManager | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const manager = new KeyManager(keybindings);
    managerRef.current = manager;

    manager.onChordDisplay(setChordPrefix);

    const actionIds = keybindings.map((kb) => kb.id);
    for (const id of actionIds) {
      manager.on(id, () => {
        const handler = handlersRef.current[id];
        if (handler) handler();
      });
    }

    window.addEventListener('keydown', manager.handleKeyDown);
    return () => {
      window.removeEventListener('keydown', manager.handleKeyDown);
      manager.destroy();
      managerRef.current = null;
    };
  }, [keybindings]);

  const updateBinding = useCallback((id: ActionId, keys: string) => {
    setOverrides((prev) => {
      const next = { ...prev, [id]: keys };
      saveUserOverrides(next);
      return next;
    });
  }, []);

  const resetBinding = useCallback((id: ActionId) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      saveUserOverrides(next);
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    setOverrides({});
    saveUserOverrides({});
  }, []);

  return {
    chordPrefix,
    keybindings,
    overrides,
    updateBinding,
    resetBinding,
    resetAll,
  };
}
