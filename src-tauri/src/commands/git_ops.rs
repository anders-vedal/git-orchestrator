use crate::db;
use crate::db::queries::NewActionLog;
use crate::git::{log, runner, status};
use crate::models::{
    ActionLogEntry, BulkPullReport, BulkReason, BulkResult, CommitPushResult, ConfigureHelperResult,
    Dirty, DirtyBreakdown, ForcePullPreview, ForcePullResult, GitSetupStatus, RecentActionGroup,
    SignInResult, UndoGroupKind, UndoGroupOutcome, UndoGroupReport,
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

pub async fn load_repo(id: i64) -> Result<crate::models::Repo, String> {
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

pub fn log_action(
    repo_id: i64,
    action: &str,
    pre_head_sha: Option<&str>,
    post_head_sha: Option<&str>,
    exit_code: i32,
    stderr_excerpt: Option<&str>,
    started_at: &str,
    duration_ms: i64,
) {
    log_action_inner(
        repo_id,
        action,
        pre_head_sha,
        post_head_sha,
        exit_code,
        stderr_excerpt,
        started_at,
        duration_ms,
        None,
    );
}

/// Log one leg of a multi-repo action, tagging every row with the same
/// `group_id` so Phase 2 workspace/snapshot ops can reconstruct the full
/// group. Callers generate the group_id once per logical operation via
/// `new_action_group_id()` and thread it through their per-repo loop.
#[allow(dead_code)]
pub fn log_action_in_group(
    repo_id: i64,
    action: &str,
    pre_head_sha: Option<&str>,
    post_head_sha: Option<&str>,
    exit_code: i32,
    stderr_excerpt: Option<&str>,
    started_at: &str,
    duration_ms: i64,
    group_id: &str,
) {
    log_action_inner(
        repo_id,
        action,
        pre_head_sha,
        post_head_sha,
        exit_code,
        stderr_excerpt,
        started_at,
        duration_ms,
        Some(group_id),
    );
}

fn log_action_inner(
    repo_id: i64,
    action: &str,
    pre_head_sha: Option<&str>,
    post_head_sha: Option<&str>,
    exit_code: i32,
    stderr_excerpt: Option<&str>,
    started_at: &str,
    duration_ms: i64,
    group_id: Option<&str>,
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
        group_id,
    };
    if let Err(e) = db::with_conn(|c| db::queries::insert_action_log(c, &entry)) {
        eprintln!("[repo-dashboard] action_log insert failed: {e}");
    }
}

/// Generate a fresh identifier to tie together the rows of one multi-repo
/// action. Not cryptographic — uniqueness within a single app run is
/// sufficient. Phase 2 callers: generate once before the per-repo loop,
/// pass the same string to every `log_action_in_group` call.
#[allow(dead_code)]
pub fn new_action_group_id() -> String {
    let nanos = chrono::Utc::now()
        .timestamp_nanos_opt()
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis() * 1_000_000);
    format!("grp_{nanos}")
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

/// Roll back every repo that was touched as part of a multi-repo action
/// group (e.g. a workspace activation that switched branches across N
/// repos). For each successful HEAD-moving leg of the group, verify it's
/// safe to reset and run `git reset --hard <pre_head_sha>`. Each undo
/// leg is itself logged to `action_log` under a fresh group_id so the
/// undo is traceable (and re-recoverable via the reflog if needed).
///
/// Safety gates (per repo):
/// - Original row must have exit_code == 0 (skip failed legs).
/// - pre_head_sha and post_head_sha must be present and differ (skip
///   no-op legs like stash_apply that don't move HEAD).
/// - Working tree must be clean — refuse otherwise rather than clobber
///   new user changes.
/// - Current HEAD must still point at post_head_sha — if the user has
///   committed, pulled, or switched since the action ran, we respect
///   their newer state instead of silently rewinding it.
/// - pre_head_sha must still resolve in the repo (reflog GC could have
///   pruned it, though within the 90-day default that's rare).
#[tauri::command]
pub async fn undo_action_group(group_id: String) -> Result<UndoGroupReport, String> {
    if group_id.trim().is_empty() {
        return Err("group_id is required".to_string());
    }

    let rows = db::with_conn(|c| db::queries::actions_in_group(c, &group_id))?;
    if rows.is_empty() {
        return Err(format!(
            "no action_log rows found for group '{group_id}'"
        ));
    }

    let undo_group_id = new_action_group_id();

    let outcomes = tokio::task::spawn_blocking({
        let group_id = group_id.clone();
        let undo_group_id = undo_group_id.clone();
        move || -> Vec<UndoGroupOutcome> {
            // A group can contain multiple rows for the same repo (rare —
            // e.g. a retried leg). Undo the LATEST row per repo so we
            // unwind the final state, not an intermediate one.
            let mut latest_per_repo: std::collections::HashMap<i64, ActionLogEntry> =
                std::collections::HashMap::new();
            for row in rows {
                latest_per_repo
                    .entry(row.repo_id)
                    .and_modify(|existing| {
                        if row.id > existing.id {
                            *existing = row.clone();
                        }
                    })
                    .or_insert(row);
            }
            let mut ordered: Vec<ActionLogEntry> =
                latest_per_repo.into_values().collect();
            ordered.sort_by_key(|r| r.id);

            ordered
                .into_iter()
                .map(|row| undo_one(&group_id, &undo_group_id, row))
                .collect()
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    // If nothing was actually reverted, return an empty undo_group_id —
    // no rows were written, and surfacing a fake id would clutter the
    // Undo history dropdown.
    let any_reverted = outcomes
        .iter()
        .any(|o| matches!(o.kind, UndoGroupKind::Reverted));
    Ok(UndoGroupReport {
        group_id,
        undo_group_id: if any_reverted { undo_group_id } else { String::new() },
        outcomes,
    })
}

fn undo_one(
    group_id: &str,
    undo_group_id: &str,
    row: ActionLogEntry,
) -> UndoGroupOutcome {
    let _ = group_id; // retained for future audit logging

    let repo_name = db::with_conn(|c| db::queries::find_repo(c, row.repo_id))
        .map(|r| r.name)
        .unwrap_or_else(|_| format!("repo {}", row.repo_id));

    // Skip failed original legs.
    if row.exit_code != 0 {
        return UndoGroupOutcome {
            repo_id: row.repo_id,
            repo_name,
            action: row.action,
            target_short: row.pre_head_sha.as_deref().map(short_sha),
            from_short: row.post_head_sha.as_deref().map(short_sha),
            kind: UndoGroupKind::SkippedOriginalFailed,
            message: "Original action failed — nothing to undo.".to_string(),
        };
    }

    let Some(pre) = row.pre_head_sha.clone() else {
        return UndoGroupOutcome {
            repo_id: row.repo_id,
            repo_name,
            action: row.action,
            target_short: None,
            from_short: row.post_head_sha.as_deref().map(short_sha),
            kind: UndoGroupKind::SkippedNoPreHead,
            message: "No pre-action HEAD was recorded for this leg.".to_string(),
        };
    };

    let post = match row.post_head_sha.clone() {
        Some(p) if p != pre => p,
        Some(_) => {
            return UndoGroupOutcome {
                repo_id: row.repo_id,
                repo_name,
                action: row.action,
                target_short: Some(short_sha(&pre)),
                from_short: Some(short_sha(&pre)),
                kind: UndoGroupKind::SkippedNoHeadMove,
                message: "Action did not move HEAD — a reset wouldn't undo its effect."
                    .to_string(),
            };
        }
        None => {
            return UndoGroupOutcome {
                repo_id: row.repo_id,
                repo_name,
                action: row.action,
                target_short: Some(short_sha(&pre)),
                from_short: None,
                kind: UndoGroupKind::SkippedNoHeadMove,
                message: "No post-action HEAD was recorded for this leg.".to_string(),
            };
        }
    };

    let repo = match db::with_conn(|c| db::queries::find_repo(c, row.repo_id)) {
        Ok(r) => r,
        Err(_) => {
            return UndoGroupOutcome {
                repo_id: row.repo_id,
                repo_name,
                action: row.action,
                target_short: Some(short_sha(&pre)),
                from_short: Some(short_sha(&post)),
                kind: UndoGroupKind::SkippedMissingRepo,
                message: "Repo has been removed from the dashboard.".to_string(),
            };
        }
    };

    let p = Path::new(&repo.path);
    if !p.exists() {
        return UndoGroupOutcome {
            repo_id: row.repo_id,
            repo_name: repo.name,
            action: row.action,
            target_short: Some(short_sha(&pre)),
            from_short: Some(short_sha(&post)),
            kind: UndoGroupKind::SkippedMissingRepo,
            message: format!("Repo path no longer exists: {}", repo.path),
        };
    }

    // pre_head_sha must still resolve to a commit.
    match status::ref_short_sha(p, &pre) {
        Ok(Some(_)) => {}
        _ => {
            return UndoGroupOutcome {
                repo_id: row.repo_id,
                repo_name: repo.name,
                action: row.action,
                target_short: Some(short_sha(&pre)),
                from_short: Some(short_sha(&post)),
                kind: UndoGroupKind::SkippedMissingCommit,
                message: format!(
                    "Pre-action commit {} is no longer reachable in this repo.",
                    short_sha(&pre)
                ),
            };
        }
    }

    // HEAD must still match post_head_sha.
    let current_head = match status::current_head_sha(p) {
        Ok(h) => h,
        Err(e) => {
            return UndoGroupOutcome {
                repo_id: row.repo_id,
                repo_name: repo.name,
                action: row.action,
                target_short: Some(short_sha(&pre)),
                from_short: Some(short_sha(&post)),
                kind: UndoGroupKind::Failed,
                message: format!("Could not read current HEAD: {}", e),
            };
        }
    };
    let current_head_str = current_head.clone().unwrap_or_default();
    if current_head_str != post {
        return UndoGroupOutcome {
            repo_id: row.repo_id,
            repo_name: repo.name,
            action: row.action,
            target_short: Some(short_sha(&pre)),
            from_short: current_head.as_deref().map(short_sha),
            kind: UndoGroupKind::SkippedHeadMoved,
            message: format!(
                "HEAD is now {}, not {} — you've moved on since the action ran.",
                current_head
                    .as_deref()
                    .map(short_sha)
                    .unwrap_or_else(|| "unborn".to_string()),
                short_sha(&post),
            ),
        };
    }

    // Working tree must be clean.
    match status::dirty_from_porcelain(p) {
        Ok(Dirty::Clean) => {}
        Ok(other) => {
            return UndoGroupOutcome {
                repo_id: row.repo_id,
                repo_name: repo.name,
                action: row.action,
                target_short: Some(short_sha(&pre)),
                from_short: current_head.as_deref().map(short_sha),
                kind: UndoGroupKind::SkippedDirty,
                message: format!(
                    "Working tree is {:?} — commit or stash before undoing.",
                    other
                ),
            };
        }
        Err(e) => {
            return UndoGroupOutcome {
                repo_id: row.repo_id,
                repo_name: repo.name,
                action: row.action,
                target_short: Some(short_sha(&pre)),
                from_short: current_head.as_deref().map(short_sha),
                kind: UndoGroupKind::Failed,
                message: format!("Could not read working tree status: {}", e),
            };
        }
    }

    // All gates passed — reset.
    let started_at = now_iso();
    let t0 = Instant::now();
    let reset = match runner::run_git_raw(p, &["reset", "--hard", &pre]) {
        Ok(o) => o,
        Err(e) => {
            let msg = e.to_string();
            log_action_in_group(
                row.repo_id,
                "undo_group",
                current_head.as_deref(),
                current_head.as_deref(),
                -1,
                Some(&msg),
                &started_at,
                t0.elapsed().as_millis() as i64,
                undo_group_id,
            );
            return UndoGroupOutcome {
                repo_id: row.repo_id,
                repo_name: repo.name,
                action: row.action,
                target_short: Some(short_sha(&pre)),
                from_short: current_head.as_deref().map(short_sha),
                kind: UndoGroupKind::Failed,
                message: msg,
            };
        }
    };
    let dur = t0.elapsed().as_millis() as i64;

    if reset.code != 0 {
        let msg = merge_stdout_stderr(&reset);
        log_action_in_group(
            row.repo_id,
            "undo_group",
            current_head.as_deref(),
            current_head.as_deref(),
            reset.code,
            Some(&msg),
            &started_at,
            dur,
            undo_group_id,
        );
        return UndoGroupOutcome {
            repo_id: row.repo_id,
            repo_name: repo.name,
            action: row.action,
            target_short: Some(short_sha(&pre)),
            from_short: current_head.as_deref().map(short_sha),
            kind: UndoGroupKind::Failed,
            message: msg,
        };
    }

    let post_undo_head = status::current_head_sha(p).ok().flatten();
    let summary = merge_stdout_stderr(&reset);
    log_action_in_group(
        row.repo_id,
        "undo_group",
        current_head.as_deref(),
        post_undo_head.as_deref(),
        0,
        excerpt(&summary).as_deref(),
        &started_at,
        dur,
        undo_group_id,
    );

    UndoGroupOutcome {
        repo_id: row.repo_id,
        repo_name: repo.name,
        action: row.action,
        target_short: Some(short_sha(&pre)),
        from_short: current_head.as_deref().map(short_sha),
        kind: UndoGroupKind::Reverted,
        message: if summary.trim().is_empty() {
            format!("Reset to {}.", short_sha(&pre))
        } else {
            summary
        },
    }
}

/// Stage every change (`git add -A`), commit with the supplied message, and
/// optionally push. Two flavours, controlled by `push_mode` (falling back
/// to the per-repo override, then the global `push_mode` setting, then
/// `"direct"`):
///
/// - `"direct"` (original behaviour) — commit on the current branch, push
///   to its upstream (or `-u origin <branch>` on first push).
/// - `"pr"` — when the user is on the repo's default branch, create a new
///   branch named `branch_name`, commit on it, push `-u origin <name>`,
///   and return a provider PR compare URL. When the user is already on
///   a non-default branch, PR mode silently falls through to direct push
///   (pushing the feature branch is equivalent).
///
/// Guards:
/// - Refuses on a detached HEAD — can't commit to nowhere.
/// - Refuses when there's nothing to stage — avoids empty commits.
/// - PR mode validates the branch name via `git check-ref-format --branch`
///   and refuses a local-branch collision before any mutation.
/// - Push uses plain `git push` (never `--force`); on a branch with no
///   configured upstream the direct flow adds `-u origin <branch>` so the
///   first push also sets the upstream.
/// - Pre- and post-HEAD SHAs are written to `action_log` so a future
///   "undo commit" feature can restore via `git reset --soft` without
///   data loss.
#[tauri::command]
pub async fn git_commit_push(
    id: i64,
    message: String,
    push: bool,
    push_mode: Option<String>,
    branch_name: Option<String>,
) -> Result<CommitPushResult, String> {
    let trimmed = message.trim().to_string();
    if trimmed.is_empty() {
        return Err("commit message is required".to_string());
    }

    let repo = load_repo(id).await?;
    let path = repo.path.clone();
    let repo_id = repo.id;

    // Resolve effective push mode: explicit param → repo override → global
    // setting → "direct". Keeps the wire protocol simple — callers usually
    // pass None and let the backend decide.
    let global = db::with_conn(|c| db::queries::get_setting(c, "push_mode"))
        .ok()
        .flatten();
    let override_mode = push_mode.as_deref().or(repo.push_mode.as_deref());
    let effective_mode = crate::commands::repos::resolve_effective_push_mode(
        override_mode,
        global.as_deref(),
    );

    // PR mode is only meaningful when the caller actually wants to push —
    // a PR without a push has nothing to compare. Keep the flag internal.
    let want_pr_mode = effective_mode == "pr" && push;

    // Pre-validate branch_name before we enter spawn_blocking so a bad
    // name never reaches the working tree. Authoritative shape check
    // happens inside via `git check-ref-format`.
    let pr_branch = if want_pr_mode {
        let name = branch_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                "PR mode requires a branch name — open the dialog and fill the Branch field."
                    .to_string()
            })?;
        if name.len() > 200
            || name
                .chars()
                .any(|c| c == ' ' || c == '\n' || c == '\r' || c == '\t')
        {
            return Err(format!("invalid branch name: {name:?}"));
        }
        Some(name.to_string())
    } else {
        None
    };

    tokio::task::spawn_blocking(move || -> Result<CommitPushResult, String> {
        let p = Path::new(&path);

        let branch = status::current_branch(p).map_err(|e| e.to_string())?;
        if branch == "HEAD" || branch.is_empty() {
            return Err(
                "refuse to commit: HEAD is detached. Check out a branch first.".to_string(),
            );
        }
        let default = status::default_branch(p).map_err(|e| e.to_string())?;

        // PR mode only activates when the user is on the default branch.
        // On a feature branch, pushing that branch directly produces the
        // same compare-able outcome without adding a redundant layer.
        let activate_pr = want_pr_mode && branch == default && pr_branch.is_some();

        let pre_head = status::current_head_sha(p).map_err(|e| e.to_string())?;
        let started_at = now_iso();
        let t0 = Instant::now();

        if activate_pr {
            return commit_push_pr_flow(
                p,
                repo_id,
                &branch,
                &default,
                pr_branch.as_deref().unwrap(),
                &trimmed,
                pre_head.as_deref(),
                &started_at,
                t0,
            );
        }

        // --- Direct push flow (original behaviour, unchanged) -------------

        // 1. Stage everything.
        let add = runner::run_git_raw(p, &["add", "-A"]).map_err(|e| e.to_string())?;
        if add.code != 0 {
            let msg = merge_stdout_stderr(&add);
            log_action(
                repo_id,
                "commit_push",
                pre_head.as_deref(),
                None,
                add.code,
                Some(&msg),
                &started_at,
                t0.elapsed().as_millis() as i64,
            );
            return Err(msg);
        }

        // 2. Confirm something is staged — avoids empty commits.
        let diff = runner::run_git_raw(p, &["diff", "--cached", "--quiet"])
            .map_err(|e| e.to_string())?;
        if diff.code == 0 {
            return Err(
                "nothing to commit — working tree is clean after staging.".to_string(),
            );
        }

        let staged_files = count_staged_files(p);

        // 3. Commit.
        let commit = runner::run_git_raw(p, &["commit", "-m", &trimmed])
            .map_err(|e| e.to_string())?;
        if commit.code != 0 {
            let msg = merge_stdout_stderr(&commit);
            log_action(
                repo_id,
                "commit_push",
                pre_head.as_deref(),
                None,
                commit.code,
                Some(&msg),
                &started_at,
                t0.elapsed().as_millis() as i64,
            );
            return Err(msg);
        }

        let post_head = status::current_head_sha(p).map_err(|e| e.to_string())?;

        let mut result = CommitPushResult {
            branch: branch.clone(),
            staged_files,
            committed: true,
            commit_sha: post_head.clone(),
            commit_short: post_head.as_deref().map(short_sha),
            commit_message: trimmed.clone(),
            push_attempted: false,
            pushed: false,
            upstream_set: false,
            push_output: String::new(),
            branch_created: false,
            pr_url: None,
        };

        // 4. Push (opt-in). We only surface the outcome — a failure here
        //    leaves the commit intact locally, which is what the user wants.
        if push {
            result.push_attempted = true;

            // Check if the branch already has an upstream configured.
            let up = runner::run_git_raw(
                p,
                &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
            )
            .map_err(|e| e.to_string())?;
            let has_upstream = up.code == 0 && !up.stdout.trim().is_empty();

            let push_out = if has_upstream {
                runner::run_git_raw(p, &["push"]).map_err(|e| e.to_string())?
            } else {
                result.upstream_set = true;
                runner::run_git_raw(p, &["push", "-u", "origin", &branch])
                    .map_err(|e| e.to_string())?
            };

            result.push_output = merge_stdout_stderr(&push_out);
            result.pushed = push_out.code == 0;
        }

        let summary = if result.pushed {
            format!(
                "Committed {} · Pushed to {}{}",
                result.commit_short.clone().unwrap_or_default(),
                if result.upstream_set { "new upstream origin/" } else { "origin/" },
                branch,
            )
        } else if result.push_attempted {
            format!(
                "Committed {} · Push failed: {}",
                result.commit_short.clone().unwrap_or_default(),
                result.push_output
            )
        } else {
            format!(
                "Committed {} (no push requested)",
                result.commit_short.clone().unwrap_or_default()
            )
        };

        log_action(
            repo_id,
            "commit_push",
            pre_head.as_deref(),
            post_head.as_deref(),
            0,
            excerpt(&summary).as_deref(),
            &started_at,
            t0.elapsed().as_millis() as i64,
        );

        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn count_staged_files(p: &Path) -> u32 {
    match runner::run_git_raw(p, &["diff", "--cached", "--name-only", "-z"]) {
        Ok(out) if out.code == 0 => out
            .stdout
            .split('\0')
            .filter(|s| !s.is_empty())
            .count() as u32,
        _ => 0,
    }
}

/// PR-mode branch: checkout -b, stage, commit, push -u, compute PR URL.
/// Fails fast on branch-name collisions so we never commit on an existing
/// branch by accident. Attempts a best-effort revert to the original
/// branch when an early step fails, so the user isn't left stranded on
/// an empty branch.
#[allow(clippy::too_many_arguments)]
fn commit_push_pr_flow(
    p: &Path,
    repo_id: i64,
    original_branch: &str,
    default_branch: &str,
    new_branch: &str,
    message: &str,
    pre_head: Option<&str>,
    started_at: &str,
    t0: Instant,
) -> Result<CommitPushResult, String> {
    // Authoritative branch-name check via git itself. Rejects names with
    // control chars, invalid patterns like `@{…}`, etc.
    let refmt = runner::run_git_raw(p, &["check-ref-format", "--branch", new_branch])
        .map_err(|e| e.to_string())?;
    if refmt.code != 0 {
        return Err(format!(
            "invalid branch name '{new_branch}': {}",
            merge_stdout_stderr(&refmt)
        ));
    }

    // Reject local-branch collisions before any mutation — picking a
    // different name is cheap; recovering from an overwritten branch is not.
    let exists = runner::run_git_raw(
        p,
        &[
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{new_branch}"),
        ],
    )
    .map_err(|e| e.to_string())?;
    if exists.code == 0 {
        return Err(format!(
            "branch '{new_branch}' already exists locally. Pick another name."
        ));
    }

    // Create + switch.
    let checkout = runner::run_git_raw(p, &["checkout", "-b", new_branch])
        .map_err(|e| e.to_string())?;
    if checkout.code != 0 {
        let msg = merge_stdout_stderr(&checkout);
        log_action(
            repo_id,
            "commit_push",
            pre_head,
            None,
            checkout.code,
            Some(&format!("pr_mode checkout -b {new_branch} failed: {msg}")),
            started_at,
            t0.elapsed().as_millis() as i64,
        );
        return Err(msg);
    }

    // Stage.
    let add = runner::run_git_raw(p, &["add", "-A"]).map_err(|e| e.to_string())?;
    if add.code != 0 {
        let msg = merge_stdout_stderr(&add);
        // Best-effort revert: back to the original branch + drop the empty
        // one we just made. If either fails the user has a recoverable
        // state via `git checkout <original>` + `git branch -D <new>`.
        let _ = runner::run_git_raw(p, &["checkout", original_branch]);
        let _ = runner::run_git_raw(p, &["branch", "-D", new_branch]);
        log_action(
            repo_id,
            "commit_push",
            pre_head,
            None,
            add.code,
            Some(&format!("pr_mode add -A failed: {msg}")),
            started_at,
            t0.elapsed().as_millis() as i64,
        );
        return Err(msg);
    }

    // Nothing staged? Undo the branch creation and report cleanly.
    let diff = runner::run_git_raw(p, &["diff", "--cached", "--quiet"])
        .map_err(|e| e.to_string())?;
    if diff.code == 0 {
        let _ = runner::run_git_raw(p, &["checkout", original_branch]);
        let _ = runner::run_git_raw(p, &["branch", "-D", new_branch]);
        return Err("nothing to commit — working tree is clean after staging.".to_string());
    }

    let staged_files = count_staged_files(p);

    // Commit.
    let commit = runner::run_git_raw(p, &["commit", "-m", message])
        .map_err(|e| e.to_string())?;
    if commit.code != 0 {
        let msg = merge_stdout_stderr(&commit);
        // Leave the user on the new branch with the staged index intact
        // so they can recover (e.g. `git commit --no-verify` if a hook
        // misfired). Cleaning up here would destroy that state.
        log_action(
            repo_id,
            "commit_push",
            pre_head,
            None,
            commit.code,
            Some(&format!("pr_mode commit failed: {msg}")),
            started_at,
            t0.elapsed().as_millis() as i64,
        );
        return Err(msg);
    }

    let post_head = status::current_head_sha(p).map_err(|e| e.to_string())?;

    // Push + set upstream.
    let push_out = runner::run_git_raw(p, &["push", "-u", "origin", new_branch])
        .map_err(|e| e.to_string())?;
    let push_text = merge_stdout_stderr(&push_out);
    let pushed = push_out.code == 0;

    // Compute PR URL — only when we actually pushed, so we never point
    // the user at a compare page for a branch that doesn't exist remotely.
    let pr_url = if pushed {
        crate::git::remote::origin_url(p)
            .ok()
            .flatten()
            .and_then(|r| crate::git::remote::compare_web_url(&r, default_branch, new_branch))
    } else {
        None
    };

    let summary = if pushed {
        format!(
            "Committed {} on new branch {} · Pushed to origin. Default: {}.",
            post_head.as_deref().map(short_sha).unwrap_or_default(),
            new_branch,
            default_branch,
        )
    } else {
        format!(
            "Committed {} on new branch {} · Push failed: {}",
            post_head.as_deref().map(short_sha).unwrap_or_default(),
            new_branch,
            push_text,
        )
    };

    log_action(
        repo_id,
        "commit_push",
        pre_head,
        post_head.as_deref(),
        0,
        excerpt(&summary).as_deref(),
        started_at,
        t0.elapsed().as_millis() as i64,
    );

    Ok(CommitPushResult {
        branch: new_branch.to_string(),
        staged_files,
        committed: true,
        commit_sha: post_head.clone(),
        commit_short: post_head.as_deref().map(short_sha),
        commit_message: message.to_string(),
        push_attempted: true,
        pushed,
        upstream_set: true,
        push_output: push_text,
        branch_created: true,
        pr_url,
    })
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

/// Cross-repo action history — returns the N most recent multi-repo
/// action groups (workspace activation, stash bundle push / restore,
/// undo_group). Powers the Recent Actions dialog. Single-repo actions
/// (force_pull, commit_push) are excluded; they're visible on the
/// per-repo action panel.
#[tauri::command]
pub async fn list_recent_action_groups(
    limit: Option<i64>,
) -> Result<Vec<RecentActionGroup>, String> {
    let limit = limit.unwrap_or(50).clamp(1, 200);
    tokio::task::spawn_blocking(move || {
        db::with_conn(|c| db::queries::list_recent_action_groups(c, limit))
    })
    .await
    .map_err(|e| e.to_string())?
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

/// Fetch repos in parallel. When `ids` is `None`, operates on every repo;
/// when `Some`, restricts to the supplied set (used by selection-based
/// bulk actions). Empty `Some(vec![])` is a no-op.
#[tauri::command]
pub async fn git_fetch_all(ids: Option<Vec<i64>>) -> Result<Vec<BulkResult>, String> {
    let repos =
        db::with_conn(|c| crate::db::queries::list_repos_filtered(c, ids.as_deref()))?;
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
/// Same `ids` semantics as `git_fetch_all` — `None` = all, `Some` = filter.
#[tauri::command]
pub async fn git_pull_all_safe(ids: Option<Vec<i64>>) -> Result<BulkPullReport, String> {
    let repos =
        db::with_conn(|c| crate::db::queries::list_repos_filtered(c, ids.as_deref()))?;
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
