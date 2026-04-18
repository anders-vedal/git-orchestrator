# Architecture

## System overview

Repo Dashboard is a single-process Tauri 2 desktop app. One native Windows
window hosts a WebView2 frontend; a Rust backend lives in the same process
and communicates with the frontend via Tauri's IPC channel. There is no HTTP
server, no external daemon, and no telemetry.

```
  ┌────────────────────────────────────────────────────────────────────┐
  │                        repo-dashboard.exe                          │
  │                                                                    │
  │  ┌─────────────────────────┐        ┌─────────────────────────┐   │
  │  │  WebView2 (frontend)    │  IPC   │  Rust backend            │  │
  │  │  React 19 + Zustand     │◀──────▶│  Tauri 2 invoke handler  │  │
  │  │  src/                   │        │  src-tauri/src/          │  │
  │  └──────────┬──────────────┘        └──────────┬──────────────┘   │
  │             │                                   │                  │
  │        user input                       shells out to git.exe      │
  │                                     +  opens SQLite (bundled)      │
  │                                     +  spawns Explorer / wt / cmd  │
  │                                     +  manages system tray icon    │
  └────────────────────────────────────────────────────────────────────┘
                                               │
                            ┌──────────────────┼──────────────────┐
                            ▼                  ▼                  ▼
               %APPDATA%\RepoDashboard  git.exe (PATH)    Explorer / WT
               repo-dashboard.sqlite
```

## Data flow (one user-facing interaction)

Example: user clicks **Fetch** on a repo row.

```
  RepoActions.tsx  →  api.gitFetch(id)              # src/lib/tauri.ts
                     → invoke("git_fetch", {id})    # Tauri IPC
                         ↓
  commands/git_ops.rs::git_fetch
     spawn_blocking(move || run_git_raw(path, &["fetch", "--all", "--prune"]))
                         ↓
  git/runner.rs::run_git_raw
     Command::new("git").arg("-C").arg(path).args(...).output()
                         ↓
     returns GitOutput{ stdout, stderr, code }
                         ↓
  commands/git_ops.rs merges stdout/stderr,
     returns Ok(String) or Err(String) to the frontend
                         ↓
  RepoActions.tsx awaits the promise:
     on success → calls reposStore.refreshOne(id)
     on error   → openDialog({kind:"info", title, body})
                         ↓
  reposStore.refreshOne(id) → api.getRepoStatus(id) → invoke("get_repo_status")
                         ↓
  commands/status.rs::get_repo_status builds a fresh RepoStatus
     using git/status.rs + git/log.rs + git/remote.rs helpers
                         ↓
  Store patches the updated RepoStatus into state.statuses[]
                         ↓
  RepoRow.tsx re-renders with new pills
                         ↓
  App.tsx's tooltip effect fires:
     api.setTrayTooltip(buildTooltip(statuses))
                         ↓
  commands/system.rs::set_tray_tooltip → tray.rs::set_tooltip →
     TrayIcon::set_tooltip(...) — system tray updates
```

## Concurrency model

### Rust side

- **Tokio runtime**: Tauri starts a multi-thread Tokio runtime. All
  `#[tauri::command]` handlers are `async fn`s.
- **Blocking work**: git subprocesses block the calling thread. Every handler
  that shells out wraps the work in `tokio::task::spawn_blocking`, so the
  Tokio worker stays free. See `commands/git_ops.rs::git_fetch` as the template.
- **SQLite**: wrapped in `OnceCell<Mutex<Connection>>`. All DB access goes
  through `db::with_conn` / `db::with_conn_mut`, which lock the mutex for
  the duration of the closure. Queries are short and fast; no long-running
  transactions — acceptable for this workload.
- **Bulk fan-out**: `get_all_statuses`, `git_fetch_all`, and `git_pull_all_safe`
  spawn one `spawn_blocking` task per repo and `await` them all. Fully
  parallel — expect N repos = N concurrent git subprocesses.

### Frontend side

- **Zustand stores**: synchronous state holders, no React context. Three
  stores (`reposStore`, `settingsStore`, `uiStore`) chosen so re-render
  scope stays narrow.
