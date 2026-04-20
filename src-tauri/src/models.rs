use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Repo {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub priority: i64,
    #[serde(rename = "addedAt")]
    pub added_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Dirty {
    Clean,
    Unstaged,
    Staged,
    Untracked,
    Mixed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Commit {
    pub sha: String,
    #[serde(rename = "shaShort")]
    pub sha_short: String,
    pub message: String,
    pub author: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoStatus {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub branch: String,
    #[serde(rename = "defaultBranch")]
    pub default_branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub dirty: Dirty,
    #[serde(rename = "hasUpstream")]
    pub has_upstream: bool,
    #[serde(rename = "lastFetch")]
    pub last_fetch: Option<String>,
    #[serde(rename = "latestCommit")]
    pub latest_commit: Option<Commit>,
    #[serde(rename = "remoteUrl")]
    pub remote_url: Option<String>,
    /// True if the repo has a `.gitmodules` file (parent-level dirty state
    /// may not reflect submodule drift — warn the user).
    #[serde(rename = "hasSubmodules")]
    pub has_submodules: bool,
    /// True when the branch is both ahead and behind its upstream.
    /// ff-only pull will refuse in this state.
    pub diverged: bool,
    /// Count of local commits not on `origin/<default>` when no upstream
    /// is configured. None when upstream exists (ahead/behind covers it).
    #[serde(rename = "unpushedNoUpstream")]
    pub unpushed_no_upstream: Option<u32>,
    /// Total commits reachable from HEAD. `None` on an unborn branch or
    /// when the count fails — used by the dashboard to sort by repo size.
    #[serde(rename = "commitCount")]
    pub commit_count: Option<u32>,
    /// RFC3339 timestamp of when this status row was computed. Lets the UI
    /// show staleness ("refreshed 45s ago") and gate manual retries.
    #[serde(rename = "lastRefreshedAt")]
    pub last_refreshed_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkResult {
    pub id: i64,
    pub ok: bool,
    pub message: String,
    /// Coarse machine-readable classification so the frontend can render
    /// the right follow-up actions (Open folder, Force pull, Retry, etc.)
    /// instead of showing opaque stderr.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<BulkReason>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BulkReason {
    Ok,
    OffDefault,
    Dirty,
    PathMissing,
    FetchFailed,
    PullFailed,
    StatusFailed,
}

/// Per-category file counts derived from `git status --porcelain`.
/// Populates the force-pull disclosure dialog.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DirtyBreakdown {
    pub staged: u32,
    pub unstaged: u32,
    pub untracked: u32,
}

/// One entry from `git status --porcelain=v1 -z`. `x` and `y` are the
/// two status chars exactly as git emits them — the frontend maps them
/// to display labels. For rename/copy entries, `orig_path` is the source.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangedFile {
    pub path: String,
    #[serde(rename = "origPath", skip_serializing_if = "Option::is_none")]
    pub orig_path: Option<String>,
    pub x: String,
    pub y: String,
}

/// Bounded result from `get_changed_files`. `files` is capped at the limit
/// the caller passed in; `total` is the true count so the frontend can
/// render "+ N more" when truncated.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangedFiles {
    pub files: Vec<ChangedFile>,
    pub total: u32,
    pub truncated: bool,
}

/// What the user sees BEFORE confirming a force-pull. Summarizes exactly
/// what will be discarded, fast-forwarded, and preserved.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForcePullPreview {
    #[serde(rename = "currentBranch")]
    pub current_branch: String,
    #[serde(rename = "defaultBranch")]
    pub default_branch: String,
    #[serde(rename = "onDefault")]
    pub on_default: bool,
    pub ahead: u32,
    pub behind: u32,
    #[serde(rename = "unpushedCommits")]
    pub unpushed_commits: Vec<Commit>,
    pub dirty: DirtyBreakdown,
    #[serde(rename = "remoteHeadShort")]
    pub remote_head_short: Option<String>,
}

