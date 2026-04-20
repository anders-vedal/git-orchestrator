//! Phase 2.2 workspaces: named bundles of (repo_id, branch) pairs the user
//! can "activate" to switch several repos to their listed branches in one
//! click. Activation runs sequentially per repo, logs each leg to the
//! action_log under a shared group_id, and returns a per-repo outcome
//! report. Dirty working trees are skipped rather than clobbered; Phase
//! 2.3 will layer multi-repo stash coordination on top.

use crate::db;
use crate::git::{branch as gbranch, status};
use crate::models::{
    ActivationKind, ActivationOutcome, ActivationReport, Dirty, WorkspaceDetail, WorkspaceSummary,
};
use std::path::Path;
use std::time::Instant;

use super::git_ops::{log_action_in_group, new_action_group_id};

const ACTIVE_KEY: &str = "active_workspace_id";

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn validate_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Workspace name cannot be empty.".to_string());
    }
    if trimmed.chars().count() > 80 {
        return Err("Workspace name is too long (max 80 characters).".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_entries(entries: &[(i64, String)]) -> Result<Vec<(i64, String)>, String> {
    if entries.is_empty() {
        return Err("A workspace needs at least one repo.".to_string());
    }
    let mut seen = std::collections::HashSet::<i64>::new();
    let mut out = Vec::with_capacity(entries.len());
    for (rid, branch) in entries {
        if !seen.insert(*rid) {
            return Err(format!(
                "Repo {rid} appears more than once in this workspace."
            ));
        }
        let b = branch.trim();
        if b.is_empty() {
            return Err(format!(
                "Branch for repo {rid} is empty. Use the repo's current branch or edit the entry."
            ));
        }
        out.push((*rid, b.to_string()));
    }
    Ok(out)
}

#[tauri::command]
pub async fn list_workspaces() -> Result<Vec<WorkspaceSummary>, String> {
    tokio::task::spawn_blocking(|| db::with_conn(|c| db::queries::list_workspaces(c)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_workspace(id: i64) -> Result<WorkspaceDetail, String> {
    tokio::task::spawn_blocking(move || {
        db::with_conn(|c| db::queries::get_workspace_with_entries(c, id))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_workspace(
    name: String,
    entries: Vec<(i64, String)>,
) -> Result<WorkspaceSummary, String> {
    let name = validate_name(&name)?;
    let entries = validate_entries(&entries)?;
    let now = now_iso();
    tokio::task::spawn_blocking(move || -> Result<WorkspaceSummary, String> {
        let id = db::with_conn_mut(|c| {
            db::queries::insert_workspace_with_entries(c, &name, &entries, &now)
        })
        .map_err(|e| {
            // UNIQUE on name surfaces as "UNIQUE constraint failed" — give
            // the user a clearer message.
            if e.contains("UNIQUE") {
                format!("A workspace named \"{name}\" already exists.")
            } else {
                e
            }
        })?;
        Ok(WorkspaceSummary {
            id,
            name,
            repo_count: entries.len() as u32,
            updated_at: now,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rename_workspace(id: i64, new_name: String) -> Result<(), String> {
    let new_name = validate_name(&new_name)?;
    let now = now_iso();
    let name_for_err = new_name.clone();
    tokio::task::spawn_blocking(move || {
        db::with_conn(|c| db::queries::rename_workspace(c, id, &new_name, &now))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| {
        if e.contains("UNIQUE") {
            format!("A workspace named \"{name_for_err}\" already exists.")
        } else {
            e
        }
    })
}

#[tauri::command]
pub async fn delete_workspace(id: i64) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        db::with_conn(|c| -> Result<(), rusqlite::Error> {
            // Clear the active pointer if it was this workspace.
            if let Some(v) = db::queries::get_setting(c, ACTIVE_KEY)? {
                if v == id.to_string() {
                    c.execute(
                        "DELETE FROM settings WHERE key = ?1",
                        rusqlite::params![ACTIVE_KEY],
                    )?;
                }
            }
            db::queries::delete_workspace(c, id)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_workspace_entries(
    id: i64,
    entries: Vec<(i64, String)>,
) -> Result<(), String> {
    let entries = validate_entries(&entries)?;
    let now = now_iso();
    tokio::task::spawn_blocking(move || {
        db::with_conn_mut(|c| db::queries::replace_workspace_entries(c, id, &entries, &now))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_active_workspace_id() -> Result<Option<i64>, String> {
    tokio::task::spawn_blocking(|| {
        db::with_conn(|c| -> Result<Option<i64>, rusqlite::Error> {
            let raw = db::queries::get_setting(c, ACTIVE_KEY)?;
            let id = match raw {
                None => return Ok(None),
                Some(v) => v.parse::<i64>().ok(),
            };
            let Some(id) = id else {
                // Garbage in settings — clean it up.
                c.execute(
                    "DELETE FROM settings WHERE key = ?1",
                    rusqlite::params![ACTIVE_KEY],
                )?;
                return Ok(None);
            };
            if db::queries::workspace_exists(c, id)? {
                Ok(Some(id))
            } else {
                // Points at a deleted workspace — clean it up.
                c.execute(
                    "DELETE FROM settings WHERE key = ?1",
                    rusqlite::params![ACTIVE_KEY],
                )?;
                Ok(None)
            }
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_active_workspace_id(id: Option<i64>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        db::with_conn(|c| -> Result<(), rusqlite::Error> {
            match id {
                None => {
                    c.execute(
                        "DELETE FROM settings WHERE key = ?1",
                        rusqlite::params![ACTIVE_KEY],
                    )?;
                }
                Some(v) => {
                    db::queries::set_setting(c, ACTIVE_KEY, &v.to_string())?;
                }
            }
            Ok(())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Activate a workspace: walk each entry, switch its repo to the listed
/// branch when safe, and collect per-repo outcomes. Sequential by design
/// — avoids the "two checkouts on the same repo race" footgun and keeps
/// the outcome log deterministic. Writes one action_log row per switch
/// under a shared group_id; also sets the active_workspace_id setting.
#[tauri::command]
pub async fn activate_workspace(id: i64) -> Result<ActivationReport, String> {
    let detail = get_workspace(id).await?;
    let group_id = new_action_group_id();

    let outcomes = tokio::task::spawn_blocking({
        let group_id = group_id.clone();
        let detail = detail.clone();
        move || -> Vec<ActivationOutcome> {
            let mut outs = Vec::with_capacity(detail.entries.len());
            for entry in &detail.entries {
                outs.push(activate_one(&group_id, entry));
            }
            outs
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    // Record the active workspace only after the attempt completes.
    // Even if every repo skipped, the "active context" is still this one —
    // the user asked for it and can retry.
    db::with_conn(|c| db::queries::set_setting(c, ACTIVE_KEY, &id.to_string()))?;

    Ok(ActivationReport {
        workspace_id: id,
        workspace_name: detail.name,
        group_id,
        outcomes,
    })
}

fn activate_one(group_id: &str, entry: &crate::models::WorkspaceRepoEntry) -> ActivationOutcome {
    // Re-fetch the repo row fresh; the detail view captured repo_name at
    // query time, but the path is what we need for git ops and may have
    // been edited since the workspace was built.
    let repo = match db::with_conn(|c| db::queries::find_repo(c, entry.repo_id)) {
        Ok(r) => r,
        Err(_) => {
            return ActivationOutcome {
                repo_id: entry.repo_id,
                repo_name: entry.repo_name.clone(),
                requested_branch: entry.branch.clone(),
                kind: ActivationKind::SkippedMissingRepo,
                message: "Repo has been removed from the dashboard.".to_string(),
            };
        }
    };

    let p = Path::new(&repo.path);
    if !p.exists() {
        return ActivationOutcome {
            repo_id: entry.repo_id,
            repo_name: repo.name.clone(),
            requested_branch: entry.branch.clone(),
            kind: ActivationKind::SkippedMissingRepo,
            message: format!("Repo path no longer exists: {}", repo.path),
        };
    }

    // Already on target?
    if let Ok(current) = status::current_branch(p) {
        if current == entry.branch {
            return ActivationOutcome {
                repo_id: entry.repo_id,
                repo_name: repo.name.clone(),
                requested_branch: entry.branch.clone(),
                kind: ActivationKind::AlreadyOn,
                message: format!("Already on {}.", entry.branch),
            };
        }
    }

    // Dirty? Skip (Phase 2.3 adds stash).
    match status::dirty_breakdown(p) {
        Ok(bd) if bd.staged + bd.unstaged + bd.untracked > 0 => {
            return ActivationOutcome {
                repo_id: entry.repo_id,
                repo_name: repo.name.clone(),
                requested_branch: entry.branch.clone(),
                kind: ActivationKind::SkippedDirty,
                message: format!(
                    "Working tree has uncommitted changes ({} staged, {} unstaged, {} untracked).",
                    bd.staged, bd.unstaged, bd.untracked
                ),
            };
        }
        Err(e) => {
            return ActivationOutcome {
                repo_id: entry.repo_id,
                repo_name: repo.name.clone(),
                requested_branch: entry.branch.clone(),
                kind: ActivationKind::Failed,
                message: format!("Could not read working tree status: {}", e),
            };
        }
        _ => {}
    }

    // Fallback: also accept the plain Dirty enum (covers rare edge cases).
    if let Ok(d) = status::dirty_from_porcelain(p) {
        if d != Dirty::Clean {
            return ActivationOutcome {
                repo_id: entry.repo_id,
                repo_name: repo.name.clone(),
                requested_branch: entry.branch.clone(),
                kind: ActivationKind::SkippedDirty,
                message: "Working tree has uncommitted changes.".to_string(),
            };
        }
    }

    // Locate the branch: local, remote-only (auto-track), or missing.
    let location = match gbranch::locate_branch(p, &entry.branch) {
        Ok(l) => l,
        Err(e) => {
            return ActivationOutcome {
                repo_id: entry.repo_id,
                repo_name: repo.name.clone(),
                requested_branch: entry.branch.clone(),
                kind: ActivationKind::Failed,
                message: format!("Could not list branches: {}", e),
            };
        }
    };

    let started_at = now_iso();
    let t0 = Instant::now();
    let pre_head = status::current_head_sha(p).ok().flatten();

    let (git_out, kind_on_success, log_action_label) = match location {
        gbranch::BranchLocation::Local => (
            gbranch::checkout(p, &entry.branch),
            ActivationKind::Switched,
            "workspace_activate",
        ),
        gbranch::BranchLocation::RemoteOnly(remote_ref) => (
            gbranch::checkout_tracking(p, &entry.branch, &remote_ref),
            ActivationKind::Tracked,
            "workspace_activate",
        ),
        gbranch::BranchLocation::Missing => {
            return ActivationOutcome {
                repo_id: entry.repo_id,
                repo_name: repo.name.clone(),
                requested_branch: entry.branch.clone(),
                kind: ActivationKind::SkippedMissingBranch,
                message: format!(
                    "Branch \"{}\" does not exist locally or on any remote. Fetch or edit the workspace.",
                    entry.branch
                ),
            };
        }
    };

    let out = match git_out {
        Ok(o) => o,
        Err(e) => {
            log_action_in_group(
                entry.repo_id,
                log_action_label,
                pre_head.as_deref(),
                None,
                -1,
                Some(&e.to_string()),
                &started_at,
                t0.elapsed().as_millis() as i64,
                group_id,
            );
            return ActivationOutcome {
                repo_id: entry.repo_id,
                repo_name: repo.name.clone(),
                requested_branch: entry.branch.clone(),
                kind: ActivationKind::Failed,
                message: e.to_string(),
            };
        }
    };

    let message = merge_stdout_stderr(&out);
    if out.code != 0 {
        log_action_in_group(
            entry.repo_id,
            log_action_label,
            pre_head.as_deref(),
            None,
            out.code,
            Some(&message),
            &started_at,
            t0.elapsed().as_millis() as i64,
            group_id,
        );
        return ActivationOutcome {
            repo_id: entry.repo_id,
            repo_name: repo.name.clone(),
            requested_branch: entry.branch.clone(),
            kind: ActivationKind::Failed,
            message,
        };
    }

    let post_head = status::current_head_sha(p).ok().flatten();
    log_action_in_group(
        entry.repo_id,
        log_action_label,
        pre_head.as_deref(),
        post_head.as_deref(),
        0,
        Some(&message),
        &started_at,
        t0.elapsed().as_millis() as i64,
        group_id,
    );

    ActivationOutcome {
        repo_id: entry.repo_id,
        repo_name: repo.name.clone(),
        requested_branch: entry.branch.clone(),
        kind: kind_on_success,
        message,
    }
}

fn merge_stdout_stderr(out: &crate::git::runner::GitOutput) -> String {
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