- **Refresh semantics**:
  - `loadAll` — full reload, sets `loading: true` during the call
  - `refreshAll` — soft reload, sets `refreshing: true`, keeps stale data visible
  - `refreshOne(id)` — single-row refresh, adds `id` to `refreshingIds: Set<number>`
- **Auto-refresh loop**: `App.tsx` `setInterval` at
  `settings.refreshIntervalSec * 1000` ms. Skipped while `bulkInProgress` is
  true to avoid racing with the user's bulk action.
- **Tray event listener**: `listen("tray:fetch-all", ...)` in `App.tsx`. When
  the tray menu fires, the frontend runs the same flow as the sidebar's
  Fetch All button — consistent UI (progress, summary dialog, refresh).

## File responsibility map

### `src-tauri/src/`

| File | Responsibility |
|---|---|
| `main.rs` | Thin entrypoint; calls `repo_dashboard_lib::run()`. On Windows release builds, `windows_subsystem = "windows"` suppresses the console. |
| `lib.rs` | `run()` builds the Tauri app: inits DB, registers plugins (dialog, opener), sets up tray, wires `on_window_event`, registers all `#[tauri::command]` handlers. The canonical list of exposed commands lives here. |
| `models.rs` | Shared structs crossing the IPC boundary: `Repo`, `Commit`, `RepoStatus` (with `hasSubmodules` / `diverged` / `unpushedNoUpstream`), `Dirty`, `DirtyBreakdown`, `BulkResult` (with `reason: BulkReason`), `BulkPullReport`, `ForcePullPreview`, `ForcePullResult`, `ActionLogEntry`. `#[serde(rename_all = "lowercase")]` on `Dirty` / `BulkReason` and `#[serde(rename = "camelCase")]` on status fields keep JSON snake_case→camelCase consistent with the TS types. |
| `tray.rs` | Tray icon, menu, click handling, close-to-tray behaviour. Exposes `set_tooltip()` called by the `set_tray_tooltip` command. |
| `commands/repos.rs` | Repo registry CRUD. `add_repo` normalizes the path (`util::normalize_path`), verifies it's a real working tree (`git/runner.rs::is_git_repo`), then dedup-checks via `find_repo_by_normalized_path` before inserting. `canonical()` rejects UNC / network paths under `#[cfg(windows)]`; on mac/linux the check is a no-op. |
| `commands/status.rs` | Builds `RepoStatus` objects. `get_all_statuses` parallelises across repos via `spawn_blocking`. `read_last_fetch` reads `.git/FETCH_HEAD`'s mtime rather than shelling out to git. |
| `commands/git_ops.rs` | Shell-out commands: `git_fetch`, `git_pull_ff`, `git_force_pull` (with default-branch guard), `git_fetch_all`, `git_pull_all_safe`, `force_pull_preview` (pre-action disclosure), `undo_last_action`, `get_action_log`, `diagnose_auth` (re-runs fetch with `GIT_TRACE`). Bulk commands share a `tokio::Semaphore` sized by the `bulk_concurrency` setting (default 4). `log_action` writes every destructive op to `action_log` with pre/post HEAD and stderr excerpt. Every handler wraps its sync work in `spawn_blocking`. |
| `commands/scan.rs` | Directory-scan import. `scan_folder` lists direct children that look like git working trees and annotates each with `{alreadyAdded, ignored}` by consulting `repos` + `ignored_paths`. `add_scanned_repos` bulk-inserts with the same canonical/is_git_repo/dedup guards as `add_repo`. `ignore_path` / `unignore_path` / `list_ignored_paths` manage the suppression list. |
| `commands/system.rs` | OS integration. Each command has platform-specific branches via `#[cfg(windows)]` / `#[cfg(target_os = "macos")]` / `#[cfg(target_os = "linux")]`. `open_folder` → explorer / Finder (`open`) / `xdg-open`. `open_terminal` → per-OS launcher chain (wt/git-bash/cmd · Terminal/iTerm2 · gnome-terminal/konsole/alacritty/kitty/xterm). `open_remote` / `open_commit` use the opener plugin (http/https-only guard) — portable. `set_tray_tooltip`. |
| `commands/settings.rs` | Free-form key/value settings. Frontend defines the shape; backend just persists strings. Keys are allowlisted server-side (`ALLOWED_KEYS`). |
| `util.rs` | `normalize_path` — platform-aware normalization (separate `#[cfg(windows)]` and `#[cfg(not(windows))]` bodies) used anywhere a repo path is compared or stored. Drives dedup correctness. Pure; unit-tested on both platforms. |
| `git/runner.rs` | **The single `Command::new("git")`.** All other files go through `run_git` (errors on non-zero exit) or `run_git_raw` (returns output + code for callers that need to inspect exit code). `run_git_traced` is a diagnostics-only variant that sets `GIT_TRACE=1 GIT_TRACE_CURL=1 GIT_TRACE_SETUP=1 GCM_INTERACTIVE=Never`. Uses `CREATE_NO_WINDOW` on Windows to prevent a console flash for each subprocess. |
| `git/status.rs` | `current_branch`, `default_branch` (origin/HEAD → main → master → HEAD), `ahead_behind` via `rev-list --left-right --count HEAD...@{upstream}`, `dirty_from_porcelain` (Dirty enum) + `dirty_breakdown` (per-category counts for the force-pull preview), `current_head_sha`, `rev_count_between`, `has_submodules` (exists-check on `.gitmodules`), `ref_short_sha`. |
| `git/log.rs` | `git log` with a unit-separator (\u001F) + record-separator (\u001E) custom format to safely split commit fields that may contain whitespace or newlines. `parse_log` is pure and unit-tested. `commits_since(base_ref, limit)` powers the force-pull preview's "N unpushed commits" list. |
| `git/remote.rs` | `to_web_url` handles GitHub SSH/HTTPS, GitLab subgroups, Azure DevOps SSH v3 + HTTPS, Bitbucket. `commit_web_url` branches on host to produce correct commit URLs (`/commit/`, `/-/commit/`, `/commits/`). |
| `db/mod.rs` | `OnceCell<Mutex<Connection>>` holder, `data_dir()` = `%APPDATA%\RepoDashboard\`, `with_conn` / `with_conn_mut` access helpers. |
| `db/schema.rs` | `MIGRATIONS: &[(name, sql)]` list + a migration runner. Each migration is idempotent via `IF NOT EXISTS` and tracked in `schema_migrations`. Current migrations: `001_init`, `002_ignored_paths`, `003_action_log`. |
| `db/queries.rs` | Thin rusqlite wrappers: `list_repos`, `find_repo`, `insert_repo`, `delete_repo`, `rename_repo`, `reorder` (transaction), `get_setting`, `set_setting`, `list_ignored` / `is_path_ignored` / `add_ignored_path` / `remove_ignored_path`, and the audit-log helpers `insert_action_log` + `recent_actions_for_repo` + `last_undoable_action`. |

### `src/`

| File | Responsibility |
|---|---|
| `main.tsx` | React entry. Imports `./index.css` which loads Tailwind. |
| `App.tsx` | Shell component. Wires: settings load → initial repo load → auto-refresh loop → tray event listener → tray tooltip push effect → renders Sidebar + RepoList + all dialogs. |
| `types.ts` | TS mirrors of `models.rs`. `DEFAULT_SETTINGS` lives here. |
| `lib/tauri.ts` | **Single typed IPC wrapper.** Adding a new `#[tauri::command]` means adding one function here. |
| `lib/format.ts` | `timeAgo`, `truncate`, `firstLine`. |
| `lib/gitErrors.ts` | `classifyGitError(raw)` → `{category, title, hint, diagnosable, raw}`. Pattern-matches stderr into 9 categories (`auth_ssh`, `auth_https`, `cert_invalid`, `dirty_tree`, `not_ffable`, `network`, `rate_limited`, `refused`, `unknown`). `sanitizeGitError` redacts `user@` URL prefixes and PAT-shaped tokens. Pure string functions — no state, no IPC. |
| `lib/trayTooltip.ts` | `buildTooltip(statuses)` — multi-line string summarising diverged/behind/ahead/unpushed/dirty/error counts + up-to-3 names. |
| `stores/reposStore.ts` | Canonical state for repos + statuses. Actions: `loadAll`, `refreshAll`, `refreshOne`, `remove`, `rename`, `reorder`, `add`. Uses `refreshingIds: Set<number>` for per-row spinners. |
| `stores/settingsStore.ts` | Hydrates from 4 `get_setting` calls (parallel) on startup. `update(partial)` writes one `set_setting` per changed key. Applies `dark` class to `<html>` on theme change. |
| `stores/uiStore.ts` | Ephemeral UI state: `expandedIds: Set<number>`, `dialog: DialogKind` (discriminated union), `bulkInProgress: boolean`. |
| `components/Sidebar.tsx` | Left sidebar: logo + repo count, Add Repo button, bulk actions (Fetch All / Pull All Safe / Refresh All), auto-refresh indicator, Settings button. |
| `components/RepoList.tsx` | `DndContext` + `SortableContext`. Renders empty state (no repos) or a vertical list of `RepoRow`s. |
| `components/RepoRow.tsx` | Per-row layout. Drag handle, rename-in-place input, status pills (branch / dirty / ahead/behind / error / default-branch-mismatch), latest commit line, `RepoActions`, refresh/rename/remove corner buttons, expandable `RepoLogPanel`. |
| `components/RepoActions.tsx` | The 7-button action strip. Runs each command with a shared `busy` state; on error, opens `InfoDialog` with the backend message. Force Pull button only opens the `ForcePullDialog`, never calls the backend directly. |
| `components/RepoLogPanel.tsx` | Lazy-loads last 10 commits when expanded. SHA buttons open the commit URL on the remote. |
| `components/dialogs/AddRepoDialog.tsx` | Uses `@tauri-apps/plugin-dialog::open({directory: true})` to browse. Defaults the name to the folder name. Rejects non-git folders (backend check). |
| `components/dialogs/ScanFolderDialog.tsx` | Pick a parent folder → `scan_folder` preview → checkbox list of candidates (new / already-added / ignored, with inline un-ignore). `Add selected` bulk-inserts via `add_scanned_repos`. Re-scan skips previously-ignored paths until un-ignored. |
| `components/dialogs/RemoveRepoDialog.tsx` | Confirm-remove + optional "also ignore this folder in future scans" checkbox. When checked, `ignore_path` is called after `remove_repo` so a subsequent scan won't re-propose the folder. |
| `components/dialogs/ForcePullDialog.tsx` | Two views in one component. **Pre-action**: checkbox required every time, renders `PreviewPanel` with unpushed commits / dirty counts / untracked-preserved note / fast-forward preview from `force_pull_preview`. **Post-action**: reflog-rescue hint + one-click Undo button (`undo_last_action`) that stays live for the session. |
| `components/dialogs/SettingsDialog.tsx` | Terminal preference, auto-refresh interval, default repos directory, theme, bulk concurrency slider (1–16, default 4), **Ignored paths** list with per-row un-ignore. |
| `components/dialogs/BulkResultDialog.tsx` | Replaces the old text-blob summary for `git_fetch_all` / `git_pull_all_safe`. Counts at top, per-row grouped by outcome (Updated / Skipped / Blocked), contextual action buttons on each row: Open folder, Open terminal, Retry (for failures), Force pull (for dirty-tree skips where the repo is on the default branch), expand-stderr on click. Reads the `BulkReason` enum from the result to decide what buttons to offer. |
| `components/dialogs/GitErrorDialog.tsx` | Wraps `GitErrorPanel` in a dialog shell. Used for bulk op total failures and any command that surfaces a git error with repo context. |
| `components/dialogs/InfoDialog.tsx` | Generic modal for non-git success/failure summaries (rename, scan, etc.). Git errors go through `GitErrorDialog` instead. |
| `components/errors/GitErrorPanel.tsx` | Renders a classified error: category icon + title + friendly hint + "Open terminal" + "Diagnose auth" (when `diagnosable`, calls `diagnose_auth` and shows the sanitized trace) + expander for raw stderr. Reusable outside dialogs. |
| `components/ui/Button.tsx` | `Button` (labelled) + `IconButton` (square, tooltip via `title`). |
| `components/ui/Pill.tsx` | Status pill primitive with 5 tones (neutral/green/yellow/red/blue). |
| `components/ui/Dialog.tsx` | Modal primitive. Handles Escape-to-close and click-outside-to-close. |

