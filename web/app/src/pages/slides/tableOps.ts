// Pure table operations (M5): grid geometry, merges, row/column insert and
// delete, merge/split, borders, fills, styles, rich cell text and cell
// keyboard navigation. Every function returns new objects.
//
// Model recap (model.ts TableData): `cells[r][c]` is each cell's plain text;
// optional `colW`/`rowH` are relative sizes scaled to the element box;
// `merges` lists merged blocks by their top-left anchor (covered cells keep
// ""); `props[r][c]` holds per-cell overrides; `style` + `look` pick a
// template from tableStyles.ts.

import {
  newTable,
  uid,
  type CellBorder,
  type CellMerge,
  type CellProps,
  type CellSide,
  type SlideElement,
  type TableData,
  type TableLook,
  type TextRun,
} from "./model";
import { elementRuns, effectiveStyle, STYLE_KEYS, withRuns } from "./textOps";
import { DEFAULT_LOOK, MEDIUM_STYLE_2_ACCENT_1, findTableTemplate, templateCell } from "./tableStyles";

/** An inclusive cell range. */
export interface CellRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export const SIDES: CellSide[] = ["t", "r", "b", "l"];
const OPPOSITE: Record<CellSide, CellSide> = { t: "b", b: "t", l: "r", r: "l" };

/** Legacy look of an unstyled table without a stroke. */
export const LEGACY_BORDER: CellBorder = { color: "#bbbbbb", width: 1 };
/** Cell padding (px) on every side. */
export const CELL_PAD = 4;
/** Smallest column / row size a drag can make (px). */
export const MIN_CELL = 12;

// ---------------------------------------------------------------- create

/** A styled table element (Insert ▸ Table picker): PowerPoint's default
 *  style with a header row and banded rows, 40 px rows. */
export function newTableElement(rows: number, cols: number, at?: { x: number; y: number }): SlideElement {
  const w = Math.min(880, Math.max(160, cols * 120));
  const h = rows * 40;
  return {
    id: uid(),
    type: "table",
    x: at?.x ?? Math.round((960 - w) / 2),
    y: at?.y ?? Math.max(20, Math.round((540 - h) / 2)),
    w,
    h,
    table: { ...newTable(rows, cols), style: MEDIUM_STYLE_2_ACCENT_1, look: { ...DEFAULT_LOOK } },
    fill: "none",
    stroke: "none",
    strokeWidth: 0,
    fontSize: 18,
    fontFamily: "Arial",
    color: "#000000",
  };
}

// ---------------------------------------------------------------- geometry

function scaled(rel: number[] | undefined, n: number, total: number): number[] {
  const src = rel && rel.length === n && rel.every((v) => v > 0) ? rel : Array(n).fill(1);
  const sum = src.reduce((a, b) => a + b, 0) || 1;
  return src.map((v) => (v / sum) * total);
}

/** Column widths in px (summing to the element width). */
export function colWidths(el: SlideElement): number[] {
  const t = el.table;
  return t ? scaled(t.colW, t.cols, el.w) : [];
}

/** Row heights in px (summing to the element height). */
export function rowHeights(el: SlideElement): number[] {
  const t = el.table;
  return t ? scaled(t.rowH, t.rows, el.h) : [];
}

/** Running offsets: [0, a, a+b, …, total]. */
export function offsets(sizes: number[]): number[] {
  const out = [0];
  for (const s of sizes) out.push(out[out.length - 1] + s);
  return out;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- merges

/** The merge covering cell (r, c), if any. */
export function mergeAt(t: TableData, r: number, c: number): CellMerge | undefined {
  return t.merges?.find((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs);
}

/** The anchor (top-left) of the block containing (r, c). */
export function anchorOf(t: TableData, r: number, c: number): [number, number] {
  const m = mergeAt(t, r, c);
  return m ? [m.r, m.c] : [r, c];
}

/** Row/column span of the cell anchored at (r, c) (1×1 when not merged). */
export function spanOf(t: TableData, r: number, c: number): { rs: number; cs: number } {
  const m = t.merges?.find((x) => x.r === r && x.c === c);
  return m ? { rs: m.rs, cs: m.cs } : { rs: 1, cs: 1 };
}

/** A covered cell (inside a merge, not its anchor) is not drawn. */
export function isCovered(t: TableData, r: number, c: number): boolean {
  const m = mergeAt(t, r, c);
  return !!m && (m.r !== r || m.c !== c);
}

/** normRange orders a range's corners. */
export function normRange(r0: number, c0: number, r1: number, c1: number): CellRange {
  return { r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) };
}

/** expandRange grows a range until no merge straddles its edge. */
export function expandRange(t: TableData, g: CellRange): CellRange {
  const out = { ...g };
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of t.merges ?? []) {
      const inter = m.r <= out.r1 && m.r + m.rs - 1 >= out.r0 && m.c <= out.c1 && m.c + m.cs - 1 >= out.c0;
      if (!inter) continue;
      const nr0 = Math.min(out.r0, m.r);
      const nc0 = Math.min(out.c0, m.c);
      const nr1 = Math.max(out.r1, m.r + m.rs - 1);
      const nc1 = Math.max(out.c1, m.c + m.cs - 1);
      if (nr0 !== out.r0 || nc0 !== out.c0 || nr1 !== out.r1 || nc1 !== out.c1) {
        Object.assign(out, { r0: nr0, c0: nc0, r1: nr1, c1: nc1 });
        changed = true;
      }
    }
  }
  return out;
}

