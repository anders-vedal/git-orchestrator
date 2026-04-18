//! Cross-repo activity feed: "what happened across my 7 repos this week?"
//!
//! One `git log --since=N.days HEAD` per repo, results merged and time-sorted.
//! HEAD-only on purpose — the feed's primary job is to surface main-branch
//! landings (merged PRs, pipeline-flow auto-commits, squash-merges).
//! Feature-branch or remote-ref views can layer on later via a UI filter.
//!
//! Scale: on a 10-repo dashboard with a 7-day window, this runs in well
//! under a second because each `git log` is a tiny process + a bounded
//! output. No network access.

use crate::db;
use crate::git::log;
use crate::models::ActivityEntry;
use std::path::Path;

/// Upper cap on per-repo commit count. Protects against a runaway repo
/// that gets 1000 commits a day spamming the feed and burying everything
/// else. 50 per repo × 10 repos = 500 entries, which renders instantly.
const PER_REPO_HARD_CAP: u32 = 200;

/// Lower bound on the days window — `0` is a legal git value but makes
/// the feed always-empty which is confusing; clamp upward.
const MIN_DAYS: u32 = 1;
const MAX_DAYS: u32 = 365;

#[tauri::command]
pub async fn get_activity_feed(
    days: u32,
    limit_per_repo: Option<u32>,
) -> Result<Vec<ActivityEntry>, String> {
    let days = days.clamp(MIN_DAYS, MAX_DAYS);
    let limit = limit_per_repo.unwrap_or(50).clamp(1, PER_REPO_HARD_CAP);

    let repos = db::with_conn(|c| crate::db::queries::list_repos(c))?;

    // Parallel fan-out, one blocking task per repo — same pattern as
    // refresh_all_statuses. Failures for individual repos are swallowed
    // (empty vec) so one broken working copy can't break the whole feed.
    let handles: Vec<_> = repos
        .into_iter()
        .map(|r| {
            tokio::task::spawn_blocking(move || {
                let p = Path::new(&r.path);
                let commits = log::activity_since(p, days, limit).unwrap_or_default();
                commits
                    .into_iter()
                    .map(|c| ActivityEntry {
                        repo_id: r.id,
                        repo_name: r.name.clone(),
                        sha: c.sha,
                        sha_short: c.sha_short,
                        author: c.author,
                        timestamp: c.timestamp,
                        message: c.message,
                    })
                    .collect::<Vec<_>>()
            })
        })
        .collect();

    let mut all = Vec::new();
    for h in handles {
        if let Ok(entries) = h.await {
            all.extend(entries);
        }
    }

    // Newest first — git log output is already sorted within each repo,
    // but we need a merge sort across repos. RFC3339 sorts lexicographically
    // the same as chronologically, so string comparison is safe here.
    all.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(all)
}
