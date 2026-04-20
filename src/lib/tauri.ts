/**
 * Single typed wrapper around every #[tauri::command] exposed by the backend.
 *
 * INVARIANT: no other frontend file may import `invoke` from `@tauri-apps/api/core`.
 * Components and stores must go through the helpers in this file.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  ActionLogEntry,
  ActivationReport,
  ActivityEntry,
  BranchList,
  BulkPullReport,
  BulkResult,
  ChangedFiles,
  CheckoutResult,
  CliAction,
  Commit,
  CommitPushResult,
  ConfigureHelperResult,
  ForcePullPreview,
  ForcePullResult,
  GitSetupStatus,
  IgnoredPath,
  RecentActionGroup,
  Repo,
  RepoStatus,
  ScanAddResult,
  ScanResult,
  SignInResult,
  StashBundleDetail,
  StashBundleSummary,
  StashPushReport,
  StashRestoreReport,
  UndoGroupReport,
  WorkspaceDetail,
  WorkspaceEntryInput,
  WorkspaceSummary,
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
/**
 * Streaming refresh — fires the backend command and resolves with the
 * number of spawned tasks. Per-repo `RepoStatus` payloads arrive as
 * `repo-status-updated` tauri events and must be handled by a listener.
 * See reposStore.applyStatusUpdate / App.tsx event wiring.
 */
export function refreshAllStatuses(): Promise<number> {
  return invoke("refresh_all_statuses");
}
export const EVENT_REPO_STATUS_UPDATED = "repo-status-updated";
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
/**
 * Bulk fetch. `ids` undefined = every repo; otherwise restrict to the
 * supplied set. Returns one BulkResult per repo actually attempted.
 */
export function gitFetchAll(ids?: number[]): Promise<BulkResult[]> {
  return invoke("git_fetch_all", { ids: ids ?? null });
}
/**
 * Bulk safe pull. Same `ids` semantics as gitFetchAll. The backend
 * filters AND applies per-repo safety gates (default branch, clean tree);
 * a selected repo that fails a gate lands in `report.skipped`.
 */
export function gitPullAllSafe(ids?: number[]): Promise<BulkPullReport> {
  return invoke("git_pull_all_safe", { ids: ids ?? null });
}
export function undoLastAction(id: number): Promise<ForcePullResult> {
  return invoke("undo_last_action", { id });
}
/**
 * Roll back every repo that was touched as part of a multi-repo action
 * group (workspace activation, stash restore). Per-repo safety gates
 * apply — a dirty or moved-on-since repo is skipped, not clobbered. The
 * returned report explains what was reverted and what was skipped, and
 * `undoGroupId` identifies the action_log rows written by this pass
 * (empty when nothing was actually reverted).
 */
export function undoActionGroup(groupId: string): Promise<UndoGroupReport> {
  return invoke("undo_action_group", { groupId });
}
export function getActionLog(
  id: number,
  limit?: number,
): Promise<ActionLogEntry[]> {
  return invoke("get_action_log", { id, limit: limit ?? null });
}
/**
 * Cross-repo action history — the N most recent multi-repo action
 * groups (workspace activations, stash bundle pushes / restores,
 * group undos). Powers the Recent Actions dialog.
 */
