# Security

This document captures the threat model, the protections the app implements,
and the residual risks a reviewer or future contributor should understand
before changing security-sensitive code.

## Threat model

Repo Dashboard is a **single-user Windows desktop app**. It has no network
server, no multi-tenant boundary, and no remote control surface. The
interesting trust boundaries are:

| Boundary | Trusted side | Untrusted side |
|---|---|---|
| IPC (webview ↔ Rust backend) | Rust handlers | Webview renderer |
| Git invocation (app ↔ `git` CLI) | The app's args | The repo's `.git/config` and working tree |
| URL opening (app ↔ OS default handler) | The opener plugin | URLs derived from git remote strings |
| Filesystem | `%APPDATA%\RepoDashboard\*` | Paths the user adds to the dashboard |

The realistic attacker scenarios are:

1. **Hostile watched repo.** A repo the user has added contains a
   `.git/config` crafted to execute arbitrary code the next time the app
   polls it (auto-refresh runs every 60s by default across every repo).
2. **Compromised webview.** A dependency vulnerability or future refactor
   introduces an XSS sink; the renderer then tries to reach across the IPC
   boundary to call backend commands with adversarial arguments.
3. **Hostile remote URL.** A repo's `origin` URL is crafted to open something
   non-HTTPS or execute a browser-level exploit when the user clicks "Open
   remote".
4. **Path injection.** The user is tricked into adding a path that, when
   interpolated into a shell command, runs attacker code.

## What's protected, and how

### IPC surface is fixed and typed

All frontend → backend communication goes through a small set of
`#[tauri::command]` handlers registered in `src-tauri/src/lib.rs`. The
frontend is **forbidden** from importing `invoke` anywhere except
`src/lib/tauri.ts`; that file is the single typed wrapper. A compromised
renderer can only call these named commands with their declared argument
shapes — there is no arbitrary-shell primitive.

### Single git entry point

Every call to the `git` CLI funnels through
`src-tauri/src/git/runner.rs::build_command`. There is exactly **one**
`Command::new("git")` in the whole codebase; a CI-like grep is the
enforcement mechanism. New git helpers add functions in `src/git/`, they do
not spawn processes.

### Git config hardening (H1 mitigation)

Every git invocation is prefixed with:

```
git -c core.fsmonitor= -c protocol.ext.allow=never -C <repo> <subcommand>
```

- **`core.fsmonitor=`** — neutralises a hostile repo's ability to name a
  binary that `git status` / index refresh would run on every poll tick.
  Empty string disables the fsmonitor hook for this invocation only.
- **`protocol.ext.allow=never`** — blocks `ext::<cmd>` remote helpers
  during fetch/pull (CVE-2017-1000117 class). A malicious origin URL
  shaped like `ext::sh attacker-script` cannot spawn a subprocess.

These are per-invocation `-c` flags, so the user's own `git` in a terminal
is unaffected. See `HARDENING_FLAGS` in `runner.rs`.

**What is NOT hardened here (residual risks):**

- **`core.sshCommand` / `GIT_SSH_COMMAND`.** A hostile `.git/config` can
  redirect SSH during fetch to any binary. We don't override it because
  users legitimately set it in their global config to point at custom SSH
  keys or wrappers, and overriding to empty would break their workflow.
  **Mitigation is user-side**: only add repos from sources you trust; if
  in doubt, `cat .git/config` first.
- **Git aliases (`alias.<cmd> = !...`)** in `.git/config`. A per-repo
  alias like `alias.status = !calc` would execute `calc` every time the
  app runs `git status`. Git has no simple "ignore aliases" flag;
  overriding every possible alias key is impractical. Again, **trust the
  repos you add**.
- **`core.hooksPath`, hook scripts in `.git/hooks/`.** Our read-only
  operations (`status`, `log`, `rev-parse`, `symbolic-ref`, `show-ref`,
  `rev-list`) don't trigger hooks. `fetch` and `pull --ff-only` don't run
  merge hooks in our code paths. `reset --hard` does not run hooks. So
  hooks are not a practical vector for our current command set, but a
  future feature that adds `commit`, `merge`, `rebase`, or `checkout` would
  need to revisit this — at that point, set `-c core.hooksPath=/dev/null`
  for those calls too.

