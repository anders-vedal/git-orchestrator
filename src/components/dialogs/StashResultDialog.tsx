import {
  AlertTriangle,
  CheckCircle2,
  Layers,
  SkipForward,
  XCircle,
} from "lucide-react";
import { useMemo } from "react";
import { useUiStore } from "../../stores/uiStore";
import type {
  StashPushKind,
  StashPushOutcome,
  StashRestoreKind,
  StashRestoreOutcome,
} from "../../types";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

const TONES: Record<string, string> = {
  good: "border-emerald-500/30 bg-emerald-500/5 text-emerald-200",
  warn: "border-amber-500/30 bg-amber-500/5 text-amber-200",
  bad: "border-red-500/30 bg-red-500/5 text-red-200",
  muted: "border-border bg-surface-0 text-zinc-300",
};

/** Renders the push report. Reused for the post-stash outcomes dialog. */
export function StashPushResultDialog() {
  const dialog = useUiStore((s) => s.dialog);
  const closeDialog = useUiStore((s) => s.closeDialog);
  const openDialog = useUiStore((s) => s.openDialog);

  const open = dialog?.kind === "stashPushResult";
  const report = dialog?.kind === "stashPushResult" ? dialog.report : null;

  const groups = useMemo(() => {
    if (!report) return [] as {
      title: string;
      tone: string;
      icon: typeof CheckCircle2;
      rows: StashPushOutcome[];
    }[];
    const pushGroups: {
      kinds: StashPushKind[];
      title: string;
      tone: string;
      icon: typeof CheckCircle2;
    }[] = [
      { kinds: ["stashed"], title: "Stashed", tone: "good", icon: CheckCircle2 },
      {
        kinds: ["nothing_to_stash"],
        title: "Nothing to stash (already clean)",
        tone: "muted",
        icon: SkipForward,
      },
      {
        kinds: ["skipped_missing_repo"],
        title: "Skipped — missing",
        tone: "warn",
        icon: AlertTriangle,
      },
      { kinds: ["failed"], title: "Failed", tone: "bad", icon: XCircle },
    ];
    return pushGroups
      .map((g) => ({
        ...g,
        rows: report.outcomes.filter((o) => g.kinds.includes(o.kind)),
      }))
      .filter((g) => g.rows.length > 0);
  }, [report]);

  if (!report) return null;

  const stashedCount = report.outcomes.filter((o) => o.kind === "stashed").length;
  const hasBundle = report.bundleId != null;

  return (
    <Dialog
      open={open}
      onClose={closeDialog}
      title={
        hasBundle
          ? `Stashed as "${report.label}"`
          : `No stash created — "${report.label}"`
      }
      wide
      footer={
        <>
          <Button onClick={closeDialog}>Close</Button>
          {hasBundle && (
            <Button
              variant="primary"
              onClick={() => {
                closeDialog();
                openDialog({ kind: "stashes" });
              }}
              icon={<Layers size={14} />}
            >
              Open stash bundles
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3" style={{ maxHeight: "70vh" }}>
        <div className="text-xs text-zinc-400">
          {stashedCount} of {report.outcomes.length}{" "}
          {report.outcomes.length === 1 ? "repo" : "repos"} stashed.
          {hasBundle && (
            <>
              {" "}
              Bundle ID{" "}
              <code className="rounded bg-surface-3 px-1 font-mono text-[10px]">
                {report.bundleId}
              </code>
              .
            </>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {groups.map((g) => {
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
                        {o.stashSha && (
                          <span className="truncate font-mono text-[11px] text-zinc-400">
                            {o.stashSha.slice(0, 7)}
                          </span>
                        )}
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

/** Renders the restore report. */
export function StashRestoreResultDialog() {
  const dialog = useUiStore((s) => s.dialog);
  const closeDialog = useUiStore((s) => s.closeDialog);
  const openDialog = useUiStore((s) => s.openDialog);

  const open = dialog?.kind === "stashRestoreResult";
  const report = dialog?.kind === "stashRestoreResult" ? dialog.report : null;

  const groups = useMemo(() => {
    if (!report) return [] as {
      title: string;
      tone: string;
      icon: typeof CheckCircle2;
      rows: StashRestoreOutcome[];
    }[];
    const restoreGroups: {
      kinds: StashRestoreKind[];
      title: string;
      tone: string;
      icon: typeof CheckCircle2;
    }[] = [
      {
        kinds: ["restored"],
        title: "Restored",
        tone: "good",
        icon: CheckCircle2,
      },
      {
        kinds: ["already_done"],
        title: "Already applied",
        tone: "muted",
        icon: SkipForward,
      },
      {
        kinds: ["missing"],
        title: "Missing (stash ref gone)",
        tone: "warn",
        icon: AlertTriangle,
      },
      {
        kinds: ["skipped_missing_repo"],
        title: "Skipped — missing repo",
        tone: "warn",
        icon: AlertTriangle,
      },
      { kinds: ["failed"], title: "Failed (likely conflicts)", tone: "bad", icon: XCircle },
    ];
    return restoreGroups
      .map((g) => ({
        ...g,
        rows: report.outcomes.filter((o) => g.kinds.includes(o.kind)),
      }))
      .filter((g) => g.rows.length > 0);
  }, [report]);

  if (!report) return null;

  const restoredCount = report.outcomes.filter((o) => o.kind === "restored").length;

  return (
    <Dialog
      open={open}
      onClose={closeDialog}
      title={`Restored "${report.label}"`}
      wide
      footer={
        <>
          <Button onClick={closeDialog}>Close</Button>
          <Button
            onClick={() => {
              closeDialog();
              openDialog({ kind: "stashes" });
            }}
            icon={<Layers size={14} />}
          >
            Back to stashes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" style={{ maxHeight: "70vh" }}>
        <div className="text-xs text-zinc-400">
          {restoredCount} of {report.outcomes.length}{" "}
          {report.outcomes.length === 1 ? "entry" : "entries"} restored. Group
          ID{" "}
          <code className="rounded bg-surface-3 px-1 font-mono text-[10px]">
            {report.groupId}
          </code>
          .
        </div>

        <div className="flex-1 overflow-y-auto">
          {groups.map((g) => {
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
                        <span className="truncate font-mono text-[11px] text-zinc-400">
                          {o.stashSha.slice(0, 7)}
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