/** The anchor cells inside a range, row-major. */
export function rangeAnchors(t: TableData, g: CellRange): [number, number][] {
  const out: [number, number][] = [];
  for (let r = g.r0; r <= g.r1; r++)
    for (let c = g.c0; c <= g.c1; c++) if (!isCovered(t, r, c)) out.push([r, c]);
  return out;
}

function cleanMerges(ms: CellMerge[]): CellMerge[] | undefined {
  const out = ms.filter((m) => m.rs > 1 || m.cs > 1);
  return out.length ? out : undefined;
}

// ---------------------------------------------------------------- table data helpers

function cloneT(t: TableData): TableData {
  return {
    ...t,
    cells: t.cells.map((row) => [...row]),
    ...(t.props ? { props: t.props.map((row) => row.map((p) => (p ? { ...p } : null))) } : {}),
    ...(t.merges ? { merges: t.merges.map((m) => ({ ...m })) } : {}),
    ...(t.colW ? { colW: [...t.colW] } : {}),
    ...(t.rowH ? { rowH: [...t.rowH] } : {}),
  };
}

function propsGrid(t: TableData): (CellProps | null)[][] {
  return Array.from({ length: t.rows }, (_, r) =>
    Array.from({ length: t.cols }, (_, c) => t.props?.[r]?.[c] ?? null),
  );
}

function emptyProps(p: CellProps | null | undefined): boolean {
  if (!p) return true;
  return Object.values(p).every((v) => v === undefined || (typeof v === "object" && v !== null && !Array.isArray(v) && !Object.keys(v).length));
}

/** Drop empty per-cell props (and the whole grid when nothing is left). */
function tidy(t: TableData): TableData {
  const out = { ...t };
  if (out.props) {
    const g = out.props.map((row) => row.map((p) => (emptyProps(p) ? null : p)));
    if (g.some((row) => row.some(Boolean))) out.props = g;
    else delete out.props;
  }
  const m = cleanMerges(out.merges ?? []);
  if (m) out.merges = m;
  else delete out.merges;
  return out;
}

/** Formatting (not content) of a cell, copied into inserted rows/columns. */
function formatOnly(p: CellProps | null | undefined): CellProps | null {
  if (!p) return null;
  const { runs: _r, paras: _p, ...rest } = p;
  void _r;
  void _p;
  return emptyProps(rest) ? null : { ...rest };
}

// ---------------------------------------------------------------- rows / columns

/** insertRows adds `n` rows before row `at` (0…rows). New rows copy the
 *  formatting of the row they are inserted next to, merges that span the
 *  insertion point grow, and the table grows by the new rows' height. */
export function insertRows(el: SlideElement, at: number, n = 1): SlideElement {
  const t0 = el.table;
  if (!t0 || n < 1) return el;
  at = Math.max(0, Math.min(t0.rows, at));
  const heights = rowHeights(el);
  const src = at > 0 ? at - 1 : 0;
  const newH = heights[src] ?? 40;
  const t = cloneT(t0);
  const pg = propsGrid(t0);
  const tplRow = pg[src] ?? [];
  for (let i = 0; i < n; i++) {
    t.cells.splice(at, 0, Array(t.cols).fill(""));
    pg.splice(at, 0, tplRow.map(formatOnly));
  }
  t.props = pg;
  t.rows += n;
  t.rowH = [...heights.slice(0, at), ...Array(n).fill(newH), ...heights.slice(at)].map(r2);
  t.merges = (t.merges ?? []).map((m) =>
    m.r >= at ? { ...m, r: m.r + n } : m.r + m.rs > at ? { ...m, rs: m.rs + n } : m,
  );
  return { ...el, h: r2(el.h + newH * n), table: tidy(t) };
}

/** deleteRows removes rows r0…r1. Returns null when no row would be left
 *  (the caller deletes the table). */
