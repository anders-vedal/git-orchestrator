//! Phase 2.3 stash helpers. Thin wrappers around `git stash`. Every
//! invocation goes through the shared runner so the per-call hardening
//! flags (invariant #10) apply.
//!
//! We identify stash entries by their commit SHA (the stash commit) rather
//! than stack position (`stash@{0}`), because another tool — or the user's
//! own `git stash push` between dashboard runs — shifts stack positions
//! underneath us but leaves SHAs stable.

use super::runner::{run_git_raw, GitError, GitOutput};
use std::path::Path;

/// Result of `git stash push`. `sha` is the commit of the newly-created
/// stash ref, captured via `git rev-parse stash@{0}` right after push.
pub struct PushResult {
    pub sha: String,
    pub message: String,
}

/// Create a new stash. Always includes untracked files when
/// `include_untracked` is true — workspace switching loses context
/// otherwise. Returns Ok(None) when there's nothing to stash (git exits
/// 0 with "No local changes to save"); otherwise `PushResult` carries
/// the new stash commit SHA.
pub fn push(
    repo_path: &Path,
    message: &str,
    include_untracked: bool,
) -> Result<Option<PushResult>, GitError> {
    let mut args: Vec<&str> = vec!["stash", "push"];
    if include_untracked {
        args.push("-u");
    }
    args.extend_from_slice(&["-m", message]);

    let out = run_git_raw(repo_path, &args)?;
    let push_msg = merged(&out);
    if out.code != 0 {
        return Err(GitError::Exit {
            code: out.code,
            stderr: push_msg,
        });
    }
    // Git signals "nothing to stash" with stdout "No local changes to save"
    // and exit code 0. Surface that as Ok(None) so the caller can skip the
    // repo without a false failure.
    if push_msg.to_lowercase().contains("no local changes to save") {
        return Ok(None);
    }

    // Capture the resulting stash SHA. The freshly-created stash lives at
    // stash@{0} immediately after push completes.
    let sha_out = run_git_raw(repo_path, &["rev-parse", "stash@{0}"])?;
    if sha_out.code != 0 {
        return Err(GitError::Exit {
            code: sha_out.code,
            stderr: merged(&sha_out),
        });
    }
    let sha = sha_out.stdout.trim().to_string();
    if sha.is_empty() {
        return Err(GitError::Exit {
            code: -1,
            stderr: "stash created but SHA could not be resolved".to_string(),
        });
    }
    Ok(Some(PushResult {
        sha,
        message: push_msg,
    }))
}

/// Apply a stash entry by its SHA. Does NOT remove the stash ref on
/// success — the caller can drop it explicitly.
pub fn apply(repo_path: &Path, sha: &str) -> Result<GitOutput, GitError> {
    run_git_raw(repo_path, &["stash", "apply", sha])
}

/// Drop a stash entry by its SHA. Callers should first verify existence
/// with `ref_exists` if they need to distinguish "already gone" from
/// "drop failed" — git's own "No stash found" is ambiguous.
pub fn drop(repo_path: &Path, sha: &str) -> Result<GitOutput, GitError> {
    run_git_raw(repo_path, &["stash", "drop", sha])
}

/// Does the given stash SHA still resolve to a stash ref in this repo?
/// Walks the stash reflog — stash entries show up in `git stash list
/// --format=%H`. Cheap (single command, no network) and unambiguous
/// (rev-parse alone would also accept bare committed objects).
pub fn ref_exists(repo_path: &Path, sha: &str) -> Result<bool, GitError> {
    let out = run_git_raw(repo_path, &["stash", "list", "--format=%H"])?;
    if out.code != 0 {
        return Err(GitError::Exit {
            code: out.code,
            stderr: merged(&out),
        });
    }
    Ok(out.stdout.lines().any(|l| l.trim() == sha))
}

fn merged(out: &GitOutput) -> String {
    let mut s = out.stdout.trim().to_string();
    let stderr = out.stderr.trim();
    if !stderr.is_empty() {
        if !s.is_empty() {
            s.push('\n');
        }
        s.push_str(stderr);
    }
    s
}
