// Feature flag for the Docs scripting API (M13). Off by default; turn it
// on per browser with `localStorage.setItem("grown.flags", "docs-api")`,
// per visit with `?flags=docs-api`, or for a build with VITE_DOCS_API=1.

export const DOCS_API_FLAG = "docs-api";

export function scriptingEnabled(): boolean {
  try {
    if (import.meta.env?.VITE_DOCS_API === "1") return true;
    const flags = new Set<string>();
    for (const f of (localStorage.getItem("grown.flags") ?? "").split(/[\s,]+/)) if (f) flags.add(f);
    if (typeof location !== "undefined") for (const f of (new URLSearchParams(location.search).get("flags") ?? "").split(",")) if (f) flags.add(f);
    return flags.has(DOCS_API_FLAG);
  } catch {
    return false;
  }
}

const EVENT = "grown-docs-api-console";

/** Open Tools ▸ Macros and plugins (ApiConsole). */
export function openApiConsole() {
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onApiConsole(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
