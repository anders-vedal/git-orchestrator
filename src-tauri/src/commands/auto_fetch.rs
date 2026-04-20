//! Scheduled background fetch. Unlike the frontend auto-refresh loop
//! (which only reads local `git status`), auto-fetch actually talks to
//! remotes. Invariant: it NEVER mutates the working tree beyond a
//! fast-forward merge — dirty repos, off-default repos, and diverged
//! repos are fetch-only (refs updated, working tree untouched).
//!
//! The scheduler runs in-process as a tokio task (kicked off from
//! `lib.rs::setup`). It ticks every 30s, re-reads settings each time,
//! and fires a round when `now >= next_fire`. Settings changes are
//! picked up naturally because the loop rereads them every tick.

use crate::commands::git_ops::{git_fetch_all, git_pull_all_safe};
use crate::db;
use crate::models::{BulkPullReport, BulkResult};
use chrono::{DateTime, Datelike, Duration, TimeZone, Utc, Weekday};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Event emitted when an auto-fetch round completes. Sidebar listens to
/// update the "last auto-fetch" readout.
pub const EVENT_AUTO_FETCH_COMPLETE: &str = "auto-fetch-complete";

/// Settings key holding the ISO8601 timestamp of the most recent
/// auto-fetch run. Empty / missing = never run.
const KEY_LAST_RUN_AT: &str = "auto_fetch_last_run_at";
const KEY_ENABLED: &str = "auto_fetch_enabled";
const KEY_INTERVAL_SEC: &str = "auto_fetch_interval_sec";
const KEY_ANCHOR_DOW: &str = "auto_fetch_anchor_dow";
const KEY_ANCHOR_HOUR: &str = "auto_fetch_anchor_hour";
const KEY_ANCHOR_MINUTE: &str = "auto_fetch_anchor_minute";

/// Report sent back to the frontend when an auto-fetch round finishes.
/// Embeds the two bulk reports verbatim so the UI can count successes
/// without parsing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoFetchReport {
    /// UTC ISO8601 timestamp when the round started.
    #[serde(rename = "ranAt")]
    pub ran_at: String,
    /// Duration in milliseconds.
    #[serde(rename = "durationMs")]
    pub duration_ms: i64,
    /// Per-repo fetch outcomes. Every repo is attempted — fetch is
    /// non-destructive.
    pub fetched: Vec<BulkResult>,
    /// Per-repo FF-pull outcomes, split into updated/skipped/blocked.
    /// Only the "safe" subset (on default + clean) gets pulled.
    pub pulled: BulkPullReport,
}

/// Fire one auto-fetch round. Fetches every repo, then FF-pulls the
/// subset that's safe (on default branch, clean working tree). Emits
/// [`EVENT_AUTO_FETCH_COMPLETE`] when done and persists the finish
/// time under `auto_fetch_last_run_at`.
///
/// Callable from the frontend too (for a manual "Run now" button).
#[tauri::command]
pub async fn auto_fetch_run_once(app: AppHandle) -> Result<AutoFetchReport, String> {
    let ran_at = Utc::now();
    let t0 = std::time::Instant::now();

    // Fetch first — updates tracking refs for every repo including dirty /
    // off-default ones, so the dashboard can still show "behind" pills.
    let fetched = git_fetch_all(None).await?;

    // Then FF-pull the safe subset. This call re-fetches internally via
    // `git pull --ff-only` — harmless redundancy in exchange for reusing
    // the existing safe-pull classifier.
    let pulled = git_pull_all_safe(None).await?;

    let finished_at = Utc::now();
    let finished_iso = finished_at.to_rfc3339();

    // Persist the finish time so the next tick computes the correct
    // next_fire and the sidebar can show "last auto-fetch: Xm ago".
    if let Err(e) = db::with_conn(|c| {
        db::queries::set_setting(c, KEY_LAST_RUN_AT, &finished_iso)
    }) {
        eprintln!("[auto-fetch] failed to persist last_run_at: {e}");
    }

    let report = AutoFetchReport {
        ran_at: ran_at.to_rfc3339(),
        duration_ms: t0.elapsed().as_millis() as i64,
        fetched,
        pulled,
    };

    // Fire-and-forget event. If the frontend missed it (window closed),
    // the sidebar reads last_run_at from settings on next open anyway.
    let _ = app.emit(EVENT_AUTO_FETCH_COMPLETE, &report);

    Ok(report)
}

