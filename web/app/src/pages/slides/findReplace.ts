// Find and replace across a deck: text boxes (inside groups too), table
// cells and speaker notes. Replacing inside a text box keeps its runs: the
// new text takes the formatting of the first matched character.

import type { DeckDoc, Slide, SlideElement } from "./model";
import { replaceRange } from "./textOps";
import { isWordChar } from "../../lib/textCase";

export interface FindOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  /** Search speaker notes too (default true). */
  notes?: boolean;
}

export interface Match {
  slideIdx: number;
  slideId: string;
  where: "text" | "cell" | "notes";
  /** Top-level element id (the group, for a match inside one). */
  topId?: string;
  /** The element holding the text (a group member, or topId itself). */
  elId?: string;
  cell?: [number, number];
  start: number;
  end: number;
}

/** Offsets [start, end) of every match of `query` in `text`. */
export function matchesIn(text: string, query: string, opts: FindOptions = {}): [number, number][] {
  if (!query) return [];
  const hay = opts.matchCase ? text : text.toLowerCase();
  const needle = opts.matchCase ? query : query.toLowerCase();
  const out: [number, number][] = [];
  let i = hay.indexOf(needle);
  while (i >= 0) {
    const end = i + needle.length;
    const ok =
      !opts.wholeWord ||
      ((i === 0 || !isWordChar(text[i - 1])) && (end >= text.length || !isWordChar(text[end])));
    if (ok) out.push([i, end]);
    i = hay.indexOf(needle, ok ? end : i + 1);
  }
  return out;
}

function visit(els: readonly SlideElement[], top: string | undefined, fn: (el: SlideElement, topId: string) => void) {
  for (const el of els) {
    const t = top ?? el.id;
    if (el.type === "group") visit(el.children || [], t, fn);
    else fn(el, t);
  }
}

/** findMatches lists every match in slide order (elements in z-order,
 *  then table cells row by row, then notes). */
export function findMatches(doc: DeckDoc, query: string, opts: FindOptions = {}): Match[] {
  const out: Match[] = [];
  doc.slides.forEach((s, slideIdx) => {
    visit(s.elements, undefined, (el, topId) => {
      if (el.type === "text")
        for (const [start, end] of matchesIn(el.text || "", query, opts))
          out.push({ slideIdx, slideId: s.id, where: "text", topId, elId: el.id, start, end });
      if (el.type === "table" && el.table)
        el.table.cells.forEach((row, r) =>
          row.forEach((c, ci) => {
            for (const [start, end] of matchesIn(c, query, opts))
              out.push({ slideIdx, slideId: s.id, where: "cell", topId, elId: el.id, cell: [r, ci], start, end });
          }),
        );
    });
    if (opts.notes !== false)
      for (const [start, end] of matchesIn(s.notes || "", query, opts))
        out.push({ slideIdx, slideId: s.id, where: "notes", start, end });
  });
  return out;
}

function mapDeep(els: readonly SlideElement[], id: string, fn: (el: SlideElement) => SlideElement): SlideElement[] {
  return els.map((e) =>
    e.id === id ? fn(e) : e.type === "group" ? { ...e, children: mapDeep(e.children || [], id, fn) } : e,
  );
}

function spliceStr(s: string, a: number, b: number, r: string) {
  return s.slice(0, a) + r + s.slice(b);
}

function replaceOne(slide: Slide, m: Match, repl: string): Slide {
  if (m.where === "notes") return { ...slide, notes: spliceStr(slide.notes || "", m.start, m.end, repl) };
  if (!m.elId) return slide;
  return {
    ...slide,
    elements: mapDeep(slide.elements, m.elId, (el) => {
      if (m.where === "text") return replaceRange(el, m.start, m.end, repl);
      if (m.where === "cell" && el.table && m.cell) {
        const [r, c] = m.cell;
        const cells = el.table.cells.map((row) => [...row]);
        cells[r][c] = spliceStr(cells[r][c] ?? "", m.start, m.end, repl);
        return { ...el, table: { ...el.table, cells } };
      }
      return el;
    }),
  };
}

/** replaceMatch replaces one match (from findMatches on the same doc). */
export function replaceMatch(doc: DeckDoc, m: Match, repl: string): DeckDoc {
  return { slides: doc.slides.map((s) => (s.id === m.slideId ? replaceOne(s, m, repl) : s)) };
}

/** replaceAll replaces every match; returns the new doc and the count. */
export function replaceAll(
  doc: DeckDoc,
  query: string,
  repl: string,
  opts: FindOptions = {},
): { doc: DeckDoc; count: number } {
  const ms = findMatches(doc, query, opts);
  if (!ms.length) return { doc, count: 0 };
  // Later matches first, so earlier offsets in the same text stay valid.
  let out = doc;
  for (let i = ms.length - 1; i >= 0; i--) out = replaceMatch(out, ms[i], repl);
  return { doc: out, count: ms.length };
}
