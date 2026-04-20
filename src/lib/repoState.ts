// Per-repo visual state — single source of truth for the consolidated
// status pill and (in Phase 5) the attention-sort bucket + clean-row
// dimming. Pure — no React, no store access — so it's unit-testable and
// usable from a comparator.

import type { RepoStatus } from "../types";

export type StateBucketId =
  | "error"
  | "diverged"
  | "dirty_behind"
  | "dirty"
  | "behind"
  | "ahead"
  | "unpushed"
  | "no_upstream"
  | "off_default"
  | "clean";

export function getRepoStateBucket(status: RepoStatus): StateBucketId {
  if (status.error) return "error";
  if (status.diverged) return "diverged";
  const isDirty = status.dirty !== "clean";
  if (isDirty && status.behind > 0) return "dirty_behind";
  if (isDirty) return "dirty";
  if (status.hasUpstream && status.behind > 0) return "behind";
  if (status.hasUpstream && status.ahead > 0) return "ahead";
  if (!status.hasUpstream && (status.unpushedNoUpstream ?? 0) > 0) {
    return "unpushed";
  }
  if (!status.hasUpstream) return "no_upstream";
  if (
    status.branch &&
    status.defaultBranch &&
    status.branch !== status.defaultBranch
  ) {
    return "off_default";
  }
  return "clean";
}

export type PillTone = "neutral" | "green" | "yellow" | "red" | "blue";

export interface StateChip {
  tone: PillTone;
  label: string;
  title: string;
  bucket: StateBucketId;
}

const DIRTY_HINT: Record<RepoStatus["dirty"], string> = {
  clean: "",
  untracked: "Untracked files: new files git isn't tracking yet.",
  unstaged: "Unstaged: tracked files have edits not added to the index.",
  staged: "Staged: changes are in the index, ready to commit.",
  mixed:
    "Mixed: a combination of staged, unstaged, and/or untracked changes.",
};

// Returns null for rows where the absence of a pill is itself the signal
// (clean + up to date, off-default when the amber branch pill already
// carries the warning, and the special error case where a dedicated
// red "error" pill is rendered instead).
export function getRepoStateChip(status: RepoStatus): StateChip | null {
  const bucket = getRepoStateBucket(status);
  switch (bucket) {
    case "error":
      return null;

    case "diverged":
      return {
        tone: "red",
        label: `diverged ↑${status.ahead} ↓${status.behind}`,
        title:
          `Branch has diverged: ${status.ahead} ahead, ${status.behind} behind. ` +
          "Fast-forward pull will refuse — open terminal to merge or rebase.",
        bucket,
      };

    case "dirty_behind":
      return {
        tone: "yellow",
        label: `dirty · ${status.behind} behind`,
        title:
          `${DIRTY_HINT[status.dirty]} ` +
          `Upstream has ${status.behind} new commit(s); pull-ff refuses on a dirty tree — stash or commit first.`,
        bucket,
      };

    case "dirty":
      return {
        tone: "yellow",
        label: status.ahead > 0 ? `dirty · ↑${status.ahead}` : "dirty",
        title:
          DIRTY_HINT[status.dirty] ||
          "Working tree has uncommitted changes.",
        bucket,
      };

    case "behind":
      return {
        tone: "blue",
        label: `${status.behind} behind`,
        title: `${status.behind} commit(s) behind upstream — Pull to fast-forward.`,
        bucket,
      };

    case "ahead":
      return {
        tone: "blue",
        label: `↑${status.ahead}`,
        title: `${status.ahead} commit(s) ahead of upstream, ready to push.`,
        bucket,
      };

    case "unpushed": {
      const n = status.unpushedNoUpstream ?? 0;
      return {
        tone: "yellow",
        label: `${n} unpushed`,
        title:
          `${n} commit(s) on this branch are not on origin/${status.defaultBranch}. ` +
          "No upstream is configured — push manually or set upstream.",
        bucket,
      };
    }

    case "no_upstream":
      return {
        tone: "neutral",
        label: "no upstream",
        title:
          "No upstream configured. Push with `git push -u origin <branch>` or use Commit & push.",
        bucket,
      };

    case "off_default":
      // Branch pill's amber styling already signals "off default".
      return null;

    case "clean":
      // Absence is the signal — don't render a loud "up to date" chip.
      return null;
  }
}
