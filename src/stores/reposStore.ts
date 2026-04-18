import { create } from "zustand";
import * as api from "../lib/tauri";
import { useSelectionStore } from "./selectionStore";
import type { Repo, RepoStatus, ScanAddResult } from "../types";

function skeletonStatus(repo: Repo): RepoStatus {
  // A pre-fill row rendered while the streaming refresh populates real
  // git state. Keeps all the known-empty shape so RepoRow doesn't choke.
  return {
    id: repo.id,
    name: repo.name,
    path: repo.path,
    branch: "",
    defaultBranch: "",
    ahead: 0,
    behind: 0,
    dirty: "clean",
    hasUpstream: false,
    lastFetch: null,
    latestCommit: null,
    remoteUrl: null,
    hasSubmodules: false,
    diverged: false,
    unpushedNoUpstream: null,
    commitCount: null,
    lastRefreshedAt: null,
    error: null,
  };
}

interface ReposState {
  statuses: RepoStatus[];
  loading: boolean;
  refreshing: boolean;
  refreshingIds: Set<number>;
  lastError: string | null;
  loadAll: () => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshOne: (id: number) => Promise<void>;
  /**
   * Apply a single RepoStatus update, typically from the streaming
   * `repo-status-updated` tauri event. Removes the id from
   * refreshingIds, and clears `refreshing` once the set empties.
   */
  applyStatusUpdate: (status: RepoStatus) => void;
  remove: (id: number) => Promise<void>;
  rename: (id: number, newName: string) => Promise<void>;
  reorder: (orderedIds: number[]) => Promise<void>;
  add: (path: string, name?: string) => Promise<void>;
  addMany: (paths: string[]) => Promise<ScanAddResult>;
}

function patchId(list: RepoStatus[], updated: RepoStatus): RepoStatus[] {
  // Patch the matching id; if the status references a repo that is no
  // longer in the list (removed mid-refresh), drop the update.
  let found = false;
  const next = list.map((s) => {
    if (s.id === updated.id) {
      found = true;
      return updated;
    }
    return s;
  });
  return found ? next : list;
}

// Safety timeout for a streaming refresh — if any backend tasks silently
// drop their emit (e.g. the window closes and reopens), clear the
// "refreshing" indicator after this many ms so the UI doesn't look stuck.
const REFRESH_WATCHDOG_MS = 60_000;

