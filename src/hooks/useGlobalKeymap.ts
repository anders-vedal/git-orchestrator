// Global keyboard layer: j/k navigation, per-row shortcuts (f/p/c/t/o/r),
// bulk shortcuts (Shift+F / Shift+P), command palette (Ctrl/Cmd+K),
// Esc cascade (palette → search → selection → focus). Every binding
// that isn't a modifier-shortcut is gated on `!isTyping` so typing in
// the filter box doesn't fetch the focused repo.
//
// Bulk shortcuts dispatch a CustomEvent that Sidebar listens for. The
// alternative would be to lift fetch-all / pull-all into a shared
// hook; the event keeps the Sidebar's bulk-busy state local while
// still reusing the existing code path.

import { useEffect } from "react";
import * as api from "../lib/tauri";
import { useFilterStore } from "../stores/filterStore";
import { useFocusStore } from "../stores/focusStore";
import { useReposStore } from "../stores/reposStore";
import { useSelectionStore } from "../stores/selectionStore";
import { useUiStore } from "../stores/uiStore";

export const SHORTCUT_BULK_FETCH = "shortcut:bulk-fetch";
export const SHORTCUT_BULK_PULL = "shortcut:bulk-pull";
const REPO_SEARCH_INPUT_ID = "repo-search-input";

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function focusSearchInput() {
  const el = document.getElementById(
    REPO_SEARCH_INPUT_ID,
  ) as HTMLInputElement | null;
  if (el) {
    el.focus();
    el.select();
  }
}

export function useGlobalKeymap() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      const typing = isTypingTarget(e.target);

      // Ctrl/Cmd+K toggles the command palette from anywhere — works
      // even while typing in the filter, because that's the whole
      // point of a palette keybind.
      if (ctrl && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        useUiStore.getState().togglePalette();
        return;
      }

      if (typing) {
        // While a text input has focus, hand Esc to the browser (or
        // let our input's onKeyDown/Clear button handle it) — we don't
        // want the global Esc cascade to yank focus away from a field
        // the user is still typing in. Exception: if the filter has
        // text AND Esc is pressed, clear it (mirrors the input's own
        // clear button behaviour).
        if (e.key === "Escape") {
          const search = useFilterStore.getState().search;
          if (search) {
            useFilterStore.getState().setSearch("");
            (e.target as HTMLElement).blur();
            e.preventDefault();
          }
        }
        return;
      }

      // Ctrl/Cmd+A — select all visible rows
      if (ctrl && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        const visibleIds = useFocusStore.getState().visibleIds;
        useSelectionStore.getState().toggleAllVisible(visibleIds);
        return;
      }

      // Esc cascade: palette → search → selection → focus
      if (e.key === "Escape") {
        const ui = useUiStore.getState();
        if (ui.paletteOpen) {
          ui.closePalette();
          e.preventDefault();
          return;
        }
        const filter = useFilterStore.getState();
        if (filter.search) {
          filter.setSearch("");
          e.preventDefault();
          return;
        }
        const sel = useSelectionStore.getState();
        if (sel.selectedIds.size > 0) {
          sel.clear();
          e.preventDefault();
          return;
        }
        const focus = useFocusStore.getState();
        if (focus.focusedRepoId != null) {
          focus.focus(null);
          e.preventDefault();
          return;
        }
        return;
      }

      // Navigation
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        useFocusStore.getState().focusNext();
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        useFocusStore.getState().focusPrev();
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        useFocusStore.getState().focusFirst();
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        useFocusStore.getState().focusLast();
        return;
      }

      // `/` focuses the filter input
      if (e.key === "/") {
        e.preventDefault();
        focusSearchInput();
        return;
      }

      // Bulk shortcuts — Shift+F / Shift+P — dispatched as events the
      // Sidebar handles (keeps bulk-busy state local to it).
      if (e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(SHORTCUT_BULK_FETCH));
        return;
      }
      if (e.shiftKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(SHORTCUT_BULK_PULL));
        return;
      }

      // Focused-row actions
      const focusedId = useFocusStore.getState().focusedRepoId;
      if (focusedId == null) return;
      const status = useReposStore
        .getState()
        .statuses.find((s) => s.id === focusedId);
      if (!status) return;

      if (e.key === " ") {
        e.preventDefault();
        useSelectionStore.getState().toggle(focusedId);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        useUiStore.getState().toggleExpanded(focusedId);
        return;
      }

      // f — fetch
      if (e.key === "f") {
        e.preventDefault();
        void (async () => {
          try {
            await api.gitFetch(focusedId);
            await useReposStore.getState().refreshOne(focusedId);
          } catch (err) {
            useUiStore.getState().openDialog({
              kind: "gitError",
              title: "Fetch failed",
              error: String(err),
              repoId: focusedId,
            });
          }
        })();
        return;
      }
      // p — pull (ff-only)
      if (e.key === "p") {
        e.preventDefault();
        void (async () => {
          try {
            await api.gitPullFf(focusedId);
            await useReposStore.getState().refreshOne(focusedId);
          } catch (err) {
            useUiStore.getState().openDialog({
              kind: "gitError",
              title: "Pull failed",
              error: String(err),
              repoId: focusedId,
            });
          }
        })();
        return;
      }
      // c — commit & push dialog (only makes sense when dirty)
      if (e.key === "c") {
        if (status.dirty === "clean") return;
        e.preventDefault();
        useUiStore.getState().openDialog({
          kind: "commitPush",
          id: status.id,
          name: status.name,
          branch: status.branch,
          defaultBranch: status.defaultBranch,
          hasUpstream: status.hasUpstream,
        });
        return;
      }
      // t — open terminal
      if (e.key === "t") {
        e.preventDefault();
        void api.openTerminal(focusedId).catch((err) => {
          useUiStore.getState().openDialog({
            kind: "info",
            title: "Open terminal failed",
            body: String(err),
          });
        });
        return;
      }
      // o — open remote in browser (no-op if no origin)
      if (e.key === "o") {
        if (!status.remoteUrl) return;
        e.preventDefault();
        void api.openRemote(focusedId).catch((err) => {
          useUiStore.getState().openDialog({
            kind: "info",
            title: "Open remote failed",
            body: String(err),
          });
        });
        return;
      }
      // r — refresh this row (no network)
      if (e.key === "r") {
        e.preventDefault();
        void useReposStore.getState().refreshOne(focusedId);
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
