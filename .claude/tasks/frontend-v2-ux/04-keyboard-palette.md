# Phase 4: Keyboard layer + command palette

**Status:** Planned
**Priority:** Medium
**Type:** feature
**Apps:** repo-dashboard
**Effort:** medium
**Parent:** frontend-v2-ux/00-overview.md
**Dependencies:** frontend-v2-ux/01-row-cleanup.md, frontend-v2-ux/02-sidebar-collapse.md

## Scope

Add the keyboard layer the app has been missing. Two independent surfaces:

1. **Row focus model** — `j/k` (and `↑/↓`) to move a focus ring between
   rows; per-row shortcuts (`f`/`p`/`c`/`t`/`o`/`r`/`enter`/`space`/`.`)
   that dispatch to the focused row.
2. **Command palette** — `Ctrl+K` / `Cmd+K` opens a fuzzy-searchable
   command palette listing every Tier 5 action (Import from folder,
   Activity feed, Stash bundles, Settings, Manage workspaces, Check for
   updates, etc.) plus contextual row actions when a row is focused.

Depends on Phases 1 + 2 because the shortcuts dispatch into the new
row/sidebar action surfaces. Not dependent on Phase 3 — shortcuts
dispatch via the same resolver Phase 3 builds (`resolvePrimaryAction`),
but can also call the underlying `gitFetch` / `gitPullFf` / etc. directly.

## Focus model

### New `focusStore.ts`

```ts
interface FocusState {
  focusedRepoId: number | null;
  // Set by RepoList on every render with the visible, sorted repo IDs.
  visibleIds: number[];
  setVisibleIds(ids: number[]): void;
  focusNext(): void;
  focusPrev(): void;
  focusFirst(): void;
  focusLast(): void;
  focusById(id: number): void;
  clear(): void;
}
```

- Focus is independent of selection. User can focus row A (ring) while
  having rows B, C, D selected (checkboxes). Actions with `Shift+F` etc.
  target selection; single-row shortcuts target focus.
- Focused row gets a blue outline (`ring-1 ring-blue-400/60`) but does
  NOT highlight the row background — selection already owns that
  affordance.

### Keymap (global, gated by `!isTyping`)

- `j` / `↓` — focusNext
- `k` / `↑` — focusPrev
- `g g` — focusFirst (vim-style double-tap within 500ms)
- `G` — focusLast
- `/` — focus filter input (already exists; add the binding)
- `Esc` — cascade:
  1. if filter has text → clear filter
  2. else if selection.size > 0 → clear selection
  3. else if focus set → blur focus
  4. else if row expanded → collapse all
- `Space` — toggle select on focused row
- `Shift+Space` (or existing `Shift+Click`) — range select from last
  anchor to focused row
- `Enter` — toggle expand on focused row
- `f` — fetch focused row
- `p` — pull (ff-only) focused row
- `c` — open CommitPushDialog for focused row (if dirty; otherwise noop
  with a subtle flash on the row)
- `t` — open terminal in focused row
- `o` — open remote in browser for focused row
- `r` — refresh focused row
- `.` — open kebab for focused row (position menu below the row, first
  item pre-focused)
- `Shift+F` — fetch selected (or all, if no selection) — matches the
  sidebar "Fetch all / Fetch selected" button exactly
- `Shift+P` — pull-safe selected (or all)
- `Ctrl/Cmd+K` — open command palette (see below)
- `Ctrl/Cmd+A` — select all visible (already exists, keep)

Global guard: `isTyping` — already used in `RepoList.tsx` for the
existing `Ctrl+A` shortcut. Check `document.activeElement` against
`INPUT`, `TEXTAREA`, `SELECT`, `[contenteditable]`.

## Command palette

### New component `CommandPalette.tsx`

- [ ] Rendered unconditionally in `App.tsx`; visibility driven by
  `useUiStore`. Add a new `commandPalette` boolean (or a new dialog
  kind). Keep it OUT of the `DialogKind` discriminated union if adding
  it there causes friction — a separate boolean is fine.
- [ ] Opens on `Ctrl+K` (Mac + Windows — the existing codebase is
  Windows-first but we can ship both modifiers).
- [ ] Layout: modal overlay with a centered 640px-wide search input and
  a scrollable result list below. Keyboard-first — arrow keys navigate
  results, Enter executes, Esc closes. Mouse click also works.
- [ ] Fuzzy match on command label + keyword list. Simple substring
  matching on lowercase is enough for v1 — no need to pull in a fuzzy
  library. Show top 10 matches.

### Command registry

Static list inside `CommandPalette.tsx`, grouped into sections:

**Fleet actions** (always shown at top)