/// Outcome of the opt-in commit-and-push flow. Commit and push are
/// reported independently so a successful commit isn't hidden by a
/// push failure (credentials, non-fast-forward, offline).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitPushResult {
    pub branch: String,
    #[serde(rename = "stagedFiles")]
    pub staged_files: u32,
    pub committed: bool,
    #[serde(rename = "commitSha")]
    pub commit_sha: Option<String>,
    #[serde(rename = "commitShort")]
    pub commit_short: Option<String>,
    #[serde(rename = "commitMessage")]
    pub commit_message: String,
    #[serde(rename = "pushAttempted")]
    pub push_attempted: bool,
    pub pushed: bool,
    #[serde(rename = "upstreamSet")]
    pub upstream_set: bool,
    #[serde(rename = "pushOutput")]
    pub push_output: String,
}

/// Result of a force-pull, with the info needed to render a reflog-rescue
/// hint and wire up the session-level "Undo" button.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForcePullResult {
    #[serde(rename = "preHeadSha")]
    pub pre_head_sha: Option<String>,
    #[serde(rename = "preHeadShort")]
    pub pre_head_short: Option<String>,
    #[serde(rename = "postHeadSha")]
    pub post_head_sha: Option<String>,
    #[serde(rename = "postHeadShort")]
    pub post_head_short: Option<String>,
    #[serde(rename = "discardedCount")]
    pub discarded_count: u32,
    pub message: String,
}

/// One row from the `action_log` table. Surfaced to the frontend when we
/// render a repo's recent destructive-action history.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionLogEntry {
    pub id: i64,
    #[serde(rename = "repoId")]
    pub repo_id: i64,
    pub action: String,
    #[serde(rename = "preHeadSha")]
    pub pre_head_sha: Option<String>,
    #[serde(rename = "postHeadSha")]
    pub post_head_sha: Option<String>,
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
    #[serde(rename = "stderrExcerpt")]
    pub stderr_excerpt: Option<String>,
    #[serde(rename = "startedAt")]
    pub started_at: String,
    #[serde(rename = "durationMs")]
    pub duration_ms: i64,
    /// Shared identifier tying together the rows of a single multi-repo
    /// logical action (Phase 2 workspace/snapshot ops). `None` for
    /// single-repo actions.
    #[serde(rename = "groupId")]
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkPullReport {
    pub updated: Vec<BulkResult>,
    pub skipped: Vec<BulkResult>,
    pub blocked: Vec<BulkResult>,
}

/// One user-configured Claude Code launcher entry. The frontend round-trips
/// these as a JSON-serialized array stored under the `cli_actions` setting;
/// the backend validates the shape before it lands in the settings table
/// (see `commands::settings::validate_cli_actions`). `slash_command` must
/// start with `/` and contain only whitelisted characters — no shell
/// metacharacters can reach the terminal launcher.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliAction {
    pub id: String,
    pub label: String,
    #[serde(rename = "slashCommand")]
    pub slash_command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IgnoredPath {
    pub path: String,
    #[serde(rename = "addedAt")]
    pub added_at: String,
}

/// One branch row returned by `git_list_branches`. Locals carry an
/// optional upstream (e.g. "origin/main"); remotes leave it None.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchInfo {
    pub name: String,
    #[serde(rename = "shortSha")]
    pub short_sha: String,
    /// True for refs/remotes/* entries.
    #[serde(rename = "isRemote")]
    pub is_remote: bool,
    /// Marks the local branch HEAD currently points at.
    #[serde(rename = "isCurrent")]
    pub is_current: bool,
    /// Short-form upstream tracking ref (local branches only).
    pub upstream: Option<String>,
    /// ISO8601 last commit date, for sorting / display.
    #[serde(rename = "lastCommitAt")]
    pub last_commit_at: Option<String>,
}

/// Full result of a branch list call: locals, remotes, and the current
/// branch name (None when HEAD is detached or unborn).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchList {
    pub current: Option<String>,
    pub local: Vec<BranchInfo>,
    pub remote: Vec<BranchInfo>,
}

