import clsx from "clsx";
import {
  ArrowDownToLine,
  ChevronDown,
  ChevronUp,
  CornerUpLeft,
  Download,
  GitCommitHorizontal,
  Loader2,
  TerminalSquare,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import * as api from "../lib/tauri";
import {
  resolvePrimaryAction,
  type PrimaryAction,
} from "../lib/repoActionsResolver";
import { useReposStore } from "../stores/reposStore";
import { useUiStore } from "../stores/uiStore";
import type { RepoStatus } from "../types";
import { RepoKebabMenu, type RunOpts } from "./RepoKebabMenu";
import { IconButton } from "./ui/Button";

interface Props {
  status: RepoStatus;
  refreshing: boolean;
  onRefresh: () => void;
  onRename: () => void;
  onRemove: () => void;
}

export function RepoActions({
  status,
  refreshing,
  onRefresh,
  onRename,
  onRemove,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const refreshOne = useReposStore((s) => s.refreshOne);
  const openDialog = useUiStore((s) => s.openDialog);
  const toggleExpanded = useUiStore((s) => s.toggleExpanded);
  const isExpanded = useUiStore((s) => s.expandedIds.has(status.id));

  const onDefault = status.branch === status.defaultBranch;
  const primary = resolvePrimaryAction(status);
  const primaryBusy = primary != null && busy === primary.busyName;

  async function run(
    name: string,
    fn: () => Promise<unknown>,
    opts?: RunOpts,
  ) {
    setBusy(name);
    try {
      await fn();
      if (opts?.refresh !== false) await refreshOne(status.id);
    } catch (e) {
      if (opts?.gitError !== false) {
        openDialog({
          kind: "gitError",
          title: opts?.errorTitle ?? `${name} failed`,
          error: String(e),
          repoId: status.id,
        });
      } else {
        openDialog({
          kind: "info",
          title: opts?.errorTitle ?? `${name} failed`,
          body: String(e),
        });
      }
    } finally {
      setBusy(null);
    }
  }

  function invokePrimary() {
    if (!primary) return;
    switch (primary.kind) {
      case "pull":
        void run(primary.busyName, () => api.gitPullFf(status.id));
        return;
      case "commitPush":
        openDialog({
          kind: "commitPush",
          id: status.id,
          name: status.name,
          branch: status.branch,
          defaultBranch: status.defaultBranch,
          hasUpstream: status.hasUpstream,
        });
        return;
      case "switchDefault":
        void run(
          primary.busyName,
          () => api.gitCheckout(status.id, status.defaultBranch),
          {
            errorTitle: `Can't switch to ${status.defaultBranch}`,
          },
        );
        return;
      case "openTerminal":
        void run(primary.busyName, () => api.openTerminal(status.id), {
          refresh: false,
          gitError: false,
        });
        return;
    }
  }

  return (
    <div className="flex items-center gap-1">
      {primary && (
        <PrimaryButton
          action={primary}
          busy={primaryBusy}
          anyBusy={!!busy}
          onClick={invokePrimary}
        />
      )}

      <IconButton
        title={
          "Fetch — runs `git fetch origin`. Downloads new commits and updates " +
          "remote refs (origin/*) so ahead/behind counts are current. Does NOT " +
          "touch your working tree or move the current branch."
        }
        onClick={() => run("Fetch", () => api.gitFetch(status.id))}
        disabled={!!busy}
      >
        {busy === "Fetch" ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Download size={16} />
        )}
      </IconButton>

      <RepoKebabMenu
        status={status}
        busy={busy}
        onDefault={onDefault}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onRename={onRename}
        onRemove={onRemove}
        runHelper={run}
      />

      <IconButton
        title={
          isExpanded
            ? "Hide details panel"
            : "Show details — changed files in the working tree and the last 10 commits on HEAD"
        }
        onClick={() => toggleExpanded(status.id)}
      >
        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </IconButton>
    </div>
  );
}

function primaryIcon(icon: PrimaryAction["icon"]): ReactNode {
  switch (icon) {
    case "pull":
      return <ArrowDownToLine size={14} />;
    case "commit":
      return <GitCommitHorizontal size={14} />;
    case "switchDefault":
      return <CornerUpLeft size={14} />;
    case "terminal":
      return <TerminalSquare size={14} />;
  }
}

interface PrimaryButtonProps {
  action: PrimaryAction;
  busy: boolean;
  anyBusy: boolean;
  onClick: () => void;
}

function PrimaryButton({
  action,
  busy,
  anyBusy,
  onClick,
}: PrimaryButtonProps) {
  const toneClasses =
    action.tone === "primary"
      ? "bg-blue-600 border-blue-500 hover:bg-blue-500 hover:border-blue-400 text-white"
      : "bg-amber-500/15 border-amber-500/40 hover:bg-amber-500/25 hover:border-amber-400/60 text-amber-100";
  return (
    <button
      type="button"
      title={action.title}
      onClick={onClick}
      disabled={anyBusy}
      className={clsx(
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition",
        "disabled:cursor-not-allowed disabled:opacity-60 select-none",
        toneClasses,
      )}
    >
      {busy ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        primaryIcon(action.icon)
      )}
      <span className="whitespace-nowrap">{action.label}</span>
    </button>
  );
}
