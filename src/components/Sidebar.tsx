import {
  DownloadCloud,
  FolderPlus,
  FolderSearch,
  GitPullRequestArrow,
  Loader2,
  RefreshCcw,
  Settings as SettingsIcon,
} from "lucide-react";
import { useState } from "react";
import * as api from "../lib/tauri";
import { useReposStore } from "../stores/reposStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { Button } from "./ui/Button";

export function Sidebar() {
  const openDialog = useUiStore((s) => s.openDialog);
  const bulkInProgress = useUiStore((s) => s.bulkInProgress);
  const setBulkInProgress = useUiStore((s) => s.setBulkInProgress);
  const refreshAll = useReposStore((s) => s.refreshAll);
  const statuses = useReposStore((s) => s.statuses);
  const refreshing = useReposStore((s) => s.refreshing);
  const settings = useSettingsStore((s) => s.settings);

  const [bulkBusy, setBulkBusy] = useState<"fetchAll" | "pullSafe" | null>(null);

  async function runFetchAll() {
    setBulkBusy("fetchAll");
    setBulkInProgress(true);
    try {
      const results = await api.gitFetchAll();
      await refreshAll();
      openDialog({
        kind: "bulkFetchResult",
        title: "Fetch all complete",
        results,
      });
    } catch (e) {
      openDialog({
        kind: "gitError",
        title: "Fetch all failed",
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
      const report = await api.gitPullAllSafe();
      await refreshAll();
      openDialog({
        kind: "bulkPullResult",
        title: "Pull all (safe) complete",
        report,
      });
    } catch (e) {
      openDialog({
        kind: "gitError",
        title: "Pull all (safe) failed",
        error: String(e),
      });
    } finally {
      setBulkBusy(null);
      setBulkInProgress(false);
    }
  }

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-surface-0 p-3">
      <div className="mb-3 flex items-center gap-2 px-1">
        <div className="h-7 w-7 rounded-md bg-blue-500/20 text-center text-[15px] font-semibold leading-7 text-blue-300">
          R
        </div>
        <div className="flex flex-col">
          <div className="text-sm font-semibold text-zinc-100">Repo Dashboard</div>
          <div className="text-[11px] text-zinc-500">{statuses.length} repos</div>
        </div>
      </div>

      <Button
        variant="primary"
        icon={<FolderPlus size={14} />}
        title="Add a single existing local git repository by picking its folder"
        onClick={() => openDialog({ kind: "addRepo" })}
      >
        Add repo
      </Button>
      <Button
        icon={<FolderSearch size={14} />}
        title="Scan a parent folder for git repos — lists every direct child that's a git repository so you can bulk-add them"
        onClick={() => openDialog({ kind: "scanFolder" })}
        className="mt-1.5"
      >
        Scan folder…
      </Button>

      <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        Bulk actions
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        <Button
          icon={
            bulkBusy === "fetchAll" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <DownloadCloud size={14} />
            )
          }
          title="Run `git fetch origin` on every repo in parallel. Downloads new commits and updates remote refs — does not modify any working tree."
          onClick={runFetchAll}
          disabled={bulkInProgress || statuses.length === 0}
        >
          Fetch all
        </Button>
        <Button
          icon={
            bulkBusy === "pullSafe" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <GitPullRequestArrow size={14} />
            )
          }
          title="Fast-forward pull every repo that's eligible — must be on its default branch, clean working tree, behind upstream, and not diverged. Skips everything else; nothing destructive."
          onClick={runPullSafe}
          disabled={bulkInProgress || statuses.length === 0}
        >
          Pull all (safe)
        </Button>
        <Button
          icon={
            refreshing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCcw size={14} />
            )
          }
          title="Re-read status from disk for every repo. No network calls — just recomputes branch, dirty state, and ahead/behind from the local .git."
          onClick={() => refreshAll()}
          disabled={refreshing}
        >
          Refresh all
        </Button>
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <div className="rounded-md border border-border bg-surface-1 p-2 text-[11px] text-zinc-400">
          Auto-refresh every{" "}
          <span className="font-semibold text-zinc-200">
            {Math.round(settings.refreshIntervalSec / 60)}m
          </span>
          {refreshing && (
            <span className="ml-2 inline-flex items-center gap-1 text-blue-300">
              <Loader2 size={10} className="animate-spin" />
              refreshing…
            </span>
          )}
        </div>
        <Button
          icon={<SettingsIcon size={14} />}
          title="App settings — terminal launcher, auto-refresh interval, default repo directory, theme, and ignored-paths list"
          onClick={() => openDialog({ kind: "settings" })}
        >
          Settings
        </Button>
      </div>
    </aside>
  );
}
