use crate::db;
use crate::git::runner::is_git_repo;
use crate::models::{PushModeInfo, Repo};
use crate::util::normalize_path;
use std::path::{Path, PathBuf};

/// Resolve the effective push mode for a repo: per-repo override, else
/// global setting, else "direct". Used by both `get_push_mode_info` and
/// `git_commit_push` so they never disagree.
pub(crate) fn resolve_effective_push_mode(
    repo_override: Option<&str>,
    global: Option<&str>,
) -> String {
    for candidate in [repo_override, global] {
        if let Some(v) = candidate {
            if v == "direct" || v == "pr" {
                return v.to_string();
            }
        }
    }
    "direct".to_string()
}

pub(crate) fn canonical(path: &str) -> Result<PathBuf, String> {
    // On Windows, reject UNC/network paths before anything touches the
    // filesystem — `git -C \\server\share` operates on attacker-controlled
    // content and combines with other vectors (hostile .git/config) to fire
    // RCE on the refresh timer. If a user needs a network-hosted repo, they
    // should mount it to a drive letter first.
    //
    // On mac/linux the concept doesn't apply — paths beginning with `/` are
    // the normal case, and network mounts surface as local paths under
    // /Volumes or /mnt that are indistinguishable from local disks here.
    #[cfg(windows)]
    {
        let lowered = path.trim_start().to_ascii_lowercase();
        if lowered.starts_with(r"\\") || lowered.starts_with("//") {
            return Err(format!(
                "refused: UNC/network paths are not allowed ({path}). Map the share to a drive letter first."
            ));
        }
        if lowered.starts_with(r"\\?\unc\") {
            return Err(format!("refused: UNC paths are not allowed ({path})."));
        }
    }

    let p = PathBuf::from(path);
    if !p.exists() {
        return Err(format!("path does not exist: {}", p.display()));
    }
    Ok(p)
}

pub(crate) fn default_display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| path.display().to_string())
}

#[tauri::command]
pub async fn list_repos() -> Result<Vec<Repo>, String> {
    db::with_conn(|c| crate::db::queries::list_repos(c))
}

#[tauri::command]
pub async fn add_repo(path: String, name: Option<String>) -> Result<Repo, String> {
    let p = canonical(&path)?;
    if !is_git_repo(&p) {
        return Err(format!("{} is not a git repository", p.display()));
    }
    let name = name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| default_display_name(&p));
    let raw_path = p
        .to_str()
        .ok_or_else(|| "path contains non-utf8 characters".to_string())?
        .to_string();
    let path_str = normalize_path(&raw_path);
    let added_at = chrono::Utc::now().to_rfc3339();

    db::with_conn_mut(|c| {
        // Explicit dedup so we return a human message rather than a raw
        // UNIQUE-constraint error. Also catches case/slash variants that
        // the SQLite unique index (case-sensitive) would miss on existing
        // pre-normalization rows.
        if let Some(existing) = crate::db::queries::find_repo_by_normalized_path(c, &path_str)? {
            return Err(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
                Some(format!(
                    "already in dashboard as \"{}\" ({})",
                    existing.name, existing.path
                )),
            ));
        }
        let priority = crate::db::queries::next_priority(c)?;
        let id = crate::db::queries::insert_repo(c, &name, &path_str, priority, &added_at)?;
        crate::db::queries::find_repo(c, id)
    })
}

#[tauri::command]
pub async fn remove_repo(id: i64) -> Result<(), String> {
    db::with_conn(|c| crate::db::queries::delete_repo(c, id))
}

#[tauri::command]
pub async fn rename_repo(id: i64, new_name: String) -> Result<(), String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("name cannot be empty".into());
    }
    db::with_conn(|c| crate::db::queries::rename_repo(c, id, trimmed))
}

#[tauri::command]
pub async fn reorder_repos(ordered_ids: Vec<i64>) -> Result<(), String> {
    db::with_conn_mut(|c| crate::db::queries::reorder(c, &ordered_ids))
}

/// Set or clear the per-repo push_mode override. Accepts "direct", "pr",
/// or null. Anything else is rejected so a compromised renderer can't
/// stuff arbitrary strings into the column (invariant #12 style).
#[tauri::command]
pub async fn set_repo_push_mode(id: i64, mode: Option<String>) -> Result<(), String> {
    let validated = match mode.as_deref() {
        None => None,
        Some("direct") => Some("direct"),
        Some("pr") => Some("pr"),
        Some(other) => {
            return Err(format!(
                "refused: push_mode must be 'direct', 'pr', or null (got {other:?})"
            ));
        }
    };
    db::with_conn(|c| crate::db::queries::set_repo_push_mode(c, id, validated))
}

/// Return both the per-repo override and the effective resolved value
/// (override → global setting → "direct"). The kebab menu uses `override`
/// to show the current radio selection; the commit dialog uses
/// `effective` to decide whether to render the branch-name field.
#[tauri::command]
pub async fn get_push_mode_info(id: i64) -> Result<PushModeInfo, String> {
    db::with_conn(|c| {
        let repo = crate::db::queries::find_repo(c, id)?;
        let global = crate::db::queries::get_setting(c, "push_mode")?;
        let effective =
            resolve_effective_push_mode(repo.push_mode.as_deref(), global.as_deref());
        Ok(PushModeInfo {
            override_: repo.push_mode,
            effective,
        })
    })
}
