import { open as openSystemDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getPlatform, type HostOS } from "../../lib/platform";
import * as api from "../../lib/tauri";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import type { IgnoredPath, Settings, TerminalPref, ThemePref } from "../../types";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

const TERMINAL_OPTIONS: Record<HostOS, { value: TerminalPref; label: string }[]> = {
  windows: [
    { value: "auto", label: "Auto (Windows Terminal → Git Bash → cmd)" },
    { value: "wt", label: "Windows Terminal (wt.exe)" },
    { value: "git-bash", label: "Git Bash" },
    { value: "cmd", label: "cmd.exe" },
  ],
  macos: [
    { value: "auto", label: "Auto (iTerm → Terminal)" },
    { value: "terminal", label: "Terminal" },
    { value: "iterm2", label: "iTerm2" },
  ],
  linux: [
    { value: "auto", label: "Auto (first available on PATH)" },
    { value: "gnome-terminal", label: "GNOME Terminal" },
    { value: "konsole", label: "Konsole (KDE)" },
    { value: "alacritty", label: "Alacritty" },
    { value: "kitty", label: "kitty" },
    { value: "xterm", label: "xterm" },
  ],
  other: [{ value: "auto", label: "Auto" }],
};

const DIR_PLACEHOLDERS: Record<HostOS, string> = {
  windows: "C:\\Projects",
  macos: "/Users/you/Projects",
  linux: "/home/you/projects",
  other: "",
};

export function SettingsDialog() {
  const dialog = useUiStore((s) => s.dialog);
  const close = useUiStore((s) => s.closeDialog);
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const open = dialog?.kind === "settings";

  const [draft, setDraft] = useState<Settings>(settings);
  const [busy, setBusy] = useState(false);
  const [ignored, setIgnored] = useState<IgnoredPath[]>([]);
  const [ignoredLoading, setIgnoredLoading] = useState(false);
  const [host, setHost] = useState<HostOS>("windows");

  useEffect(() => {
    let cancelled = false;
    void getPlatform().then((os) => {
      if (!cancelled) setHost(os);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const terminalOptions = TERMINAL_OPTIONS[host];
  const terminalValue = terminalOptions.some((o) => o.value === draft.terminal)
    ? draft.terminal
    : ("auto" as TerminalPref);

  const refreshIgnored = useCallback(async () => {
    setIgnoredLoading(true);
    try {
      setIgnored(await api.listIgnoredPaths());
    } finally {
      setIgnoredLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setDraft(settings);
      void refreshIgnored();
    }
  }, [open, settings, refreshIgnored]);

  async function unignore(path: string) {
    try {
      await api.unignorePath(path);
      await refreshIgnored();
    } catch {
      // keep the list as-is; the user can retry
    }
  }

  async function browse() {
    const path = await openSystemDialog({
      directory: true,
      multiple: false,
      defaultPath: draft.defaultReposDir ?? undefined,
      title: "Default directory when adding a repo",
    });
    if (typeof path === "string") {
      setDraft((d) => ({ ...d, defaultReposDir: path }));
    }
  }

  async function save() {
    setBusy(true);
    try {
      await update(draft);
      close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Settings"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={busy}
            icon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-400">Terminal</span>
          <select
            value={terminalValue}
            onChange={(e) =>
              setDraft({ ...draft, terminal: e.currentTarget.value as TerminalPref })
            }
            className="rounded border border-border bg-surface-2 px-2 py-1.5 text-sm text-zinc-100 focus:border-blue-400 focus:outline-none"
          >
            {terminalOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-400">Auto-refresh interval</span>
          <select
            value={String(draft.refreshIntervalSec)}
            onChange={(e) =>
              setDraft({
                ...draft,
                refreshIntervalSec: parseInt(e.currentTarget.value, 10),
              })
            }
            className="rounded border border-border bg-surface-2 px-2 py-1.5 text-sm text-zinc-100 focus:border-blue-400 focus:outline-none"
          >
            <option value="60">1 minute</option>
            <option value="120">2 minutes</option>
            <option value="300">5 minutes (default)</option>
            <option value="600">10 minutes</option>
            <option value="1800">30 minutes</option>
            <option value="3600">1 hour</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-400">
            Default repos directory (for the &quot;Add repo&quot; browse dialog)
          </span>
          <div className="flex gap-2">
            <input
              value={draft.defaultReposDir ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  defaultReposDir: e.currentTarget.value || null,
                })
              }
              placeholder={DIR_PLACEHOLDERS[host]}
              className="flex-1 rounded border border-border bg-surface-2 px-2 py-1.5 text-sm text-zinc-100 focus:border-blue-400 focus:outline-none"
            />
            <Button icon={<FolderOpen size={14} />} onClick={browse}>
              Browse
            </Button>
          </div>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-400">Theme</span>
          <select
            value={draft.theme}
            onChange={(e) =>
              setDraft({ ...draft, theme: e.currentTarget.value as ThemePref })
            }
            className="rounded border border-border bg-surface-2 px-2 py-1.5 text-sm text-zinc-100 focus:border-blue-400 focus:outline-none"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-400">
            Bulk concurrency{" "}
            <span className="text-zinc-500">
              (max repos fetched/pulled in parallel)
            </span>
          </span>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={16}
              step={1}
              value={draft.bulkConcurrency}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  bulkConcurrency: parseInt(e.currentTarget.value, 10),
                })
              }
              className="flex-1 accent-blue-500"
            />
            <span className="w-6 text-right font-mono text-sm text-zinc-200">
              {draft.bulkConcurrency}
            </span>
          </div>
          <span className="text-[11px] text-zinc-500">
            Lower values reduce credential-helper popup storms on corporate networks.
          </span>
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-400">
            Ignored paths{" "}
            <span className="text-zinc-500">
              (never re-proposed by &quot;Scan folder…&quot;)
            </span>
          </span>
          {ignoredLoading ? (
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Loader2 size={12} className="animate-spin" /> loading…
            </div>
          ) : ignored.length === 0 ? (
            <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2 text-xs text-zinc-500">
              None. Removing a repo with &quot;also ignore this folder&quot; checked adds it here.
            </div>
          ) : (
            <ul className="max-h-44 divide-y divide-border overflow-y-auto rounded-md border border-border bg-surface-2">
              {ignored.map((p) => (
                <li
                  key={p.path}
                  className="flex items-center gap-2 px-2.5 py-1.5 text-xs"
                >
                  <code className="flex-1 truncate font-mono text-zinc-200">
                    {p.path}
                  </code>
                  <IconButton
                    title="Remove from ignore list"
                    tone="danger"
                    onClick={() => void unignore(p.path)}
                    className="h-7 w-7"
                  >
                    <Trash2 size={12} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
