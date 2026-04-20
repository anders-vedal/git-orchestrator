# Phase 3: Contextual primary button — state-aware first row button

**Status:** Planned
**Priority:** Medium
**Type:** feature
**Apps:** repo-dashboard
**Effort:** small
**Parent:** frontend-v2-ux/00-overview.md
**Dependencies:** frontend-v2-ux/01-row-cleanup.md

## Scope

Replace the fixed Fetch / Pull / Commit&push triplet from Phase 1 with a
**single contextual primary button** whose label and action adapt to row
state, plus a smaller fallback triplet for non-primary states. The result:
the row has exactly one loud "do the obvious thing" button at any time,
and force pull never earns the primary slot.

## State → primary button mapping

| Row state | Primary button | Secondary row buttons (icon-only) |
|---|---|---|
| Clean + up to date | *(none)* | Fetch · kebab · expand |
| Clean + behind | **Pull** (label text) | Fetch · kebab · expand |
| Clean + off-default | **Switch to `<default>`** | Fetch · Pull · kebab · expand |
| Dirty (any sub-state) | **Commit & push…** | Fetch · kebab · expand |
| Diverged | **Open terminal** | Fetch · kebab · expand |
| No upstream + unpushed | **Push with upstream…** (opens existing CommitPushDialog with branch preselected — or a thin wrapper that runs `git push -u origin <branch>` via a new disclosure dialog; simpler to route through CommitPushDialog's push-only path if feasible) | Fetch · kebab · expand |
| Error state | *(none — row shows the error pill; recovery goes through kebab Diagnose auth)* | Fetch · kebab · expand |

Notes:

- **Primary button carries a label**, not just an icon. It's a full-width
  `<Button>`, not an `<IconButton>`. It anchors the row's intent visually
  and removes one source of "what does this icon mean" friction for
  non-technical users.
- **Fetch stays visible always** (except when a primary action is mid-flight
  — then icon buttons grey out per existing `busy` state). Fetch is cheap,
  safe, and frequent enough to keep 1-click.
- **Force pull never appears as primary**, even for diverged+dirty states.
  Diverged routes to Open terminal because the app deliberately doesn't
  auto-resolve divergence.
- **Commit&push disclosure preserved** (invariant #17) — the primary
  button on dirty rows still opens `CommitPushDialog` with the full file
  preview + exact commands.

## Checklist

### State → action resolver

- [ ] Add a pure helper `resolvePrimaryAction(status: RepoStatus):
  PrimaryAction | null` in `RepoActions.tsx` (or extract to
  `src/lib/repoActions.ts` if it grows past ~40 lines).
- [ ] `PrimaryAction` is a discriminated union of `{ kind: "pull" | "commit"
  | "switchDefault" | "openTerminal" | "pushWithUpstream"; label: string;
  tone: "primary" | "warning"; onClick: () => void; busyName: string }`.
- [ ] The resolver encodes the table above. Unit-testable — no React
  dependencies.
- [ ] Order of state checks matters: **diverged > dirty > behind >
  off-default > no-upstream+unpushed > clean-uptodate**. A dirty+behind
  repo resolves to Commit&push (not Pull), because you can't FF-pull a
  dirty tree anyway.

### RepoActions.tsx wiring

- [ ] Replace the fixed triplet (Fetch, Pull, Commit&push as three
  `IconButton`s) with:
  - The resolved primary as a labelled `Button`, OR nothing if resolver
    returns null.
  - An always-visible `IconButton` for **Fetch** (drop from primary path
    when primary is already Pull — but keep when primary is Commit /
    Switch / Terminal).
  - An always-visible `IconButton` for **Pull** ONLY when primary is
    "Switch to default" and the row is clean+off-default+behind (rare
    combo — user might want to pull before switching).
- [ ] Primary button uses `tone="primary"` with an accent color; never
  `tone="danger"` (force pull's styling stays locked to the kebab entry).
- [ ] When primary is "Switch to `<default>`", use `tone="warning"`
  (amber) to match the existing off-default branch pill styling. The
  switch action itself is safe — the warning signals "you're moving
  away from your current branch", nothing destructive.
- [ ] "Push with upstream…" route: simplest implementation is to open
  `CommitPushDialog` with a hint parameter that preselects the push
  checkbox and auto-generates a `-u origin <branch>` command preview. If
  that requires significant dialog rework, ship with a dedicated smaller
  dialog instead. Backend command (`git_commit_push`) already handles the
  no-upstream path (invariant #17).

### Visual polish

- [ ] Row with no primary button (clean + up to date) should read as
  quiet: the right edge is just `[Fetch] ⋯ ▾` — small icons, no
  attention-grabbing color. This reinforces the "nothing to do here"
  signal.
- [ ] Loading state: when the primary button is running its action,
  replace its icon with `<Loader2 className="animate-spin" />`, keep the
  label, disable all the row's action buttons (existing `busy` state
  pattern).

### Testing

- [ ] Cover all 7 state rows from the table above with real repos in the
  dev harness. Verify the right button appears, the right action runs,
  and the right dialog (if any) opens.
- [ ] Verify `CommitPushDialog` still shows the full file preview +
  exact commands when launched from a dirty row (invariant #17).
- [ ] Verify Force pull is NEVER the primary button in any state. Grep
  `"forcePull"` in the resolver output — should return 0 hits.
- [ ] Verify the "Switch to default" primary button triggers the same
  `gitCheckout` + refresh flow as the Phase 1 branch picker's pinned row.

## Files touched

- `src/components/RepoActions.tsx` (medium rewrite — action strip becomes
  state-driven)
- Possibly new `src/lib/repoActions.ts` (extract the pure resolver)
- Possibly `src/components/dialogs/CommitPushDialog.tsx` (small — support
  a "push-only with upstream" entry mode, iff we go that route)

## Out of scope

- Keyboard shortcuts → Phase 4 (they'll dispatch to the resolved primary
  too)
- Sort order / dimming → Phase 5
- New backend commands — all invokes exist today
