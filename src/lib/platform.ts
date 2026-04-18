import { platform } from "@tauri-apps/plugin-os";

export type HostOS = "windows" | "macos" | "linux" | "other";

let cached: HostOS | null = null;

export async function getPlatform(): Promise<HostOS> {
  if (cached) return cached;
  try {
    const raw = await platform();
    if (raw === "windows") cached = "windows";
    else if (raw === "macos") cached = "macos";
    else if (raw === "linux") cached = "linux";
    else cached = "other";
  } catch {
    cached = "other";
  }
  return cached;
}
