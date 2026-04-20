// Ctrl/Cmd+K command palette — fleet actions + focused-row actions.
// Fuzzy-ish match: lowercase substring scan over label + keywords.
// Keyboard-first: ↑/↓ navigate, Enter execute, Esc close.

import {
  Activity,
  AlertOctagon,
  ArrowDownToLine,
  CornerUpLeft,
  Download,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  History,
  Layers,
  Package,
  Pencil,
  RefreshCcw,
  Search,
  Settings as SettingsIcon,
  Settings2,
  Sparkles,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  SHORTCUT_BULK_FETCH,
  SHORTCUT_BULK_PULL,
} from "../hooks/useGlobalKeymap";
import * as api from "../lib/tauri";
import { useFocusStore } from "../stores/focusStore";
import { useReposStore } from "../stores/reposStore";
import { useSelectionStore } from "../stores/selectionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";

interface Command {
  id: string;
  label: string;
  subtitle?: string;
  icon: ReactNode;
  keywords: string[];
  run: () => void;
  section: "focused" | "fleet" | "app";
  disabled?: boolean;
  danger?: boolean;
}

const SECTION_LABEL: Record<Command["section"], string> = {
  focused: "Focused repo",
  fleet: "Fleet",
  app: "App",
};

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const closePalette = useUiStore((s) => s.closePalette);
  const openDialog = useUiStore((s) => s.openDialog);
  const focusedRepoId = useFocusStore((s) => s.focusedRepoId);
  const statuses = useReposStore((s) => s.statuses);
  const refreshAll = useReposStore((s) => s.refreshAll);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const cliActions = useSettingsStore((s) => s.settings.cliActions);

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const focused = useMemo(
    () =>
      focusedRepoId != null
        ? (statuses.find((s) => s.id === focusedRepoId) ?? null)
        : null,
    [focusedRepoId, statuses],
  );
  const selectionSize = selectedIds.size;

  // Reset on open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // Defer so the input is mounted before focus
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [];

    // Focused-row commands
    if (focused) {
      const name = focused.name;
      const dirty = focused.dirty !== "clean";
      const onDefault = focused.branch === focused.defaultBranch;
      out.push({
        id: "focused.fetch",
        label: `Fetch ${name}`,
        icon: <Download size={14} />,
        keywords: ["fetch", "git fetch", name.toLowerCase()],
        section: "focused",
        run: async () => {
          try {
            await api.gitFetch(focused.id);
            await useReposStore.getState().refreshOne(focused.id);
          } catch (e) {
            openDialog({
              kind: "gitError",
              title: "Fetch failed",
              error: String(e),
              repoId: focused.id,
            });
          }
        },
      });
      out.push({
        id: "focused.pull",
        label: `Pull ${name}`,
        subtitle: "fast-forward only",
        icon: <ArrowDownToLine size={14} />,
        keywords: ["pull", "ff", name.toLowerCase()],
        section: "focused",
        run: async () => {
          try {
            await api.gitPullFf(focused.id);
            await useReposStore.getState().refreshOne(focused.id);
          } catch (e) {
            openDialog({
              kind: "gitError",
              title: "Pull failed",
              error: String(e),
              repoId: focused.id,
            });
          }
        },
      });
      out.push({
        id: "focused.commit",
        label: `Commit & push ${name}…`,
        icon: <GitCommitHorizontal size={14} />,
        keywords: ["commit", "push", name.toLowerCase()],
        section: "focused",
        disabled: !dirty,
        subtitle: dirty ? undefined : "working tree is clean",
        run: () =>
          openDialog({
            kind: "commitPush",
            id: focused.id,
            name: focused.name,
            branch: focused.branch,
            defaultBranch: focused.defaultBranch,
            hasUpstream: focused.hasUpstream,
          }),
      });
      if (!onDefault && focused.defaultBranch) {
        out.push({
          id: "focused.switchDefault",
          label: `Switch ${name} to ${focused.defaultBranch}`,
          icon: <CornerUpLeft size={14} />,
          keywords: ["switch", "checkout", "default", focused.defaultBranch],
          section: "focused",
          run: async () => {
            try {
              await api.gitCheckout(focused.id, focused.defaultBranch);
              await useReposStore.getState().refreshOne(focused.id);
            } catch (e) {
              openDialog({
                kind: "gitError",
                title: `Can't switch to ${focused.defaultBranch}`,
                error: String(e),
                repoId: focused.id,
              });
            }
          },
        });
      }
      out.push({
        id: "focused.branches",
        label: `Branches for ${name}…`,
        icon: <GitBranch size={14} />,
        keywords: ["branch", "branches", "picker"],
        section: "focused",
        disabled: !focused.branch,
        run: () =>
          openDialog({
            kind: "branchPicker",
            repoId: focused.id,
            repoName: focused.name,
            currentBranch: focused.branch,
            defaultBranch: focused.defaultBranch,
          }),
      });
      out.push({
        id: "focused.folder",
        label: `Open folder for ${name}`,
        icon: <FolderOpen size={14} />,
        keywords: ["open", "folder", "file manager"],
        section: "focused",
        run: () =>
          void api.openFolder(focused.id).catch((e) =>
            openDialog({
              kind: "info",
              title: "Open folder failed",
              body: String(e),
            }),
          ),
      });
      out.push({
        id: "focused.terminal",
        label: `Open terminal in ${name}`,
        icon: <TerminalSquare size={14} />,
        keywords: ["terminal", "shell", "bash"],
        section: "focused",
        run: () =>
          void api.openTerminal(focused.id).catch((e) =>
            openDialog({
              kind: "info",
              title: "Open terminal failed",
              body: String(e),
            }),
          ),
      });
      if (focused.remoteUrl) {
        out.push({
          id: "focused.remote",
          label: `Open remote for ${name}`,
          subtitle: focused.remoteUrl,
          icon: <Globe size={14} />,
          keywords: ["remote", "browser", "github"],
          section: "focused",
          run: () =>
            void api.openRemote(focused.id).catch((e) =>
              openDialog({
                kind: "info",
                title: "Open remote failed",
                body: String(e),
              }),
            ),
        });
      }
      for (const a of cliActions) {
        out.push({
          id: `focused.claude.${a.id}`,
          label: `Run ${a.label} on ${name}`,
          subtitle: a.slashCommand,
          icon: <Sparkles size={14} className="text-blue-300" />,
          keywords: ["claude", "code", a.label.toLowerCase(), a.slashCommand],
          section: "focused",
          run: () =>
            void api.runCliAction(focused.id, a.id).catch((e) =>
              openDialog({
                kind: "info",
                title: `Launching ${a.label} failed`,
                body: String(e),
              }),
            ),
        });
      }
      out.push({
        id: "focused.refresh",
        label: `Refresh ${name} status`,
        icon: <RefreshCcw size={14} />,
        keywords: ["refresh", "reload"],
        section: "focused",
        run: () => void useReposStore.getState().refreshOne(focused.id),
      });
      out.push({
        id: "focused.rename",
        label: `Rename ${name}…`,
        icon: <Pencil size={14} />,
        keywords: ["rename"],
        section: "focused",
        run: () => {
          // Best-effort: focus the name button which toggles edit mode
          // when clicked. Users can also edit via the kebab. Skipping
          // direct mutation here because the name-edit state is
          // component-local; not worth hoisting for this one case.
          openDialog({
            kind: "info",
            title: "Rename from the row",
            body:
              `Click the repo name "${name}" in the row, or use the kebab menu's ` +
              `"Rename" entry to rename it in the dashboard.`,
          });
        },
      });
      out.push({
        id: "focused.forcePull",
        label: `Force pull ${name}…`,
        subtitle: onDefault
          ? "opens preview dialog"
          : `only on default branch (${focused.defaultBranch})`,
        icon: <AlertOctagon size={14} className="text-red-400" />,
        keywords: ["force", "reset", "hard", "discard"],
        section: "focused",
        disabled: !onDefault,
        danger: true,
        run: () =>
          openDialog({
            kind: "forcePull",
            id: focused.id,
            name: focused.name,
            defaultBranch: focused.defaultBranch,
          }),
      });
      out.push({
        id: "focused.remove",
        label: `Remove ${name} from dashboard…`,
        subtitle: "your files on disk are NOT deleted",
        icon: <Trash2 size={14} className="text-red-400" />,
        keywords: ["remove", "delete", "unregister"],
        section: "focused",
        danger: true,
        run: () =>
          openDialog({
            kind: "removeRepo",
            id: focused.id,
            name: focused.name,
            path: focused.path,
          }),
      });
    }

    // Fleet commands
    const selLabel =
      selectionSize > 0 ? ` selected (${selectionSize})` : " all";
    out.push({
      id: "fleet.fetch",
      label: `Fetch${selLabel}`,
      icon: <Download size={14} />,
      keywords: ["fetch", "all", "bulk"],
      section: "fleet",
      disabled: statuses.length === 0,
      run: () => window.dispatchEvent(new CustomEvent(SHORTCUT_BULK_FETCH)),
    });
    out.push({
      id: "fleet.pull",
      label: `Pull${selLabel}`,
      icon: <ArrowDownToLine size={14} />,
      keywords: ["pull", "all", "bulk"],
      section: "fleet",
      disabled: statuses.length === 0,
      run: () => window.dispatchEvent(new CustomEvent(SHORTCUT_BULK_PULL)),
    });
    out.push({
      id: "fleet.refresh",
      label: "Refresh all",
      icon: <RefreshCcw size={14} />,
      keywords: ["refresh", "reload"],
      section: "fleet",
      run: () => void refreshAll(),
    });
    out.push({
      id: "fleet.add",
      label: "Add repo…",
      icon: <FolderPlus size={14} />,
      keywords: ["add", "new", "register"],
      section: "fleet",
      run: () => openDialog({ kind: "addRepo" }),
    });
    out.push({
      id: "fleet.import",
      label: "Import from folder…",
      icon: <FolderSearch size={14} />,
      keywords: ["scan", "import", "bulk add"],
      section: "fleet",
      run: () => openDialog({ kind: "scanFolder" }),
    });
    out.push({
      id: "fleet.activity",
      label: "Activity feed",
      icon: <Activity size={14} />,
      keywords: ["activity", "commits", "log"],
      section: "fleet",
      disabled: statuses.length === 0,
      run: () => openDialog({ kind: "activityFeed" }),
    });
    out.push({
      id: "fleet.recent",
      label: "Recent actions",
      icon: <History size={14} />,
      keywords: ["recent", "undo", "history"],
      section: "fleet",
      run: () => openDialog({ kind: "recentActions" }),
    });
    out.push({
      id: "fleet.stash.create",
      label:
        selectionSize > 0
          ? `Stash selected (${selectionSize})…`
          : "Stash all changes…",
      icon: <Package size={14} />,
      keywords: ["stash", "park", "save"],
      section: "fleet",
      disabled: statuses.length === 0,
      run: () =>
        openDialog({
          kind: "createStash",
          seedRepoIds:
            selectionSize > 0 ? Array.from(selectedIds) : undefined,
        }),
    });
    out.push({
      id: "fleet.stash.browse",
      label: "Stash bundles",
      icon: <Layers size={14} />,
      keywords: ["stash", "bundle", "restore"],
      section: "fleet",
      run: () => openDialog({ kind: "stashes" }),
    });
    out.push({
      id: "fleet.workspaces",
      label: "Manage workspaces…",
      icon: <Settings2 size={14} />,
      keywords: ["workspace", "manage"],
      section: "fleet",
      run: () => openDialog({ kind: "manageWorkspaces" }),
    });

    // App
    out.push({
      id: "app.settings",
      label: "Settings…",
      icon: <SettingsIcon size={14} />,
      keywords: ["settings", "preferences", "options"],
      section: "app",
      run: () => openDialog({ kind: "settings" }),
    });

    return out;
  }, [
    focused,
    statuses,
    selectedIds,
    selectionSize,
    cliActions,
    openDialog,
    refreshAll,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => {
      const hay = (c.label + " " + (c.subtitle ?? "") + " " +
        c.keywords.join(" ")).toLowerCase();
      return hay.includes(q);
    });
  }, [commands, query]);

  useEffect(() => {
    if (cursor >= filtered.length) setCursor(Math.max(0, filtered.length - 1));
  }, [filtered.length, cursor]);

  if (!open) return null;

  function exec(cmd: Command) {
    if (cmd.disabled) return;
    closePalette();
    try {
      cmd.run();
    } catch (e) {
      console.error("[palette] command failed", cmd.id, e);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[cursor];
      if (cmd) exec(cmd);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    }
  }

  // Group filtered commands by section, preserving array order.
  const sections: { id: Command["section"]; items: Command[] }[] = [];
  for (const cmd of filtered) {
    const last = sections[sections.length - 1];
    if (last && last.id === cmd.section) {
      last.items.push(cmd);
    } else {
      sections.push({ id: cmd.section, items: [cmd] });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[15vh]"
      onClick={closePalette}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[640px] overflow-hidden rounded-lg border border-border-strong bg-surface-1 shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search size={16} className="shrink-0 text-zinc-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Run a command — fetch, pull, open, stash, settings…"
            spellCheck={false}
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            aria-label="Command palette search"
          />
          <span className="shrink-0 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
            Esc
          </span>
        </div>
        <div
          role="listbox"
          className="max-h-[60vh] overflow-y-auto py-1"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-zinc-500">
              No commands match "{query}".
            </div>
          ) : (
            sections.map((sec, secIdx) => {
              const startIdx = filtered.indexOf(sec.items[0]);
              return (
                <div key={`${sec.id}-${secIdx}`}>
                  <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    {SECTION_LABEL[sec.id]}
                  </div>
                  {sec.items.map((cmd, i) => {
                    const idx = startIdx + i;
                    const active = idx === cursor;
                    return (
                      <button
                        key={cmd.id}
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setCursor(idx)}
                        onClick={() => exec(cmd)}
                        disabled={cmd.disabled}
                        className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          active
                            ? cmd.danger
                              ? "bg-red-500/10 text-red-200"
                              : "bg-surface-3 text-zinc-100"
                            : cmd.danger
                              ? "text-red-200/90 hover:bg-red-500/10"
                              : "text-zinc-100 hover:bg-surface-3"
                        }`}
                      >
                        <span className="mt-0.5 shrink-0">{cmd.icon}</span>
                        <span className="flex min-w-0 flex-col items-start">
                          <span className="truncate font-medium">
                            {cmd.label}
                          </span>
                          {cmd.subtitle && (
                            <span className="truncate font-mono text-[11px] text-zinc-500">
                              {cmd.subtitle}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-0 px-3 py-1 text-[10px] text-zinc-500">
          <span>↑↓ navigate · Enter run · Esc close</span>
          <span>
            {filtered.length} of {commands.length}
          </span>
        </div>
      </div>
    </div>
  );
}
