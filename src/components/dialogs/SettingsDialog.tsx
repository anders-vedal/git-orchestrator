import { open as openSystemDialog } from "@tauri-apps/plugin-dialog";
import {
  DownloadCloud,
  FolderOpen,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getPlatform, type HostOS } from "../../lib/platform";
import * as api from "../../lib/tauri";
import { checkForUpdate } from "../../lib/updater";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import type {
  CliAction,
  IgnoredPath,
  Settings,
  TerminalPref,
  ThemePref,
} from "../../types";
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

function newActionId(): string {
  return `action-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function SettingsDialog() {
  const dialog = useUiStore((s) => s.dialog);
  const close = useUiStore((s) => s.closeDialog);
  const openDialog = useUiStore((s) => s.openDialog);
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const open = dialog?.kind === "settings";

  const [draft, setDraft] = useState<Settings>(settings);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<IgnoredPath[]>([]);
  const [ignoredLoading, setIgnoredLoading] = useState(false);
  const [host, setHost] = useState<HostOS>("windows");
  const [updateCheckState, setUpdateCheckState] = useState<
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "upToDate" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

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
      setSaveError(null);
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
    setSaveError(null);
    try {
      // Drop empty rows before saving — the backend rejects empty label /
      // empty slash command, and blank rows are a natural "deleted by
      // clearing fields" gesture.
      const cleaned: CliAction[] = draft.cliActions
        .map((a) => ({
          id: a.id,
          label: a.label.trim(),
          slashCommand: a.slashCommand.trim(),
        }))
        .filter((a) => a.label !== "" && a.slashCommand !== "");
      await update({ ...draft, cliActions: cleaned });
      close();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function updateAction(id: string, patch: Partial<CliAction>) {
    setDraft((d) => ({
      ...d,
      cliActions: d.cliActions.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  }
  function removeAction(id: string) {
    setDraft((d) => ({
      ...d,
      cliActions: d.cliActions.filter((a) => a.id !== id),
    }));
  }
  function addAction() {
    setDraft((d) => ({
      ...d,
      cliActions: [
        ...d.cliActions,
        { id: newActionId(), label: "", slashCommand: "/" },
      ],
    }));
  }

  async function runUpdateCheck() {
    setUpdateCheckState({ kind: "checking" });
    try {
      const info = await checkForUpdate();
      if (!info) {
        setUpdateCheckState({ kind: "upToDate" });
        return;
      }
      // Defer to UpdateDialog — close settings first so the user sees one modal.
      setUpdateCheckState({ kind: "idle" });
      close();
      openDialog({
        kind: "update",
        version: info.version,
        currentVersion: info.currentVersion,
        notes: info.notes,
        date: info.date,
      });
    } catch (e) {
      setUpdateCheckState({ kind: "error", message: String(e) });
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
          {saveError && (
            <span
              className="mr-auto max-w-[60%] truncate text-left text-xs text-red-300"
              title={saveError}
            >
              {saveError}
            </span>
          )}
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

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">
              <Sparkles size={11} className="mr-1 inline-block -translate-y-px" />
              Claude Code actions{" "}
              <span className="text-zinc-500">
                (one-click launchers on each repo row)
              </span>
            </span>
            <Button
              icon={<Plus size={12} />}
              onClick={addAction}
              disabled={draft.cliActions.length >= 10}
              className="h-7 px-2 text-xs"
            >
              Add action
            </Button>
          </div>
          {draft.cliActions.length === 0 ? (
            <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2 text-xs text-zinc-500">
              None configured. The Claude Code button on each repo row is
              hidden until you add at least one.
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {draft.cliActions.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5"
                >
                  <input
                    value={a.label}
                    onChange={(e) =>
                      updateAction(a.id, { label: e.currentTarget.value })
                    }
                    placeholder="Label (e.g. Ship)"
                    maxLength={64}
                    className="w-32 rounded border border-border bg-surface-3 px-2 py-1 text-sm text-zinc-100 focus:border-blue-400 focus:outline-none"
                  />
                  <input
                    value={a.slashCommand}
                    onChange={(e) =>
                      updateAction(a.id, { slashCommand: e.currentTarget.value })
                    }
                    placeholder="/ship"
                    maxLength={128}
                    className="flex-1 rounded border border-border bg-surface-3 px-2 py-1 font-mono text-sm text-zinc-100 focus:border-blue-400 focus:outline-none"
                  />
                  <IconButton
                    title="Remove this action"
                    tone="danger"
                    onClick={() => removeAction(a.id)}
                    className="h-7 w-7"
                  >
                    <Trash2 size={12} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          <span className="text-[11px] text-zinc-500">
            Each action launches{" "}
            <code className="text-zinc-300">claude &quot;&lt;slash-command&gt;&quot;</code>{" "}
            in a new terminal. Only letters, digits, and{" "}
            <code className="text-zinc-300">/ - _ . , : space = + @</code>{" "}
            are allowed in slash commands — shell metacharacters are rejected.
          </span>
        </div>

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

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-400">Updates</span>
          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={draft.autoCheckUpdates}
              onChange={(e) =>
                setDraft({ ...draft, autoCheckUpdates: e.currentTarget.checked })
              }
              className="h-3.5 w-3.5 accent-blue-500"
            />
            Check for updates automatically on startup
          </label>
          <div className="flex items-center gap-2">
            <Button
              icon={
                updateCheckState.kind === "checking" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <DownloadCloud size={14} />
                )
              }
              onClick={runUpdateCheck}
              disabled={updateCheckState.kind === "checking"}
            >
              Check for updates now
            </Button>
            {updateCheckState.kind === "upToDate" && (
              <span className="text-xs text-zinc-400">You&apos;re on the latest version.</span>
            )}
            {updateCheckState.kind === "error" && (
              <span className="text-xs text-red-300">{updateCheckState.message}</span>
            )}
          </div>
        </div>

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
