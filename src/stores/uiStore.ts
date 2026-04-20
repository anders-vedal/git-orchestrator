import { create } from "zustand";
import type {
  ActivationReport,
  BulkPullReport,
  BulkResult,
  StashPushReport,
  StashRestoreReport,
  UndoGroupReport,
} from "../types";

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
  | { kind: "activityFeed" }
  | {
      kind: "branchPicker";
      repoId: number;
      repoName: string;
      currentBranch: string;
      defaultBranch: string;
    }
  | { kind: "bulkFetchResult"; title: string; results: BulkResult[] }
  | { kind: "bulkPullResult"; title: string; report: BulkPullReport }
  | { kind: "gitError"; title: string; error: string; repoId?: number }
  | { kind: "info"; title: string; body: string }
  | {
      kind: "createWorkspace";
      /** When present, open the dialog in edit mode for this workspace id. */
      editId?: number;
      /** Repo ids preselected for a fresh workspace (from selection or
       *  the "Create from selection" menu item). Ignored in edit mode. */
      seedRepoIds?: number[];
    }
  | { kind: "manageWorkspaces" }
  | { kind: "workspaceActivationResult"; report: ActivationReport }
  | {
      kind: "createStash";
      /** Repo ids to prefill the dialog with. Empty = user picks from
       *  the dirty-repo list. */
      seedRepoIds?: number[];
      /** When set, after the stash succeeds the dialog calls back to
       *  activate this workspace (used by the workspace-activation
       *  retry flow). */
      thenActivateWorkspaceId?: number;
      /** Prefill the label field (e.g. "pre-NOR-876 switch"). */
      suggestedLabel?: string;
    }
  | { kind: "stashes" }
  | { kind: "recentActions" }
  | { kind: "stashPushResult"; report: StashPushReport }
  | { kind: "stashRestoreResult"; report: StashRestoreReport }
  | {
      kind: "undoGroupResult";
      report: UndoGroupReport;
      /** Label used in the dialog title, e.g. workspace name or "Stash
       *  restore 'pre-NOR-876'". */
      sourceLabel: string;
    }
  | {
      kind: "update";
      version: string;
      currentVersion: string;
      notes: string | null;
      date: string | null;
    };

interface UiState {
  expandedIds: Set<number>;
  dialog: DialogKind;
  bulkInProgress: boolean;
  paletteOpen: boolean;
  toggleExpanded: (id: number) => void;
  collapse: (id: number) => void;
  openDialog: (d: NonNullable<DialogKind>) => void;
  closeDialog: () => void;
  setBulkInProgress: (v: boolean) => void;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  expandedIds: new Set<number>(),
  dialog: null,
  bulkInProgress: false,
  paletteOpen: false,

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
  openPalette() {
    set({ paletteOpen: true });
  },
  closePalette() {
    set({ paletteOpen: false });
  },
  togglePalette() {
    set((s) => ({ paletteOpen: !s.paletteOpen }));
  },
}));
