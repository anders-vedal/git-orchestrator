export type Dirty = "clean" | "unstaged" | "staged" | "untracked" | "mixed";

export interface Repo {
  id: number;
  name: string;
  path: string;
  priority: number;
  addedAt: string;
  /**
   * Per-repo override for commit&push behaviour. `null` / undefined
   * inherits the global `push_mode` setting. Migration 007.
   */
  pushMode?: PushModePref | null;
}

export type PushModePref = "direct" | "pr";

/**
 * Combined push-mode view for a single repo. `override` reflects the
 * per-repo column; `effective` is what the backend will use for the
 * next commit&push (override → global setting → "direct").
 */
export interface PushModeInfo {
  override: PushModePref | null;
  effective: PushModePref;
}

export interface Commit {
  sha: string;
  shaShort: string;
  message: string;
  author: string;
  timestamp: string;
}

export interface RepoStatus {
  id: number;
  name: string;
  path: string;
  branch: string;
  defaultBranch: string;
  ahead: number;
  behind: number;
  dirty: Dirty;
  hasUpstream: boolean;
  lastFetch: string | null;
  latestCommit: Commit | null;
  remoteUrl: string | null;
  hasSubmodules: boolean;
  diverged: boolean;
  unpushedNoUpstream: number | null;
  commitCount: number | null;
  lastRefreshedAt: string | null;
  error: string | null;
}

export type BulkReason =
  | "ok"
  | "off_default"
  | "dirty"
  | "path_missing"
  | "fetch_failed"
  | "pull_failed"
  | "status_failed";

export interface BulkResult {
  id: number;
  ok: boolean;
  message: string;
  reason?: BulkReason;
}

export interface BulkPullReport {
  updated: BulkResult[];
  skipped: BulkResult[];
  blocked: BulkResult[];
}

export interface ForcePullResult {
  preHeadSha: string | null;
  preHeadShort: string | null;
  postHeadSha: string | null;
  postHeadShort: string | null;
  discardedCount: number;
  message: string;
}

export interface CommitPushResult {
  branch: string;
  stagedFiles: number;
  committed: boolean;
  commitSha: string | null;
  commitShort: string | null;
  commitMessage: string;
  pushAttempted: boolean;
  pushed: boolean;
  upstreamSet: boolean;
  pushOutput: string;
  /** True when the flow created a new branch (PR mode). */
  branchCreated: boolean;
  /** Provider compare URL (GitHub/GitLab/Azure/Bitbucket) when PR mode
   *  pushed a new branch and the origin is a recognised host. */
  prUrl: string | null;
}

export interface DirtyBreakdown {
  staged: number;
  unstaged: number;
  untracked: number;
}

export interface ChangedFile {
  path: string;
  origPath?: string;
  x: string;
  y: string;
}

export interface ChangedFiles {
  files: ChangedFile[];
  total: number;
  truncated: boolean;
}

export interface ForcePullPreview {
  currentBranch: string;
  defaultBranch: string;
  onDefault: boolean;
  ahead: number;
  behind: number;
  unpushedCommits: Commit[];
  dirty: DirtyBreakdown;
  remoteHeadShort: string | null;
}

export interface ActionLogEntry {
  id: number;
  repoId: number;
  action: string;
  preHeadSha: string | null;
  postHeadSha: string | null;
  exitCode: number;
  stderrExcerpt: string | null;
  startedAt: string;
  durationMs: number;
  /** Shared identifier tying multi-repo action rows together (Phase 2+).
   *  null for single-repo actions like force_pull or commit_push. */
  groupId: string | null;
}

export interface IgnoredPath {
  path: string;
  addedAt: string;
}

export interface ScanEntry {
  path: string;
  displayName: string;
  alreadyAdded: boolean;
  ignored: boolean;
}

export interface ScanResult {
  parent: string;
  entries: ScanEntry[];
}

export interface ScanSkip {
  path: string;
  reason: string;
}

export interface ScanAddResult {
  added: Repo[];
  skipped: ScanSkip[];
}

export interface BranchInfo {
  name: string;
  shortSha: string;
  isRemote: boolean;
  isCurrent: boolean;
  upstream: string | null;
  lastCommitAt: string | null;
}

export interface BranchList {
  current: string | null;
  local: BranchInfo[];
  remote: BranchInfo[];
}

export interface CheckoutResult {
  previousBranch: string | null;
  previousHeadSha: string | null;
  newBranch: string;
  newHeadSha: string | null;
  message: string;
}

/**
 * One entry in the cross-repo activity feed. Backend flattens `Commit`
 * into the repo context so the frontend can render a unified list
 * without extra lookups.
 */
