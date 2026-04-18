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
