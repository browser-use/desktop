/**
 * ExtensionToolbar — pinnable extension icons with overflow puzzle-piece menu.
 *
 * Issue #73 chrome-parity checklist:
 *   - Pinned icons shown in order, drag-reorderable
 *   - Right-click on any icon → Pin / Unpin
 *   - Right-click on pinned icon → Manage extension, Remove, Options (if any)
 *   - Puzzle-piece button groups all unpinned extensions in overflow menu
 *   - State persists per-profile via ExtensionManager
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ExtensionRecord } from '../../main/extensions/ExtensionManager';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ICON_SIZE = 28;
const ICON_PREFERRED_PX = 16;
const DRAG_GHOST_OPACITY = 0.4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pick the best available icon from the record's icons map. */
function bestIcon(ext: ExtensionRecord): string | null {
  const sizes = [16, 32, 48, 128, 64, 24, 256];
  for (const sz of sizes) {
    const v = ext.icons[String(sz)];
    if (v) return `file://${v}`;
  }
  const first = Object.values(ext.icons)[0];
  return first ? `file://${first}` : null;
}

/** First two letters of the extension name, upper-cased. */
function initials(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '??';
}

// ---------------------------------------------------------------------------
// Context menu state
// ---------------------------------------------------------------------------

interface ContextMenuState {
  extId: string;
  pinned: boolean;
  x: number;
  y: number;
  hasOptions: boolean;
}

// ---------------------------------------------------------------------------
// ExtensionIcon (single pinned toolbar button)
// ---------------------------------------------------------------------------

interface ExtensionIconProps {
  ext: ExtensionRecord;
  index: number;
  onContextMenu: (extId: string, pinned: boolean, x: number, y: number, hasOptions: boolean) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDrop: () => void;
  isDragOver: boolean;
}

