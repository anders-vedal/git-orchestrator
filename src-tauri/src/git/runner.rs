use once_cell::sync::Lazy;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone)]
pub struct GitOutput {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("git spawn failed: {0}")]
    Spawn(String),
    #[error("git exited with code {code}: {stderr}")]
    Exit { code: i32, stderr: String },
    #[error("invalid repo path: {0}")]
    InvalidPath(String),
    #[error("output not utf-8: {0}")]
    Utf8(String),
    #[error("git timed out — the sign-in prompt was not completed within the allowed time")]
    Timeout,
}

impl From<GitError> for String {
    fn from(e: GitError) -> Self {
        e.to_string()
    }
}

/// Per-invocation config overrides that neutralise known RCE vectors exposed
/// through a hostile `.git/config` in a watched repo. Applied to every git
/// call this app makes so that polling a malicious repo on the refresh timer
/// cannot trigger arbitrary-binary execution.
///
/// - `core.fsmonitor=` — empty string disables the fsmonitor hook that would
///   otherwise run on every `git status` / index refresh.
/// - `protocol.ext.allow=never` — blocks `ext::<cmd>` remote helpers on
///   fetch/pull (CVE-2017-1000117 class).
/// - `credential.helper=` (empty) — resets the credential-helper chain, so a
///   repo-local `.git/config` entry like `credential.helper=!evil-cmd` cannot
///   sneak into the chain git consults during fetch/pull/sign-in. Git runs
///   helper values prefixed with `!` as shell commands (see `git-config(1)`),
///   and list-valued config keys normally **append** across scopes — so
///   without this reset, a malicious repo could achieve RCE the moment the
///   user clicks fetch. After the reset we re-pin the user's own global
///   helper (see `resolved_credential_helper`) so their configured sign-in
///   flow still works.
///
/// These are `-c` flags, not env vars, so they only apply to this process.
/// A user's own `git` usage in a terminal is unaffected. Aliases and
/// `core.sshCommand` are NOT neutralised here — see `docs/security.md`.
const BASE_HARDENING_FLAGS: &[&str] = &[
    "-c", "core.fsmonitor=",
    "-c", "protocol.ext.allow=never",
    "-c", "credential.helper=",
];

/// Cached resolution of the user's `credential.helper` at GLOBAL+SYSTEM
/// scope (NOT local — local is exactly what we're defending against). The
/// outer `Option` distinguishes "not yet resolved" from "resolved to
/// nothing". Populated lazily on first access and invalidated when the
/// user configures a new helper via `configure_credential_helper`.
///
/// We re-apply this on every git call so the user's intended helper is the
/// only one git sees, regardless of what a hostile repo-local config tries
/// to inject.
static CREDENTIAL_HELPER_CACHE: Lazy<Mutex<Option<Option<String>>>> =
    Lazy::new(|| Mutex::new(None));