export const useReposStore = create<ReposState>((set, get) => ({
  statuses: [],
  loading: false,
  refreshing: false,
  refreshingIds: new Set<number>(),
  lastError: null,

  async loadAll() {
    set({ loading: true, lastError: null });
    try {
      // Cheap DB call — render the list skeleton instantly, then stream
      // real git state in per repo. Matters for 20+ repo workspaces where
      // the slowest repo would otherwise block the whole view.
      const repos = await api.listRepos();
      const skeletons = repos.map(skeletonStatus);
      const ids = new Set(repos.map((r) => r.id));
      set({
        statuses: skeletons,
        loading: false,
        refreshing: skeletons.length > 0,
        refreshingIds: ids,
      });
      // Drop any selection entries that point at repos no longer on disk
      // (removed in another session, etc.).
      useSelectionStore.getState().pruneTo(ids);
      if (skeletons.length > 0) {
        await api.refreshAllStatuses();
        window.setTimeout(() => {
          const s = get();
          if (s.refreshing && s.refreshingIds.size > 0) {
            set({ refreshing: false, refreshingIds: new Set<number>() });
          }
        }, REFRESH_WATCHDOG_MS);
      }
    } catch (e) {
      set({ loading: false, refreshing: false, lastError: String(e) });
    }
  },

  async refreshAll() {
    // Overlapping refreshes are safe: events are idempotent, applyStatusUpdate
    // is patch-by-id. Letting them concurrently proceed means a manual click
    // during auto-refresh doesn't silently drop.
    const state = get();
    const ids = new Set(state.statuses.map((s) => s.id));
    set({ refreshing: true, refreshingIds: ids, lastError: null });
    try {
      await api.refreshAllStatuses();
    } catch (e) {
      set({ refreshing: false, refreshingIds: new Set<number>(), lastError: String(e) });
      return;
    }
    // Events arrive asynchronously via applyStatusUpdate. The watchdog
    // only trips if some emit fails silently — normally the last arriving
    // event flips `refreshing` off.
    window.setTimeout(() => {
      const s = get();
      if (s.refreshing && s.refreshingIds.size > 0) {
        set({ refreshing: false, refreshingIds: new Set<number>() });
      }
    }, REFRESH_WATCHDOG_MS);
  },

  applyStatusUpdate(status) {
    set((state) => {
      const ids = new Set(state.refreshingIds);
      ids.delete(status.id);
      return {
        statuses: patchId(state.statuses, status),
        refreshingIds: ids,
        refreshing: state.refreshing && ids.size > 0,
      };
    });
  },

  async refreshOne(id: number) {
    const ids = new Set(get().refreshingIds);
    ids.add(id);
    set({ refreshingIds: ids });
    try {
      const s = await api.getRepoStatus(id);
      set((state) => ({
        statuses: patchId(state.statuses, s),
      }));
    } catch (e) {
      set({ lastError: String(e) });
    } finally {
      const ids2 = new Set(get().refreshingIds);
      ids2.delete(id);
      set({ refreshingIds: ids2 });
    }
  },

  async remove(id: number) {
    await api.removeRepo(id);
    set((state) => ({
      statuses: state.statuses.filter((s) => s.id !== id),
    }));
    // Drop the removed id from the selection so bulk ops don't target it.
    useSelectionStore
      .getState()
      .pruneTo(get().statuses.map((s) => s.id));
  },

  async rename(id: number, newName: string) {
    await api.renameRepo(id, newName);
    set((state) => ({
      statuses: state.statuses.map((s) =>
        s.id === id ? { ...s, name: newName } : s,
      ),
    }));
  },

  async reorder(orderedIds: number[]) {
    set((state) => {
      const byId = new Map(state.statuses.map((s) => [s.id, s]));
      return {
        statuses: orderedIds
          .map((id) => byId.get(id))
          .filter((s): s is RepoStatus => !!s),
      };
    });
    await api.reorderRepos(orderedIds);
  },

  async add(path: string, name?: string) {
    const newRepo = await api.addRepo(path, name);
    // Render a skeleton row immediately so the list visibly grows, then
    // fetch real status for just the new repo. Avoids triggering a full
    // fleet refresh for a single-repo add.
    set((state) => {
      if (state.statuses.some((s) => s.id === newRepo.id)) return state;
      return { statuses: [...state.statuses, skeletonStatus(newRepo)] };
    });
    try {
      const status = await api.getRepoStatus(newRepo.id);
      get().applyStatusUpdate(status);
    } catch (e) {
      set({ lastError: String(e) });
    }
  },

  async addMany(paths: string[]) {
    const result = await api.addScannedRepos(paths);
    if (result.added.length > 0) {
      // Insert skeletons for every newly-added repo so the list visibly
      // updates; then refresh each in parallel. Per-repo failures surface
      // as the row's error pill via applyStatusUpdate.
      set((state) => {
        const existing = new Set(state.statuses.map((s) => s.id));
        const toAdd = result.added
          .filter((r) => !existing.has(r.id))
          .map(skeletonStatus);
        return { statuses: [...state.statuses, ...toAdd] };
      });
      await Promise.all(
        result.added.map(async (r) => {
          try {
            const s = await api.getRepoStatus(r.id);
            get().applyStatusUpdate(s);
          } catch {
            /* individual failure leaves the skeleton in place */
          }
        }),
      );
    }
    return result;
  },
}));
