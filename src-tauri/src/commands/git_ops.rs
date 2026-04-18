use crate::db;
use crate::db::queries::NewActionLog;
use crate::git::{log, runner, status};
use crate::models::{
    ActionLogEntry, BulkPullReport, BulkReason, BulkResult, ConfigureHelperResult, Dirty,
    DirtyBreakdown, ForcePullPreview, ForcePullResult, GitSetupStatus, SignInResult,
};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;

/// Hard cap on the sign-in flow. Long enough for a real device-code /
/// browser OAuth round-trip (GCM's slowest path), short enough that a
/// wedged helper can't pin a UI row forever.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(120);

const STDERR_EXCERPT_MAX: usize = 2_000;

fn excerpt(s: &str) -> Option<String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        None
    } else if trimmed.len() > STDERR_EXCERPT_MAX {
        Some(format!("{}…", &trimmed[..STDERR_EXCERPT_MAX]))
    } else {
        Some(trimmed.to_string())
    }
}

fn short_sha(full: &str) -> String {
    full.chars().take(7).collect()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn merge_stdout_stderr(out: &runner::GitOutput) -> String {
    let mut s = out.stdout.trim().to_string();
    let stderr = out.stderr.trim();
    if !stderr.is_empty() {
        if !s.is_empty() {
            s.push('\n');
        }
        s.push_str(stderr);
    }
    s
}

async fn load_repo(id: i64) -> Result<crate::models::Repo, String> {
    db::with_conn(|c| crate::db::queries::find_repo(c, id))
}

#[tauri::command]
pub async fn git_fetch(id: i64) -> Result<String, String> {
    let repo = load_repo(id).await?;
    let path = repo.path.clone();
    tokio::task::spawn_blocking(move || {
        let p = Path::new(&path);
        runner::run_git_raw(p, &["fetch", "--all", "--prune"])
            .map_err(|e| e.to_string())
            .and_then(|o| {
                if o.code == 0 {
                    Ok(merge_stdout_stderr(&o))
                } else {
                    Err(merge_stdout_stderr(&o))
                }
            })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_pull_ff(id: i64) -> Result<String, String> {
    let repo = load_repo(id).await?;
    let path = repo.path.clone();
    tokio::task::spawn_blocking(move || {
        let p = Path::new(&path);
        runner::run_git_raw(p, &["pull", "--ff-only"])
            .map_err(|e| e.to_string())
            .and_then(|o| {
                if o.code == 0 {
                    Ok(merge_stdout_stderr(&o))
                } else {
                    Err(merge_stdout_stderr(&o))
                }
            })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Force pull: fetch, then reset hard to origin/<default_branch>.
/// Guard: refuse if the current branch is NOT the default branch.
///
/// Captures the pre-reset HEAD before running, logs the action to
/// `action_log`, and returns a structured result so the frontend can
/// render a reflog-rescue hint and an in-session Undo button.
#[tauri::command]
pub async fn git_force_pull(id: i64) -> Result<ForcePullResult, String> {
    let repo = load_repo(id).await?;
    let path = repo.path.clone();
    let repo_id = repo.id;

    tokio::task::spawn_blocking(move || -> Result<ForcePullResult, String> {
        let p = Path::new(&path);
        let current = status::current_branch(p).map_err(|e| e.to_string())?;
        let default = status::default_branch(p).map_err(|e| e.to_string())?;
        if current != default {
            return Err(format!(
                "refuse to force pull: checked out '{current}', default branch is '{default}'"
            ));
        }

        let pre_head = status::current_head_sha(p).map_err(|e| e.to_string())?;
        let started_at = now_iso();
        let t0 = Instant::now();

        let fetch = runner::run_git_raw(p, &["fetch", "--prune", "origin"])
            .map_err(|e| e.to_string())?;
        if fetch.code != 0 {
            let msg = merge_stdout_stderr(&fetch);
            log_action(
                repo_id,
                "force_pull",
                pre_head.as_deref(),
                None,
                fetch.code,
                Some(&msg),
                &started_at,
                t0.elapsed().as_millis() as i64,
            );
            return Err(msg);
        }

        let reset_target = format!("origin/{default}");
        let reset = runner::run_git_raw(p, &["reset", "--hard", &reset_target])
            .map_err(|e| e.to_string())?;
        if reset.code != 0 {
            let msg = merge_stdout_stderr(&reset);
            log_action(
                repo_id,
                "force_pull",
                pre_head.as_deref(),
                None,
                reset.code,
                Some(&msg),
                &started_at,
                t0.elapsed().as_millis() as i64,
            );
            return Err(msg);
        }

        let post_head = status::current_head_sha(p).map_err(|e| e.to_string())?;
        let discarded = match (&pre_head, &post_head) {
            (Some(pre), Some(post)) if pre != post => {
                status::rev_count_between(p, pre, post).unwrap_or(0)
            }
            _ => 0,
        };

        let mut summary = merge_stdout_stderr(&fetch);
        let reset_msg = merge_stdout_stderr(&reset);
        if !reset_msg.is_empty() {
            if !summary.is_empty() {
                summary.push('\n');
            }
            summary.push_str(&reset_msg);
        }

        log_action(
            repo_id,
            "force_pull",
            pre_head.as_deref(),
            post_head.as_deref(),
            0,
            excerpt(&summary).as_deref(),
            &started_at,
            t0.elapsed().as_millis() as i64,
        );

        Ok(ForcePullResult {
            pre_head_short: pre_head.as_deref().map(short_sha),
            pre_head_sha: pre_head,
            post_head_short: post_head.as_deref().map(short_sha),
            post_head_sha: post_head,
            discarded_count: discarded,
            message: summary,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn log_action(
    repo_id: i64,
    action: &str,
    pre_head_sha: Option<&str>,
    post_head_sha: Option<&str>,
    exit_code: i32,
    stderr_excerpt: Option<&str>,
    started_at: &str,
    duration_ms: i64,
) {
    let entry = NewActionLog {
        repo_id,
        action,
        pre_head_sha,
        post_head_sha,
        exit_code,
        stderr_excerpt,
        started_at,
        duration_ms,
    };
    if let Err(e) = db::with_conn(|c| db::queries::insert_action_log(c, &entry)) {
        eprintln!("[repo-dashboard] action_log insert failed: {e}");
    }
}

/// Restore the most recent undoable action for this repo. Refuses if the
/// working tree is dirty (user has made new changes since the action ran),
/// because `reset --hard` would destroy them. The undo itself is logged
/// as its own `action_log` row so it's recoverable too.
#[tauri::command]
pub async fn undo_last_action(id: i64) -> Result<ForcePullResult, String> {
    let repo = load_repo(id).await?;
    let path = repo.path.clone();
    let repo_id = repo.id;

    tokio::task::spawn_blocking(move || -> Result<ForcePullResult, String> {
        let p = Path::new(&path);

        let last = db::with_conn(|c| db::queries::last_undoable_action(c, repo_id))?
            .ok_or_else(|| "no recent force-pull to undo".to_string())?;

        let target_sha = last
            .pre_head_sha
            .clone()
            .ok_or_else(|| "previous HEAD not recorded; cannot undo".to_string())?;

        match status::dirty_from_porcelain(p).map_err(|e| e.to_string())? {
            Dirty::Clean => {}
            other => {
                return Err(format!(
                    "refuse to undo: working tree is {:?}. Commit or stash before undo.",
                    other
                ));
            }
        }

        let current_head = status::current_head_sha(p).map_err(|e| e.to_string())?;
        let started_at = now_iso();
        let t0 = Instant::now();

        let reset = runner::run_git_raw(p, &["reset", "--hard", &target_sha])
            .map_err(|e| e.to_string())?;
        if reset.code != 0 {
            let msg = merge_stdout_stderr(&reset);
            log_action(
                repo_id,
                "undo",
                current_head.as_deref(),
                None,
                reset.code,
                Some(&msg),
                &started_at,
                t0.elapsed().as_millis() as i64,
            );
            return Err(msg);
        }

        let post_head = status::current_head_sha(p).map_err(|e| e.to_string())?;
        let summary = merge_stdout_stderr(&reset);

        log_action(
            repo_id,
            "undo",
            current_head.as_deref(),
            post_head.as_deref(),
            0,
            excerpt(&summary).as_deref(),
            &started_at,
            t0.elapsed().as_millis() as i64,
        );

        Ok(ForcePullResult {
            pre_head_short: current_head.as_deref().map(short_sha),
            pre_head_sha: current_head,
            post_head_short: post_head.as_deref().map(short_sha),
            post_head_sha: post_head,
            discarded_count: 0,
            message: summary,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Re-runs `git fetch --dry-run` against the repo's origin with GIT_TRACE
/// enabled so we can show the user what the auth/network path is doing
/// when a previous fetch/pull failed. Never writes to the working tree.
#[tauri::command]
pub async fn diagnose_auth(id: i64) -> Result<String, String> {
    let repo = load_repo(id).await?;
    let path = repo.path.clone();
    tokio::task::spawn_blocking(move || {
        let p = Path::new(&path);
        runner::run_git_traced(p, &["fetch", "--dry-run", "--prune", "origin"])
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Trigger Git Credential Manager's interactive sign-in flow for a repo's
/// origin. Runs `git fetch --dry-run origin` WITHOUT the `GCM_INTERACTIVE=Never`
/// override, so GCM is free to spawn its browser-based OAuth popup (or
/// device-code UI) when credentials are missing or expired.
///
/// Security posture:
/// - Credentials never enter this process — GCM talks to Windows Credential
///   Manager (DPAPI) / macOS Keychain / libsecret on its own.
/// - Frontend passes only `id`, never a URL or command string (invariant #3).
/// - We don't log stdout/stderr verbatim anywhere; the UI receives a short
///   sanitized summary via `crate::git::log` parsers / the existing
///   `gitErrors.ts` classifier.
/// - Hard 120s timeout via `run_git_interactive` so a wedged helper can't
///   lock a UI row.
///
/// `--dry-run` means this never writes refs or the working tree; it only
/// verifies auth + remote reachability.
#[tauri::command]
pub async fn sign_in_remote(id: i64) -> Result<SignInResult, String> {
    let repo = load_repo(id).await?;
    let path = repo.path.clone();
    tokio::task::spawn_blocking(move || -> Result<SignInResult, String> {
        let p = Path::new(&path);
        match runner::run_git_interactive(
            p,
            &["fetch", "--dry-run", "--prune", "origin"],
            SIGN_IN_TIMEOUT,
        ) {
            Ok(out) if out.code == 0 => Ok(SignInResult {
                ok: true,
                timed_out: false,
                message: "Signed in — credentials saved by your OS credential helper.".to_string(),
            }),
            Ok(out) => Err(merge_stdout_stderr(&out)),
            Err(runner::GitError::Timeout) => Ok(SignInResult {
                ok: false,
                timed_out: true,
                message: "Sign-in timed out after 2 minutes. Close any browser or credential-manager popups and try again.".to_string(),
            }),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// One-shot check of the user's global git setup — used by the first-run
/// banner to nudge non-technical users through installing and configuring
/// Git before we try to talk to a remote on their behalf.
///
/// Never prompts the user for anything. Never touches the network.
/// Reads `git --version` and three `git config --global --get` queries.
#[tauri::command]
pub async fn git_setup_status() -> Result<GitSetupStatus, String> {
    tokio::task::spawn_blocking(|| -> Result<GitSetupStatus, String> {
        // `git --version` — proves git is on PATH.
        let (installed, version) = match runner::run_git_no_repo(&["--version"]) {
            Ok(out) if out.code == 0 => {
                let v = out.stdout.trim();
                let stripped = v.strip_prefix("git version ").unwrap_or(v);
                (true, Some(stripped.to_string()))
            }
            _ => (false, None),
        };

        if !installed {
            return Ok(GitSetupStatus {
                installed: false,
                version: None,
                user_name_set: false,
                user_email_set: false,
                credential_helper_set: false,
            });
        }

        let user_name_set = matches!(
            runner::run_git_no_repo(&["config", "--global", "--get", "user.name"]),
            Ok(o) if o.code == 0 && !o.stdout.trim().is_empty()
        );
        let user_email_set = matches!(
            runner::run_git_no_repo(&["config", "--global", "--get", "user.email"]),
            Ok(o) if o.code == 0 && !o.stdout.trim().is_empty()
        );
        let credential_helper_set = matches!(
            runner::run_git_no_repo(&["config", "--global", "--get", "credential.helper"]),
            Ok(o) if o.code == 0 && !o.stdout.trim().is_empty()
        );

        Ok(GitSetupStatus {
            installed: true,
            version,
            user_name_set,
            user_email_set,
            credential_helper_set,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// One-click fix for the "no credential helper configured" banner. Writes
/// `credential.helper = <name>` to the user's global git config, picking
/// the best-available helper in this order:
///
///   1. `manager`  — Git Credential Manager, if `git credential-manager
///      --version` succeeds. Modern, browser-based OAuth for all major
///      hosts, stores tokens in Windows Credential Manager (DPAPI) /
///      macOS Keychain / libsecret. This is the preferred option on every
///      platform when available.
///   2. Platform fallback — `wincred` on Windows (built into Git for
///      Windows, uses Windows Credential Manager), `osxkeychain` on macOS
///      (built into Git for Mac, uses Keychain). Both keep credentials in
///      the OS-level encrypted store.
///   3. Linux without GCM — return an error so the UI can tell the user to
///      install GCM. We refuse to set `store` (plaintext) or `cache`
///      (15-minute in-memory; doesn't solve the "signing in" use case).
///
/// Security posture:
/// - The helper name written is HARDCODED and chosen by the backend. The
///   frontend passes no arguments whatsoever — a compromised renderer
///   cannot substitute an attacker-controlled helper (e.g. a shell command
///   via `!foo`). See `git-config(1)` "credential.helper" — Git runs the
///   value as a shell command when it starts with `!`.
/// - The write is scoped to `--global`, not `--system`. It lands in
///   `~/.gitconfig` and is trivially reversible with
///   `git config --global --unset credential.helper`.
/// - No credentials are read, written, or logged here. This is purely a
///   config-file edit.
#[tauri::command]
pub async fn configure_credential_helper() -> Result<ConfigureHelperResult, String> {
    tokio::task::spawn_blocking(|| -> Result<ConfigureHelperResult, String> {
        // Probe for modern GCM first — it's what we recommend everywhere.
        let gcm_available = matches!(
            runner::run_git_no_repo(&["credential-manager", "--version"]),
            Ok(o) if o.code == 0
        );

        let helper: &'static str = if gcm_available {
            "manager"
        } else {
            #[cfg(windows)]
            { "wincred" }
            #[cfg(target_os = "macos")]
            { "osxkeychain" }
            #[cfg(all(not(windows), not(target_os = "macos")))]
            {
                return Err(
                    "Git Credential Manager isn't installed. Install it from \
                     https://github.com/git-ecosystem/git-credential-manager \
                     and click \"Check again\"."
                        .to_string(),
                );
            }
        };

        // Invariant: `helper` is one of { "manager", "wincred", "osxkeychain" }
        // — all hardcoded literals above. If this assertion fires, someone
        // added a new branch without updating the allowlist.
        debug_assert!(
            matches!(helper, "manager" | "wincred" | "osxkeychain"),
            "helper name must be hardcoded, got {helper}"
        );

        let out = runner::run_git_no_repo(&[
            "config",
            "--global",
            "credential.helper",
            helper,
        ])
        .map_err(|e| e.to_string())?;

        if out.code != 0 {
            let stderr = out.stderr.trim();
            return Err(if stderr.is_empty() {
                format!("git config failed with exit code {}", out.code)
            } else {
                stderr.to_string()
            });
        }

        // The resolved helper just changed — drop the cached value so the
        // next git invocation re-reads config and the new helper gets
        // re-pinned on every subsequent call.
        runner::invalidate_credential_helper_cache();

        let message = match helper {
            "manager" => {
                "Git Credential Manager is now configured. It will prompt you to sign in \
                 the next time you fetch or pull — credentials are stored by your \
                 operating system, never by this app."
                    .to_string()
            }
            "wincred" => {
                "Using the built-in Windows Credential Manager. Your credentials will be \
                 stored in Windows' encrypted credential store. For OAuth-based sign-in \
                 with GitHub/GitLab/Azure, install Git Credential Manager and click \
                 \"Check again\"."
                    .to_string()
            }
            "osxkeychain" => {
                "Using the built-in macOS Keychain. Your credentials will be stored in \
                 the system Keychain."
                    .to_string()
            }
            _ => unreachable!("helper name is not in the hardcoded allowlist"),
        };

        Ok(ConfigureHelperResult {
            helper: helper.to_string(),
            message,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Most recent destructive actions for this repo. Feeds an "action history"
/// panel in the UI.
#[tauri::command]
pub async fn get_action_log(id: i64, limit: Option<i64>) -> Result<Vec<ActionLogEntry>, String> {
    let limit = limit.unwrap_or(20).clamp(1, 200);
    db::with_conn(|c| db::queries::recent_actions_for_repo(c, id, limit))
}

/// Pre-flight disclosure for the force-pull dialog: what would be discarded,
/// what would be fast-forwarded, how dirty the tree is. Reflects currently
/// known remote state — no fetch happens here; the force-pull itself
/// fetches before resetting.
#[tauri::command]
pub async fn force_pull_preview(id: i64) -> Result<ForcePullPreview, String> {
    const UNPUSHED_DISPLAY_LIMIT: u32 = 10;

    let repo = load_repo(id).await?;
    let path = repo.path.clone();

    tokio::task::spawn_blocking(move || -> Result<ForcePullPreview, String> {
        let p = Path::new(&path);

        let current_branch = status::current_branch(p).map_err(|e| e.to_string())?;
        let default_branch = status::default_branch(p).map_err(|e| e.to_string())?;
        let on_default = current_branch == default_branch;

        if !on_default {
            return Ok(ForcePullPreview {
                current_branch,
                default_branch,
                on_default: false,
                ahead: 0,
                behind: 0,
                unpushed_commits: Vec::new(),
                dirty: DirtyBreakdown::default(),
                remote_head_short: None,
            });
        }

        let (ahead, behind, _has_upstream) =
            status::ahead_behind(p).unwrap_or((0, 0, false));

        let remote_ref = format!("origin/{default_branch}");
        let unpushed_commits = if ahead > 0 {
            log::commits_since(p, &remote_ref, UNPUSHED_DISPLAY_LIMIT).unwrap_or_default()
        } else {
            Vec::new()
        };

        let dirty = status::dirty_breakdown(p).unwrap_or_default();
        let remote_head_short = status::ref_short_sha(p, &remote_ref).unwrap_or(None);

        Ok(ForcePullPreview {
            current_branch,
            default_branch,
            on_default: true,
            ahead,
            behind,
            unpushed_commits,
            dirty,
            remote_head_short,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_fetch_all() -> Result<Vec<BulkResult>, String> {
    let repos = db::with_conn(|c| crate::db::queries::list_repos(c))?;
    let sem = Arc::new(Semaphore::new(bulk_concurrency()));

    let mut handles = Vec::with_capacity(repos.len());
    for r in repos {
        let id = r.id;
        let path = r.path.clone();
        let sem = Arc::clone(&sem);
        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire_owned().await.ok();
            tokio::task::spawn_blocking(move || {
                let p = Path::new(&path);
                match runner::run_git_raw(p, &["fetch", "--all", "--prune"]) {
                    Ok(o) if o.code == 0 => BulkResult {
                        id,
                        ok: true,
                        message: merge_stdout_stderr(&o),
                        reason: Some(BulkReason::Ok),
                    },
                    Ok(o) => BulkResult {
                        id,
                        ok: false,
                        message: merge_stdout_stderr(&o),
                        reason: Some(BulkReason::FetchFailed),
                    },
                    Err(e) => BulkResult {
                        id,
                        ok: false,
                        message: e.to_string(),
                        reason: Some(BulkReason::FetchFailed),
                    },
                }
            })
            .await
            .unwrap_or(BulkResult {
                id,
                ok: false,
                message: "task panicked".into(),
                reason: Some(BulkReason::FetchFailed),
            })
        }));
    }

    let mut out = Vec::with_capacity(handles.len());
    for h in handles {
        if let Ok(r) = h.await {
            out.push(r);
        }
    }
    Ok(out)
}

/// Max concurrent repos in a bulk operation. Reads `bulk_concurrency` from
/// the settings table; clamps to [1, 16]. Default 4 when unset or bogus —
/// keeps corporate VPN / GCM popup pressure reasonable.
fn bulk_concurrency() -> usize {
    let raw = db::with_conn(|c| db::queries::get_setting(c, "bulk_concurrency"))
        .ok()
        .flatten();
    let parsed = raw.as_deref().and_then(|s| s.parse::<usize>().ok());
    parsed.unwrap_or(4).clamp(1, 16)
}

/// Pull every repo that is on its default branch AND clean. Skip anything else.
#[tauri::command]
pub async fn git_pull_all_safe() -> Result<BulkPullReport, String> {
    let repos = db::with_conn(|c| crate::db::queries::list_repos(c))?;
    let sem = Arc::new(Semaphore::new(bulk_concurrency()));

    let mut handles = Vec::with_capacity(repos.len());
    for r in repos {
        let id = r.id;
        let path = r.path.clone();
        let sem = Arc::clone(&sem);
        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire_owned().await.ok();
            tokio::task::spawn_blocking(move || classify_pull(id, &path))
                .await
                .unwrap_or((
                    id,
                    PullOutcome::Blocked("task panicked".into(), BulkReason::PullFailed),
                ))
        }));
    }

    let mut report = BulkPullReport {
        updated: Vec::new(),
        skipped: Vec::new(),
        blocked: Vec::new(),
    };

    for h in handles {
        if let Ok((id, outcome)) = h.await {
            match outcome {
                PullOutcome::Updated(msg) => report.updated.push(BulkResult {
                    id,
                    ok: true,
                    message: msg,
                    reason: Some(BulkReason::Ok),
                }),
                PullOutcome::Skipped(msg, reason) => report.skipped.push(BulkResult {
                    id,
                    ok: true,
                    message: msg,
                    reason: Some(reason),
                }),
                PullOutcome::Blocked(msg, reason) => report.blocked.push(BulkResult {
                    id,
                    ok: false,
                    message: msg,
                    reason: Some(reason),
                }),
            }
        }
    }

    Ok(report)
}

fn classify_pull(id: i64, path: &str) -> (i64, PullOutcome) {
    let p = Path::new(path);
    if !p.exists() {
        return (
            id,
            PullOutcome::Blocked("path missing".into(), BulkReason::PathMissing),
        );
    }
    let branch = match status::current_branch(p) {
        Ok(b) => b,
        Err(e) => {
            return (
                id,
                PullOutcome::Blocked(e.to_string(), BulkReason::StatusFailed),
            );
        }
    };
    let default = status::default_branch(p).unwrap_or_else(|_| branch.clone());
    if branch != default {
        return (
            id,
            PullOutcome::Skipped(
                format!("on '{branch}', default is '{default}'"),
                BulkReason::OffDefault,
            ),
        );
    }
    match status::dirty_from_porcelain(p) {
        Ok(Dirty::Clean) => {}
        Ok(other) => {
            return (
                id,
                PullOutcome::Skipped(
                    format!("working tree is {:?}", other).to_lowercase(),
                    BulkReason::Dirty,
                ),
            );
        }
        Err(e) => {
            return (
                id,
                PullOutcome::Blocked(e.to_string(), BulkReason::StatusFailed),
            );
        }
    }

    match runner::run_git_raw(p, &["pull", "--ff-only"]) {
        Ok(o) if o.code == 0 => (id, PullOutcome::Updated(merge_stdout_stderr(&o))),
        Ok(o) => (
            id,
            PullOutcome::Blocked(merge_stdout_stderr(&o), BulkReason::PullFailed),
        ),
        Err(e) => (
            id,
            PullOutcome::Blocked(e.to_string(), BulkReason::PullFailed),
        ),
    }
}

enum PullOutcome {
    Updated(String),
    Skipped(String, BulkReason),
    Blocked(String, BulkReason),
}
