import { create } from "zustand";

/**
 * Row-selection state for bulk ops. Decoupled from the repos store so a
 * reorder / refresh doesn't clear what the user has picked.
 *
 * Interaction model:
 * - click a row's checkbox → toggle just that row (anchors the range)
 * - shift+click → select every row between the last-clicked anchor and this
 *   one, inclusive, based on the currently-visible order
 * - ctrl/cmd+A in the window → select all currently-visible rows
 * - Esc → clear
 *
 * Selection is id-based (not index-based) so it survives filtering + sorting
 * gracefully. A bulk action runs on `selectedIds` regardless of whether the
 * row is currently visible — that matches the user's stated intent.
 */
interface SelectionState {
  selectedIds: Set<number>;
  /** Anchor for shift-click range selection. null = no anchor. */
  lastClickedId: number | null;

  toggle: (id: number) => void;
  clear: () => void;
  /** Select every id in `visibleIds` if any is unselected; otherwise
   *  deselect every id in `visibleIds`. Works as the toolbar
   *  "check-all" affordance. */
  toggleAllVisible: (visibleIds: number[]) => void;
  /** Inclusive range based on the supplied visible order — shift+click
   *  rules. If the anchor isn't in `visibleIds`, treat as a plain toggle. */
  selectRange: (toId: number, visibleIds: number[]) => void;
  /** Drop any ids that are no longer valid (e.g. removed repos) — called
   *  from the repos store after remove / reorder. */
  pruneTo: (validIds: Iterable<number>) => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedIds: new Set<number>(),
  lastClickedId: null,

  toggle(id) {
    set((state) => {
      const next = new Set(state.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next, lastClickedId: id };
    });
  },

  clear() {
    set({ selectedIds: new Set<number>(), lastClickedId: null });
  },

  toggleAllVisible(visibleIds) {
    set((state) => {
      const visibleSet = new Set(visibleIds);
      const allVisibleSelected =
        visibleIds.length > 0 &&
        visibleIds.every((id) => state.selectedIds.has(id));
      const next = new Set(state.selectedIds);
      if (allVisibleSelected) {
        visibleSet.forEach((id) => next.delete(id));
      } else {
        visibleSet.forEach((id) => next.add(id));
      }
      return { selectedIds: next };
    });
  },

  selectRange(toId, visibleIds) {
    const anchor = get().lastClickedId;
    if (anchor === null) {
      get().toggle(toId);
      return;
    }
    const fromIdx = visibleIds.indexOf(anchor);
    const toIdx = visibleIds.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) {
      // Anchor scrolled out of the visible set; fall back to plain toggle.
      get().toggle(toId);
      return;
    }
    const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
    set((state) => {
      const next = new Set(state.selectedIds);
      for (let i = lo; i <= hi; i++) next.add(visibleIds[i]);
      return { selectedIds: next, lastClickedId: toId };
    });
  },

  pruneTo(validIds) {
    const valid = new Set(validIds);
    set((state) => {
      let changed = false;
      const next = new Set<number>();
      state.selectedIds.forEach((id) => {
        if (valid.has(id)) next.add(id);
        else changed = true;
      });
      if (!changed) return state;
      const lastValid =
        state.lastClickedId !== null && valid.has(state.lastClickedId)
          ? state.lastClickedId
          : null;
      return { selectedIds: next, lastClickedId: lastValid };
    });
  },
}));
