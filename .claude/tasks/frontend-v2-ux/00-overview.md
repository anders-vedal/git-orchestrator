# Frontend v2 UX redesign

**Status:** Planned
**Priority:** High
**Type:** feature
**Apps:** repo-dashboard
**Effort:** large

## Overview

The current frontpage carries UX debt that shows up as soon as the dashboard
holds 10+ repos: every row exposes ~11 icon buttons split by two `|` dividers,
three `tone="primary"` buttons fight for attention, and the sidebar offers 8
top-level actions when two do 80% of the work. Header pills (branch + default
switch + dirty + ahead/behind + diverged + no-upstream + submodules + error)
stack up to 6–7 chips per row, competing with the repo name for the eye. Three
lines of chrome per row (path, latest commit, last-fetch/refreshed) make 15
repos feel like 150.

This epic restructures the frontend around a clean action taxonomy —
**primary verbs on the row, secondary behind a kebab, fleet ops in a slim
sidebar, rare ops in a command palette** — and adds the keyboard layer the
app has been missing so it can actually beat the CLI for fleet-level work.

## Background

Synthesized from four parallel UX analyses (designer, non-technical user,
power user, information architect) on 2026-04-20. All four converged on the
same diagnosis and a compatible action taxonomy:

| Tier | Where | Contents |
|---|---|---|
| **T1 Status** | Row header, always visible | branch pill (consolidated), one merged state pill, single-line latest commit |
| **T2 Primary verbs** | Row right-side, 1-click | Fetch · Pull · Commit&push · ⋯ · ▾ |
| **T3 Per-repo overflow** | `⋯` kebab menu | Open {folder, terminal, remote, Claude}; Force pull; Diagnose auth; Undo; Rename; Remove |
| **T4 Fleet** | Sidebar, always visible | Workspace · Add repo · Fetch all · Pull all · "More…" |
| **T5 Admin / palette** | `Ctrl+K` palette + "More…" menu | Scan, Activity feed, Stash dirty, Stash bundles, Refresh all, Manage workspaces, Settings, Check for updates |

Core decisions locked in by the analysis:

- **Contextual primary button** — the first row-level button adapts to row
  state: clean+behind → Pull, dirty → Commit&push, diverged → Open terminal,
  clean+off-default → Switch to main. Force pull never promotes to primary.
- **Consolidated state pill** replaces dirty/ahead-behind/diverged/no-upstream:
  zinc (clean+uptodate), blue (behind), amber (dirty), red (diverged).
- **Row defaults to 2 lines** — path and last-fetch/refreshed move to tooltip
  + expand panel. Drag handle hides when sort ≠ manual or filter/selection
  active (already disabled logic-wise).
- **Sidebar collapses** from 8 buttons to 3 + "More…" menu. Auto-refresh
  card shrinks to a one-line footer badge.
- **Keyboard layer** — `Ctrl+K` palette, `j/k` row focus, `f/p/c/t/o/r/.` per
  focused row, `Shift+F` / `Shift+P` bulk. Gated by existing `!isTyping`
  check in `RepoList.tsx`.
- **Attention sort + dimming** — default sort diverged→behind→dirty→clean;
  clean+up-to-date rows rendered at 60% opacity so the eye lands on
  yellow/red instantly.

## Non-negotiables

These CLAUDE.md invariants must not regress:

- **#4** — Force pull double guard: kebab entry still disabled off-default;
  `ForcePullDialog` acknowledgement checkbox every time; never "don't ask
  again"; never promoted to primary.
- **#15** — Action-log capture for destructive ops: moving force-pull into
  the kebab changes nothing about the pre-HEAD → reset → log contract.
- **#17** — Commit & push disclosure: primary button still routes through
  `CommitPushDialog` with file preview + exact commands; never a silent
  keybind-fires-commit flow.
- **#14** — `RemoveRepoDialog` with the "also ignore this folder" checkbox
  stays mandatory.
- **#2** — Frontend → Tauri boundary: `src/lib/tauri.ts` remains the only
  caller of `invoke`; new keybindings must not reach past this wrapper.

## Naming cleanup

| Current | v2 |
|---|---|
| Scan folder… | Import from folder… |
| Pull all (safe) | Pull all (the "(safe)" label misleads users into thinking per-row Pull is unsafe) |
| Stash dirty | Stash all changes… |
| Clear active (workspace) | Exit workspace |
| CLI actions (settings) | Claude Code shortcuts |

Keep: force pull, diverged, ahead/behind, unstaged, staged, untracked,
mixed, no upstream — all standard git vocab with solid tooltips already.

## Phases

- [ ] Phase 1: Row cleanup — consolidated pill, collapsed chrome, kebab overflow → `frontend-v2-ux/01-row-cleanup.md`
- [ ] Phase 2: Sidebar collapse — 3 primary + "More…" menu, footer auto-refresh → `frontend-v2-ux/02-sidebar-collapse.md`
- [ ] Phase 3: Contextual primary button — state-aware first row button → `frontend-v2-ux/03-contextual-primary.md`
- [ ] Phase 4: Keyboard layer + command palette — focus model, `Ctrl+K`, row keymap → `frontend-v2-ux/04-keyboard-palette.md`
- [ ] Phase 5: Attention sort + row dimming — sort by urgency, fade clean rows → `frontend-v2-ux/05-attention-sort.md`

Phase 1 is the foundation — everything else builds on the new row anatomy.
Phase 2 is independent of 1 and can run in parallel. Phase 3 depends on 1
(needs the consolidated action strip). Phase 4 depends on 1 + 2 (needs the
kebab + "More…" menu structures to route into). Phase 5 depends on 1 (needs
the cleaned-up row to make dimming legible).

## Acceptance criteria for the epic

- Row button count drops from ~11 per row to 3 + kebab + expand (5 visual
  elements total, one of which is state-contextual).
- Pill count drops from up to 6–7 per row to: branch pill + one consolidated
  state pill + optional submodules/error badge.
- Sidebar top-level buttons drop from 8 to 3 + "More…" menu.
- All existing Tauri invokes still work (no backend changes); `lib/tauri.ts`
  stays the only `invoke` caller.
- All invariants above (#2, #4, #14, #15, #17) verified unchanged.
- Keyboard layer: Ctrl+K opens palette; `j/k` moves row focus; `f/p/c` fire
  on focused row; `/` focuses filter; `Esc` cascades (clear filter → clear
  selection → blur).
- Power-user check: complete "fetch all, scan behind repos, pull selected,
  jump into terminal of one, commit&push from dialog" without touching the
  mouse.
- Non-technical-user check: row at rest shows exactly one mutating primary
  button (or none when clean+uptodate); scary actions (force pull, remove)
  are not reachable without opening a menu.