export interface ActivityEntry {
  repoId: number;
  repoName: string;
  sha: string;
  shaShort: string;
  author: string;
  timestamp: string;
  message: string;
}

export type TerminalPref =
  | "auto"
  // Windows
  | "wt"
  | "git-bash"
  | "cmd"
  // macOS
  | "terminal"
  | "iterm2"
  // Linux
  | "gnome-terminal"
  | "konsole"
  | "alacritty"
  | "kitty"
  | "xterm";
export type ThemePref = "dark" | "light" | "system";

/**
 * Model alias passed through to `claude --model <alias>`. Kept to short
 * aliases so the user doesn't have to chase model-ID churn. `undefined`
 * means "no flag" — the CLI picks its own default.
 */
export type CliActionModel = "haiku" | "sonnet" | "opus";
export const CLI_ACTION_MODELS: CliActionModel[] = ["haiku", "sonnet", "opus"];

/**
 * A user-configured Claude Code launcher entry. Backend persists the list
 * as a JSON-encoded string under the `cli_actions` setting and enforces
 * the whitelist (`slashCommand` must start with `/` and may only contain
 * safe characters, `model` must be one of the allowlisted aliases) before
 * the value lands in SQLite. See
 * `src-tauri/src/commands/settings.rs::validate_cli_actions`.
 */
export interface CliAction {
  id: string;
  label: string;
  slashCommand: string;
  model?: CliActionModel;
}

export type SortByPref =
  | "attention"
  | "custom"
  | "name"
  | "latest"
  | "commits";

export interface Settings {
  terminal: TerminalPref;
  refreshIntervalSec: number;
  defaultReposDir: string | null;
  theme: ThemePref;
  bulkConcurrency: number;
  autoCheckUpdates: boolean;
  cliActions: CliAction[];
  sortBy: SortByPref;
  dimCleanRows: boolean;
  /**
   * Default commit&push behaviour. `direct` pushes to the current branch
   * (original behaviour). `pr` creates a new branch from default and
   * pushes that so a PR can be opened against main — the right choice
   * when main is branch-protected. Per-repo overrides live on
   * `repos.push_mode`.
   */
  pushMode: PushModePref;
  /**
   * Auto-fetch: background scheduled `git fetch --all` on every repo
   * plus an additional FF-pull for repos that are on their default
   * branch and clean. Never rewrites history, never touches dirty
   * working trees. Scheduler runs in the Rust backend, not in the
   * frontend setInterval loop — fires even when the window is hidden
   * to the tray.
   */
  autoFetchEnabled: boolean;
  autoFetchIntervalSec: number;
  /**
   * Optional day-of-week anchor (0 = Sunday, ..., 6 = Saturday). Only
   * meaningful at intervals >= 7 days. `null` means "no weekly anchor".
   */
  autoFetchAnchorDow: number | null;
  /**
   * Optional hour-of-day (0..23). Meaningful at intervals >= 1 hour.
   * `null` means "no anchor" (fires every N seconds from app start).
   */
  autoFetchAnchorHour: number | null;
  autoFetchAnchorMinute: number | null;
  /**
   * RFC3339 timestamp of the last completed auto-fetch round. Written
   * by the scheduler, read-only from the UI's perspective. `null` =
   * never run in this install.
   */
  autoFetchLastRunAt: string | null;
}

export const DEFAULT_CLI_ACTIONS: CliAction[] = [
  { id: "ship", label: "Ship", slashCommand: "/ship" },
];

export const DEFAULT_SETTINGS: Settings = {
  terminal: "auto",
  refreshIntervalSec: 300,
  defaultReposDir: null,
  theme: "dark",
  bulkConcurrency: 4,
  autoCheckUpdates: true,
  cliActions: DEFAULT_CLI_ACTIONS,
  sortBy: "attention",
  dimCleanRows: true,
  pushMode: "direct",
  autoFetchEnabled: false,
  // 24h default when the user flips the switch — the most conservative
  // useful cadence. UI lets them change immediately.
  autoFetchIntervalSec: 24 * 3600,
  autoFetchAnchorDow: null,
  autoFetchAnchorHour: 8,
  autoFetchAnchorMinute: 0,
  autoFetchLastRunAt: null,
};

/**
 * Whitelisted auto-fetch cadence values, seconds. UI uses these verbatim
 * for the dropdown + is the set of values the backend scheduler is known
 * to compute next-fire correctly for. Adding a value here doesn't require
 * a backend change (the scheduler accepts any positive integer), but the
 * anchor-visibility rules in SettingsDialog depend on this set.
 */
