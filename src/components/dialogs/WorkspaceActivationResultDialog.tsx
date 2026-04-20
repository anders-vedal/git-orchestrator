import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  Package,
  RefreshCcw,
  SkipForward,
  Undo2,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import * as api from "../../lib/tauri";
import { useReposStore } from "../../stores/reposStore";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspacesStore } from "../../stores/workspacesStore";
import type { ActivationKind, ActivationOutcome } from "../../types";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

const GROUPS: ReadonlyArray<{
  kinds: ActivationKind[];
  title: string;
  tone: "good" | "warn" | "bad" | "muted";
  icon: typeof CheckCircle2;
}> = [
  {
    kinds: ["switched", "tracked"],
    title: "Switched",
    tone: "good",
    icon: CheckCircle2,
  },
  {
    kinds: ["already_on"],
    title: "Already on branch",
    tone: "muted",
    icon: Circle,
  },
  {
    kinds: ["skipped_dirty"],
    title: "Skipped — uncommitted changes",
    tone: "warn",
    icon: SkipForward,
  },
  {
    kinds: ["skipped_missing_branch", "skipped_missing_repo"],
    title: "Skipped — missing",
    tone: "warn",
    icon: AlertTriangle,
  },
  { kinds: ["failed"], title: "Failed", tone: "bad", icon: XCircle },
];

const TONES: Record<string, string> = {
  good: "border-emerald-500/30 bg-emerald-500/5 text-emerald-200",
  warn: "border-amber-500/30 bg-amber-500/5 text-amber-200",
  bad: "border-red-500/30 bg-red-500/5 text-red-200",
  muted: "border-border bg-surface-0 text-zinc-300",
};

export function WorkspaceActivationResultDialog() {
  const dialog = useUiStore((s) => s.dialog);
  const openDialog = useUiStore((s) => s.openDialog);
  const closeDialog = useUiStore((s) => s.closeDialog);
  const refreshOne = useReposStore((s) => s.refreshOne);
  const activate = useWorkspacesStore((s) => s.activate);

  const open = dialog?.kind === "workspaceActivationResult";
  const report =
    dialog?.kind === "workspaceActivationResult" ? dialog.report : null;

  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    if (!report) return [];
    return GROUPS.map((g) => ({
      ...g,
      rows: report.outcomes.filter((o) => g.kinds.includes(o.kind)),
    })).filter((g) => g.rows.length > 0);
  }, [report]);

  const retryable = useMemo(() => {
    if (!report) return [] as ActivationOutcome[];
    return report.outcomes.filter(
      (o) => o.kind === "skipped_dirty" || o.kind === "failed",
    );
  }, [report]);

  const dirtyRepoIds = useMemo(() => {
    if (!report) return [] as number[];
    return report.outcomes
      .filter((o) => o.kind === "skipped_dirty")
      .map((o) => o.repoId);
  }, [report]);

  async function retry() {
    if (!report) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const next = await activate(report.workspaceId);
      // Replace the dialog's report without closing — re-open with new data.
      useUiStore
        .getState()
        .openDialog({ kind: "workspaceActivationResult", report: next });
    } catch (e) {
      setRetryError(String(e));
    } finally {
      setRetrying(false);
    }
  }

  async function undo() {
    if (!report) return;
    setUndoing(true);
    setUndoError(null);
    try {
      const undoReport = await api.undoActionGroup(report.groupId);
      // Refresh repos whose HEAD just moved back so the row pills stay honest.
      for (const o of undoReport.outcomes) {
        if (o.kind === "reverted") {
          try {
            await refreshOne(o.repoId);
          } catch {
            /* ignore — row errors surface on the card */
          }
        }
      }
      closeDialog();
      openDialog({
        kind: "undoGroupResult",
        report: undoReport,
        sourceLabel: `workspace "${report.workspaceName}"`,
      });
    } catch (e) {
      setUndoError(String(e));
    } finally {
      setUndoing(false);
    }
  }

  async function refreshAffected() {
    if (!report) return;
    // Refresh only the repos that switched/tracked — their branch pills are
    // stale. Sequential keeps the UI from thrashing for 20-repo workspaces.
    const ids = report.outcomes
      .filter((o) => o.kind === "switched" || o.kind === "tracked")
      .map((o) => o.repoId);
    for (const id of ids) {
      try {
        await refreshOne(id);
      } catch {
        /* ignore — errors surface on the row itself */
      }
    }
  }

  if (!report) return null;

  const total = report.outcomes.length;
  const switchedCount = report.outcomes.filter(
    (o) => o.kind === "switched" || o.kind === "tracked",
  ).length;

  return (
    <Dialog
      open={open}
      onClose={closeDialog}
      title={`Activated "${report.workspaceName}"`}
      wide
      footer={
        <>
          <Button onClick={closeDialog}>Close</Button>
          {switchedCount > 0 && (
            <Button
              onClick={undo}
              disabled={undoing}
              icon={
                undoing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Undo2 size={14} />
                )
              }
              title="Roll every switched repo back to the branch it was on before this activation. Repos that became dirty or that you've moved HEAD on since are skipped."
            >
              Undo activation
            </Button>
          )}
          {switchedCount > 0 && (
            <Button
              onClick={refreshAffected}
              icon={<RefreshCcw size={14} />}
              title="Re-read status for the repos that switched"
            >
              Refresh affected
            </Button>
          )}
          {dirtyRepoIds.length > 0 && (
            <Button
              onClick={() => {
                closeDialog();
                openDialog({
                  kind: "createStash",
                  seedRepoIds: dirtyRepoIds,
                  thenActivateWorkspaceId: report.workspaceId,
                  suggestedLabel: `pre-activate: ${report.workspaceName}`,
                });
              }}
              icon={<Package size={14} />}
              title="Stash dirty repos in a labelled bundle, then re-run the workspace activation. Restore the bundle later from Stash bundles."
            >
              Stash dirty & retry ({dirtyRepoIds.length})
            </Button>
          )}
          {retryable.length > 0 && (
            <Button
              variant="primary"
              onClick={retry}
              disabled={retrying}
              icon={
                retrying ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCcw size={14} />
                )
              }
              title="Re-run the activation — useful after you've committed or stashed dirty repos."
            >
              Retry skipped ({retryable.length})
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3" style={{ maxHeight: "70vh" }}>
        <div className="text-xs text-zinc-400">
          {switchedCount} of {total}{" "}
          {total === 1 ? "repo" : "repos"} switched. Group ID{" "}
          <code className="rounded bg-surface-3 px-1 font-mono text-[10px]">
            {report.groupId}
          </code>
          .
        </div>

        {retryError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-300">
            {retryError}
          </div>
        )}

        {undoError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-300">
            {undoError}
          </div>
        )}

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
                      key={o.repoId}
                      className="rounded border border-border bg-surface-1/40 px-2 py-1.5"
                    >
                      <div className="flex items-center gap-2 text-[12px] text-zinc-100">
                        <span className="truncate font-medium">
                          {o.repoName}
                        </span>
                        <span className="text-zinc-500">→</span>
                        <span className="truncate font-mono text-xs text-zinc-300">
                          {o.requestedBranch}
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
