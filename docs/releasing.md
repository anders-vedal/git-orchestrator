# Releasing + the auto-updater

The app ships with the Tauri updater plugin wired up end-to-end. Every
start-up (and every click of Settings → "Check for updates now") hits
the GitHub Releases endpoint configured in `tauri.conf.json`, downloads
the new installer, verifies its minisign signature against the embedded
public key, and prompts the user to restart.

## One-time setup (do this before the first signed release)

1. **Generate the updater signing keypair.** Do this on a trusted
   workstation, not in CI.

   ```bash
   npm run tauri signer generate -- -w ~/.tauri/repo-dashboard.key
   ```

   This writes the private key to `~/.tauri/repo-dashboard.key` (encrypted
   with the passphrase you set) and prints the public key to stdout.

2. **Store the PUBLIC key in the repo.** Copy the base64 string from the
   generator into `src-tauri/tauri.conf.json` →
   `plugins.updater.pubkey`, replacing the
   `REPLACE_WITH_BASE64_PUBKEY_FROM_TAURI_SIGNER_GENERATE` placeholder.
   Commit it. This is what every installed app will verify against.

3. **Store the PRIVATE key + passphrase as GitHub Actions secrets.**
   In Settings → Secrets and variables → Actions, create:

   | Secret name | Value |
   |-------------|-------|
   | `TAURI_SIGNING_PRIVATE_KEY` | The entire contents of `~/.tauri/repo-dashboard.key` (including the BEGIN/END lines) |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The passphrase you set in step 1 |

   Never commit the private key, never echo it in a workflow step, never
   email it to yourself. If it leaks, see "Key rotation" below.

4. **Back up the private key.** Store `~/.tauri/repo-dashboard.key` +
   its passphrase in a password manager (1Password secure note,
   Bitwarden, whatever you trust). Losing the key means every future
   release needs a new key, which means every existing install has to
   be reinstalled manually (the embedded public key won't verify
   anything the new key signs).

## Cutting a release

1. Bump the version in **three** places so they all line up:
   - `VERSION` file at the repo root
   - `package.json` → `version`
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/Cargo.toml` → `package.version`

2. Commit the bump on `main` (or open a PR and merge it).

3. Tag and push:

   ```bash
   git tag v0.3.0
   git push origin v0.3.0
   ```

4. `.github/workflows/release.yml` triggers. It builds on Windows, macOS
   (universal), and Linux, signs each installer with the updater key,
   and attaches every installer + a `latest.json` manifest to a new
   GitHub Release.

5. Once the workflow finishes, existing installs will pick the new
   version up on their next startup check (or when the user clicks
   Settings → "Check for updates now").

## What the updater actually does

- On startup (when `auto_check_updates` is on, which is the default) and
  on manual check, the app fetches the manifest at the configured
  endpoint: `https://github.com/anders-vedal/git-orchestrator/releases/latest/download/latest.json`.
- It compares the manifest's version to the running version. If the
  manifest is newer, it downloads the platform-specific installer.
- Before handing the installer to the OS, the Tauri updater plugin
  verifies the minisign signature on the downloaded file against the
  public key embedded in the binary at build time. A signature
  mismatch hard-fails — no installer is run.
- On Windows, the installer runs in `passive` mode (progress bar,
  no interactive prompts), and the app relaunches when the user
  clicks "Restart now" in the update dialog.

## Security model — recap

- **Anyone can read the public repo.** That's fine; the security
  perimeter is the signing key, not the source.
- **Signatures cover every installer.** An attacker who MITMs the
  download or compromises GitHub Releases can't forge an install that
  the client will accept — they'd need the private key, which only
  lives on the developer workstation + GitHub Actions secret store.
- **Workflow is tag-triggered.** `release.yml` only fires on
  `push.tags: v*`, never on `pull_request`. Fork PRs cannot access
  the signing secrets (GitHub doesn't expose secrets to fork PRs by
  default anyway).
- **2FA the GitHub account.** Someone who steals your GitHub session
  could push a tag from a fork and trigger a release with a fake tag,
  but they still can't exfiltrate the signing secret — GitHub Actions
  secrets are only exposed to jobs running on protected branches /
  tag events in the same repo, and you'd see the unexpected release in
  the Releases tab immediately.

## Key rotation

If the signing key ever leaks (or you suspect it did):

1. Generate a new keypair with `tauri signer generate`.
2. Update `tauri.conf.json` → `plugins.updater.pubkey` to the new
   public key.
3. Overwrite the `TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub Actions secrets with
   the new values.
4. Ship a new release (`v0.X.Y+1`). Every user currently on an older
   version can still update to this release via the auto-updater —
   but only this one, because their currently-embedded public key is
   the OLD one and it will still verify releases signed by the old key.
5. **Critical:** releases cut with the old key after a leak are
   attacker-forge-able. You must rotate the key BEFORE cutting any new
   releases, and you should assume anything the leaked key could have
   signed after the leak date is untrusted. In practice, burn the leaked
   key immediately and tell users to reinstall from a freshly-downloaded
   installer signed with the new key.
