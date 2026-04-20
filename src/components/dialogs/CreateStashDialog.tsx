import { Check, Loader2, PackageCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useReposStore } from "../../stores/reposStore";
import { useStashesStore } from "../../stores/stashesStore";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspacesStore } from "../../stores/workspacesStore";
import type { RepoStatus } from "../../types";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

function isDirty(s: RepoStatus): boolean {
  return s.dirty !== "clean";
}

export function CreateStashDialog() {
  const dialog = useUiStore((s) => s.dialog);
  const openDialog = useUiStore((s) => s.openDialog);
  const closeDialog = useUiStore((s) => s.closeDialog);

  const statuses = useReposStore((s) => s.statuses);
  const createStash = useStashesStore((s) => s.create);
  const activate = useWorkspacesStore((s) => s.activate);

  const open = dialog?.kind === "createStash";
  const seedRepoIds =
    dialog?.kind === "createStash" ? (dialog.seedRepoIds ?? []) : [];
  const thenActivateWorkspaceId =
    dialog?.kind === "createStash" ? dialog.thenActivateWorkspaceId : undefined;
  const suggestedLabel =
    dialog?.kind === "createStash" ? (dialog.suggestedLabel ?? "") : "";

  const [label, setLabel] = useState("");
  const [pickedIds, setPickedIds] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Candidate list: any repo that currently reports dirty. If seedRepoIds
  // is supplied, include those even if (for some race-condition reason)
  // their status has flipped to clean — the caller explicitly nominated
  // them (typically the workspace-activation retry path).
  const candidates = useMemo(() => {
    const seed = new Set(seedRepoIds);
    return statuses.filter((s) => isDirty(s) || seed.has(s.id));
  }, [statuses, seedRepoIds]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setLabel(suggestedLabel);
    // Preselect the seed ids, or all dirty repos if no seed provided.
    const preselected = seedRepoIds.length > 0 ? seedRepoIds : candidates.map((c) => c.id);
    setPickedIds(new Set(preselected));
    // Auto-focus is on the label input; handled via `autoFocus` attribute below.
  }, [open, suggestedLabel, seedRepoIds, candidates]);

  function togglePick(id: number) {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setError(null);
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Label is required.");
      return;
    }
    if (pickedIds.size === 0) {
      setError("Pick at least one repo to stash.");
      return;
    }
    setSaving(true);
    try {
      const report = await createStash(trimmed, Array.from(pickedIds));
      // Show the push result (including nothing_to_stash / failed rows).
      // If thenActivateWorkspaceId is set, chain into activation afterwards.
      closeDialog();
      openDialog({ kind: "stashPushResult", report });

      if (thenActivateWorkspaceId != null) {
        // Give the push-result dialog a tick to render, then activate.
        // The activation-result dialog replaces it.
        setTimeout(() => {
          void (async () => {
            try {
              const act = await activate(thenActivateWorkspaceId);
              useUiStore
                .getState()
                .openDialog({ kind: "workspaceActivationResult", report: act });
            } catch (e) {
              useUiStore.getState().openDialog({
                kind: "gitError",
                title: "Activate workspace failed",
                error: String(e),
              });
            }
          })();
        }, 50);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!saving) closeDialog();
      }}
      title={
        thenActivateWorkspaceId != null
          ? "Stash dirty repos and activate"
          : "Stash dirty repos"
      }
      wide
      footer={
        <>
          <Button onClick={closeDialog} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={saving || candidates.length === 0}
            icon={
              saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )
            }
          >
            {thenActivateWorkspaceId != null
              ? "Stash & activate"
              : "Create stash bundle"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" style={{ maxHeight: "70vh" }}>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">
            Label
          </span>
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.currentTarget.value)}
            placeholder="e.g. pre-NOR-876 switch"
            spellCheck={false}
            maxLength={120}
            className="h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-zinc-100 focus:border-blue-400 focus:outline-none"
          />
          <span className="text-[10px] text-zinc-500">
            This label becomes the stash message in each repo — so{" "}
            <code className="rounded bg-surface-3 px-1 font-mono">
              git stash list
            </code>{" "}
            in a terminal shows it too.
          </span>
        </label>

        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">
            Repos to stash
          </div>
          <div className="text-[11px] text-zinc-500">
            {pickedIds.size} / {candidates.length} picked
          </div>
        </div>

        {candidates.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface-0 p-4 text-center text-xs text-zinc-500">
            <PackageCheck
              size={22}
              className="mx-auto mb-2 opacity-40"
              aria-hidden="true"
            />
            No dirty repos — nothing to stash.
          </div>
        ) : (
          <div className="overflow-y-auto rounded-md border border-border bg-surface-0">
            {candidates.map((c) => {
              const checked = pickedIds.has(c.id);
              return (
                <label
                  key={c.id}
                  className={`flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 last:border-b-0 hover:bg-surface-1 ${
                    checked ? "bg-surface-1" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePick(c.id)}
                    className="h-4 w-4 accent-blue-500"
                  />
                  <span className="flex-1 truncate text-sm text-zinc-100">
                    {c.name}
                  </span>
                  <span className="truncate font-mono text-[11px] text-zinc-400">
                    {c.branch || "—"}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      c.dirty === "clean"
                        ? "border border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
                        : "border border-amber-500/30 bg-amber-500/5 text-amber-300"
                    }`}
                  >
                    {c.dirty}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-300">
            <X size={14} className="shrink-0" />
            <span className="flex-1 whitespace-pre-wrap">{error}</span>
          </div>
        )}
      </div>
    </Dialog>
  );
}
