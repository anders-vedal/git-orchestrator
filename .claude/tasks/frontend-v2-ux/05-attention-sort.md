# Phase 5: Attention sort + clean-row dimming

**Status:** Planned
**Priority:** Medium
**Type:** feature
**Apps:** repo-dashboard
**Effort:** small
**Parent:** frontend-v2-ux/00-overview.md
**Dependencies:** frontend-v2-ux/01-row-cleanup.md

## Scope

Make the dashboard visually answer "what needs my attention?" at a glance.
Two changes that work together:

1. **Attention sort** — default row ordering becomes `error > diverged >
   dirty+behind > dirty > behind > no-upstream+unpushed > off-default >
   clean`, with alpha as a tiebreaker. User can still opt into manual
   sort (drag-to-reorder) or alpha via the existing sort control.
2. **Clean-row dimming** — rows in the "clean + up to date + on default
   branch" state render at 60% opacity so the eye jumps to anything
   that's NOT in steady-state.

Depends on Phase 1 because it assumes the new consolidated pill (which
Phase 5 uses as the "which bucket is this row in?" signal). Independent
of Phases 2-4.

## Attention sort

### Ordering rule

The default sort (name it `sortBy: "attention"`) orders rows by urgency
bucket, with lower rank = more attention-worthy = higher in the list:

| Rank | Bucket | Condition |
|---|---|---|
| 0 | Error | `status.error` is set |
| 1 | Diverged | `status.diverged === true` |
| 2 | Dirty + behind | `dirty !== "clean"` AND `behind > 0` |
| 3 | Dirty | `dirty !== "clean"` |
| 4 | Behind | `behind > 0` |
| 5 | No upstream + unpushed | `!hasUpstream && unpushedNoUpstream > 0` |
| 6 | Off-default (clean) | `branch !== defaultBranch` and above conditions all false |
| 7 | Clean + up to date | everything else |

Tiebreaker: case-insensitive alpha on `status.name`.

### Sort control

- [ ] Check if a sort UI already exists in the codebase (look at
  `Sidebar.tsx` and `RepoList.tsx` for `sortBy` state). If present,
  extend with the new `attention` value as the default.
- [ ] If no UI exists yet, add a minimal sort dropdown in the sidebar
  footer or as a segmented control above the repo list: **Attention**
  (default) · **Name** · **Manual**.
- [ ] Persist the choice to `settings` (new key `sort_by` in the
  server-side allowlist — update both `src/stores/settingsStore.ts`
  `KEY_MAP` and `src-tauri/src/commands/settings.rs` `ALLOWED_KEYS`,
  per invariant #12).
- [ ] When `sortBy === "manual"`, the existing drag-to-reorder path
  (stored per-row `order` column) is used. When `"attention"` or
  `"name"`, drag handles disappear (Phase 1 already hides them when
  `dragDisabled`).
- [ ] Pure sort helper in `src/lib/repoSort.ts` — `sortByAttention(rows:
  RepoStatus[]): RepoStatus[]`. Unit-testable.

## Clean-row dimming

- [ ] A row in bucket 7 (clean + up to date + on default branch) renders
  its root `<div>` with `opacity-60`.
- [ ] Hover / focus removes the dim: `hover:opacity-100 focus-within:opacity-100`.
- [ ] When the row is selected (checkbox active), remove the dim too —
  the user explicitly pulled it into attention, don't fight that.
- [ ] Setting to disable dimming: new `dim_clean_rows` setting, default
  `true`, exposed in `SettingsDialog` under a new "Dashboard display"
  section. Same allowlist update (both `settingsStore` + Rust
  `ALLOWED_KEYS`).
- [ ] Phase 1's consolidated state pill for bucket 7 is already subtle
  ("up to date", zinc tone) — the dimming compounds this. Verify that
  a sea of 12 clean+up-to-date rows reads as background and a single
  dirty row reads as foreground.

## Checklist

- [ ] Add `sortByAttention()` to `src/lib/repoSort.ts`; unit-test the
  bucket mapping + alpha tiebreak.
- [ ] Add `sortBy` to settings: Rust `ALLOWED_KEYS` + TS `KEY_MAP` +
  `DEFAULT_SETTINGS` + `SettingsDialog` control. Default `"attention"`.
- [ ] Add `dimCleanRows` to settings: same plumbing. Default `true`.
- [ ] Wire `RepoList.tsx` to respect `sortBy`: `"attention"` → call
  `sortByAttention`, `"name"` → case-insensitive alpha, `"manual"` →
  use stored `order`.
- [ ] Wire `RepoRow.tsx` to apply `opacity-60` when `dimCleanRows &&
  rowBucket === 7 && !isSelected`. Add `hover:opacity-100
  focus-within:opacity-100` classes.
- [ ] Reuse Phase 1's pill resolver if it exposes the bucket value,
  otherwise add a small helper `getRepoAttentionBucket(status) → 0..7`
  shared between the sort helper and the dim logic.

### Testing

- [ ] With a fleet of 15 repos across all 8 buckets, verify the visual
  order matches the table above.
- [ ] Change `sortBy` to `"name"` and verify rows resort alphabetically.
- [ ] Change `sortBy` to `"manual"` and verify drag handles reappear
  and the stored `order` column is honored.
- [ ] With 12 clean repos + 1 dirty repo, verify the dirty row reads
  as the foreground of the view. Toggle `dimCleanRows` off and
  confirm all rows render at full opacity.
- [ ] Verify settings persist across app restart.
- [ ] Invariant #12 check: both allowlists (`KEY_MAP` +
  `ALLOWED_KEYS`) contain the two new keys; writes to other keys
  still rejected server-side.

## Files touched

- `src/lib/repoSort.ts` (new)
- `src/stores/settingsStore.ts` (small — add 2 keys to `KEY_MAP`,
  defaults)
- `src-tauri/src/commands/settings.rs` (small — add 2 keys to
  `ALLOWED_KEYS`)
- `src/types.ts` (small — extend `Settings` with `sortBy` +
  `dimCleanRows`)
- `src/components/RepoList.tsx` (small — dispatch to sort helper)
- `src/components/RepoRow.tsx` (small — apply dim class)
- `src/components/dialogs/SettingsDialog.tsx` (small — "Dashboard
  display" section with 2 controls)
- Possibly a small sort dropdown component in `Sidebar.tsx` or above
  the list — to be decided in the implementation session.

## Out of scope

- Multi-key sort (e.g. "diverged first, then by recency of last fetch")
  — overkill for the fleet sizes this app targets.
- Custom attention buckets — a power-user might want "show me repos
  I haven't fetched in > 7 days" as a first-class bucket, but that's
  a filter/query concern, not sort.
- Grouped rendering (e.g. "Needs attention" header vs "Steady state"
  header with a collapse toggle) — attractive but adds complexity and
  the dim+sort combo likely suffices. Revisit if 50+ repo fleets show
  up.
