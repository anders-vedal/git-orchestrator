import { create } from "zustand";
import * as api from "../lib/tauri";
import type {
  ActivationReport,
  WorkspaceDetail,
  WorkspaceEntryInput,
  WorkspaceSummary,
} from "../types";

interface WorkspacesState {
  workspaces: WorkspaceSummary[];
  activeId: number | null;
  lastActivationReport: ActivationReport | null;
  activating: boolean;
  loading: boolean;
  lastError: string | null;

  loadAll: () => Promise<void>;
  loadActive: () => Promise<void>;
  getDetail: (id: number) => Promise<WorkspaceDetail>;
  create: (
    name: string,
    entries: WorkspaceEntryInput[],
  ) => Promise<WorkspaceSummary>;
  rename: (id: number, newName: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  updateEntries: (id: number, entries: WorkspaceEntryInput[]) => Promise<void>;
  activate: (id: number) => Promise<ActivationReport>;
  clearActive: () => Promise<void>;
  /** Clear the "last activation report" banner/dialog dismissal state. */
  dismissReport: () => void;
}

export const useWorkspacesStore = create<WorkspacesState>((set) => ({
  workspaces: [],
  activeId: null,
  lastActivationReport: null,
  activating: false,
  loading: false,
  lastError: null,

  loadAll: async () => {
    set({ loading: true, lastError: null });
    try {
      const [workspaces, activeId] = await Promise.all([
        api.listWorkspaces(),
        api.getActiveWorkspaceId(),
      ]);
      set({ workspaces, activeId, loading: false });
    } catch (e) {
      set({ loading: false, lastError: String(e) });
    }
  },

  loadActive: async () => {
    try {
      const activeId = await api.getActiveWorkspaceId();
      set({ activeId });
    } catch (e) {
      set({ lastError: String(e) });
    }
  },

  getDetail: (id) => api.getWorkspace(id),

  create: async (name, entries) => {
    const summary = await api.createWorkspace(name, entries);
    set((s) => ({ workspaces: [...s.workspaces, summary] }));
    // Re-sort by name to match backend ordering.
    set((s) => ({
      workspaces: [...s.workspaces].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    }));
    return summary;
  },

  rename: async (id, newName) => {
    await api.renameWorkspace(id, newName);
    // Refresh the list to pick up the new name and re-sort.
    const list = await api.listWorkspaces();
    set({ workspaces: list });
  },

  remove: async (id) => {
    await api.deleteWorkspace(id);
    set((s) => ({
      workspaces: s.workspaces.filter((w) => w.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    }));
  },

  updateEntries: async (id, entries) => {
    await api.updateWorkspaceEntries(id, entries);
    // Bump the repo_count / updated_at by reloading the summary row.
    const list = await api.listWorkspaces();
    set({ workspaces: list });
  },

  activate: async (id) => {
    set({ activating: true });
    try {
      const report = await api.activateWorkspace(id);
      set({
        activating: false,
        activeId: id,
        lastActivationReport: report,
      });
      return report;
    } catch (e) {
      set({ activating: false, lastError: String(e) });
      throw e;
    }
  },

  clearActive: async () => {
    await api.setActiveWorkspaceId(null);
    set({ activeId: null });
  },

  dismissReport: () => set({ lastActivationReport: null }),
}));

/** Convenience selector used by the sidebar switcher label. */
export function useActiveWorkspaceName(): string | null {
  const { workspaces, activeId } = useWorkspacesStore();
  if (activeId == null) return null;
  return workspaces.find((w) => w.id === activeId)?.name ?? null;
}
