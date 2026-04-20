use crate::models::{
    ActionLogEntry, IgnoredPath, Repo, StashBundleDetail, StashBundleSummary, StashEntry,
    StashStatus, WorkspaceDetail, WorkspaceRepoEntry, WorkspaceSummary,
};
use crate::util::normalize_path;
use rusqlite::{params, Connection};
use std::path::Path;

pub fn list_repos(conn: &Connection) -> Result<Vec<Repo>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, name, path, priority, added_at, push_mode
         FROM repos ORDER BY priority ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Repo {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            priority: row.get(3)?,
            added_at: row.get(4)?,
            push_mode: row.get(5)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Bulk ops pass `None` for "every repo" or `Some(ids)` for "only these".
/// For the dashboard's scale (typically <100 repos) doing a full
/// `list_repos` + in-memory filter is fine and avoids dynamic IN-clause
/// SQL. Preserves the `list_repos` sort order.
pub fn list_repos_filtered(
    conn: &Connection,
    ids: Option<&[i64]>,
) -> Result<Vec<Repo>, rusqlite::Error> {
    let all = list_repos(conn)?;
    match ids {
        None => Ok(all),
        Some(ids) => {
            let set: std::collections::HashSet<i64> = ids.iter().copied().collect();
            Ok(all.into_iter().filter(|r| set.contains(&r.id)).collect())
        }
    }
}

pub fn find_repo(conn: &Connection, id: i64) -> Result<Repo, rusqlite::Error> {
    conn.query_row(
        "SELECT id, name, path, priority, added_at, push_mode
         FROM repos WHERE id = ?1",
        params![id],
        |row| {
            Ok(Repo {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                priority: row.get(3)?,
                added_at: row.get(4)?,
                push_mode: row.get(5)?,
            })
        },
    )
}

pub fn next_priority(conn: &Connection) -> Result<i64, rusqlite::Error> {
    let max: Option<i64> =
        conn.query_row("SELECT MAX(priority) FROM repos", [], |r| r.get(0))?;
    Ok(max.unwrap_or(-1) + 1)
}

pub fn insert_repo(
    conn: &Connection,
    name: &str,
    path: &str,
    priority: i64,
    added_at: &str,
) -> Result<i64, rusqlite::Error> {
    conn.execute(
        "INSERT INTO repos (name, path, priority, added_at) VALUES (?1, ?2, ?3, ?4)",
        params![name, path, priority, added_at],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_repo(conn: &Connection, id: i64) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM repos WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn rename_repo(conn: &Connection, id: i64, new_name: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE repos SET name = ?1 WHERE id = ?2",
        params![new_name, id],
    )?;
    Ok(())
}

/// Set or clear the per-repo `push_mode` override. Pass `None` to clear
/// (falls back to the global setting). Caller is responsible for validating
/// that `mode` is one of the known values ("direct", "pr") before calling.
pub fn set_repo_push_mode(
    conn: &Connection,
    id: i64,
    mode: Option<&str>,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE repos SET push_mode = ?1 WHERE id = ?2",
        params![mode, id],
    )?;
    Ok(())
}

pub fn reorder(conn: &mut Connection, ordered_ids: &[i64]) -> Result<(), rusqlite::Error> {
    let tx = conn.transaction()?;
    for (idx, id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE repos SET priority = ?1 WHERE id = ?2",
            params![idx as i64, id],
        )?;
    }
    tx.commit()
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, rusqlite::Error> {
    let v: Result<String, rusqlite::Error> = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |r| r.get(0),
    );
    match v {
        Ok(val) => Ok(Some(val)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Dedup lookup: returns the existing repo whose path matches `target`
/// under Windows-normalized comparison (case + slash insensitive).
/// Existing rows may pre-date normalization, so we normalize on both sides.
pub fn find_repo_by_normalized_path(
    conn: &Connection,
    target: &str,
) -> Result<Option<Repo>, rusqlite::Error> {
    let target_norm = normalize_path(target);
    let all = list_repos(conn)?;
    Ok(all
        .into_iter()
        .find(|r| normalize_path(&r.path) == target_norm))
}

pub fn list_ignored(conn: &Connection) -> Result<Vec<IgnoredPath>, rusqlite::Error> {
    let mut stmt =
        conn.prepare("SELECT path, added_at FROM ignored_paths ORDER BY added_at DESC")?;
    let rows = stmt.query_map([], |row| {
        Ok(IgnoredPath {
            path: row.get(0)?,
            added_at: row.get(1)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn is_path_ignored(conn: &Connection, path: &str) -> Result<bool, rusqlite::Error> {
    let normalized = normalize_path(path);
    let exists: Option<String> = conn
        .query_row(
            "SELECT path FROM ignored_paths WHERE path = ?1",
            params![normalized],
            |r| r.get(0),
        )
        .ok();
    Ok(exists.is_some())
}

pub fn add_ignored_path(
    conn: &Connection,
    path: &str,
    added_at: &str,
) -> Result<(), rusqlite::Error> {
    let normalized = normalize_path(path);
    conn.execute(
        "INSERT INTO ignored_paths (path, added_at) VALUES (?1, ?2)
         ON CONFLICT(path) DO NOTHING",
        params![normalized, added_at],
    )?;
    Ok(())
}

pub fn remove_ignored_path(conn: &Connection, path: &str) -> Result<(), rusqlite::Error> {
    let normalized = normalize_path(path);
    conn.execute(
        "DELETE FROM ignored_paths WHERE path = ?1",
        params![normalized],
    )?;
    Ok(())
}

pub struct NewActionLog<'a> {
    pub repo_id: i64,
    pub action: &'a str,
    pub pre_head_sha: Option<&'a str>,
    pub post_head_sha: Option<&'a str>,
    pub exit_code: i32,
    pub stderr_excerpt: Option<&'a str>,
    pub started_at: &'a str,
    pub duration_ms: i64,
    /// Shared identifier for the N rows that make up a multi-repo
    /// logical action (e.g. "switch 5 repos to feat/auth"). `None` for
    /// single-repo actions.
    pub group_id: Option<&'a str>,
}

pub fn insert_action_log(
    conn: &Connection,
    entry: &NewActionLog<'_>,
) -> Result<i64, rusqlite::Error> {
    conn.execute(
        "INSERT INTO action_log
            (repo_id, action, pre_head_sha, post_head_sha, exit_code,
             stderr_excerpt, started_at, duration_ms, group_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            entry.repo_id,
            entry.action,
            entry.pre_head_sha,
            entry.post_head_sha,
            entry.exit_code,
            entry.stderr_excerpt,
            entry.started_at,
            entry.duration_ms,
            entry.group_id,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn recent_actions_for_repo(
    conn: &Connection,
    repo_id: i64,
    limit: i64,
) -> Result<Vec<ActionLogEntry>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, repo_id, action, pre_head_sha, post_head_sha, exit_code,
                stderr_excerpt, started_at, duration_ms, group_id
         FROM action_log
         WHERE repo_id = ?1
         ORDER BY id DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![repo_id, limit], |row| {
        Ok(ActionLogEntry {
            id: row.get(0)?,
            repo_id: row.get(1)?,
            action: row.get(2)?,
            pre_head_sha: row.get(3)?,
            post_head_sha: row.get(4)?,
            exit_code: row.get(5)?,
            stderr_excerpt: row.get(6)?,
            started_at: row.get(7)?,
            duration_ms: row.get(8)?,
            group_id: row.get(9)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// List the N most recent multi-repo action groups for the Recent
/// Actions history view. Only rows with a non-NULL group_id are
/// considered — single-repo actions (force_pull, commit_push)
/// surface elsewhere. Relies on `idx_action_log_group`.
pub fn list_recent_action_groups(
    conn: &Connection,
    limit: i64,
) -> Result<Vec<crate::models::RecentActionGroup>, rusqlite::Error> {
    // Cap how many repo names we embed per group — the dialog shows
    // "foo, bar, baz, + N more". Larger groups stay compact.
    const NAMES_CAP: i64 = 4;

    struct SummaryRow {
        group_id: String,
        repo_count: u32,
        success_count: u32,
        head_move_count: u32,
        occurred_at: String,
        action: String,
    }

    let mut stmt = conn.prepare(
        "SELECT
            al.group_id,
            COUNT(DISTINCT al.repo_id)                               AS repo_count,
            SUM(CASE WHEN al.exit_code = 0 THEN 1 ELSE 0 END)        AS success_count,
            SUM(CASE WHEN al.pre_head_sha IS NOT NULL
                      AND al.post_head_sha IS NOT NULL
                      AND al.pre_head_sha != al.post_head_sha
                     THEN 1 ELSE 0 END)                              AS head_move_count,
            MAX(al.started_at)                                       AS occurred_at,
            MAX(al.id)                                               AS max_id,
            MAX(al.action)                                           AS action_label
         FROM action_log al
         WHERE al.group_id IS NOT NULL
         GROUP BY al.group_id
         ORDER BY max_id DESC
         LIMIT ?1",
    )?;

    let summary_rows: Vec<SummaryRow> = stmt
        .query_map(params![limit], |r| {
            Ok(SummaryRow {
                group_id: r.get(0)?,
                repo_count: r.get::<_, i64>(1)? as u32,
                success_count: r.get::<_, i64>(2)? as u32,
                head_move_count: r.get::<_, i64>(3)? as u32,
                occurred_at: r.get(4)?,
                // column 5 is max_id — used for ORDER BY only, not returned
                action: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut names_stmt = conn.prepare(
        "SELECT COALESCE(r.name, '(removed repo)') AS name
         FROM action_log al
         LEFT JOIN repos r ON r.id = al.repo_id
         WHERE al.group_id = ?1
         GROUP BY al.repo_id, r.name
         ORDER BY MIN(al.id)
         LIMIT ?2",
    )?;

    let mut out = Vec::with_capacity(summary_rows.len());
    for s in summary_rows {
        let names: Vec<String> = names_stmt
            .query_map(params![s.group_id, NAMES_CAP], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let truncated = (s.repo_count as usize) > names.len();
        out.push(crate::models::RecentActionGroup {
            group_id: s.group_id,
            action: s.action,
            repo_count: s.repo_count,
            success_count: s.success_count,
            head_move_count: s.head_move_count,
            occurred_at: s.occurred_at,
            repo_names: names,
            repo_names_truncated: truncated,
        });
    }

    Ok(out)
}

/// Fetch every action_log row with the given group_id, in insertion
/// order. Empty Vec if the group doesn't exist. Used by Phase 2 workspace
/// ops to present a multi-repo action's per-repo outcomes together, and
/// (eventually) to unwind a failed bulk operation.
pub fn actions_in_group(
    conn: &Connection,
    group_id: &str,
) -> Result<Vec<ActionLogEntry>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, repo_id, action, pre_head_sha, post_head_sha, exit_code,
                stderr_excerpt, started_at, duration_ms, group_id
         FROM action_log
         WHERE group_id = ?1
         ORDER BY id ASC",
    )?;
    let rows = stmt.query_map(params![group_id], |row| {
        Ok(ActionLogEntry {
            id: row.get(0)?,
            repo_id: row.get(1)?,
            action: row.get(2)?,
            pre_head_sha: row.get(3)?,
            post_head_sha: row.get(4)?,
            exit_code: row.get(5)?,
            stderr_excerpt: row.get(6)?,
            started_at: row.get(7)?,
            duration_ms: row.get(8)?,
            group_id: row.get(9)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

// ---------- Phase 2.2: workspaces ---------------------------------------

pub fn list_workspaces(conn: &Connection) -> Result<Vec<WorkspaceSummary>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT w.id, w.name,
                (SELECT COUNT(*) FROM workspace_repos wr WHERE wr.workspace_id = w.id)
                    AS repo_count,
                w.updated_at
         FROM workspaces w
         ORDER BY w.name COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        let repo_count: i64 = row.get(2)?;
        Ok(WorkspaceSummary {
            id: row.get(0)?,
            name: row.get(1)?,
            repo_count: repo_count as u32,
            updated_at: row.get(3)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn get_workspace_with_entries(
    conn: &Connection,
    id: i64,
) -> Result<WorkspaceDetail, rusqlite::Error> {
    let (name, created_at, updated_at): (String, String, String) = conn.query_row(
        "SELECT name, created_at, updated_at FROM workspaces WHERE id = ?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;

    let mut stmt = conn.prepare(
        "SELECT wr.repo_id, r.name, r.path, wr.branch, wr.position
         FROM workspace_repos wr
         JOIN repos r ON r.id = wr.repo_id
         WHERE wr.workspace_id = ?1
         ORDER BY wr.position ASC",
    )?;
    let rows = stmt.query_map(params![id], |row| {
        let path: String = row.get(2)?;
        let exists = Path::new(&path).exists();
        let position: i64 = row.get(4)?;
        Ok(WorkspaceRepoEntry {
            repo_id: row.get(0)?,
            repo_name: row.get(1)?,
            repo_path_exists: exists,
            branch: row.get(3)?,
            position: position as u32,
        })
    })?;
    let mut entries = Vec::new();
    for r in rows {
        entries.push(r?);
    }

    Ok(WorkspaceDetail {
        id,
        name,
        created_at,
        updated_at,
        entries,
    })
}

pub fn insert_workspace_with_entries(
    conn: &mut Connection,
    name: &str,
    entries: &[(i64, String)],
    now: &str,
) -> Result<i64, rusqlite::Error> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO workspaces (name, created_at, updated_at) VALUES (?1, ?2, ?2)",
        params![name, now],
    )?;
    let ws_id = tx.last_insert_rowid();
    for (idx, (repo_id, branch)) in entries.iter().enumerate() {
        tx.execute(
            "INSERT INTO workspace_repos (workspace_id, repo_id, branch, position)
             VALUES (?1, ?2, ?3, ?4)",
            params![ws_id, repo_id, branch, idx as i64],
        )?;
    }
    tx.commit()?;
    Ok(ws_id)
}

pub fn replace_workspace_entries(
    conn: &mut Connection,
    id: i64,
    entries: &[(i64, String)],
    now: &str,
) -> Result<(), rusqlite::Error> {
    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM workspace_repos WHERE workspace_id = ?1",
        params![id],
    )?;
    for (idx, (repo_id, branch)) in entries.iter().enumerate() {
        tx.execute(
            "INSERT INTO workspace_repos (workspace_id, repo_id, branch, position)
             VALUES (?1, ?2, ?3, ?4)",
            params![id, repo_id, branch, idx as i64],
        )?;
    }
    tx.execute(
        "UPDATE workspaces SET updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    tx.commit()
}

pub fn rename_workspace(
    conn: &Connection,
    id: i64,
    new_name: &str,
    now: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE workspaces SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_name, now, id],
    )?;
    Ok(())
}

pub fn delete_workspace(conn: &Connection, id: i64) -> Result<(), rusqlite::Error> {
    // workspace_repos rows cascade via FK.
    conn.execute("DELETE FROM workspaces WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn workspace_exists(conn: &Connection, id: i64) -> Result<bool, rusqlite::Error> {
    let exists: Option<i64> = conn
        .query_row(
            "SELECT id FROM workspaces WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .ok();
    Ok(exists.is_some())
}

// ---------- Phase 2.3: stash bundles ------------------------------------

pub fn list_stash_bundles(conn: &Connection) -> Result<Vec<StashBundleSummary>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT b.id, b.label, b.created_at,
                (SELECT COUNT(*) FROM stash_entries se WHERE se.bundle_id = b.id) AS entry_count,
                (SELECT COUNT(*) FROM stash_entries se WHERE se.bundle_id = b.id AND se.status = 'pending')
                    AS pending_count
         FROM stash_bundles b
         ORDER BY b.created_at DESC, b.id DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        let entry_count: i64 = row.get(3)?;
        let pending_count: i64 = row.get(4)?;
        Ok(StashBundleSummary {
            id: row.get(0)?,
            label: row.get(1)?,
            created_at: row.get(2)?,
            entry_count: entry_count as u32,
            pending_count: pending_count as u32,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn get_stash_bundle(
    conn: &Connection,
    id: i64,
) -> Result<StashBundleDetail, rusqlite::Error> {
    let (label, created_at): (String, String) = conn.query_row(
        "SELECT label, created_at FROM stash_bundles WHERE id = ?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    let mut stmt = conn.prepare(
        "SELECT se.repo_id, r.name, r.path, se.stash_sha, se.branch_at_stash, se.status,
                se.created_at
         FROM stash_entries se
         JOIN repos r ON r.id = se.repo_id
         WHERE se.bundle_id = ?1
         ORDER BY r.name COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map(params![id], |row| {
        let path: String = row.get(2)?;
        let sha: String = row.get(3)?;
        let short: String = sha.chars().take(7).collect();
        let status_str: String = row.get(5)?;
        Ok(StashEntry {
            repo_id: row.get(0)?,
            repo_name: row.get(1)?,
            repo_path_exists: Path::new(&path).exists(),
            stash_sha: sha,
            stash_short: short,
            branch_at_stash: row.get(4)?,
            status: StashStatus::from_str(&status_str),
            created_at: row.get(6)?,
        })
    })?;
    let mut entries = Vec::new();
    for r in rows {
        entries.push(r?);
    }

    Ok(StashBundleDetail {
        id,
        label,
        created_at,
        entries,
    })
}

pub struct NewStashEntry<'a> {
    pub repo_id: i64,
    pub stash_sha: &'a str,
    pub branch_at_stash: Option<&'a str>,
    pub status: StashStatus,
}

pub fn insert_stash_bundle_with_entries(
    conn: &mut Connection,
    label: &str,
    entries: &[NewStashEntry<'_>],
    now: &str,
) -> Result<i64, rusqlite::Error> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO stash_bundles (label, created_at) VALUES (?1, ?2)",
        params![label, now],
    )?;
    let bundle_id = tx.last_insert_rowid();
    for e in entries {
        tx.execute(
            "INSERT INTO stash_entries
                (bundle_id, repo_id, stash_sha, branch_at_stash, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                bundle_id,
                e.repo_id,
                e.stash_sha,
                e.branch_at_stash,
                e.status.as_str(),
                now,
            ],
        )?;
    }
    tx.commit()?;
    Ok(bundle_id)
}

pub fn update_stash_entry_status(
    conn: &Connection,
    bundle_id: i64,
    repo_id: i64,
    status: StashStatus,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE stash_entries SET status = ?1
         WHERE bundle_id = ?2 AND repo_id = ?3",
        params![status.as_str(), bundle_id, repo_id],
    )?;
    Ok(())
}

pub fn delete_stash_bundle(conn: &Connection, id: i64) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM stash_bundles WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn stash_bundle_exists(conn: &Connection, id: i64) -> Result<bool, rusqlite::Error> {
    let exists: Option<i64> = conn
        .query_row(
            "SELECT id FROM stash_bundles WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .ok();
    Ok(exists.is_some())
}

/// The most recent action for a repo that is eligible for one-click undo
/// (currently: force_pull). Returns `None` if no such row exists.
pub fn last_undoable_action(
    conn: &Connection,
    repo_id: i64,
) -> Result<Option<ActionLogEntry>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, repo_id, action, pre_head_sha, post_head_sha, exit_code,
                stderr_excerpt, started_at, duration_ms, group_id
         FROM action_log
         WHERE repo_id = ?1
           AND action IN ('force_pull')
           AND pre_head_sha IS NOT NULL
           AND exit_code = 0
         ORDER BY id DESC
         LIMIT 1",
    )?;
    let mut rows = stmt.query_map(params![repo_id], |row| {
        Ok(ActionLogEntry {
            id: row.get(0)?,
            repo_id: row.get(1)?,
            action: row.get(2)?,
            pre_head_sha: row.get(3)?,
            post_head_sha: row.get(4)?,
            exit_code: row.get(5)?,
            stderr_excerpt: row.get(6)?,
            started_at: row.get(7)?,
            duration_ms: row.get(8)?,
            group_id: row.get(9)?,
        })
    })?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}