### Argument-injection safety

Git subcommands are always passed as separate argv entries via
`Command::arg` — Rust builds the command line via `CreateProcess`, never
a shell. There is no shell interpolation of user input into git args.
Variable interpolation into git args is narrow:

- `reset_target = format!("origin/{default}")` in `commands/git_ops.rs`,
  where `default` comes from `default_branch()` which reads git's own
  output. Branch/ref names cannot start with `-`, cannot contain spaces,
  colons, or control chars, so the resulting string cannot be confused for
  a flag.
- `-n{count}` in `git/log.rs` where `count: u32` is a number.
- `refs/heads/{candidate}` in `git/status.rs` where `candidate` is
  hardcoded to `"main"` or `"master"`.

### URL opening is allowlisted twice

"Open remote" and "Open commit" construct URLs from git remote strings.
Both commands enforce the scheme via
`commands/system.rs::ensure_http_https` before calling the opener plugin,
and `capabilities/default.json` further restricts the opener plugin to
`http://**` and `https://**` patterns. The URL is built by
`git/remote.rs::to_web_url`, which always emits an `https://` prefix
regardless of the input shape — so even a pathological remote can't
produce a `javascript:` or `file:` URL.

### Content Security Policy (M1 mitigation)

`tauri.conf.json` sets a restrictive CSP on the webview:

```
default-src 'self' ipc: http://ipc.localhost;
style-src 'self' 'unsafe-inline';
img-src 'self' data: asset: http://asset.localhost;
font-src 'self' data:;
connect-src 'self' ipc: http://ipc.localhost
```

The app never talks to remote origins over `fetch`/`XHR` — all data comes
through Tauri IPC — so there is no legitimate need for external
`connect-src` or `script-src`. `style-src 'unsafe-inline'` exists because
Tailwind and dnd-kit inject inline styles. If a future XSS ever lands,
CSP restricts the blast radius: no remote script fetches, no external
exfiltration endpoints.

### UNC / network-path rejection (M3 mitigation, Windows only)

Under `#[cfg(windows)]`, `commands/repos.rs::canonical` rejects paths that
begin with `\\` or `//` before they reach the filesystem or git. A user
who really needs a network-hosted repo must mount it to a drive letter
first — this forces the attack surface through the OS's credential
prompting and share-ACL path rather than through silent SMB lookups
triggered by `git -C \\server\share status` running on the refresh
timer.

On mac/linux the check is a no-op: `/` is the normal filesystem root,
and network mounts (`/Volumes/...`, `/mnt/...`, autofs) surface as local
paths indistinguishable from internal disks. The analogous attack
requires the user to have already mounted an attacker-controlled share,
which we don't try to detect here.

### cmd.exe path filter (M2 mitigation)