/// Outcome of `git_checkout` / `git_create_branch`. Carries pre/post HEAD
/// so the action_log entry's Undo hook can roll back to `previous_head_sha`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckoutResult {
    #[serde(rename = "previousBranch")]
    pub previous_branch: Option<String>,
    #[serde(rename = "previousHeadSha")]
    pub previous_head_sha: Option<String>,
    #[serde(rename = "newBranch")]
    pub new_branch: String,
    #[serde(rename = "newHeadSha")]
    pub new_head_sha: Option<String>,
    /// Merged stdout+stderr from git — surfaces edge cases like
    /// "Switched to a new branch" vs "Already on '<branch>'".
    pub message: String,
}

/// One commit from the cross-repo activity feed. Flattens `Commit` +
/// the owning repo's id/name so the frontend can render a unified list
/// without a second lookup. Produced by `get_activity_feed`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityEntry {
    #[serde(rename = "repoId")]
    pub repo_id: i64,
    #[serde(rename = "repoName")]
    pub repo_name: String,
    pub sha: String,
    #[serde(rename = "shaShort")]
    pub sha_short: String,
    pub author: String,
    pub timestamp: String,
    pub message: String,
}

/// One candidate surfaced by `scan_folder`. `path` is already normalized.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanEntry {
    pub path: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "alreadyAdded")]
    pub already_added: bool,
    pub ignored: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub parent: String,
    pub entries: Vec<ScanEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanAddResult {
    pub added: Vec<Repo>,
    pub skipped: Vec<ScanSkip>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanSkip {
    pub path: String,
    pub reason: String,
}

/// Outcome of an interactive sign-in triggered from the auth-error panel.
/// Distinguishes a clean success, a user-recoverable timeout, and a hard
/// failure (the latter surfaces as `Err(String)` at the IPC boundary and
/// is classified by the existing `gitErrors.ts` pipeline).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignInResult {
    pub ok: bool,
    #[serde(rename = "timedOut")]
    pub timed_out: bool,
    pub message: String,
}

/// Result of the one-shot git-setup probe used by the first-run banner.
/// All fields reflect the user's GLOBAL git state — nothing repo-scoped.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitSetupStatus {
    pub installed: bool,
    pub version: Option<String>,
    #[serde(rename = "userNameSet")]
    pub user_name_set: bool,
    #[serde(rename = "userEmailSet")]
    pub user_email_set: bool,
    #[serde(rename = "credentialHelperSet")]
    pub credential_helper_set: bool,
}

/// Outcome of the one-click "Set up credential helper" button. `helper` is
/// the value that landed in the user's global git config — always one of
/// the hardcoded allowlisted names (never a value the renderer supplied).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigureHelperResult {
    pub helper: String,
    pub message: String,
}

/// Summary row for the workspace switcher — just what the dropdown needs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSummary {
    pub id: i64,
    pub name: String,
    #[serde(rename = "repoCount")]
    pub repo_count: u32,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

/// One (repo, branch) pair in a workspace. `repoName` and `repoPathExists`
/// are joined in by the backend so the frontend can render the workspace
/// detail view without a second query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceRepoEntry {
    #[serde(rename = "repoId")]
    pub repo_id: i64,
    #[serde(rename = "repoName")]
    pub repo_name: String,
    #[serde(rename = "repoPathExists")]
    pub repo_path_exists: bool,
    pub branch: String,
    pub position: u32,
}

/// Full workspace record plus its ordered entries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceDetail {
    pub id: i64,
    pub name: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    pub entries: Vec<WorkspaceRepoEntry>,
}

/// Per-repo outcome of a workspace activation. `kind` drives the result
/// dialog's grouping + retry button visibility.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivationKind {
    /// Repo was on another branch; we switched it.
    Switched,
    /// Target branch existed only on the remote; we created a local
    /// tracking branch and switched to it.
    Tracked,
    /// Repo was already on the requested branch; no-op.
    AlreadyOn,
    /// Working tree was dirty; we skipped to avoid data loss (Phase 2.3
    /// will add multi-repo stash coordination).
    SkippedDirty,
    /// The workspace entry referenced a repo that has since been removed
    /// from the dashboard, or its on-disk path no longer exists.
    SkippedMissingRepo,
    /// Neither a local branch nor a remote-tracking branch of that name
    /// could be found; the user must edit the workspace.
    SkippedMissingBranch,
    /// Some other git failure. `message` carries the sanitized stderr.
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivationOutcome {
    #[serde(rename = "repoId")]
    pub repo_id: i64,
    #[serde(rename = "repoName")]
    pub repo_name: String,
    #[serde(rename = "requestedBranch")]
    pub requested_branch: String,
    pub kind: ActivationKind,
    pub message: String,
}

