export type Dirty = "clean" | "unstaged" | "staged" | "untracked" | "mixed";

export interface Repo {
  id: number;
  name: string;
  path: string;
  priority: number;
  addedAt: string;
}

export interface Commit {
  sha: string;
  shaShort: string;
  message: string;
  author: string;
  timestamp: string;
}

export interface RepoStatus {
  id: number;
  name: string;
  path: string;
  branch: string;
  defaultBranch: string;
  ahead: number;
  behind: number;
  dirty: Dirty;
  hasUpstream: boolean;
  lastFetch: string | null;
  latestCommit: Commit | null;
  remoteUrl: string | null;
  hasSubmodules: boolean;
  diverged: boolean;
  unpushedNoUpstream: number | null;
  commitCount: number | null;
  error: string | null;
}

export type BulkReason =
  | "ok"
  | "off_default"
  | "dirty"
  | "path_missing"
  | "fetch_failed"
  | "pull_failed"
  | "status_failed";

export interface BulkResult {
  id: number;
  ok: boolean;
  message: string;
  reason?: BulkReason;
}

export interface BulkPullReport {
  updated: BulkResult[];
  skipped: BulkResult[];
  blocked: BulkResult[];
}

export interface ForcePullResult {
  preHeadSha: string | null;
  preHeadShort: string | null;
  postHeadSha: string | null;
  postHeadShort: string | null;
  discardedCount: number;
  message: string;
}

export interface CommitPushResult {
  branch: string;
  stagedFiles: number;
  committed: boolean;
  commitSha: string | null;
  commitShort: string | null;
  commitMessage: string;
  pushAttempted: boolean;
  pushed: boolean;
  upstreamSet: boolean;
  pushOutput: string;
}

export interface DirtyBreakdown {
  staged: number;
  unstaged: number;
  untracked: number;
}

export interface ChangedFile {
  path: string;
  origPath?: string;
  x: string;
  y: string;
}

export interface ChangedFiles {
  files: ChangedFile[];
  total: number;
  truncated: boolean;
}

export interface ForcePullPreview {
  currentBranch: string;
  defaultBranch: string;
  onDefault: boolean;
  ahead: number;
  behind: number;
  unpushedCommits: Commit[];
  dirty: DirtyBreakdown;
  remoteHeadShort: string | null;
}

export interface ActionLogEntry {
  id: number;
  repoId: number;
  action: string;
  preHeadSha: string | null;
  postHeadSha: string | null;
  exitCode: number;
  stderrExcerpt: string | null;
  startedAt: string;
  durationMs: number;
}

export interface IgnoredPath {
  path: string;
  addedAt: string;
}

export interface ScanEntry {
  path: string;
  displayName: string;
  alreadyAdded: boolean;
  ignored: boolean;
}

export interface ScanResult {
  parent: string;
  entries: ScanEntry[];
}

export interface ScanSkip {
  path: string;
  reason: string;
}

export interface ScanAddResult {
  added: Repo[];
  skipped: ScanSkip[];
}

export type TerminalPref =
  | "auto"
  // Windows
  | "wt"
  | "git-bash"
  | "cmd"
  // macOS
  | "terminal"
  | "iterm2"
  // Linux
  | "gnome-terminal"
  | "konsole"
  | "alacritty"
  | "kitty"
  | "xterm";
export type ThemePref = "dark" | "light" | "system";

export interface Settings {
  terminal: TerminalPref;
  refreshIntervalSec: number;
  defaultReposDir: string | null;
  theme: ThemePref;
  bulkConcurrency: number;
}

export const DEFAULT_SETTINGS: Settings = {
  terminal: "auto",
  refreshIntervalSec: 300,
  defaultReposDir: null,
  theme: "dark",
  bulkConcurrency: 4,
};

export interface SignInResult {
  ok: boolean;
  timedOut: boolean;
  message: string;
}

export interface GitSetupStatus {
  installed: boolean;
  version: string | null;
  userNameSet: boolean;
  userEmailSet: boolean;
  credentialHelperSet: boolean;
}

export interface ConfigureHelperResult {
  helper: string;
  message: string;
}
