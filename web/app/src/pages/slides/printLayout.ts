// Print/PDF page layout (M12): which slides go on which page, and where.
// Pure: every renderer (the print window, the print preview and the PDF
// file) draws the same `PrintPage` list. Units are PostScript points
// (1/72 in); a slide is 960 logical units = 10 in = 720 pt wide.

import type { Slide } from "./model";
import { flattenGroups } from "./groupOps";
import { isHF } from "./layouts";
import { paragraphs } from "./textOps";

export type PrintLayoutKind = "slides" | "notes" | "handouts" | "outline";
export const HANDOUT_COUNTS = [1, 2, 3, 4, 6, 9] as const;
export type HandoutCount = (typeof HANDOUT_COUNTS)[number];
export type Paper = "letter" | "a4";

export interface PrintOptions {
  layout: PrintLayoutKind;
  /** Slides per handout page. */
  perPage: HandoutCount;
  /** Handout order: across then down (horizontal) or down then across. */
  order: "horizontal" | "vertical";
  range: "all" | "current" | "custom";
  /** 1-based list for `range: "custom"`, e.g. "1-3, 5, 8-". */
  custom: string;
  /** Thin border around each slide. */
  frame: boolean;
  includeHidden: boolean;
  grayscale: boolean;
  /** Paper for notes/handouts/outline (full slides print at slide size). */
  paper: Paper;
}

export const DEFAULT_PRINT: PrintOptions = {
  layout: "slides",
  perPage: 6,
  order: "horizontal",
  range: "all",
  custom: "",
  frame: false,
  includeHidden: false,
  grayscale: false,
  paper: "letter",
};

export const PAPER_PT: Record<Paper, { w: number; h: number }> = {
  letter: { w: 612, h: 792 },
  a4: { w: 595.28, h: 841.89 },
};

/** Slide width in points (10 in). */
export const SLIDE_PT_W = 720;
/** Points per logical slide unit. */
export const PT_PER_UNIT = SLIDE_PT_W / 960;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PageItem =
  | { kind: "slide"; index: number; box: Box; frame: boolean }
  | { kind: "notes"; index: number; box: Box }
  /** Ruled lines for audience notes (3-per-page handouts). */
  | { kind: "lines"; box: Box; count: number }
  | { kind: "outline"; entries: OutlineEntry[]; box: Box }
  | { kind: "label"; text: string; box: Box; size: number; align: "left" | "center" | "right" };

export interface PrintPage {
  w: number;
  h: number;
  items: PageItem[];
}

/**
 * parseRange reads a 1-based slide list ("1-3, 5, 8-", "-2", "4") into
 * sorted, de-duplicated 0-based indices below `count`. Returns null when the
 * text is not a list (or selects nothing).
 */
export function parseRange(text: string, count: number): number[] | null {
  const parts = text.split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) return null;
  const set = new Set<number>();
  for (const part of parts) {
    const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part) ?? /^(\d+)$/.exec(part);
    if (!m) return null;
    let a: number;
    let b: number;
    if (m.length === 2) a = b = Number(m[1]);
    else {
      if (!m[1] && !m[2]) return null;
      a = m[1] ? Number(m[1]) : 1;
      b = m[2] ? Number(m[2]) : count;
    }
    if (a < 1 || b < a) return null;
    for (let i = a; i <= Math.min(b, count); i++) set.add(i - 1);
  }
  const out = [...set].sort((x, y) => x - y);
  return out.length ? out : null;
}

/** printedSlides picks the slide indices to print (hidden slides are left
 *  out unless asked for; an explicit current slide is always printed). */
export function printedSlides(slides: readonly Pick<Slide, "hidden">[], opts: PrintOptions, cur = 0): number[] {
  if (opts.range === "current") return slides.length ? [Math.max(0, Math.min(cur, slides.length - 1))] : [];
  const all = slides.map((_, i) => i);
  const picked = opts.range === "custom" ? parseRange(opts.custom, slides.length) ?? [] : all;
  return picked.filter((i) => opts.includeHidden || !slides[i].hidden);
}

