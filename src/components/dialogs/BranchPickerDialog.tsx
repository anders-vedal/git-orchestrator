import {
  AlertTriangle,
  Circle,
  CornerUpLeft,
  GitBranch,
  Globe,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { timeAgo } from "../../lib/format";
import * as api from "../../lib/tauri";
import { useReposStore } from "../../stores/reposStore";
import { useUiStore } from "../../stores/uiStore";
import type { BranchInfo, BranchList } from "../../types";
import { Button, IconButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Pill } from "../ui/Pill";

type Mode = "pick" | "create";

function stripOrigin(name: string): string {
  // "origin/feat/x" → "feat/x" — used when creating a local from a remote.
  return name.replace(/^[^/]+\//, "");
}

export function BranchPickerDialog() {
  const dialog = useUiStore((s) => s.dialog);
  const closeDialog = useUiStore((s) => s.closeDialog);
  const openDialog = useUiStore((s) => s.openDialog);
  const refreshOne = useReposStore((s) => s.refreshOne);
  const open = dialog?.kind === "branchPicker";
  const repoId = dialog?.kind === "branchPicker" ? dialog.repoId : null;
  const repoName = dialog?.kind === "branchPicker" ? dialog.repoName : "";
  const currentBranch =
    dialog?.kind === "branchPicker" ? dialog.currentBranch : "";
  const defaultBranch =
    dialog?.kind === "branchPicker" ? dialog.defaultBranch : "";

  const [data, setData] = useState<BranchList | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<Mode>("pick");
  const [newName, setNewName] = useState("");
  const [startPoint, setStartPoint] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (repoId === null) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api.gitListBranches(repoId);
      setData(list);
    } catch (e) {
      setError(String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setMode("pick");
    setNewName("");
    setStartPoint(null);
    setError(null);
    void load();
  }, [open, load]);

  const q = search.trim().toLowerCase();
  const filteredLocal = useMemo(
    () =>
      (data?.local ?? []).filter(
        (b) => !q || b.name.toLowerCase().includes(q),
      ),
    [data, q],
  );
  const filteredRemote = useMemo(
    () =>
      (data?.remote ?? []).filter(
        (b) => !q || b.name.toLowerCase().includes(q),
      ),
    [data, q],
  );

  // A remote branch with no matching local is a prime "check out as local
  // tracking branch" candidate. We stage it into create mode with the
  // start-point set and the name pre-filled.
  function startFromRemote(branch: BranchInfo) {
    const local = stripOrigin(branch.name);
    setMode("create");
    setNewName(local);
    setStartPoint(branch.name);
  }

  async function checkoutLocal(name: string) {
    if (repoId === null) return;
    setWorking(name);
    setError(null);
    try {
      await api.gitCheckout(repoId, name);
      await refreshOne(repoId);
      closeDialog();
    } catch (e) {
      const msg = String(e);
      setError(msg);
      // Dirty-tree failures are common enough to also show the global
      // error dialog so the user gets the Stash/Commit hint discoverable.
      if (/would be overwritten/i.test(msg)) {
        openDialog({
          kind: "gitError",
          title: "Can't switch — local changes would be overwritten",
          error: msg,
          repoId,
        });
      }
    } finally {
      setWorking(null);
    }
  }

  async function createNew() {
    if (repoId === null) return;
    const name = newName.trim();
    if (!name) {
      setError("Branch name is required.");
      return;
    }
    setWorking("__create__");
    setError(null);
    try {
      await api.gitCreateBranch(repoId, name, startPoint);
      await refreshOne(repoId);
      closeDialog();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(null);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={closeDialog}
      title={`Switch branch — ${repoName}`}
      wide
      footer={
        mode === "create" ? (
          <>
            <Button onClick={() => setMode("pick")}>Back</Button>
            <Button
              variant="primary"
              onClick={createNew}
              disabled={working !== null}
              icon={
                working === "__create__" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plus size={14} />
                )
              }
            >
              Create & switch
            </Button>
          </>
        ) : (
          <Button onClick={closeDialog}>Close</Button>
        )
      }
    >
      {mode === "create" ? (
        <CreateBranchForm
          currentBranch={currentBranch}
          newName={newName}
          setNewName={setNewName}
          startPoint={startPoint}
          error={error}
        />
      ) : (
        <PickBranchList
          data={data}
          loading={loading}
          working={working}
          error={error}
          search={search}
          setSearch={setSearch}
          filteredLocal={filteredLocal}
          filteredRemote={filteredRemote}
          currentBranch={currentBranch}
          defaultBranch={defaultBranch}
          onReload={load}
          onCheckout={checkoutLocal}
          onFromRemote={startFromRemote}
          onStartCreate={() => {
            setMode("create");
            setNewName("");
            setStartPoint(null);
          }}
        />
      )}
    </Dialog>
  );
}

interface CreateBranchFormProps {
  currentBranch: string;
  newName: string;
  setNewName: (v: string) => void;
  startPoint: string | null;
  error: string | null;
}

function CreateBranchForm({
  currentBranch,
  newName,
  setNewName,
  startPoint,
  error,
}: CreateBranchFormProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-zinc-400">
        Create a new branch from{" "}
        <span className="font-mono text-zinc-200">
          {startPoint ?? currentBranch ?? "HEAD"}
        </span>{" "}
        and switch to it.
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">
          New branch name
        </span>
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.currentTarget.value)}
          placeholder="feat/my-feature"
          spellCheck={false}
          className="h-9 rounded-md border border-border bg-surface-2 px-2 font-mono text-sm text-zinc-100 focus:border-blue-400 focus:outline-none"
        />
      </label>
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}

