/** Helpers for the auto-fetch feature: interval labels, schedule
 *  descriptions, next-fire prediction for the sidebar readout.
 *
 *  The BACKEND is authoritative for when auto-fetch actually fires
 *  (see src-tauri/src/commands/auto_fetch.rs::next_fire). The UI-side
 *  `predictNextFire` below mirrors that logic for display purposes only
 *  — if it drifts from the Rust version the user sees a slightly-off
 *  "next" hint, which is acceptable; the real schedule keeps running.
 */
import { AUTO_FETCH_INTERVALS_SEC, type Settings } from "../types";

export interface IntervalOption {
  value: number;
  label: string;
  /** Whether the UI should show the anchor time/day picker for this
   *  interval. For 5/15/30 min an anchor is meaningless — fires every
   *  N seconds from app start. */
  showAnchor: boolean;
  /** Whether the weekly day-of-week picker applies (7-day cadence only). */
  showDayOfWeek: boolean;
}

export const INTERVAL_OPTIONS: IntervalOption[] = AUTO_FETCH_INTERVALS_SEC.map(
  (value): IntervalOption => {
    const hours = value / 3600;
    let label: string;
    if (value < 3600) label = `${value / 60} minutes`;
    else if (value === 3600) label = "1 hour";
    else if (value < 86_400) label = `${hours} hours`;
    else if (value === 86_400) label = "24 hours (daily)";
    else label = `${value / 86_400} days`;
    return {
      value,
      label,
      showAnchor: value >= 3600,
      showDayOfWeek: value >= 7 * 86_400,
    };
  },
);

export function findIntervalOption(sec: number): IntervalOption | null {
  return INTERVAL_OPTIONS.find((o) => o.value === sec) ?? null;
}

const DOW_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

/** Human-readable one-liner describing the current auto-fetch schedule,
 *  e.g. "every 15 minutes" or "every Monday at 08:00". */
export function describeSchedule(settings: Settings): string {
  if (!settings.autoFetchEnabled) return "disabled";
  const opt = findIntervalOption(settings.autoFetchIntervalSec);
  const hours = settings.autoFetchIntervalSec / 3600;
  const baseLabel = opt?.label ?? `${settings.autoFetchIntervalSec}s`;

  const hh = settings.autoFetchAnchorHour;
  const mm = settings.autoFetchAnchorMinute ?? 0;

  if (!opt?.showAnchor || hh === null) {
    // No anchor — simple "every N minutes".
    return `every ${baseLabel.replace(/ \(daily\)/, "")}`;
  }

  const timeStr = `${pad2(hh)}:${pad2(mm)}`;

  if (opt.showDayOfWeek && settings.autoFetchAnchorDow !== null) {
    return `every ${DOW_LABELS[settings.autoFetchAnchorDow]} at ${timeStr}`;
  }
  if (hours >= 24) return `daily at ${timeStr}`;
  if (hours === 1) return `hourly at :${pad2(mm)}`;
  return `every ${hours} hours, anchored ${timeStr}`;
}

/** UI-side mirror of auto_fetch.rs::next_fire. Used only to render the
 *  sidebar's "next: Mon 08:00" hint — backend scheduling is authoritative.
 *  Returns a Date in the user's local timezone (anchor is stored as UTC
 *  hour/minute but rendered in local time for the readout). */
export function predictNextFire(settings: Settings, now: Date = new Date()): Date | null {
  if (!settings.autoFetchEnabled) return null;
  const interval = settings.autoFetchIntervalSec * 1000;
  if (interval <= 0) return null;

  const last = settings.autoFetchLastRunAt
    ? new Date(settings.autoFetchLastRunAt)
    : null;
  const hasAnchor = settings.autoFetchAnchorHour !== null;

  if (!hasAnchor) {
    return new Date((last ?? now).getTime() + interval);
  }

  const anchor = computeAnchor(settings, now);
  if (!anchor) return null;

  const reference = last ?? new Date(now.getTime() - interval);
  let candidate = anchor.getTime();
  let hops = 0;
  while (candidate <= reference.getTime() && hops < 10_000) {
    candidate += interval;
    hops += 1;
  }
  return new Date(candidate);
}

/** Find the anchor timestamp near `now` — for weekly anchors, the most
 *  recent matching weekday at HH:MM; for sub-daily anchors, today at HH:MM.
 *  Anchor hour/minute are stored and interpreted as UTC so weekly
 *  alignment survives a laptop that travels between timezones. */
function computeAnchor(settings: Settings, now: Date): Date | null {
  const hh = settings.autoFetchAnchorHour;
  const mm = settings.autoFetchAnchorMinute ?? 0;
  if (hh === null) return null;

  if (settings.autoFetchAnchorDow !== null) {
    // Walk back at most 7 days (UTC) to find the weekday match.
    let d = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        hh,
        mm,
        0,
        0,
      ),
    );
    for (let i = 0; i <= 7; i += 1) {
      if (d.getUTCDay() === settings.autoFetchAnchorDow) return d;
      d = new Date(d.getTime() - 86_400_000);
    }
    return null;
  }
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hh,
      mm,
      0,
      0,
    ),
  );
}

/** Short relative-date label for the "next run" hint in the sidebar
 *  — e.g. "in 3h", "tomorrow 08:00", "Mon 08:00". Goes UTC → local for
 *  display so the user reads it in their own clock. */
export function formatNextFire(next: Date, now: Date = new Date()): string {
  const diff = next.getTime() - now.getTime();
  if (diff <= 0) return "any moment";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  const days = Math.round(hrs / 24);
  const time = `${pad2(next.getHours())}:${pad2(next.getMinutes())}`;
  if (days === 1) return `tomorrow ${time}`;
  if (days < 7) return `${DOW_SHORT[next.getDay()]} ${time}`;
  return next.toISOString().slice(0, 10);
}