## IPC command surface

Full list of `#[tauri::command]` handlers. Frontend wrappers in
`src/lib/tauri.ts` mirror these one-to-one.

| Command | Input | Output | Notes |
|---|---|---|---|
| `list_repos` | — | `Repo[]` | Sorted by priority ASC |
| `add_repo` | `path, name?` | `Repo` | Verifies `is_git_repo(path)` first |
| `remove_repo` | `id` | — | |
| `rename_repo` | `id, newName` | — | Trimmed, rejects empty |
| `reorder_repos` | `orderedIds[]` | — | Updates `priority` in a transaction |
| `get_repo_status` | `id` | `RepoStatus` | Single-repo refresh |
| `get_all_statuses` | — | `RepoStatus[]` | Parallel across all repos |
| `get_repo_log` | `id, count` | `Commit[]` | Last N on HEAD |
| `git_fetch` | `id` | `string` (git output) | `fetch --all --prune` |
| `git_pull_ff` | `id` | `string` | `pull --ff-only`; fails if not fast-forward |
| `git_force_pull` | `id` | `ForcePullResult` | Refuses if off default branch; captures pre/post HEAD and logs to `action_log` |
| `git_fetch_all` | — | `BulkResult[]` | Parallel fetch, capped by `bulk_concurrency` |
| `git_pull_all_safe` | — | `BulkPullReport` | Only pulls clean repos on default branch; capped by `bulk_concurrency`; each row carries a `BulkReason` |
| `force_pull_preview` | `id` | `ForcePullPreview` | Pre-action disclosure: unpushed commits, dirty breakdown, fast-forward target. No fetch. |
| `undo_last_action` | `id` | `ForcePullResult` | Restores the most recent `force_pull`'s pre-HEAD; refuses on dirty tree; logs itself |
| `get_action_log` | `id, limit?` | `ActionLogEntry[]` | Recent destructive actions for a repo (default 20, max 200) |
| `diagnose_auth` | `id` | `string` (trace) | Re-runs `fetch --dry-run` with `GIT_TRACE` / `GIT_TRACE_CURL` / `GIT_TRACE_SETUP`. Output sanitized, truncated to 32KB. |
| `open_folder` | `id` | — | Explorer |
| `open_terminal` | `id` | — | wt → git-bash → cmd, respects `terminal` setting |
| `open_remote` | `id` | — | Parses origin URL, opens web URL (http/https allowlisted) |
| `open_commit` | `id, sha` | — | Builds commit URL per host, opens it |
| `set_tray_tooltip` | `text` | — | Frontend pushes a status summary to the tray |
| `get_setting` | `key` | `string?` | Keys allowlisted server-side |
| `set_setting` | `key, value` | — | UPSERT, key allowlisted server-side |
| `scan_folder` | `parent` | `ScanResult` | Lists direct children that are git repos, annotated with `alreadyAdded` / `ignored`. Capped at 500 candidates. |
| `add_scanned_repos` | `paths[]` | `ScanAddResult` | Bulk-add with per-entry skip reasons. Each path re-validated through `canonical()` + `is_git_repo()` + ignore-list check. |
| `list_ignored_paths` | — | `IgnoredPath[]` | For Settings UI. |
| `ignore_path` | `path` | — | Normalized via `util::normalize_path` before insert. |
| `unignore_path` | `path` | — | Normalized on the key lookup. |