export function listRecentActionGroups(
  limit?: number,
): Promise<RecentActionGroup[]> {
  return invoke("list_recent_action_groups", { limit: limit ?? null });
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

// ---- cli actions (Claude Code launcher) ----
/** Launch Claude Code in a repo's terminal with the chosen slash command
 *  pre-filled. Fires the configured terminal (same `terminal` setting as
 *  Open Terminal) with a `cd <path> && claude "<slash>"` commandline. */
export function runCliAction(id: number, actionId: string): Promise<void> {
  return invoke("run_cli_action", { id, actionId });
}
/** Read the configured CLI actions. Kept server-side so the renderer
 *  can't hand-forge entries that bypass validation. */
export function listCliActions(): Promise<CliAction[]> {
  return invoke("list_cli_actions");
}

// ---- branch ----
/** List local + remote branches for a repo, with SHAs, upstreams, and
 *  last-commit timestamps. No network; reads refs from .git/ only. */
export function gitListBranches(id: number): Promise<BranchList> {
  return invoke("git_list_branches", { id });
}
/** Switch to an existing local branch. Fails fast with git's own
 *  "your local changes would be overwritten" message when applicable.
 *  Logged to action_log under action='checkout' for Phase 2.4 undo. */
export function gitCheckout(id: number, name: string): Promise<CheckoutResult> {
  return invoke("git_checkout", { id, name });
}
/** Create a new local branch and switch to it. `startPoint` accepts any
 *  revision git understands (branch name, origin/<name>, SHA, tag);
 *  null branches from HEAD. */
export function gitCreateBranch(
  id: number,
  name: string,
  startPoint?: string | null,
): Promise<CheckoutResult> {
  return invoke("git_create_branch", {
    id,
    name,
    startPoint: startPoint ?? null,
  });
}

// ---- activity ----
/**
 * Cross-repo activity feed: commits on HEAD across every registered repo,
 * authored in the last `days` days, up to `limitPerRepo` per repo,
 * merged and time-sorted newest-first. One git log call per repo, fanned
 * out in parallel. HEAD-only — feature-branch activity isn't included.
 */
export function getActivityFeed(
  days: number,
  limitPerRepo?: number,
): Promise<ActivityEntry[]> {
  return invoke("get_activity_feed", {
    days,
    limitPerRepo: limitPerRepo ?? null,
  });
}

// ---- workspaces (Phase 2.2) ----
export function listWorkspaces(): Promise<WorkspaceSummary[]> {
  return invoke("list_workspaces");
}
export function getWorkspace(id: number): Promise<WorkspaceDetail> {
  return invoke("get_workspace", { id });
}
export function createWorkspace(
  name: string,
  entries: WorkspaceEntryInput[],
): Promise<WorkspaceSummary> {
  return invoke("create_workspace", { name, entries });
}
export function renameWorkspace(id: number, newName: string): Promise<void> {
  return invoke("rename_workspace", { id, newName });
}
export function deleteWorkspace(id: number): Promise<void> {
  return invoke("delete_workspace", { id });
}
export function updateWorkspaceEntries(
  id: number,
  entries: WorkspaceEntryInput[],
): Promise<void> {
  return invoke("update_workspace_entries", { id, entries });
}
export function getActiveWorkspaceId(): Promise<number | null> {
  return invoke("get_active_workspace_id");
}
export function setActiveWorkspaceId(id: number | null): Promise<void> {
  return invoke("set_active_workspace_id", { id });
}
/** Activate a workspace — switch every listed repo to its listed branch.
 *  Sequential, dirty-tree-safe. Returns per-repo outcomes so the UI can
 *  show which switched and which need attention. */
export function activateWorkspace(id: number): Promise<ActivationReport> {
  return invoke("activate_workspace", { id });
}

// ---- stash bundles (Phase 2.3) ----
export function listStashBundles(): Promise<StashBundleSummary[]> {
  return invoke("list_stash_bundles");
}
export function getStashBundle(id: number): Promise<StashBundleDetail> {
  return invoke("get_stash_bundle", { id });
}
/** Create a new stash bundle across the supplied repos. Each repo is
 *  stashed sequentially with the label as the stash message; untracked
 *  files are included. Returns per-repo outcomes; clean repos land in
 *  `nothing_to_stash` (no bundle entry consumed). */
export function createStashBundle(
  label: string,
  repoIds: number[],
): Promise<StashPushReport> {
  return invoke("create_stash_bundle", { label, repoIds });
}
/** Restore every pending entry in a bundle via `git stash apply`.
 *  Successful entries are marked restored in DB but stash refs are left
 *  in place so the user can re-apply or drop later. */
export function restoreStashBundle(id: number): Promise<StashRestoreReport> {
  return invoke("restore_stash_bundle", { id });
}
/** Delete the bundle rows. When `dropRefs` is true, also run `git stash
 *  drop` on every still-existing stash so the repos' stash stacks stay
 *  clean. Best-effort — individual drop failures don't block the DB delete. */
export function deleteStashBundle(
  id: number,
  dropRefs: boolean,
): Promise<void> {
  return invoke("delete_stash_bundle", { id, dropRefs });
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