/// Return value of `activate_workspace`. The `group_id` ties every
/// action_log row for this activation together for future undo / audit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivationReport {
    #[serde(rename = "workspaceId")]
    pub workspace_id: i64,
    #[serde(rename = "workspaceName")]
    pub workspace_name: String,
    #[serde(rename = "groupId")]
    pub group_id: String,
    pub outcomes: Vec<ActivationOutcome>,
}

/* ---------- Phase 2.3: multi-repo stash bundles ---------- */

/// Status of a single stash entry. See `db/schema.rs` migration 006 for
/// semantics. `status` is a serialized lower-case string in SQLite.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StashStatus {
    Pending,
    Restored,
    Dropped,
    Missing,
    Failed,
}

impl StashStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Restored => "restored",
            Self::Dropped => "dropped",
            Self::Missing => "missing",
            Self::Failed => "failed",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "restored" => Self::Restored,
            "dropped" => Self::Dropped,
            "missing" => Self::Missing,
            "failed" => Self::Failed,
            _ => Self::Pending,
        }
    }
}

/// Summary row for the stash list dialog.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashBundleSummary {
    pub id: i64,
    pub label: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "entryCount")]
    pub entry_count: u32,
    #[serde(rename = "pendingCount")]
    pub pending_count: u32,
}

/// One (repo, stash) pair in a bundle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashEntry {
    #[serde(rename = "repoId")]
    pub repo_id: i64,
    #[serde(rename = "repoName")]
    pub repo_name: String,
    #[serde(rename = "repoPathExists")]
    pub repo_path_exists: bool,
    #[serde(rename = "stashSha")]
    pub stash_sha: String,
    #[serde(rename = "stashShort")]
    pub stash_short: String,
    #[serde(rename = "branchAtStash")]
    pub branch_at_stash: Option<String>,
    pub status: StashStatus,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashBundleDetail {
    pub id: i64,
    pub label: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub entries: Vec<StashEntry>,
}

