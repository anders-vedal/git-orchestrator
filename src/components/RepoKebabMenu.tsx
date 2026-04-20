import clsx from "clsx";
import {
  AlertOctagon,
  Check,
  FolderOpen,
  Globe,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCcw,
  Sparkles,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as api from "../lib/tauri";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import type { PushModeInfo, PushModePref, RepoStatus } from "../types";
import { IconButton } from "./ui/Button";

export interface RunOpts {
  refresh?: boolean;
  errorTitle?: string;
  gitError?: boolean;
}

interface Props {
  status: RepoStatus;
  busy: string | null;
  onDefault: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onRename: () => void;
  onRemove: () => void;
  runHelper: (
    name: string,
    fn: () => Promise<unknown>,
    opts?: RunOpts,
  ) => Promise<void>;
}

export function RepoKebabMenu({
  status,
  busy,
  onDefault,
  refreshing,
  onRefresh,
  onRename,
  onRemove,
  runHelper,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const openDialog = useUiStore((s) => s.openDialog);
  const cliActions = useSettingsStore((s) => s.settings.cliActions);
  const globalPushMode = useSettingsStore((s) => s.settings.pushMode);
  const [pushModeInfo, setPushModeInfo] = useState<PushModeInfo | null>(null);
  const [pushModeBusy, setPushModeBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .getPushModeInfo(status.id)
      .then((info) => {
        if (!cancelled) setPushModeInfo(info);
      })
      .catch(() => {
        // The submenu falls back to "loading…" if this fails; no reason to
        // block the whole menu on a cosmetic lookup.
      });
    return () => {
      cancelled = true;
    };
  }, [open, status.id]);

  function close() {
    setOpen(false);
  }

  async function openFolder() {
    close();
    await runHelper("Open folder", () => api.openFolder(status.id), {
      refresh: false,
      gitError: false,
    });
  }
  async function openTerminal() {
    close();
    await runHelper("Open terminal", () => api.openTerminal(status.id), {
      refresh: false,
      gitError: false,
    });
  }
  async function openRemote() {
    close();
    await runHelper("Open remote", () => api.openRemote(status.id), {
      refresh: false,
      gitError: false,
    });
  }
  async function runClaude(actionId: string, label: string) {
    close();
    await runHelper(
      "Claude Code",
      () => api.runCliAction(status.id, actionId),
      {
        refresh: false,
        gitError: false,
        errorTitle: `Launching ${label} failed`,
      },
    );
  }

  function clickForcePull() {
    close();
    openDialog({
      kind: "forcePull",
      id: status.id,
      name: status.name,
      defaultBranch: status.defaultBranch,
    });
  }
  function clickRefresh() {
    close();
    onRefresh();
  }
  function clickRename() {
    close();
    onRename();
  }
  function clickRemove() {
    close();
    onRemove();
  }

  async function setPushMode(mode: PushModePref | null) {
    if (pushModeBusy) return;
    // Optimistic — on error we reload from the backend to clear any drift.
    const previous = pushModeInfo;
    const effective: PushModePref =
      mode ?? (globalPushMode === "pr" ? "pr" : "direct");
    setPushModeInfo({ override: mode, effective });
    setPushModeBusy(true);
    try {
      await api.setRepoPushMode(status.id, mode);
      const fresh = await api.getPushModeInfo(status.id);
      setPushModeInfo(fresh);
    } catch {
      setPushModeInfo(previous);
    } finally {
      setPushModeBusy(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <IconButton
        title="More actions — open, refresh, rename, force pull, remove"
        onClick={() => setOpen((v) => !v)}
        disabled={!!busy && busy !== "Claude Code"}
      >
        <MoreHorizontal size={16} />
      </IconButton>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-[240px] overflow-hidden rounded-md border border-border-strong bg-surface-1 py-1 shadow-xl"
        >
          <MenuHeader>Open</MenuHeader>
          <MenuItem icon={<FolderOpen size={14} />} onClick={openFolder}>
            Folder
          </MenuItem>
          <MenuItem icon={<TerminalSquare size={14} />} onClick={openTerminal}>
            Terminal
          </MenuItem>
          <MenuItem
            icon={<Globe size={14} />}
            onClick={openRemote}
            disabled={!status.remoteUrl}
            subtitle={
              status.remoteUrl ?? "No origin remote configured"
            }
          >
            Remote in browser
          </MenuItem>
          {cliActions.length > 0 && (
            <>
              <MenuSubheader>Claude Code</MenuSubheader>
              {cliActions.map((a) => (
                <MenuItem
                  key={a.id}
                  icon={<Sparkles size={14} className="text-blue-300" />}
                  onClick={() => runClaude(a.id, a.label)}
                  subtitle={a.slashCommand}
                >
                  {a.label}
                </MenuItem>
              ))}
            </>
          )}

          <MenuSeparator />
          <MenuHeader>Manage</MenuHeader>
          <MenuItem
            icon={
              refreshing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCcw size={14} />
              )
            }
            onClick={clickRefresh}
            disabled={refreshing}
          >
            Refresh status
          </MenuItem>
          <MenuItem icon={<Pencil size={14} />} onClick={clickRename}>
            Rename
          </MenuItem>

          <MenuSeparator />
          <MenuHeader>Push mode</MenuHeader>
          <PushModeRow
            selected={pushModeInfo?.override == null}
            onSelect={() => void setPushMode(null)}
            disabled={pushModeBusy}
            label={`Use default (${globalPushMode === "pr" ? "PR branch" : "direct"})`}
            subtitle="Inherits the global Settings value"
          />
          <PushModeRow
            selected={pushModeInfo?.override === "direct"}
            onSelect={() => void setPushMode("direct")}
            disabled={pushModeBusy}
            label="Push to current branch"
            subtitle="Commits push straight to the branch you're on"
          />
          <PushModeRow
            selected={pushModeInfo?.override === "pr"}
            onSelect={() => void setPushMode("pr")}
            disabled={pushModeBusy}
            label="Create PR branch"
            subtitle={`Commits on default branch off into a new branch for a PR against ${status.defaultBranch}`}
          />

          <MenuSeparator />
          <MenuHeader>Danger</MenuHeader>
          <MenuItem
            icon={<AlertOctagon size={14} className="text-red-400" />}
            onClick={clickForcePull}
            disabled={!onDefault}
            subtitle={
              onDefault
                ? `Discards local commits on ${status.defaultBranch}`
                : `Only on default branch (${status.defaultBranch})`
            }
            tone="danger"
          >
            Force pull…
          </MenuItem>
          <MenuItem
            icon={<Trash2 size={14} className="text-red-400" />}
            onClick={clickRemove}
            tone="danger"
            subtitle="Your files on disk are NOT deleted"
          >
            Remove from dashboard…
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuHeader({ children }: { children: string }) {
  return (
    <div className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </div>
  );
}

function MenuSubheader({ children }: { children: string }) {
  return (
    <div className="mt-0.5 px-3 pb-0.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
      {children}
    </div>
  );
}

function MenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}

interface MenuItemProps {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  subtitle?: string;
  tone?: "danger";
}

function MenuItem({
  icon,
  children,
  onClick,
  disabled,
  subtitle,
  tone,
}: MenuItemProps) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
        tone === "danger"
          ? "text-red-200 hover:bg-red-500/10"
          : "text-zinc-100 hover:bg-surface-3",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="flex min-w-0 flex-col items-start">
        <span className="truncate font-medium">{children}</span>
        {subtitle && (
          <span className="truncate font-mono text-[11px] text-zinc-500">
            {subtitle}
          </span>
        )}
      </span>
    </button>
  );
}

interface PushModeRowProps {
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  label: string;
  subtitle: string;
}

/** A check-marked menu row for the push-mode override submenu. Visually
 *  like a MenuItem but the "icon" slot carries the selection indicator
 *  and the row stays in place on click so the user sees the checkmark
 *  move without the menu closing. */
function PushModeRow({
  selected,
  onSelect,
  disabled,
  label,
  subtitle,
}: PushModeRowProps) {
  return (
    <button
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      disabled={disabled}
      className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm text-zinc-100 transition hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {selected ? (
          <Check size={14} className="text-blue-300" />
        ) : (
          <span className="h-3.5 w-3.5 rounded-full border border-border" />
        )}
      </span>
      <span className="flex min-w-0 flex-col items-start">
        <span className="truncate font-medium">{label}</span>
        <span className="truncate text-[11px] text-zinc-500">{subtitle}</span>
      </span>
    </button>
  );
}
