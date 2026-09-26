// Undo/redo stack for the deck editor. Snapshots are serialized DeckDoc JSON
// strings (cheap to compare, immune to later mutation). All functions are pure:
// they return a new History rather than mutating the one passed in.

import type { DeckDoc } from "./model";

export interface History {
  /** Older snapshots, oldest first. */
  past: string[];
  /** Undone snapshots, most recently undone last. */
  future: string[];
  /** Timestamp (ms) of the last recorded snapshot, for coalescing. */
  t: number;
}

/** Edits closer together than this (ms) collapse into one undo step. */
export const HISTORY_COALESCE_MS = 400;
/** Maximum number of undo steps kept. */
export const HISTORY_LIMIT = 50;

export function emptyHistory(): History {
  return { past: [], future: [], t: 0 };
}

/** recordHistory snapshots `current` before a mutation. Mutations within
 *  HISTORY_COALESCE_MS of the previous snapshot are coalesced (no new step, and
 *  the redo stack is left alone). A new step clears the redo stack. */
export function recordHistory(
  h: History,
  current: DeckDoc | null,
  now: number,
): History {
  if (now - h.t <= HISTORY_COALESCE_MS) return h;
  const past = current ? [...h.past, JSON.stringify(current)] : [...h.past];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, future: [], t: now };
}

/** undoHistory steps back. Returns null when there is nothing to undo. */
export function undoHistory(
  h: History,
  current: DeckDoc | null,
): { history: History; doc: DeckDoc } | null {
  if (!h.past.length || !current) return null;
  const past = h.past.slice(0, -1);
  const prev = h.past[h.past.length - 1];
  return {
    history: { ...h, past, future: [...h.future, JSON.stringify(current)] },
    doc: JSON.parse(prev) as DeckDoc,
  };
}

/** redoHistory re-applies the most recently undone step. Returns null when
 *  there is nothing to redo. */
export function redoHistory(
  h: History,
  current: DeckDoc | null,
): { history: History; doc: DeckDoc } | null {
  if (!h.future.length || !current) return null;
  const future = h.future.slice(0, -1);
  const next = h.future[h.future.length - 1];
  return {
    history: { ...h, future, past: [...h.past, JSON.stringify(current)] },
    doc: JSON.parse(next) as DeckDoc,
  };
}