interface PickBranchListProps {
  data: BranchList | null;
  loading: boolean;
  working: string | null;
  error: string | null;
  search: string;
  setSearch: (v: string) => void;
  filteredLocal: BranchInfo[];
  filteredRemote: BranchInfo[];
  currentBranch: string;
  defaultBranch: string;
  onReload: () => void;
  onCheckout: (name: string) => void;
  onFromRemote: (b: BranchInfo) => void;
  onStartCreate: () => void;
}

function PickBranchList({
  data,
  loading,
  working,
  error,
  search,
  setSearch,
  filteredLocal,
  filteredRemote,
  currentBranch,
  defaultBranch,
  onReload,
  onCheckout,
  onFromRemote,
  onStartCreate,
}: PickBranchListProps) {
  // Show a pinned "Switch to default" shortcut when the user isn't on the
  // default branch AND it exists locally (the common case). If it only
  // exists as a remote, we fall through to the normal remote-tracking
  // flow; that path already handles the create step.
  const defaultExistsLocal = !!(
    defaultBranch && data?.local?.some((b) => b.name === defaultBranch)
  );
  const showSwitchShortcut =
    !!defaultBranch && currentBranch !== defaultBranch && defaultExistsLocal;
  return (
    <div className="flex flex-col gap-3" style={{ maxHeight: "70vh" }}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="Filter branches…"
            spellCheck={false}
            className="h-8 w-full rounded-md border border-border bg-surface-2 pl-7 pr-7 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-blue-400 focus:outline-none"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => setSearch("")}
              className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-zinc-500 hover:bg-surface-3 hover:text-zinc-200"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <IconButton
          title="Reload branches"
          onClick={onReload}
          disabled={loading}
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCcw size={14} />
          )}
        </IconButton>
        <Button
          icon={<Plus size={14} />}
          onClick={onStartCreate}
          title="Create a new branch from HEAD"
        >
          New branch
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-300">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1 whitespace-pre-wrap">{error}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto rounded-md border border-border bg-surface-0">
        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-zinc-400">
            <Loader2 size={14} className="animate-spin" /> Loading branches…
          </div>
        ) : (
          <>
            {showSwitchShortcut && (
              <button
                type="button"
                onClick={() => onCheckout(defaultBranch)}
                disabled={working !== null}
                className="flex w-full items-center gap-2 border-b border-border bg-blue-500/10 px-3 py-2 text-left text-sm font-medium text-blue-200 hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                title={`Switch to ${defaultBranch} — the default branch for this repo`}
              >
                {working === defaultBranch ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <CornerUpLeft size={14} />
                )}
                <span>
                  Switch to default branch —{" "}
                  <span className="font-mono">{defaultBranch}</span>
                </span>
              </button>
            )}
            <SectionHeader
              icon={<GitBranch size={12} />}
              label="Local"
              count={filteredLocal.length}
            />
            {filteredLocal.length === 0 && (
              <div className="px-3 py-2 text-xs text-zinc-500">
                No local branches match “{search}”.
              </div>
            )}
            {filteredLocal.map((b) => (
              <BranchRow
                key={`local:${b.name}`}
                branch={b}
                working={working === b.name}
                isCurrent={b.name === currentBranch}
                onClick={() => onCheckout(b.name)}
              />
            ))}

            <SectionHeader
              icon={<Globe size={12} />}
              label="Remote (click to create local tracking branch)"
              count={filteredRemote.length}
            />
            {filteredRemote.length === 0 && (
              <div className="px-3 py-2 text-xs text-zinc-500">
                No remote branches match “{search}”.
              </div>
            )}
            {filteredRemote.map((b) => (
              <BranchRow
                key={`remote:${b.name}`}
                branch={b}
                working={false}
                isCurrent={false}
                onClick={() => onFromRemote(b)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function SectionHeader({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-surface-0 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 backdrop-blur">
      {icon} {label}
      <span className="font-normal text-zinc-500">({count})</span>
    </div>
  );
}

function BranchRow({
  branch,
  working,
  isCurrent,
  onClick,
}: {
  branch: BranchInfo;
  working: boolean;
  isCurrent: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isCurrent || working}
      className={`flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left hover:bg-surface-1 disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span className="flex w-4 justify-center">
        {isCurrent ? (
          <Circle size={8} className="fill-blue-400 text-blue-400" />
        ) : working ? (
          <Loader2 size={10} className="animate-spin text-blue-300" />
        ) : null}
      </span>
      <span className="flex-1 truncate font-mono text-xs text-zinc-100">
        {branch.name}
      </span>
      {branch.upstream && (
        <Pill tone="neutral" title={`Upstream: ${branch.upstream}`}>
          ↑ {branch.upstream}
        </Pill>
      )}
      <span className="font-mono text-[11px] text-zinc-500">
        {branch.shortSha}
      </span>
      <span
        className="w-20 text-right text-[11px] text-zinc-500"
        title={branch.lastCommitAt ?? ""}
      >
        {branch.lastCommitAt ? timeAgo(branch.lastCommitAt) : ""}
      </span>
    </button>
  );
}
