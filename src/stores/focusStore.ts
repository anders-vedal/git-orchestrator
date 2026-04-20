// Keyboard focus model for the repo list. Independent of selection:
// the focused row carries a focus ring (what a keyboard shortcut
// targets), while selected rows carry a checkbox + left border (what
// bulk actions target). A row can be focused while others are
// selected, and vice versa.

import { create } from "zustand";

interface FocusState {
  /** id of the currently-focused repo, or null when focus is idle. */
  focusedRepoId: number | null;
  /** The ordered ids of rows currently visible in the list, updated by
   *  RepoList on every render. Needed by focusNext/Prev to compute
   *  neighbors after filter/sort changes. */
  visibleIds: number[];
  setVisibleIds: (ids: number[]) => void;
  focus: (id: number | null) => void;
  focusNext: () => void;
  focusPrev: () => void;
  focusFirst: () => void;
  focusLast: () => void;
}

export const useFocusStore = create<FocusState>((set, get) => ({
  focusedRepoId: null,
  visibleIds: [],

  setVisibleIds(ids) {
    const prev = get().focusedRepoId;
    // If the focused row scrolled out of the visible set (filter/search
    // change), blur focus — otherwise the ring points at nothing.
    if (prev != null && !ids.includes(prev)) {
      set({ visibleIds: ids, focusedRepoId: null });
    } else {
      set({ visibleIds: ids });
    }
  },

  focus(id) {
    set({ focusedRepoId: id });
  },

  focusNext() {
    const { focusedRepoId, visibleIds } = get();
    if (visibleIds.length === 0) return;
    if (focusedRepoId == null) {
      set({ focusedRepoId: visibleIds[0] });
      return;
    }
    const i = visibleIds.indexOf(focusedRepoId);
    if (i < 0) {
      set({ focusedRepoId: visibleIds[0] });
    } else if (i < visibleIds.length - 1) {
      set({ focusedRepoId: visibleIds[i + 1] });
    }
  },

  focusPrev() {
    const { focusedRepoId, visibleIds } = get();
    if (visibleIds.length === 0) return;
    if (focusedRepoId == null) {
      set({ focusedRepoId: visibleIds[visibleIds.length - 1] });
      return;
    }
    const i = visibleIds.indexOf(focusedRepoId);
    if (i > 0) set({ focusedRepoId: visibleIds[i - 1] });
  },

  focusFirst() {
    const { visibleIds } = get();
    if (visibleIds.length > 0) set({ focusedRepoId: visibleIds[0] });
  },

  focusLast() {
    const { visibleIds } = get();
    if (visibleIds.length > 0)
      set({ focusedRepoId: visibleIds[visibleIds.length - 1] });
  },
}));
