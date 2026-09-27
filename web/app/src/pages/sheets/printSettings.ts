/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet sheets are loosely typed. */

// Print settings (page setup) for a sheet and the pagination that follows
// from them. Stored per sheet as `grownPrint`; mapped to xlsx pageSetup,
// pageMargins, printOptions, row/column breaks and the Print_Area /
// Print_Titles defined names. paginate() splits the printed range into pages
// the way Excel does: manual breaks first, then automatic breaks where the
// next column/row would overflow the printable width/height at the chosen
// scale (or the scale that fits the content on N×M pages), with title
// rows/columns repeated on every page.

import type { CellRect } from "./cellRange";

export type Orientation = "portrait" | "landscape";
export type PaperSize = "letter" | "legal" | "tabloid" | "a3" | "a4" | "a5" | "b5";

export interface Margins {
  /** Inches, like Excel's pageMargins. */
  top: number;
  bottom: number;
  left: number;
  right: number;
  header: number;
  footer: number;
}

export interface PrintSettings {
  orientation: Orientation;
  paper: PaperSize;
  margins: Margins;
  /** Percent, 10–400; used when fitToPage is off. */
  scale: number;
  fitToPage: boolean;
  /** Pages wide / tall when fitting; 0 = as many as needed. */
  fitToWidth: number;
  fitToHeight: number;
  printArea: CellRect | null;
  /** Rows repeated at the top of every page (0-based, inclusive). */
  titleRows: [number, number] | null;
  /** Columns repeated at the left of every page. */
  titleCols: [number, number] | null;
  gridLines: boolean;
  headings: boolean;
  hCenter: boolean;
  vCenter: boolean;
  pageOrder: "downThenOver" | "overThenDown";
  /** Manual breaks: index of the first row/column of a new page (0-based, like xlsx brk@id). */
  rowBreaks: number[];
  colBreaks: number[];
  header: string;
  footer: string;
}

/** Paper sizes in millimetres (portrait) and their SpreadsheetML paperSize codes. */
export const PAPER: Record<PaperSize, { w: number; h: number; code: number; label: string }> = {
  letter: { w: 215.9, h: 279.4, code: 1, label: "Letter (8.5\" × 11\")" },
  tabloid: { w: 279.4, h: 431.8, code: 3, label: "Tabloid (11\" × 17\")" },
  legal: { w: 215.9, h: 355.6, code: 5, label: "Legal (8.5\" × 14\")" },
  a3: { w: 297, h: 420, code: 8, label: "A3 (297 × 420 mm)" },
  a4: { w: 210, h: 297, code: 9, label: "A4 (210 × 297 mm)" },
  a5: { w: 148, h: 210, code: 11, label: "A5 (148 × 210 mm)" },
  b5: { w: 176, h: 250, code: 13, label: "B5 (176 × 250 mm)" },
};

export const MARGIN_PRESETS: Record<"normal" | "narrow" | "wide", Margins> = {
  normal: { top: 0.75, bottom: 0.75, left: 0.7, right: 0.7, header: 0.3, footer: 0.3 },
  narrow: { top: 0.75, bottom: 0.75, left: 0.25, right: 0.25, header: 0.3, footer: 0.3 },
  wide: { top: 1, bottom: 1, left: 1, right: 1, header: 0.5, footer: 0.5 },
};

export function defaultPrintSettings(): PrintSettings {
  return {
    orientation: "portrait",
    paper: "letter",
    margins: { ...MARGIN_PRESETS.normal },
    scale: 100,
    fitToPage: false,
    fitToWidth: 1,
    fitToHeight: 1,
    printArea: null,
    titleRows: null,
    titleCols: null,
    gridLines: false,
    headings: false,
    hCenter: false,
    vCenter: false,
    pageOrder: "downThenOver",
    rowBreaks: [],
    colBreaks: [],
    header: "",
    footer: "",
  };
}

/** The sheet's settings merged over the defaults (older/partial models load safely). */
export function sheetPrintSettings(sheet: any): PrintSettings {
  const d = defaultPrintSettings();
  const s = sheet?.grownPrint;
  if (!s || typeof s !== "object") return d;
  return {
    ...d,
    ...s,
    margins: { ...d.margins, ...(s.margins ?? {}) },
    rowBreaks: Array.isArray(s.rowBreaks) ? [...s.rowBreaks] : [],
    colBreaks: Array.isArray(s.colBreaks) ? [...s.colBreaks] : [],
  };
}

// ---- manual page breaks ----------------------------------------------------------------

const sorted = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);

