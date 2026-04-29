import { open as openSystemDialog } from "@tauri-apps/plugin-dialog";
import {
  DownloadCloud,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  INTERVAL_OPTIONS,
  describeSchedule,
  findIntervalOption,
} from "../../lib/autoFetch";
import { timeAgo } from "../../lib/format";
import { getPlatform, type HostOS } from "../../lib/platform";
import * as api from "../../lib/tauri";
import { checkForUpdate, getAppVersion } from "../../lib/updater";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import type {
  CliAction,
  CliActionModel,
  IgnoredPath,
  PushModePref,
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
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAppVersion().then((v) => {
      if (!cancelled) setAppVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
        .map((a) => {
          const entry: CliAction = {
            id: a.id,
            label: a.label.trim(),
            slashCommand: a.slashCommand.trim(),
          };
          if (a.model) entry.model = a.model;
          return entry;
        })
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
          <span className="text-[11px] text-zinc-500">
            Re-reads <code className="text-zinc-300">git status</code> on every repo —
            no network. Use Auto-fetch below to actually sync with remotes on a schedule.
          </span>
        </label>

        <AutoFetchSection draft={draft} setDraft={setDraft} />

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
                  <select
                    value={a.model ?? ""}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      updateAction(a.id, {
                        model: v === "" ? undefined : (v as CliActionModel),
                      });
                    }}
                    title="Claude model (optional). Launches with --model <alias>."
                    className="w-24 rounded border border-border bg-surface-3 px-2 py-1 text-sm text-zinc-100 focus:border-blue-400 focus:outline-none"
                  >
                    <option value="">Default</option>
                    <option value="haiku">Haiku</option>
                    <option value="sonnet">Sonnet</option>
                    <option value="opus">Opus</option>
                  </select>
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
            in a new terminal (with{" "}
            <code className="text-zinc-300">--model &lt;alias&gt;</code> if a
            model is picked; Default omits the flag). Only letters, digits, and{" "}
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
          <span className="text-xs font-medium text-zinc-400">
            Dashboard display
          </span>
          <label
            className="flex items-center gap-2 text-sm text-zinc-200"
            title="Fade out repos that are clean, up-to-date, and on their default branch so the eye lands on anything that needs attention. Hover or focus restores full opacity."
          >
            <input
              type="checkbox"
              checked={draft.dimCleanRows}
              onChange={(e) =>
                setDraft({ ...draft, dimCleanRows: e.currentTarget.checked })
              }
              className="h-3.5 w-3.5 accent-blue-500"
            />
            Dim clean + up-to-date rows
          </label>
          <span className="text-[11px] text-zinc-500">
            Default sort is “Attention” — errors and diverged repos float to
            the top. Change in the toolbar above the repo list.
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-400">
            Commit &amp; push behaviour{" "}
            <span className="text-zinc-500">(default — per-repo override in the row kebab)</span>
          </span>
          <PushModeRadio
            value={draft.pushMode}
            onChange={(v) => setDraft({ ...draft, pushMode: v })}
          />
          <span className="text-[11px] text-zinc-500">
            PR mode only fires when you&apos;re on the repo&apos;s default
            branch — commits from a feature branch push that branch
            directly regardless of this setting.
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-400">Updates</span>
          <div className="text-xs text-zinc-400">
            Current version:{" "}
            <span className="font-mono text-zinc-200">
              {appVersion ?? "…"}
            </span>
          </div>
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

interface PushModeRadioProps {
  value: PushModePref;
  onChange: (value: PushModePref) => void;
}

/** Two mutually-exclusive radio rows describing the global commit&push
 *  default. Shared between the Settings dialog and (later) the per-repo
 *  override submenu in the kebab — if the second use lands, extract to
 *  its own file. */
function PushModeRadio({ value, onChange }: PushModeRadioProps) {
  return (
    <div className="flex flex-col gap-1">
      <PushModeOption
        selected={value === "direct"}
        onSelect={() => onChange("direct")}
        title="Push directly to the current branch"
        subtitle="Commits land on the branch you're on and push straight to its upstream. Fails with a branch-protection error on protected branches."
      />
      <PushModeOption
        selected={value === "pr"}
        onSelect={() => onChange("pr")}
        title="Create a branch and open a PR"
        subtitle="When you're on default, commits go on a new branch (you name it in the dialog) and push with -u. The success toast links to the provider's PR-create page."
      />
    </div>
  );
}

interface PushModeOptionProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
}

interface AutoFetchSectionProps {
  draft: Settings;
  setDraft: React.Dispatch<React.SetStateAction<Settings>>;
}

/** Auto-fetch configuration — on/off toggle, interval, anchor day/time,
 *  "run now" button, last-run readout. The backend scheduler in
 *  `commands/auto_fetch.rs` is authoritative; changing these settings
 *  takes effect on the next scheduler tick (≤ 30s). */
