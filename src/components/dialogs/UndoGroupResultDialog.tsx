import {
  AlertTriangle,
  CheckCircle2,
  SkipForward,
  Undo2,
  XCircle,
} from "lucide-react";
import { useMemo } from "react";
import { useReposStore } from "../../stores/reposStore";
import { useUiStore } from "../../stores/uiStore";
import type { UndoGroupKind, UndoGroupOutcome } from "../../types";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

const TONES: Record<string, string> = {
  good: "border-emerald-500/30 bg-emerald-500/5 text-emerald-200",
  warn: "border-amber-500/30 bg-amber-500/5 text-amber-200",
  bad: "border-red-500/30 bg-red-500/5 text-red-200",
  muted: "border-border bg-surface-0 text-zinc-300",
};

const GROUPS: ReadonlyArray<{
  kinds: UndoGroupKind[];
  title: string;
  tone: "good" | "warn" | "bad" | "muted";
  icon: typeof CheckCircle2;
}> = [
  {
    kinds: ["reverted"],
    title: "Reverted",
    tone: "good",
    icon: Undo2,
  },
  {
    kinds: ["skipped_no_head_move", "skipped_original_failed"],
    title: "Nothing to undo",
    tone: "muted",
    icon: SkipForward,
  },
  {
    kinds: ["skipped_dirty", "skipped_head_moved", "skipped_no_pre_head"],
    title: "Skipped — repo state changed",
    tone: "warn",
    icon: AlertTriangle,
  },
  {
    kinds: ["skipped_missing_repo", "skipped_missing_commit"],
    title: "Skipped — resource gone",
    tone: "warn",
    icon: AlertTriangle,
  },
  { kinds: ["failed"], title: "Failed", tone: "bad", icon: XCircle },
];

export function UndoGroupResultDialog() {
  const dialog = useUiStore((s) => s.dialog);
  const closeDialog = useUiStore((s) => s.closeDialog);
  const refreshOne = useReposStore((s) => s.refreshOne);

  const open = dialog?.kind === "undoGroupResult";
  const report = dialog?.kind === "undoGroupResult" ? dialog.report : null;
  const sourceLabel =
    dialog?.kind === "undoGroupResult" ? dialog.sourceLabel : "";

  const grouped = useMemo(() => {
    if (!report)
      return [] as {
        title: string;
        tone: string;
        icon: typeof CheckCircle2;
        rows: UndoGroupOutcome[];
      }[];
    return GROUPS.map((g) => ({
      ...g,
      rows: report.outcomes.filter((o) => g.kinds.includes(o.kind)),
    })).filter((g) => g.rows.length > 0);
  }, [report]);

  async function refreshAffected() {
    if (!report) return;
    const ids = report.outcomes
      .filter((o) => o.kind === "reverted")
      .map((o) => o.repoId);
    for (const id of ids) {
      try {
        await refreshOne(id);
      } catch {
        /* row-level errors surface on the repo card */
      }
    }
  }

  if (!report) return null;

  const revertedCount = report.outcomes.filter(
    (o) => o.kind === "reverted",
  ).length;
  const total = report.outcomes.length;

  return (
    <Dialog
      open={open}
      onClose={closeDialog}
      title={`Undo: ${sourceLabel}`}
      wide
      footer={
        <>
          <Button onClick={closeDialog}>Close</Button>
          {revertedCount > 0 && (
            <Button
              variant="primary"
              onClick={async () => {
                await refreshAffected();
                closeDialog();
              }}
            >
              Refresh affected & close
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3" style={{ maxHeight: "70vh" }}>
        <div className="text-xs text-zinc-400">
          {revertedCount} of {total} {total === 1 ? "repo" : "repos"} rolled back.
          {report.undoGroupId && (
            <>
              {" "}
              Undo group ID{" "}
              <code className="rounded bg-surface-3 px-1 font-mono text-[10px]">
                {report.undoGroupId}
              </code>
              .
            </>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {grouped.map((g) => {
            const Icon = g.icon;
            return (
              <div
                key={g.title}
                className={`mb-2 rounded-md border p-2 ${TONES[g.tone]}`}
              >
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
                  <Icon size={12} /> {g.title} ({g.rows.length})
                </div>
                <div className="flex flex-col gap-1">
                  {g.rows.map((o) => (
                    <div
                      key={`${o.repoId}-${o.action}`}
                      className="rounded border border-border bg-surface-1/40 px-2 py-1.5"
                    >
                      <div className="flex items-center gap-2 text-[12px] text-zinc-100">
                        <span className="truncate font-medium">
                          {o.repoName}
                        </span>
                        {o.fromShort && o.targetShort && (
                          <span className="truncate font-mono text-[11px] text-zinc-400">
                            {o.fromShort} → {o.targetShort}
                          </span>
                        )}
                        <span className="ml-auto rounded bg-surface-3 px-1 font-mono text-[10px] text-zinc-300">
                          {o.action}
                        </span>
                      </div>
                      {o.message && (
                        <div className="mt-0.5 whitespace-pre-wrap font-mono text-[10px] text-zinc-400">
                          {o.message}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}
