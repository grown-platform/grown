// Per-user spell-check preferences: on/off and the personal dictionary.
//
// Kept in localStorage for a fast start and synced to the server-side user
// preferences (`/api/v1/me/preferences`, the free-form `extra` JSON bag,
// key `spell`), so "Add to dictionary" follows the user across devices.

export interface SpellPrefs {
  enabled: boolean;
  /** Personal dictionary, sorted, unique. */
  words: string[];
}

const KEY = "grown.spell.prefs";
const MAX_WORDS = 5000;

export const DEFAULT_SPELL_PREFS: SpellPrefs = { enabled: true, words: [] };

function clean(p: Partial<SpellPrefs> | null | undefined): SpellPrefs {
  const words = Array.isArray(p?.words) ? p!.words.filter((w): w is string => typeof w === "string" && !!w.trim() && w.length < 100) : [];
  return { enabled: p?.enabled !== false, words: [...new Set(words)].sort().slice(0, MAX_WORDS) };
}

export function loadSpellPrefs(store: Pick<Storage, "getItem"> | null = safeStorage()): SpellPrefs {
  try {
    const raw = store?.getItem(KEY);
    return raw ? clean(JSON.parse(raw)) : { ...DEFAULT_SPELL_PREFS };
  } catch {
    return { ...DEFAULT_SPELL_PREFS };
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;

/** saveSpellPrefs stores locally and (debounced) on the server. */
export function saveSpellPrefs(p: SpellPrefs, opts: { server?: boolean } = {}): SpellPrefs {
  const c = clean(p);
  try {
    safeStorage()?.setItem(KEY, JSON.stringify(c));
  } catch {
    /* private window: this session only */
  }
  if (opts.server !== false && typeof fetch !== "undefined") {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void pushServer(c), 600);
  }
  return c;
}

async function readServerExtra(): Promise<Record<string, unknown> | null> {
  const r = await fetch("/api/v1/me/preferences", { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!r.ok) return null;
  const body = (await r.json()) as { extra?: string };
  try {
    const extra = JSON.parse(body.extra || "{}");
    return extra && typeof extra === "object" ? (extra as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function pushServer(p: SpellPrefs) {
  try {
    const extra = await readServerExtra();
    if (!extra) return;
    extra.spell = p;
    await fetch("/api/v1/me/preferences", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ extra: JSON.stringify(extra), update_mask: ["extra"] }),
    });
  } catch {
    /* offline: localStorage keeps it; the next save retries */
  }
}

/** syncSpellPrefs merges the server copy into the local one (the union of
 *  personal words; the server's on/off wins). */
export async function syncSpellPrefs(): Promise<SpellPrefs> {
  const local = loadSpellPrefs();
  if (typeof fetch === "undefined") return local;
  try {
    const extra = await readServerExtra();
    const server = extra?.spell as Partial<SpellPrefs> | undefined;
    if (!server) {
      if (local.words.length || !local.enabled) void pushServer(local);
      return local;
    }
    const merged = clean({ enabled: server.enabled !== false, words: [...local.words, ...(server.words ?? [])] });
    saveSpellPrefs(merged, { server: merged.words.length !== (server.words ?? []).length });
    return merged;
  } catch {
    return local;
  }
}