/// Start the background scheduler. Called once from `lib.rs::setup`.
/// The task runs for the lifetime of the app process and exits when
/// tokio's runtime shuts down.
pub fn spawn_scheduler(app: AppHandle) {
    tokio::spawn(async move {
        scheduler_loop(app).await;
    });
}

async fn scheduler_loop(app: AppHandle) {
    // Tick cadence. Short enough that a 5-min interval setting actually
    // fires within ~30s of its scheduled time; long enough that the
    // settings re-read cost is negligible.
    const TICK: std::time::Duration = std::time::Duration::from_secs(30);

    loop {
        tokio::time::sleep(TICK).await;

        let cfg = match read_schedule_config() {
            Some(c) if c.enabled => c,
            _ => continue,
        };

        let now = Utc::now();
        let last_run = parse_last_run();
        let next = next_fire(&cfg, last_run, now);

        if now < next {
            continue;
        }

        // Fire. Errors are logged, not propagated — the loop keeps
        // running so a transient failure doesn't stop future rounds.
        match auto_fetch_run_once(app.clone()).await {
            Ok(r) => {
                eprintln!(
                    "[auto-fetch] ran in {}ms: {} fetched, {} pulled, {} skipped, {} blocked",
                    r.duration_ms,
                    r.fetched.iter().filter(|f| f.ok).count(),
                    r.pulled.updated.len(),
                    r.pulled.skipped.len(),
                    r.pulled.blocked.len(),
                );
            }
            Err(e) => eprintln!("[auto-fetch] round failed: {e}"),
        }
    }
}

/// Schedule configuration read once per tick from the settings table.
#[derive(Debug, Clone)]
pub struct ScheduleConfig {
    pub enabled: bool,
    pub interval_sec: i64,
    /// Day-of-week anchor (0=Sun..6=Sat). Only used when the interval
    /// is >= 1 day. `None` means "no day anchor" — applies when the
    /// interval is below 24h.
    pub anchor_dow: Option<u32>,
    /// Hour-of-day anchor (0..23). Present whenever the interval is
    /// >= 1 hour.
    pub anchor_hour: Option<u32>,
    /// Minute-of-hour anchor (0..59).
    pub anchor_minute: Option<u32>,
}

fn read_schedule_config() -> Option<ScheduleConfig> {
    let get = |k: &str| db::with_conn(|c| db::queries::get_setting(c, k)).ok().flatten();
    let enabled = matches!(get(KEY_ENABLED).as_deref(), Some("1") | Some("true"));
    if !enabled {
        return Some(ScheduleConfig {
            enabled: false,
            interval_sec: 0,
            anchor_dow: None,
            anchor_hour: None,
            anchor_minute: None,
        });
    }
    let interval_sec = get(KEY_INTERVAL_SEC)
        .and_then(|s| s.parse::<i64>().ok())
        .filter(|n| *n > 0)?;
    let anchor_dow = get(KEY_ANCHOR_DOW)
        .and_then(|s| s.parse::<u32>().ok())
        .filter(|n| *n <= 6);
    let anchor_hour = get(KEY_ANCHOR_HOUR)
        .and_then(|s| s.parse::<u32>().ok())
        .filter(|n| *n <= 23);
    let anchor_minute = get(KEY_ANCHOR_MINUTE)
        .and_then(|s| s.parse::<u32>().ok())
        .filter(|n| *n <= 59);

    Some(ScheduleConfig {
        enabled: true,
        interval_sec,
        anchor_dow,
        anchor_hour,
        anchor_minute,
    })
}

fn parse_last_run() -> Option<DateTime<Utc>> {
    db::with_conn(|c| db::queries::get_setting(c, KEY_LAST_RUN_AT))
        .ok()
        .flatten()
        .filter(|s| !s.is_empty())
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&Utc))
}

