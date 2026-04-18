import { AlertCircle, ExternalLink, Loader2, RefreshCcw, Wand2, X } from "lucide-react";
import { useEffect, useState } from "react";
import * as api from "../lib/tauri";
import type { GitSetupStatus } from "../types";

/**
 * First-run nudge for users who haven't finished setting up Git on their
 * machine. Appears when:
 *   - `git` isn't on PATH, OR
 *   - `user.name` / `user.email` / `credential.helper` are unset globally.
 *
 * When the only missing piece is `credential.helper`, the banner offers a
 * one-click fix (`configureCredentialHelper`) rather than asking the user
 * to reinstall or run `git config` themselves. Reinstalling is almost
 * never the right fix — GCM usually ships bundled, just not registered.
 */
export function GitSetupBanner() {
  const [status, setStatus] = useState<GitSetupStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixMessage, setFixMessage] = useState<string | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);

  useEffect(() => {
    void check();
    // Intentionally only runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function check() {
    setChecking(true);
    try {
      const s = await api.gitSetupStatus();
      setStatus(s);
    } catch {
      setStatus({
        installed: false,
        version: null,
        userNameSet: false,
        userEmailSet: false,
        credentialHelperSet: false,
      });
    } finally {
      setChecking(false);
    }
  }

  async function fixCredentialHelper() {
    setFixing(true);
    setFixError(null);
    setFixMessage(null);
    try {
      const result = await api.configureCredentialHelper();
      setFixMessage(result.message);
      // Re-probe — if everything else is good, the banner disappears.
      await check();
    } catch (e) {
      setFixError(String(e));
    } finally {
      setFixing(false);
    }
  }

  if (dismissed || !status) return null;

  const needsInstall = !status.installed;
  const needsHelper = status.installed && !status.credentialHelperSet;
  const needsIdentity =
    status.installed && (!status.userNameSet || !status.userEmailSet);

  if (!needsInstall && !needsHelper && !needsIdentity) return null;

  return (
    <div className="mx-3 mt-3 rounded-md border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-100">
      <div className="flex items-start gap-2">
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-300" />
        <div className="flex-1 space-y-2">
          <div className="font-semibold text-amber-100">
            {needsInstall ? "Git isn't installed" : "Finish setting up Git"}
          </div>

          {needsInstall && (
            <div className="text-amber-200/90">
              This app shells out to the system <code>git</code> binary for
              everything. Install Git for Windows to use the fetch, pull, and
              sign-in features.
            </div>
          )}

          {needsHelper && (
            <div className="space-y-1.5">
              <div className="text-amber-200/90">
                No credential helper is configured — signing in to remotes
                won&apos;t persist your credentials. One click sets this up.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void fixCredentialHelper()}
                  disabled={fixing}
                  className="inline-flex items-center gap-1 rounded border border-amber-600/60 bg-amber-800/50 px-2 py-1 font-medium hover:bg-amber-800/70 disabled:opacity-50"
                >
                  {fixing ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Wand2 size={12} />
                  )}
                  {fixing ? "Configuring…" : "Set up credential helper"}
                </button>
                <details className="text-[11px] text-amber-200/70">
                  <summary className="cursor-pointer">
                    Prefer to run it yourself?
                  </summary>
                  <div className="mt-1 space-y-1">
                    <div>Paste in a terminal:</div>
                    <code className="block rounded bg-amber-950/60 px-1.5 py-1 font-mono text-amber-100">
                      git config --global credential.helper manager
                    </code>
                    <div>
                      Or <code>wincred</code> if Git Credential Manager isn&apos;t
                      installed.
                    </div>
                  </div>
                </details>
              </div>
            </div>
          )}

          {needsIdentity && (
            <div className="space-y-1.5">
              <div className="text-amber-200/90">
                Your global git identity isn&apos;t set
                {!status.userNameSet && !status.userEmailSet
                  ? " (user.name and user.email are empty)"
                  : !status.userNameSet
                    ? " (user.name is empty)"
                    : " (user.email is empty)"}
                . Run these in a terminal:
              </div>
              <code className="block rounded bg-amber-950/60 px-1.5 py-1 font-mono text-amber-100">
                {`git config --global user.name "Your Name"`}
                <br />
                {`git config --global user.email "you@example.com"`}
              </code>
            </div>
          )}

          {fixMessage && (
            <div className="rounded border border-emerald-900/60 bg-emerald-950/40 px-2 py-1.5 text-emerald-200">
              {fixMessage}
            </div>
          )}
          {fixError && (
            <div className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1.5 text-red-200">
              {fixError}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {needsInstall && (
              <a
                href="https://git-scm.com/download/win"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded border border-amber-700/60 bg-amber-900/40 px-2 py-1 hover:bg-amber-900/60"
              >
                <ExternalLink size={12} />
                Download Git
              </a>
            )}
            <button
              onClick={() => void check()}
              disabled={checking}
              className="inline-flex items-center gap-1 rounded border border-amber-700/60 bg-amber-900/40 px-2 py-1 hover:bg-amber-900/60 disabled:opacity-50"
            >
              <RefreshCcw size={12} />
              {checking ? "Checking…" : "Check again"}
            </button>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          title="Dismiss for this session"
          className="shrink-0 rounded p-1 text-amber-300 hover:bg-amber-900/40"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
