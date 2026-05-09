export interface AppPopupAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AppPopupPlacement =
  | 'bottom-start'
  | 'bottom-end'
  | 'top-start'
  | 'top-end'
  | 'right-start'
  | 'left-start';

export type AppPopupMenuIcon =
  | { type: 'editor'; id: string }
  | { type: 'finder' };

export interface AppPopupMenuItem {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  checked?: boolean;
  tone?: 'normal' | 'danger';
  icon?: AppPopupMenuIcon;
  separatorBefore?: boolean;
}

interface AppPopupOpenBase {
  id?: string;
  anchor: AppPopupAnchorRect;
  placement?: AppPopupPlacement;
  width?: number;
  height?: number;
  maxHeight?: number;
}

export interface AppPopupMenuRequest extends AppPopupOpenBase {
  kind: 'menu';
  items: AppPopupMenuItem[];
}

export interface AppPopupEnginePickerRequest extends AppPopupOpenBase {
  kind: 'engine-picker';
  value: string;
}

export interface AppPopupBrowserCodeModelPickerRequest extends AppPopupOpenBase {
  kind: 'browsercode-model-picker';
}

export interface AppPopupMemoryIndicatorRequest extends AppPopupOpenBase {
  kind: 'memory-indicator';
}

export type AppPopupOpenRequest =
  | AppPopupMenuRequest
  | AppPopupEnginePickerRequest
  | AppPopupBrowserCodeModelPickerRequest
  | AppPopupMemoryIndicatorRequest;

export interface AppPopupOpenResult {
  id: string;
}

export type AppPopupAction =
  | {
      popupId: string;
      kind: 'menu-select';
      itemId: string;
      close?: boolean;
    }
  | {
      popupId: string;
      kind: 'engine-select';
      engineId: string;
      close?: boolean;
    }
  | {
      popupId: string;
      kind: 'browsercode-model-changed';
      close?: boolean;
    };

export interface AppPopupClosed {
  popupId: string;
  reason: 'action' | 'blur' | 'escape' | 'request' | 'owner-destroyed' | 'replaced' | 'app-deactivated';
}

export interface AppPopupContentSize {
  popupId: string;
  width: number;
  height: number;
}
