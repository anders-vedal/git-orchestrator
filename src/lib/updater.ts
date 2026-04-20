/**
 * Thin wrapper around the Tauri updater + process plugins.
 *
 * Keeps every call to `@tauri-apps/plugin-updater` and
 * `@tauri-apps/plugin-process` behind a single typed surface — the same
 * pattern as `lib/tauri.ts` for `#[tauri::command]` handlers. Components
 * and stores must not import the plugin modules directly; go through
 * this file so argument shapes stay in one place and tests can mock a
 * single module.
 */
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateProgress =
  | { kind: "started"; contentLength: number | null }
  | { kind: "downloading"; downloaded: number; contentLength: number | null }
  | { kind: "finished" };

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}

/**
 * Module-level cache of the last `Update` handle returned by
 * {@link checkForUpdate}. We deliberately don't expose the handle
 * across the React tree — the UI layer carries only the serializable
 * metadata, and {@link installPendingUpdate} picks the handle up from
 * here at install time.
 */
let pendingHandle: Update | null = null;

/**
 * Ask the configured endpoint whether a newer signed build exists.
 * Returns null when the app is already up-to-date. Throws on network
 * error or manifest-signature failure — the updater plugin verifies
 * the minisign signature before resolving.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const update = await check();
  if (!update) {
    pendingHandle = null;
    return null;
  }
  pendingHandle = update;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? null,
    date: update.date ?? null,
  };
}

/**
 * Download and install whatever {@link checkForUpdate} last surfaced.
 * `onProgress` fires for every chunk so the UI can render a bar. Does
 * NOT relaunch — call {@link relaunchApp} once the promise resolves.
 * Throws if no update is pending (caller must re-check first).
 */
export async function installPendingUpdate(
  onProgress?: (p: UpdateProgress) => void,
): Promise<void> {
  const handle = pendingHandle;
  if (!handle) {
    throw new Error("no pending update — call checkForUpdate() first");
  }
  let contentLength: number | null = null;
  let downloaded = 0;
  await handle.downloadAndInstall((event) => {
    if (event.event === "Started") {
      contentLength = event.data.contentLength ?? null;
      onProgress?.({ kind: "started", contentLength });
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress?.({ kind: "downloading", downloaded, contentLength });
    } else if (event.event === "Finished") {
      onProgress?.({ kind: "finished" });
    }
  });
  pendingHandle = null;
}

/** Restart the app after an install. Windows installers replace the
 *  binary in place, so a restart is enough — no admin prompt on top of
 *  the one NSIS/MSI already handled. */
export async function relaunchApp(): Promise<void> {
  await relaunch();
}