export function deleteRows(el: SlideElement, r0: number, r1: number): SlideElement | null {
  const t0 = el.table;
  if (!t0) return el;
  [r0, r1] = [Math.max(0, Math.min(r0, r1)), Math.min(t0.rows - 1, Math.max(r0, r1))];
  const n = r1 - r0 + 1;
  if (n >= t0.rows) return null;
  const heights = rowHeights(el);
  const gone = heights.slice(r0, r1 + 1).reduce((a, b) => a + b, 0);
  const t = cloneT(t0);
  const pg = propsGrid(t0);
  // A merge whose anchor row goes but that continues below keeps its
  // content on its first surviving row.
  const merges: CellMerge[] = [];
  for (const m of t0.merges ?? []) {
    const end = m.r + m.rs - 1;
    if (m.r >= r0 && end <= r1) continue;
    const cut = Math.max(0, Math.min(end, r1) - Math.max(m.r, r0) + 1);
    if (m.r > r1) merges.push({ ...m, r: m.r - n });
    else if (m.r < r0) merges.push({ ...m, rs: m.rs - cut });
    else {
      t.cells[r1 + 1][m.c] = t0.cells[m.r][m.c];
      pg[r1 + 1][m.c] = pg[m.r][m.c];
      merges.push({ ...m, r: r0, rs: m.rs - cut });
    }
  }
  t.cells.splice(r0, n);
  pg.splice(r0, n);
  t.props = pg;
  t.merges = merges;
  t.rows -= n;
  t.rowH = [...heights.slice(0, r0), ...heights.slice(r1 + 1)].map(r2);
  return { ...el, h: r2(el.h - gone), table: tidy(t) };
}

/** insertCols adds `n` columns before column `at`; the table widens. */
export function insertCols(el: SlideElement, at: number, n = 1): SlideElement {
  const t0 = el.table;
  if (!t0 || n < 1) return el;
  at = Math.max(0, Math.min(t0.cols, at));
  const widths = colWidths(el);
  const src = at > 0 ? at - 1 : 0;
  const newW = widths[src] ?? 100;
  const t = cloneT(t0);
  const pg = propsGrid(t0);
  for (let r = 0; r < t.rows; r++) {
    t.cells[r].splice(at, 0, ...Array(n).fill(""));
    pg[r].splice(at, 0, ...Array.from({ length: n }, () => formatOnly(pg[r][src])));
  }
  t.props = pg;
  t.cols += n;
  t.colW = [...widths.slice(0, at), ...Array(n).fill(newW), ...widths.slice(at)].map(r2);
  t.merges = (t.merges ?? []).map((m) =>
    m.c >= at ? { ...m, c: m.c + n } : m.c + m.cs > at ? { ...m, cs: m.cs + n } : m,
  );
  return { ...el, w: r2(el.w + newW * n), table: tidy(t) };
}

/** deleteCols removes columns c0…c1 (null = nothing would be left). */
export function deleteCols(el: SlideElement, c0: number, c1: number): SlideElement | null {
  const t0 = el.table;
  if (!t0) return el;
  [c0, c1] = [Math.max(0, Math.min(c0, c1)), Math.min(t0.cols - 1, Math.max(c0, c1))];
  const n = c1 - c0 + 1;
  if (n >= t0.cols) return null;
  const widths = colWidths(el);
  const gone = widths.slice(c0, c1 + 1).reduce((a, b) => a + b, 0);
  const t = cloneT(t0);
  const pg = propsGrid(t0);
  const merges: CellMerge[] = [];
  for (const m of t0.merges ?? []) {
    const end = m.c + m.cs - 1;
    if (m.c >= c0 && end <= c1) continue;
    const cut = Math.max(0, Math.min(end, c1) - Math.max(m.c, c0) + 1);
    if (m.c > c1) merges.push({ ...m, c: m.c - n });
    else if (m.c < c0) merges.push({ ...m, cs: m.cs - cut });
    else {
      t.cells[m.r][c1 + 1] = t0.cells[m.r][m.c];
      pg[m.r][c1 + 1] = pg[m.r][m.c];
      merges.push({ ...m, c: c0, cs: m.cs - cut });
    }
  }
  for (let r = 0; r < t.rows; r++) {
    t.cells[r].splice(c0, n);
    pg[r].splice(c0, n);
  }
  t.props = pg;
  t.merges = merges;
  t.cols -= n;
  t.colW = [...widths.slice(0, c0), ...widths.slice(c1 + 1)].map(r2);
  return { ...el, w: r2(el.w - gone), table: tidy(t) };
}

// ---------------------------------------------------------------- merge / split

/** mergeCells merges a range (grown to whole merges) into one cell. The
 *  non-empty cells' contents are joined as paragraphs in the anchor. */
