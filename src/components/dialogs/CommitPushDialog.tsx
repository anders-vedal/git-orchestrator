import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import * as api from "../../lib/tauri";
import { useReposStore } from "../../stores/reposStore";
import { useUiStore } from "../../stores/uiStore";
import type { ChangedFiles, CommitPushResult, PushModeInfo } from "../../types";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

export function CommitPushDialog() {
  const dialog = useUiStore((s) => s.dialog);
  const close = useUiStore((s) => s.closeDialog);
  const openDialog = useUiStore((s) => s.openDialog);
  const refreshOne = useReposStore((s) => s.refreshOne);

  const [message, setMessage] = useState("");
  const [push, setPush] = useState(true);
  const [branchName, setBranchName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ChangedFiles | null>(null);
  const [modeInfo, setModeInfo] = useState<PushModeInfo | null>(null);
  const [result, setResult] = useState<CommitPushResult | null>(null);

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
    setBranchName("");
    setPreview(null);
    setModeInfo(null);
    setResult(null);
    let cancelled = false;
    api
      .getChangedFiles(id, 100)
      .then((r) => {
        if (!cancelled) setPreview(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    // Mode lookup is advisory — if it fails we fall back to the direct-push
    // UI and the backend still resolves authoritatively at commit time.
    api
      .getPushModeInfo(id)
      .then((m) => {
        if (!cancelled) setModeInfo(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, id]);

  const onDefault = branch === defaultBranch;
  // PR mode only activates when the user actually wants to push AND is on
  // the default branch. On a feature branch the direct push produces the
  // same compare-able outcome, so we hide the branch-name field.
  const prModeActive = push && modeInfo?.effective === "pr" && onDefault;
  const branchNameTrimmed = branchName.trim();
  const branchNameInvalid =
    prModeActive &&
    (branchNameTrimmed.length === 0 || /\s/.test(branchNameTrimmed));

  async function confirm() {
    if (id === null) return;
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setError("Commit message is required.");
      return;
    }
    if (prModeActive && branchNameInvalid) {
      setError("Pick a branch name (no spaces).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.gitCommitPush(
        id,
        trimmedMessage,
        push,
        null,
        prModeActive ? branchNameTrimmed : null,
      );
      await refreshOne(id);
      if (r.branchCreated && r.pushed && r.prUrl) {
        // PR mode fired and pushed — stay open so the user can click
        // through to the provider's compare page.
        setResult(r);
      } else if (push && !r.pushed) {
        close();
        openDialog({
          kind: "gitError",
          title: `Committed ${r.commitShort ?? ""} — but push failed`,
          error: r.pushOutput || "push failed",
          repoId: id,
        });
      } else {
        close();
        const parts: string[] = [];
        if (r.commitShort) parts.push(`Committed ${r.commitShort}`);
        if (r.pushed) {
          parts.push(
            `Pushed to ${r.upstreamSet ? "new upstream " : ""}origin/${r.branch}`,
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

  async function openPr() {
    if (!result?.prUrl) return;
    try {
      await api.openUrl(result.prUrl);
    } catch (e) {
      setError(String(e));
    }
  }

  const fileCount = preview?.total ?? 0;
  const canConfirm =
    !busy &&
    fileCount > 0 &&
    message.trim().length > 0 &&
    !branchNameInvalid;

  const buttonLabel = prModeActive
    ? "Commit & push PR branch"
    : push
      ? "Commit & push"
      : "Commit only";

  if (result) {
    return (
      <Dialog
        open={open}
        onClose={close}
        title={`Commit complete — ${name}`}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Done
            </Button>
            {result.prUrl && (
              <Button
                variant="primary"
                onClick={() => void openPr()}
                icon={<ExternalLink size={14} />}
              >
                Open pull request
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-md border border-green-900/40 bg-green-950/30 px-3 py-2 text-xs text-green-200">
            Committed{" "}
            <code className="font-mono text-green-100">
              {result.commitShort}
            </code>{" "}
            on new branch{" "}
            <code className="font-mono text-green-100">{result.branch}</code> —
            pushed to origin with upstream set.
          </div>
          <div className="text-[11px] text-zinc-400">
            The branch is ready for a pull request against{" "}
            <code className="font-mono text-zinc-200">{defaultBranch}</code>.
            Clicking <em>Open pull request</em> takes you to the provider&apos;s
            compare page with source and target pre-filled.
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
              {prModeActive
                ? `Create a new branch from ${defaultBranch} and push it to origin`
                : `Push to origin/${branch} after commit`}
            </span>
            <span className="mt-0.5 block text-[11px] text-zinc-400">
              {prModeActive
                ? `PR mode is on. The commit will not touch ${defaultBranch}; we branch off, commit there, and push so you can open a PR.`
                : "If unchecked the commit stays local — you can push later from the terminal or via fetch/pull once things look right."}
            </span>
          </span>
        </label>

        {prModeActive && (
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">
              New branch name <span className="text-red-300">*</span>
            </span>
            <input
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.currentTarget.value)}
              disabled={busy}
              placeholder="feat/short-description"
              spellCheck={false}
              className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-blue-400 focus:outline-none"
            />
            {branchNameInvalid && branchNameTrimmed.length > 0 && (
              <span className="mt-1 block text-[11px] text-red-300">
                Branch name can&apos;t contain spaces.
              </span>
            )}
          </label>
        )}

        <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[11px] text-zinc-400">
          <div className="mb-1 font-semibold uppercase tracking-wide text-zinc-500">
            What will happen
          </div>
          <ol className="list-decimal space-y-0.5 pl-5">
            {prModeActive ? (
              <>
                <li>
                  <code className="text-zinc-200">
                    git checkout -b {branchNameTrimmed || "<new branch>"}
                  </code>{" "}
                  — branches off <code>{defaultBranch}</code>.
                </li>
                <li>
                  <code className="text-zinc-200">git add -A</code> +{" "}
                  <code className="text-zinc-200">
                    git commit -m &quot;&lt;your message&gt;&quot;
                  </code>{" "}
                  — stages and commits on the new branch.
                </li>
                <li>
                  <code className="text-zinc-200">
                    git push -u origin {branchNameTrimmed || "<new branch>"}
                  </code>{" "}
                  — pushes with upstream set. Success opens a compare link you
                  can click through to a PR.
                </li>
              </>
            ) : (
              <>
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
              </>
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
