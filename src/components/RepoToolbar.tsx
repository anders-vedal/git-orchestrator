import clsx from "clsx";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useMemo } from "react";
import { useReposStore } from "../stores/reposStore";
import {
  countByFilter,
  isFilterActive,
  useFilterStore,
  type SortKey,
  type StatusFilter,
} from "../stores/filterStore";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "attention", label: "Attention" },
  { value: "custom", label: "Custom order" },
  { value: "name", label: "Name" },
  { value: "latest", label: "Latest change" },
  { value: "commits", label: "Most commits" },
];

const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All repos" },
  { value: "outOfSync", label: "Out of sync" },
  { value: "clean", label: "In sync & clean" },
  { value: "dirty", label: "Any uncommitted" },
  { value: "errors", label: "Has error" },
];

interface Props {
  visibleCount: number;
}

const selectCls =
  "h-8 rounded-md border border-border bg-surface-2 px-2 text-xs text-zinc-200 " +
  "focus:border-blue-400 focus:outline-none hover:bg-surface-3";

export function RepoToolbar({ visibleCount }: Props) {
  const statuses = useReposStore((s) => s.statuses);
  const totalCount = statuses.length;
  const search = useFilterStore((s) => s.search);
  const setSearch = useFilterStore((s) => s.setSearch);
  const sortBy = useFilterStore((s) => s.sortBy);
  const setSortBy = useFilterStore((s) => s.setSortBy);
  const sortDir = useFilterStore((s) => s.sortDir);
  const toggleSortDir = useFilterStore((s) => s.toggleSortDir);
  const filter = useFilterStore((s) => s.filter);
  const setFilter = useFilterStore((s) => s.setFilter);
  const reset = useFilterStore((s) => s.reset);

  const active = isFilterActive(search, sortBy, filter);
  // Sort direction is meaningless for `custom` (manual order) and for
  // `attention` (the bucket ordering is opinionated, not asc/desc).
  const dirDisabled = sortBy === "custom" || sortBy === "attention";

  const filterCounts = useMemo(
    () =>
      Object.fromEntries(
        FILTER_OPTIONS.map((o) => [o.value, countByFilter(statuses, o.value)]),
      ) as Record<StatusFilter, number>,
    [statuses],
  );

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-0 px-3 py-2">
      <div className="relative min-w-[180px] flex-1">
        <Search
          size={14}
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500"
        />
        <input
          id="repo-search-input"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          placeholder="Search name, path or branch… (press / to focus)"
          spellCheck={false}
          className="h-8 w-full rounded-md border border-border bg-surface-2 pl-7 pr-7 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-blue-400 focus:outline-none"
        />
        {search && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setSearch("")}
            className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-zinc-500 hover:bg-surface-3 hover:text-zinc-200"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        <SlidersHorizontal size={12} /> Filter
        <select
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value as StatusFilter)}
          className={selectCls}
          aria-label="Filter repos by status"
        >
          {FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} ({filterCounts[o.value]})
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        Sort
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.currentTarget.value as SortKey)}
          className={selectCls}
          aria-label="Sort repos by"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={toggleSortDir}
        disabled={dirDisabled}
        title={
          dirDisabled
            ? "Direction applies when a sort key is selected"
            : sortDir === "asc"
              ? "Ascending — click to flip to descending"
              : "Descending — click to flip to ascending"
        }
        aria-label={`Sort direction: ${sortDir}`}
        className={clsx(
          "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 text-zinc-200",
          "hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed",
        )}
      >
        {sortDir === "asc" ? <ArrowUpAZ size={14} /> : <ArrowDownAZ size={14} />}
      </button>

      <div className="ml-auto flex items-center gap-2 text-[11px] text-zinc-500">
        <span>
          {active
            ? `${visibleCount} of ${totalCount}`
            : `${totalCount} repo${totalCount === 1 ? "" : "s"}`}
        </span>
        {active && (
          <button
            type="button"
            onClick={reset}
            className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-zinc-300 hover:bg-surface-3"
            title="Clear search, sort, and filter"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
