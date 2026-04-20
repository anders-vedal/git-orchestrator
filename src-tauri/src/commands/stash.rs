//! Phase 2.3 multi-repo stash bundles: "park everything, labelled,
//! restorable as a group." Commands here pair with `commands::workspaces`
//! — when workspace activation skips a dirty repo, the user can click
//! "Stash dirty and retry" which funnels into `create_stash_bundle`.
//!
//! Design notes:
//! - Always include untracked files (`-u`). The whole point of the
//!   feature is to preserve context during a workspace switch; losing
//!   new files defeats it.
//! - Sequential per-repo, same as workspace activation — avoids two
//!   concurrent `git stash push` on the same repo (shouldn't happen
//!   from our UI, but we run sequentially for predictable logging).
//! - Invariant #15: every leg of create/restore/drop writes an
//!   action_log row with `group_id = "bundle_<id>"` so Phase 2.4 can
//!   add a group-scoped undo for stash_apply.

use crate::db;
use crate::git::{stash as gstash, status};
use crate::models::{
    StashBundleDetail, StashBundleSummary, StashPushKind, StashPushOutcome, StashPushReport,
    StashRestoreKind, StashRestoreOutcome, StashRestoreReport, StashStatus,
};
use std::path::Path;
use std::time::Instant;

use super::git_ops::{log_action_in_group, new_action_group_id};

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn validate_label(label: &str) -> Result<String, String> {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return Err("Stash label cannot be empty.".to_string());
    }
    if trimmed.chars().count() > 120 {
        return Err("Stash label is too long (max 120 characters).".to_string());
    }
    Ok(trimmed.to_string())
}

fn group_id_for(bundle_id: i64) -> String {
    format!("bundle_{bundle_id}")
}

