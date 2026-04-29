import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import {
  AlertCircle,
  Boxes,
  GitBranch,
  GripVertical,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { firstLine, timeAgo, truncate } from "../lib/format";
import { getRepoStateBucket, getRepoStateChip } from "../lib/repoState";
import { useFocusStore } from "../stores/focusStore";
import { useReposStore } from "../stores/reposStore";
import { useSelectionStore } from "../stores/selectionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import type { RepoStatus } from "../types";
import { RepoActions } from "./RepoActions";
import { RepoChangesPanel } from "./RepoChangesPanel";
import { RepoLogPanel } from "./RepoLogPanel";
import { Pill } from "./ui/Pill";

interface Props {
  status: RepoStatus;
  dragDisabled?: boolean;
  /** Ordered ids of the currently-visible rows — needed for shift+click
   *  range selection. Pass from RepoList's memoized `visible`. */
  visibleIds: number[];
  /** Position in the visible list. Drives subtle zebra striping so rows
   *  with similar state (e.g. multiple clean repos) are visually distinct. */
  index: number;
}

export function RepoRow({
  status,
  dragDisabled = false,
  visibleIds,
  index,
}: Props) {
  const isExpanded = useUiStore((s) => s.expandedIds.has(status.id));
  const openDialog = useUiStore((s) => s.openDialog);
  const refreshOne = useReposStore((s) => s.refreshOne);
  const renameRepo = useReposStore((s) => s.rename);
  const refreshing = useReposStore((s) => s.refreshingIds.has(status.id));
  const isSelected = useSelectionStore((s) => s.selectedIds.has(status.id));
  const toggleSelect = useSelectionStore((s) => s.toggle);
  const selectRange = useSelectionStore((s) => s.selectRange);
  const isFocused = useFocusStore((s) => s.focusedRepoId === status.id);
  const dimCleanRows = useSettingsStore((s) => s.settings.dimCleanRows);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(status.name);
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isFocused && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [isFocused]);

  const onDefault =
    !!status.branch && status.branch === status.defaultBranch;

  function handleCheckboxClick(e: React.MouseEvent<HTMLInputElement>) {
    e.stopPropagation();
    if (e.shiftKey) {
      selectRange(status.id, visibleIds);
    } else {
      toggleSelect(status.id);
    }
  }

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

  const stateChip = getRepoStateChip(status);
  // Dim rows that need no attention — clean + up-to-date + on default
  // branch. Hover / focus / selection restore full opacity so the row
  // is always interactable; the dim is a scanning aid, not a lock.
  const shouldDim =
    dimCleanRows &&
    getRepoStateBucket(status) === "clean" &&
    !isSelected &&
    !isFocused;

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
      ref={(node) => {
        setNodeRef(node);
        rowRef.current = node;
      }}
      style={style}
      className={clsx(
        "border-b border-border transition",
        // Background: selected wins; otherwise alternate between surface-1
        // and a slightly lighter shade so adjacent rows are easier to
        // tell apart while scanning. All rows get a hover bump so the
        // currently-pointed-at row is unambiguous, regardless of dim state.
        isSelected
          ? "bg-blue-500/[0.06] hover:bg-blue-500/[0.10]"
          : index % 2 === 0
            ? "bg-surface-1 hover:bg-surface-2"
            : "bg-[#161a22] hover:bg-surface-2",
        shouldDim && "opacity-60 hover:opacity-100 focus-within:opacity-100",
        isSelected && "border-l-2 border-l-blue-400 pl-0",
        isFocused && "ring-1 ring-inset ring-blue-400/60",
        isDragging && "repo-row--dragging",
      )}
    >
      <div className="flex items-start gap-3 px-3 py-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => {}}
          onClick={handleCheckboxClick}
          className="mt-2 h-3.5 w-3.5 cursor-pointer rounded border-border bg-surface-2 accent-blue-500"
          title="Select this repo for bulk actions (shift+click to range-select, Esc to clear)"
          aria-label={`Select ${status.name}`}
        />
        {dragDisabled ? (
          // Keep the column width so selected rows don't shift horizontally
          // when sort/filter/selection is active and drag is off.
          <span className="mt-1.5 block h-5 w-5" aria-hidden="true" />
        ) : (
          <button
            className="mt-1.5 cursor-grab rounded p-1 text-zinc-500 hover:bg-surface-3 hover:text-zinc-300 active:cursor-grabbing"
            title="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            <GripVertical size={16} />
          </button>
        )}

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
                title={`${status.name}\n${status.path}\nClick to rename.`}
                onClick={() => setIsEditingName(true)}
              >
                {status.name}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!status.branch) return;
                openDialog({
                  kind: "branchPicker",
                  repoId: status.id,
                  repoName: status.name,
                  currentBranch: status.branch,
                  defaultBranch: status.defaultBranch,
                });
              }}
              disabled={!status.branch}
              title={
                !status.branch
                  ? "No branch — repo may be unborn or detached"
                  : onDefault
                    ? `On default branch (${status.defaultBranch}) — click to switch`
                    : `On ${status.branch} — NOT the default branch (${status.defaultBranch}). Click to switch back or pick another branch.`
              }
              className={clsx(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60",
                onDefault
                  ? "border-border bg-surface-3 text-zinc-300 hover:border-blue-500/40 hover:bg-blue-500/10 hover:text-blue-200"
                  : "border-amber-500/40 bg-amber-500/15 text-amber-200 hover:border-amber-400/60 hover:bg-amber-500/25",
              )}
            >
              <GitBranch size={12} />
              <span className="font-mono">{status.branch || "—"}</span>
            </button>
            {stateChip && (
              <Pill tone={stateChip.tone} title={stateChip.title}>
                {stateChip.label}
              </Pill>
            )}
            {status.hasSubmodules && (
              <span
                title="Repo has submodules — dashboard shows the parent state only, submodule drift is not detected"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface-3 text-zinc-400"
                aria-label="Has submodules"
              >
                <Boxes size={11} />
              </span>
            )}
            {status.error && (
              <Pill
                tone="red"
                icon={<AlertCircle size={12} />}
                title={status.error}
              >
                error
              </Pill>
            )}
          </div>

          {status.latestCommit && (
            <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-400">
              <span className="font-mono text-zinc-400">
                {status.latestCommit.shaShort}
              </span>
              <span
                className="truncate text-zinc-300"
                title={status.latestCommit.message}
              >
                {truncate(firstLine(status.latestCommit.message), 90)}
              </span>
              <span className="text-zinc-500">·</span>
              <span title={status.latestCommit.author}>
                {status.latestCommit.author}
              </span>
              <span className="text-zinc-500">·</span>
              <span title={status.latestCommit.timestamp}>
                {timeAgo(status.latestCommit.timestamp)}
              </span>
            </div>
          )}

          {status.error && (
            <div
              className="mt-1 text-xs text-red-300"
              title={status.error}
            >
              {truncate(status.error, 180)}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <RepoActions
            status={status}
            refreshing={refreshing}
            onRefresh={() => refreshOne(status.id)}
            onRename={() => setIsEditingName(true)}
            onRemove={() =>
              openDialog({
                kind: "removeRepo",
                id: status.id,
                name: status.name,
                path: status.path,
              })
            }
          />
        </div>
      </div>

      {isExpanded && (
        <>
          <RepoMetadataFooter status={status} />
          {status.dirty !== "clean" && <RepoChangesPanel status={status} />}
          <RepoLogPanel status={status} />
        </>
      )}
    </div>
  );
}

function RepoMetadataFooter({ status }: { status: RepoStatus }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-surface-0 px-4 py-1.5 text-[11px] text-zinc-500">
      <span className="truncate font-mono" title={status.path}>
        {status.path}
      </span>
      <span className="text-zinc-600">·</span>
      <span>Last fetch: {timeAgo(status.lastFetch)}</span>
      {status.lastRefreshedAt && (
        <>
          <span className="text-zinc-600">·</span>
          <span
            title="When the dashboard last re-read this repo's git state from disk (no network)"
          >
            refreshed {timeAgo(status.lastRefreshedAt)}
          </span>
        </>
      )}
    </div>
  );
}