/**
 * Insert page break at the active cell (r, c): a row break above row r and a
 * column break left of column c. Row/column 0 cannot start a new page, so a
 * cell in the first row adds only a column break, and A1 adds nothing.
 */
export function insertPageBreak(s: PrintSettings, r: number, c: number): PrintSettings {
  return {
    ...s,
    rowBreaks: r > 0 ? sorted([...s.rowBreaks, r]) : s.rowBreaks,
    colBreaks: c > 0 ? sorted([...s.colBreaks, c]) : s.colBreaks,
  };
}

/** Removes the row break above r and the column break left of c, where they exist. */
export function removePageBreak(s: PrintSettings, r: number, c: number): PrintSettings {
  return {
    ...s,
    rowBreaks: s.rowBreaks.filter((x) => x !== r),
    colBreaks: s.colBreaks.filter((x) => x !== c),
  };
}

export function resetAllPageBreaks(s: PrintSettings): PrintSettings {
  return { ...s, rowBreaks: [], colBreaks: [] };
}

/**
 * Drags the break at `from` to `to` (page-break preview). Breaks passed over
 * on the way are dropped, as a dragged break swallows the pages in between.
 */
export function movePageBreak(s: PrintSettings, axis: "row" | "col", from: number, to: number): PrintSettings {
  const list = axis === "row" ? s.rowBreaks : s.colBreaks;
  if (!list.includes(from) || to <= 0) return s;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const next = sorted([...list.filter((x) => x !== from && (x < lo || x > hi)), to]);
  return axis === "row" ? { ...s, rowBreaks: next } : { ...s, colBreaks: next };
}

// ---- geometry --------------------------------------------------------------------------

export const PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;

/** Page size in CSS pixels (96 dpi), orientation applied. */
export function pageSizePx(s: Pick<PrintSettings, "paper" | "orientation">): { w: number; h: number } {
  const p = PAPER[s.paper] ?? PAPER.letter;
  const w = (p.w / MM_PER_INCH) * PX_PER_INCH;
  const h = (p.h / MM_PER_INCH) * PX_PER_INCH;
  return s.orientation === "landscape" ? { w: h, h: w } : { w, h };
}

/** Printable area (page minus margins), CSS pixels. */
export function printableSizePx(s: PrintSettings): { w: number; h: number } {
  const page = pageSizePx(s);
  const m = s.margins;
  return {
    w: Math.max(1, page.w - (m.left + m.right) * PX_PER_INCH),
    h: Math.max(1, page.h - (m.top + m.bottom) * PX_PER_INCH),
  };
}

export interface SheetGeometry {
  /** Width in px of column c. */
  colWidth: (c: number) => number;
  /** Height in px of row r. */
  rowHeight: (r: number) => number;
  /** The range printed when no print area is set (the used range). */
  usedRange: CellRect | null;
  /** Hidden rows/columns take no space. */
  rowHidden?: (r: number) => boolean;
  colHidden?: (c: number) => boolean;
}

export interface PrintPage {
  /** Body cells of the page (titles excluded). */
  range: CellRect;
  /** Title rows/columns printed with this page (null when none apply). */
  titleRows: [number, number] | null;
  titleCols: [number, number] | null;
  /** Scale factor (1 = 100 %). */
  scale: number;
  /** Page number, 1-based, in print order. */
  number: number;
}

export interface Pagination {
  pages: PrintPage[];
  scale: number;
  range: CellRect | null;
}

function span(from: number, to: number, size: (i: number) => number, hidden?: (i: number) => boolean): number {
  let t = 0;
  for (let i = from; i <= to; i++) if (!hidden?.(i)) t += size(i);
  return t;
}

/** Splits [from, to] into bands no wider than `avail` (px, already scaled), honouring manual breaks. */
function bands(
  from: number,
  to: number,
  avail: number,
  size: (i: number) => number,
  scale: number,
  manual: number[],
  hidden?: (i: number) => boolean,
): [number, number][] {
  const out: [number, number][] = [];
  const breaks = new Set(manual);
  let start = from;
  let used = 0;
  for (let i = from; i <= to; i++) {
    const w = hidden?.(i) ? 0 : size(i) * scale;
    const forced = i > start && breaks.has(i);
    // An automatic break before i when it would overflow (a single oversized
    // column/row still gets its own page).
    const overflow = i > start && used + w > avail + 1e-6;
    if (forced || overflow) {
      out.push([start, i - 1]);
      start = i;
      used = 0;
    }
    used += w;
  }
  out.push([start, to]);
  return out;
}

