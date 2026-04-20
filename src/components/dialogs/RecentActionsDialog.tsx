import {
  AlertOctagon,
  ArrowLeftRight,
  Clock,
  History,
  Layers,
  Loader2,
  RefreshCcw,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { timeAgo } from "../../lib/format";
import * as api from "../../lib/tauri";
import { useReposStore } from "../../stores/reposStore";
import { useUiStore } from "../../stores/uiStore";
import type { RecentActionGroup } from "../../types";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

type ActionCategory = "workspace" | "stash-push" | "stash-apply" | "undo" | "other";

interface ActionMeta {
  title: string;
  icon: typeof Clock;
  tint: string;
  category: ActionCategory;
}

function actionMeta(action: string): ActionMeta {
  switch (action) {
    case "workspace_activate":
      return {
        title: "Workspace activation",
        icon: ArrowLeftRight,
        tint: "text-blue-300",
        category: "workspace",
      };
    case "stash_push":
      return {
        title: "Stash bundle pushed",
        icon: Layers,
        tint: "text-amber-300",
        category: "stash-push",
      };
    case "stash_apply":
      return {
        title: "Stash bundle restored",
        icon: Layers,
        tint: "text-emerald-300",
        category: "stash-apply",
      };
    case "undo_group":
      return {
        title: "Undo (group)",
        icon: Undo2,
        tint: "text-purple-300",
        category: "undo",
      };
    default:
      return {
        title: action,
        icon: AlertOctagon,
        tint: "text-zinc-300",
        category: "other",
      };
  }
}

const FILTERS: { value: "all" | ActionCategory; label: string }[] = [
  { value: "all", label: "All" },
  { value: "workspace", label: "Workspace" },
  { value: "stash-push", label: "Stash ▸" },
  { value: "stash-apply", label: "Stash ◂" },
  { value: "undo", label: "Undo" },
];

export function RecentActionsDialog() {
  const dialog = useUiStore((s) => s.dialog);
  const closeDialog = useUiStore((s) => s.closeDialog);
  const openDialog = useUiStore((s) => s.openDialog);
  const refreshOne = useReposStore((s) => s.refreshOne);

  const open = dialog?.kind === "recentActions";

  const [entries, setEntries] = useState<RecentActionGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | ActionCategory>("all");
  const [undoing, setUndoing] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await api.listRecentActionGroups(50));
    } catch (e) {
      setError(String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) {
      setFilter("all");
      setUndoError(null);
    }
  }, [open]);

  const visible = useMemo(() => {
    if (filter === "all") return entries;
    return entries.filter((e) => actionMeta(e.action).category === filter);
  }, [entries, filter]);

  async function onUndo(group: RecentActionGroup) {
    setUndoing(group.groupId);
    setUndoError(null);
    try {
      const report = await api.undoActionGroup(group.groupId);
      for (const o of report.outcomes) {
        if (o.kind === "reverted") {
          try {
            await refreshOne(o.repoId);
          } catch {
            /* ignore */
          }
        }
      }
      closeDialog();
      openDialog({
        kind: "undoGroupResult",
        report,
        sourceLabel: actionMeta(group.action).title.toLowerCase(),
      });
    } catch (e) {
      setUndoError(String(e));
    } finally {
      setUndoing(null);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={closeDialog}
      title="Recent multi-repo actions"
      wide
      footer={
        <>
          <Button onClick={closeDialog}>Close</Button>
          <Button
            onClick={() => void load()}
            icon={
              loading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCcw size={14} />
              )
            }
            disabled={loading}
          >
            Refresh
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" style={{ maxHeight: "70vh" }}>
        <div className="flex items-center gap-1.5 text-[11px]">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-full border px-2 py-0.5 transition-colors ${
                filter === f.value
                  ? "border-blue-400 bg-blue-500/10 text-blue-200"
                  : "border-border bg-surface-2 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto text-zinc-500">
            {visible.length} of {entries.length} events
          </span>
        </div>

        {undoError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-300">
            {undoError}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading && entries.length === 0 ? (
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Loader2 size={12} className="animate-spin" /> loading…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-8 text-center text-xs text-zinc-500">
              <History size={20} className="text-zinc-600" />
              <div>No recent multi-repo actions.</div>
              <div className="text-zinc-600">
                Actions appear here after you activate a workspace or create a
                stash bundle.
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {visible.map((g) => (
                <Row key={g.groupId} group={g} undoing={undoing} onUndo={onUndo} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function Row({
  group,
  undoing,
  onUndo,
}: {
  group: RecentActionGroup;
  undoing: string | null;
  onUndo: (g: RecentActionGroup) => void;
}) {
  const meta = actionMeta(group.action);
  const Icon = meta.icon;
  const partial = group.successCount < group.repoCount;
  const undoable = group.headMoveCount > 0;
  const isUndoing = undoing === group.groupId;

  const repoPreview = group.repoNames.length
    ? group.repoNames.join(", ") + (group.repoNamesTruncated ? ", …" : "")
    : "(no repos)";

  return (
    <li className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-2.5 py-2">
      <Icon size={16} className={meta.tint} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2 text-[13px] text-zinc-100">
          <span className="font-medium">{meta.title}</span>
          {partial && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
              {group.successCount}/{group.repoCount} succeeded
            </span>
          )}
          {!partial && (
            <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300">
              {group.repoCount} {group.repoCount === 1 ? "repo" : "repos"}
            </span>
          )}
        </div>
        <div className="truncate font-mono text-[11px] text-zinc-500">
          {repoPreview}
        </div>
      </div>
      <div
        className="shrink-0 text-[11px] text-zinc-500"
        title={new Date(group.occurredAt).toLocaleString()}
      >
        {timeAgo(group.occurredAt)}
      </div>
      {undoable ? (
        <IconButton
          title={
            isUndoing
              ? "Undoing…"
              : `Roll every repo back to its pre-${meta.title.toLowerCase()} HEAD. Repos where HEAD has moved since are skipped.`
          }
          tone="primary"
          onClick={() => onUndo(group)}
          disabled={!!undoing}
        >
          {isUndoing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Undo2 size={14} />
          )}
        </IconButton>
      ) : (
        <span
          className="text-[10px] text-zinc-600"
          title={
            meta.category === "stash-push" || meta.category === "stash-apply"
              ? "Stash operations don't move HEAD — nothing to undo at the commit level. Manage via Stash bundles instead."
              : "No HEAD-moving legs in this group."
          }
        >
          —
        </span>
      )}
    </li>
  );
}
