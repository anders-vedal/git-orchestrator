import {
  ChevronDown,
  ChevronRight,
  Layers,
  Loader2,
  Package,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { timeAgo } from "../../lib/format";
import { useStashesStore } from "../../stores/stashesStore";
import { useUiStore } from "../../stores/uiStore";
import type { StashBundleDetail, StashStatus } from "../../types";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

const STATUS_TONE: Record<StashStatus, string> = {
  pending:
    "border-blue-500/30 bg-blue-500/5 text-blue-300",
  restored:
    "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
  dropped: "border-border bg-surface-0 text-zinc-400",
  missing:
    "border-amber-500/30 bg-amber-500/5 text-amber-300",
  failed: "border-red-500/30 bg-red-500/5 text-red-300",
};

export function StashesDialog() {
  const dialog = useUiStore((s) => s.dialog);
  const openDialog = useUiStore((s) => s.openDialog);
  const closeDialog = useUiStore((s) => s.closeDialog);

  const bundles = useStashesStore((s) => s.bundles);
  const busy = useStashesStore((s) => s.busy);
  const loadAll = useStashesStore((s) => s.loadAll);
  const getDetail = useStashesStore((s) => s.getDetail);
  const restore = useStashesStore((s) => s.restore);
  const remove = useStashesStore((s) => s.remove);

  const open = dialog?.kind === "stashes";

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [details, setDetails] = useState<Record<number, StashBundleDetail>>({});
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [deleteDropRefs, setDeleteDropRefs] = useState(false);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setExpanded(new Set());
    setConfirmDelete(null);
    setDeleteDropRefs(false);
    setRowBusy(null);
    setError(null);
    void loadAll();
  }, [open, loadAll]);

  const toggleExpanded = useCallback(
    async (id: number) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      if (!details[id]) {
        try {
          const d = await getDetail(id);
          setDetails((prev) => ({ ...prev, [id]: d }));
        } catch (e) {
          setError(String(e));
        }
      }
    },
    [details, getDetail],
  );

  async function doRestore(id: number) {
    setRowBusy(id);
    setError(null);
    try {
      const report = await restore(id);
      // Refresh the detail row after restore (status fields change).
      try {
        const d = await getDetail(id);
        setDetails((prev) => ({ ...prev, [id]: d }));
      } catch {
        /* ignore — outcome dialog has the truth */
      }
      closeDialog();
      openDialog({ kind: "stashRestoreResult", report });
    } catch (e) {
      setError(String(e));
    } finally {
      setRowBusy(null);
    }
  }

  async function doDelete(id: number) {
    setRowBusy(id);
    setError(null);
    try {
      await remove(id, deleteDropRefs);
      setConfirmDelete(null);
      setDeleteDropRefs(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={closeDialog}
      title="Stash bundles"
      wide
      footer={<Button onClick={closeDialog}>Close</Button>}
    >
      <div className="flex flex-col gap-3" style={{ maxHeight: "70vh" }}>
        {bundles.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface-0 p-6 text-center text-xs text-zinc-500">
            <Layers
              size={22}
              className="mx-auto mb-2 opacity-40"
              aria-hidden="true"
            />
            No stash bundles yet. Use the “Stash dirty repos” button (bulk
            actions) or queue one from a workspace activation with dirty
            repos.
          </div>
        ) : (
          <div className="overflow-y-auto rounded-md border border-border bg-surface-0">
            {bundles.map((b) => {
              const isOpen = expanded.has(b.id);
              const detail = details[b.id];
              const deleting = confirmDelete === b.id;
              const rowWorking = rowBusy === b.id;
              return (
                <div key={b.id} className="border-b border-border last:border-b-0">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => void toggleExpanded(b.id)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-surface-3 hover:text-zinc-100"
                      title={isOpen ? "Collapse" : "Expand"}
                    >
                      {isOpen ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                    </button>
                    <Package size={12} className="text-zinc-500" />
                    <div className="flex-1 truncate">
                      <div className="truncate text-sm text-zinc-100">
                        {b.label}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {b.pendingCount} pending · {b.entryCount}{" "}
                        {b.entryCount === 1 ? "entry" : "entries"} · created{" "}
                        {timeAgo(b.createdAt)}
                      </div>
                    </div>

                    {deleting ? (
                      <>
                        <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                          <input
                            type="checkbox"
                            checked={deleteDropRefs}
                            onChange={(e) =>
                              setDeleteDropRefs(e.currentTarget.checked)
                            }
                            className="h-3.5 w-3.5 accent-blue-500"
                          />
                          also drop git refs
                        </label>
                        <Button
                          variant="danger"
                          onClick={() => doDelete(b.id)}
                          disabled={rowWorking || busy}
                          icon={
                            rowWorking ? (
                              <Loader2
                                size={14}
                                className="animate-spin"
                              />
                            ) : (
                              <Trash2 size={14} />
                            )
                          }
                        >
                          Delete
                        </Button>
                        <Button
                          onClick={() => {
                            setConfirmDelete(null);
                            setDeleteDropRefs(false);
                          }}
                          disabled={rowWorking}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <IconButton
                          title="Restore — apply every pending entry"
                          tone="primary"
                          onClick={() => doRestore(b.id)}
                          disabled={rowWorking || busy || b.pendingCount === 0}
                        >
                          {rowWorking ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <RotateCcw size={14} />
                          )}
                        </IconButton>
                        <IconButton
                          title="Delete bundle (optionally drop git refs)"
                          tone="danger"
                          onClick={() => setConfirmDelete(b.id)}
                          disabled={rowWorking || busy}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </>
                    )}
                  </div>

                  {isOpen && (
                    <div className="border-t border-border bg-surface-1/40 px-3 py-2">
                      {!detail ? (
                        <div className="flex items-center gap-2 text-xs text-zinc-400">
                          <Loader2 size={12} className="animate-spin" />{" "}
                          Loading entries…
                        </div>
                      ) : detail.entries.length === 0 ? (
                        <div className="text-xs text-zinc-500">
                          No entries.
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {detail.entries.map((e) => (
                            <div
                              key={`${b.id}-${e.repoId}`}
                              className="flex items-center gap-2 rounded border border-border bg-surface-0 px-2 py-1.5 text-[12px] text-zinc-100"
                            >
                              <span className="flex-1 truncate">
                                {e.repoName}
                              </span>
                              {e.branchAtStash && (
                                <span className="truncate font-mono text-[11px] text-zinc-400">
                                  {e.branchAtStash}
                                </span>
                              )}
                              <span
                                className="font-mono text-[11px] text-zinc-500"
                                title={e.stashSha}
                              >
                                {e.stashShort}
                              </span>
                              <span
                                className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${STATUS_TONE[e.status]}`}
                              >
                                {e.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
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