/** Columns × rows of a handout page (PowerPoint's grid). */
export function handoutGrid(n: HandoutCount): { cols: number; rows: number } {
  switch (n) {
    case 1:
      return { cols: 1, rows: 1 };
    case 2:
      return { cols: 1, rows: 2 };
    case 3:
      return { cols: 1, rows: 3 };
    case 4:
      return { cols: 2, rows: 2 };
    case 6:
      return { cols: 2, rows: 3 };
    case 9:
      return { cols: 3, rows: 3 };
  }
}

/** fitBox: the largest box of aspect h/w = `aspect` centred in `cell`. */
export function fitBox(cell: Box, aspect: number): Box {
  let w = cell.w;
  let h = w * aspect;
  if (h > cell.h) {
    h = cell.h;
    w = h / aspect;
  }
  return { x: cell.x + (cell.w - w) / 2, y: cell.y + (cell.h - h) / 2, w, h };
}

/** One slide in the outline: title, body lines with levels, notes. */
export interface OutlineEntry {
  index: number;
  title: string;
  body: { text: string; level: number }[];
}

const TITLE_TYPES = new Set(["title", "ctrTitle"]);

/**
 * slideOutline extracts a slide's text structure: the title placeholder
 * (else the first text box) and every other text paragraph (tables cell by
 * cell), with list levels. Footer placeholders are skipped.
 */
export function slideOutline(slide: Slide, index: number): OutlineEntry {
  const els = flattenGroups(slide.elements).filter((e) => !isHF(e));
  const texts = els.filter((e) => e.type === "text" || (e.type === "shape" && (e.text || "").trim()));
  const titleEl = texts.find((e) => e.placeholder && TITLE_TYPES.has(e.placeholder.type)) ?? texts.find((e) => (e.text || "").trim());
  const title = titleEl ? (titleEl.text || "").replace(/[\n\v]+/g, " ").trim() : "";
  const body: OutlineEntry["body"] = [];
  for (const e of els) {
    if (e === titleEl) continue;
    if ((e.type === "text" || e.type === "shape") && (e.text || "").trim()) {
      for (const p of paragraphs(e)) {
        const t = p.runs.map((r) => r.text).join("").replace(/\v/g, " ").trim();
        if (t) body.push({ text: t, level: p.props.level ?? 0 });
      }
    } else if (e.type === "table" && e.table) {
      for (const row of e.table.cells) {
        const t = row.map((c) => (c || "").replace(/[\n\v]+/g, " ").trim()).filter(Boolean).join(" | ");
        if (t) body.push({ text: t, level: 0 });
      }
    } else if (e.alt && e.alt.trim()) {
      body.push({ text: `[${e.type === "image" ? "Picture" : e.type === "chart" ? "Chart" : e.type === "media" ? "Media" : "Object"}: ${e.alt.trim()}]`, level: 0 });
    }
  }
  return { index, title, body };
}

/** Estimated wrapped line count of `text` at `size` pt in `width` pt. */
export function estimateLines(text: string, size: number, width: number): number {
  const perLine = Math.max(8, Math.floor(width / (size * 0.5)));
  return Math.max(1, Math.ceil(text.length / perLine));
}

export const OUTLINE_TITLE_PT = 13;
export const OUTLINE_BODY_PT = 11;
export const OUTLINE_LINE = 1.35;

/** Height in pt of one outline entry at `width`. */
export function outlineEntryHeight(e: OutlineEntry, width: number): number {
  let h = estimateLines(`${e.index + 1}  ${e.title || "(untitled)"}`, OUTLINE_TITLE_PT, width) * OUTLINE_TITLE_PT * OUTLINE_LINE + 4;
  for (const b of e.body) h += estimateLines(b.text, OUTLINE_BODY_PT, width - 18 * (b.level + 1)) * OUTLINE_BODY_PT * OUTLINE_LINE;
  return h + 8;
}

const MARGIN = 36; // 0.5 in
const HEADER = 18;

/**
 * printPages lays out the chosen slides. `aspect` is the slide's h/w
 * (540/960 for 16:9); `title` goes in handout/outline headers.
 * - slides: one page per slide at slide size (720 pt wide);
 * - notes: portrait paper, the slide in the top half, notes below;
 * - handouts: portrait paper, `perPage` slides in a grid (3 per page adds
 *   ruled lines beside each slide);
 * - outline: portrait paper, titles and body text, paginated by estimate.
 * Every paper page gets a page number; handouts and outlines a header.
 */
