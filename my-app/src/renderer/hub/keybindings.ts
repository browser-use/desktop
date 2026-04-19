export type ActionId =
  | 'nav.down'
  | 'nav.up'
  | 'nav.top'
  | 'nav.bottom'
  | 'nav.open'
  | 'nav.select'
  | 'nav.back'
  | 'nav.forward'
  | 'scroll.halfDown'
  | 'scroll.halfUp'
  | 'scroll.viewTop'
  | 'scroll.viewMiddle'
  | 'scroll.viewBottom'
  | 'scroll.center'
  | 'goto.dashboard'
  | 'goto.agents'
  | 'goto.settings'
  | 'goto.history'
  | 'goto.list'
  | 'search.open'
  | 'search.next'
  | 'search.prev'
  | 'search.clear'
  | 'action.create'
  | 'action.delete'
  | 'action.status'
  | 'action.rename'
  | 'action.label'
  | 'action.assign'
  | 'action.edit'
  | 'action.copy'
  | 'action.repeat'
  | 'action.undo'
  | 'meta.help'
  | 'meta.commandPalette'
  | 'meta.escape';

export type KeyCategory =
  | 'Navigation'
  | 'Goto'
  | 'Scroll'
  | 'Search'
  | 'Actions'
  | 'Meta';

export interface KeyBinding {
  id: ActionId;
  keys: string;
  label: string;
  category: KeyCategory;
}

export const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  // Navigation
  { id: 'nav.down', keys: 'j', label: 'Move down', category: 'Navigation' },
  { id: 'nav.up', keys: 'k', label: 'Move up', category: 'Navigation' },
  { id: 'nav.top', keys: 'g g', label: 'Jump to top', category: 'Navigation' },
  { id: 'nav.bottom', keys: 'shift+g', label: 'Jump to bottom', category: 'Navigation' },
  { id: 'nav.open', keys: 'enter', label: 'Open item', category: 'Navigation' },
  { id: 'nav.select', keys: 'x', label: 'Toggle select', category: 'Navigation' },
  { id: 'nav.back', keys: 'ctrl+o', label: 'Navigate back', category: 'Navigation' },
  { id: 'nav.forward', keys: 'ctrl+i', label: 'Navigate forward', category: 'Navigation' },

  // Goto (chord sequences)
  { id: 'goto.dashboard', keys: 'g d', label: 'Go to Dashboard', category: 'Goto' },
  { id: 'goto.agents', keys: 'g a', label: 'Go to Agents', category: 'Goto' },
  { id: 'goto.settings', keys: 'g s', label: 'Go to Settings', category: 'Goto' },
  { id: 'goto.history', keys: 'g h', label: 'Go to History', category: 'Goto' },
  { id: 'goto.list', keys: 'g l', label: 'Go to List view', category: 'Goto' },

  // Scroll
  { id: 'scroll.halfDown', keys: 'ctrl+d', label: 'Scroll half page down', category: 'Scroll' },
  { id: 'scroll.halfUp', keys: 'ctrl+u', label: 'Scroll half page up', category: 'Scroll' },
  { id: 'scroll.viewTop', keys: 'shift+h', label: 'Jump to top of viewport', category: 'Scroll' },
  { id: 'scroll.viewMiddle', keys: 'shift+m', label: 'Jump to middle of viewport', category: 'Scroll' },
  { id: 'scroll.viewBottom', keys: 'shift+l', label: 'Jump to bottom of viewport', category: 'Scroll' },
  { id: 'scroll.center', keys: 'z z', label: 'Center focused item', category: 'Scroll' },

  // Search
  { id: 'search.open', keys: '/', label: 'Open search', category: 'Search' },
  { id: 'search.next', keys: 'n', label: 'Next result', category: 'Search' },
  { id: 'search.prev', keys: 'shift+n', label: 'Previous result', category: 'Search' },
  { id: 'search.clear', keys: 'ctrl+/', label: 'Clear search', category: 'Search' },

  // Actions
  { id: 'action.create', keys: 'c', label: 'Create session', category: 'Actions' },
  { id: 'action.delete', keys: 'd d', label: 'Delete / stop session', category: 'Actions' },
  { id: 'action.status', keys: 's', label: 'Change status', category: 'Actions' },
  { id: 'action.rename', keys: 'r', label: 'Rename session', category: 'Actions' },
  { id: 'action.label', keys: 'l', label: 'Add label', category: 'Actions' },
  { id: 'action.assign', keys: 'a', label: 'Assign agent', category: 'Actions' },
  { id: 'action.edit', keys: 'e', label: 'Edit prompt', category: 'Actions' },
  { id: 'action.copy', keys: 'y y', label: 'Copy session ID', category: 'Actions' },
  { id: 'action.repeat', keys: '.', label: 'Repeat last action', category: 'Actions' },
  { id: 'action.undo', keys: 'u', label: 'Undo', category: 'Actions' },

  // Meta
  { id: 'meta.help', keys: '?', label: 'Show keyboard shortcuts', category: 'Meta' },
  { id: 'meta.commandPalette', keys: 'meta+k', label: 'Command palette', category: 'Meta' },
  { id: 'meta.escape', keys: 'escape', label: 'Dismiss / go back', category: 'Meta' },
];

export type KeyBindingOverrides = Partial<Record<ActionId, string>>;

const STORAGE_KEY = 'hub-keybindings';

export function loadUserOverrides(): KeyBindingOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as KeyBindingOverrides;
  } catch {
    return {};
  }
}

export function saveUserOverrides(overrides: KeyBindingOverrides): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export function resolveKeybindings(overrides: KeyBindingOverrides): KeyBinding[] {
  return DEFAULT_KEYBINDINGS.map((binding) => {
    const override = overrides[binding.id];
    if (override !== undefined) {
      return { ...binding, keys: override };
    }
    return binding;
  });
}

export function formatKeyForDisplay(keys: string): string {
  return keys
    .split(' ')
    .map((part) => {
      return part
        .split('+')
        .map((k) => {
          switch (k) {
            case 'meta': return navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl';
            case 'ctrl': return navigator.platform.includes('Mac') ? '\u2303' : 'Ctrl';
            case 'shift': return '\u21E7';
            case 'alt': return navigator.platform.includes('Mac') ? '\u2325' : 'Alt';
            case 'enter': return '\u21B5';
            case 'escape': return 'Esc';
            case '/': return '/';
            case '.': return '.';
            default: return k.toUpperCase();
          }
        })
        .join('');
    })
    .join(' ');
}

export const CATEGORY_ORDER: KeyCategory[] = [
  'Navigation',
  'Goto',
  'Search',
  'Actions',
  'Scroll',
  'Meta',
];
