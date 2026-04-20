import clsx from "clsx";
import {
  Activity,
  CheckSquare,
  ChevronDown,
  DownloadCloud,
  FolderPlus,
  FolderSearch,
  GitPullRequestArrow,
  History,
  Layers,
  Loader2,
  MoreHorizontal,
  Package,
  RefreshCcw,
  Settings as SettingsIcon,
  Settings2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  SHORTCUT_BULK_FETCH,
  SHORTCUT_BULK_PULL,
} from "../hooks/useGlobalKeymap";
import * as api from "../lib/tauri";
import { useReposStore } from "../stores/reposStore";
import { useSelectionStore } from "../stores/selectionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { Button, IconButton } from "./ui/Button";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export function Sidebar() {
  const openDialog = useUiStore((s) => s.openDialog);
  const bulkInProgress = useUiStore((s) => s.bulkInProgress);
  const setBulkInProgress = useUiStore((s) => s.setBulkInProgress);
  const refreshAll = useReposStore((s) => s.refreshAll);
  const statuses = useReposStore((s) => s.statuses);
  const refreshing = useReposStore((s) => s.refreshing);
  const settings = useSettingsStore((s) => s.settings);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const clearSelection = useSelectionStore((s) => s.clear);

  const [bulkBusy, setBulkBusy] = useState<"fetchAll" | "pullSafe" | null>(
    null,
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const selectionCount = selectedIds.size;
  const hasSelection = selectionCount > 0;

  // When the user has an active selection, bulk buttons target it.
  // Otherwise they target every repo (preserving v1 behaviour).
  const targetIds = hasSelection ? Array.from(selectedIds) : undefined;
  const targetLabel = hasSelection ? `selected (${selectionCount})` : "all";

  useEffect(() => {
    if (!moreOpen) return;
    function onDown(e: MouseEvent) {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // Keep the latest bulk handlers addressable by the global keymap's
  // CustomEvent shortcuts (Shift+F / Shift+P). The handlers close over
  // changing state (selection, busy, etc.), so we thread them through
  // refs to avoid rebinding the window listener on every render.
  const fetchRef = useRef(() => Promise.resolve());
  const pullRef = useRef(() => Promise.resolve());

  async function runFetchAll() {
    setBulkBusy("fetchAll");
    setBulkInProgress(true);
    try {
      const results = await api.gitFetchAll(targetIds);
      if (hasSelection && targetIds) {
        await Promise.all(
          targetIds.map(async (id) => {
            try {
              const s = await api.getRepoStatus(id);
              useReposStore.getState().applyStatusUpdate(s);
            } catch {
              /* ignore per-row errors — surfaced in BulkResultDialog */
            }
          }),
        );
      } else {
        await refreshAll();
      }
      openDialog({
        kind: "bulkFetchResult",
        title: `Fetch ${targetLabel} complete`,
        results,
      });
    } catch (e) {
      openDialog({
        kind: "gitError",
        title: `Fetch ${targetLabel} failed`,
        error: String(e),
      });
    } finally {
      setBulkBusy(null);
      setBulkInProgress(false);
    }
  }

  async function runPullSafe() {
    setBulkBusy("pullSafe");
    setBulkInProgress(true);
    try {
      const report = await api.gitPullAllSafe(targetIds);
      if (hasSelection && targetIds) {
        await Promise.all(
          targetIds.map(async (id) => {
            try {
              const s = await api.getRepoStatus(id);
              useReposStore.getState().applyStatusUpdate(s);
            } catch {
              /* ignore */
            }
          }),
        );
      } else {
        await refreshAll();
      }
      openDialog({
        kind: "bulkPullResult",
        title: `Pull ${targetLabel} complete`,
        report,
      });
    } catch (e) {
      openDialog({
        kind: "gitError",
        title: `Pull ${targetLabel} failed`,
        error: String(e),
      });
    } finally {
      setBulkBusy(null);
      setBulkInProgress(false);
    }
  }

  function closeMore() {
    setMoreOpen(false);
  }

  function openScan() {
    closeMore();
    openDialog({ kind: "scanFolder" });
  }
  function openActivity() {
    closeMore();
    openDialog({ kind: "activityFeed" });
  }
  function openRecent() {
    closeMore();
    openDialog({ kind: "recentActions" });
  }
  function openStashCreate() {
    closeMore();
    openDialog({
      kind: "createStash",
      seedRepoIds: hasSelection ? Array.from(selectedIds) : undefined,
    });
  }
  function openStashBrowser() {
    closeMore();
    openDialog({ kind: "stashes" });
  }
  function openManageWorkspaces() {
    closeMore();
    openDialog({ kind: "manageWorkspaces" });
  }

  async function refreshEntities() {
    closeMore();
    if (hasSelection && targetIds) {
      await Promise.all(
        targetIds.map(async (id) => {
          try {
            const s = await api.getRepoStatus(id);
            useReposStore.getState().applyStatusUpdate(s);
          } catch {
            /* ignore */
          }
        }),
      );
    } else {
      await refreshAll();
    }
  }

  fetchRef.current = runFetchAll;
  pullRef.current = runPullSafe;

  useEffect(() => {
    function onFetch() {
      void fetchRef.current();
    }
    function onPull() {
      void pullRef.current();
    }
    window.addEventListener(SHORTCUT_BULK_FETCH, onFetch);
    window.addEventListener(SHORTCUT_BULK_PULL, onPull);
    return () => {
      window.removeEventListener(SHORTCUT_BULK_FETCH, onFetch);
      window.removeEventListener(SHORTCUT_BULK_PULL, onPull);
    };
  }, []);

  const refreshMins = Math.round(settings.refreshIntervalSec / 60);

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-surface-0 p-3">
      <div className="mb-3 flex items-center gap-2 px-1">
        <div className="h-7 w-7 rounded-md bg-blue-500/20 text-center text-[15px] font-semibold leading-7 text-blue-300">
          R
        </div>
        <div className="flex flex-col">
          <div className="text-sm font-semibold text-zinc-100">
            Repo Dashboard
          </div>
          <div className="text-[11px] text-zinc-500">
            {statuses.length} repos
          </div>
        </div>
      </div>

      <WorkspaceSwitcher />

      {hasSelection && (
        <button
          type="button"
          onClick={clearSelection}
          title="Clear selection (Esc)"
          className="mb-2 inline-flex items-center justify-center gap-1.5 rounded-md border border-blue-500/40 bg-blue-500/10 px-2 py-1 text-xs font-semibold text-blue-300 hover:bg-blue-500/20"
        >
          <CheckSquare size={12} />
          {selectionCount} selected
          <X size={10} className="ml-0.5" />
        </button>
      )}

      <Button
        variant="primary"
        icon={<FolderPlus size={14} />}
        title="Add a single existing local git repository by picking its folder"
        onClick={() => openDialog({ kind: "addRepo" })}
      >
        Add repo
      </Button>

      <div className="mt-3 flex flex-col gap-1.5">
        <Button
          icon={
            bulkBusy === "fetchAll" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <DownloadCloud size={14} />
            )
          }
          title={
            hasSelection
              ? `Run \`git fetch origin\` on the ${selectionCount} selected repo${selectionCount === 1 ? "" : "s"}. Does not modify any working tree.`
              : "Run `git fetch origin` on every repo in parallel. Downloads new commits and updates remote refs — does not modify any working tree."
          }
          onClick={runFetchAll}
          disabled={bulkInProgress || statuses.length === 0}
        >
          {hasSelection ? `Fetch selected (${selectionCount})` : "Fetch all"}
        </Button>
        <Button
          icon={
            bulkBusy === "pullSafe" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <GitPullRequestArrow size={14} />
            )
          }
          title={
            hasSelection
              ? `Fast-forward pull each of the ${selectionCount} selected repo${selectionCount === 1 ? "" : "s"} that's eligible (default branch + clean tree). Skips ineligible ones.`
              : "Fast-forward pull every repo that's eligible — must be on its default branch, clean working tree, behind upstream, and not diverged. Skips everything else; nothing destructive."
          }
          onClick={runPullSafe}
          disabled={bulkInProgress || statuses.length === 0}
        >
          {hasSelection ? `Pull selected (${selectionCount})` : "Pull all"}
        </Button>

        <div className="relative" ref={moreRef}>
          <Button
            icon={<MoreHorizontal size={14} />}
            title="Additional actions — import, stashes, activity feed, recent actions, refresh, workspaces"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            className="w-full"
          >
            <span className="flex-1 truncate text-left">More actions…</span>
            <ChevronDown
              size={12}
              className={clsx(
                "shrink-0 text-zinc-500 transition",
                moreOpen && "rotate-180",
              )}
            />
          </Button>
          {moreOpen && (
            <div
              role="menu"
              className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-border-strong bg-surface-1 py-1 shadow-xl"
            >
              <MoreMenuItem
                icon={<FolderSearch size={14} />}
                onClick={openScan}
              >
                Import from folder…
              </MoreMenuItem>
              <MoreMenuItem
                icon={<Activity size={14} />}
                onClick={openActivity}
                disabled={statuses.length === 0}
              >
                Activity feed
              </MoreMenuItem>
              <MoreMenuItem icon={<History size={14} />} onClick={openRecent}>
                Recent actions
              </MoreMenuItem>

              <MoreMenuSeparator />

              <MoreMenuItem
                icon={<Package size={14} />}
                onClick={openStashCreate}
                disabled={statuses.length === 0}
              >
                {hasSelection
                  ? `Stash selected (${selectionCount})…`
                  : "Stash all changes…"}
              </MoreMenuItem>
              <MoreMenuItem
                icon={<Layers size={14} />}
                onClick={openStashBrowser}
              >
                Stash bundles
              </MoreMenuItem>

              <MoreMenuSeparator />

              <MoreMenuItem
                icon={
                  refreshing ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <RefreshCcw size={14} />
                  )
                }
                onClick={() => void refreshEntities()}
                disabled={refreshing}
              >
                {hasSelection
                  ? `Refresh selected (${selectionCount})`
                  : "Refresh all"}
              </MoreMenuItem>
              <MoreMenuItem
                icon={<Settings2 size={14} />}
                onClick={openManageWorkspaces}
              >
                Manage workspaces…
              </MoreMenuItem>
            </div>
          )}
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-[11px] text-zinc-500">
        <span
          className="flex min-w-0 items-center gap-1.5 truncate"
          title={`Auto-refresh every ${refreshMins} minute${refreshMins === 1 ? "" : "s"}`}
        >
          {refreshing ? (
            <Loader2
              size={10}
              className="shrink-0 animate-spin text-blue-300"
            />
          ) : (
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-600" />
          )}
          <span className="truncate">Auto-refresh {refreshMins}m</span>
        </span>
        <IconButton
          title="App settings — terminal launcher, auto-refresh interval, default repo directory, theme, and ignored-paths list"
          onClick={() => openDialog({ kind: "settings" })}
          className="h-7 w-7"
        >
          <SettingsIcon size={14} />
        </IconButton>
      </div>
    </aside>
  );
}

interface MoreMenuItemProps {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

function MoreMenuItem({
  icon,
  children,
  onClick,
  disabled,
}: MoreMenuItemProps) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-100 transition hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  );
}

function MoreMenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}
