import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import * as api from "../lib/tauri";
import type { ChangedFile, ChangedFiles, RepoStatus } from "../types";

interface Props {
  status: RepoStatus;
}

interface Decoded {
  label: string;
  tone: "green" | "blue" | "yellow" | "red" | "neutral";
  title: string;
}

function decode(file: ChangedFile): Decoded {
  const x = file.x;
  const y = file.y;
  if (x === "?" && y === "?") {
    return {
      label: "untracked",
      tone: "yellow",
      title: "New file that git isn't tracking yet.",
    };
  }
  if (x === "!" && y === "!") {
    return {
      label: "ignored",
      tone: "neutral",
      title: "Matched by a .gitignore rule.",
    };
  }
  const staged = x !== " " && x !== "?";
  const unstaged = y !== " " && y !== "?";
  const both = staged && unstaged;
  const primary = unstaged ? y : x;
  const code: Record<string, { label: string; tone: Decoded["tone"] }> = {
    M: { label: "modified", tone: "yellow" },
    A: { label: "added", tone: "blue" },
    D: { label: "deleted", tone: "red" },
    R: { label: "renamed", tone: "blue" },
    C: { label: "copied", tone: "blue" },
    T: { label: "type changed", tone: "yellow" },
    U: { label: "conflict", tone: "red" },
  };
  const info = code[primary] ?? { label: primary, tone: "neutral" as const };
  return {
    label: both ? `${info.label} (staged+unstaged)` : info.label,
    tone: both ? "red" : unstaged ? info.tone : "blue",
    title:
      `Porcelain code "${x}${y}" — X=${staged ? "staged" : "·"}, ` +
      `Y=${unstaged ? "unstaged" : "·"}.`,
  };
}

const toneCls: Record<Decoded["tone"], string> = {
  green: "bg-green-900/40 text-green-300 border-green-800/60",
  blue: "bg-blue-900/40 text-blue-300 border-blue-800/60",
  yellow: "bg-yellow-900/40 text-yellow-300 border-yellow-800/60",
  red: "bg-red-900/40 text-red-300 border-red-800/60",
  neutral: "bg-surface-3 text-zinc-400 border-border",
};

export function RepoChangesPanel({ status }: Props) {
  const [data, setData] = useState<ChangedFiles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getChangedFiles(status.id, 100)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
  }, [status.id]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 border-t border-border bg-surface-1 px-4 py-2 text-xs text-zinc-400">
        <Loader2 size={12} className="animate-spin" />
        Loading changes…
      </div>
    );
  }
  if (error) {
    return (
      <div className="border-t border-border bg-surface-1 px-4 py-2 text-xs text-red-300">
        {error}
      </div>
    );
  }
  if (!data || data.total === 0) return null;

  return (
    <div className="border-t border-border bg-surface-1">
      <div className="flex items-center justify-between px-4 py-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
        <span>Working tree — {data.total} file{data.total === 1 ? "" : "s"}</span>
        {data.truncated && (
          <span className="text-zinc-500">
            showing first {data.files.length}
          </span>
        )}
      </div>
      <ul className="divide-y divide-border/70">
        {data.files.map((f) => {
          const d = decode(f);
          const display = f.origPath ? `${f.origPath} → ${f.path}` : f.path;
          return (
            <li
              key={`${f.x}${f.y}:${f.path}`}
              className="flex items-center gap-2 px-4 py-1 text-xs"
            >
              <span
                className={`inline-flex w-24 shrink-0 justify-center rounded border px-1 py-0.5 text-[10px] ${toneCls[d.tone]}`}
                title={d.title}
              >
                {d.label}
              </span>
              <span
                className="truncate font-mono text-zinc-300"
                title={display}
              >
                {display}
              </span>
            </li>
          );
        })}
      </ul>
      {data.truncated && (
        <div className="px-4 py-1.5 text-[11px] text-zinc-500">
          + {data.total - data.files.length} more not shown — open terminal for the full list.
        </div>
      )}
    </div>
  );
}