export function mergeCells(el: SlideElement, g: CellRange): SlideElement {
  const t0 = el.table;
  if (!t0) return el;
  const x = expandRange(t0, g);
  if (x.r0 === x.r1 && x.c0 === x.c1) return el;
  const runs: TextRun[] = [];
  for (const [r, c] of rangeAnchors(t0, x)) {
    const te = cellTextEl(el, r, c);
    if (!(te.text || "").length) continue;
    if (runs.length) runs.push({ ...runs[runs.length - 1], text: "\n" });
    for (const run of elementRuns(te)) runs.push({ ...effectiveStyle(te, run), text: run.text });
  }
  const t = cloneT(t0);
  const pg = propsGrid(t0);
  for (let r = x.r0; r <= x.r1; r++)
    for (let c = x.c0; c <= x.c1; c++) {
      if (r === x.r0 && c === x.c0) continue;
      t.cells[r][c] = "";
      if (pg[r][c]) pg[r][c] = formatOnly(pg[r][c]);
    }
  t.props = pg;
  t.merges = [
    ...(t0.merges ?? []).filter((m) => !(m.r >= x.r0 && m.r <= x.r1 && m.c >= x.c0 && m.c <= x.c1)),
    { r: x.r0, c: x.c0, rs: x.r1 - x.r0 + 1, cs: x.c1 - x.c0 + 1 },
  ];
  let out: SlideElement = { ...el, table: tidy(t) };
  if (runs.length) {
    const base = cellTextEl(out, x.r0, x.c0);
    out = setCellText(out, x.r0, x.c0, withRuns({ ...base, runs: undefined, text: "" }, runs, []));
  } else out = setCellText(out, x.r0, x.c0, { ...cellTextEl(out, x.r0, x.c0), text: "", runs: undefined, paras: undefined });
  return out;
}

/** Can the cell at (r, c) be split into nr × nc? A merged cell splits into
 *  blocks that divide its span; a single cell splits by adding grid lines. */
export function canSplit(t: TableData, r: number, c: number, nr: number, nc: number): boolean {
  if (nr < 1 || nc < 1 || (nr === 1 && nc === 1)) return false;
  const { rs, cs } = spanOf(t, r, c);
  if (rs > 1 || cs > 1) return rs % nr === 0 && cs % nc === 0;
  return nr <= 20 && nc <= 20;
}

/** splitCell splits the cell anchored at (r, c) into nr rows × nc columns
 *  (PowerPoint "Split cells"). The anchor keeps the content. */
export function splitCell(el: SlideElement, r: number, c: number, nr: number, nc: number): SlideElement {
  const t0 = el.table;
  if (!t0) return el;
  [r, c] = anchorOf(t0, r, c);
  if (!canSplit(t0, r, c, nr, nc)) return el;
  const { rs, cs } = spanOf(t0, r, c);
  if (rs > 1 || cs > 1) {
    const br = rs / nr;
    const bc = cs / nc;
    const t = cloneT(t0);
    const merges = (t0.merges ?? []).filter((m) => !(m.r === r && m.c === c));
    for (let i = 0; i < nr; i++)
      for (let j = 0; j < nc; j++) merges.push({ r: r + i * br, c: c + j * bc, rs: br, cs: bc });
    t.merges = merges;
    return { ...el, table: tidy(t) };
  }
  let out = el;
  if (nc > 1) out = splitColumn(out, r, c, nc);
  if (nr > 1) out = splitRow(out, r, c, nc, nr);
  return out;
}

/** Split grid column c into n equal columns; cell (r, c) becomes n cells,
 *  every other cell in the column spans the new columns. */
function splitColumn(el: SlideElement, r: number, c: number, n: number): SlideElement {
  const t0 = el.table!;
  const widths = colWidths(el);
  const t = cloneT(t0);
  const pg = propsGrid(t0);
  const add = n - 1;
  for (let i = 0; i < t.rows; i++) {
    t.cells[i].splice(c + 1, 0, ...Array(add).fill(""));
    pg[i].splice(c + 1, 0, ...Array.from({ length: add }, () => formatOnly(pg[i][c])));
  }
  const merges: CellMerge[] = [];
  const handled = new Set<CellMerge>();
  for (const m of t0.merges ?? []) {
    if (m.c > c) merges.push({ ...m, c: m.c + add });
    else if (m.c + m.cs - 1 >= c) {
      merges.push({ ...m, cs: m.cs + add });
      handled.add(m);
    } else merges.push({ ...m });
  }
  for (let i = 0; i < t0.rows; i++) {
    if (i === r || mergeAt(t0, i, c)) continue;
    merges.push({ r: i, c, rs: 1, cs: n });
  }
  t.merges = merges;
  t.props = pg;
  t.cols += add;
  const part = widths[c] / n;
  t.colW = [...widths.slice(0, c), ...Array(n).fill(part), ...widths.slice(c + 1)].map(r2);
  return { ...el, table: tidy(t) };
}

/** Split grid row r into n rows across the columns c…c+w-1 (the cells being
 *  split); the other cells in the row span the new rows. */