export const AUTO_FETCH_INTERVALS_SEC = [
  5 * 60,
  15 * 60,
  30 * 60,
  60 * 60,
  4 * 60 * 60,
  8 * 60 * 60,
  24 * 60 * 60,
  7 * 24 * 60 * 60,
] as const;

export type AutoFetchIntervalSec = (typeof AUTO_FETCH_INTERVALS_SEC)[number];

export interface SignInResult {
  ok: boolean;
  timedOut: boolean;
  message: string;
}

export interface GitSetupStatus {
  installed: boolean;
  version: string | null;
  userNameSet: boolean;
  userEmailSet: boolean;
  credentialHelperSet: boolean;
}

export interface ConfigureHelperResult {
  helper: string;
  message: string;
}

/* --------- Workspaces (Phase 2.2) --------- */

export interface WorkspaceSummary {
  id: number;
  name: string;
  repoCount: number;
  updatedAt: string;
}

export interface WorkspaceRepoEntry {
  repoId: number;
  repoName: string;
  repoPathExists: boolean;
  branch: string;
  position: number;
}

export interface WorkspaceDetail {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  entries: WorkspaceRepoEntry[];
}

export type ActivationKind =
  | "switched"
  | "tracked"
  | "already_on"
  | "skipped_dirty"
  | "skipped_missing_repo"
  | "skipped_missing_branch"
  | "failed";

export interface ActivationOutcome {
  repoId: number;
  repoName: string;
  requestedBranch: string;
  kind: ActivationKind;
  message: string;
}

export interface ActivationReport {
  workspaceId: number;
  workspaceName: string;
  groupId: string;
  outcomes: ActivationOutcome[];
}

/** (repoId, branch) pair — the shape backend CRUD wants. */
export type WorkspaceEntryInput = [number, string];

/* --------- Stash bundles (Phase 2.3) --------- */

export type StashStatus =
  | "pending"
  | "restored"
  | "dropped"
  | "missing"
  | "failed";

export interface StashBundleSummary {
  id: number;
  label: string;
  createdAt: string;
  entryCount: number;
  pendingCount: number;
}

export interface StashEntry {
  repoId: number;
  repoName: string;
  repoPathExists: boolean;
  stashSha: string;
  stashShort: string;
  branchAtStash: string | null;
  status: StashStatus;
  createdAt: string;
}

export interface StashBundleDetail {
  id: number;
  label: string;
  createdAt: string;
  entries: StashEntry[];
}

export type StashPushKind =
  | "stashed"
  | "nothing_to_stash"
  | "skipped_missing_repo"
  | "failed";

export interface StashPushOutcome {
  repoId: number;
  repoName: string;
  kind: StashPushKind;
  stashSha: string | null;
  message: string;
}

export interface StashPushReport {
  bundleId: number | null;
  label: string;
  outcomes: StashPushOutcome[];
}

export type StashRestoreKind =
  | "restored"
  | "missing"
  | "failed"
  | "already_done"
  | "skipped_missing_repo";

export interface StashRestoreOutcome {
  repoId: number;
  repoName: string;
  stashSha: string;
  kind: StashRestoreKind;
  message: string;
}

export interface StashRestoreReport {
  bundleId: number;
  label: string;
  groupId: string;
  outcomes: StashRestoreOutcome[];
}

/* --------- Phase 2.4: multi-repo group-scoped undo --------- */

export type UndoGroupKind =
  | "reverted"
  | "skipped_original_failed"
  | "skipped_no_head_move"
  | "skipped_no_pre_head"
  | "skipped_head_moved"
  | "skipped_dirty"
  | "skipped_missing_repo"
  | "skipped_missing_commit"
  | "failed";

export interface UndoGroupOutcome {
  repoId: number;
  repoName: string;
  action: string;
  targetShort: string | null;
  fromShort: string | null;
  kind: UndoGroupKind;
  message: string;
}

export interface UndoGroupReport {
  /** The original group_id we were asked to undo. */
  groupId: string;
  /** The group_id assigned to the undo's own action_log rows. Empty
   *  when the pass didn't actually revert anything. */
  undoGroupId: string;
  outcomes: UndoGroupOutcome[];
}

/** One entry in the cross-repo action history. */
export interface RecentActionGroup {
  groupId: string;
  /** Representative action label (e.g. "workspace_activate"). */
  action: string;
  repoCount: number;
  successCount: number;
  /** Legs where HEAD actually moved — 0 for stash_push / stash_apply
   *  (stash doesn't touch HEAD), so the Undo button is a no-op for
   *  those and the UI hides it. */
  headMoveCount: number;
  /** Newest started_at ISO8601 timestamp across the group. */
  occurredAt: string;
  /** First few repo names (capped backend-side at 4). */
  repoNames: string[];
  repoNamesTruncated: boolean;
}
