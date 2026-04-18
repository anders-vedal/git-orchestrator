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
} from "lucide-react";
import { useState } from "react";
import * as api from "../lib/tauri";
import { useReposStore } from "../stores/reposStore";
import { useUiStore } from "../stores/uiStore";
import type { RepoStatus } from "../types";
import { IconButton } from "./ui/Button";

interface Props {
  status: RepoStatus;
}

export function RepoActions({ status }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const refreshOne = useReposStore((s) => s.refreshOne);
  const openDialog = useUiStore((s) => s.openDialog);
  const toggleExpanded = useUiStore((s) => s.toggleExpanded);
  const isExpanded = useUiStore((s) => s.expandedIds.has(status.id));

  const onDefault = status.branch === status.defaultBranch;
  const hasChanges = status.dirty !== "clean";

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