/// Per-repo outcome when creating a bundle. Mirrors the activation-report
/// pattern: sequential, fail-in-place, grouped result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StashPushKind {
    /// Repo was dirty; we stashed it.
    Stashed,
    /// Working tree was already clean; no stash created.
    NothingToStash,
    /// Repo has been removed from the dashboard, or its path is gone.
    SkippedMissingRepo,
    /// git stash push failed — `message` has the sanitized stderr.
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashPushOutcome {
    #[serde(rename = "repoId")]
    pub repo_id: i64,
    #[serde(rename = "repoName")]
    pub repo_name: String,
    pub kind: StashPushKind,
    #[serde(rename = "stashSha")]
    pub stash_sha: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashPushReport {
    #[serde(rename = "bundleId")]
    pub bundle_id: Option<i64>,
    pub label: String,
    pub outcomes: Vec<StashPushOutcome>,
}

/// Per-repo outcome when restoring a bundle.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StashRestoreKind {
    Restored,
    /// Stash ref no longer exists in the repo (user dropped it manually
    /// or the repo was reinitialised). Entry is marked `missing` in DB.
    Missing,
    /// git stash apply failed — conflicts, dirty tree, etc.
    Failed,
    /// Entry was already marked restored/dropped — no-op this round.
    AlreadyDone,
    SkippedMissingRepo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashRestoreOutcome {
    #[serde(rename = "repoId")]
    pub repo_id: i64,
    #[serde(rename = "repoName")]
    pub repo_name: String,
    #[serde(rename = "stashSha")]
    pub stash_sha: String,
    pub kind: StashRestoreKind,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashRestoreReport {
    #[serde(rename = "bundleId")]
    pub bundle_id: i64,
    pub label: String,
    #[serde(rename = "groupId")]
    pub group_id: String,
    pub outcomes: Vec<StashRestoreOutcome>,
}

/* ---------- Phase 2.4: multi-repo group-scoped undo ---------- */

/// Per-repo outcome of `undo_action_group`. Semantics of each skip
/// variant matter — the UI groups them to explain exactly why a repo
/// did not roll back, so the user can fix it and retry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UndoGroupKind {
    /// HEAD was rolled back to the pre-action SHA via `git reset --hard`.
    Reverted,
    /// Original action failed (exit_code != 0), so there's nothing to
    /// roll back for this repo.
    SkippedOriginalFailed,
    /// The logged action didn't move HEAD (pre == post), e.g. a stash
    /// apply that only touched the working tree — a HEAD reset would
    /// be the wrong undo.
    SkippedNoHeadMove,
    /// No pre_head_sha recorded on the action row — can't roll back.
    SkippedNoPreHead,
    /// User committed / pulled / switched away since the action; HEAD
    /// no longer points at post_head_sha. Respect their newer state
    /// rather than clobber it.
    SkippedHeadMoved,
    /// Working tree has uncommitted changes. `reset --hard` would
    /// destroy them — refuse.
    SkippedDirty,
    /// Repo has been removed from the dashboard or its path is gone.
    SkippedMissingRepo,
    /// The pre_head_sha can no longer be resolved in the repo (GC'd,
    /// reflog pruned, etc.). Can't safely roll back.
    SkippedMissingCommit,
    /// git reset failed for some other reason.
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UndoGroupOutcome {
    #[serde(rename = "repoId")]
    pub repo_id: i64,
    #[serde(rename = "repoName")]
    pub repo_name: String,
    /// The action label on the row we tried to undo (e.g. `workspace_activate`).
    pub action: String,
    /// Short form of the SHA we tried to reset to.
    #[serde(rename = "targetShort")]
    pub target_short: Option<String>,
    /// Short form of HEAD as it was BEFORE the undo ran (= post-action
    /// SHA, if the undo fired; current HEAD otherwise).
    #[serde(rename = "fromShort")]
    pub from_short: Option<String>,
    pub kind: UndoGroupKind,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UndoGroupReport {
    /// The original group_id we were asked to undo.
    #[serde(rename = "groupId")]
    pub group_id: String,
    /// The group_id assigned to the action_log rows written by this
    /// undo pass. Empty string if nothing was logged (no rows written).
    #[serde(rename = "undoGroupId")]
    pub undo_group_id: String,
    pub outcomes: Vec<UndoGroupOutcome>,
}

/// One entry in the cross-repo action history — the aggregated view
/// of a single multi-repo logical action (workspace activation, stash
/// bundle push, stash bundle restore, group undo). `repo_names` is
/// truncated to the first few for display; `repoCount` is the true
/// total across the group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentActionGroup {
    #[serde(rename = "groupId")]
    pub group_id: String,
    /// Representative action label for the group. When legs have
    /// differing labels we pick the most common non-undo label; the
    /// group is almost always homogeneous in practice.
    pub action: String,
    /// Total number of rows in the group (one per repo leg, usually).
    #[serde(rename = "repoCount")]
    pub repo_count: u32,
    /// Legs where exit_code == 0.
    #[serde(rename = "successCount")]
    pub success_count: u32,
    /// Legs where pre_head_sha and post_head_sha differ — i.e. HEAD
    /// actually moved, so `undo_action_group` has something to
    /// revert. Zero for stash_push / stash_apply groups where HEAD
    /// never moves.
    #[serde(rename = "headMoveCount")]
    pub head_move_count: u32,
    /// Newest started_at across the group (ISO8601).
    #[serde(rename = "occurredAt")]
    pub occurred_at: String,
    /// First N repo names for display; omits beyond the cap.
    #[serde(rename = "repoNames")]
    pub repo_names: Vec<String>,
    /// True when repo_names is truncated.
    #[serde(rename = "repoNamesTruncated")]
    pub repo_names_truncated: bool,
}