export function printPages(slides: readonly Slide[], indices: readonly number[], opts: PrintOptions, aspect: number, title = ""): PrintPage[] {
  if (opts.layout === "slides") {
    const w = SLIDE_PT_W;
    const h = Math.round(SLIDE_PT_W * aspect * 100) / 100;
    return indices.map((index) => ({ w, h, items: [{ kind: "slide", index, box: { x: 0, y: 0, w, h }, frame: opts.frame }] }));
  }
  const paper = PAPER_PT[opts.paper];
  const contentW = paper.w - 2 * MARGIN;
  const pages: PrintPage[] = [];
  const header = (items: PageItem[]) => {
    if (title) items.push({ kind: "label", text: title, box: { x: MARGIN, y: MARGIN - HEADER, w: contentW, h: 14 }, size: 9, align: "left" });
  };
  const footer = (items: PageItem[], n: number) => items.push({ kind: "label", text: String(n), box: { x: MARGIN, y: paper.h - MARGIN + 6, w: contentW, h: 14 }, size: 9, align: "right" });

  if (opts.layout === "notes") {
    for (const index of indices) {
      const items: PageItem[] = [];
      const slideBox = fitBox({ x: MARGIN + 36, y: MARGIN, w: contentW - 72, h: paper.h / 2 - MARGIN - 18 }, aspect);
      items.push({ kind: "slide", index, box: slideBox, frame: true });
      const top = slideBox.y + slideBox.h + 24;
      items.push({ kind: "notes", index, box: { x: MARGIN + 18, y: top, w: contentW - 36, h: paper.h - MARGIN - 12 - top } });
      footer(items, pages.length + 1);
      pages.push({ w: paper.w, h: paper.h, items });
    }
    return pages;
  }

  if (opts.layout === "handouts") {
    const n = opts.perPage;
    const { cols, rows } = handoutGrid(n);
    const gap = 18;
    const areaY = MARGIN + 6;
    const areaH = paper.h - 2 * MARGIN - 6;
    // Three per page: slides take the left half, lines the right.
    const slideAreaW = n === 3 ? contentW * 0.5 : contentW;
    const cellW = (slideAreaW - gap * (cols - 1)) / cols;
    const cellH = (areaH - gap * (rows - 1)) / rows;
    for (let p = 0; p * n < indices.length; p++) {
      const items: PageItem[] = [];
      header(items);
      const chunk = indices.slice(p * n, p * n + n);
      chunk.forEach((index, k) => {
        const col = opts.order === "vertical" && n > 3 ? Math.floor(k / rows) : k % cols;
        const row = opts.order === "vertical" && n > 3 ? k % rows : Math.floor(k / cols);
        const cell = { x: MARGIN + col * (cellW + gap), y: areaY + row * (cellH + gap), w: cellW, h: cellH };
        const box = fitBox(cell, aspect);
        items.push({ kind: "slide", index, box, frame: true });
        if (n === 3) items.push({ kind: "lines", box: { x: MARGIN + slideAreaW + gap, y: box.y + 6, w: contentW - slideAreaW - gap, h: box.h - 6 }, count: 7 });
      });
      footer(items, p + 1);
      pages.push({ w: paper.w, h: paper.h, items });
    }
    return pages;
  }

  // Outline.
  const entries = indices.map((i) => slideOutline(slides[i], i));
  const maxH = paper.h - 2 * MARGIN - 6;
  let cur: OutlineEntry[] = [];
  let used = 0;
  const flush = () => {
    const items: PageItem[] = [];
    header(items);
    items.push({ kind: "outline", entries: cur, box: { x: MARGIN, y: MARGIN + 6, w: contentW, h: maxH } });
    footer(items, pages.length + 1);
    pages.push({ w: paper.w, h: paper.h, items });
    cur = [];
    used = 0;
  };
  for (const e of entries) {
    const h = outlineEntryHeight(e, contentW);
    if (cur.length && used + h > maxH) flush();
    cur.push(e);
    used += h;
  }
  if (cur.length || !pages.length) flush();
  return pages;
}
