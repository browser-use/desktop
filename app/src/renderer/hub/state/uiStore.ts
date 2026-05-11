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
};

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      chatSessionId: null,
      setChatSession: (id) => set(() => {
        console.log('[uiStore] setChatSession', { id });
        return { chatSessionId: id };
      }),
    }),
    {
      name: 'hub-ui-store',
      partialize: (state) => ({ chatSessionId: state.chatSessionId }),
    },
  ),
);
