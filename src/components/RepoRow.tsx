import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import {
  AlertCircle,
  ArrowUpFromLine,
  Boxes,
  CheckCircle2,
  FileWarning,
  FilePlus,
  FileEdit,
  GitBranch,
  GitFork,
  GripVertical,
  Pencil,
  RefreshCcw,
  Trash2,
  Loader2,
  MinusCircle,
  Circle,
} from "lucide-react";
import { useState } from "react";
import { firstLine, timeAgo, truncate } from "../lib/format";
import { useReposStore } from "../stores/reposStore";
import { useUiStore } from "../stores/uiStore";
import type { Dirty, RepoStatus } from "../types";
import { RepoActions } from "./RepoActions";
import { RepoChangesPanel } from "./RepoChangesPanel";
import { RepoLogPanel } from "./RepoLogPanel";
import { IconButton } from "./ui/Button";
import { Pill } from "./ui/Pill";

interface Props {
  status: RepoStatus;
  dragDisabled?: boolean;
}

const DIRTY_TOOLTIPS: Record<Dirty, string> = {
  clean: "Working tree matches HEAD — no local changes.",
  untracked:
    "New files exist that git isn't tracking yet. They won't be pushed until `git add` + commit.",
  unstaged:
    "Tracked files have edits that haven't been added to the index. Run `git add` to stage them, or discard with `git restore`.",
  staged:
    "Changes are in the index, ready to commit. Run `git commit` to record them.",
  mixed:
    "A combination of staged, unstaged, and/or untracked changes — typically because some edits were staged and others came in after.",
};

function dirtyPill(dirty: Dirty) {
  const tip = DIRTY_TOOLTIPS[dirty];
  switch (dirty) {
    case "clean":
      return (
        <Pill tone="green" icon={<CheckCircle2 size={12} />} title={tip}>
          clean
        </Pill>
      );
    case "untracked":
      return (
        <Pill tone="yellow" icon={<FilePlus size={12} />} title={tip}>
          untracked
        </Pill>
      );
    case "unstaged":
      return (
        <Pill tone="yellow" icon={<FileEdit size={12} />} title={tip}>
          unstaged
        </Pill>
      );
    case "staged":
      return (
        <Pill tone="blue" icon={<FileEdit size={12} />} title={tip}>
          staged
        </Pill>
      );
    case "mixed":
      return (
        <Pill tone="red" icon={<FileWarning size={12} />} title={tip}>
          mixed
        </Pill>
      );
  }
}

