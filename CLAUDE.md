# CLAUDE.md

Guidance for Claude Code when working with this repo. This file captures what's
non-obvious from reading the code — decisions, invariants, and landmarks. The
full design spec is in `project-requirements.md`; detailed architecture notes
live under `docs/`.

## Project status

**Shipped MVP + tray.** All 12 steps of the implementation order in
`project-requirements.md` are complete, plus the optional system-tray feature.
`npm run tauri build` produces signed installers under
`src-tauri/target/release/bundle/{msi,nsis}/`.

## What this is

Single-user Windows desktop app ("Repo Dashboard") for monitoring and syncing
10+ local git repos from one always-on window. Shells out to the system `git`
CLI (never `git2`/libgit2) for behaviour parity with the user's terminal.

**Target**: Windows 11 ARM64 primary, Windows x64 secondary. macOS/Linux are
dev-quality — code compiles and the core flow runs, but there's no CI matrix,
no signed installers, no release pipeline. Platform-specific behaviour is
cfg-gated (`commands/system.rs` terminal launchers, `util::normalize_path`,
UNC rejection in `commands/repos.rs`). When you add platform-dependent code,
follow the `#[cfg(windows)]` / `#[cfg(target_os = "macos")]` /
`#[cfg(target_os = "linux")]` pattern already used in those modules.

## Tech stack

Tauri 2 · Rust 1.95+ · React 19 · TypeScript 5.8 · Vite 7 · Tailwind 3 ·
Zustand 5 · `rusqlite` 0.31 (bundled SQLite) · `@dnd-kit` · Lucide icons.

## Build & run

```bash
npm install
npm run tauri dev      # hot-reload frontend; Rust rebuilds on change
npm run tauri build    # MSI + NSIS installers under src-tauri/target/release/bundle/
```

**Prerequisites:** Node 20+, Rust stable via rustup.
- **Windows**: MSVC Build Tools (WebView2 preinstalled on Win11)
- **macOS**: `xcode-select --install`
- **Linux (Debian/Ubuntu)**: `sudo apt install libwebkit2gtk-4.1-dev libsoup-3.0-dev libayatana-appindicator3-dev build-essential libssl-dev libxdo-dev pkg-config`

