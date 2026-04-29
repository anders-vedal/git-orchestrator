/**
 * Pure-string classification of git stderr output.
 *
 * All backend git ops funnel stderr into the `Err(String)` payload of a
 * Tauri command. This module pattern-matches the payload into a
 * category + user-facing hint so the UI can render a meaningful next step
 * instead of raw red text.
 *
 * The classifier is intentionally frontend-side:
 * - Keeps the backend IPC surface untouched (all commands still return
 *   `Result<T, String>`).
 * - Lets us iterate on phrasing without a Rust rebuild.
 * - Pattern matches are against stable English git output — we never
 *   localize the git binary.
 */

export type GitErrorCategory =
  | "auth_ssh"
  | "auth_https"
  | "auth_no_helper"
  | "cert_invalid"
  | "dirty_tree"
  | "not_ffable"
  | "network"
  | "rate_limited"
  | "refused"
  | "unknown";

export interface ClassifiedGitError {
  category: GitErrorCategory;
  title: string;
  hint: string;
  /** True when the user likely has a config/network problem worth diagnosing. */
  diagnosable: boolean;
  /** Sanitized raw stderr, ready to render behind an expander. */
  raw: string;
}

const PAT_RAW_TOKEN = /\b[a-zA-Z0-9_-]{32,}\b/g;
const PAT_HTTPS_USER = /https:\/\/[^@\s]+@/g;

/** Redact likely secrets before showing stderr to the user. */
export function sanitizeGitError(raw: string): string {
  return raw
    .replace(PAT_HTTPS_USER, "https://<user>@")
    .replace(PAT_RAW_TOKEN, (match) =>
      // Keep short tokens (SHAs are commonly shown) — only redact very long
      // alnum strings that smell like PATs. SHAs are up to 40 chars; PATs
      // are usually 40+ and not pure hex. Redact if it contains a letter
      // and is longer than 24 chars.
      /[a-z]/i.test(match) && !/^[0-9a-f]+$/i.test(match) && match.length > 24
        ? "<redacted>"
        : match,
    );
}

/**
 * Classify a raw git stderr string. Caller is responsible for deciding
 * whether to surface the hint inline or behind a dialog.
 */
export function classifyGitError(rawInput: string): ClassifiedGitError {
  const raw = sanitizeGitError(rawInput ?? "");
  const lower = raw.toLowerCase();

  // Refuse-before-action messages from our own guards.
  if (raw.startsWith("refuse to ")) {
    return {
      category: "refused",
      title: "Refused by safety guard",
      hint: "The action was blocked because the repo wasn't in the expected state. Check the current branch and the working tree.",
      diagnosable: false,
      raw,
    };
  }

  // SSH auth
  if (
    lower.includes("permission denied (publickey)") ||
    lower.includes("host key verification failed") ||
    lower.includes("could not read from remote repository")
  ) {
    return {
      category: "auth_ssh",
      title: "SSH authentication failed",
      hint: "Run `ssh -T git@<host>` in a terminal to accept the host key or unlock your SSH key. If you use an SSH passphrase, ensure ssh-agent is running — GUIs cannot prompt for passphrases.",
      diagnosable: true,
      raw,
    };
  }

  // No credential helper — git fell through to its tty-bound askpass
  // fallback because no helper handled the request. Classify BEFORE
  // `auth_https` so the more specific match wins.
  if (
    lower.includes("/dev/tty: no such device or address") ||
    lower.includes("failed to execute prompt script") ||
    lower.includes("terminal prompts disabled")
  ) {
    return {
      category: "auth_no_helper",
      title: "No credential helper is handling sign-in",
      hint: "Git tried to prompt for credentials, but no credential helper picked up the request. Set up Git Credential Manager so the next sign-in pops a browser window and saves the result to your OS keychain.",
      diagnosable: true,
      raw,
    };
  }

  // HTTPS auth
  if (
    lower.includes("could not read username") ||
    lower.includes("authentication failed") ||
    lower.includes("invalid username or password") ||
    lower.includes("fatal: unable to access")
  ) {
    return {
      category: "auth_https",
      title: "HTTPS authentication failed",
      hint: "The Git Credential Manager popup may have been dismissed, or your credentials expired. Open a terminal and run `git fetch` once to reauthenticate.",
      diagnosable: true,
      raw,
    };
  }

  // TLS / corporate CA
  if (
    lower.includes("ssl certificate problem") ||
    lower.includes("unable to get local issuer certificate") ||
    lower.includes("self signed certificate") ||
    lower.includes("self-signed certificate")
  ) {
    return {
      category: "cert_invalid",
      title: "TLS certificate not trusted",
      hint: "Your network likely uses a corporate CA. Configure git to trust it: `git config --global http.sslCAInfo <path-to-ca-bundle>` or install the CA in your OS trust store.",
      diagnosable: true,
      raw,
    };
  }

  // Dirty tree on pull/merge
  if (
    lower.includes("local changes to the following files would be overwritten") ||
    lower.includes("please commit your changes or stash them") ||
    lower.includes("working tree clean")
  ) {
    return {
      category: "dirty_tree",
      title: "Uncommitted local changes",
      hint: "Commit or stash your changes before pulling. Use the Open terminal button to run `git stash && git pull --ff-only && git stash pop` yourself.",
      diagnosable: false,
      raw,
    };
  }

  // Not fast-forwardable
  if (
    lower.includes("not possible to fast-forward") ||
    lower.includes("need to specify how to reconcile") ||
    lower.includes("diverging") ||
    lower.includes("refusing to merge unrelated histories")
  ) {
    return {
      category: "not_ffable",
      title: "Branch has diverged from remote",
      hint: "Your local branch has commits the remote doesn't have. Open a terminal to decide between merge, rebase, or force pull (destructive).",
      diagnosable: false,
      raw,
    };
  }

  // Rate limiting
  if (
    lower.includes("rate limit") ||
    lower.includes("429 too many") ||
    lower.includes("api rate")
  ) {
    return {
      category: "rate_limited",
      title: "Remote rate-limited",
      hint: "The remote briefly blocked further requests. Wait a minute and retry.",
      diagnosable: false,
      raw,
    };
  }

  // Network
  if (
    lower.includes("could not resolve host") ||
    lower.includes("connection timed out") ||
    lower.includes("connection refused") ||
    lower.includes("early eof") ||
    lower.includes("the remote end hung up")
  ) {
    return {
      category: "network",
      title: "Network error",
      hint: "Check connectivity, VPN, or proxy settings. Retry in a few seconds.",
      diagnosable: true,
      raw,
    };
  }

  return {
    category: "unknown",
    title: "Git reported an error",
    hint: "Open a terminal in the repo to investigate. Expand the output below for the exact message.",
    diagnosable: false,
    raw,
  };
}