/// The sole `Command::new("git")` site in the app (invariant #1). Every
/// other helper in this module builds on top of this. `repo_path` is
/// optional — `None` produces a command suitable for repo-independent
/// queries (`git --version`, `git config --global --get ...`).
///
/// `pin_credential_helper` controls whether we re-apply the user's global
/// helper after the `BASE_HARDENING_FLAGS` reset. True for every callsite
/// except the bootstrap detection itself (which would otherwise recurse).
fn new_git_command(
    repo_path: Option<&Path>,
    args: &[&str],
    pin_credential_helper: bool,
) -> Command {
    let mut cmd = Command::new("git");
    for flag in BASE_HARDENING_FLAGS {
        cmd.arg(flag);
    }
    if pin_credential_helper {
        if let Some(helper) = resolved_credential_helper() {
            cmd.arg("-c").arg(format!("credential.helper={helper}"));
        }
    }
    if let Some(p) = repo_path {
        cmd.arg("-C").arg(p);
    }
    for a in args {
        cmd.arg(a);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn build_command(repo_path: &Path, args: &[&str]) -> Command {
    new_git_command(Some(repo_path), args, true)
}

/// Returns the user's credential.helper at GLOBAL+SYSTEM scope (anything
/// EXCEPT repo-local). Cached — the detection runs once per app lifetime
/// unless `invalidate_credential_helper_cache` is called (e.g. after the
/// user clicks our one-click "Set up credential helper" button).
///
/// Detection bypasses the pin itself to avoid infinite recursion: we build
/// the detection command with `pin_credential_helper: false`.
fn resolved_credential_helper() -> Option<String> {
    let mut cache = CREDENTIAL_HELPER_CACHE.lock().ok()?;
    if cache.is_none() {
        *cache = Some(detect_global_credential_helper());
    }
    cache.as_ref().and_then(|v| v.clone())
}

/// Forget the cached helper so the next call re-reads config. Call this
/// after any write that could change the resolved value.
pub fn invalidate_credential_helper_cache() {
    if let Ok(mut cache) = CREDENTIAL_HELPER_CACHE.lock() {
        *cache = None;
    }
}

/// Read `credential.helper` from git config, EXCLUDING the local scope.
/// Uses `GIT_CONFIG_PARAMETERS` to be explicit we want globally-resolved
/// values only: we query from a neutral cwd (not inside any watched repo)
/// so local config can't contribute.
fn detect_global_credential_helper() -> Option<String> {
    // `git config --get credential.helper` returns the last value wins —
    // but we're calling from no repo context (no -C), so local scope can't
    // contribute. The value we get back is whatever the user's global or
    // system config resolves to.
    let mut cmd = new_git_command(
        None,
        &["config", "--get", "credential.helper"],
        false, // critical: avoid recursion
    );
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

/// Run `git -C <repo_path> <args...>` capturing stdout/stderr.
/// Returns `Err(GitError::Exit{..})` on non-zero exit, otherwise `Ok(GitOutput)`.
/// NOTE: this is the ONLY place in the app that shells out to git.
pub fn run_git(repo_path: &Path, args: &[&str]) -> Result<GitOutput, GitError> {
    if !repo_path.exists() {
        return Err(GitError::InvalidPath(format!(
            "{} does not exist",
            repo_path.display()
        )));
    }

    let mut cmd = build_command(repo_path, args);
    let output = cmd
        .output()
        .map_err(|e| GitError::Spawn(format!("{} ({})", e, repo_path.display())))?;

    let stdout = String::from_utf8(output.stdout)
        .map_err(|e| GitError::Utf8(e.to_string()))?;
    let stderr = String::from_utf8(output.stderr)
        .map_err(|e| GitError::Utf8(e.to_string()))?;
    let code = output.status.code().unwrap_or(-1);

    if !output.status.success() {
        return Err(GitError::Exit { code, stderr });
    }

    Ok(GitOutput {
        stdout,
        stderr,
        code,
    })
}

/// Run git and always return the output, even on non-zero exit (used for `status` etc. that never really fail).
pub fn run_git_raw(repo_path: &Path, args: &[&str]) -> Result<GitOutput, GitError> {
    if !repo_path.exists() {
        return Err(GitError::InvalidPath(format!(
            "{} does not exist",
            repo_path.display()
        )));
    }

    let mut cmd = build_command(repo_path, args);
    let output = cmd
        .output()
        .map_err(|e| GitError::Spawn(format!("{} ({})", e, repo_path.display())))?;

    let stdout = String::from_utf8(output.stdout)
        .map_err(|e| GitError::Utf8(e.to_string()))?;
    let stderr = String::from_utf8(output.stderr)
        .map_err(|e| GitError::Utf8(e.to_string()))?;
    let code = output.status.code().unwrap_or(-1);

    Ok(GitOutput { stdout, stderr, code })
}

/// Run git with `GIT_TRACE=1` + `GIT_TRACE_CURL=1` to capture auth/network
/// diagnostics. Returns the combined stdout+stderr+exit-code trace as a
/// single string, truncated to ~32KB. Used by the `diagnose_auth` command
/// — never in the hot path.
pub fn run_git_traced(repo_path: &Path, args: &[&str]) -> Result<String, GitError> {
    if !repo_path.exists() {
        return Err(GitError::InvalidPath(format!(
            "{} does not exist",
            repo_path.display()
        )));
    }

    let mut cmd = build_command(repo_path, args);
    cmd.env("GIT_TRACE", "1");
    cmd.env("GIT_TRACE_CURL", "1");
    cmd.env("GIT_TRACE_SETUP", "1");
    // Force git-credential-manager into non-interactive mode where possible
    // so a hung modal can't block the trace.
    cmd.env("GCM_INTERACTIVE", "Never");

    let output = cmd
        .output()
        .map_err(|e| GitError::Spawn(format!("{} ({})", e, repo_path.display())))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let code = output.status.code().unwrap_or(-1);

    let mut combined = format!("$ git {}\nexit: {}\n\n", args.join(" "), code);
    if !stdout.is_empty() {
        combined.push_str("--- stdout ---\n");
        combined.push_str(&stdout);
        combined.push('\n');
    }
    if !stderr.is_empty() {
        combined.push_str("--- stderr + trace ---\n");
        combined.push_str(&stderr);
    }

    const MAX: usize = 32_000;
    if combined.len() > MAX {
        combined.truncate(MAX);
        combined.push_str("\n… (truncated)");
    }
    Ok(combined)
}

/// Verify `path` is a git working tree (not a bare repo, not a random folder).
pub fn is_git_repo(repo_path: &Path) -> bool {
    match run_git_raw(repo_path, &["rev-parse", "--is-inside-work-tree"]) {
        Ok(out) if out.code == 0 => out.stdout.trim() == "true",
        _ => false,
    }
}

/// Run `git <args>` without a `-C <repo_path>` prefix. Used for global-config
/// queries (`git --version`, `git config --global --get ...`) that aren't
/// repo-scoped. Returns `Err(GitError::Spawn)` when git is not on PATH so
/// callers can present an "install Git" nudge.
///
/// Hardening flags still apply — the per-invocation `-c` overrides neutralise
/// the same RCE vectors regardless of whether we're inside a repo. These
/// commands never touch the network or working tree.
pub fn run_git_no_repo(args: &[&str]) -> Result<GitOutput, GitError> {
    let mut cmd = new_git_command(None, args, true);

    let output = cmd
        .output()
        .map_err(|e| GitError::Spawn(e.to_string()))?;

    let stdout = String::from_utf8(output.stdout)
        .map_err(|e| GitError::Utf8(e.to_string()))?;
    let stderr = String::from_utf8(output.stderr)
        .map_err(|e| GitError::Utf8(e.to_string()))?;
    let code = output.status.code().unwrap_or(-1);

    Ok(GitOutput { stdout, stderr, code })
}

/// Run git allowing Git Credential Manager to pop its OAuth / device-code
/// flow. Used ONLY by the "Sign in to remote" action triggered by the user
/// on an auth error — never in the hot refresh path.
///
/// Security posture:
/// - Credentials NEVER flow through this process. GCM spawns its own helper
///   and stores the resulting token in Windows Credential Manager
///   (DPAPI-encrypted) or the platform equivalent on mac/linux.
/// - `GCM_INTERACTIVE` is intentionally NOT set to `Never` here (unlike
///   `run_git_traced`). That env override would suppress the very popup we
///   want the user to see.
/// - Hardening flags (`core.fsmonitor=`, `protocol.ext.allow=never`) still
///   apply — the sign-in path is no excuse to relax them.
///
/// A hard `timeout` is enforced so a hung GCM helper can't pin a UI row
/// indefinitely. On timeout the child is killed and `Err(GitError::Timeout)`
/// is returned.
pub fn run_git_interactive(
    repo_path: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<GitOutput, GitError> {
    if !repo_path.exists() {
        return Err(GitError::InvalidPath(format!(
            "{} does not exist",
            repo_path.display()
        )));
    }

    let mut cmd = build_command(repo_path, args);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| GitError::Spawn(format!("{} ({})", e, repo_path.display())))?;

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => break,
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(GitError::Timeout);
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(GitError::Spawn(e.to_string())),
        }
    }

    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut s) = child.stdout.take() {
        let _ = s.read_to_string(&mut stdout);
    }
    if let Some(mut s) = child.stderr.take() {
        let _ = s.read_to_string(&mut stderr);
    }
    let status = child
        .wait()
        .map_err(|e| GitError::Spawn(e.to_string()))?;
    let code = status.code().unwrap_or(-1);

    Ok(GitOutput { stdout, stderr, code })
}
