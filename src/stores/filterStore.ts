import { create } from "zustand";
import { sortByAttention } from "../lib/repoSort";
import type { RepoStatus } from "../types";

export type SortKey =
  | "attention"
  | "custom"
  | "name"
  | "latest"
  | "commits";
export type SortDir = "asc" | "desc";
export type StatusFilter =
  | "all"
  | "outOfSync"
  | "clean"
  | "dirty"
  | "errors";

interface FilterState {
  search: string;
  sortBy: SortKey;
  sortDir: SortDir;
  filter: StatusFilter;
  setSearch: (v: string) => void;
  setSortBy: (v: SortKey) => void;
  toggleSortDir: () => void;
  setSortDir: (v: SortDir) => void;
  setFilter: (v: StatusFilter) => void;
  reset: () => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  search: "",
  sortBy: "attention",
  sortDir: "asc",
  filter: "all",
  setSearch: (v) => set({ search: v }),
  setSortBy: (v) => set({ sortBy: v }),
  toggleSortDir: () =>
    set((s) => ({ sortDir: s.sortDir === "asc" ? "desc" : "asc" })),
  setSortDir: (v) => set({ sortDir: v }),
  setFilter: (v) => set({ filter: v }),
  reset: () =>
    set({ search: "", sortBy: "attention", sortDir: "asc", filter: "all" }),
}));

/** True when the user has touched any filter/sort/search away from the
 *  defaults. Used by the Reset button in RepoToolbar. `attention` is
 *  the default sort, so it reads as "not filtered". */
export function isFilterActive(
  search: string,
  sortBy: SortKey,
  filter: StatusFilter,
): boolean {
  return search.trim() !== "" || sortBy !== "attention" || filter !== "all";
}

/** True when the visible list equals the stored priority order — the
 *  only sort under which drag-to-reorder is coherent. */
export function isCustomOrderView(
  search: string,
  sortBy: SortKey,
  filter: StatusFilter,
): boolean {
  return search.trim() === "" && sortBy === "custom" && filter === "all";
}

function matchesFilter(s: RepoStatus, filter: StatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "errors":
      return s.error !== null;
    case "clean":
      return (
        s.error === null &&
        s.dirty === "clean" &&
        !s.diverged &&
        s.ahead === 0 &&
        s.behind === 0 &&
        (s.unpushedNoUpstream ?? 0) === 0
      );
    case "outOfSync":
      return (
        s.diverged ||
        s.ahead > 0 ||
        s.behind > 0 ||
        (s.unpushedNoUpstream ?? 0) > 0
      );
    case "dirty":
      return s.dirty !== "clean";
  }
}

export function countByFilter(
  statuses: RepoStatus[],
  filter: StatusFilter,
): number {
  let n = 0;
  for (const s of statuses) if (matchesFilter(s, filter)) n++;
  return n;
}

function commitTime(s: RepoStatus): number {
  const t = s.latestCommit?.timestamp;
  if (!t) return 0;
  const n = Date.parse(t);
  return Number.isFinite(n) ? n : 0;
}

export function applyFilterSort(
  statuses: RepoStatus[],
  search: string,
  sortBy: SortKey,
  sortDir: SortDir,
  filter: StatusFilter,
): RepoStatus[] {
  const q = search.trim().toLowerCase();
  let out = statuses.filter((s) => matchesFilter(s, filter));
  if (q) {
    out = out.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.path.toLowerCase().includes(q) ||
        s.branch.toLowerCase().includes(q),
    );
  }
  if (sortBy === "attention") {
    out = sortByAttention(out);
  } else if (sortBy !== "custom") {
    const dir = sortDir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name) * dir;
        case "latest":
          return (commitTime(a) - commitTime(b)) * dir;
        case "commits":
          return ((a.commitCount ?? -1) - (b.commitCount ?? -1)) * dir;
        default:
          return 0;
      }
    });
  }
  return out;
}
