use crate::models::{ActionLogEntry, IgnoredPath, Repo};
use crate::util::normalize_path;
use rusqlite::{params, Connection};

pub fn list_repos(conn: &Connection) -> Result<Vec<Repo>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, name, path, priority, added_at FROM repos ORDER BY priority ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Repo {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            priority: row.get(3)?,
            added_at: row.get(4)?,
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
        "SELECT id, name, path, priority, added_at FROM repos WHERE id = ?1",
        params![id],
        |row| {
            Ok(Repo {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                priority: row.get(3)?,
                added_at: row.get(4)?,
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
