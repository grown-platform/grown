// Per-user keyboard shortcut scheme for Docs and Sheets.
//
//   "office" (the default): Microsoft Word / Excel conventions.
//   "google":               Google Docs / Google Sheets conventions.
//
// Each app has its own scheme. The choice lives in the server-side user
// preferences (`/api/v1/me/preferences`, the free-form `extra` JSON bag, keys
// `docs_shortcut_scheme` and `sheets_shortcut_scheme`) so it follows the user
// across devices, with a localStorage copy for a fast start. Unknown or
// missing values fall back to "office".
import { useEffect, useSyncExternalStore } from "react";
import { getPreferences, updatePreferences } from "../pages/settings/api";

export type ShortcutScheme = "office" | "google";
export type ShortcutApp = "docs" | "sheets";

export const SHORTCUT_SCHEMES: readonly ShortcutScheme[] = ["office", "google"];
export const DEFAULT_SHORTCUT_SCHEME: ShortcutScheme = "office";

/** Keys in the preferences `extra` bag. */
export const SCHEME_PREF_KEYS: Record<ShortcutApp, string> = {
  docs: "docs_shortcut_scheme",
  sheets: "sheets_shortcut_scheme",
};

export const SCHEME_LABELS: Record<ShortcutApp, Record<ShortcutScheme, string>> = {
  docs: { office: "Microsoft Word", google: "Google Docs" },
  sheets: { office: "Microsoft Excel", google: "Google Sheets" },
};

/** resolveScheme maps any stored value to a scheme; anything unknown is "office". */
export function resolveScheme(v: unknown): ShortcutScheme {
  return v === "google" || v === "office" ? v : DEFAULT_SHORTCUT_SCHEME;
}

/** parseExtra reads the preferences `extra` JSON bag (bad JSON -> {}). */
export function parseExtra(extra: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(extra || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** schemesFromExtra reads both apps' schemes from the preferences `extra` bag. */
export function schemesFromExtra(extra: string | null | undefined): Record<ShortcutApp, ShortcutScheme> {
  const x = parseExtra(extra);
  return {
    docs: resolveScheme(x[SCHEME_PREF_KEYS.docs]),
    sheets: resolveScheme(x[SCHEME_PREF_KEYS.sheets]),
  };
}

/** withScheme returns `extra` with one app's scheme set, other keys kept. */
export function withScheme(extra: string | null | undefined, app: ShortcutApp, scheme: ShortcutScheme): string {
  const x = parseExtra(extra);
  x[SCHEME_PREF_KEYS[app]] = resolveScheme(scheme);
  return JSON.stringify(x);
}

// --- the live store ------------------------------------------------------------------

const LOCAL_KEY = "grown.shortcutSchemes";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function loadLocal(): Record<ShortcutApp, ShortcutScheme> {
  try {
    const raw = storage()?.getItem(LOCAL_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<Record<ShortcutApp, unknown>>) : {};
    return { docs: resolveScheme(v.docs), sheets: resolveScheme(v.sheets) };
  } catch {
    return { docs: DEFAULT_SHORTCUT_SCHEME, sheets: DEFAULT_SHORTCUT_SCHEME };
  }
}

let current = loadLocal();
const listeners = new Set<() => void>();

function publish(next: Record<ShortcutApp, ShortcutScheme>) {
  if (next.docs === current.docs && next.sheets === current.sheets) return;
  current = next;
  try {
    storage()?.setItem(LOCAL_KEY, JSON.stringify(current));
  } catch {
    /* private window: this session only */
  }
  for (const l of listeners) l();
}

/** getShortcutScheme is the active scheme for an app (sync; for key handlers). */
export function getShortcutScheme(app: ShortcutApp): ShortcutScheme {
  return current[app];
}

export function subscribeShortcutScheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** applyServerExtra adopts the schemes stored in a preferences `extra` bag. */
export function applyServerExtra(extra: string | null | undefined): void {
  publish(schemesFromExtra(extra));
}

/** setShortcutScheme switches an app's scheme now and saves it to the server
 *  (read-modify-write of `extra`, so other keys such as `spell` survive).
 *  Resolves to the saved preferences, or null when saving failed (the local
 *  choice still applies). */
export async function setShortcutScheme(app: ShortcutApp, scheme: ShortcutScheme): Promise<string | null> {
  publish({ ...current, [app]: resolveScheme(scheme) });
  try {
    const prefs = await getPreferences();
    const extra = withScheme(prefs.extra, app, scheme);
    const saved = await updatePreferences({ extra, update_mask: ["extra"] });
    return saved.extra;
  } catch {
    return null;
  }
}

let synced: Promise<void> | null = null;

/** syncShortcutSchemes loads the server copy once per page load (call again
 *  with force to refresh). */
export function syncShortcutSchemes(force = false): Promise<void> {
  if (!synced || force) {
    synced = getPreferences()
      .then((p) => applyServerExtra(p.extra))
      .catch(() => {
        /* offline / signed out: keep the local copy */
      });
  }
  return synced;
}

/** Test hook: forget the in-memory state. */
export function resetShortcutSchemesForTest(): void {
  synced = null;
  current = { docs: DEFAULT_SHORTCUT_SCHEME, sheets: DEFAULT_SHORTCUT_SCHEME };
  for (const l of listeners) l();
}

/** useShortcutScheme is the live scheme for an app; it syncs from the server
 *  once. */
export function useShortcutScheme(app: ShortcutApp): ShortcutScheme {
  useEffect(() => {
    void syncShortcutSchemes();
  }, []);
  return useSyncExternalStore(
    subscribeShortcutScheme,
    () => current[app],
    () => DEFAULT_SHORTCUT_SCHEME,
  );
}
