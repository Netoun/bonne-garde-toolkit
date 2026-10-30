import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIStore {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  activeOrgId: string | null;
  setActiveOrg: (id: string | null) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      activeOrgId: null,
      setActiveOrg: (id) => set({ activeOrgId: id }),
    }),
    {
      name: "acme-ui-store",
      partialize: (state) => ({ sidebarOpen: state.sidebarOpen, activeOrgId: state.activeOrgId }),
    },
  ),
);
