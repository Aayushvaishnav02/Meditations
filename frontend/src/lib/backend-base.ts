import { invoke } from "@tauri-apps/api/core"

declare global {
  interface Window {
    /** Set once at boot under Tauri; see resolveBackendBase(). */
    __BACKEND_BASE__?: string
  }
}

const DEFAULT_BASE = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000"

/** Called once before React mounts: under Tauri, ask the shell which port
 * the sidecar backend got (dev returns null — the default API is used). */
export async function resolveBackendBase(): Promise<void> {
  if (typeof window === "undefined" || window.__BACKEND_BASE__) return
  if (!("__TAURI_INTERNALS__" in window)) return
  try {
    const port = await invoke<number | null>("backend_port")
    if (port) window.__BACKEND_BASE__ = `http://127.0.0.1:${port}`
  } catch {
    // shell without a sidecar — keep the default
  }
}

/** Sync base URL for fetch calls; must run after resolveBackendBase(). */
export function backendBase(): string {
  if (typeof window === "undefined") return DEFAULT_BASE
  return window.__BACKEND_BASE__ ?? DEFAULT_BASE
}
