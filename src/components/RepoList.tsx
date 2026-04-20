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
  isCustomOrderView,
  useFilterStore,
} from "../stores/filterStore";
import { useFocusStore } from "../stores/focusStore";
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
  const setVisibleIdsFocus = useFocusStore((s) => s.setVisibleIds);

  const visible = useMemo(
    () => applyFilterSort(statuses, search, sortBy, sortDir, filter),
    [statuses, search, sortBy, sortDir, filter],
  );
  const visibleIds = useMemo(() => visible.map((s) => s.id), [visible]);
  // Drag-to-reorder only works when the visible list equals the full
  // list in stored priority order. Any sort (attention, name, etc.),
  // any search, or any filter breaks that invariant. Multi-selection
  // also makes drag-one-of-many semantics ambiguous, so we require < 2.
  const dragEnabled =
    isCustomOrderView(search, sortBy, filter) && selectionCount < 2;

  // Keep the focus store in sync with the visible, ordered row ids so
  // j/k/Home/End can navigate deterministically across filter changes.
  // The Esc cascade + Ctrl/Cmd+A now live in useGlobalKeymap.
  useEffect(() => {
    setVisibleIdsFocus(visibleIds);
  }, [visibleIds, setVisibleIdsFocus]);

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
