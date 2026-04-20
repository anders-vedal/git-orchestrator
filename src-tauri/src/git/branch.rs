//! Branch listing + switching. Wraps `git for-each-ref`, `git checkout`,
//! `git checkout -b`. No unusual safety model — git's own "would be
//! overwritten by checkout" guard is what stops dirty-tree footguns; we
//! surface its stderr verbatim when it fires.

use super::runner::{run_git_raw, GitError, GitOutput};
use crate::models::{BranchInfo, BranchList};
use std::path::Path;

// Separators — same pattern as git/log.rs. Unit separator is essentially
// never in a ref name / commit date, so splitting is unambiguous.
const SEP: &str = "\u{001F}";
const REC: &str = "\u{001E}";

/// List local + remote branches with their short SHAs, upstreams (local
/// only), and last committer date. The `current` field names the branch
/// HEAD is on, or None for detached HEAD / unborn branches.
pub fn list_branches(repo_path: &Path) -> Result<BranchList, GitError> {
    let current = detect_current(repo_path);

    let local_format = format!(
        "%(refname:short){SEP}%(objectname:short){SEP}%(upstream:short){SEP}%(committerdate:iso8601){REC}"
    );
    let local_out = run_git_raw(
        repo_path,
        &[
            "for-each-ref",
            "--format",
            &local_format,
            "refs/heads/",
        ],
    )?;
    let local = parse_branch_list(&local_out.stdout, false, current.as_deref());

    // Remote branches — exclude the symbolic origin/HEAD alias, it
    // just shadows whatever main/master is and adds noise.
    let remote_format = format!(
        "%(refname:short){SEP}%(objectname:short){SEP}{SEP}%(committerdate:iso8601){REC}"
    );
    let remote_out = run_git_raw(
        repo_path,
        &[
            "for-each-ref",
            "--format",
            &remote_format,
            "refs/remotes/",
        ],
    )?;
    let mut remote = parse_branch_list(&remote_out.stdout, true, None);
    remote.retain(|b| !b.name.ends_with("/HEAD"));

    Ok(BranchList {
        current,
        local,
        remote,
    })
}

fn detect_current(repo_path: &Path) -> Option<String> {
    let out = run_git_raw(repo_path, &["symbolic-ref", "--quiet", "--short", "HEAD"]).ok()?;
    if out.code != 0 {
        return None;
    }
    let name = out.stdout.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn parse_branch_list(raw: &str, is_remote: bool, current: Option<&str>) -> Vec<BranchInfo> {
    let mut out = Vec::new();
    for rec in raw.split(REC) {
        let rec = rec.trim_matches('\n').trim_matches('\r');
        if rec.is_empty() {
            continue;
        }
        let parts: Vec<&str> = rec.splitn(4, SEP).collect();
        if parts.len() < 4 {
            continue;
        }
        let name = parts[0].to_string();
        let short_sha = parts[1].to_string();
        let upstream = if parts[2].is_empty() {
            None
        } else {
            Some(parts[2].to_string())
        };
        let last_commit_at = if parts[3].is_empty() {
            None
        } else {
            Some(parts[3].to_string())
        };
        let is_current = current.is_some_and(|c| c == name);
        out.push(BranchInfo {
            name,
            short_sha,
            is_remote,
            is_current,
            upstream,
            last_commit_at,
        });
    }
    out
}

/// Switch to an existing branch. Delegates to `git checkout` — git's own
/// guard refuses when local changes would be overwritten, and we pass the
/// stderr through unchanged so the UI can surface it.
pub fn checkout(repo_path: &Path, name: &str) -> Result<GitOutput, GitError> {
    run_git_raw(repo_path, &["checkout", name])
}

/// Create a new branch and switch to it. Optional `start_point` mirrors
/// `git checkout -b <name> [start]` semantics — `None` branches from the
/// current HEAD.
pub fn create_and_checkout(
    repo_path: &Path,
    name: &str,
    start_point: Option<&str>,
) -> Result<GitOutput, GitError> {
    let mut args: Vec<&str> = vec!["checkout", "-b", name];
    if let Some(sp) = start_point {
        args.push(sp);
    }
    run_git_raw(repo_path, &args)
}

/// Create a local tracking branch from an existing remote branch and
/// switch to it. Used by workspace activation when an entry references
/// a branch that only exists as `refs/remotes/origin/<name>` — matches
/// the `git checkout <name>` DWIM behaviour without depending on git's
/// default DWIM rules.
pub fn checkout_tracking(
    repo_path: &Path,
    local_name: &str,
    remote_ref: &str,
) -> Result<GitOutput, GitError> {
    run_git_raw(
        repo_path,
        &["checkout", "-b", local_name, "--track", remote_ref],
    )
}

/// Classify existence of a branch name for workspace activation.
/// Returns `Local` if a local ref exists, `RemoteOnly(remote_ref)` if
/// at least one remote-tracking ref matches (prefers `origin/<name>`),
/// or `Missing` if neither.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BranchLocation {
    Local,
    RemoteOnly(String),
    Missing,
}

pub fn locate_branch(repo_path: &Path, name: &str) -> Result<BranchLocation, GitError> {
    let list = list_branches(repo_path)?;
    if list.local.iter().any(|b| b.name == name) {
        return Ok(BranchLocation::Local);
    }
    // Prefer origin/<name>; otherwise take the first remote that ends in "/<name>".
    let suffix = format!("/{name}");
    let origin = format!("origin/{name}");
    if let Some(m) = list.remote.iter().find(|b| b.name == origin) {
        return Ok(BranchLocation::RemoteOnly(m.name.clone()));
    }
    if let Some(m) = list.remote.iter().find(|b| b.name.ends_with(&suffix)) {
        return Ok(BranchLocation::RemoteOnly(m.name.clone()));
    }
    Ok(BranchLocation::Missing)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_local_branches() {
        let raw = format!(
            "main{SEP}abc1234{SEP}origin/main{SEP}2026-04-18 10:00:00 +0200{REC}\
             feat/x{SEP}def5678{SEP}{SEP}2026-04-17 14:00:00 +0200{REC}"
        );
        let out = parse_branch_list(&raw, false, Some("main"));
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].name, "main");
        assert!(out[0].is_current);
        assert_eq!(out[0].upstream.as_deref(), Some("origin/main"));
        assert_eq!(out[1].name, "feat/x");
        assert!(!out[1].is_current);
        assert!(out[1].upstream.is_none());
    }

    #[test]
    fn parse_remote_branches() {
        let raw = format!(
            "origin/main{SEP}abc1234{SEP}{SEP}2026-04-18 10:00:00 +0200{REC}"
        );
        let out = parse_branch_list(&raw, true, None);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "origin/main");
        assert!(out[0].is_remote);
        assert!(!out[0].is_current);
    }
}
