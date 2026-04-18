use super::runner::{run_git, run_git_raw, GitError};
use crate::models::{ChangedFile, ChangedFiles, Dirty, DirtyBreakdown};
use std::path::Path;

pub fn current_branch(repo_path: &Path) -> Result<String, GitError> {
    let out = run_git(repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    Ok(out.stdout.trim().to_string())
}

/// Full 40-char SHA at HEAD. Returns `Ok(None)` on an unborn branch
/// (fresh repo with no commits yet) rather than an error, so callers can
/// log that state as "no HEAD" instead of failing.
pub fn current_head_sha(repo_path: &Path) -> Result<Option<String>, GitError> {
    let out = run_git_raw(repo_path, &["rev-parse", "HEAD"])?;
    if out.code != 0 {
        return Ok(None);
    }
    let sha = out.stdout.trim();
    if sha.is_empty() {
        return Ok(None);
    }
    Ok(Some(sha.to_string()))
}

/// Total number of commits reachable from HEAD. Returns `Ok(None)` on an
/// unborn branch or any other failure — the caller (status builder) just
/// omits the field so the UI falls back gracefully.
pub fn commit_count(repo_path: &Path) -> Result<Option<u32>, GitError> {
    let out = run_git_raw(repo_path, &["rev-list", "--count", "HEAD"])?;
    if out.code != 0 {
        return Ok(None);
    }
    let n = out.stdout.trim();
    if n.is_empty() {
        return Ok(None);
    }
    Ok(n.parse().ok())
}

/// Count of commits reachable from `from_sha` but not from `to_sha`.
/// Used to report how many local commits a force-pull would discard.
pub fn rev_count_between(
    repo_path: &Path,
    from_sha: &str,
    to_sha: &str,
) -> Result<u32, GitError> {
    let range = format!("{to_sha}..{from_sha}");
    let out = run_git_raw(repo_path, &["rev-list", "--count", &range])?;
    if out.code != 0 {
        return Ok(0);
    }
    Ok(out.stdout.trim().parse().unwrap_or(0))
}

pub fn default_branch(repo_path: &Path) -> Result<String, GitError> {
    // Preferred: origin/HEAD symbolic ref.
    if let Ok(out) =
        run_git(repo_path, &["symbolic-ref", "refs/remotes/origin/HEAD"])
    {
        let trimmed = out.stdout.trim();
        if let Some(short) = trimmed.rsplit('/').next() {
            if !short.is_empty() && short != "HEAD" {
                return Ok(short.to_string());
            }
        }
    }
    // Fallback: check for main, then master.
    for candidate in ["main", "master"] {
        let out = run_git_raw(
            repo_path,
            &[
                "show-ref",
                "--verify",
                "--quiet",
                &format!("refs/heads/{candidate}"),
            ],
        )?;
        if out.code == 0 {
            return Ok(candidate.to_string());
        }
    }
    // Last resort: whatever HEAD points at.
    current_branch(repo_path)
}

/// Returns (ahead, behind, has_upstream) vs the configured upstream.
pub fn ahead_behind(repo_path: &Path) -> Result<(u32, u32, bool), GitError> {
    let out = run_git_raw(
        repo_path,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )?;
    if out.code != 0 {
        return Ok((0, 0, false));
    }
    let line = out.stdout.trim();
    let mut parts = line.split_whitespace();
    let ahead: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let behind: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    Ok((ahead, behind, true))
}

/// Parse `git status --porcelain=v1 -z`.
/// Classifies repo into a single Dirty summary per the spec.
/// Rules:
///   - clean: zero entries
///   - untracked: ALL entries are "??"
///   - staged: at least one entry has non-space X (staged) and no unstaged changes
///   - unstaged: at least one entry has non-space Y (unstaged) and no staged changes
///   - mixed: both staged and unstaged changes are present (or a mix with untracked)
pub fn dirty_from_porcelain(repo_path: &Path) -> Result<Dirty, GitError> {
    let out = run_git(repo_path, &["status", "--porcelain=v1", "-z"])?;
    if out.stdout.is_empty() {
        return Ok(Dirty::Clean);
    }

    let mut has_staged = false;
    let mut has_unstaged = false;
    let mut has_untracked = false;
    let mut total = 0usize;

    // NUL-delimited. Each record is "XY path\0" (or "XY path\0orig\0" for renames).
    // We only need the XY, so we split on NUL and read the two chars.
    let mut iter = out.stdout.split('\0').peekable();
    while let Some(record) = iter.next() {
        if record.is_empty() {
            continue;
        }
        if record.len() < 2 {
            continue;
        }
        total += 1;
        let bytes = record.as_bytes();
        let x = bytes[0] as char;
        let y = bytes[1] as char;
        if x == '?' && y == '?' {
            has_untracked = true;
            continue;
        }
        // Rename/copy entries include the original path as the next NUL-delimited chunk.
        if x == 'R' || x == 'C' {
            iter.next();
        }
        if x != ' ' && x != '?' {
            has_staged = true;
        }
        if y != ' ' && y != '?' {
            has_unstaged = true;
        }
    }

    if total == 0 {
        return Ok(Dirty::Clean);
    }
    if has_staged && has_unstaged {
        return Ok(Dirty::Mixed);
    }
    if has_staged && has_untracked {
        return Ok(Dirty::Mixed);
    }
    if has_unstaged && has_untracked {
        return Ok(Dirty::Mixed);
    }
    if has_staged {
        return Ok(Dirty::Staged);
    }
    if has_unstaged {
        return Ok(Dirty::Unstaged);
    }
    if has_untracked {
        return Ok(Dirty::Untracked);
    }
    Ok(Dirty::Clean)
}

/// Per-category counts from porcelain output. Counts FILES, not entries —
/// a single file with both staged and unstaged changes contributes 1 to
/// both `staged` and `unstaged`.
pub fn dirty_breakdown(repo_path: &Path) -> Result<DirtyBreakdown, GitError> {
    let out = run_git(repo_path, &["status", "--porcelain=v1", "-z"])?;
    let mut bd = DirtyBreakdown::default();

    let mut iter = out.stdout.split('\0').peekable();
    while let Some(record) = iter.next() {
        if record.is_empty() || record.len() < 2 {
            continue;
        }
        let bytes = record.as_bytes();
        let x = bytes[0] as char;
        let y = bytes[1] as char;
        if x == '?' && y == '?' {
            bd.untracked += 1;
            continue;
        }
        if x == 'R' || x == 'C' {
            iter.next();
        }
        if x != ' ' && x != '?' {
            bd.staged += 1;
        }
        if y != ' ' && y != '?' {
            bd.unstaged += 1;
        }
    }

    Ok(bd)
}

/// True if the repo declares submodules via a `.gitmodules` file. Pure
/// filesystem check — no git subprocess.
pub fn has_submodules(repo_path: &Path) -> bool {
    repo_path.join(".gitmodules").exists()
}

/// List changed files from porcelain output, capped at `limit`. Always
/// walks the full output so `total` is accurate even when truncated.
pub fn changed_files(repo_path: &Path, limit: u32) -> Result<ChangedFiles, GitError> {
    let out = run_git(repo_path, &["status", "--porcelain=v1", "-z"])?;
    let mut files: Vec<ChangedFile> = Vec::new();
    let mut total: u32 = 0;

    let mut iter = out.stdout.split('\0').peekable();
    while let Some(record) = iter.next() {
        if record.is_empty() || record.len() < 3 {
            continue;
        }
        let bytes = record.as_bytes();
        let x = bytes[0] as char;
        let y = bytes[1] as char;
        // Format: "XY<space>path" — byte 2 is the separator space.
        let path = String::from_utf8_lossy(&bytes[3..]).to_string();
        let orig = if x == 'R' || x == 'C' {
            iter.next().map(|s| s.to_string())
        } else {
            None
        };
        total += 1;
        if files.len() < limit as usize {
            files.push(ChangedFile {
                path,
                orig_path: orig,
                x: x.to_string(),
                y: y.to_string(),
            });
        }
    }

    Ok(ChangedFiles {
        truncated: total as usize > files.len(),
        total,
        files,
    })
}

/// Short SHA of a remote ref (e.g. `origin/main`). Returns None if it
/// doesn't resolve — caller treats that as "remote not known locally."
pub fn ref_short_sha(repo_path: &Path, ref_name: &str) -> Result<Option<String>, GitError> {
    let out = run_git_raw(repo_path, &["rev-parse", "--short", ref_name])?;
    if out.code != 0 {
        return Ok(None);
    }
    let sha = out.stdout.trim();
    if sha.is_empty() {
        return Ok(None);
    }
    Ok(Some(sha.to_string()))
}

#[cfg(test)]
mod tests {
    // Pure-parser tests would go against a captured porcelain string; the current
    // implementation runs git directly. Kept as a reminder that the classification
    // rules above should match these cases:
    //   "" -> Clean
    //   "?? foo\0" -> Untracked
    //   "M  foo\0" -> Staged
    //   " M foo\0" -> Unstaged
    //   "M  foo\0?? bar\0" -> Mixed (staged + untracked)
    //   "MM foo\0" -> Mixed (staged + unstaged on same file)
}
