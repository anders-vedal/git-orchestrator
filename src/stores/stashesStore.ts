import { create } from "zustand";
import * as api from "../lib/tauri";
import type {
  StashBundleDetail,
  StashBundleSummary,
  StashPushReport,
  StashRestoreReport,
} from "../types";

interface StashesState {
  bundles: StashBundleSummary[];
  loading: boolean;
  busy: boolean;
  lastError: string | null;

  loadAll: () => Promise<void>;
  getDetail: (id: number) => Promise<StashBundleDetail>;
  create: (label: string, repoIds: number[]) => Promise<StashPushReport>;
  restore: (id: number) => Promise<StashRestoreReport>;
  remove: (id: number, dropRefs: boolean) => Promise<void>;
}

export const useStashesStore = create<StashesState>((set) => ({
  bundles: [],
  loading: false,
  busy: false,
  lastError: null,

  loadAll: async () => {
    set({ loading: true, lastError: null });
    try {
      const bundles = await api.listStashBundles();
      set({ bundles, loading: false });
    } catch (e) {
      set({ loading: false, lastError: String(e) });
    }
  },

  getDetail: (id) => api.getStashBundle(id),

  create: async (label, repoIds) => {
    set({ busy: true, lastError: null });
    try {
      const report = await api.createStashBundle(label, repoIds);
      if (report.bundleId != null) {
        const bundles = await api.listStashBundles();
        set({ bundles });
      }
      set({ busy: false });
      return report;
    } catch (e) {
      set({ busy: false, lastError: String(e) });
      throw e;
    }
  },

  restore: async (id) => {
    set({ busy: true, lastError: null });
    try {
      const report = await api.restoreStashBundle(id);
      const bundles = await api.listStashBundles();
      set({ bundles, busy: false });
      return report;
    } catch (e) {
      set({ busy: false, lastError: String(e) });
      throw e;
    }
  },

  remove: async (id, dropRefs) => {
    set({ busy: true, lastError: null });
    try {
      await api.deleteStashBundle(id, dropRefs);
      set((s) => ({
        bundles: s.bundles.filter((b) => b.id !== id),
        busy: false,
      }));
    } catch (e) {
      set({ busy: false, lastError: String(e) });
      throw e;
    }
  },
}));
