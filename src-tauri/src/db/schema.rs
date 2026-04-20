use rusqlite::Connection;

const MIGRATIONS: &[(&str, &str)] = &[
    (
        "001_init",
        r#"
    CREATE TABLE IF NOT EXISTS repos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        priority INTEGER NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_repos_priority ON repos(priority);
    "#,
    ),
    (
        "002_ignored_paths",
        r#"
    CREATE TABLE IF NOT EXISTS ignored_paths (
        path TEXT PRIMARY KEY,
        added_at TEXT NOT NULL
    );
    "#,
    ),
    (
        "003_action_log",
        r#"
    CREATE TABLE IF NOT EXISTS action_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        pre_head_sha TEXT,
        post_head_sha TEXT,
        exit_code INTEGER NOT NULL,
        stderr_excerpt TEXT,
        started_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_action_log_repo
        ON action_log(repo_id, started_at DESC);
    "#,
    ),
    (
        // Groundwork for Phase 2 workspace / snapshot ops: a single logical
        // multi-repo action (e.g. "switch 5 repos to feat/auth") writes N
        // action_log rows tied together by group_id. Single-repo actions
        // keep group_id = NULL. The index lets a future undo query fetch
        // every row of a group in one shot.
        "004_action_log_groups",
        r#"
    ALTER TABLE action_log ADD COLUMN group_id TEXT;

    CREATE INDEX IF NOT EXISTS idx_action_log_group
        ON action_log(group_id);
    "#,
    ),
    (
        // Phase 2.2 workspaces: named bundles of (repo_id, branch) pairs the
        // user can activate to switch several repos to their listed branches
        // in one click. workspace_repos cascades on repos deletion so removing
        // a repo silently removes it from every workspace that referenced it.
        // Active workspace selection lives in the existing settings kv table
        // under key `active_workspace_id`, not a dedicated column.
        "005_workspaces",
        r#"
    CREATE TABLE IF NOT EXISTS workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_repos (
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        repo_id      INTEGER NOT NULL REFERENCES repos(id)      ON DELETE CASCADE,
        branch       TEXT    NOT NULL,
        position     INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, repo_id)
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_repos_ws
        ON workspace_repos(workspace_id, position);
    "#,
    ),
    (
        // Phase 2.3 multi-repo stash: a "bundle" is N (repo, stash_sha)
        // pairs created by one click so they can be restored together.
        // `status` tracks whether an entry is still applicable:
        //   pending  — the stash ref still exists in the repo
        //   restored — user applied it (we keep the row for history)
        //   dropped  — user dropped it via the dashboard
        //   missing  — the stash ref is gone (user ran `git stash drop`
        //              manually; discovered lazily on restore)
        //   failed   — create_stash_bundle couldn't stash this repo (rare;
        //              left in the bundle so the user sees the error)
        // FK cascades mean: removing a repo quietly removes it from every
        // bundle it was in; deleting a bundle removes all its entries.
        "006_stash_bundles",
        r#"
    CREATE TABLE IF NOT EXISTS stash_bundles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stash_entries (
        bundle_id        INTEGER NOT NULL REFERENCES stash_bundles(id) ON DELETE CASCADE,
        repo_id          INTEGER NOT NULL REFERENCES repos(id)         ON DELETE CASCADE,
        stash_sha        TEXT    NOT NULL,
        branch_at_stash  TEXT,
        status           TEXT    NOT NULL DEFAULT 'pending',
        created_at       TEXT    NOT NULL,
        PRIMARY KEY (bundle_id, repo_id)
    );

    CREATE INDEX IF NOT EXISTS idx_stash_entries_bundle
        ON stash_entries(bundle_id);
    "#,
    ),
];

pub fn apply(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        );",
    )?;

    for (name, sql) in MIGRATIONS {
        let already: Option<String> = conn
            .query_row(
                "SELECT name FROM schema_migrations WHERE name = ?1",
                [name],
                |r| r.get(0),
            )
            .ok();
        if already.is_some() {
            continue;
        }
        conn.execute_batch(sql)?;
        conn.execute(
            "INSERT INTO schema_migrations (name, applied_at) VALUES (?1, datetime('now'))",
            [name],
        )?;
    }
    Ok(())
}
