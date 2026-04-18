/**
 * Single typed wrapper around every #[tauri::command] exposed by the backend.
 *
 * INVARIANT: no other frontend file may import `invoke` from `@tauri-apps/api/core`.
 * Components and stores must go through the helpers in this file.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  ActionLogEntry,
  BulkPullReport,
  BulkResult,
  ChangedFiles,
  Commit,
  CommitPushResult,
  ConfigureHelperResult,
  ForcePullPreview,
  ForcePullResult,
  GitSetupStatus,
  IgnoredPath,
  Repo,
  RepoStatus,
  ScanAddResult,
  ScanResult,
  SignInResult,
} from "../types";

// ---- repos ----
export function listRepos(): Promise<Repo[]> {
  return invoke("list_repos");
}
export function addRepo(path: string, name?: string): Promise<Repo> {
  return invoke("add_repo", { path, name: name ?? null });
}
export function removeRepo(id: number): Promise<void> {
  return invoke("remove_repo", { id });
}
export function renameRepo(id: number, newName: string): Promise<void> {
  return invoke("rename_repo", { id, newName });
}
export function reorderRepos(orderedIds: number[]): Promise<void> {
  return invoke("reorder_repos", { orderedIds });
}

// ---- status ----
export function getRepoStatus(id: number): Promise<RepoStatus> {
  return invoke("get_repo_status", { id });
}
export function getAllStatuses(): Promise<RepoStatus[]> {
  return invoke("get_all_statuses");
}
export function getRepoLog(id: number, count: number): Promise<Commit[]> {
  return invoke("get_repo_log", { id, count });
}
export function getChangedFiles(
  id: number,
  limit?: number,
): Promise<ChangedFiles> {
  return invoke("get_changed_files", { id, limit: limit ?? null });
}

// ---- git ops ----
export function gitFetch(id: number): Promise<string> {
  return invoke("git_fetch", { id });
}
export function gitPullFf(id: number): Promise<string> {
  return invoke("git_pull_ff", { id });
}
export function gitForcePull(id: number): Promise<ForcePullResult> {
  return invoke("git_force_pull", { id });
}
export function gitCommitPush(
  id: number,
  message: string,
  push: boolean,
): Promise<CommitPushResult> {
  return invoke("git_commit_push", { id, message, push });
}
export function gitFetchAll(): Promise<BulkResult[]> {
  return invoke("git_fetch_all");
}
export function gitPullAllSafe(): Promise<BulkPullReport> {
  return invoke("git_pull_all_safe");
}
export function undoLastAction(id: number): Promise<ForcePullResult> {
  return invoke("undo_last_action", { id });
}
export function getActionLog(
  id: number,
  limit?: number,
): Promise<ActionLogEntry[]> {
  return invoke("get_action_log", { id, limit: limit ?? null });
}
export function forcePullPreview(id: number): Promise<ForcePullPreview> {
  return invoke("force_pull_preview", { id });
}
export function diagnoseAuth(id: number): Promise<string> {
  return invoke("diagnose_auth", { id });
}
export function signInRemote(id: number): Promise<SignInResult> {
  return invoke("sign_in_remote", { id });
}
export function gitSetupStatus(): Promise<GitSetupStatus> {
  return invoke("git_setup_status");
}
export function configureCredentialHelper(): Promise<ConfigureHelperResult> {
  return invoke("configure_credential_helper");
}

// ---- system ----
export function openFolder(id: number): Promise<void> {
  return invoke("open_folder", { id });
}
export function openTerminal(id: number): Promise<void> {
  return invoke("open_terminal", { id });
}
export function openRemote(id: number): Promise<void> {
  return invoke("open_remote", { id });
}
export function openCommit(id: number, sha: string): Promise<void> {
  return invoke("open_commit", { id, sha });
}
export function setTrayTooltip(text: string): Promise<void> {
  return invoke("set_tray_tooltip", { text });
}

// ---- settings ----
export function getSetting(key: string): Promise<string | null> {
  return invoke("get_setting", { key });
}
export function setSetting(key: string, value: string): Promise<void> {
  return invoke("set_setting", { key, value });
}

// ---- scan / ignore ----
export function scanFolder(parent: string): Promise<ScanResult> {
  return invoke("scan_folder", { parent });
}
export function addScannedRepos(paths: string[]): Promise<ScanAddResult> {
  return invoke("add_scanned_repos", { paths });
}
export function listIgnoredPaths(): Promise<IgnoredPath[]> {
  return invoke("list_ignored_paths");
}
export function ignorePath(path: string): Promise<void> {
  return invoke("ignore_path", { path });
}
export function unignorePath(path: string): Promise<void> {
  return invoke("unignore_path", { path });
}
