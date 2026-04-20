# Phase 2: Sidebar collapse — 3 primary + "More…" menu, footer auto-refresh

**Status:** ✅ Completed
**Completed:** 2026-04-20
**Priority:** High
**Type:** feature
**Apps:** repo-dashboard
**Effort:** small
**Parent:** frontend-v2-ux/00-overview.md

## Scope

Collapse the sidebar from 8 top-level action buttons down to **3 primary
buttons + 1 "More actions…" dropdown menu**. Shrink the auto-refresh info
card to a one-line footer badge next to the Settings gear. Rename two
labels to remove jargon.

Independent of Phase 1 — both can ship in either order. Does not touch
any per-row UI.

## Target sidebar (end of Phase 2)

```
[R]  Repo Dashboard · 12 repos
───────────────────────────────
Workspace: claros             ▾
───────────────────────────────
[+ Add repo]          (primary)
[↻ Fetch all]
[↓ Pull all]
More actions…                 ▾   → Import from folder…
                                    Activity feed
                                    Stash all changes…
                                    Stash bundles
                                    Refresh all
                                    Manage workspaces
───────────────────────────────
(footer)  Auto-refresh 2m · ⚙
```

3 primary buttons, 1 dropdown, 1 footer row — down from 8 buttons + card +
Settings button = 10 sidebar controls today.

## Checklist

### Primary buttons stay (in this order)

- [ ] **Add repo** — keep as `variant="primary"`; it's the only "build the
  fleet" verb and non-existing users land on an empty dashboard.
- [ ] **Fetch all** — keep; selection-aware label (`Fetch selected (N)`)
  already works, preserve.
- [ ] **Pull all** — rename from "Pull all (safe)" to just "Pull all". The
  "(safe)" label implies per-row Pull is unsafe, which confuses users.
  Keep the tooltip explaining the fast-forward + clean-tree skip logic.
  Selection-aware label (`Pull selected (N)`) preserved.

### "More actions…" menu (new)

- [ ] Replace the `Scan folder…`, `Refresh all`, `Activity feed`,
  `Stash dirty`, `Stash bundles` buttons with a single `Button` labelled
  "More actions…" with a caret icon. Opens a dropdown menu underneath.
- [ ] Menu contents, in order:
  1. **Import from folder…** (renamed from "Scan folder…") — same dialog
  2. **Activity feed** — same dialog
  3. *(separator)*
  4. **Stash all changes…** (renamed from "Stash dirty") — same dialog,
     with current `seedRepoIds` selection behavior preserved
  5. **Stash bundles** — same dialog
  6. *(separator)*
  7. **Refresh all** — same action, selection-aware if selection active
  8. **Manage workspaces** — already in `WorkspaceSwitcher`, keep there
     AND add here for discoverability. Opens `kind: "manageWorkspaces"`.
- [ ] Dropdown behavior: open on click, close on item click / Esc /
  outside-click. Same pattern as the existing `RepoActions` kebab + the
  `WorkspaceSwitcher` dropdown — reuse one of those as the template.
- [ ] Selection-aware labels inside the menu:
  - "Refresh all" → "Refresh selected (N)" when selection active
  - "Stash all changes…" → "Stash selected (N)…" when selection active

### Footer (auto-refresh + settings)

- [ ] Delete the full-width auto-refresh info card (`<div
  className="rounded-md border...">`).
- [ ] Replace the remaining `Settings` button + auto-refresh card with a
  single horizontal footer row:

```
 Auto-refresh 2m    •    [⚙ Settings]
```

- [ ] `refreshing` spinner still renders in the footer badge when an
  in-flight refresh is active.
- [ ] Clicking the "Auto-refresh 2m" text opens Settings directly on the
  "Refresh interval" field — nice-to-have, ship without if it balloons
  scope.

### Section headers

- [ ] Remove the "Bulk actions" section header entirely. With only 3
  primary buttons + a More menu, the section delimiter is visual
  overhead for no navigational gain.
- [ ] Selection chip (`{selectionCount} X`) relocates to live next to
  "Pull all" / "Fetch all" labels (or stays as a separate small chip
  above the primary buttons — whichever reads cleaner in the 256px
  sidebar width).

### WorkspaceSwitcher

- [ ] Unchanged. Stays at its current position right under the app
  header. The agents agreed it's well-designed already; don't touch it
  in this phase.

## Testing

- [ ] Verify selection-aware labels still update live when the user
  toggles row checkboxes (existing store subscription behavior).
- [ ] Verify all dialogs still open from their new menu locations with
  the same argument shapes (`openDialog({ kind: "scanFolder" })`, etc.).
- [ ] Verify the "More actions…" menu closes when any menu item is
  clicked, when Esc is pressed, or when the user clicks outside.
- [ ] With auto-refresh running, the footer badge's spinner appears
  during refresh cycles.

## Files touched

- `src/components/Sidebar.tsx` (major rewrite — remove 5 buttons, add
  "More actions…" menu component, collapse footer)
- Possibly new `src/components/SidebarMoreMenu.tsx` — only extract if the
  dropdown logic adds > 80 lines to `Sidebar.tsx`

## Out of scope

- Keyboard shortcut to open "More actions…" → Phase 4 folds this into
  the `Ctrl+K` command palette
- Any per-row UI → Phase 1
- Workspace switcher rework → not planned
