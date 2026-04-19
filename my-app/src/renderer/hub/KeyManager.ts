import type { ActionId, KeyBinding } from './keybindings';

const CHORD_TIMEOUT_MS = 500;

type ActionHandler = () => void;

interface ParsedKey {
  key: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

function parseKeyString(raw: string): ParsedKey {
  const parts = raw.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  return {
    key,
    meta: parts.includes('meta'),
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
  };
}

function eventMatchesParsed(e: KeyboardEvent, parsed: ParsedKey): boolean {
  const eventKey = e.key.toLowerCase();
  const keyMatch = eventKey === parsed.key
    || (parsed.key === '/' && eventKey === '/')
    || (parsed.key === '.' && eventKey === '.');

  if (!keyMatch) return false;
  if (parsed.meta && !e.metaKey) return false;
  if (parsed.ctrl && !e.ctrlKey) return false;
  if (parsed.shift && !e.shiftKey) return false;
  if (parsed.alt && !e.altKey) return false;

  if (!parsed.meta && !parsed.ctrl && !parsed.shift && !parsed.alt) {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
  }

  return true;
}

interface BindingEntry {
  id: ActionId;
  sequence: ParsedKey[];
}

export class KeyManager {
  private bindings: BindingEntry[] = [];
  private handlers = new Map<ActionId, ActionHandler>();
  private pendingChord: ParsedKey | null = null;
  private chordTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled = true;
  private chordDisplay: ((prefix: string | null) => void) | null = null;

  constructor(keybindings: KeyBinding[]) {
    this.setBindings(keybindings);
  }

  setBindings(keybindings: KeyBinding[]): void {
    this.bindings = keybindings.map((kb) => {
      const parts = kb.keys.split(' ').map((p) => parseKeyString(p));
      return { id: kb.id, sequence: parts };
    });
  }

  on(action: ActionId, handler: ActionHandler): void {
    this.handlers.set(action, handler);
  }

  off(action: ActionId): void {
    this.handlers.delete(action);
  }

  onChordDisplay(cb: (prefix: string | null) => void): void {
    this.chordDisplay = cb;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clearChord();
    }
  }

  handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;

    if (this.isInputFocused() && !this.isEscapeOrModified(e)) {
      return;
    }

    if (this.pendingChord) {
      const matched = this.matchChord(e);
      if (matched) {
        e.preventDefault();
        e.stopPropagation();
        this.clearChord();
        const handler = this.handlers.get(matched);
        if (handler) handler();
        return;
      }
      this.clearChord();
    }

    const chordStarters = this.bindings.filter(
      (b) => b.sequence.length === 2 && eventMatchesParsed(e, b.sequence[0])
    );

    if (chordStarters.length > 0 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      this.pendingChord = chordStarters[0].sequence[0];
      this.chordDisplay?.(e.key.toUpperCase());
      this.chordTimer = setTimeout(() => {
        this.clearChord();
      }, CHORD_TIMEOUT_MS);
      return;
    }

    const singleMatch = this.bindings.find(
      (b) => b.sequence.length === 1 && eventMatchesParsed(e, b.sequence[0])
    );

    if (singleMatch) {
      const handler = this.handlers.get(singleMatch.id);
      if (handler) {
        if (singleMatch.id !== 'meta.escape') {
          e.preventDefault();
        }
        handler();
      }
    }
  };

  private matchChord(e: KeyboardEvent): ActionId | null {
    for (const binding of this.bindings) {
      if (binding.sequence.length !== 2) continue;
      if (!this.pendingChord) continue;
      const firstMatch =
        binding.sequence[0].key === this.pendingChord.key
        && binding.sequence[0].shift === this.pendingChord.shift;
      if (!firstMatch) continue;
      if (eventMatchesParsed(e, binding.sequence[1])) {
        return binding.id;
      }
    }
    return null;
  }

  private clearChord(): void {
    this.pendingChord = null;
    if (this.chordTimer) {
      clearTimeout(this.chordTimer);
      this.chordTimer = null;
    }
    this.chordDisplay?.(null);
  }

  private isInputFocused(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if ((el as HTMLElement).isContentEditable) return true;
    return false;
  }

  private isEscapeOrModified(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') return true;
    if (e.metaKey || e.ctrlKey) return true;
    return false;
  }

  destroy(): void {
    this.clearChord();
    this.handlers.clear();
    this.chordDisplay = null;
  }
}
