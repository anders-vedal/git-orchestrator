use super::runner::{run_git, GitError};
use crate::models::Commit;
use std::path::Path;

const SEP: &str = "\u{001F}"; // unit separator, unlikely to appear in commit text
const REC: &str = "\u{001E}"; // record separator

/// Fetch the last `count` commits on HEAD.
pub fn log(repo_path: &Path, count: u32) -> Result<Vec<Commit>, GitError> {
    let format = format!("%H{SEP}%h{SEP}%an{SEP}%aI{SEP}%s{REC}");
    let n = format!("-n{count}");
    let out = run_git(repo_path, &["log", &n, &format!("--pretty=format:{format}")])?;
    parse_log(&out.stdout)
}

pub fn parse_log(raw: &str) -> Result<Vec<Commit>, GitError> {
    let mut out = Vec::new();
    for rec in raw.split(REC) {
        let rec = rec.trim_matches('\n').trim_matches('\r');
        if rec.is_empty() {
            continue;
        }
        let parts: Vec<&str> = rec.splitn(5, SEP).collect();
        if parts.len() < 5 {
            continue;
        }
        out.push(Commit {
            sha: parts[0].to_string(),
            sha_short: parts[1].to_string(),
            author: parts[2].to_string(),
            timestamp: parts[3].to_string(),
            message: parts[4].to_string(),
        });
    }
    Ok(out)
}

/// Just the latest commit (or None for empty repos).
pub fn latest_commit(repo_path: &Path) -> Option<Commit> {
    match log(repo_path, 1) {
        Ok(mut v) => v.drain(..).next(),
        Err(_) => None,
    }
}

/// Commits reachable from HEAD but not from `base_ref` (e.g. `origin/main`).
/// These are the commits a force-pull would discard.
pub fn commits_since(
    repo_path: &Path,
    base_ref: &str,
    limit: u32,
) -> Result<Vec<Commit>, GitError> {
    let format = format!("%H{SEP}%h{SEP}%an{SEP}%aI{SEP}%s{REC}");
    let n = format!("-n{limit}");
    let range = format!("{base_ref}..HEAD");
    let out = run_git(
        repo_path,
        &["log", &n, &format!("--pretty=format:{format}"), &range],
    )?;
    parse_log(&out.stdout)
}

/// Commits on HEAD authored in the last `days_back` days, up to `limit`.
/// Used by the cross-repo activity feed — one call per repo, merged and
/// time-sorted on the frontend side. HEAD-only on purpose: "what's on
/// my main branch" is the useful default for a multi-repo overview;
/// other-branch activity can layer on later via a UI filter.
pub fn activity_since(
    repo_path: &Path,
    days_back: u32,
    limit: u32,
) -> Result<Vec<Commit>, GitError> {
    let format = format!("%H{SEP}%h{SEP}%an{SEP}%aI{SEP}%s{REC}");
    let n = format!("-n{limit}");
    // `--since` accepts "N.days" / "N.days.ago" / absolute dates. We use
    // the fractional days form so a value of 0 still returns today's
    // commits (git treats "0.days" as "from right now going backward" —
    // which matches the caller's intent when they clamp to at least 1).
    let since = format!("--since={days_back}.days.ago");
    let out = run_git(
        repo_path,
        &[
            "log",
            &n,
            &since,
            &format!("--pretty=format:{format}"),
            "HEAD",
        ],
    )?;
    parse_log(&out.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_multi_commit() {
        let raw = format!(
            "abc123{SEP}abc{SEP}Anders{SEP}2026-04-18T12:00:00+02:00{SEP}first line{REC}\
             def456{SEP}def{SEP}Other{SEP}2026-04-17T09:30:00+02:00{SEP}second\ncommit{REC}"
        );
        let parsed = parse_log(&raw).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].sha, "abc123");
        assert_eq!(parsed[0].sha_short, "abc");
        assert_eq!(parsed[0].author, "Anders");
        assert_eq!(parsed[0].message, "first line");
        assert_eq!(parsed[1].sha, "def456");
        assert_eq!(parsed[1].message, "second\ncommit");
    }
}