function splitRow(el: SlideElement, r: number, c: number, w: number, n: number): SlideElement {
  const t0 = el.table!;
  const heights = rowHeights(el);
  const t = cloneT(t0);
  const pg = propsGrid(t0);
  const add = n - 1;
  for (let k = 0; k < add; k++) {
    t.cells.splice(r + 1, 0, Array(t.cols).fill(""));
    pg.splice(r + 1, 0, pg[r].map(formatOnly));
  }
  const merges: CellMerge[] = [];
  for (const m of t0.merges ?? []) {
    if (m.r > r) merges.push({ ...m, r: m.r + add });
    else if (m.r + m.rs - 1 >= r) merges.push({ ...m, rs: m.rs + add });
    else merges.push({ ...m });
  }
  for (let j = 0; j < t0.cols; j++) {
    if ((j >= c && j < c + w) || mergeAt(t0, r, j)) continue;
    merges.push({ r, c: j, rs: n, cs: 1 });
  }
  t.merges = merges;
  t.props = pg;
  t.rows += add;
  const part = heights[r] / n;
  t.rowH = [...heights.slice(0, r), ...Array(n).fill(part), ...heights.slice(r + 1)].map(r2);
  return { ...el, table: tidy(t) };
}

// ---------------------------------------------------------------- sizes

/** resizeColumn drags the grid line left of column `i` (1…cols) by dx px.
 *  An inner line trades width between its two columns (the table keeps its
 *  width); the right edge (i = cols) widens or narrows the table. */
export function resizeColumn(el: SlideElement, i: number, dx: number): SlideElement {
  const t = el.table;
  if (!t || i < 1 || i > t.cols) return el;
  const w = colWidths(el);
  if (i === t.cols) {
    const nw = Math.max(MIN_CELL, w[i - 1] + dx);
    const d = nw - w[i - 1];
    w[i - 1] = nw;
    return { ...el, w: r2(el.w + d), table: { ...t, colW: w.map(r2) } };
  }
  const d = Math.max(MIN_CELL - w[i - 1], Math.min(w[i] - MIN_CELL, dx));
  w[i - 1] += d;
  w[i] -= d;
  return { ...el, table: { ...t, colW: w.map(r2) } };
}

/** resizeRow drags the line under row `i-1` (i = 1…rows) by dy px; the
 *  table grows or shrinks with it. */
export function resizeRow(el: SlideElement, i: number, dy: number): SlideElement {
  const t = el.table;
  if (!t || i < 1 || i > t.rows) return el;
  const h = rowHeights(el);
  const nh = Math.max(MIN_CELL, h[i - 1] + dy);
  const d = nh - h[i - 1];
  h[i - 1] = nh;
  return { ...el, h: r2(el.h + d), table: { ...t, rowH: h.map(r2) } };
}

/** distributeCols makes the columns c0…c1 equal (their total kept). */
export function distributeCols(el: SlideElement, c0 = 0, c1 = (el.table?.cols ?? 1) - 1): SlideElement {
  const t = el.table;
  if (!t) return el;
  const w = colWidths(el);
  const sum = w.slice(c0, c1 + 1).reduce((a, b) => a + b, 0);
  for (let c = c0; c <= c1; c++) w[c] = sum / (c1 - c0 + 1);
  const next: TableData = { ...t, colW: w.map(r2) };
  if (next.colW!.every((v) => Math.abs(v - next.colW![0]) < 0.01)) delete next.colW;
  return { ...el, table: next };
}

/** distributeRows makes the rows r0…r1 equal (their total kept). */
export function distributeRows(el: SlideElement, r0 = 0, r1 = (el.table?.rows ?? 1) - 1): SlideElement {
  const t = el.table;
  if (!t) return el;
  const h = rowHeights(el);
  const sum = h.slice(r0, r1 + 1).reduce((a, b) => a + b, 0);
  for (let r = r0; r <= r1; r++) h[r] = sum / (r1 - r0 + 1);
  const next: TableData = { ...t, rowH: h.map(r2) };
  if (next.rowH!.every((v) => Math.abs(v - next.rowH![0]) < 0.01)) delete next.rowH;
  return { ...el, table: next };
}

// ---------------------------------------------------------------- style / look

/** setTableStyle picks a template (undefined = none). A table that had no
 *  look gets PowerPoint's default (header + banded rows). */
export function setTableStyle(el: SlideElement, id: string | undefined): SlideElement {
  const t = el.table;
  if (!t) return el;
  const next: TableData = { ...t };
  if (id && findTableTemplate(id)) {
    next.style = id;
    if (!next.look) next.look = { ...DEFAULT_LOOK };
  } else delete next.style;
  return { ...el, table: next };
}