## Data model

### SQLite

```sql
CREATE TABLE repos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,            -- stored normalized (util::normalize_path)
    priority INTEGER NOT NULL DEFAULT 0,  -- lower = higher in list
    added_at TEXT NOT NULL
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Migration 002. Paths the user has asked not to be re-proposed by
-- "Scan folder…". Populated when RemoveRepoDialog's "also ignore" box is
-- ticked, or directly from the Settings → Ignored paths list. scan_folder
-- subtracts this set (and repos.path) from its candidate list.
CREATE TABLE ignored_paths (
    path TEXT PRIMARY KEY,                -- normalized, same rules as repos.path
    added_at TEXT NOT NULL
);

-- Migration 003. One row per destructive git op (currently: force_pull).
-- Drives the one-click undo affordance via the pre-op HEAD SHA, which
-- stays in the reflog long enough to restore.
CREATE TABLE action_log (
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
CREATE INDEX idx_action_log_repo ON action_log(repo_id, started_at DESC);

CREATE TABLE schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE INDEX idx_repos_priority ON repos(priority);
```

**Path normalization note.** `repos.path` and `ignored_paths.path` are
always stored normalized. The rules differ per platform (see
`src-tauri/src/util.rs`):
- **Windows**: uppercase drive letter, forward slashes → back, trailing
  separators stripped, UNC `\\server\share` prefix preserved.
