import {
  Check,
  Edit3,
  Layers,
  Loader2,
  Play,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { timeAgo } from "../../lib/format";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspacesStore } from "../../stores/workspacesStore";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

export function ManageWorkspacesDialog() {
  const dialog = useUiStore((s) => s.dialog);
  const openDialog = useUiStore((s) => s.openDialog);
  const closeDialog = useUiStore((s) => s.closeDialog);

  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const activeId = useWorkspacesStore((s) => s.activeId);
  const activating = useWorkspacesStore((s) => s.activating);
  const loadAll = useWorkspacesStore((s) => s.loadAll);
  const activate = useWorkspacesStore((s) => s.activate);
  const remove = useWorkspacesStore((s) => s.remove);
  const rename = useWorkspacesStore((s) => s.rename);

  const open = dialog?.kind === "manageWorkspaces";

  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRenameId(null);
    setConfirmDeleteId(null);
    setError(null);
    void loadAll();
  }, [open, loadAll]);

  async function doRename(id: number) {
    const value = renameValue.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      await rename(id, value);
      setRenameId(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(id: number) {
    setBusy(true);
    setError(null);
    try {
      await remove(id);
      setConfirmDeleteId(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doActivate(id: number) {
    setError(null);
    try {
      const report = await activate(id);
      closeDialog();
      openDialog({ kind: "workspaceActivationResult", report });
    } catch (e) {
      setError(String(e));
    }
  }

  function startEdit(id: number) {
    closeDialog();
    openDialog({ kind: "createWorkspace", editId: id });
  }

  return (
    <Dialog
      open={open}
      onClose={closeDialog}
      title="Manage workspaces"
      wide
      footer={<Button onClick={closeDialog}>Close</Button>}
    >
      <div className="flex flex-col gap-3" style={{ maxHeight: "70vh" }}>
        {workspaces.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface-0 p-6 text-center text-xs text-zinc-500">
            <Layers
              size={20}
              className="mx-auto mb-2 opacity-40"
              aria-hidden="true"
            />
            No workspaces yet. Select repos in the list, then use “Create
            workspace from selection…” in the workspace switcher.
          </div>
        ) : (
          <div className="overflow-y-auto rounded-md border border-border bg-surface-0">
            {workspaces.map((w) => {
              const isActive = activeId === w.id;
              const isRenaming = renameId === w.id;
              const isConfirming = confirmDeleteId === w.id;
              return (
                <div
                  key={w.id}
                  className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0"
                >
                  <div className="flex-1">
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) =>
                          setRenameValue(e.currentTarget.value)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void doRename(w.id);
                          if (e.key === "Escape") setRenameId(null);
                        }}
                        maxLength={80}
                        className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-zinc-100 focus:border-blue-400 focus:outline-none"
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm text-zinc-100">
                          {w.name}
                        </span>
                        {isActive && (
                          <span className="rounded border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-300">
                            active
                          </span>
                        )}
                      </div>
                    )}
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {w.repoCount} {w.repoCount === 1 ? "repo" : "repos"} ·
                      updated {timeAgo(w.updatedAt)}
                    </div>
                  </div>

                  {isRenaming ? (
                    <>
                      <IconButton
                        title="Save new name"
                        tone="primary"
                        onClick={() => doRename(w.id)}
                        disabled={busy}
                      >
                        {busy ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Check size={14} />
                        )}
                      </IconButton>
                      <IconButton
                        title="Cancel"
                        onClick={() => setRenameId(null)}
                        disabled={busy}
                      >
                        <X size={14} />
                      </IconButton>
                    </>
                  ) : isConfirming ? (
                    <>
                      <span className="text-[11px] text-red-300">
                        Delete workspace?
                      </span>
                      <Button
                        variant="danger"
                        onClick={() => doDelete(w.id)}
                        disabled={busy}
                        icon={
                          busy ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )
                        }
                      >
                        Delete
                      </Button>
                      <Button
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <IconButton
                        title="Activate — switch every listed repo to its branch"
                        tone="primary"
                        onClick={() => doActivate(w.id)}
                        disabled={activating}
                      >
                        {activating ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Play size={14} />
                        )}
                      </IconButton>
                      <IconButton
                        title="Edit entries"
                        onClick={() => startEdit(w.id)}
                      >
                        <Edit3 size={14} />
                      </IconButton>
                      <IconButton
                        title="Rename"
                        onClick={() => {
                          setRenameValue(w.name);
                          setRenameId(w.id);
                        }}
                      >
                        <span className="text-xs font-semibold">Aa</span>
                      </IconButton>
                      <IconButton
                        title="Delete"
                        tone="danger"
                        onClick={() => setConfirmDeleteId(w.id)}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}