/** setLook turns one style option on or off. */
export function setLook(el: SlideElement, key: keyof TableLook, on: boolean): SlideElement {
  const t = el.table;
  if (!t) return el;
  const look: TableLook = { ...(t.look ?? {}) };
  if (on) look[key] = true;
  else delete look[key];
  const next: TableData = { ...t, look };
  if (!Object.keys(look).length) delete next.look;
  return { ...el, table: next };
}

// ---------------------------------------------------------------- cell props

/** updateCells applies `fn` to the props of every anchor cell in a range. */
export function updateCells(
  el: SlideElement,
  g: CellRange,
  fn: (p: CellProps, r: number, c: number) => CellProps,
): SlideElement {
  const t0 = el.table;
  if (!t0) return el;
  const t = cloneT(t0);
  const pg = propsGrid(t0);
  for (const [r, c] of rangeAnchors(t0, expandRange(t0, g))) pg[r][c] = fn({ ...(pg[r][c] ?? {}) }, r, c);
  t.props = pg;
  return { ...el, table: tidy(t) };
}

/** setCellFill sets (or with null clears) the fill of the range's cells. */
export function setCellFill(el: SlideElement, g: CellRange, fill: string | null): SlideElement {
  return updateCells(el, g, (p) => {
    if (fill === null) delete p.fill;
    else p.fill = fill;
    return p;
  });
}

export type BorderPreset =
  | "all"
  | "outer"
  | "inner"
  | "insideH"
  | "insideV"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "none";

export const BORDER_PRESETS: { id: BorderPreset; label: string }[] = [
  { id: "all", label: "All borders" },
  { id: "outer", label: "Outer borders" },
  { id: "inner", label: "Inner borders" },
  { id: "insideH", label: "Inner horizontal" },
  { id: "insideV", label: "Inner vertical" },
  { id: "top", label: "Top border" },
  { id: "bottom", label: "Bottom border" },
  { id: "left", label: "Left border" },
  { id: "right", label: "Right border" },
  { id: "none", label: "No borders" },
];

/** Which sides of a cell block (anchor r,c span rs×cs) a preset sets,
 *  inside the range g. */
function presetSides(p: BorderPreset, g: CellRange, r: number, c: number, rs: number, cs: number): CellSide[] {
  const top = r === g.r0;
  const bottom = r + rs - 1 === g.r1;
  const left = c === g.c0;
  const right = c + cs - 1 === g.c1;
  const edge: Record<CellSide, boolean> = { t: top, b: bottom, l: left, r: right };
  switch (p) {
    case "all":
    case "none":
      return SIDES;
    case "outer":
      return SIDES.filter((s) => edge[s]);
    case "inner":
      return SIDES.filter((s) => !edge[s]);
    case "insideH":
      return (["t", "b"] as CellSide[]).filter((s) => !edge[s]);
    case "insideV":
      return (["l", "r"] as CellSide[]).filter((s) => !edge[s]);
    case "top":
      return top ? ["t"] : [];
    case "bottom":
      return bottom ? ["b"] : [];
    case "left":
      return left ? ["l"] : [];
    case "right":
      return right ? ["r"] : [];
  }
}

/** setBorders applies a border preset to a range (OnlyOffice/PowerPoint
 *  border picker). "none" writes explicit no-lines. The neighbour across a
 *  range edge gets the same line on its facing side, so both cells agree. */
export function setBorders(el: SlideElement, g0: CellRange, preset: BorderPreset, border: CellBorder): SlideElement {
  const t0 = el.table;
  if (!t0) return el;
  const g = expandRange(t0, g0);
  const line: CellBorder = preset === "none" ? { color: border.color, width: 0 } : { ...border };
  const t = cloneT(t0);
  const pg = propsGrid(t0);
  const set = (r: number, c: number, s: CellSide) => {
    if (r < 0 || c < 0 || r >= t.rows || c >= t.cols) return;
    const [ar, ac] = anchorOf(t0, r, c);
    const p = { ...(pg[ar][ac] ?? {}) };
    p.borders = { ...(p.borders ?? {}), [s]: { ...line } };
    pg[ar][ac] = p;
  };
  for (const [r, c] of rangeAnchors(t0, g)) {
    const { rs, cs } = spanOf(t0, r, c);
    for (const s of presetSides(preset, g, r, c, rs, cs)) {
      set(r, c, s);
      // Facing sides of the neighbours along this side.
      if (s === "t") for (let j = c; j < c + cs; j++) set(r - 1, j, OPPOSITE[s]);
      if (s === "b") for (let j = c; j < c + cs; j++) set(r + rs, j, OPPOSITE[s]);
      if (s === "l") for (let i = r; i < r + rs; i++) set(i, c - 1, OPPOSITE[s]);
      if (s === "r") for (let i = r; i < r + rs; i++) set(i, c + cs, OPPOSITE[s]);
    }
  }
  t.props = pg;
  return { ...el, table: tidy(t) };
}