- **Unix (mac/linux)**: double-slash runs collapsed, trailing `/`
  stripped, case preserved.

The SQLite UNIQUE on `repos.path` is case-sensitive, so dedup relies on
normalize-both-sides comparison in `find_repo_by_normalized_path` rather
than the SQL constraint alone — this catches rows inserted before the
normalization pass (if any). A DB created on one platform is not
portable to another; the stored path shapes differ.

### Settings keys

| Key | Values | Default |
|---|---|---|
| `terminal` | `auto` plus one of: `wt` \| `git-bash` \| `cmd` (Windows) · `terminal` \| `iterm2` (macOS) · `gnome-terminal` \| `konsole` \| `alacritty` \| `kitty` \| `xterm` (Linux) | `auto` |
| `refresh_interval_sec` | positive integer (clamped ≥30 in UI) | `300` |
| `default_repos_dir` | absolute path string | `""` (unset) |
| `theme` | `dark` \| `light` \| `system` | `dark` |
| `bulk_concurrency` | `1`–`16` | `4` — max repos fetched/pulled in parallel, gating `tokio::Semaphore` in `git_fetch_all` / `git_pull_all_safe`. Lower reduces GCM popup storms and VPN rate-limit pressure. |

### Runtime RepoStatus (never persisted)

See `src-tauri/src/models.rs::RepoStatus` and `src/types.ts::RepoStatus`.

