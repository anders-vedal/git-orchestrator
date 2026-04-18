import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import type { RepoStatus } from "./types";
import { EVENT_REPO_STATUS_UPDATED } from "./lib/tauri";
import { ActivityFeedDialog } from "./components/dialogs/ActivityFeedDialog";
import { AddRepoDialog } from "./components/dialogs/AddRepoDialog";
import { BranchPickerDialog } from "./components/dialogs/BranchPickerDialog";
import { BulkResultDialog } from "./components/dialogs/BulkResultDialog";
import { CommitPushDialog } from "./components/dialogs/CommitPushDialog";
import { ForcePullDialog } from "./components/dialogs/ForcePullDialog";
import { GitErrorDialog } from "./components/dialogs/GitErrorDialog";
import { InfoDialog } from "./components/dialogs/InfoDialog";
import { RemoveRepoDialog } from "./components/dialogs/RemoveRepoDialog";
import { ScanFolderDialog } from "./components/dialogs/ScanFolderDialog";
import { SettingsDialog } from "./components/dialogs/SettingsDialog";
import { GitSetupBanner } from "./components/GitSetupBanner";
import { RepoList } from "./components/RepoList";
import { Sidebar } from "./components/Sidebar";
import * as api from "./lib/tauri";
import { buildTooltip } from "./lib/trayTooltip";
import { useReposStore } from "./stores/reposStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useUiStore } from "./stores/uiStore";

function App() {
  const loadSettings = useSettingsStore((s) => s.load);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const refreshIntervalSec = useSettingsStore((s) => s.settings.refreshIntervalSec);
  const loadAll = useReposStore((s) => s.loadAll);
  const refreshAll = useReposStore((s) => s.refreshAll);
  const applyStatusUpdate = useReposStore((s) => s.applyStatusUpdate);
  const statuses = useReposStore((s) => s.statuses);
  const bulkInProgress = useUiStore((s) => s.bulkInProgress);
  const setBulkInProgress = useUiStore((s) => s.setBulkInProgress);
  const openDialog = useUiStore((s) => s.openDialog);

  // Keep the latest store callbacks for the event listener without re-subscribing.
  const refreshAllRef = useRef(refreshAll);
  refreshAllRef.current = refreshAll;
  const setBulkRef = useRef(setBulkInProgress);
  setBulkRef.current = setBulkInProgress;
  const openDialogRef = useRef(openDialog);
  openDialogRef.current = openDialog;

  // Initial load
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!settingsLoaded) return;
    void loadAll();
  }, [settingsLoaded, loadAll]);

  // Auto-refresh loop
  useEffect(() => {
    if (!settingsLoaded) return;
    const ms = Math.max(30, refreshIntervalSec) * 1000;
    const id = window.setInterval(() => {
      if (!bulkInProgress) void refreshAll();
    }, ms);
    return () => window.clearInterval(id);
  }, [settingsLoaded, refreshIntervalSec, refreshAll, bulkInProgress]);

  // Push tooltip updates to the system tray after every status change.
  useEffect(() => {
    void api.setTrayTooltip(buildTooltip(statuses)).catch(() => {});
  }, [statuses]);

  // Streaming refresh: the backend emits one `repo-status-updated` event
  // per repo as each finishes. Register once at mount; the store patches
  // rows as events arrive.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<RepoStatus>(EVENT_REPO_STATUS_UPDATED, (e) => {
      applyStatusUpdate(e.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [applyStatusUpdate]);

  // Tray menu "Fetch all" -> run the same flow as the sidebar button.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen("tray:fetch-all", async () => {
      setBulkRef.current(true);
      try {
        const results = await api.gitFetchAll();
        await refreshAllRef.current();
        openDialogRef.current({
          kind: "bulkFetchResult",
          title: "Fetch all complete",
          results,
        });
      } catch (e) {
        openDialogRef.current({
          kind: "info",
          title: "Fetch all failed (tray)",
          body: String(e),
        });
      } finally {
        setBulkRef.current(false);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex flex-1 flex-col bg-surface-0">
        <GitSetupBanner />
        <RepoList />
      </main>

      <AddRepoDialog />
      <ScanFolderDialog />
      <RemoveRepoDialog />
      <ForcePullDialog />
      <CommitPushDialog />
      <BulkResultDialog />
      <GitErrorDialog />
      <SettingsDialog />
      <ActivityFeedDialog />
      <BranchPickerDialog />
      <InfoDialog />
    </div>
  );
}

export default App;