#[tauri::command]
pub async fn list_stash_bundles() -> Result<Vec<StashBundleSummary>, String> {
    tokio::task::spawn_blocking(|| db::with_conn(|c| db::queries::list_stash_bundles(c)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_stash_bundle(id: i64) -> Result<StashBundleDetail, String> {
    tokio::task::spawn_blocking(move || {
        db::with_conn(|c| db::queries::get_stash_bundle(c, id))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Delete a bundle. When `drop_refs` is true, also run `git stash drop`
/// on every still-existing stash ref listed in the bundle so the repos'
/// stash stacks don't accumulate garbage. Missing refs are ignored.
/// Either way the DB rows are removed.
#[tauri::command]
pub async fn delete_stash_bundle(id: i64, drop_refs: bool) -> Result<(), String> {
    if drop_refs {
        // Best-effort: failures don't block the DB delete — the user
        // asked to forget the bundle either way.
        if let Ok(detail) = get_stash_bundle(id).await {
            tokio::task::spawn_blocking(move || {
                for entry in &detail.entries {
                    if !matches!(entry.status, StashStatus::Pending | StashStatus::Restored) {
                        continue;
                    }
                    if let Ok(repo) =
                        db::with_conn(|c| db::queries::find_repo(c, entry.repo_id))
                    {
                        let p = Path::new(&repo.path);
                        if !p.exists() {
                            continue;
                        }
                        // Only drop if the ref still exists (avoid noisy
                        // "No stash found" errors on already-dropped refs).
                        match crate::git::stash::ref_exists(p, &entry.stash_sha) {
                            Ok(true) => {
                                let _ = crate::git::stash::drop(p, &entry.stash_sha);
                            }
                            _ => {}
                        }
                    }
                }
            })
            .await
            .map_err(|e| e.to_string())?;
        }
    }
    tokio::task::spawn_blocking(move || {
        db::with_conn(|c| db::queries::delete_stash_bundle(c, id))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Create a new stash bundle across the given repos. Each repo is
/// stashed sequentially with the supplied label as the stash message.
/// The resulting bundle has one entry per repo that successfully
/// stashed (clean repos are reported as `NothingToStash` but do not
/// consume an entry).
#[tauri::command]
pub async fn create_stash_bundle(
    label: String,
    repo_ids: Vec<i64>,
) -> Result<StashPushReport, String> {
    let label = validate_label(&label)?;
    if repo_ids.is_empty() {
        return Err("Pick at least one repo to stash.".to_string());
    }

    // Pre-generate a group_id so every push leg's action_log row lands
    // under one identifier — lets the Recent Actions view surface the
    // whole bundle as a single event rather than N unrelated rows.
    let push_group_id = new_action_group_id();

    let label_clone = label.clone();
    let push_group_id_for_loop = push_group_id.clone();
    let outcomes: Vec<StashPushOutcome> = tokio::task::spawn_blocking(move || {
        let mut outs = Vec::with_capacity(repo_ids.len());
        for rid in repo_ids {
            outs.push(push_one(rid, &label_clone, &push_group_id_for_loop));
        }
        outs
    })
    .await
    .map_err(|e| e.to_string())?;

    // Persist only the repos that actually produced a stash commit.
    let successful: Vec<&StashPushOutcome> = outcomes
        .iter()
        .filter(|o| matches!(o.kind, StashPushKind::Stashed))
        .collect();

    if successful.is_empty() {
        // Nothing worth persisting — the user gets the outcomes report
        // explaining why. No bundle row created.
        return Ok(StashPushReport {
            bundle_id: None,
            label,
            outcomes,
        });
    }

    let now = now_iso();
    let label_for_insert = label.clone();
    let entry_data: Vec<(i64, String)> = successful
        .iter()
        .map(|o| {
            let sha = o.stash_sha.clone().unwrap_or_default();
            (o.repo_id, sha)
        })
        .collect();
    let bundle_id: i64 = tokio::task::spawn_blocking(move || {
        db::with_conn_mut(|c| {
            let entries: Vec<db::queries::NewStashEntry<'_>> = entry_data
                .iter()
                .map(|(rid, sha)| db::queries::NewStashEntry {
                    repo_id: *rid,
                    stash_sha: sha,
                    branch_at_stash: None,
                    status: StashStatus::Pending,
                })
                .collect();
            db::queries::insert_stash_bundle_with_entries(c, &label_for_insert, &entries, &now)
        })
    })
    .await
    .map_err(|e| e.to_string())??;

    // Best-effort: populate branch_at_stash now that we have the bundle id.
    let _ = db::with_conn(|c| -> Result<(), rusqlite::Error> {
        for o in &outcomes {
            if let StashPushKind::Stashed = o.kind {
                if let Some(br) = branch_guess(o.repo_id) {
                    c.execute(
                        "UPDATE stash_entries SET branch_at_stash = ?1
                         WHERE bundle_id = ?2 AND repo_id = ?3",
                        rusqlite::params![br, bundle_id, o.repo_id],
                    )?;
                }
            }
        }
        Ok(())
    });

    Ok(StashPushReport {
        bundle_id: Some(bundle_id),
        label,
        outcomes,
    })
}

fn branch_guess(repo_id: i64) -> Option<String> {
    // After `git stash push`, HEAD hasn't moved — current_branch still
    // reports the branch that was stashed on. Cheap to re-read here.
    let repo = db::with_conn(|c| db::queries::find_repo(c, repo_id)).ok()?;
    status::current_branch(Path::new(&repo.path)).ok()
}

fn push_one(repo_id: i64, label: &str, group_id: &str) -> StashPushOutcome {
    let repo = match db::with_conn(|c| db::queries::find_repo(c, repo_id)) {
        Ok(r) => r,
        Err(_) => {
            return StashPushOutcome {
                repo_id,
                repo_name: format!("Repo {repo_id}"),
                kind: StashPushKind::SkippedMissingRepo,
                stash_sha: None,
                message: "Repo has been removed from the dashboard.".to_string(),
            };
        }
    };

    let p = Path::new(&repo.path);
    if !p.exists() {
        return StashPushOutcome {
            repo_id,
            repo_name: repo.name.clone(),
            kind: StashPushKind::SkippedMissingRepo,
            stash_sha: None,
            message: format!("Repo path no longer exists: {}", repo.path),
        };
    }

    let started_at = now_iso();
    let t0 = Instant::now();
    let pre_head = status::current_head_sha(p).ok().flatten();

    let res = gstash::push(p, label, true);
    let dur_ms = t0.elapsed().as_millis() as i64;
    match res {
        Ok(Some(result)) => {
            let excerpt = truncate(&result.message, 2000);
            log_action_in_group(
                repo_id,
                "stash_push",
                pre_head.as_deref(),
                pre_head.as_deref(), // stash doesn't move HEAD
                0,
                Some(&excerpt),
                &started_at,
                dur_ms,
                group_id,
            );
            StashPushOutcome {
                repo_id,
                repo_name: repo.name,
                kind: StashPushKind::Stashed,
                stash_sha: Some(result.sha),
                message: result.message,
            }
        }
        Ok(None) => StashPushOutcome {
            repo_id,
            repo_name: repo.name,
            kind: StashPushKind::NothingToStash,
            stash_sha: None,
            message: "Working tree is clean — nothing to stash.".to_string(),
        },
        Err(e) => {
            let msg = e.to_string();
            log_action_in_group(
                repo_id,
                "stash_push",
                pre_head.as_deref(),
                pre_head.as_deref(),
                -1,
                Some(&msg),
                &started_at,
                dur_ms,
                group_id,
            );
            StashPushOutcome {
                repo_id,
                repo_name: repo.name,
                kind: StashPushKind::Failed,
                stash_sha: None,
                message: msg,
            }
        }
    }
}

/// Restore every pending entry in a bundle. Sequential. Per-repo
/// outcomes are recorded so the UI can show which succeeded and which
/// ran into conflicts. Successful entries are marked `restored` in DB
/// but their stash refs are NOT dropped — the user can re-apply or
/// inspect later, and drop explicitly when happy.
#[tauri::command]
pub async fn restore_stash_bundle(id: i64) -> Result<StashRestoreReport, String> {
    let detail = get_stash_bundle(id).await?;
    let group_id = group_id_for(id);
    let label = detail.label.clone();

    let outcomes: Vec<StashRestoreOutcome> = tokio::task::spawn_blocking({
        let group_id = group_id.clone();
        let detail = detail.clone();
        move || {
            detail
                .entries
                .iter()
                .map(|entry| restore_one(id, &group_id, entry))
                .collect()
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(StashRestoreReport {
        bundle_id: id,
        label,
        group_id,
        outcomes,
    })
}

fn restore_one(
    bundle_id: i64,
    group_id: &str,
    entry: &crate::models::StashEntry,
) -> StashRestoreOutcome {
    if !matches!(entry.status, StashStatus::Pending) {
        return StashRestoreOutcome {
            repo_id: entry.repo_id,
            repo_name: entry.repo_name.clone(),
            stash_sha: entry.stash_sha.clone(),
            kind: StashRestoreKind::AlreadyDone,
            message: format!("Entry is already {}.", entry.status.as_str()),
        };
    }

    let repo = match db::with_conn(|c| db::queries::find_repo(c, entry.repo_id)) {
        Ok(r) => r,
        Err(_) => {
            return StashRestoreOutcome {
                repo_id: entry.repo_id,
                repo_name: entry.repo_name.clone(),
                stash_sha: entry.stash_sha.clone(),
                kind: StashRestoreKind::SkippedMissingRepo,
                message: "Repo has been removed from the dashboard.".to_string(),
            };
        }
    };
    let p = Path::new(&repo.path);
    if !p.exists() {
        return StashRestoreOutcome {
            repo_id: entry.repo_id,
            repo_name: repo.name.clone(),
            stash_sha: entry.stash_sha.clone(),
            kind: StashRestoreKind::SkippedMissingRepo,
            message: format!("Repo path no longer exists: {}", repo.path),
        };
    }

    // Is the stash still there?
    match crate::git::stash::ref_exists(p, &entry.stash_sha) {
        Ok(false) => {
            let _ = db::with_conn(|c| {
                db::queries::update_stash_entry_status(
                    c,
                    bundle_id,
                    entry.repo_id,
                    StashStatus::Missing,
                )
            });
            return StashRestoreOutcome {
                repo_id: entry.repo_id,
                repo_name: repo.name.clone(),
                stash_sha: entry.stash_sha.clone(),
                kind: StashRestoreKind::Missing,
                message:
                    "Stash ref no longer exists in the repo. Marked as missing."
                        .to_string(),
            };
        }
        Err(e) => {
            return StashRestoreOutcome {
                repo_id: entry.repo_id,
                repo_name: repo.name.clone(),
                stash_sha: entry.stash_sha.clone(),
                kind: StashRestoreKind::Failed,
                message: format!("Could not check stash ref: {}", e),
            };
        }
        Ok(true) => {}
    }

    let started_at = now_iso();
    let t0 = Instant::now();
    let pre_head = status::current_head_sha(p).ok().flatten();

    let res = crate::git::stash::apply(p, &entry.stash_sha);
    let dur_ms = t0.elapsed().as_millis() as i64;

    match res {
        Ok(out) => {
            let msg = merged_stdout_stderr(&out);
            if out.code == 0 {
                let _ = db::with_conn(|c| {
                    db::queries::update_stash_entry_status(
                        c,
                        bundle_id,
                        entry.repo_id,
                        StashStatus::Restored,
                    )
                });
                log_action_in_group(
                    entry.repo_id,
                    "stash_apply",
                    pre_head.as_deref(),
                    status::current_head_sha(p).ok().flatten().as_deref(),
                    0,
                    Some(&truncate(&msg, 2000)),
                    &started_at,
                    dur_ms,
                    group_id,
                );
                StashRestoreOutcome {
                    repo_id: entry.repo_id,
                    repo_name: repo.name,
                    stash_sha: entry.stash_sha.clone(),
                    kind: StashRestoreKind::Restored,
                    message: msg,
                }
            } else {
                log_action_in_group(
                    entry.repo_id,
                    "stash_apply",
                    pre_head.as_deref(),
                    pre_head.as_deref(),
                    out.code,
                    Some(&truncate(&msg, 2000)),
                    &started_at,
                    dur_ms,
                    group_id,
                );
                StashRestoreOutcome {
                    repo_id: entry.repo_id,
                    repo_name: repo.name,
                    stash_sha: entry.stash_sha.clone(),
                    kind: StashRestoreKind::Failed,
                    message: msg,
                }
            }
        }
        Err(e) => {
            let msg = e.to_string();
            log_action_in_group(
                entry.repo_id,
                "stash_apply",
                pre_head.as_deref(),
                pre_head.as_deref(),
                -1,
                Some(&msg),
                &started_at,
                dur_ms,
                group_id,
            );
            StashRestoreOutcome {
                repo_id: entry.repo_id,
                repo_name: repo.name,
                stash_sha: entry.stash_sha.clone(),
                kind: StashRestoreKind::Failed,
                message: msg,
            }
        }
    }
}

fn merged_stdout_stderr(out: &crate::git::runner::GitOutput) -> String {
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

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}
