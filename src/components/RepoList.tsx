import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { Folders, SearchX } from "lucide-react";
import { useEffect, useMemo } from "react";
import {
  applyFilterSort,
  isFilterActive,
  useFilterStore,
} from "../stores/filterStore";
import { useReposStore } from "../stores/reposStore";
import { useSelectionStore } from "../stores/selectionStore";
import { RepoRow } from "./RepoRow";
import { RepoToolbar } from "./RepoToolbar";

export function RepoList() {
  const statuses = useReposStore((s) => s.statuses);
  const reorder = useReposStore((s) => s.reorder);
  const loading = useReposStore((s) => s.loading);

  const search = useFilterStore((s) => s.search);
  const sortBy = useFilterStore((s) => s.sortBy);
  const sortDir = useFilterStore((s) => s.sortDir);
  const filter = useFilterStore((s) => s.filter);
  const reset = useFilterStore((s) => s.reset);

  const selectionCount = useSelectionStore((s) => s.selectedIds.size);
  const clearSelection = useSelectionStore((s) => s.clear);
  const toggleAllVisible = useSelectionStore((s) => s.toggleAllVisible);

  const visible = useMemo(
    () => applyFilterSort(statuses, search, sortBy, sortDir, filter),
    [statuses, search, sortBy, sortDir, filter],
  );
  const visibleIds = useMemo(() => visible.map((s) => s.id), [visible]);
  const filtersActive = isFilterActive(search, sortBy, filter);
  // Drag is disabled when filters hide rows (reordering the full list
  // through a partial view is incoherent) OR when 2+ rows are selected
  // (drag-one-of-many semantics are ambiguous — clear selection first).
  const dragEnabled = !filtersActive && selectionCount < 2;

  // Global keyboard: Ctrl/Cmd+A to toggle-all-visible, Esc to clear.
  // Skipped when focus is in an input so typing in the search box etc.
  // doesn't hijack selection.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTyping =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target?.isContentEditable === true;
      if (isTyping) return;

      if (e.key === "Escape" && selectionCount > 0) {
        e.preventDefault();
        clearSelection();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        toggleAllVisible(visibleIds);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionCount, clearSelection, toggleAllVisible, visibleIds]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  if (loading && statuses.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Loading repos…
      </div>
    );
  }

  if (statuses.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-zinc-400">
        <Folders size={40} className="text-zinc-600" />
        <div className="text-lg font-semibold text-zinc-200">No repos yet</div>
        <p className="max-w-sm text-sm text-zinc-400">
          Click <span className="text-zinc-200">Add repo</span> in the sidebar to
          register a local git repository. It will appear here with status, ahead/behind counts and
          one-click fetch & pull.
        </p>
      </div>
    );
  }

  function handleDragEnd(e: DragEndEvent) {
    if (!dragEnabled) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = statuses.findIndex((s) => s.id === active.id);
    const to = statuses.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(statuses, from, to).map((s) => s.id);
    void reorder(next);
  }

  return (
    <>
      <RepoToolbar visibleCount={visible.length} />
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-zinc-400">
            <SearchX size={36} className="text-zinc-600" />
            <div className="text-sm font-semibold text-zinc-200">
              No repos match the current filter
            </div>
            <button
              type="button"
              onClick={reset}
              className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-zinc-200 hover:bg-surface-3"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={visible.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {visible.map((s) => (
                <RepoRow
                  key={s.id}
                  status={s}
                  dragDisabled={!dragEnabled}
                  visibleIds={visibleIds}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </>
  );
}
