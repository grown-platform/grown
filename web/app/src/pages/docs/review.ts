// Review settings (M5): who tracks changes, and how changes are shown.
//
// * "On/Off for everyone" is a document setting in the shared `review` Yjs
//   map (key `trackAll`), so every collaborator follows it live.
// * "On/Off for me" is this user's choice for this document, remembered in
//   the browser. Both carry a time and the newer one is in force, so
//   switching "for everyone" overrides earlier personal choices and a later
//   personal choice overrides it again (OnlyOffice's four options).
// * With neither, the user's default ("Track my changes by default") applies.
// * The display mode (Markup, Simple markup, Final, Original) is a per-user
//   view preference.
import type * as Y from "yjs";

export type DisplayMode = "markup" | "simple" | "final" | "original";

export const DISPLAY_MODES: { id: DisplayMode; label: string; hint: string }[] = [
  { id: "markup", label: "Markup", hint: "All changes, marked up" },
  { id: "simple", label: "Simple markup", hint: "Final text; a bar marks changed paragraphs" },
  { id: "final", label: "Final", hint: "As if every change were accepted" },
  { id: "original", label: "Original", hint: "As if every change were rejected" },
];

export const REVIEW_MAP = "review";

/** A track-changes choice and when it was made (ms since epoch); the
 *  newer of "mine" and "everyone" wins. */
export interface TrackChoice {
  on: boolean;
  at: number;
}

function asChoice(v: unknown): TrackChoice | null {
  if (v && typeof v === "object" && typeof (v as TrackChoice).on === "boolean")
    return { on: (v as TrackChoice).on, at: Number((v as TrackChoice).at) || 0 };
  return null;
}

/** getTrackAll reads the document-wide setting (null = not set). */
export function getTrackAll(ydoc: Y.Doc): TrackChoice | null {
  return asChoice(ydoc.getMap(REVIEW_MAP).get("trackAll"));
}

/** setTrackAll sets (or clears, with null) the document-wide setting. */
export function setTrackAll(ydoc: Y.Doc, on: boolean | null, at = Date.now()): void {
  const m = ydoc.getMap(REVIEW_MAP);
  if (on === null) m.delete("trackAll");
  else m.set("trackAll", { on, at });
}

/** onTrackAll calls fn whenever the document-wide setting changes. */
export function onTrackAll(ydoc: Y.Doc, fn: (v: TrackChoice | null) => void): () => void {
  const m = ydoc.getMap(REVIEW_MAP);
  const h = (e: Y.YMapEvent<unknown>) => {
    if (e.keysChanged.has("trackAll")) fn(getTrackAll(ydoc));
  };
  m.observe(h);
  return () => m.unobserve(h);
}

/** effectiveTracking: the newer of my choice for this document and the
 *  document's setting, else my default. */
export function effectiveTracking(mine: TrackChoice | null, everyone: TrackChoice | null, byDefault: boolean): boolean {
  if (mine && everyone) return mine.at > everyone.at ? mine.on : everyone.on;
  return (mine ?? everyone)?.on ?? byDefault;
}

/** governingEveryone is the document setting when it is the one in force. */
export function governingEveryone(mine: TrackChoice | null, everyone: TrackChoice | null): boolean | null {
  if (!everyone) return null;
  return !mine || everyone.at >= mine.at ? everyone.on : null;
}

// --- browser-stored preferences ----------------------------------------------------------

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string | null): void {
  try {
    if (v === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, v);
  } catch {
    /* storage unavailable */
  }
}

const DEFAULT_KEY = (user: string) => `grown.docs.track.default.v1:${user}`;
const MINE_KEY = (user: string, doc: string) => `grown.docs.track.mine.v1:${user}:${doc}`;
const DISPLAY_KEY = (user: string) => `grown.docs.review.display.v1:${user}`;

export function loadTrackDefault(user: string): boolean {
  return read(DEFAULT_KEY(user)) === "1";
}
export function saveTrackDefault(user: string, on: boolean): void {
  write(DEFAULT_KEY(user), on ? "1" : null);
}

export function loadTrackMine(user: string, doc: string): TrackChoice | null {
  try {
    return asChoice(JSON.parse(read(MINE_KEY(user, doc)) ?? "null"));
  } catch {
    return null;
  }
}
export function saveTrackMine(user: string, doc: string, c: TrackChoice | null): void {
  write(MINE_KEY(user, doc), c === null ? null : JSON.stringify(c));
}

export function loadDisplayMode(user: string): DisplayMode {
  const v = read(DISPLAY_KEY(user));
  return DISPLAY_MODES.some((m) => m.id === v) ? (v as DisplayMode) : "markup";
}
export function saveDisplayMode(user: string, mode: DisplayMode): void {
  write(DISPLAY_KEY(user), mode === "markup" ? null : mode);
}

/** formatChangeDate renders a change date for the change list / popover. */
export function formatChangeDate(iso: string, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
  return `${date}, ${time}`;
}