Rust tests (pure parsers only — they don't touch a real repo):
```bash
cd src-tauri && cargo test --lib
```

## Architectural invariants

These are enforced by code layout + the architect review. Do not silently
reverse them — if a future requirement pressures one of these, surface the
conflict.

1. **Shell out to `git`, never link `git2`/libgit2.** Every git invocation
   funnels through `src-tauri/src/git/runner.rs::run_git` / `run_git_raw`.
   Handlers in `commands/*.rs` must NEVER call `std::process::Command::new("git")`
   directly. Grep guard: there should be **exactly one** `Command::new("git")`
   in the tree, inside `git/runner.rs`.

2. **Frontend calls Tauri only through `src/lib/tauri.ts`.** Components and
   stores must not import `invoke` from `@tauri-apps/api/core`. The wrapper
   layer is the single place where argument shapes and return types are
   enforced, and where mocks would slot in for tests. Grep guard: the only
   `import { invoke }` in `src/` should be in `src/lib/tauri.ts`.

3. **Fixed command surface, no arbitrary shell from the frontend.** Frontend
   passes repo IDs, never raw command strings or paths. See the full command
   list in `src-tauri/src/lib.rs` — 29 `#[tauri::command]` handlers total
   (19 spec'd + `set_tray_tooltip` + 3 for the action-log / undo / force-pull
   preview feature + 5 for scan/ignore). The scan flow is the one case where
   the frontend passes a path rather than a repo id; it runs through the
   same `canonical()` + `is_git_repo()` gate as `add_repo`.

4. **Force pull is guarded twice.** Both on the backend (`commands/git_ops.rs`
   refuses if current branch ≠ default branch) and on the frontend
   (`RepoActions.tsx` disables the button when off-default; `ForcePullDialog.tsx`
   requires an explicit acknowledgement checkbox every time, no
   "don't ask again").

5. **URL opening is allowlisted.** `src-tauri/capabilities/default.json`
   restricts `opener:allow-open-url` to `http://**` and `https://**`. The
   `open_remote` and `open_commit` Rust commands additionally verify the
   scheme before calling the opener plugin (`commands/system.rs::ensure_http_https`).

6. **Default branch detection order:** `git symbolic-ref refs/remotes/origin/HEAD`
   → check `refs/heads/main` → check `refs/heads/master` → current HEAD.
   Dirty detection uses `git status --porcelain=v1 -z` and classifies into
   `clean | unstaged | staged | untracked | mixed`.

7. **Terminal launcher detection order:** `wt.exe` in PATH → `C:\Program Files\Git\git-bash.exe --cd=<path>`
   → `cmd /c start cmd /K "cd /d <path>"`. The `terminal` setting can force
   one specific launcher (`auto`, `wt`, `git-bash`, `cmd`).

8. **Data location:** SQLite DB lives in `%APPDATA%\RepoDashboard\repo-dashboard.sqlite`.
   Schema migrations in `src-tauri/src/db/schema.rs` — never hand-edit the DB,
   add a new entry to `MIGRATIONS` instead.

9. **Tray ≠ window state.** Closing the main window **hides** to tray rather
   than exiting (`tray::on_window_event`). The app only exits via the tray
   menu "Quit", the task manager, or a background event. Left-click toggles
   the window; right-click opens the menu.

10. **Git invocations carry per-call hardening flags.** `runner::new_git_command`
    always prefixes every `git` call with
    `-c core.fsmonitor= -c protocol.ext.allow=never -c credential.helper=`,
    so a hostile `.git/config` in a watched repo cannot trigger RCE on the
    refresh timer. See `BASE_HARDENING_FLAGS` in `git/runner.rs` and the
    residual risks (SSH command, aliases, hooks) catalogued in `docs/security.md`.
    The third flag — `credential.helper=` (empty) — resets git's helper chain
    so a repo-local `credential.helper=!shell-cmd` cannot be appended to the
    chain git consults during fetch/pull/sign-in. Helper values prefixed with
    `!` are run as shell commands by git; without this reset, any watched
    repo could inject RCE the moment the user clicked Fetch. After the reset
    we re-pin the user's GLOBAL helper via `resolved_credential_helper()` so
    legitimate fetch/pull/sign-in flows still work. The global helper is
    cached at the runner layer and invalidated via
    `invalidate_credential_helper_cache()` after
    `configure_credential_helper` writes a new value.

11. **UNC paths are rejected at add-time (Windows only).** `commands/repos.rs::canonical`
    refuses paths beginning with `\\` or `//` under `#[cfg(windows)]`. Running
    `git -C \\server\share` on the refresh timer combines with hostile-config
    vectors, so network repos must be mounted to a drive letter before being
    added. On mac/linux the gate doesn't fire — `/` is the normal filesystem
    root and network mounts surface under `/Volumes` or `/mnt`
    indistinguishable from local disks.

12. **Settings keys are allowlisted server-side.** `commands/settings.rs::ALLOWED_KEYS`
    mirrors the `KEY_MAP` in `settingsStore.ts`. A compromised renderer
    cannot stuff arbitrary keys into the settings table. Both lists must
    stay in sync.

13. **Repo paths are stored normalized.** Every insert into `repos.path` and
    `ignored_paths.path` runs through `util::normalize_path`. The rules are
    **platform-specific**:
    - **Windows**: uppercase drive letter, forward→backslashes, strip trailing
      separators, collapse double backslashes, preserve UNC prefix. Collapses
      `C:\Projects\foo` and `c:/projects/foo/` to one row.
    - **Unix (mac/linux)**: trim whitespace, collapse `//` runs to `/`, strip
      trailing `/`, preserve case (case is meaningful for git on both macOS
      APFS and Linux filesystems).

    Dedup correctness in `add_repo` and the scan flow depends on this.
    Existing pre-normalization rows may exist, so `find_repo_by_normalized_path`
    normalizes on both sides of the comparison rather than relying on the
    SQLite UNIQUE index.

    A SQLite DB created on one platform is NOT portable to another — the
    stored path strings follow that platform's separator/case rules and won't
    round-trip cleanly.

14. **Scan-and-ignore is path-set algebra.** "Scan folder…" lists direct
    children of a parent folder that `is_git_repo()` answers true for, and
    filters against two sets: already-in-`repos` and in-`ignored_paths`.
    Removing a repo with the "also ignore this folder" checkbox adds the
    normalized path to `ignored_paths` so a future scan (manual or
    scheduled) does NOT re-propose it. Un-ignore is a deliberate action
    from the scan dialog or the Settings → Ignored paths list.

15. **Destructive ops capture pre-HEAD and log to `action_log` before
    mutating the working tree.** Today that's `git_force_pull` and its
    partner `undo_last_action`; any future `reset --hard`, `clean -fd`,
    or push-force must do the same via `commands/git_ops.rs::log_action`
    + migration `003_action_log`. This is what makes the session-level
    Undo button and the reflog-rescue hint in the success toast work —
    do not regress it. Full rationale in `docs/safety-model.md`.

16. **Any future force-push must use `--force-with-lease --force-if-includes`,
    never bare `--force`.** The auto-refresh loop silently fetches in the
    background, which invalidates naive `--force-with-lease` safety
    (microsoft/vscode#144635). `--force-if-includes` (Git 2.30+) closes
    that race. The current `git_commit_push` never force-pushes (see #17),
    so this invariant applies to any future force-push feature we add.
    See `docs/safety-model.md` §"Future destructive ops".

17. **Commit & push is opt-in, single-button, bare-push-only.** The
    `git_commit_push` command stages with `git add -A`, commits with a
    required user-supplied message, then — only if the user ticks the
    push checkbox — runs either `git push` (upstream exists) or
    `git push -u origin <branch>` (setting upstream on first push).
    Never `--force`, never `--force-with-lease`. A commit with a failed
    push returns `committed: true, pushed: false` and surfaces the push
    error separately — the commit is NOT rolled back, since it's
    recoverable via `git reset --soft HEAD~1`. Pre- and post-HEAD are
    written to `action_log` under action `commit_push` so a future
    "undo commit" feature can reuse the same infrastructure as force-pull
    undo. The frontend gates this behind `CommitPushDialog`, which shows
    a full file preview and the exact commands that will run before the
    user clicks — do not bypass that disclosure step.

## Code layout

Canonical tree — see `docs/architecture.md` for responsibilities per file.

```
src-tauri/src/
├── lib.rs               # Tauri builder: plugins, tray setup, window events, invoke handler registration
├── main.rs              # Calls lib.rs::run()
├── models.rs            # Serde structs crossing the IPC boundary
├── tray.rs              # Tray icon, menu, event handlers, tooltip API
├── util.rs              # normalize_path — shared between repos::add_repo and scan (dedup correctness)
├── commands/            # One file per domain. Register new cmds in lib.rs.
│   ├── repos.rs         # list/add/remove/rename/reorder + canonical() path guard
│   ├── status.rs        # get_repo_status, get_all_statuses, get_repo_log, get_changed_files
│   ├── git_ops.rs       # fetch, pull_ff, force_pull (+ preview, undo, action log, diagnose_auth), commit_push, bulk fetch/pull with concurrency semaphore
│   ├── scan.rs          # scan_folder, add_scanned_repos, list/ignore/unignore paths
│   ├── system.rs        # open folder/terminal/remote/commit, set_tray_tooltip
│   └── settings.rs      # get_setting / set_setting (server-side key allowlist)
├── git/                 # Pure git interaction. Parsers are unit-testable.
│   ├── runner.rs        # The ONLY Command::new("git") in the codebase
│   ├── status.rs        # current_branch, default_branch, ahead_behind, dirty_from_porcelain, dirty_breakdown, current_head_sha, rev_count_between, has_submodules, ref_short_sha
│   ├── log.rs           # log() + parse_log() + commits_since() with unit separator encoding
│   └── remote.rs        # origin_url, to_web_url, commit_web_url (github/gitlab/azure/bitbucket)
└── db/                  # rusqlite with bundled SQLite
    ├── mod.rs           # OnceCell<Mutex<Connection>>, data_dir(), init()
    ├── schema.rs        # MIGRATIONS table + migration runner
    └── queries.rs       # CRUD on repos, settings kv, ignored_paths, action_log

src/
├── main.tsx
├── App.tsx              # Shell: auto-refresh loop, tray event listener, dialogs
├── types.ts             # Frontend mirrors of models.rs structs
├── lib/
│   ├── tauri.ts         # THE ONLY place that imports `invoke`. Add new cmds here first.
│   ├── format.ts        # timeAgo, truncate, firstLine
│   ├── gitErrors.ts     # classifyGitError() + sanitizeGitError() — pure string → category + hint
│   └── trayTooltip.ts   # buildTooltip(statuses) — summary used by the tray
├── stores/              # Zustand stores (no context, no Redux)
│   ├── reposStore.ts    # statuses[], loading/refreshing flags, refreshingIds set, CRUD + addMany (scan)
│   ├── settingsStore.ts # settings object, hydrates from get_setting on startup
│   └── uiStore.ts       # expandedIds set, current dialog descriptor, bulkInProgress flag
└── components/
    ├── Sidebar.tsx      # Add repo / Scan folder buttons, bulk actions, auto-refresh indicator, settings
    ├── RepoList.tsx     # dnd-kit SortableContext + empty state
    ├── RepoRow.tsx      # Header pills, latest commit, inline rename, RepoActions, expandable log
    ├── RepoActions.tsx  # Fetch / Pull / Commit & push / Force pull / Open folder/terminal/remote / expand log
    ├── RepoLogPanel.tsx # Last 10 commits, clickable SHAs open remote
    ├── RepoChangesPanel.tsx # Working-tree file list (status code + path), shown in expanded row when dirty
    ├── dialogs/         # AddRepo, ScanFolder, RemoveRepo, ForcePull (preview + undo), CommitPush, BulkResult, GitError, Settings, Info
    ├── errors/          # GitErrorPanel — reusable classified-error renderer with Diagnose button
    └── ui/              # Button, IconButton, Pill, Dialog primitives
```

## Adding new functionality

- **New git command from the frontend:**
  1. Write the helper in `src-tauri/src/git/` (pure, testable)
  2. Expose via `#[tauri::command]` in the right `commands/*.rs` file
  3. Register in `lib.rs`'s `invoke_handler!`
  4. Add typed wrapper in `src/lib/tauri.ts`
  5. Call from store/component

- **New destructive git command** (mutates the working tree, discards
  commits, rewrites refs): read `docs/safety-model.md` first. Minimum:
  backend guard on repo state; capture pre-HEAD via
  `status::current_head_sha`; log via `log_action` (`action_log` table);
  a preview command that discloses what will be lost; Tier-2 checkbox
  dialog on the frontend; reflog-rescue hint or Undo affordance in the
  success toast. Invariants 15 and 16 are non-negotiable.

- **New persisted setting:**
  1. Add field to `Settings` in `src/types.ts` + `DEFAULT_SETTINGS`
  2. Add key to `KEY_MAP` in `settingsStore.ts`
  3. Add the same key to `ALLOWED_KEYS` in `src-tauri/src/commands/settings.rs`
     (the backend rejects writes to any key not in this allowlist)
  4. Add UI control in `SettingsDialog.tsx`

- **New dialog:**
  1. Add a variant to `DialogKind` in `uiStore.ts`
  2. Create the component under `components/dialogs/`
  3. Render it in `App.tsx` (it inspects `useUiStore().dialog`)

## Non-goals (reject scope creep)

Not a full git GUI (no hunk-level staging, no interactive rebase, no
merge/cherry-pick UI, no branch creation), not a CI/CD dashboard, not
cross-device sync, not multi-user, not a replacement for Cadency/DevPulse.
A minimal "stage-all + commit + optional push" flow exists (see invariant
#17) — that's the full commit surface, anything finer-grained belongs in
a real git GUI or the terminal. If a request reaches into these areas,
ask before building.

## V2-deferred features

New-commit notifications, repo grouping/tagging, list filter/search,
custom-command whitelist, streaming command output. Don't build these in
MVP even if convenient — they're explicitly deferred in
`project-requirements.md`.

**Already shipped beyond MVP** (the project-requirements.md V2 list is a
point-in-time document; this is the current state):
- System tray (described under "optional" in the spec).
- Run history / action log + one-click undo for `force_pull` — SQLite
  `action_log` table, reflog-based restore. See `git_ops::undo_last_action`
  and the force-pull preview flow.
- Directory-scan import — `commands/scan.rs`, backed by an `ignored_paths`
  table so removed repos don't come back on re-scan. See invariants #13 and
  #14 above.
- Commit & push (opt-in, single-button) — `git_commit_push` command +
  `CommitPushDialog`. Stages all changes, commits with a required message,
  optionally pushes (never `--force`). Logged to `action_log` under action
  `commit_push`. See invariant #17.
- Working-tree file preview — `get_changed_files` command + `RepoChangesPanel`.
  Shown in the expanded row when dirty, capped at 100 files.

## Further reading

- `docs/architecture.md` — data flow, concurrency model, file responsibility map
- `docs/debugging.md` — log locations, DB reset, common issues, dev-loop tricks
- `docs/contributing.md` — how to add a command, component, migration, or parser
- `docs/security.md` — threat model, hardening in place, residual risks, checklist for security-sensitive changes
- `project-requirements.md` — original design spec (kept verbatim as source of truth)
