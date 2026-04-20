// Attention-based sort. Orders rows so the eye lands on anything
// unusual first — errors, divergence, dirt, then behind, then off-default,
// then clean+uptodate at the bottom. Alpha is the tiebreaker so adjacent
// rows within the same bucket are stable and predictable.
//
// Pure: no stores, no side effects. Suitable for use inside `applyFilterSort`.

import { getRepoStateBucket, type StateBucketId } from "./repoState";
import type { RepoStatus } from "../types";

// Lower rank = higher up in the list = more attention-worthy.
const BUCKET_RANK: Record<StateBucketId, number> = {
  error: 0,
  diverged: 1,
  dirty_behind: 2,
  dirty: 3,
  behind: 4,
  unpushed: 5,
  no_upstream: 6,
  ahead: 7,
  off_default: 8,
  clean: 9,
};

export function attentionRank(status: RepoStatus): number {
  return BUCKET_RANK[getRepoStateBucket(status)];
}

export function sortByAttention(rows: RepoStatus[]): RepoStatus[] {
  return [...rows].sort((a, b) => {
    const ra = attentionRank(a);
    const rb = attentionRank(b);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
}
