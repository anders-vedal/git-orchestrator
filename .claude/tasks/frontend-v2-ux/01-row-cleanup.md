# Phase 1: Row cleanup — consolidated pill, collapsed chrome, kebab overflow

**Status:** Planned
**Priority:** High
**Type:** feature
**Apps:** repo-dashboard
**Effort:** medium
**Parent:** frontend-v2-ux/00-overview.md

## Scope

Rewrite `RepoRow.tsx` + `RepoActions.tsx` to collapse the per-row action strip
from ~11 icons (two `|` dividers) down to **3 primary icons + kebab (`⋯`) +
expand chevron (`▾`)**, and consolidate the pill row from up to 6–7 chips
down to **branch pill + one state pill + optional submodules/error badge**.

No contextual-primary logic yet — that's Phase 3. This phase keeps the
primary three as a fixed triplet (Fetch, Pull, Commit&push) so the row
structure is stable for Phase 3 to build on.

## Target row anatomy (end of Phase 1)

```
☐ ⋮⋮  claros  (main)  3 behind                     [F] [P] [C]  ⋯  ▾
      Anders · fix(auth): sanitize email · 3m ago
```

- Path line **removed** from default rendering → folded into tooltip on the
  name + shown in the expanded panel.
- "Last fetch … refreshed …" line **removed** → tooltip on the state pill +
  shown in expanded panel.
- Drag handle (`⋮⋮`) hidden (not just disabled) whenever sort ≠ manual or
  filter/selection active. `dragDisabled` prop already carries this info.

## Checklist

### Pill consolidation (`RepoRow.tsx`)

- [ ] Replace the separate dirty pill + ahead/behind pill + diverged pill +
  no-upstream pill + unpushed pill with **one `statePill` helper** that
  returns a single `Pill` based on combined state:
  - `diverged` → red, "diverged ↑N ↓N"
  - `dirty` (any of untracked/unstaged/staged/mixed) + behind → amber,
    "dirty · N behind"
  - `dirty` + ahead → amber, "dirty · N ahead"
  - `dirty` alone → amber, "dirty"
  - `behind` → blue, "N behind"
  - `ahead` → blue, "↑N"
  - `no upstream` + unpushed → yellow, "N unpushed"
  - `no upstream` alone → neutral, "no upstream"
  - `clean + up to date` → zinc, "up to date" (subtle — do NOT render as a
    loud success pill; the absence of warning pills is itself the signal)
- [ ] Preserve the existing detailed tooltips from `DIRTY_TOOLTIPS` +
  ahead/behind titles inside the consolidated pill's `title=`.
- [ ] Move `submodules` pill to an icon-only badge (`Boxes` size 12) after
  the state pill, no text, tooltip only.
- [ ] Keep the `error` pill as-is (red with icon + truncated message) but
  visually de-prioritize by placing it last.

### Branch pill cleanup (`RepoRow.tsx`)

- [ ] Drop the separate "switch to default" pill that renders when
  `!onDefault`. The existing branch pill already opens the branch picker —
  add a pinned "Switch to `<defaultBranch>`" row at the top of
  `BranchPickerDialog` (Phase 1 does NOT rewrite the picker; pinning the
  row is a 3-line dialog change).
- [ ] Branch pill keeps its current off-default warning styling (amber
  border) so the "you're off main" signal stays unmissable without the
  extra chip.
- [ ] Remove the `switchingToDefault` state + `switchToDefault()` function
  from `RepoRow.tsx` — the work moves into the branch picker's existing
  checkout flow.

### Chrome collapse (`RepoRow.tsx`)

- [ ] Remove the `<div>` rendering `{status.path}` from the default row
  body; add `title={status.path}` to the repo name button instead.
- [ ] Remove the "Last fetch … refreshed …" `<div>` from the default row
  body; move both timestamps into the expanded panel (new small footer row
  above `RepoLogPanel`).
- [ ] Keep the `latestCommit` line — it's the one piece of ambient
  information agents agreed is worth the row-height cost. Leave unchanged.
