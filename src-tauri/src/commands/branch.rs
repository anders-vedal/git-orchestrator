//! Branch UI backend: list branches, checkout an existing branch,
//! create-and-checkout a new branch. Each write is logged to
//! `action_log` under action='checkout' so Phase 2.4 can roll back a
//! multi-repo branch switch via log_action_in_group.

use crate::git::{branch, runner, status};
use crate::models::{BranchList, CheckoutResult};
use std::path::Path;
use std::time::Instant;

use super::git_ops::{load_repo, log_action};

#[tauri::command]
pub async fn git_list_branches(id: i64) -> Result<BranchList, String> {
    let repo = load_repo(id).await?;
    let path = repo.path.clone();
    tokio::task::spawn_blocking(move || {
        branch::list_branches(Path::new(&path)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Switch to an existing local branch. Refuses if the target branch
/// doesn't exist as a local ref (no auto-tracking here — Phase 2.1 keeps
/// the command surface small; Phase 2.2 adds the "track a remote" path).
/// Dirty-tree refusal is delegated to git, which surfaces a precise
/// "your local changes would be overwritten" message when applicable.
#[tauri::command]
pub async fn git_checkout(id: i64, name: String) -> Result<CheckoutResult, String> {
    let repo = load_repo(id).await?;
    let path = repo.path.clone();
    let repo_id = repo.id;

    tokio::task::spawn_blocking(move || -> Result<CheckoutResult, String> {
        let p = Path::new(&path);
        let previous_branch = status::current_branch(p).ok();
        let previous_head_sha = status::current_head_sha(p).map_err(|e| e.to_string())?;
        let started_at = chrono::Utc::now().to_rfc3339();
        let t0 = Instant::now();

        let out = branch::checkout(p, &name).map_err(|e| e.to_string())?;
        let message = merge_stdout_stderr(&out);
        if out.code != 0 {
            log_action(
                repo_id,
                "checkout",
                previous_head_sha.as_deref(),
                None,
                out.code,
                Some(&message),
                &started_at,
                t0.elapsed().as_millis() as i64,
            );
            return Err(message);
        }

        let new_head_sha = status::current_head_sha(p).map_err(|e| e.to_string())?;
        log_action(
            repo_id,
            "checkout",
            previous_head_sha.as_deref(),
            new_head_sha.as_deref(),
            0,
            Some(&message),
            &started_at,
            t0.elapsed().as_millis() as i64,
        );

        Ok(CheckoutResult {
            previous_branch,
            previous_head_sha,
            new_branch: name,
            new_head_sha,
            message,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Create a new local branch and switch to it. `start_point` accepts any
/// revision git understands: another branch name ("main"),
/// "origin/<branch>", a commit SHA, a tag, etc. None branches from HEAD.
#[tauri::command]
pub async fn git_create_branch(
    id: i64,
    name: String,
    start_point: Option<String>,
) -> Result<CheckoutResult, String> {
    let repo = load_repo(id).await?;
    let path = repo.path.clone();
    let repo_id = repo.id;

    tokio::task::spawn_blocking(move || -> Result<CheckoutResult, String> {
        let p = Path::new(&path);
        let previous_branch = status::current_branch(p).ok();
        let previous_head_sha = status::current_head_sha(p).map_err(|e| e.to_string())?;
        let started_at = chrono::Utc::now().to_rfc3339();
        let t0 = Instant::now();

        let out = branch::create_and_checkout(p, &name, start_point.as_deref())
            .map_err(|e| e.to_string())?;
        let message = merge_stdout_stderr(&out);
        if out.code != 0 {
            log_action(
                repo_id,
                "checkout",
                previous_head_sha.as_deref(),
                None,
                out.code,
                Some(&message),
                &started_at,
                t0.elapsed().as_millis() as i64,
            );
            return Err(message);
        }

        let new_head_sha = status::current_head_sha(p).map_err(|e| e.to_string())?;
        log_action(
            repo_id,
            "checkout",
            previous_head_sha.as_deref(),
            new_head_sha.as_deref(),
            0,
            Some(&message),
            &started_at,
            t0.elapsed().as_millis() as i64,
        );

        Ok(CheckoutResult {
            previous_branch,
            previous_head_sha,
            new_branch: name,
            new_head_sha,
            message,
        })
    })
    .await
    .map_err(|e| e.to_string())?
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

