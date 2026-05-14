import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Cross-mount persistent UI state. Keep this store narrowly scoped to fields
 * that legitimately need (a) cross-component subscription and (b) reload
 * persistence.
 *
 * `viewMode` deliberately lives in HubApp's local useState — it has a single
 * owner, doesn't need to be subscribed by other components, and HubApp already
 * owns the `localStorage['hub-view-mode']` round-trip. Mirroring it here would
 * create two persistence paths that can drift.
 */
type UIState = {
  chatSessionId: string | null;
  setChatSession: (id: string | null) => void;
  /**
   * One-shot prompt to seed the Dashboard's TaskInput with. Used by the
   * chat-view "Reference in new chat" quote action on terminal sessions —
   * ChatPane writes here and navigates to the dashboard; Dashboard consumes
   * it on mount and clears. Intentionally NOT persisted: it's transient
   * cross-component signalling, not state worth surviving a reload.
   */
  pendingDashboardPrompt: string | null;
  setPendingDashboardPrompt: (p: string | null) => void;
};

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      chatSessionId: null,
      setChatSession: (id) => set(() => {
        console.log('[uiStore] setChatSession', { id });
        return { chatSessionId: id };
      }),
      pendingDashboardPrompt: null,
      setPendingDashboardPrompt: (p) => set(() => {
        console.log('[uiStore] setPendingDashboardPrompt', { length: p?.length ?? 0 });
        return { pendingDashboardPrompt: p };
      }),
    }),
    {
      name: 'hub-ui-store',
      partialize: (state) => ({ chatSessionId: state.chatSessionId }),
    },
  ),
);
