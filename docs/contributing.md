# Contributing

This project is a single-user internal tool — "contributing" here means "future
Anders or a future Claude Code session extending the app". This doc exists so
those sessions can stay consistent with the existing architecture.

Read [`CLAUDE.md`](../CLAUDE.md) first for the architectural invariants. They
are load-bearing; breaking them generally means reversing a decision baked
into the design spec.

## How to add a new `#[tauri::command]`

Example: add a command that runs `git gc` on a repo.

1. **Helper in `src-tauri/src/git/`**. Put any parsing/decision logic here
   (pure, unit-testable, no Tauri imports). For a trivial op like `gc` you
   might skip this step.

2. **Handler in `src-tauri/src/commands/`**. Pick the right file — in this
   case `git_ops.rs`. Template:
   ```rust
   #[tauri::command]
   pub async fn git_gc(id: i64) -> Result<String, String> {
       let repo = load_repo(id).await?;
       let path = repo.path.clone();
       tokio::task::spawn_blocking(move || {
           let p = Path::new(&path);
           runner::run_git_raw(p, &["gc"])
               .map_err(|e| e.to_string())
               .and_then(|o| {
                   if o.code == 0 {
                       Ok(merge_stdout_stderr(&o))
                   } else {
                       Err(merge_stdout_stderr(&o))
                   }
               })
       })
       .await
       .map_err(|e| e.to_string())?
   }
   ```
   Remember: **never** call `Command::new("git")` directly. Always go through
   `runner::run_git` or `runner::run_git_raw`. `cargo check` will happily let
   you do the wrong thing — it's on you to keep the invariant.

3. **Register in `src-tauri/src/lib.rs`**. Add the fully-qualified path to
   the `tauri::generate_handler!` list.

4. **Typed wrapper in `src/lib/tauri.ts`**:
   ```ts
   export function gitGc(id: number): Promise<string> {
     return invoke("git_gc", { id });
   }
   ```

5. **Use in a store or component**. Don't add a second `invoke()` import
   somewhere else — `lib/tauri.ts` is the only place.

6. **Smoke test**: `npm run tauri dev`, register a repo, click the button,
   watch the terminal for the Rust-side output if anything fails.

7. **If the command is destructive** (mutates the working tree, discards
   commits, rewrites refs): stop and read `docs/safety-model.md` before
   you write the handler. At minimum you must (a) backend guard on repo
   state, (b) capture pre-HEAD via `status::current_head_sha`, (c) log
   to `action_log` via `log_action`, (d) preview command that shows what
   will be lost, (e) checkbox-dialog consent on the frontend, (f) clear
   recovery path (reflog, undo, or worse). Invariants 15 and 16 in
   CLAUDE.md will be enforced in review.

## How to add a DB migration

Schema changes never edit past migrations. Append a new entry.

1. Open `src-tauri/src/db/schema.rs`.
2. Add to the `MIGRATIONS` array:
   ```rust
   const MIGRATIONS: &[(&str, &str)] = &[
       ("001_init", r#"..."#),
       ("002_add_tags", r#"
           ALTER TABLE repos ADD COLUMN tags TEXT NOT NULL DEFAULT '';
       "#),
   ];
   ```
3. Name format: `NNN_snake_case_description` — three-digit index for stable
   ordering, short description. The migration runner records each name in
   `schema_migrations` on first apply and skips it on subsequent runs.
4. **Never** reuse a name or change the SQL of an already-applied migration.
   If you need to fix a bad migration, append a corrective one.
5. If the new table stores a filesystem path, store it **normalized** (run
   values through `util::normalize_path` before INSERT/UPDATE). Every
   existing path column in the schema (`repos.path`, `ignored_paths.path`)
   follows this rule and dedup logic assumes it. See invariants #13 / #14
   in `CLAUDE.md`.

## How to add a new persisted setting

Settings are free-form key/value strings in SQLite. No schema change needed —
just a convention in `settingsStore.ts`.

1. **TS type** — add a field to `Settings` in `src/types.ts` and to
   `DEFAULT_SETTINGS`.
2. **Key mapping** — add an entry to `KEY_MAP` in
   `src/stores/settingsStore.ts`. Convention: snake_case key on disk,
   camelCase in the TS store.
3. **Parse on load** — extend `hydrate()` if the new field needs typed parsing
   (numbers, enums). String fields need nothing extra.
4. **UI control** — add an input/select to `SettingsDialog.tsx`.
5. **Consume it** — subscribe with `useSettingsStore((s) => s.settings.yourField)`.

## How to add a new dialog

1. **Dialog descriptor** — add a variant to `DialogKind` in `uiStore.ts`:
   ```ts
   | { kind: "bulkProgress"; total: number; done: number }
   ```
2. **Component** under `src/components/dialogs/`. Use the `Dialog` primitive.
   Template:
   ```tsx
   import { useUiStore } from "../../stores/uiStore";
   import { Dialog } from "../ui/Dialog";

   export function BulkProgressDialog() {
     const dialog = useUiStore((s) => s.dialog);
     const close = useUiStore((s) => s.closeDialog);
     const open = dialog?.kind === "bulkProgress";
     return (
       <Dialog open={open} onClose={close} title="Working…">
         {open && (<>{dialog.done} / {dialog.total}</>)}
       </Dialog>
     );
   }
   ```
