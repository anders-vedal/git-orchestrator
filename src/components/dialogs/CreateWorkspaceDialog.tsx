import {
  AlertTriangle,
  Check,
  GitBranch,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import * as api from "../../lib/tauri";
import { useReposStore } from "../../stores/reposStore";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspacesStore } from "../../stores/workspacesStore";
import type { WorkspaceEntryInput } from "../../types";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

interface EditableRow {
  repoId: number;
  repoName: string;
  repoPath: string;
  branch: string;
  /** True when this repo was part of the seed but can't contribute a
   *  sensible branch (unborn / detached HEAD / not yet loaded). */
  warning: string | null;
}

export function CreateWorkspaceDialog() {
  const dialog = useUiStore((s) => s.dialog);
  const closeDialog = useUiStore((s) => s.closeDialog);
  const statuses = useReposStore((s) => s.statuses);
  const createWs = useWorkspacesStore((s) => s.create);
  const updateEntries = useWorkspacesStore((s) => s.updateEntries);
  const renameWs = useWorkspacesStore((s) => s.rename);

  const open = dialog?.kind === "createWorkspace";
  const editId = dialog?.kind === "createWorkspace" ? dialog.editId : undefined;
  const seedRepoIds =
    dialog?.kind === "createWorkspace" ? (dialog.seedRepoIds ?? []) : [];
  const isEdit = editId != null;

  const [name, setName] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed rows from either an existing workspace (edit) or the current
  // selection (create). Runs on every open.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);

    if (isEdit && editId != null) {
      setLoading(true);
      void (async () => {
        try {
          const detail = await api.getWorkspace(editId);
          setName(detail.name);
          setOriginalName(detail.name);
          setRows(
            detail.entries.map((e) => ({
              repoId: e.repoId,
              repoName: e.repoName,
              repoPath: "",
              branch: e.branch,
              warning: e.repoPathExists
                ? null
                : "Repo path no longer exists on disk.",
            })),
          );
        } catch (e) {
          setError(String(e));
        } finally {
          setLoading(false);
        }
      })();
      return;
    }

    // Create mode — seed from the passed repo ids (matching statuses order).
    setName("");
    setOriginalName("");
    const byId = new Map(statuses.map((s) => [s.id, s] as const));
    const seeded: EditableRow[] = seedRepoIds.map((id) => {
      const s = byId.get(id);
      if (!s) {
        return {
          repoId: id,
          repoName: `Repo ${id}`,
          repoPath: "",
          branch: "",
          warning: "Repo missing from dashboard.",
        };
      }
      return {
        repoId: id,
        repoName: s.name,
        repoPath: s.path,
        branch: s.branch ?? "",
        warning: !s.branch
          ? "Current branch unknown — likely detached HEAD or unborn. Edit the branch name before saving."
          : null,
      };
    });
    setRows(seeded);
  }, [open, isEdit, editId, seedRepoIds, statuses]);

  const commandsPreview = useMemo(() => {
    return rows
      .filter((r) => r.branch.trim())
      .map((r) => `(${r.repoName}) git checkout ${r.branch.trim()}`)
      .join("\n");
  }, [rows]);

  function updateBranch(repoId: number, value: string) {
    setRows((rs) =>
      rs.map((r) => (r.repoId === repoId ? { ...r, branch: value } : r)),
    );
  }

  function removeRow(repoId: number) {
    setRows((rs) => rs.filter((r) => r.repoId !== repoId));
  }

  async function save() {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Workspace name is required.");
      return;
    }
    if (rows.length === 0) {
      setError("Add at least one repo.");
      return;
    }
    const bad = rows.find((r) => !r.branch.trim());
    if (bad) {
      setError(`Branch for “${bad.repoName}” is empty.`);
      return;
    }
    const entries: WorkspaceEntryInput[] = rows.map((r) => [
      r.repoId,
      r.branch.trim(),
    ]);

    setSaving(true);
    try {
      if (isEdit && editId != null) {
        if (trimmedName !== originalName) {
          await renameWs(editId, trimmedName);
        }
        await updateEntries(editId, entries);
      } else {
        await createWs(trimmedName, entries);
      }
      closeDialog();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={closeDialog}
      title={isEdit ? "Edit workspace" : "Create workspace"}
      wide
      footer={
        <>
          <Button onClick={closeDialog} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={saving || loading}
            icon={
              saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )
            }
          >
            {isEdit ? "Save changes" : "Create workspace"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" style={{ maxHeight: "70vh" }}>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">
            Workspace name
          </span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="e.g. NOR-876 payment redesign"
            spellCheck={false}
            maxLength={80}
            className="h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-zinc-100 focus:border-blue-400 focus:outline-none"
          />
        </label>

        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">
            Repos in this workspace
          </div>
          <div className="text-[11px] text-zinc-500">
            {rows.length} {rows.length === 1 ? "repo" : "repos"}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 p-3 text-sm text-zinc-400">
            <Loader2 size={14} className="animate-spin" /> Loading workspace…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface-0 p-4 text-xs text-zinc-500">
            No repos yet. Close this dialog, select repos in the list (click
            row checkboxes), then choose “Create workspace from selection…”
            from the workspace switcher.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto rounded-md border border-border bg-surface-0">
            {rows.map((row) => (
              <div
                key={row.repoId}
                className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0"
              >
                <div className="flex w-44 flex-col truncate">
                  <span className="truncate text-sm text-zinc-100">
                    {row.repoName}
                  </span>
                  {row.repoPath && (
                    <span
                      className="truncate font-mono text-[10px] text-zinc-500"
                      title={row.repoPath}
                    >
                      {row.repoPath}
                    </span>
                  )}
                </div>
                <div className="relative flex-1">
                  <GitBranch
                    size={12}
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500"
                  />
                  <input
                    value={row.branch}
                    onChange={(e) =>
                      updateBranch(row.repoId, e.currentTarget.value)
                    }
                    placeholder="branch name"
                    spellCheck={false}
                    className="h-8 w-full rounded-md border border-border bg-surface-2 pl-7 pr-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-blue-400 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(row.repoId)}
                  title="Remove from workspace"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-surface-3 hover:text-red-300"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {rows.some((r) => r.warning) && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <ul className="list-disc space-y-0.5 pl-4">
              {rows
                .filter((r) => r.warning)
                .map((r) => (
                  <li key={r.repoId}>
                    <span className="font-medium">{r.repoName}</span> —{" "}
                    {r.warning}
                  </li>
                ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-300">
            <X size={14} className="shrink-0" />
            <span className="flex-1 whitespace-pre-wrap">{error}</span>
          </div>
        )}

        {commandsPreview && (
          <details className="text-[11px] text-zinc-400">
            <summary className="cursor-pointer select-none text-zinc-400 hover:text-zinc-200">
              What will run on Activate
            </summary>
            <pre className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-surface-0 p-2 font-mono text-[10px] leading-relaxed text-zinc-300">
              {commandsPreview}
            </pre>
          </details>
        )}
      </div>
    </Dialog>
  );
}