/// Compute when the next auto-fetch round should fire.
///
/// Rules:
/// - **No anchor set** (short intervals): fire `last_run + interval`. If
///   there's no last_run, fire `now + interval` so a just-opened app
///   doesn't race-fire at t=0.
/// - **Anchor set**: fire at the smallest `anchor + k*interval` that is
///   strictly after the *threshold*. For a repeat run the threshold is
///   `last_run` (so we advance exactly one period). For a first-ever
///   run the threshold is `now` (so we wait until the next future
///   anchor slot rather than firing immediately on app launch).
///
/// `k` is computed directly via `div_euclid` so a laptop that was asleep
/// for weeks still advances by *one* interval per round — the scheduler
/// catches up on its next tick rather than all at once. Pure function;
/// tested in the module below.
pub fn next_fire(
    cfg: &ScheduleConfig,
    last_run: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> DateTime<Utc> {
    let interval = Duration::seconds(cfg.interval_sec);
    let anchor = resolve_anchor_near(cfg, now);

    match anchor {
        Some(base) => {
            let threshold = last_run.unwrap_or(now);
            let diff_sec = (threshold - base).num_seconds();
            // Smallest integer k such that base + k*interval > threshold.
            // div_euclid floors toward -inf, so it handles the
            // threshold-before-base (k negative) case too.
            let k = diff_sec.div_euclid(cfg.interval_sec) + 1;
            base + Duration::seconds(k * cfg.interval_sec)
        }
        None => match last_run {
            Some(last) => last + interval,
            None => now + interval,
        },
    }
}

/// Pick the calendar timestamp that the anchor describes, near `now`.
/// Returns None when the schedule has no anchor at all (short intervals).
///
/// Strategy: pick the next occurrence at-or-after `now - 7 days` so
/// `next_fire`'s slide loop has room to land on the correct forward
/// slot. The 7-day back-off covers the weekly anchor case.
fn resolve_anchor_near(
    cfg: &ScheduleConfig,
    now: DateTime<Utc>,
) -> Option<DateTime<Utc>> {
    let hour = cfg.anchor_hour?;
    let minute = cfg.anchor_minute.unwrap_or(0);

    match cfg.anchor_dow {
        Some(dow) => {
            // Weekly anchor: snap back to last occurrence of `dow` at
            // hour:minute, relative to `now`. Slide forward happens in
            // the caller.
            let target_weekday = weekday_from_u32(dow)?;
            let today = now.date_naive();
            let mut candidate_date = today;
            // Walk back at most 7 days to find the latest `target_weekday`.
            for _ in 0..=7 {
                if candidate_date.weekday() == target_weekday {
                    break;
                }
                candidate_date = candidate_date.pred_opt()?;
            }
            let dt = Utc
                .with_ymd_and_hms(
                    candidate_date.year(),
                    candidate_date.month(),
                    candidate_date.day(),
                    hour,
                    minute,
                    0,
                )
                .single()?;
            Some(dt)
        }
        None => {
            // Daily / sub-daily anchor: snap to today at hour:minute,
            // then let the caller slide forward if it's already past.
            Utc.with_ymd_and_hms(now.year(), now.month(), now.day(), hour, minute, 0)
                .single()
        }
    }
}

fn weekday_from_u32(dow: u32) -> Option<Weekday> {
    // Keep this in sync with the JS convention exposed to the frontend:
    // 0 = Sunday, ..., 6 = Saturday.
    match dow {
        0 => Some(Weekday::Sun),
        1 => Some(Weekday::Mon),
        2 => Some(Weekday::Tue),
        3 => Some(Weekday::Wed),
        4 => Some(Weekday::Thu),
        5 => Some(Weekday::Fri),
        6 => Some(Weekday::Sat),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(interval_sec: i64, dow: Option<u32>, hour: Option<u32>, min: Option<u32>) -> ScheduleConfig {
        ScheduleConfig {
            enabled: true,
            interval_sec,
            anchor_dow: dow,
            anchor_hour: hour,
            anchor_minute: min,
        }
    }

    fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, h, min, 0).single().unwrap()
    }

    #[test]
    fn short_interval_no_anchor_first_run() {
        // 5 min, never run: fire 5 min from now (not instantly).
        let c = cfg(300, None, None, None);
        let now = at(2026, 4, 20, 12, 0);
        let next = next_fire(&c, None, now);
        assert_eq!(next, now + Duration::seconds(300));
    }

    #[test]
    fn short_interval_no_anchor_repeat() {
        let c = cfg(300, None, None, None);
        let last = at(2026, 4, 20, 12, 0);
        let now = at(2026, 4, 20, 12, 7);
        let next = next_fire(&c, Some(last), now);
        assert_eq!(next, last + Duration::seconds(300));
    }

    #[test]
    fn daily_anchor_first_run_today_before_anchor() {
        // Interval 24h, anchor 08:00, "now" is 06:00 with no prior run.
        // Should fire at 08:00 today.
        let c = cfg(86_400, None, Some(8), Some(0));
        let now = at(2026, 4, 20, 6, 0);
        let next = next_fire(&c, None, now);
        assert_eq!(next, at(2026, 4, 20, 8, 0));
    }

    #[test]
    fn daily_anchor_first_run_today_after_anchor() {
        // "now" is 09:00, anchor 08:00 — today's slot passed, next is
        // tomorrow 08:00.
        let c = cfg(86_400, None, Some(8), Some(0));
        let now = at(2026, 4, 20, 9, 0);
        let next = next_fire(&c, None, now);
        assert_eq!(next, at(2026, 4, 21, 8, 0));
    }

    #[test]
    fn daily_anchor_repeat_after_yesterdays_run() {
        // Ran yesterday at 08:00, interval 24h — fire today at 08:00.
        let c = cfg(86_400, None, Some(8), Some(0));
        let last = at(2026, 4, 19, 8, 0);
        let now = at(2026, 4, 20, 7, 59);
        let next = next_fire(&c, Some(last), now);
        assert_eq!(next, at(2026, 4, 20, 8, 0));
    }

    #[test]
    fn weekly_anchor_monday_08_00_from_tuesday() {
        // 7d anchor Mon 08:00. "now" is Tue 09:00. No prior run.
        // Expected: next Monday 08:00.
        // 2026-04-20 is a Monday, so 2026-04-21 is Tuesday.
        let c = cfg(7 * 86_400, Some(1), Some(8), Some(0));
        let now = at(2026, 4, 21, 9, 0);
        let next = next_fire(&c, None, now);
        assert_eq!(next, at(2026, 4, 27, 8, 0));
    }

    #[test]
    fn weekly_anchor_exact_match_does_not_fire_twice() {
        // Last run was exactly at the Monday 08:00 anchor.
        // next_fire must return the following Monday, not the same slot.
        let c = cfg(7 * 86_400, Some(1), Some(8), Some(0));
        let last = at(2026, 4, 20, 8, 0); // Mon
        let now = at(2026, 4, 20, 8, 0);
        let next = next_fire(&c, Some(last), now);
        assert_eq!(next, at(2026, 4, 27, 8, 0));
    }

    #[test]
    fn hourly_anchor_at_thirty_past() {
        // Interval 1h, anchor minute=30. Last run 12:30; next should be 13:30.
        let c = cfg(3_600, None, Some(12), Some(30));
        let last = at(2026, 4, 20, 12, 30);
        let now = at(2026, 4, 20, 13, 5);
        let next = next_fire(&c, Some(last), now);
        assert_eq!(next, at(2026, 4, 20, 13, 30));
    }

    #[test]
    fn missed_weeks_catches_up_on_next_occurrence() {
        // Laptop was off 3 weeks. "now" is Fri; weekly anchor is Mon 08:00.
        // Expected: most recent missed Mon 08:00 that is > reference.
        // With last_run=3 weeks ago, reference=last_run; the smallest
        // anchor+k*interval > reference that brings us into the future
        // window is the Monday after last_run.
        let c = cfg(7 * 86_400, Some(1), Some(8), Some(0));
        let last = at(2026, 3, 30, 8, 0); // Mon 3 weeks before
        let now = at(2026, 4, 24, 10, 0); // Fri
        let next = next_fire(&c, Some(last), now);
        // last + 7d = 2026-04-06 Mon 08:00 — still in the past vs now,
        // but next_fire's contract is "first slot after reference", and
        // the scheduler loop fires immediately when now >= next. The
        // loop then writes a new last_run and re-computes. So returning
        // 2026-04-06 is correct: the caller will fire and advance.
        assert_eq!(next, at(2026, 4, 6, 8, 0));
    }
}
