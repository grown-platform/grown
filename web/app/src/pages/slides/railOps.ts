// The slide rail (thumbnails) as a keyboard-operable multi-select list
// (M13): selection moves and ranges, moving and deleting several slides.
// Pure; indices are 0-based positions in the deck.

import { newSlide, type Slide } from "./model";

/** Rail selection: the selected slides, the range anchor and the focused
 *  (current) slide, which is always selected. */
export interface RailSel {
  sel: number[];
  anchor: number;
  cur: number;
}

export function railAt(i: number): RailSel {
  return { sel: [i], anchor: i, cur: i };
}

const range = (a: number, b: number) => {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
};

/** Slides a Page Up/Down moves over. */
export const RAIL_PAGE = 5;

export type RailTarget = "prev" | "next" | "pageUp" | "pageDown" | "first" | "last";

/** railTarget resolves a movement to an index in a deck of `count`. */
export function railTarget(cur: number, to: RailTarget, count: number): number {
  const last = Math.max(0, count - 1);
  const t = to === "prev" ? cur - 1 : to === "next" ? cur + 1 : to === "pageUp" ? cur - RAIL_PAGE : to === "pageDown" ? cur + RAIL_PAGE : to === "first" ? 0 : last;
  return Math.max(0, Math.min(last, t));
}

/** railGo moves the focus; with `extend` the selection becomes the range
 *  from the anchor (Shift+arrows, Shift+Home/End). */
export function railGo(s: RailSel, to: number, extend: boolean): RailSel {
  if (!extend) return railAt(to);
  return { sel: range(s.anchor, to), anchor: s.anchor, cur: to };
}

/** railClick: plain click selects one, Shift+click a range from the anchor,
 *  Ctrl/Cmd+click toggles (the focus stays on a selected slide). */
export function railClick(s: RailSel, i: number, mods: { shift?: boolean; toggle?: boolean }): RailSel {
  if (mods.shift) return railGo(s, i, true);
  if (mods.toggle) {
    if (s.sel.includes(i)) {
      const sel = s.sel.filter((x) => x !== i);
      if (!sel.length) return s;
      return { sel, anchor: s.anchor === i ? sel[sel.length - 1] : s.anchor, cur: s.cur === i ? sel[sel.length - 1] : s.cur };
    }
    return { sel: [...s.sel, i].sort((a, b) => a - b), anchor: i, cur: i };
  }
  return railAt(i);
}

export function railSelectAll(count: number, cur: number): RailSel {
  return { sel: range(0, Math.max(0, count - 1)), anchor: 0, cur };
}

/** railClamp drops indices past the end (a collaborator deleted slides). */
export function railClamp(s: RailSel, count: number): RailSel {
  const last = Math.max(0, count - 1);
  const sel = s.sel.filter((i) => i <= last);
  const cur = Math.min(s.cur, last);
  return { sel: sel.length ? sel : [cur], anchor: Math.min(s.anchor, last), cur };
}

export type SlidesMove = 1 | -1 | "start" | "end";

/**
 * moveSlides moves the selected slides (keeping their order): ±1 swaps each
 * with the unselected neighbour (Ctrl+Down/Up), start/end gathers them at
 * the top/bottom (Ctrl+Shift+Up/Down). Returns null when nothing moves.
 */
export function moveSlides(slides: readonly Slide[], s: RailSel, how: SlidesMove): { slides: Slide[]; sel: RailSel } | null {
  const picked = [...new Set(s.sel)].filter((i) => i >= 0 && i < slides.length).sort((a, b) => a - b);
  if (!picked.length) return null;
  const set = new Set(picked);
  const ids = slides.map((x) => x.id);
  let order: number[];
  if (how === "start" || how === "end") {
    const rest = slides.map((_, i) => i).filter((i) => !set.has(i));
    order = how === "start" ? [...picked, ...rest] : [...rest, ...picked];
  } else {
    if (how === 1 ? picked[picked.length - 1] === slides.length - 1 : picked[0] === 0) return null;
    order = slides.map((_, i) => i);
    const seq = how === 1 ? [...picked].reverse() : picked;
    for (const i of seq) {
      const p = order.indexOf(i);
      const q = p + how;
      [order[p], order[q]] = [order[q], order[p]];
    }
  }
  if (order.every((v, i) => v === i)) return null;
  const next = order.map((i) => slides[i]);
  const pos = (old: number) => next.findIndex((x) => x.id === ids[old]);
  return {
    slides: next,
    sel: { sel: picked.map(pos).sort((a, b) => a - b), anchor: pos(s.anchor), cur: pos(s.cur) },
  };
}

/** deleteSlides removes the selected slides; the slide before the first
 *  removed one becomes current. A deck keeps at least one (blank) slide. */
export function deleteSlides(slides: readonly Slide[], s: RailSel, make: () => Slide = () => newSlide()): { slides: Slide[]; sel: RailSel } {
  const set = new Set(s.sel);
  const kept = slides.filter((_, i) => !set.has(i));
  if (!kept.length) return { slides: [make()], sel: railAt(0) };
  const first = Math.min(...s.sel);
  return { slides: kept, sel: railAt(Math.max(0, Math.min(first - 1 < 0 ? 0 : first - 1, kept.length - 1))) };
}