function AutoFetchSection({ draft, setDraft }: AutoFetchSectionProps) {
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const intervalOption =
    findIntervalOption(draft.autoFetchIntervalSec) ?? INTERVAL_OPTIONS[6];
  const showAnchor = intervalOption.showAnchor;
  const showDow = intervalOption.showDayOfWeek;

  function onIntervalChange(value: number) {
    const opt = findIntervalOption(value);
    if (!opt) return;
    setDraft((d) => ({
      ...d,
      autoFetchIntervalSec: value,
      // Clear anchor fields when they're irrelevant so the stored state
      // matches what the UI is showing.
      autoFetchAnchorDow: opt.showDayOfWeek ? (d.autoFetchAnchorDow ?? 1) : null,
      autoFetchAnchorHour: opt.showAnchor ? (d.autoFetchAnchorHour ?? 8) : null,
      autoFetchAnchorMinute: opt.showAnchor
        ? (d.autoFetchAnchorMinute ?? 0)
        : null,
    }));
  }

  function onTimeChange(raw: string) {
    // HTML time input returns "HH:MM" (or "" when cleared).
    const [h, m] = raw.split(":").map((s) => parseInt(s, 10));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return;
    setDraft((d) => ({
      ...d,
      autoFetchAnchorHour: h,
      autoFetchAnchorMinute: m,
    }));
  }

  async function runNow() {
    setRunBusy(true);
    setRunError(null);
    try {
      await api.autoFetchRunOnce();
    } catch (e) {
      setRunError(String(e));
    } finally {
      setRunBusy(false);
    }
  }

  const hh = draft.autoFetchAnchorHour ?? 8;
  const mm = draft.autoFetchAnchorMinute ?? 0;
  const timeValue = `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-2.5">
      <label className="flex items-center gap-2 text-sm text-zinc-100">
        <input
          type="checkbox"
          checked={draft.autoFetchEnabled}
          onChange={(e) =>
            setDraft({ ...draft, autoFetchEnabled: e.currentTarget.checked })
          }
          className="h-3.5 w-3.5 accent-blue-500"
        />
        <span className="font-medium">Auto-fetch</span>
        <span className="text-xs text-zinc-500">
          — scheduled background <code className="text-zinc-300">git fetch --all</code>{" "}
          on every repo, plus a fast-forward pull on repos that are clean and on
          their default branch.
        </span>
      </label>

      <div
        className={`flex flex-col gap-2 pl-5 transition-opacity ${
          draft.autoFetchEnabled ? "opacity-100" : "pointer-events-none opacity-50"
        }`}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-400">Interval</span>
          <select
            value={String(draft.autoFetchIntervalSec)}
            onChange={(e) => onIntervalChange(parseInt(e.currentTarget.value, 10))}
            disabled={!draft.autoFetchEnabled}
            className="rounded border border-border bg-surface-3 px-2 py-1.5 text-sm text-zinc-100 focus:border-blue-400 focus:outline-none"
          >
            {INTERVAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {showAnchor && (
          <div className="flex gap-2">
            {showDow && (
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-xs font-medium text-zinc-400">Day</span>
                <select
                  value={String(draft.autoFetchAnchorDow ?? 1)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      autoFetchAnchorDow: parseInt(e.currentTarget.value, 10),
                    })
                  }
                  disabled={!draft.autoFetchEnabled}
                  className="rounded border border-border bg-surface-3 px-2 py-1.5 text-sm text-zinc-100 focus:border-blue-400 focus:outline-none"
                >
                  <option value="1">Monday</option>
                  <option value="2">Tuesday</option>
                  <option value="3">Wednesday</option>
                  <option value="4">Thursday</option>
                  <option value="5">Friday</option>
                  <option value="6">Saturday</option>
                  <option value="0">Sunday</option>
                </select>
              </label>
            )}
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-zinc-400">
                Time (UTC)
              </span>
              <input
                type="time"
                value={timeValue}
                onChange={(e) => onTimeChange(e.currentTarget.value)}
                disabled={!draft.autoFetchEnabled}
                className="rounded border border-border bg-surface-3 px-2 py-1.5 text-sm text-zinc-100 focus:border-blue-400 focus:outline-none"
              />
            </label>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-zinc-500">
            Schedule: {describeSchedule(draft)}. Last run:{" "}
            {timeAgo(draft.autoFetchLastRunAt)}.
          </span>
          <Button
            icon={
              runBusy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )
            }
            onClick={runNow}
            disabled={runBusy}
            className="h-7 px-2 text-xs"
          >
            Run now
          </Button>
        </div>
        {runError && (
          <span className="text-xs text-red-300" title={runError}>
            {runError}
          </span>
        )}
        <span className="text-[11px] text-zinc-500">
          Dirty repos are fetch-only (never overwritten). Off-default branches
          get refs updated but no pull. Never force-pushes, never discards
          commits.
        </span>
      </div>
    </div>
  );
}

function PushModeOption({
  selected,
  onSelect,
  title,
  subtitle,
}: PushModeOptionProps) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-sm transition ${
        selected
          ? "border-blue-500/60 bg-blue-500/10"
          : "border-border bg-surface-2 hover:border-border-strong"
      }`}
    >
      <input
        type="radio"
        name="push-mode"
        checked={selected}
        onChange={onSelect}
        className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
      />
      <span className="flex flex-col">
        <span className="font-medium text-zinc-100">{title}</span>
        <span className="text-[11px] text-zinc-400">{subtitle}</span>
      </span>
    </label>
  );
}