export function RepoRow({ status, dragDisabled = false }: Props) {
  const isExpanded = useUiStore((s) => s.expandedIds.has(status.id));
  const openDialog = useUiStore((s) => s.openDialog);
  const refreshOne = useReposStore((s) => s.refreshOne);
  const renameRepo = useReposStore((s) => s.rename);
  const refreshing = useReposStore((s) => s.refreshingIds.has(status.id));
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(status.name);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: status.id, disabled: dragDisabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const hasUpstream = status.hasUpstream;
  const aheadBehind = status.diverged ? (
    <Pill
      tone="red"
      icon={<GitFork size={12} />}
      title={`Branch has diverged: ${status.ahead} ahead, ${status.behind} behind. Fast-forward pull will refuse — open terminal to merge or rebase.`}
    >
      diverged ↑{status.ahead} ↓{status.behind}
    </Pill>
  ) : hasUpstream ? (
    <div className="flex items-center gap-1 text-xs text-zinc-400">
      <Pill
        tone={status.ahead > 0 ? "blue" : "neutral"}
        title="Commits ahead of upstream"
      >
        ↑ {status.ahead}
      </Pill>
      <Pill
        tone={status.behind > 0 ? "yellow" : "neutral"}
        title="Commits behind upstream"
      >
        ↓ {status.behind}
      </Pill>
    </div>
  ) : status.unpushedNoUpstream !== null && status.unpushedNoUpstream > 0 ? (
    <Pill
      tone="yellow"
      icon={<ArrowUpFromLine size={12} />}
      title={`${status.unpushedNoUpstream} commit(s) on this branch are not on origin/${status.defaultBranch}. No upstream is configured — push manually or set upstream.`}
    >
      {status.unpushedNoUpstream} unpushed
    </Pill>
  ) : (
    <Pill tone="neutral" icon={<MinusCircle size={12} />} title="No upstream configured">
      no upstream
    </Pill>
  );

  async function commitRename() {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== status.name) {
      try {
        await renameRepo(status.id, trimmed);
      } catch (e) {
        openDialog({
          kind: "info",
          title: "Rename failed",
          body: String(e),
        });
        setNameDraft(status.name);
      }
    } else {
      setNameDraft(status.name);
    }
    setIsEditingName(false);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        "border-b border-border bg-surface-1",
        isDragging && "repo-row--dragging",
      )}
    >
      <div className="flex items-start gap-3 px-3 py-3">
        <button
          className={clsx(
            "mt-1.5 rounded p-1 text-zinc-500 hover:text-zinc-300",
            dragDisabled
              ? "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-zinc-500"
              : "cursor-grab hover:bg-surface-3 active:cursor-grabbing",
          )}
          title={
            dragDisabled
              ? "Reorder is disabled while a filter, search, or sort is active — reset to rearrange"
              : "Drag to reorder"
          }
          disabled={dragDisabled}
          {...(dragDisabled ? {} : attributes)}
          {...(dragDisabled ? {} : listeners)}
        >
          <GripVertical size={16} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isEditingName ? (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.currentTarget.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") {
                    setNameDraft(status.name);
                    setIsEditingName(false);
                  }
                }}
                className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-sm font-semibold text-zinc-100 focus:border-blue-400 focus:outline-none"
              />
            ) : (
              <button
                className="truncate text-left text-sm font-semibold text-zinc-100 hover:text-blue-300"
                title="Click to rename"
                onClick={() => setIsEditingName(true)}
              >
                {status.name}
              </button>
            )}
            <Pill tone="neutral" icon={<GitBranch size={12} />} title="Current branch">
              <span className="font-mono">{status.branch || "—"}</span>
            </Pill>
            {status.branch &&
              status.defaultBranch &&
              status.branch !== status.defaultBranch && (
                <Pill tone="neutral" title="Default branch">
                  <Circle size={8} className="opacity-60" />
                  default: <span className="font-mono">{status.defaultBranch}</span>
                </Pill>
              )}
            {dirtyPill(status.dirty)}
            {status.hasSubmodules && (
              <Pill
                tone="neutral"
                icon={<Boxes size={12} />}
                title="Repo has submodules — dashboard shows the parent state only, submodule drift is not detected"
              >
                submodules
              </Pill>
            )}
            {aheadBehind}
            {status.error && (
              <Pill tone="red" icon={<AlertCircle size={12} />} title={status.error}>
                error
              </Pill>
            )}
          </div>

          <div className="mt-1 truncate text-xs text-zinc-500" title={status.path}>
            {status.path}
          </div>

          {status.latestCommit && (
            <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-400">
              <span className="font-mono text-zinc-400">
                {status.latestCommit.shaShort}
              </span>
              <span className="truncate text-zinc-300" title={status.latestCommit.message}>
                {truncate(firstLine(status.latestCommit.message), 90)}
              </span>
              <span className="text-zinc-500">·</span>
              <span title={status.latestCommit.author}>{status.latestCommit.author}</span>
              <span className="text-zinc-500">·</span>
              <span title={status.latestCommit.timestamp}>
                {timeAgo(status.latestCommit.timestamp)}
              </span>
            </div>
          )}

          {status.error && (
            <div className="mt-1 text-xs text-red-300" title={status.error}>
              {truncate(status.error, 180)}
            </div>
          )}

          <div className="mt-1 text-[11px] text-zinc-500">
            Last fetch: {timeAgo(status.lastFetch)}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <RepoActions status={status} />
          <div className="flex items-center gap-1">
            <IconButton
              title="Refresh status — re-reads branch, dirty state, and ahead/behind from disk. No network."
              onClick={() => refreshOne(status.id)}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCcw size={14} />
              )}
            </IconButton>
            <IconButton
              title="Rename in the dashboard — changes the display name only; the folder on disk is not renamed"
              onClick={() => setIsEditingName(true)}
            >
              <Pencil size={14} />
            </IconButton>
            <IconButton
              title="Remove from dashboard — unregisters this repo. Your files on disk are NOT deleted."
              tone="danger"
              onClick={() =>
                openDialog({
                  kind: "removeRepo",
                  id: status.id,
                  name: status.name,
                  path: status.path,
                })
              }
            >
              <Trash2 size={14} />
            </IconButton>
          </div>
        </div>
      </div>

      {isExpanded && (
        <>
          {status.dirty !== "clean" && <RepoChangesPanel status={status} />}
          <RepoLogPanel status={status} />
        </>
      )}
    </div>
  );
}
