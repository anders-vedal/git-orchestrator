import { ChevronDown, Layers, Loader2, Play, Plus, Settings2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSelectionStore } from "../stores/selectionStore";
import { useUiStore } from "../stores/uiStore";
import { useWorkspacesStore } from "../stores/workspacesStore";

export function WorkspaceSwitcher() {
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const activeId = useWorkspacesStore((s) => s.activeId);
  const activating = useWorkspacesStore((s) => s.activating);
  const activate = useWorkspacesStore((s) => s.activate);
  const clearActive = useWorkspacesStore((s) => s.clearActive);

  const openDialog = useUiStore((s) => s.openDialog);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const hasSelection = selectedIds.size > 0;

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeName =
    activeId != null
      ? (workspaces.find((w) => w.id === activeId)?.name ?? null)
      : null;

  // Close the menu on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pickWorkspace = useCallback(
    async (id: number) => {
      setOpen(false);
      try {
        const report = await activate(id);
        openDialog({ kind: "workspaceActivationResult", report });
      } catch (e) {
        openDialog({
          kind: "gitError",
          title: "Activate workspace failed",
          error: String(e),
        });
      }
    },
    [activate, openDialog],
  );

  const createFromSelection = useCallback(() => {
    setOpen(false);
    openDialog({
      kind: "createWorkspace",
      seedRepoIds: Array.from(selectedIds),
    });
  }, [openDialog, selectedIds]);

  const openManage = useCallback(() => {
    setOpen(false);
    openDialog({ kind: "manageWorkspaces" });
  }, [openDialog]);

  const doClearActive = useCallback(() => {
    setOpen(false);
    void clearActive();
  }, [clearActive]);

  const label = activating
    ? "Activating…"
    : (activeName ?? "No workspace");

  return (
    <div ref={rootRef} className="relative mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-left text-sm text-zinc-100 hover:border-border-strong hover:bg-surface-3"
        title={
          activeName
            ? `Active workspace: ${activeName}. Click to switch.`
            : "Workspace switcher — bundle multiple repo+branch pairs and activate them together."
        }
      >
        {activating ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-blue-300" />
        ) : (
          <Layers
            size={14}
            className={
              activeName ? "shrink-0 text-blue-300" : "shrink-0 text-zinc-500"
            }
          />
        )}
        <span
          className={`flex-1 truncate ${activeName ? "" : "italic text-zinc-500"}`}
        >
          {label}
        </span>
        <ChevronDown size={12} className="shrink-0 text-zinc-500" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-md border border-border-strong bg-surface-1 py-1 shadow-xl"
        >
          {workspaces.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-500">
              No workspaces yet.
            </div>
          ) : (
            workspaces.map((w) => {
              const isActive = w.id === activeId;
              return (
                <button
                  key={w.id}
                  type="button"
                  role="menuitem"
                  onClick={() => pickWorkspace(w.id)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-3 ${
                    isActive ? "text-blue-300" : "text-zinc-100"
                  }`}
                >
                  <Play size={10} className="shrink-0 opacity-60" />
                  <span className="flex-1 truncate">{w.name}</span>
                  <span className="text-[10px] text-zinc-500">
                    {w.repoCount}
                  </span>
                </button>
              );
            })
          )}

          <div className="my-1 border-t border-border" />

          <button
            type="button"
            role="menuitem"
            onClick={createFromSelection}
            disabled={!hasSelection}
            title={
              hasSelection
                ? `Create a workspace from the ${selectedIds.size} selected repo${
                    selectedIds.size === 1 ? "" : "s"
                  }`
                : "Select one or more repos in the list first"
            }
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={12} className="shrink-0" />
            Create workspace from selection
            {hasSelection && (
              <span className="ml-auto text-[10px] text-zinc-500">
                ({selectedIds.size})
              </span>
            )}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={openManage}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-surface-3"
          >
            <Settings2 size={12} className="shrink-0" />
            Manage workspaces…
          </button>
          {activeId != null && (
            <button
              type="button"
              role="menuitem"
              onClick={doClearActive}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-400 hover:bg-surface-3 hover:text-zinc-200"
            >
              Clear active
            </button>
          )}
        </div>
      )}
    </div>
  );
}