- [ ] Hide the drag handle entirely (not just `disabled`) when
  `dragDisabled === true`. Current code greys it to 40% opacity — replace
  with `dragDisabled ? null : <button …>`. The left-edge spacing can stay
  so row alignment doesn't shift.

### Action strip collapse (`RepoActions.tsx`)

- [ ] Keep as always-visible: **Fetch**, **Pull**, **Commit & push**,
  kebab (`⋯`), expand chevron (`▾`).
- [ ] **Move into the kebab**: Force pull, Open folder, Open terminal,
  Open remote, Claude Code shortcut(s). Kebab renders as a dropdown menu
  with grouped sections:
  - **Open** — Folder · Terminal · Remote · Claude Code ▸ (submenu iff
    multiple `cliActions` configured; single action stays a direct item)
  - **Danger** — Force pull (bottom of menu, `tone="danger"` styling,
    disabled off-default with explanatory tooltip)
- [ ] Remove both `|` dividers from the action strip.
- [ ] `tone="primary"` demoted on Commit&push in the fixed triplet — keep
  exactly one primary (Pull) until Phase 3 introduces contextual
  promotion. Fetch and Commit&push render as standard icon buttons.
- [ ] Commit&push icon stays disabled when `!hasChanges` (existing logic).

### Move per-row Refresh / Rename / Remove into the kebab

- [ ] Delete the right-side "second strip" of IconButtons (Refresh, Rename,
  Delete) from `RepoRow.tsx`.
- [ ] Add them to the kebab menu (from `RepoActions.tsx`) under a third
  section:
  - **Manage** — Refresh status · Rename · (separator) · Remove from
    dashboard (bottom, `tone="danger"` styling)
- [ ] Renaming still triggered by clicking the name (existing behavior
  stays — it's the fastest path for a rare action).
- [ ] Removing still routes through `RemoveRepoDialog` (invariant #14).

### Kebab menu component

- [ ] Extend the existing `cliActions` dropdown pattern in `RepoActions.tsx`
  to host the full grouped menu. Alternatively extract to a new
  `RepoKebabMenu.tsx` if `RepoActions.tsx` balloons past ~350 lines.
- [ ] Keyboard: `Esc` closes (already wired for the current sparkles
  dropdown), outside-click closes. Don't worry about full arrow-key menu
  nav — Phase 4 handles that as part of the keyboard layer.

### Expanded panel

- [ ] Add a small "Metadata" footer block above `RepoLogPanel` showing:
  path, last fetch, refreshed-at. Low-contrast text, one line if it fits.
- [ ] `RepoChangesPanel` and `RepoLogPanel` themselves unchanged.

## Testing

- [ ] Manually verify each row state renders the correct consolidated
  pill: clean+uptodate, clean+behind, dirty+clean-remote, dirty+behind,
  diverged, no-upstream+unpushed, no-upstream+zero-unpushed.
- [ ] Verify the kebab menu opens/closes with click-outside + Esc.
- [ ] Verify Force pull in kebab is disabled off-default with the existing
  "only allowed on default branch" tooltip (invariant #4 intact).
- [ ] Verify Remove from dashboard still opens `RemoveRepoDialog` with the
  "also ignore this folder" checkbox (invariant #14 intact).
- [ ] With 15+ repos added, confirm rows feel quieter — no regressions in
  functionality, but the visual noise drop should be obvious.

## Files touched

- `src/components/RepoRow.tsx` (major rewrite — pill consolidation, chrome collapse, remove second icon strip)
- `src/components/RepoActions.tsx` (major rewrite — kebab menu with 3 sections, demote Commit&push tone)
- `src/components/dialogs/BranchPickerDialog.tsx` (small — add pinned "Switch to default" row)
- `src/components/RepoLogPanel.tsx` or new expanded-panel footer (small — show path + timestamps)
- Possibly `src/components/RepoKebabMenu.tsx` (new, iff extraction warranted)

## Out of scope (explicitly deferred)

- Contextual primary button that adapts to row state → Phase 3
- Keyboard shortcuts for row actions → Phase 4
- Attention-based sort + clean-row dimming → Phase 5
- Sidebar changes → Phase 2 (independent, runs in parallel)
