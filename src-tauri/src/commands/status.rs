use crate::db;
use crate::git::{log, remote, status};
use crate::models::{ChangedFiles, Commit, Dirty, Repo, RepoStatus};
use std::path::Path;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter};

/// Event emitted for each repo as its status is recomputed by
/// `refresh_all_statuses`. Payload is the full `RepoStatus`.
pub const EVENT_REPO_STATUS_UPDATED: &str = "repo-status-updated";

fn read_last_fetch(repo_path: &Path) -> Option<String> {
    let mut p = repo_path.to_path_buf();
    p.push(".git");
    p.push("FETCH_HEAD");
    let meta = std::fs::metadata(&p).ok()?;
    let mtime = meta.modified().ok()?;
    let since = mtime.duration_since(UNIX_EPOCH).ok()?;
    let ts = chrono::DateTime::<chrono::Utc>::from_timestamp(since.as_secs() as i64, 0)?;
    Some(ts.to_rfc3339())
}

pub fn build_status(repo: &Repo) -> RepoStatus {
    let path = Path::new(&repo.path);

    let mut s = RepoStatus {
        id: repo.id,
        name: repo.name.clone(),
        path: repo.path.clone(),
        branch: String::new(),
        default_branch: String::new(),
        ahead: 0,
        behind: 0,
        dirty: Dirty::Clean,
        has_upstream: false,
        last_fetch: None,
        latest_commit: None,
        remote_url: None,
        has_submodules: false,
        diverged: false,
        unpushed_no_upstream: None,
        commit_count: None,
        last_refreshed_at: Some(chrono::Utc::now().to_rfc3339()),
        error: None,
    };

    if !path.exists() {
        s.error = Some(format!("path missing: {}", repo.path));
        return s;
    }

    match status::current_branch(path) {
        Ok(b) => s.branch = b,
        Err(e) => {
            s.error = Some(e.to_string());
            return s;
        }
    }

    s.default_branch = status::default_branch(path).unwrap_or_else(|_| s.branch.clone());

    match status::ahead_behind(path) {
        Ok((a, b, up)) => {
            s.ahead = a;
            s.behind = b;
            s.has_upstream = up;
        }
        Err(e) => s.error = Some(e.to_string()),
    }
    s.diverged = s.has_upstream && s.ahead > 0 && s.behind > 0;

    // When no upstream is set, still surface commits not on origin/<default>
    // — "unpushed" is the single highest-signal pill for a multi-repo dashboard.
    if !s.has_upstream && !s.default_branch.is_empty() {
        let remote_ref = format!("origin/{}", s.default_branch);
        if let Ok(Some(head)) = status::current_head_sha(path) {
            if let Ok(count) = status::rev_count_between(path, &head, &remote_ref) {
                if count > 0 {
                    s.unpushed_no_upstream = Some(count);
                }
            }
        }
    }

    match status::dirty_from_porcelain(path) {
        Ok(d) => s.dirty = d,
        Err(e) => s.error = Some(e.to_string()),
    }

    s.has_submodules = status::has_submodules(path);
    s.latest_commit = log::latest_commit(path);
    s.last_fetch = read_last_fetch(path);
    s.commit_count = status::commit_count(path).ok().flatten();

    if let Ok(Some(url)) = remote::origin_url(path) {
        s.remote_url = remote::to_web_url(&url);
    }

    s
}

#[tauri::command]
pub async fn get_repo_status(id: i64) -> Result<RepoStatus, String> {
    let repo = db::with_conn(|c| crate::db::queries::find_repo(c, id))?;
    Ok(build_status(&repo))
}

#[tauri::command]
pub async fn get_all_statuses() -> Result<Vec<RepoStatus>, String> {
    let repos = db::with_conn(|c| crate::db::queries::list_repos(c))?;
    // Parallelise: fan out one blocking task per repo.
    let handles: Vec<_> = repos
        .into_iter()
        .map(|r| tokio::task::spawn_blocking(move || build_status(&r)))
        .collect();
    let mut out = Vec::with_capacity(handles.len());
    for h in handles {
        if let Ok(s) = h.await {
            out.push(s);
        }
    }
    Ok(out)
}

/// Streaming refresh: spawns a blocking task per repo, emits
/// [`EVENT_REPO_STATUS_UPDATED`] with the fresh `RepoStatus` as each one
/// finishes, and returns the spawned-task count immediately so the UI can
/// flip a "refreshing" indicator without waiting for the slowest repo.
///
/// Unlike `get_all_statuses`, this command does NOT block on the join set —
/// fire-and-forget is the whole point. The frontend listens for the event
/// and patches each row as it arrives.
#[tauri::command]
pub async fn refresh_all_statuses(app: AppHandle) -> Result<usize, String> {
    let repos = db::with_conn(|c| crate::db::queries::list_repos(c))?;
    let count = repos.len();

    for repo in repos {
        let app_clone = app.clone();
        tokio::task::spawn_blocking(move || {
            let status = build_status(&repo);
            // Emit errors are non-fatal — if the window closed mid-refresh,
            // we drop the update silently.
            let _ = app_clone.emit(EVENT_REPO_STATUS_UPDATED, &status);
        });
    }

    Ok(count)
}

#[tauri::command]
pub async fn get_repo_log(id: i64, count: u32) -> Result<Vec<Commit>, String> {
    let repo = db::with_conn(|c| crate::db::queries::find_repo(c, id))?;
    log::log(Path::new(&repo.path), count).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_changed_files(id: i64, limit: Option<u32>) -> Result<ChangedFiles, String> {
    let repo = db::with_conn(|c| crate::db::queries::find_repo(c, id))?;
    let lim = limit.unwrap_or(100);
    status::changed_files(Path::new(&repo.path), lim).map_err(|e| e.to_string())
}