The auto/cmd terminal launcher builds a `cmd /K "cd /d \"<path>\""`
command string. Windows filesystem rules forbid `"` in paths, so the
quotes cannot be broken, but `%VAR%`, `^`, and `!` in a directory name
would still be interpreted by cmd. `launch_cmd` in `commands/system.rs`
rejects paths containing any of those and tells the user to pick Windows
Terminal or Git Bash instead (both pass the path as a proper argv entry
via Rust's `Command::arg`, not as a composed command string).

### Force-pull is guarded twice

`git_force_pull` refuses at the backend when the current branch isn't the
default branch, **and** the frontend `ForcePullDialog` requires an
explicit acknowledgement checkbox every time — no "don't ask again"
affordance.

### SQL parameterisation

Every query in `db/queries.rs` uses positional `params![...]` — no string
concatenation into SQL. The SQLite database itself lives in
`%APPDATA%\RepoDashboard\` which is per-user with standard Windows ACLs.

### Settings allowlist (L3 mitigation)

`commands/settings.rs::ALLOWED_KEYS` pins the set of keys the frontend
may read or write. A compromised renderer cannot write arbitrary blobs
into the settings table — only the four known keys (`terminal`,
`refresh_interval_sec`, `default_repos_dir`, `theme`) pass through. Must
be kept in sync with `KEY_MAP` in `src/stores/settingsStore.ts`.

### Repository path validation

`add_repo` calls `is_git_repo` after `canonical` — we confirm the path is
a real filesystem location AND that `git rev-parse --is-inside-work-tree`
returns `true` before storing it. This filters out random directories,
bare repos, and non-filesystem virtual paths (`shell:`, etc.) since those
fail the `exists()` check. The path is then normalized via
`util::normalize_path` so dedup can't be bypassed with case/slash variants.

### Scan / bulk-add preserve the same gates

`commands/scan.rs::scan_folder` runs the parent folder through the same
`canonical()` (UNC rejection + `exists()` check), then lists only direct
children via `std::fs::read_dir`. The candidate list is prefiltered to
paths whose `join(".git")` exists — a cheap check that avoids spawning
`git rev-parse` on every single subfolder — then each surviving path is
confirmed with `is_git_repo()` before being returned to the frontend. The
bulk-add path (`add_scanned_repos`) re-runs `canonical()` + `is_git_repo()`
+ the ignore-list check + dedup per path on the Rust side, so a
compromised renderer can't skip validation by hand-crafting the `paths[]`
argument. `scan_folder` also refuses to return more than 500 candidates
per call, so a pathological folder can't be used to exhaust frontend memory.

## Frontend

React escapes all text interpolation by default. The codebase does not
use `dangerouslySetInnerHTML`, `eval`, `new Function`, `innerHTML`, or
`document.write` — a grep for each returns zero matches in `src/`.

Commit messages, branch names, author names, and repo paths all flow
into the DOM as text children, never as HTML. If that ever changes, the
CSP above becomes the last line of defence.

## Residual risks — what we accept

The following are documented accepted risks:

1. **Hostile `.git/config` via `core.sshCommand` or aliases.** Mitigated
   only by user trust in the repos they add. Document in the README;
   consider surfacing a warning when adding a repo whose `.git/config`
   sets `core.sshCommand`, `alias.*`, or `core.hooksPath` (feature for a
   future hardening pass).
2. **PATH hijack of `git`, `wt.exe`, `cmd`, `explorer`.** Standard Windows
   issue, not specific to this app. If an attacker already has user-level
   write to a `PATH` entry ahead of `System32`, they've already won.
3. **Dependency vulnerabilities.** Run `cargo audit` and `npm audit`
   periodically. No automated gate is configured today.
4. **Memory DoS via `-n<count>` in `git_log`.** The frontend can request
   an arbitrarily large commit count. Git happily streams it back and the
   Rust side holds it all in a `String`. Not a security boundary issue
   (single-user app) but a cap around 10,000 commits would be wise.

## Checklist when touching security-sensitive code

- **Adding a new git call?** It goes through `runner::run_git` /
  `run_git_raw`. Don't `Command::new("git")` directly.
- **Adding a new Tauri command?** Register it in `lib.rs`, add the typed
  wrapper in `src/lib/tauri.ts`. If it takes a path, validate it through
  `canonical` AND normalize it via `util::normalize_path` before storing
  or comparing. If it takes a URL, validate the scheme.
- **Adding a bulk path-taking command?** Re-run the same per-path
  validation on the Rust side — don't trust the frontend filtered the list.
  See `commands/scan.rs::try_add_one` for the pattern (canonical → is_git_repo
  → ignore-list check → dedup check → insert).
- **Adding a new setting?** Add the key to `ALLOWED_KEYS` in
  `settings.rs` AND to `KEY_MAP` in `settingsStore.ts`.
- **Adding a new git subcommand that can run hooks** (`commit`, `merge`,
  `rebase`, `checkout`)? Add `-c core.hooksPath=/dev/null` to that call
  path, or expand `HARDENING_FLAGS`.
- **Rendering untrusted strings?** React escaping handles text children.
  Don't pass attacker-controlled strings into `dangerouslySetInnerHTML`,
  `href`, `src`, or `style` without sanitising first.
