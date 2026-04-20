import { Download, Loader2, RotateCw } from "lucide-react";
import { useState } from "react";
import {
  installPendingUpdate,
  relaunchApp,
  type UpdateProgress,
} from "../../lib/updater";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

type Phase = "idle" | "installing" | "finished" | "error";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

export function UpdateDialog() {
  const dialog = useUiStore((s) => s.dialog);
  const close = useUiStore((s) => s.closeDialog);
  const open = dialog?.kind === "update";

  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function onInstall() {
    setPhase("installing");
    setError(null);
    setProgress(null);
    try {
      await installPendingUpdate((p) => setProgress(p));
      setPhase("finished");
    } catch (e) {
      setError(String(e));
      setPhase("error");
    }
  }

  async function onRelaunch() {
    try {
      await relaunchApp();
    } catch (e) {
      setError(String(e));
      setPhase("error");
    }
  }

  const pct =
    progress?.kind === "downloading" && progress.contentLength
      ? Math.min(100, Math.round((progress.downloaded / progress.contentLength) * 100))
      : null;

  return (
    <Dialog
      open={open}
      onClose={phase === "installing" ? () => {} : close}
      title={`Update available — v${dialog.version}`}
      wide
      footer={
        phase === "finished" ? (
          <>
            <Button variant="ghost" onClick={close}>
              Later
            </Button>
            <Button variant="primary" icon={<RotateCw size={14} />} onClick={onRelaunch}>
              Restart now
            </Button>
          </>
        ) : phase === "installing" ? (
          <Button variant="ghost" disabled icon={<Loader2 size={14} className="animate-spin" />}>
            Installing…
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Later
            </Button>
            <Button variant="primary" icon={<Download size={14} />} onClick={onInstall}>
              Download &amp; install
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <div className="text-xs text-zinc-400">
          You&apos;re on <span className="font-mono text-zinc-200">v{dialog.currentVersion}</span>.
          The signed installer will be downloaded from GitHub Releases and verified before it runs.
        </div>

        {dialog.date && (
          <div className="text-xs text-zinc-500">Released {dialog.date}</div>
        )}

        {dialog.notes ? (
          <div>
            <div className="mb-1 text-xs font-medium text-zinc-400">Release notes</div>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-surface-2 p-3 font-mono text-xs text-zinc-200">
              {dialog.notes}
            </pre>
          </div>
        ) : null}

        {phase === "installing" && (
          <div className="flex flex-col gap-1.5">
            <div className="h-2 w-full overflow-hidden rounded bg-surface-3">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: pct === null ? "30%" : `${pct}%` }}
              />
            </div>
            <div className="font-mono text-[11px] text-zinc-500">
              {progress?.kind === "started" && "Starting download…"}
              {progress?.kind === "downloading" &&
                `${formatBytes(progress.downloaded)}${
                  progress.contentLength ? ` / ${formatBytes(progress.contentLength)}` : ""
                }${pct !== null ? ` (${pct}%)` : ""}`}
              {progress?.kind === "finished" && "Finalizing…"}
              {progress === null && "Preparing…"}
            </div>
          </div>
        )}

        {phase === "finished" && (
          <div className="rounded-md border border-green-600/40 bg-green-600/10 px-3 py-2 text-xs text-green-200">
            Installed. Restart the app to finish.
          </div>
        )}

        {phase === "error" && error && (
          <div className="rounded-md border border-red-600/40 bg-red-600/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}
