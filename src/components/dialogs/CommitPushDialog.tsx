import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import * as api from "../../lib/tauri";
import { useReposStore } from "../../stores/reposStore";
import { useUiStore } from "../../stores/uiStore";
import type { ChangedFiles } from "../../types";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

export function CommitPushDialog() {
  const dialog = useUiStore((s) => s.dialog);
  const close = useUiStore((s) => s.closeDialog);
  const openDialog = useUiStore((s) => s.openDialog);
  const refreshOne = useReposStore((s) => s.refreshOne);

  const [message, setMessage] = useState("");
  const [push, setPush] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ChangedFiles | null>(null);

  const open = dialog?.kind === "commitPush";
  const id = open ? dialog.id : null;
  const name = open ? dialog.name : "";
  const branch = open ? dialog.branch : "";
  const defaultBranch = open ? dialog.defaultBranch : "";
  const hasUpstream = open ? dialog.hasUpstream : false;

  useEffect(() => {
    if (!open || id === null) return;
    setMessage("");
    setError(null);
    setPush(true);
    setPreview(null);
    let cancelled = false;
    api
      .getChangedFiles(id, 100)
      .then((r) => {
        if (!cancelled) setPreview(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, id]);

  async function confirm() {
    if (id === null) return;
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Commit message is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.gitCommitPush(id, trimmed, push);
      await refreshOne(id);
      close();
      if (push && !result.pushed) {
        openDialog({
          kind: "gitError",
          title: `Committed ${result.commitShort ?? ""} — but push failed`,
          error: result.pushOutput || "push failed",
          repoId: id,
        });
      } else {
        const parts: string[] = [];
        if (result.commitShort) parts.push(`Committed ${result.commitShort}`);
        if (result.pushed) {
          parts.push(
            `Pushed to ${result.upstreamSet ? "new upstream " : ""}origin/${result.branch}`,
          );
        }
        openDialog({
          kind: "info",
          title: "Commit complete",
          body: parts.join(" · "),
        });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const fileCount = preview?.total ?? 0;
  const canConfirm = !busy && fileCount > 0 && message.trim().length > 0;
  const buttonLabel = push ? "Commit & push" : "Commit only";

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : close}
      title={`Commit & push — ${name}`}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={confirm} disabled={!canConfirm}>
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Running…
              </>
            ) : (
              buttonLabel
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-zinc-300">
          <span>
            Branch: <span className="font-mono text-zinc-100">{branch}</span>
          </span>
          {branch !== defaultBranch && (
            <span className="text-zinc-500">
              (default: <span className="font-mono">{defaultBranch}</span>)
            </span>
          )}
          <span className="text-zinc-500">·</span>
          <span>
            Upstream:{" "}
            {hasUpstream ? (
              <span className="text-green-300">configured</span>
            ) : (
              <span className="text-yellow-300">none — will be set on first push</span>
            )}
          </span>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
            <span>
              {fileCount === 0
                ? "No changes to stage"
                : `${fileCount} file${fileCount === 1 ? "" : "s"} will be staged`}
            </span>
            {preview?.truncated && (
              <span className="text-zinc-500">
                showing first {preview.files.length}
              </span>
            )}
          </div>
          {preview && preview.files.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[11px] text-zinc-300">
              {preview.files.map((f) => (
                <div key={`${f.x}${f.y}:${f.path}`} className="truncate">
                  <span className="text-zinc-500">{f.x}
                    {f.y}</span>{" "}
                  {f.origPath ? `${f.origPath} → ${f.path}` : f.path}
                </div>
              ))}
            </div>
          )}
        </div>

        <label className="block">
          <span className="mb-1 block text-xs text-zinc-400">
            Commit message <span className="text-red-300">*</span>
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.currentTarget.value)}
            disabled={busy}
            rows={3}
            placeholder="Describe what you changed — first line is the subject."
            spellCheck
            className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-blue-400 focus:outline-none"
          />
        </label>

        <label className="flex items-start gap-2 rounded-md border border-border bg-surface-2 p-2.5 text-xs text-zinc-200">
          <input
            type="checkbox"
            checked={push}
            onChange={(e) => setPush(e.currentTarget.checked)}
            disabled={busy}
            className="mt-0.5 h-4 w-4 rounded border-border bg-surface-3"
          />
          <span>
            <span className="font-medium text-zinc-100">
              Push to origin/{branch} after commit
            </span>
            <span className="mt-0.5 block text-[11px] text-zinc-400">
              If unchecked the commit stays local — you can push later from the terminal or via fetch/pull once things look right.
            </span>
          </span>
        </label>

        <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[11px] text-zinc-400">
          <div className="mb-1 font-semibold uppercase tracking-wide text-zinc-500">
            What will happen
          </div>
          <ol className="list-decimal space-y-0.5 pl-5">
            <li>
              <code className="text-zinc-200">git add -A</code> — stages every
              modified, deleted, and untracked file listed above.
            </li>
            <li>
              <code className="text-zinc-200">
                git commit -m &quot;&lt;your message&gt;&quot;
              </code>{" "}
              — records the commit on <code>{branch}</code> using your
              configured <code>user.name</code> / <code>user.email</code>.
            </li>
            {push && (
              <li>
                <code className="text-zinc-200">
                  {hasUpstream ? "git push" : `git push -u origin ${branch}`}
                </code>{" "}
                — sends the commit to origin
                {hasUpstream ? "" : " and sets the upstream"}. Refuses on a
                non-fast-forward; your commit stays local if that happens.
              </li>
            )}
          </ol>
          <div className="mt-1.5 text-zinc-500">
            Never runs <code>--force</code>. A commit is recoverable via{" "}
            <code>git reset --soft HEAD~1</code> before you push.
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}
