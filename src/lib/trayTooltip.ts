import type { RepoStatus } from "../types";

/**
 * Build the multiline tooltip shown when hovering the tray icon.
 * Called after every status refresh so the tray reflects current state.
 *
 * Format (Windows tooltips wrap at ~127 chars; we keep it compact):
 *
 *   [NOR-876] Repo Dashboard — 12 repos
 *   3 behind · 1 ahead · 2 dirty · 1 error
 *   attention: recruitment (behind 3), cortex (dirty)
 *
 * `activeWorkspaceName`, when non-null, is prefixed as `[name] ` on the
 * header line so the tray surface reflects the current workspace context.
 */
export function buildTooltip(
  statuses: RepoStatus[],
  activeWorkspaceName?: string | null,
): string {
  const wsPrefix = activeWorkspaceName ? `[${activeWorkspaceName}] ` : "";
  if (statuses.length === 0) {
    return `${wsPrefix}Repo Dashboard — no repos registered`;
  }

  let behind = 0;
  let ahead = 0;
  let dirty = 0;
  let errors = 0;
  let diverged = 0;
  let unpushed = 0;
  const attention: string[] = [];

  for (const s of statuses) {
    if (s.error) {
      errors++;
      attention.push(`${s.name} (error)`);
      continue;
    }
    if (s.diverged) diverged++;
    if (s.behind > 0) behind++;
    if (s.ahead > 0) ahead++;
    if (s.unpushedNoUpstream && s.unpushedNoUpstream > 0) unpushed++;
    const isDirty = s.dirty !== "clean";
    if (isDirty) dirty++;

    if (s.diverged || s.behind > 0 || isDirty) {
      const bits: string[] = [];
      if (s.diverged) bits.push("diverged");
      else if (s.behind > 0) bits.push(`behind ${s.behind}`);
      if (isDirty) bits.push(s.dirty);
      attention.push(`${s.name} (${bits.join(", ")})`);
    }
  }

  const head = `${wsPrefix}Repo Dashboard — ${statuses.length} repo${statuses.length === 1 ? "" : "s"}`;
  const summary = [
    diverged > 0 ? `${diverged} diverged` : null,
    behind > 0 ? `${behind} behind` : null,
    ahead > 0 ? `${ahead} ahead` : null,
    unpushed > 0 ? `${unpushed} unpushed` : null,
    dirty > 0 ? `${dirty} dirty` : null,
    errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const lines = [head];
  lines.push(summary.length > 0 ? summary : "all clean, up to date");
  if (attention.length > 0) {
    // Cap at first 3 to keep the tooltip short.
    const shown = attention.slice(0, 3).join(", ");
    const extra = attention.length > 3 ? ` (+${attention.length - 3} more)` : "";
    lines.push(`attention: ${shown}${extra}`);
  }
  return lines.join("\n");
}