- Fetch all / Fetch selected (N)
- Pull all / Pull selected (N)
- Refresh all
- Import from folder…
- Activity feed
- Stash all changes… / Stash selected (N)…
- Stash bundles
- Manage workspaces
- Add repo…

**Focused row** (shown only when a row is focused — uses the row's name
in the label)

- Fetch `<name>`
- Pull `<name>`
- Commit & push `<name>`…
- Switch `<name>` to default branch
- Open folder for `<name>`
- Open terminal in `<name>`
- Open remote for `<name>`
- Force pull `<name>`… (route through existing dialog)
- Remove `<name>` from dashboard… (route through existing dialog)
- Rename `<name>`…

**App**

- Settings…
- Check for updates now
- Toggle window (tray action)
- About / version info

### Selection + focus awareness

- [ ] When selection.size > 0, "Fetch all" is renamed to
  "Fetch selected (N)" in the palette results. Same for Pull, Refresh,
  Stash.
- [ ] When a row is focused, the focused-row commands move to the TOP
  of the list above Fleet actions.

## Checklist

### Phase 4a — row focus + basic keymap

- [ ] Create `src/stores/focusStore.ts` with the interface above.
- [ ] In `RepoList.tsx`, subscribe to `useFocusStore().setVisibleIds` and
  call it with the memoized `visible` array on each render.
- [ ] In `RepoRow.tsx`, read focus state and add the focus ring class
  conditionally. Scroll into view when a row becomes focused (use
  `scrollIntoView({ block: "nearest" })`).
- [ ] Add a global keyboard listener in `App.tsx` (or a new
  `useGlobalKeymap.ts` hook) that registers/cleans up on mount. Gate
  every binding on `!isTyping()`.
- [ ] Wire the per-row action keys (`f`/`p`/`c`/`t`/`o`/`r`/`Enter`/`Space`/`.`)
  to the same handlers `RepoActions` uses. Extract the shared handlers
  into a `useRepoActions(status)` hook if wiring gets too duplicative.
- [ ] `Shift+F` / `Shift+P` call the same sidebar bulk handlers.

### Phase 4b — command palette

- [ ] Create `src/components/CommandPalette.tsx` with input + result
  list + keyboard nav (↑/↓ arrows, Enter, Esc).
- [ ] Add `paletteOpen: boolean` + `openPalette()` + `closePalette()` to
  `useUiStore`.
- [ ] Register `Ctrl/Cmd+K` in the global keymap to toggle.
- [ ] Populate the command registry from the static list above,
  parameterised by current selection + focus state.
- [ ] Render `<CommandPalette />` in `App.tsx` alongside the other
  dialogs.

### Accessibility

- [ ] Focus ring uses a color that's distinguishable from selection
  border (selection is blue-left-border at `border-l-blue-400`; focus
  is a full-row `ring-1 ring-blue-400/60` — adjust if they clash).
- [ ] `aria-label` on command palette input; `role="listbox"` +
  `aria-activedescendant` on the result list.
- [ ] The global keymap must respect `isTyping()` — don't hijack keys
  while the user types in an input / textarea / contenteditable /
  the palette's own search box.

### Testing

- [ ] With 15+ repos, verify j/k navigation moves the focus ring and
  scrolls the row into view. Verify Enter expands. Verify f/p/c fire
  the right action on the focused row.
- [ ] With 5 repos selected, verify `Shift+F` runs the bulk fetch on
  those 5 (same as clicking the sidebar "Fetch selected (5)").
- [ ] With a row focused, verify `.` opens its kebab and the first
  menu item has keyboard focus so `Enter` activates it.
- [ ] `Ctrl+K` palette: type "stash" → "Stash all changes…" matches;
  Enter opens the dialog.
- [ ] `Esc` cascade works in every state (filter populated, selection
  active, focus set, row expanded).
- [ ] `isTyping` guard: while typing in the filter, `f` types the
  letter f in the filter, doesn't fetch the focused row.

## Files touched

- `src/stores/focusStore.ts` (new)
- `src/stores/uiStore.ts` (small — add paletteOpen)
- `src/components/CommandPalette.tsx` (new)
- `src/components/App.tsx` (small — mount palette + keymap hook)
- `src/hooks/useGlobalKeymap.ts` (new, if keymap logic grows)
- `src/hooks/useRepoActions.ts` (new, if wiring key→action needs
  dedup with `RepoActions.tsx`)
- `src/components/RepoRow.tsx` (small — focus ring + scrollIntoView)
- `src/components/RepoList.tsx` (small — push visibleIds to focusStore)

## Out of scope

- Command palette history / "recent commands" → nice-to-have, skip v1
- User-remappable keybindings → not planned
- Multi-key combos beyond `g g` → not needed
