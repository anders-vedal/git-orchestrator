import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import type { RepoStatus } from "./types";
import { EVENT_REPO_STATUS_UPDATED } from "./lib/tauri";
import { ActivityFeedDialog } from "./components/dialogs/ActivityFeedDialog";
import { AddRepoDialog } from "./components/dialogs/AddRepoDialog";
import { BranchPickerDialog } from "./components/dialogs/BranchPickerDialog";
import { BulkResultDialog } from "./components/dialogs/BulkResultDialog";
import { CommitPushDialog } from "./components/dialogs/CommitPushDialog";
import { CreateStashDialog } from "./components/dialogs/CreateStashDialog";
import { CreateWorkspaceDialog } from "./components/dialogs/CreateWorkspaceDialog";
import { ForcePullDialog } from "./components/dialogs/ForcePullDialog";
import { GitErrorDialog } from "./components/dialogs/GitErrorDialog";
import { InfoDialog } from "./components/dialogs/InfoDialog";
import { ManageWorkspacesDialog } from "./components/dialogs/ManageWorkspacesDialog";
import { RecentActionsDialog } from "./components/dialogs/RecentActionsDialog";
import { RemoveRepoDialog } from "./components/dialogs/RemoveRepoDialog";
import { ScanFolderDialog } from "./components/dialogs/ScanFolderDialog";
import { SettingsDialog } from "./components/dialogs/SettingsDialog";
import { StashesDialog } from "./components/dialogs/StashesDialog";
import {
  StashPushResultDialog,
  StashRestoreResultDialog,
} from "./components/dialogs/StashResultDialog";
import { UndoGroupResultDialog } from "./components/dialogs/UndoGroupResultDialog";
import { UpdateDialog } from "./components/dialogs/UpdateDialog";
import { WorkspaceActivationResultDialog } from "./components/dialogs/WorkspaceActivationResultDialog";
import { GitSetupBanner } from "./components/GitSetupBanner";
import { RepoList } from "./components/RepoList";
import { Sidebar } from "./components/Sidebar";
import * as api from "./lib/tauri";
import { buildTooltip } from "./lib/trayTooltip";
import { checkForUpdate } from "./lib/updater";
import { useReposStore } from "./stores/reposStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useUiStore } from "./stores/uiStore";
import { useWorkspacesStore } from "./stores/workspacesStore";

function App() {
  const loadSettings = useSettingsStore((s) => s.load);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const refreshIntervalSec = useSettingsStore((s) => s.settings.refreshIntervalSec);
  const autoCheckUpdates = useSettingsStore((s) => s.settings.autoCheckUpdates);
  const loadAll = useReposStore((s) => s.loadAll);
  const loadWorkspaces = useWorkspacesStore((s) => s.loadAll);
  const activeWorkspaceName = useWorkspacesStore((s) =>
    s.activeId != null
      ? (s.workspaces.find((w) => w.id === s.activeId)?.name ?? null)
      : null,
  );
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
    void loadWorkspaces();
  }, [settingsLoaded, loadAll, loadWorkspaces]);

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
  // Prepend the active workspace name so the tray shows the current context.
  useEffect(() => {
    void api
      .setTrayTooltip(buildTooltip(statuses, activeWorkspaceName))
      .catch(() => {});
  }, [statuses, activeWorkspaceName]);

  // One-shot check for a newer signed build at startup. Silent on
  // network errors and on "already up-to-date" — only opens the
  // dialog when a signed update is actually available.
  useEffect(() => {
    if (!settingsLoaded || !autoCheckUpdates) return;
    let cancelled = false;
    void (async () => {
      try {
        const info = await checkForUpdate();
        if (cancelled || !info) return;
        openDialogRef.current({
          kind: "update",
          version: info.version,
          currentVersion: info.currentVersion,
          notes: info.notes,
          date: info.date,
        });
      } catch {
        // Offline / endpoint unreachable / signature mismatch — stay silent.
        // User can retry via Settings → "Check for updates".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settingsLoaded, autoCheckUpdates]);

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
      <CreateWorkspaceDialog />
      <ManageWorkspacesDialog />
      <WorkspaceActivationResultDialog />
      <CreateStashDialog />
      <StashesDialog />
      <StashPushResultDialog />
      <StashRestoreResultDialog />
      <RecentActionsDialog />
      <UndoGroupResultDialog />
      <UpdateDialog />
      <InfoDialog />
    </div>
  );
}

export default App;