/** Effective fill and borders of cell (r, c): explicit props, then the
 *  style template, then the legacy element fill/stroke. */
export function cellFormat(
  el: SlideElement,
  r: number,
  c: number,
): { fill?: string; borders: Record<CellSide, CellBorder | undefined> } {
  const t = el.table!;
  const p = t.props?.[r]?.[c] ?? null;
  const tpl = findTableTemplate(t.style);
  const tc = templateCell(tpl, t.look, t.rows, t.cols, r, c);
  const legacyLine: CellBorder | undefined = tpl
    ? undefined
    : el.stroke && el.stroke !== "none"
      ? { color: el.stroke, width: el.strokeWidth || 1 }
      : LEGACY_BORDER;
  const legacyFill = !tpl && el.fill && el.fill !== "none" ? el.fill : undefined;
  let fill = p?.fill ?? tc.fill ?? legacyFill;
  if (fill === "none") fill = undefined;
  const borders = {} as Record<CellSide, CellBorder | undefined>;
  for (const s of SIDES) {
    const b = p?.borders?.[s] ?? tc.borders[s] ?? legacyLine;
    borders[s] = b && b.width > 0 ? b : undefined;
  }
  return { fill, borders };
}

// ---------------------------------------------------------------- cell text

/** Character keys a cell can override (not links: those live in runs). */
const CELL_STYLE_KEYS = STYLE_KEYS.filter((k) => k !== "url");

/** The text formatting a cell inherits before its own overrides. */
function cellBase(el: SlideElement, r: number, c: number): SlideElement {
  const t = el.table!;
  const tc = templateCell(findTableTemplate(t.style), t.look, t.rows, t.cols, r, c);
  const p = t.props?.[r]?.[c] ?? null;
  const base: SlideElement = {
    id: `${el.id}:${r}:${c}`,
    type: "text",
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    fontSize: el.fontSize || 16,
    fontFamily: el.fontFamily || "Arial",
    color: tc.color ?? el.color ?? "#202124",
    align: p?.align ?? el.align ?? "left",
    valign: p?.valign ?? "top",
    insets: { l: CELL_PAD, t: CELL_PAD, r: CELL_PAD, b: CELL_PAD },
  };
  if (tc.bold || el.bold) base.bold = true;
  if (el.italic) base.italic = true;
  if (el.underline) base.underline = true;
  if (el.strike) base.strike = true;
  if (el.lineSpacing) base.lineSpacing = el.lineSpacing;
  return base;
}

/** cellTextEl presents cell (r, c) as a text element (id "<table>:<r>:<c>"),
 *  so the text renderer, the rich editor and textOps work on cells. */
export function cellTextEl(el: SlideElement, r: number, c: number): SlideElement {
  const t = el.table!;
  const p = t.props?.[r]?.[c] ?? null;
  const out: SlideElement = { ...cellBase(el, r, c), ...(p?.style ?? {}), text: t.cells[r]?.[c] ?? "" };
  if (p?.runs) out.runs = p.runs;
  if (p?.paras) out.paras = p.paras;
  return out;
}

/** setCellText writes an edited cell text element back into the table:
 *  its text, runs, paragraphs, alignment and every character value that
 *  differs from what the cell inherits. */
export function setCellText(el: SlideElement, r: number, c: number, te: SlideElement): SlideElement {
  const t0 = el.table;
  if (!t0) return el;
  const base = cellBase(el, r, c);
  const t = cloneT(t0);
  const pg = propsGrid(t0);
  const p: CellProps = { ...(pg[r][c] ?? {}) };
  const style: Record<string, unknown> = {};
  for (const k of CELL_STYLE_KEYS) {
    const v = te[k as keyof SlideElement];
    const b = base[k as keyof SlideElement];
    if (k === "bold" || k === "italic" || k === "underline" || k === "strike") {
      if (!!v !== !!b) style[k] = !!v;
    } else if (v !== undefined && v !== b) style[k] = v;
  }
  if (Object.keys(style).length) p.style = style;
  else delete p.style;
  const runsOk = te.runs && te.runs.map((x) => x.text).join("") === (te.text || "");
  if (runsOk) p.runs = te.runs;
  else delete p.runs;
  if (te.paras) p.paras = te.paras;
  else delete p.paras;
  const align = te.align && te.align !== (el.align ?? "left") ? te.align : undefined;
  if (align) p.align = align;
  else delete p.align;
  if (te.valign && te.valign !== "top") p.valign = te.valign;
  else delete p.valign;
  t.cells[r][c] = te.text || "";
  pg[r][c] = p;
  t.props = pg;
  return { ...el, table: tidy(t) };
}

