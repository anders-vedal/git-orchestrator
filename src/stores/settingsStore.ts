import { create } from "zustand";
import * as api from "../lib/tauri";
import {
  DEFAULT_CLI_ACTIONS,
  DEFAULT_SETTINGS,
  type CliAction,
  type Settings,
  type TerminalPref,
  type ThemePref,
} from "../types";

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (partial: Partial<Settings>) => Promise<void>;
}

function parseInt10(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function asTerminal(v: string | undefined): TerminalPref {
  if (v === "wt" || v === "git-bash" || v === "cmd") return v;
  return "auto";
}

function asTheme(v: string | undefined): ThemePref {
  if (v === "light" || v === "system") return v;
  return "dark";
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function asBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return v === "1" || v === "true";
}

function asCliActions(v: string | undefined): CliAction[] {
  if (v === undefined || v.trim() === "") return DEFAULT_CLI_ACTIONS;
  try {
    const parsed = JSON.parse(v);
    if (!Array.isArray(parsed)) return DEFAULT_CLI_ACTIONS;
    // Shape-check each entry — the backend validates on write but the DB
    // may hold legacy entries if the schema ever changed.
    const ok: CliAction[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.label === "string" &&
        typeof item.slashCommand === "string"
      ) {
        ok.push({ id: item.id, label: item.label, slashCommand: item.slashCommand });
      }
    }
    return ok;
  } catch {
    return DEFAULT_CLI_ACTIONS;
  }
}

function hydrate(raw: Record<string, string>): Settings {
  return {
    terminal: asTerminal(raw.terminal),
    refreshIntervalSec: parseInt10(
      raw.refresh_interval_sec,
      DEFAULT_SETTINGS.refreshIntervalSec,
    ),
    defaultReposDir: raw.default_repos_dir ?? null,
    theme: asTheme(raw.theme),
    bulkConcurrency: clamp(
      parseInt10(raw.bulk_concurrency, DEFAULT_SETTINGS.bulkConcurrency),
      1,
      16,
    ),
    autoCheckUpdates: asBool(
      raw.auto_check_updates,
      DEFAULT_SETTINGS.autoCheckUpdates,
    ),
    cliActions: asCliActions(raw.cli_actions),
  };
}

const KEY_MAP: Record<keyof Settings, string> = {
  terminal: "terminal",
  refreshIntervalSec: "refresh_interval_sec",
  defaultReposDir: "default_repos_dir",
  theme: "theme",
  bulkConcurrency: "bulk_concurrency",
  autoCheckUpdates: "auto_check_updates",
  cliActions: "cli_actions",
};

/** Keys whose DB value is a JSON-encoded blob rather than a scalar. */
const JSON_KEYS: ReadonlySet<keyof Settings> = new Set(["cliActions"]);

function serializeForDb(key: keyof Settings, value: Settings[keyof Settings]): string {
  if (JSON_KEYS.has(key)) return JSON.stringify(value ?? []);
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return String(value);
}

function applyTheme(theme: ThemePref) {
  const prefersDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", prefersDark);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  async load() {
    try {
      const keys = Object.values(KEY_MAP);
      const values = await Promise.all(keys.map((k) => api.getSetting(k)));
      const raw: Record<string, string> = {};
      keys.forEach((k, i) => {
        const v = values[i];
        if (v !== null && v !== undefined) raw[k] = v;
      });
      const settings = hydrate(raw);
      set({ settings, loaded: true });
      applyTheme(settings.theme);
    } catch {
      set({ loaded: true });
      applyTheme(DEFAULT_SETTINGS.theme);
    }
  },

  async update(partial) {
    const next = { ...get().settings, ...partial };
    // Optimistic apply, then persist; on any backend rejection (e.g. the
    // cli_actions validator refusing a bad slash command) we roll the
    // store back and rethrow so the caller can surface the error.
    const prev = get().settings;
    set({ settings: next });
    if (partial.theme !== undefined) applyTheme(next.theme);
    try {
      await Promise.all(
        (Object.keys(partial) as (keyof Settings)[]).map((k) => {
          const value = serializeForDb(k, next[k]);
          return api.setSetting(KEY_MAP[k], value);
        }),
      );
    } catch (e) {
      set({ settings: prev });
      if (partial.theme !== undefined) applyTheme(prev.theme);
      throw e;
    }
  },
}));
