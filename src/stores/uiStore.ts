import { create } from "zustand";
import type { BulkPullReport, BulkResult } from "../types";

type DialogKind =
  | null
  | { kind: "addRepo" }
  | { kind: "scanFolder" }
  | { kind: "removeRepo"; id: number; name: string; path: string }
  | { kind: "forcePull"; id: number; name: string; defaultBranch: string }
  | {
      kind: "commitPush";
      id: number;
      name: string;
      branch: string;
      defaultBranch: string;
      hasUpstream: boolean;
    }
  | { kind: "settings" }
  | { kind: "bulkFetchResult"; title: string; results: BulkResult[] }
  | { kind: "bulkPullResult"; title: string; report: BulkPullReport }
  | { kind: "gitError"; title: string; error: string; repoId?: number }
  | { kind: "info"; title: string; body: string };

interface UiState {
  expandedIds: Set<number>;
  dialog: DialogKind;
  bulkInProgress: boolean;
  toggleExpanded: (id: number) => void;
  collapse: (id: number) => void;
  openDialog: (d: NonNullable<DialogKind>) => void;
  closeDialog: () => void;
  setBulkInProgress: (v: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  expandedIds: new Set<number>(),
  dialog: null,
  bulkInProgress: false,

  toggleExpanded(id) {
    set((state) => {
      const next = new Set(state.expandedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedIds: next };
    });
  },

  collapse(id) {
    set((state) => {
      const next = new Set(state.expandedIds);
      next.delete(id);
      return { expandedIds: next };
    });
  },

  openDialog(d) {
    set({ dialog: d });
  },
  closeDialog() {
    set({ dialog: null });
  },
  setBulkInProgress(v) {
    set({ bulkInProgress: v });
  },
}));
