// Header/footer navigation (Docs M13): while a header or footer is being
// edited, PageUp / PageDown move to the previous / next one in reading
// order (page 1 header, page 1 footer, page 2 header, …) and Alt+PageUp /
// Alt+PageDown to the same part of the previous / next page; Escape
// returns to the body. Pure, so the order is unit-tested.
import type { HfWhich } from "./sections";

export interface HfSlot {
  /** 0-based page index. */
  page: number;
  which: HfWhich;
}

export type HfNavAction = "prev" | "next" | "prevSame" | "nextSame";

export function hfNavigate(cur: HfSlot, action: HfNavAction, pageCount: number): HfSlot | null {
  if (action === "prevSame" || action === "nextSame") {
    const page = cur.page + (action === "nextSame" ? 1 : -1);
    return page >= 0 && page < pageCount ? { page, which: cur.which } : null;
  }
  const idx = cur.page * 2 + (cur.which === "footer" ? 1 : 0) + (action === "next" ? 1 : -1);
  if (idx < 0 || idx >= pageCount * 2) return null;
  return { page: Math.floor(idx / 2), which: idx % 2 ? "footer" : "header" };
}

/** The navigation action for a key event, if any. */
export function hfNavKey(e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): HfNavAction | "exit" | null {
  if (e.shiftKey) return null;
  if (e.key === "Escape" && !e.altKey && !e.ctrlKey && !e.metaKey) return "exit";
  if (e.key !== "PageUp" && e.key !== "PageDown") return null;
  const up = e.key === "PageUp";
  if (e.altKey) return up ? "prevSame" : "nextSame";
  if (e.ctrlKey || e.metaKey) return null;
  return up ? "prev" : "next";
}