## Tray lifecycle

- **Startup** (`lib.rs::run()` → `setup`): `tray::build` creates the tray icon
  using the app's default window icon, attaches the right-click menu
  (Show / Fetch All / — / Quit), and registers both menu and click handlers.
- **Left-click**: toggles the main window — hide if visible & focused, show+focus
  otherwise.
- **Menu "Show window"**: always shows + unminimizes + focuses.
- **Menu "Fetch all"**: shows the window, emits `tray:fetch-all` event. The
  frontend listener in `App.tsx` runs the same flow as the sidebar button.
- **Menu "Quit"**: `app.exit(0)` — actually terminates the process.
- **Close button** (`tray::on_window_event`): `api.prevent_close(); window.hide()`.
  The process stays running; reopen via tray.
- **Tooltip**: frontend pushes a summary after every status change via
  `set_tray_tooltip`. See `src/lib/trayTooltip.ts` for the format.

## Safety model

Destructive git ops (today: `git_force_pull`, `undo_last_action`) go through
a distinct code path that captures pre-HEAD, logs to `action_log` in SQLite,
and exposes a session-level Undo button + reflog-rescue hint in the success
toast. See `docs/safety-model.md` for the full tier model, recovery
procedures, and the checklist for adding future destructive commands.

## Build pipeline

- `npm run dev` / `npm run tauri dev` — Vite dev server on port 1420 (strict),
  Rust rebuilds on change, WebView2 picks up HMR.
- `npm run build` — TypeScript check + Vite production build into `dist/`.
- `npm run tauri build` — runs `npm run build` first (configured in
  `tauri.conf.json::build.beforeBuildCommand`), then compiles Rust in release
  mode, then bundles MSI (via WiX) + NSIS installers.

Release artefacts land in:
- `src-tauri/target/release/repo-dashboard.exe` (~11 MB standalone)
- `src-tauri/target/release/bundle/msi/Repo Dashboard_0.1.0_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/Repo Dashboard_0.1.0_x64-setup.exe`

On the first `tauri build`, Tauri downloads WiX 3.14 and NSIS 3.11 binaries
into `src-tauri/target/release/wix/` and `nsis/`. Subsequent builds reuse them.
