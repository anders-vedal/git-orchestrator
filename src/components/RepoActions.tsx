import {
  Download,
  ArrowDownToLine,
  AlertOctagon,
  FolderOpen,
  TerminalSquare,
  Globe,
  ChevronDown,
  ChevronUp,
  GitCommitHorizontal,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as api from "../lib/tauri";
import { useReposStore } from "../stores/reposStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import type { CliAction, RepoStatus } from "../types";
import { IconButton } from "./ui/Button";

interface Props {
  status: RepoStatus;
}

export function RepoActions({ status }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const refreshOne = useReposStore((s) => s.refreshOne);
  const openDialog = useUiStore((s) => s.openDialog);
  const toggleExpanded = useUiStore((s) => s.toggleExpanded);
  const isExpanded = useUiStore((s) => s.expandedIds.has(status.id));
  const cliActions = useSettingsStore((s) => s.settings.cliActions);

  const onDefault = status.branch === status.defaultBranch;
  const hasChanges = status.dirty !== "clean";

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function run(
    name: string,
    fn: () => Promise<unknown>,
    opts?: { refresh?: boolean; errorTitle?: string; gitError?: boolean },
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

  function runAction(action: CliAction) {
    setMenuOpen(false);
    void run("Claude Code", () => api.runCliAction(status.id, action.id), {
      refresh: false,
      gitError: false,
      errorTitle: `Launching ${action.label} failed`,
    });
  }

  function onClaudeClick() {
    if (cliActions.length === 0) return;
    if (cliActions.length === 1) {
      runAction(cliActions[0]);
      return;
    }
    setMenuOpen((v) => !v);
  }

  const claudeTitle =
    cliActions.length === 0
      ? ""
      : cliActions.length === 1
        ? `Launch Claude Code with ${cliActions[0].slashCommand} in this repo — opens a new terminal, cds into the repo, and runs \`claude "${cliActions[0].slashCommand}"\``
        : `Launch Claude Code in this repo — ${cliActions.length} actions configured, pick one`;

  return (
    <div className="flex items-center gap-1">
      <IconButton
        title={
          "Fetch — runs `git fetch origin`. Downloads new commits and updates " +
          "remote refs (origin/*) so ahead/behind counts are current. Does NOT " +
          "touch your working tree or move the current branch."
        }
        onClick={() => run("Fetch", () => api.gitFetch(status.id))}
        disabled={!!busy}
      >
        {busy === "Fetch" ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
      </IconButton>

      <IconButton
        title={
          "Pull (fast-forward only) — runs `git pull --ff-only`. Fast-forwards " +
          "the current branch to its upstream if possible. Refuses when the " +
          "branch has diverged or the working tree is dirty; no merge commit is " +
          "ever created."
        }
        tone="primary"
        onClick={() => run("Pull", () => api.gitPullFf(status.id))}
        disabled={!!busy}
      >
        {busy === "Pull" ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <ArrowDownToLine size={16} />
        )}
      </IconButton>

      <IconButton
        title={
          hasChanges
            ? "Commit & push — stages every change (`git add -A`), commits with a message you provide, and optionally pushes to origin. Opens a dialog with a full file preview and the exact commands before anything runs. Never uses --force."
            : "Commit & push disabled — working tree is clean. Nothing to stage."
        }
        tone="primary"
        disabled={!hasChanges || !!busy}
        onClick={() =>
          openDialog({
            kind: "commitPush",
            id: status.id,
            name: status.name,
            branch: status.branch,
            defaultBranch: status.defaultBranch,
            hasUpstream: status.hasUpstream,
          })
        }
      >
        <GitCommitHorizontal size={16} />
      </IconButton>

      <IconButton
        title={
          onDefault
            ? "Force pull — fetches origin and runs `git reset --hard origin/" +
              status.defaultBranch +
              "`. DISCARDS any local commits and uncommitted changes on the " +
              "current branch. A preview dialog shows exactly what will be lost " +
              "before you confirm, and the pre-reset SHA is logged so you can Undo."
            : `Force pull disabled — only allowed on the default branch (${status.defaultBranch}). Switch branches in your terminal first.`
        }
        tone="danger"
        disabled={!onDefault || !!busy}
        onClick={() =>
          openDialog({
            kind: "forcePull",
            id: status.id,
            name: status.name,
            defaultBranch: status.defaultBranch,
          })
        }
      >
        <AlertOctagon size={16} />
      </IconButton>

      <div className="mx-1 h-5 w-px bg-border" />

      <IconButton
        title="Open folder in the OS file manager"
        onClick={() =>
          run("Open folder", () => api.openFolder(status.id), {
            refresh: false,
            gitError: false,
          })
        }
      >
        <FolderOpen size={16} />
      </IconButton>

      <IconButton
        title="Open a terminal in this repo — use it to commit, push, merge, or run any other git command"
        onClick={() =>
          run("Open terminal", () => api.openTerminal(status.id), {
            refresh: false,
            gitError: false,
          })
        }
      >
        <TerminalSquare size={16} />
      </IconButton>

      {cliActions.length > 0 && (
        <div className="relative" ref={menuRef}>
          <IconButton
            title={claudeTitle}
            tone="primary"
            onClick={onClaudeClick}
            disabled={busy === "Claude Code"}
          >
            {busy === "Claude Code" ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Sparkles size={16} />
            )}
          </IconButton>
          {menuOpen && cliActions.length > 1 && (
            <div
              role="menu"
              className="absolute right-0 top-full z-30 mt-1 min-w-[180px] overflow-hidden rounded-md border border-border-strong bg-surface-1 shadow-xl"
            >
              {cliActions.map((a) => (
                <button
                  key={a.id}
                  role="menuitem"
                  onClick={() => runAction(a)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left text-sm text-zinc-100 hover:bg-surface-3"
                >
                  <span className="font-medium">{a.label}</span>
                  <code className="font-mono text-[11px] text-zinc-400">
                    {a.slashCommand}
                  </code>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <IconButton
        title={
          status.remoteUrl
            ? `Open remote in browser — ${status.remoteUrl}`
            : "No remote URL — this repo has no origin remote configured"
        }
        disabled={!status.remoteUrl}
        onClick={() =>
          run("Open remote", () => api.openRemote(status.id), {
            refresh: false,
            gitError: false,
          })
        }
      >
        <Globe size={16} />
      </IconButton>

      <div className="mx-1 h-5 w-px bg-border" />

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
