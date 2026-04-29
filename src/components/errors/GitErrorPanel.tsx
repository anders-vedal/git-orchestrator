import {
  AlertTriangle,
  BookOpen,
  KeyRound,
  Loader2,
  Lock,
  Network,
  Search,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Wand2,
} from "lucide-react";
import { useEffect, useState } from "react";
import * as api from "../../lib/tauri";
import { classifyGitError, type ClassifiedGitError } from "../../lib/gitErrors";
import { parseRemote, sshDocsUrl } from "../../lib/providers";
import { useReposStore } from "../../stores/reposStore";
import { Button } from "../ui/Button";

const CATEGORY_ICON: Record<ClassifiedGitError["category"], typeof AlertTriangle> = {
  auth_ssh: Lock,
  auth_https: Lock,
  auth_no_helper: KeyRound,
  cert_invalid: ShieldAlert,
  dirty_tree: AlertTriangle,
  not_ffable: AlertTriangle,
  network: Network,
  rate_limited: Network,
  refused: ShieldCheck,
  unknown: AlertTriangle,
};

interface Props {
  /** Raw error string (typically the caught `e` from an api call). */
  error: string;
  /** Repo to target when the user clicks "Open terminal" or "Diagnose". */
  repoId?: number;
}

export function GitErrorPanel({ error, repoId }: Props) {
  const classified = classifyGitError(error);
  const Icon = CATEGORY_ICON[classified.category];
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagOutput, setDiagOutput] = useState<string | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);

  const [signInBusy, setSignInBusy] = useState(false);
  const [signInMessage, setSignInMessage] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  // Credential-helper probe + one-click configure flow. Runs only when the
  // failure category is auth-related, so we don't fan out an extra git
  // call on every "branch diverged" or "network down" error.
  const [helperConfigured, setHelperConfigured] = useState<boolean | null>(
    null,
  );
  const [configureBusy, setConfigureBusy] = useState(false);
  const [configureMessage, setConfigureMessage] = useState<string | null>(null);
  const [configureError, setConfigureError] = useState<string | null>(null);

  const isAuthCategory =
    classified.category === "auth_no_helper" ||
    classified.category === "auth_https" ||
    classified.category === "auth_ssh";

  useEffect(() => {
    if (!isAuthCategory) return;
    let cancelled = false;
    void (async () => {
      try {
        const s = await api.gitSetupStatus();
        if (!cancelled) setHelperConfigured(s.credentialHelperSet);
      } catch {
        if (!cancelled) setHelperConfigured(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthCategory]);

  const refreshOne = useReposStore((s) => s.refreshOne);
  const remoteUrl = useReposStore((s) =>
    repoId === undefined
      ? null
      : s.statuses.find((x) => x.id === repoId)?.remoteUrl ?? null,
  );
  const remote = parseRemote(remoteUrl);
  const docsUrl = sshDocsUrl(remote.provider);

  async function diagnose() {
    if (repoId === undefined) return;
    setDiagBusy(true);
    setDiagError(null);
    setDiagOutput(null);
    try {
      const trace = await api.diagnoseAuth(repoId);
      setDiagOutput(trace);
    } catch (e) {
      setDiagError(String(e));
    } finally {
      setDiagBusy(false);
    }
  }

  async function signIn() {
    if (repoId === undefined) return;
    setSignInBusy(true);
    setSignInError(null);
    setSignInMessage(null);
    try {
      const result = await api.signInRemote(repoId);
      setSignInMessage(result.message);
      if (result.ok) {
        await refreshOne(repoId);
      }
    } catch (e) {
      // Hard failure — re-classify and show the hint inline.
      setSignInError(String(e));
    } finally {
      setSignInBusy(false);
    }
  }

  async function configureHelper() {
    setConfigureBusy(true);
    setConfigureError(null);
    setConfigureMessage(null);
    try {
      const result = await api.configureCredentialHelper();
      setConfigureMessage(result.message);
      setHelperConfigured(true);
      // Auto-retry sign-in with the freshly configured helper so the user
      // sees the browser/credential popup without a second click.
      if (repoId !== undefined) {
        await signIn();
      }
    } catch (e) {
      setConfigureError(String(e));
    } finally {
      setConfigureBusy(false);
    }
  }

  // Provider-aware CTA label. Falls back to generic "Sign in" when the
  // host isn't one we recognise.
  const signInLabel =
    remote.provider === "other"
      ? "Sign in to remote"
      : `Sign in to ${remote.label}`;

  // The "Set up credential helper" CTA shows whenever git couldn't
  // resolve credentials and we know — or can't yet rule out — that no
  // helper is wired up at the global scope. `auth_no_helper` is a hard
  // signal; `auth_https` is conditional on the probe returning false.
  const showConfigureHelper =
    classified.category === "auth_no_helper" ||
    (classified.category === "auth_https" && helperConfigured === false);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <Icon size={18} className="mt-0.5 shrink-0 text-red-400" />
        <div>
          <div className="font-semibold text-zinc-100">{classified.title}</div>
          <div className="mt-1 text-sm text-zinc-300">{classified.hint}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {showConfigureHelper && (
          <Button
            variant="primary"
            onClick={() => void configureHelper()}
            disabled={configureBusy || signInBusy}
            icon={
              configureBusy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Wand2 size={14} />
              )
            }
          >
            {configureBusy ? "Configuring…" : "Set up credential helper"}
          </Button>
        )}
        {classified.category === "auth_https" &&
          !showConfigureHelper &&
          repoId !== undefined && (
            <Button
              variant="primary"
              onClick={() => void signIn()}
              disabled={signInBusy}
              icon={
                signInBusy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <KeyRound size={14} />
                )
              }
            >
              {signInBusy ? "Waiting for sign-in…" : signInLabel}
            </Button>
          )}
        {classified.category === "auth_ssh" && docsUrl && (
          <a
            href={docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-surface-2"
          >
            <BookOpen size={14} />
            Set up SSH for {remote.label}
          </a>
        )}
        {repoId !== undefined && (
          <Button
            variant="default"
            onClick={() => void api.openTerminal(repoId)}
            icon={<Terminal size={14} />}
          >
            Open terminal
          </Button>
        )}
        {classified.diagnosable && repoId !== undefined && (
          <Button
            variant="default"
            onClick={() => void diagnose()}
            disabled={diagBusy}
            icon={<Search size={14} />}
          >
            {diagBusy ? "Tracing…" : "Diagnose auth"}
          </Button>
        )}
      </div>

      {configureMessage && (
        <div className="rounded border border-emerald-900/60 bg-emerald-950/20 px-2.5 py-2 text-xs text-emerald-200">
          {configureMessage}
        </div>
      )}
      {configureError && (
        <div className="rounded border border-red-900/60 bg-red-950/20 px-2.5 py-2 text-xs text-red-300">
          Couldn&apos;t configure helper: {configureError}
        </div>
      )}

      {signInMessage && (
        <div
          className={
            signInMessage.startsWith("Signed in")
              ? "rounded border border-emerald-900/60 bg-emerald-950/20 px-2.5 py-2 text-xs text-emerald-200"
              : "rounded border border-amber-900/60 bg-amber-950/20 px-2.5 py-2 text-xs text-amber-200"
          }
        >
          {signInMessage}
        </div>
      )}
      {signInError && (
        <div className="rounded border border-red-900/60 bg-red-950/20 px-2.5 py-2 text-xs text-red-300">
          Sign-in failed: {signInError}
        </div>
      )}

      {diagError && (
        <div className="rounded border border-red-900/60 bg-red-950/20 px-2.5 py-2 text-xs text-red-300">
          Diagnose failed: {diagError}
        </div>
      )}
      {diagOutput && (
        <details open className="text-xs">
          <summary className="cursor-pointer text-zinc-400">
            Diagnostic trace (with <code>GIT_TRACE=1</code>)
          </summary>
          <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-surface-1 p-2 font-mono text-zinc-300">
            {diagOutput}
          </pre>
        </details>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-zinc-400">Raw output</summary>
        <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-surface-1 p-2 font-mono text-zinc-300">
          {classified.raw}
        </pre>
      </details>
    </div>
  );
}