3. **Render in `App.tsx`** alongside the other dialogs. It re-renders based on
   `uiStore.dialog`, so it's cheap when not open.
4. **Open it** from wherever: `useUiStore.getState().openDialog({ kind: "bulkProgress", total, done: 0 })`.

## How to add a new repo status pill

1. Compute the new field in `commands/status.rs::build_status` (backend). Add
   the field to `RepoStatus` in both `models.rs` and `src/types.ts`.
2. If the field requires parsing, put pure parsers under `src-tauri/src/git/`
   and write unit tests.
3. Add a `<Pill>` to `RepoRow.tsx`. Use the existing tones
   (neutral/green/yellow/red/blue) — adding a sixth tone means editing
   `Pill.tsx`.

## How to add a parser test

Rust unit tests live in the same file as the code, in a `#[cfg(test)] mod
tests`. See `src-tauri/src/git/remote.rs` for the pattern.

- Parsers must be pure functions — no `Command` calls, no disk access.
- Name tests descriptively: `github_ssh`, `azure_ssh_v3`, not `test1`.
- Run: `cd src-tauri && cargo test --lib`.

For the status porcelain parser, capturing real porcelain bytes into a
test string would be valuable — currently only documented, not tested, see
the `#[cfg(test)] mod tests` block in `git/status.rs` for the list of cases
to cover if you add actual tests.

## Git commit style

The repo currently has no commit history (scaffold was done in one push).
If you start pushing commits, suggested conventions:

- Subject line ≤72 chars, imperative mood (`"Add tag filter"` not `"Added"`).
- Reference the spec or issue if applicable (`"Implement open_commit url"` is
  fine without a ticket since there isn't one).
- For multi-change PRs, prefer 3-5 focused commits over one megacommit — the
  architect review is much easier when each logical change is separable.

## Running the architect review

The project was audited once against `CLAUDE.md`'s invariants. Re-run on
large changes:

1. `cd src-tauri && cargo check` (must pass).
2. `npm run build` (must pass).
3. Grep for invariant violations manually:
   ```bash
   # Should find exactly one hit, in git/runner.rs:
   rg 'Command::new\("git"\)' src-tauri/src
   # Should find exactly one hit, in src/lib/tauri.ts:
   rg 'from "@tauri-apps/api/core"' src
   rg 'invoke\(' src --type ts
   ```
4. Check the command list in `src-tauri/src/lib.rs` matches the spec's "Backend
   Command Surface" section in `project-requirements.md` (plus `set_tray_tooltip`
   for the tray feature).

## V2 features worth planning for

These are explicitly deferred but the architecture accommodates them:

- **New-commit notifications**: diff the last-seen SHA per branch in
  `get_all_statuses`, emit a Tauri event when a new one appears, surface a
  toast or Windows balloon notification.
- **Grouping/tagging**: `tags TEXT` column on `repos`, filter UI above the
  list, tag chips on each row.
- **Filter/search**: a text input in Sidebar that sets a `filter` in
  `uiStore`; `RepoList` filters before rendering.
- **Custom git command whitelist**: extend the command surface by one
  `run_whitelisted_git(id, preset_name)` that maps preset names (defined in
  settings) to arg lists. Preserves the "no arbitrary shell from the
  frontend" invariant.

**Already shipped beyond the original MVP:**

- **Run history log** — `action_log` table (migration 003), populated by
  destructive ops in `git_ops.rs`. Exposed via `get_action_log` +
  `undo_last_action` (reflog-based restore for `force_pull`).
- **Directory-scan import** — `commands/scan.rs` +  `ignored_paths` table
  (migration 002). `scan_folder` lists direct children that are git
  working trees and annotates each with `alreadyAdded` / `ignored` so the
  dialog can render the right checkbox state. The ignore list is set-based
  suppression: re-running the scan never re-proposes a path the user
  dismissed until it's explicitly un-ignored. This is the contract if you
  build a scheduled re-scan later — do NOT bypass the ignore-list check
  when adding.

## Path handling: use `normalize_path` everywhere

Any code that compares or stores a repo path MUST go through
`util::normalize_path`. The function lives in `src-tauri/src/util.rs` with
its own unit tests. If you're introducing a new surface that takes a path
from the frontend or filesystem, think about:

1. Did you normalize before INSERT / UPDATE?
2. Did you normalize the right-hand side of any equality check?
3. Existing rows in `repos.path` / `ignored_paths.path` may predate
   normalization — use `find_repo_by_normalized_path` (normalize both sides)
   rather than the raw SQLite UNIQUE index for correctness.

The test suite in `util.rs::tests` is split: `#[cfg(all(test, windows))]`
covers drive-letter case, backslash style, collapsed doubles, UNC prefix;
`#[cfg(all(test, not(windows)))]` covers double-slash collapse, trailing
slash handling, case preservation. Both cover whitespace trim and
idempotency. Extend the right module when you add a new edge case. Only
the tests for the current build target run under `cargo test --lib`.