/** Parse a cell text id "<tableId>:<r>:<c>". */
export function parseCellId(id: string): { tableId: string; r: number; c: number } | null {
  const m = /^(.*):(\d+):(\d+)$/.exec(id);
  return m ? { tableId: m[1], r: Number(m[2]), c: Number(m[3]) } : null;
}

/** mapCells applies a text edit to every anchor cell of a range. */
export function mapCellTexts(
  el: SlideElement,
  g: CellRange,
  fn: (te: SlideElement) => SlideElement | null,
): SlideElement {
  const t = el.table;
  if (!t) return el;
  let out = el;
  for (const [r, c] of rangeAnchors(t, expandRange(t, g))) {
    const next = fn(cellTextEl(out, r, c));
    if (next) out = setCellText(out, r, c, next);
  }
  return out;
}

/** clearCells empties the text of a range (formatting stays). */
export function clearCells(el: SlideElement, g: CellRange): SlideElement {
  return mapCellTexts(el, g, (te) => ({ ...te, text: "", runs: undefined, paras: undefined }));
}

/** The whole table as a range. */
export function allCells(t: TableData): CellRange {
  return { r0: 0, c0: 0, r1: t.rows - 1, c1: t.cols - 1 };
}

// ---------------------------------------------------------------- navigation

export type CellDir = "left" | "right" | "up" | "down" | "next" | "prev";

/** moveCell returns the anchor reached from the cell at (r, c), or null at
 *  the table edge. next/prev walk the anchors row by row (Tab/Shift+Tab). */
export function moveCell(t: TableData, r: number, c: number, dir: CellDir): [number, number] | null {
  [r, c] = anchorOf(t, r, c);
  const { rs, cs } = spanOf(t, r, c);
  switch (dir) {
    case "right":
      return c + cs < t.cols ? anchorOf(t, r, c + cs) : null;
    case "left":
      return c > 0 ? anchorOf(t, r, c - 1) : null;
    case "down":
      return r + rs < t.rows ? anchorOf(t, r + rs, c) : null;
    case "up":
      return r > 0 ? anchorOf(t, r - 1, c) : null;
    case "next":
    case "prev": {
      const all = rangeAnchors(t, allCells(t));
      const i = all.findIndex(([a, b]) => a === r && b === c);
      const j = dir === "next" ? i + 1 : i - 1;
      return j >= 0 && j < all.length ? all[j] : null;
    }
  }
}

/** Cell selection inside a selected table: an anchor and a focus cell. */
export interface CellSel {
  r: number;
  c: number;
  r2: number;
  c2: number;
}

export function selRange(t: TableData, s: CellSel): CellRange {
  return expandRange(t, normRange(s.r, s.c, s.r2, s.c2));
}

/** What a key does to a selected table (OnlyOffice "main actions with
 *  shapes", table part): arrows/Tab move the active cell (Shift+arrow
 *  extends the range), Enter edits the active cell with its text selected,
 *  Enter or Backspace/Delete over several cells clears them. */
export type TableKeyResult =
  | { type: "select"; sel: CellSel }
  | { type: "edit"; r: number; c: number; sel: "all" | "start" | "end"; clear?: CellRange }
  | { type: "clear"; range: CellRange }
  | { type: "addRow"; sel: CellSel }
  | null;

export function tableKey(t: TableData, sel: CellSel | null, key: string, shift: boolean): TableKeyResult {
  const cur: CellSel = sel ?? { r: 0, c: 0, r2: 0, c2: 0 };
  const multi = !!sel && (sel.r !== sel.r2 || sel.c !== sel.c2);
  const one = (r: number, c: number): CellSel => ({ r, c, r2: r, c2: c });
  switch (key) {
    case "Enter":
      if (multi) {
        const g = selRange(t, cur);
        return { type: "edit", r: g.r0, c: g.c0, sel: "start", clear: g };
      }
      return { type: "edit", r: cur.r, c: cur.c, sel: "all" };
    case "Backspace":
    case "Delete":
      return sel ? { type: "clear", range: selRange(t, cur) } : null;
    case "Tab": {
      const n = moveCell(t, cur.r2, cur.c2, shift ? "prev" : "next");
      if (n) return { type: "select", sel: one(n[0], n[1]) };
      return shift ? null : { type: "addRow", sel: one(t.rows, 0) };
    }
    case "ArrowLeft":
    case "ArrowRight":
    case "ArrowUp":
    case "ArrowDown": {
      const dir = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const)[key];
      if (!sel) return { type: "select", sel: one(0, 0) };
      const n = moveCell(t, cur.r2, cur.c2, dir);
      if (!n) return { type: "select", sel: cur };
      return { type: "select", sel: shift ? { ...cur, r2: n[0], c2: n[1] } : one(n[0], n[1]) };
    }
  }
  return null;
}
