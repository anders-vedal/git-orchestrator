# Repo Dashboard

A local desktop app for monitoring and syncing many git repositories from one
always-on window. Instead of opening each repo in Git Bash and running `git
status` / `git fetch` / `git pull`, you see every registered repo in one
dashboard with live status and one-click actions.

Built with Tauri 2 + Rust + React 19 + TypeScript. Shells out to the system
`git` CLI (not `git2`/libgit2) so behaviour matches your terminal exactly.

## Screenshots

_(Not included in the repo. Run the app to see it.)_

## Features

- **Per-repo status** — current branch, default branch, ahead/behind counts,
  dirty state (clean/unstaged/staged/untracked/mixed), last fetch time, latest
  commit (SHA/message/author/time), remote URL.
- **Per-repo actions** — Fetch, Pull (ff-only), Force pull (guarded), Open
  folder, Open terminal, Open remote, Open commit, Expand last-10-commits log.
- **Bulk actions** — Fetch all in parallel, Pull all safe (only clean repos on
  default branch), Refresh all.
- **Drag-drop reorder**, inline rename, remove-from-dashboard.
- **Auto-refresh** every N minutes (configurable), with manual refresh available
  at any time.
- **System tray** — minimise-to-tray on close, right-click menu with Show
  Window / Fetch All / Quit, tooltip shows live status summary (behind/dirty/
  error counts).
- **Settings** — terminal preference (platform-aware: wt/git-bash/cmd on Windows,
  Terminal/iTerm2 on macOS, gnome-terminal/konsole/alacritty/kitty/xterm on
  Linux), auto-refresh interval, default browse directory, theme (dark/light/
  system).

## Supported platforms

Primary target is Windows 11 (x64 + ARM64). macOS and Linux builds run via
`npm run tauri dev` / `npm run tauri build` but are **dev-quality**: no signed
installers, no CI matrix. See the build prerequisites below.

## Quick start

```bash
npm install
npm run tauri dev             # hot-reload dev (frontend + Rust)
npm run tauri build           # platform-native installer under src-tauri/target/release/bundle/
```

Build output per host:
- **Windows** → `.msi` (MSI) + `.exe` (NSIS) under `bundle/{msi,nsis}/`
- **macOS** → `.dmg` + `.app` under `bundle/{dmg,macos}/` (unsigned — new installs
  need `xattr -cr "Repo Dashboard.app"` before first launch)
- **Linux** → `.deb` + `.AppImage` (+ `.rpm` where toolchain supports it) under
  `bundle/{deb,appimage,rpm}/`

### Prerequisites

| OS | Toolchain |
|---|---|
| Windows | Node 20+, Rust stable, MSVC Build Tools, WebView2 (preinstalled on Win11) |
| macOS | Node 20+, Rust stable, `xcode-select --install` |
| Linux (Ubuntu/Debian) | Node 20+, Rust stable, plus apt deps (next line) |

Debian/Ubuntu apt deps:
```
sudo apt install libwebkit2gtk-4.1-dev libsoup-3.0-dev \
                 libayatana-appindicator3-dev build-essential \
                 curl wget file libssl-dev libxdo-dev pkg-config
```
Fedora/Arch equivalents are listed in the
[Tauri prerequisites page](https://v2.tauri.app/start/prerequisites/).

**Linux tray caveat**: GNOME 40+ removed native status-tray support. The tray
icon works out of the box on KDE, XFCE, Cinnamon, and MATE. On GNOME you need
the AppIndicator extension installed.

Rust tests:
```bash
cd src-tauri && cargo test --lib
```

## Project layout

| Path | Purpose |
|---|---|
| `src-tauri/src/lib.rs` | Tauri builder — plugins, tray, window events, command handler registration |
| `src-tauri/src/commands/` | `#[tauri::command]` handlers — one file per domain |
| `src-tauri/src/git/` | Pure git parsers (porcelain, log, remote URL) + the single `Command::new("git")` |
| `src-tauri/src/db/` | SQLite schema + migrations + queries (rusqlite, bundled) |
| `src-tauri/src/tray.rs` | Tray icon, menu, tooltip, close-to-tray |
| `src/lib/tauri.ts` | Single typed IPC wrapper — the only place `invoke` is imported |
| `src/stores/` | Zustand stores (repos, settings, ui) |
| `src/components/` | React UI — Sidebar, RepoList, RepoRow, RepoActions, RepoLogPanel, dialogs |

See [`CLAUDE.md`](./CLAUDE.md) for architectural invariants and [`docs/`](./docs/)
for deeper architecture notes and debugging guides.

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) — architectural invariants, build commands, code layout
- [`docs/architecture.md`](./docs/architecture.md) — data flow, concurrency model, file responsibility map
- [`docs/debugging.md`](./docs/debugging.md) — log locations, DB reset, troubleshooting
- [`docs/contributing.md`](./docs/contributing.md) — how to add a command, component, migration, or parser
- [`project-requirements.md`](./project-requirements.md) — original design spec

## License

MIT — see [`LICENSE`](./LICENSE).
