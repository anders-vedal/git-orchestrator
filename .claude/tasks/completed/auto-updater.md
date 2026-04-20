# Wire Tauri auto-updater end-to-end (plugin + signed release workflow + settings UI)

**Status:** ✅ Completed
**Completed:** 2026-04-19
**Priority:** Medium
**Type:** feature
**Apps:** repo-dashboard
**Effort:** medium

## Overview

Ship in-app update checking + install so users don't have to manually download
new MSI/NSIS builds from GitHub Releases. Uses Tauri 2's official updater
plugin with minisign-signed installers hosted on GitHub Releases. Safe to run
against a public repo because the security perimeter is the signing key, not
source visibility.

## Scope

- `tauri-plugin-updater` + `tauri-plugin-process` wired in `src-tauri/src/lib.rs`
  with matching `updater:default` and `process:allow-restart` permissions in
  `capabilities/default.json`.
- `plugins.updater` section in `tauri.conf.json` pointing at
  `https://github.com/anders-vedal/git-orchestrator/releases/latest/download/latest.json`;
  `createUpdaterArtifacts: true` on the bundle so `tauri-action` emits signed
  artifacts; `installMode: "passive"` on Windows to suppress prompts during
  the NSIS/MSI swap.
- `src/lib/updater.ts` — single-surface wrapper (`checkForUpdate`,
  `installPendingUpdate`, `relaunchApp`) matching the `lib/tauri.ts` pattern.
  Holds the `Update` handle in module scope so the dialog only carries
  serializable metadata.
- `UpdateDialog` component with release notes + progress bar; opened via a
  new `update` variant on `DialogKind` in `uiStore`.
- Silent startup check in `App.tsx` (gated by `autoCheckUpdates` setting,
  default on). Offline / signature mismatch stays silent — the user can
  retry via Settings.
- `SettingsDialog`: "Check for updates automatically on startup" checkbox +
  "Check for updates now" button. Manual check surfaces the same
  `UpdateDialog` flow.
- New setting key `auto_check_updates` added to both the Rust `ALLOWED_KEYS`
  allowlist (`commands/settings.rs`) and the TS `KEY_MAP`
  (`settingsStore.ts`), plus `Settings` type + `DEFAULT_SETTINGS`. Also
  fixed a pre-existing omission of `bulk_concurrency` from the Rust
  allowlist.
- `.github/workflows/release.yml` — tag-triggered (`v*`) matrix build on
  Windows / macOS universal / Ubuntu. Uses `tauri-apps/tauri-action@v0`
  with `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  secrets to sign each installer and attach `latest.json` to the release.
- `docs/releasing.md` — keygen instructions, secret setup, rotation flow,
  and the "what the updater actually does" security recap.

## Security model

- Public repo is fine — signature verification happens client-side against
  the pubkey embedded at build time.
- Release workflow is `on: push.tags` only — fork PRs cannot trigger it
  and GitHub doesn't expose secrets to fork PR workflows regardless.
- Signing key lives only on dev workstation + GitHub Actions secret store;
  passphrase-protected.
- Rotation path documented in `docs/releasing.md` — if key leaks, bump
  pubkey in config + secrets, ship new release.

## Before first release

1. `npm run tauri signer generate -- -w ~/.tauri/repo-dashboard.key`
2. Paste pubkey into `tauri.conf.json` → `plugins.updater.pubkey`
   (currently placeholder `REPLACE_WITH_BASE64_PUBKEY_FROM_TAURI_SIGNER_GENERATE`).
3. Add `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   as GitHub Actions secrets.
4. Back up the private key + passphrase in a password manager — losing
   it forces every user to reinstall.
5. Tag `v0.3.0` and push. Release workflow takes over.

## Verification

- `npm run build` — typecheck + Vite build clean.
- `cd src-tauri && cargo check --all-targets` — clean, no new warnings
  attributable to the updater plugins.
- Manual check deferred until the pubkey placeholder is replaced and a
  first release is cut.

## Files touched

- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/lib.rs`
- `src-tauri/src/commands/settings.rs`
- `package.json`
- `src/App.tsx`
- `src/types.ts`
- `src/stores/settingsStore.ts`
- `src/stores/uiStore.ts`
- `src/lib/updater.ts` (new)
- `src/components/dialogs/UpdateDialog.tsx` (new)
- `src/components/dialogs/SettingsDialog.tsx`
- `.github/workflows/release.yml` (new)
- `docs/releasing.md` (new)