/** Excel's print scale is a whole percent between 10 and 400. */
function clampScale(pct: number): number {
  return Math.max(10, Math.min(400, Math.floor(pct)));
}

/** Pages for a sheet, in print order. */
export function paginate(geo: SheetGeometry, s: PrintSettings): Pagination {
  const range = s.printArea ?? geo.usedRange;
  if (!range) return { pages: [], scale: s.scale / 100, range: null };
  const avail = printableSizePx(s);
  const tr = s.titleRows && s.titleRows[0] <= range.r2 ? s.titleRows : null;
  const tc = s.titleCols && s.titleCols[0] <= range.c2 ? s.titleCols : null;
  const titleH = tr ? span(tr[0], tr[1], geo.rowHeight, geo.rowHidden) : 0;
  const titleW = tc ? span(tc[0], tc[1], geo.colWidth, geo.colHidden) : 0;
  let scale = clampScale(s.scale) / 100;
  if (s.fitToPage) {
    const totalW = span(range.c1, range.c2, geo.colWidth, geo.colHidden);
    const totalH = span(range.r1, range.r2, geo.rowHeight, geo.rowHidden);
    let fit = 1;
    if (s.fitToWidth > 0 && totalW > 0) fit = Math.min(fit, (avail.w * s.fitToWidth) / (totalW + titleW * s.fitToWidth));
    if (s.fitToHeight > 0 && totalH > 0) fit = Math.min(fit, (avail.h * s.fitToHeight) / (totalH + titleH * s.fitToHeight));
    scale = clampScale(fit * 100) / 100;
  }
  // When fitting, automatic breaks come from the scaled content; manual breaks
  // still apply (Excel ignores them only with a 1×1 fit, which cannot hold them anyway).
  const colBands = bands(range.c1, range.c2, avail.w - titleW * scale, geo.colWidth, scale, s.colBreaks, geo.colHidden);
  const rowBands = bands(range.r1, range.r2, avail.h - titleH * scale, geo.rowHeight, scale, s.rowBreaks, geo.rowHidden);
  const pages: PrintPage[] = [];
  const push = (rb: [number, number], cb: [number, number]) =>
    pages.push({
      range: { r1: rb[0], r2: rb[1], c1: cb[0], c2: cb[1] },
      // Titles are repeated only on pages after the ones that already show them.
      titleRows: tr && rb[0] > tr[1] ? tr : null,
      titleCols: tc && cb[0] > tc[1] ? tc : null,
      scale,
      number: pages.length + 1,
    });
  if (s.pageOrder === "overThenDown") {
    for (const rb of rowBands) for (const cb of colBands) push(rb, cb);
  } else {
    for (const cb of colBands) for (const rb of rowBands) push(rb, cb);
  }
  return { pages, scale, range };
}

/** Geometry of a FortuneSheet sheet (stored or live form). */
export function sheetGeometry(sheet: any): SheetGeometry {
  const cfg = sheet?.config ?? {};
  const defW = Number(sheet?.defaultColWidth) || 73;
  const defH = Number(sheet?.defaultRowHeight) || 19;
  const colW = (c: number) => {
    const v = cfg.columnlen?.[c];
    return typeof v === "number" ? v : defW;
  };
  const rowH = (r: number) => {
    const v = cfg.rowlen?.[r];
    return typeof v === "number" ? v : defH;
  };
  let r2 = -1;
  let c2 = -1;
  const visit = (r: number, c: number, cell: any) => {
    if (cell == null) return;
    const v = cell.v ?? cell.m ?? cell.f ?? (cell.ct?.s ? "x" : null);
    if (v === null || v === undefined || v === "") {
      if (!cell.bg) return;
    }
    const mc = cell.mc;
    r2 = Math.max(r2, r + (mc?.rs ? mc.rs - 1 : 0));
    c2 = Math.max(c2, c + (mc?.cs ? mc.cs - 1 : 0));
  };
  if (Array.isArray(sheet?.data)) {
    sheet.data.forEach((row: any[], r: number) => row?.forEach?.((cell: any, c: number) => visit(r, c, cell)));
  } else {
    for (const cd of Array.isArray(sheet?.celldata) ? sheet.celldata : []) visit(cd.r, cd.c, cd.v);
  }
  return {
    colWidth: colW,
    rowHeight: rowH,
    usedRange: r2 < 0 ? null : { r1: 0, c1: 0, r2, c2 },
    rowHidden: (r) => cfg.rowhidden != null && String(r) in cfg.rowhidden,
    colHidden: (c) => cfg.colhidden != null && String(c) in cfg.colhidden,
  };
}