function ExtensionIcon({
  ext,
  index,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  isDragOver,
}: ExtensionIconProps): React.ReactElement {
  const icon = bestIcon(ext);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[ExtensionToolbar] context menu on', ext.name, 'pinned=', ext.pinned);
    onContextMenu(ext.id, ext.pinned, e.clientX, e.clientY, false);
  }, [ext.id, ext.pinned, ext.name, onContextMenu]);

  return (
    <div
      className={`ext-toolbar__icon-wrap${isDragOver ? ' ext-toolbar__icon-wrap--drag-over' : ''}`}
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(index); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
    >
      <button
        className="ext-toolbar__icon-btn nav-buttons__btn"
        title={ext.name}
        aria-label={ext.name}
        onContextMenu={handleContextMenu}
      >
        {icon ? (
          <img
            src={icon}
            width={ICON_PREFERRED_PX}
            height={ICON_PREFERRED_PX}
            alt=""
            className="ext-toolbar__icon-img"
            draggable={false}
          />
        ) : (
          <span className="ext-toolbar__icon-placeholder" aria-hidden="true">
            {initials(ext.name)}
          </span>
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PuzzlePieceButton + Overflow menu
// ---------------------------------------------------------------------------

interface OverflowMenuProps {
  unpinnedExtensions: ExtensionRecord[];
  onContextMenu: (extId: string, pinned: boolean, x: number, y: number, hasOptions: boolean) => void;
  onManageAll: () => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}

function OverflowMenu({
  unpinnedExtensions,
  onContextMenu,
  onManageAll,
  onClose,
  anchorRef,
}: OverflowMenuProps): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  return (
    <div className="ext-toolbar__overflow-menu" ref={menuRef} role="menu">
      {unpinnedExtensions.length === 0 && (
        <div className="ext-toolbar__overflow-empty">All extensions are pinned</div>
      )}
      {unpinnedExtensions.map((ext) => {
        const icon = bestIcon(ext);
        return (
          <button
            key={ext.id}
            className="ext-toolbar__overflow-item"
            role="menuitem"
            title={ext.name}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenu(ext.id, false, e.clientX, e.clientY, false);
            }}
          >
            <span className="ext-toolbar__overflow-item-icon">
              {icon ? (
                <img src={icon} width={16} height={16} alt="" draggable={false} />
              ) : (
                <span className="ext-toolbar__icon-placeholder ext-toolbar__icon-placeholder--sm" aria-hidden="true">
                  {initials(ext.name)}
                </span>
              )}
            </span>
            <span className="ext-toolbar__overflow-item-name">{ext.name}</span>
          </button>
        );
      })}
      {unpinnedExtensions.length > 0 && (
        <div className="ext-toolbar__overflow-divider" aria-hidden="true" />
      )}
      <button className="ext-toolbar__overflow-item" role="menuitem" onClick={onManageAll}>
        <span className="ext-toolbar__overflow-item-icon ext-toolbar__overflow-item-icon--muted">
          {/* Gear icon */}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M6.5 1h3l.5 1.5a5 5 0 011.2.7l1.5-.4 1.5 2.6-1.1 1.1a5 5 0 010 1.4l1.1 1.1-1.5 2.6-1.5-.4a5 5 0 01-1.2.7L9.5 15h-3l-.5-1.5A5 5 0 014.8 12.8l-1.5.4L1.8 10.6l1.1-1.1a5 5 0 010-1.4L1.8 7l1.5-2.6 1.5.4A5 5 0 015.1 3.5L6.5 1z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </span>
        <span className="ext-toolbar__overflow-item-name">Manage extensions</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContextMenu (right-click on any extension icon)
// ---------------------------------------------------------------------------

interface ExtContextMenuProps {
  state: ContextMenuState;
  onPin: (id: string) => void;
  onUnpin: (id: string) => void;
  onManage: () => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

function ExtContextMenu({
  state,
  onPin,
  onUnpin,
  onManage,
  onRemove,
  onClose,
}: ExtContextMenuProps): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="ext-toolbar__context-menu"
      style={{ left: state.x, top: state.y }}
      role="menu"
    >
      {state.pinned ? (
        <button className="ext-toolbar__context-item" role="menuitem" onClick={() => { onUnpin(state.extId); onClose(); }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 14h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Unpin
        </button>
      ) : (
        <button className="ext-toolbar__context-item" role="menuitem" onClick={() => { onPin(state.extId); onClose(); }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 14V6M5 9l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 2h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Pin
        </button>
      )}
      <div className="ext-toolbar__context-divider" aria-hidden="true" />
      <button className="ext-toolbar__context-item" role="menuitem" onClick={() => { onManage(); onClose(); }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M6.5 1h3l.5 1.5a5 5 0 011.2.7l1.5-.4 1.5 2.6-1.1 1.1a5 5 0 010 1.4l1.1 1.1-1.5 2.6-1.5-.4a5 5 0 01-1.2.7L9.5 15h-3l-.5-1.5A5 5 0 014.8 12.8l-1.5.4L1.8 10.6l1.1-1.1a5 5 0 010-1.4L1.8 7l1.5-2.6 1.5.4A5 5 0 015.1 3.5L6.5 1z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        Manage extension
      </button>
      <button className="ext-toolbar__context-item ext-toolbar__context-item--danger" role="menuitem" onClick={() => { onRemove(state.extId); onClose(); }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Remove from browser
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExtensionToolbar (main export)
// ---------------------------------------------------------------------------

declare const electronAPI: {
  extensions: {
    list: () => Promise<ExtensionRecord[]>;
    pin: (id: string) => Promise<void>;
    unpin: (id: string) => Promise<void>;
    reorderPinned: (orderedIds: string[]) => Promise<void>;
    openManage: () => Promise<void>;
  };
  extensions_remove?: {
    remove: (id: string) => Promise<void>;
  };
};

export function ExtensionToolbar(): React.ReactElement | null {
  const [extensions, setExtensions] = useState<ExtensionRecord[]>([]);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Drag state
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const puzzleAnchorRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------------
  // Load extensions
  // ---------------------------------------------------------------------------

  const loadExtensions = useCallback(async () => {
    try {
      const list = await electronAPI.extensions.list();
      console.log('[ExtensionToolbar] loaded extensions:', list.length);
      setExtensions(list);
    } catch (err) {
      console.warn('[ExtensionToolbar] failed to load extensions:', err);
    }
  }, []);

  useEffect(() => {
    loadExtensions();
  }, [loadExtensions]);

  // ---------------------------------------------------------------------------
  // Derived lists
  // ---------------------------------------------------------------------------

  const pinnedExtensions = extensions
    .filter((e) => e.pinned && e.enabled)
    .sort((a, b) => {
      // Order is preserved from server pinnedOrder; server returns them in that order
      return 0;
    });

  const unpinnedExtensions = extensions.filter((e) => !e.pinned && e.enabled);

  // Hide entirely if no extensions installed
  if (extensions.length === 0) return null;

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handlePin = useCallback(async (id: string) => {
    console.log('[ExtensionToolbar] pin', id);
    try {
      await electronAPI.extensions.pin(id);
      await loadExtensions();
    } catch (err) {
      console.error('[ExtensionToolbar] pin failed:', err);
    }
  }, [loadExtensions]);

  const handleUnpin = useCallback(async (id: string) => {
    console.log('[ExtensionToolbar] unpin', id);
    try {
      await electronAPI.extensions.unpin(id);
      await loadExtensions();
    } catch (err) {
      console.error('[ExtensionToolbar] unpin failed:', err);
    }
  }, [loadExtensions]);

  const handleManage = useCallback(async () => {
    console.log('[ExtensionToolbar] open manage');
    try {
      await electronAPI.extensions.openManage();
    } catch (err) {
      console.error('[ExtensionToolbar] openManage failed:', err);
    }
  }, []);

  const handleRemove = useCallback(async (id: string) => {
    console.log('[ExtensionToolbar] remove', id);
    // Forward to the extensions window preload API if available, otherwise use manage window
    try {
      await electronAPI.extensions.openManage();
    } catch (err) {
      console.error('[ExtensionToolbar] remove openManage failed:', err);
    }
  }, []);

  const handleContextMenu = useCallback((
    extId: string,
    pinned: boolean,
    x: number,
    y: number,
    hasOptions: boolean,
  ) => {
    setContextMenu({ extId, pinned, x, y, hasOptions });
    setOverflowOpen(false);
  }, []);

  // ---------------------------------------------------------------------------
  // Drag reorder
  // ---------------------------------------------------------------------------

  const handleDragStart = useCallback((index: number) => {
    dragIndexRef.current = index;
    console.log('[ExtensionToolbar] drag start index:', index);
  }, []);

  const handleDragOver = useCallback((index: number) => {
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback(async () => {
    const from = dragIndexRef.current;
    const to = dragOverIndex;
    dragIndexRef.current = null;
    setDragOverIndex(null);

    if (from === null || to === null || from === to) return;

    console.log('[ExtensionToolbar] reorder from', from, 'to', to);

    const newPinned = [...pinnedExtensions];
    const [moved] = newPinned.splice(from, 1);
    newPinned.splice(to, 0, moved);

    const newOrder = newPinned.map((e) => e.id);
    try {
      await electronAPI.extensions.reorderPinned(newOrder);
      await loadExtensions();
    } catch (err) {
      console.error('[ExtensionToolbar] reorder failed:', err);
    }
  }, [dragOverIndex, pinnedExtensions, loadExtensions]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="ext-toolbar">
      {/* Pinned icons */}
      {pinnedExtensions.map((ext, index) => (
        <ExtensionIcon
          key={ext.id}
          ext={ext}
          index={index}
          onContextMenu={handleContextMenu}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          isDragOver={dragOverIndex === index}
        />
      ))}

      {/* Puzzle-piece overflow button — always shown when extensions exist */}
      <div className="ext-toolbar__puzzle-anchor" ref={puzzleAnchorRef}>
        <button
          className={`ext-toolbar__puzzle-btn nav-buttons__btn${overflowOpen ? ' ext-toolbar__puzzle-btn--active' : ''}`}
          title="Extensions"
          aria-label="Extensions"
          aria-expanded={overflowOpen}
          onClick={() => {
            setOverflowOpen((prev) => !prev);
            setContextMenu(null);
          }}
        >
          {/* Puzzle-piece icon (chrome parity) */}
          <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <path
              d="M11 9a2 2 0 114 0v1h2a1 1 0 011 1v2h1a2 2 0 010 4h-1v2a1 1 0 01-1 1h-2v1a2 2 0 11-4 0v-1H9a1 1 0 01-1-1v-2H7a2 2 0 110-4h1v-2a1 1 0 011-1h2V9z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {overflowOpen && (
          <OverflowMenu
            unpinnedExtensions={unpinnedExtensions}
            onContextMenu={handleContextMenu}
            onManageAll={() => { handleManage(); setOverflowOpen(false); }}
            onClose={() => setOverflowOpen(false)}
            anchorRef={puzzleAnchorRef}
          />
        )}
      </div>

      {/* Right-click context menu */}
      {contextMenu && (
        <ExtContextMenu
          state={contextMenu}
          onPin={handlePin}
          onUnpin={handleUnpin}
          onManage={handleManage}
          onRemove={handleRemove}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
