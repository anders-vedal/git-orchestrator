// Row-level primary action resolver. Pure — takes a RepoStatus, returns
// the single contextual primary verb (or null for "no primary, just
// ambient Fetch"). Priority order: error > diverged > dirty > behind >
// off-default > clean.
//
// Dirty + behind intentionally resolves to commit-push rather than pull
// because `git pull --ff-only` refuses on a dirty tree anyway. The state
// pill still surfaces the behind count so the user sees both signals.

import type { RepoStatus } from "../types";

export type PrimaryActionKind =
  | "pull"
  | "commitPush"
  | "switchDefault"
  | "openTerminal";

export type PrimaryActionIcon =
  | "pull"
  | "commit"
  | "switchDefault"
  | "terminal";

export interface PrimaryAction {
  kind: PrimaryActionKind;
  label: string;
  title: string;
  tone: "primary" | "warning";
  icon: PrimaryActionIcon;
  /** Unique name passed to the row's `busy` state so we can show
   *  the spinner on the correct button. */
  busyName: string;
}

export function resolvePrimaryAction(status: RepoStatus): PrimaryAction | null {
  // Errors are surfaced by the red "error" pill — don't double-signal
  // with a primary button whose action might re-fail the same way.
  if (status.error) return null;

  if (status.diverged) {
    return {
      kind: "openTerminal",
      label: "Open terminal",
      title:
        `Branch has diverged: ${status.ahead} ahead, ${status.behind} behind. ` +
        "Fast-forward pull refuses — open a terminal to merge, rebase, or " +
        "reset manually. The dashboard deliberately does not auto-resolve " +
        "divergence.",
      tone: "warning",
      icon: "terminal",
      busyName: "OpenTerminal",
    };
  }

  const isDirty = status.dirty !== "clean";
  if (isDirty) {
    return {
      kind: "commitPush",
      label: "Commit & push…",
      title:
        "Stage every change (`git add -A`), commit with a message you " +
        "provide, and optionally push to origin. Opens a dialog with a " +
        "full file preview and the exact commands before anything runs. " +
        "Never uses --force.",
      tone: "primary",
      icon: "commit",
      busyName: "CommitPush",
    };
  }

  // Clean from here down
  if (status.hasUpstream && status.behind > 0) {
    const plural = status.behind === 1 ? "" : "s";
    return {
      kind: "pull",
      label: `Pull ${status.behind} commit${plural}`,
      title:
        `Fast-forward pull — catches up to upstream (${status.behind} commit${plural} behind). ` +
        "Runs `git pull --ff-only`; refuses when the branch has diverged " +
        "or the working tree is dirty. Never creates a merge commit.",
      tone: "primary",
      icon: "pull",
      busyName: "Pull",
    };
  }

  if (
    status.branch &&
    status.defaultBranch &&
    status.branch !== status.defaultBranch
  ) {
    return {
      kind: "switchDefault",
      label: `Switch to ${status.defaultBranch}`,
      title:
        `Switch to the default branch (${status.defaultBranch}). ` +
        `Runs \`git checkout ${status.defaultBranch}\`. Refused by git if ` +
        "local changes would be overwritten; stash or commit first.",
      tone: "warning",
      icon: "switchDefault",
      busyName: "SwitchDefault",
    };
  }

  // Clean + up to date + on default branch — quiet row, no primary.
  return null;
}
