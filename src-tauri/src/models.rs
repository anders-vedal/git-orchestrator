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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IgnoredPath {
    pub path: String,
    #[serde(rename = "addedAt")]
    pub added_at: String,
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
