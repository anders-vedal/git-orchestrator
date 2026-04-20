pub mod queries;
pub mod schema;

use once_cell::sync::OnceCell;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

pub fn data_dir() -> PathBuf {
    let mut dir = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    dir.push("RepoDashboard");
    dir
}

fn db_path() -> PathBuf {
    let mut p = data_dir();
    p.push("repo-dashboard.sqlite");
    p
}

pub fn init() -> Result<(), String> {
    let dir = data_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create data dir {}: {}", dir.display(), e))?;

    let path = db_path();
    let conn = Connection::open(&path)
        .map_err(|e| format!("failed to open sqlite at {}: {}", path.display(), e))?;

    // SQLite disables foreign keys unless a per-connection pragma turns them
    // on. Phase 2.2 workspace_repos → repos uses ON DELETE CASCADE, which
    // only fires when this is set. Harmless for pre-existing tables since
    // none of them declare foreign keys.
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("failed to enable foreign_keys pragma: {}", e))?;

    schema::apply(&conn).map_err(|e| format!("failed to apply schema: {}", e))?;

    DB.set(Mutex::new(conn))
        .map_err(|_| "db already initialised".to_string())?;
    Ok(())
}

pub fn with_conn<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
{
    let lock = DB.get().ok_or_else(|| "db not initialised".to_string())?;
    let guard = lock.lock().map_err(|e| format!("db lock: {e}"))?;
    f(&guard).map_err(|e| e.to_string())
}

pub fn with_conn_mut<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce(&mut Connection) -> Result<T, rusqlite::Error>,
{
    let lock = DB.get().ok_or_else(|| "db not initialised".to_string())?;
    let mut guard = lock.lock().map_err(|e| format!("db lock: {e}"))?;
    f(&mut guard).map_err(|e| e.to_string())
}
