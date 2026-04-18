import { Activity, ExternalLink, Folder, Loader2, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { firstLine, timeAgo, truncate } from "../../lib/format";
import * as api from "../../lib/tauri";
import { useUiStore } from "../../stores/uiStore";
import type { ActivityEntry } from "../../types";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Pill } from "../ui/Pill";

const DAY_WINDOWS: { value: number; label: string }[] = [
  { value: 1, label: "24h" },
  { value: 7, label: "7d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
];

/** Bucket ISO timestamp into a human-friendly day header. */
function dayBucket(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "Older";
  const now = new Date();
  const then = new Date(t);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(now, then)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(yesterday, then)) return "Yesterday";
  // Within the last 7 days → "Mon 14"
  const diffDays = Math.floor((now.getTime() - t) / 86_400_000);
  if (diffDays < 7) {
    return then.toLocaleDateString([], { weekday: "short", day: "numeric" });
  }
  return then.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ActivityFeedDialog() {
  const dialog = useUiStore((s) => s.dialog);
  const closeDialog = useUiStore((s) => s.closeDialog);
  const open = dialog?.kind === "activityFeed";

  const [days, setDays] = useState(7);
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoFilter, setRepoFilter] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getActivityFeed(days);
      setEntries(result);
    } catch (e) {
      setError(String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  // Reset filter when closing so a fresh open starts unbiased.
  useEffect(() => {
    if (!open) {
      setRepoFilter(null);
    }
  }, [open]);

  const visible = useMemo(() => {
    if (repoFilter === null) return entries;
    return entries.filter((e) => e.repoId === repoFilter);
  }, [entries, repoFilter]);

  const repoCounts = useMemo(() => {
    const m = new Map<number, { name: string; count: number }>();
    for (const e of entries) {
      const cur = m.get(e.repoId);
      if (cur) cur.count += 1;
      else m.set(e.repoId, { name: e.repoName, count: 1 });
    }
    return Array.from(m.entries())
      .map(([id, v]) => ({ id, name: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count);
  }, [entries]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ActivityEntry[]>();
    for (const e of visible) {
      const bucket = dayBucket(e.timestamp);
      const arr = groups.get(bucket);
      if (arr) arr.push(e);
      else groups.set(bucket, [e]);
    }
    return Array.from(groups.entries());
  }, [visible]);

  async function openCommit(entry: ActivityEntry) {
    try {
      await api.openCommit(entry.repoId, entry.sha);
    } catch {
      /* swallow: openCommit falls back silently if no web URL */
    }
  }

  return (
    <Dialog
      open={open}
      onClose={closeDialog}
      title="Activity across all repos"
      wide
      footer={
        <>
          <span className="mr-auto text-[11px] text-zinc-500">
            HEAD-only. Feature-branch activity isn't shown.
          </span>
          <Button onClick={closeDialog}>Close</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" style={{ maxHeight: "75vh" }}>
        <div className="flex flex-wrap items-center gap-2">
          <Activity size={14} className="text-zinc-500" />
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">
            Window
          </span>
          {DAY_WINDOWS.map((w) => (
            <button
              key={w.value}
              type="button"
              onClick={() => setDays(w.value)}
              className={`rounded-md border px-2 py-0.5 text-xs ${
                days === w.value
                  ? "border-blue-500/50 bg-blue-500/10 text-blue-200"
                  : "border-border bg-surface-2 text-zinc-300 hover:bg-surface-3"
              }`}
            >
              {w.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-zinc-500">
              {loading
                ? "loading…"
                : `${visible.length} commit${visible.length === 1 ? "" : "s"}`}
            </span>
            <IconButton
              title="Reload activity feed"
              onClick={() => load()}
              disabled={loading}
            >
              {loading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCcw size={14} />
              )}
            </IconButton>
          </div>
        </div>

        {repoCounts.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">
              Repos
            </span>
            <button
              type="button"
              onClick={() => setRepoFilter(null)}
              className={`rounded-md border px-2 py-0.5 text-[11px] ${
                repoFilter === null
                  ? "border-blue-500/50 bg-blue-500/10 text-blue-200"
                  : "border-border bg-surface-2 text-zinc-300 hover:bg-surface-3"
              }`}
            >
              All ({entries.length})
            </button>
            {repoCounts.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRepoFilter(r.id)}
                className={`rounded-md border px-2 py-0.5 text-[11px] ${
                  repoFilter === r.id
                    ? "border-blue-500/50 bg-blue-500/10 text-blue-200"
                    : "border-border bg-surface-2 text-zinc-300 hover:bg-surface-3"
                }`}
              >
                {r.name} ({r.count})
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto rounded-md border border-border bg-surface-0">
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-zinc-400">
              <Loader2 size={14} className="animate-spin" /> Loading activity…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-zinc-400">
              <Activity size={28} className="text-zinc-600" />
              <div>No commits in the last {days} day{days === 1 ? "" : "s"}.</div>
              {repoFilter !== null && (
                <button
                  type="button"
                  onClick={() => setRepoFilter(null)}
                  className="text-xs text-blue-300 hover:underline"
                >
                  Clear repo filter
                </button>
              )}
            </div>
          ) : (
            grouped.map(([bucket, rows]) => (
              <div key={bucket}>
                <div className="sticky top-0 z-10 bg-surface-0 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 backdrop-blur">
                  {bucket}{" "}
                  <span className="font-normal text-zinc-500">
                    ({rows.length})
                  </span>
                </div>
                {rows.map((e) => (
                  <div
                    key={`${e.repoId}:${e.sha}`}
                    className="flex items-start gap-3 border-t border-border px-3 py-2 hover:bg-surface-1"
                  >
                    <Pill
                      tone="neutral"
                      icon={<Folder size={11} />}
                      title={`Repo: ${e.repoName}`}
                    >
                      {e.repoName}
                    </Pill>
                    <button
                      type="button"
                      onClick={() => openCommit(e)}
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-400 hover:text-blue-300"
                      title="Open this commit in the remote (GitHub, GitLab, Azure, Bitbucket)"
                    >
                      {e.shaShort}
                      <ExternalLink size={10} className="opacity-60" />
                    </button>
                    <div className="min-w-0 flex-1 text-xs">
                      <div className="truncate text-zinc-200" title={e.message}>
                        {truncate(firstLine(e.message), 120)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-zinc-500">
                        {e.author} · {timeAgo(e.timestamp)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
