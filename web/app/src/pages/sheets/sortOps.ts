/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet cell model is loosely typed. */

// Multi-key range sort (Data → Sort range). Pure and framework-free: it reads
// FortuneSheet cell objects ({ v, m, f, ct, bg, fc, … } | null) and returns the
// reordered block plus the permutation, leaving the write-back to the caller.
//
// Ordering follows Excel: numbers (dates included) < text < booleans < errors,
// and blank cells always sink to the end whichever direction is chosen. Text is
// compared with a Unicode collator (accent-aware, case-blind unless asked), and
// every sort is stable so equal keys keep their original relative order.

import { cellScalar, normColor, parseA1Range, type Scalar } from "./cellValue";
import type { CellRect } from "./cellRange";

export type SortCell = Record<string, any> | null;

export interface SortKey {
  /** Absolute column index (orientation "rows") or absolute row index (orientation "columns") on the sheet. */
  index: number;
  ascending: boolean;
  /** Sort on values (default), cell fill colour (bg) or font colour (fc); colour keys put `color` first, keep the rest in order. */
  by?: "value" | "fill" | "font";
  color?: string;
}

export interface SortOptions {
  keys: SortKey[];
  /** First row (or column) is a header and stays put. */
  header?: boolean;
  caseSensitive?: boolean;
  /** "rows" (default): reorder rows top-to-bottom; "columns": reorder columns left-to-right (sort by row). */
  orientation?: "rows" | "columns";
  /** Translates a formula moved by (dr, dc); default identity. */
  translate?: (formula: string, dr: number, dc: number) => string;
}

export interface SortResult {
  block: SortCell[][];
  /** New offset i (within the range, along the sort axis) came from old offset order[i]. */
  order: number[];
}

// ---- value comparison -------------------------------------------------------

/** Rank of a value class in ascending order; blanks are handled separately. */
function typeRank(v: Scalar): number {
  if (typeof v === "number") return 0;
  if (typeof v === "string") return 1;
  if (typeof v === "boolean") return 2;
  return 3; // error
}

const collators = new Map<boolean, Intl.Collator>();
function collator(caseSensitive: boolean): Intl.Collator {
  let c = collators.get(caseSensitive);
  if (!c) {
    c = caseSensitive
      ? new Intl.Collator("en", { sensitivity: "variant", caseFirst: "lower" })
      : new Intl.Collator("en", { sensitivity: "accent" });
    collators.set(caseSensitive, c);
  }
  return c;
}

/**
 * Compares two non-blank values in ascending Excel order. Errors all rank equal;
 * FALSE comes before TRUE.
 */
export function compareSortValues(a: Scalar, b: Scalar, caseSensitive = false): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "string" && typeof b === "string") return collator(caseSensitive).compare(a, b);
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return 0;
}

/** The comparable value of a cell for sorting (null = blank). */
export function sortValue(cell: SortCell | undefined): Scalar {
  return cellScalar(cell ?? null);
}

function cellColor(cell: SortCell | undefined, by: "fill" | "font"): string | null {
  if (!cell || typeof cell !== "object") return null;
  return normColor(by === "fill" ? cell.bg : cell.fc);
}

// ---- core sort --------------------------------------------------------------

function cellAt(grid: SortCell[][], r: number, c: number): SortCell {
  return grid[r]?.[c] ?? null;
}

/**
 * Sorts the block `range` of `grid`. Stable. Returns null (nothing to do) when
 * there are no keys, a key lies outside the range, or fewer than two lines
 * remain once the header is set aside. The returned block has the range's size.
 */
export function sortBlock(grid: SortCell[][], range: CellRect, opts: SortOptions): SortResult | null {
  const { r1, c1, r2, c2 } = range;
  if (r2 < r1 || c2 < c1 || r1 < 0 || c1 < 0) return null;
  const byRows = (opts.orientation ?? "rows") === "rows";
  const keys = opts.keys ?? [];
  if (keys.length === 0) return null;
  const [kLo, kHi] = byRows ? [c1, c2] : [r1, r2];
  if (keys.some((k) => !Number.isInteger(k.index) || k.index < kLo || k.index > kHi)) return null;

  const lines = byRows ? r2 - r1 + 1 : c2 - c1 + 1;
  const start = opts.header ? 1 : 0;
  if (lines - start < 2) return null;

  const at = (line: number, keyIndex: number): SortCell =>
    byRows ? cellAt(grid, r1 + line, keyIndex) : cellAt(grid, keyIndex, c1 + line);

  // Precompute per-line key material.
  type Material = { blank: boolean; value: Scalar } | { match: boolean };
  const mats: Material[][] = [];
  for (let line = start; line < lines; line++) {
    mats[line] = keys.map((k) => {
      const cell = at(line, k.index);
      if (k.by === "fill" || k.by === "font") {
        const want = normColor(k.color);
        return { match: cellColor(cell, k.by) === want };
      }
      const value = sortValue(cell);
      return { blank: value === null, value };
    });
  }

  const cs = !!opts.caseSensitive;
  const idx: number[] = [];
  for (let line = start; line < lines; line++) idx.push(line);
  idx.sort((a, b) => {
    for (let k = 0; k < keys.length; k++) {
      const ma = mats[a][k];
      const mb = mats[b][k];
      const dir = keys[k].ascending ? 1 : -1;
      if ("match" in ma && "match" in mb) {
        if (ma.match !== mb.match) return (ma.match ? -1 : 1) * dir;
        continue;
      }
      const va = ma as { blank: boolean; value: Scalar };
      const vb = mb as { blank: boolean; value: Scalar };
      if (va.blank || vb.blank) {
        if (va.blank && vb.blank) continue;
        return va.blank ? 1 : -1; // blanks last in both directions
      }
      const c = compareSortValues(va.value, vb.value, cs);
      if (c !== 0) return c * dir;
    }
    return a - b;
  });
  const order = start ? [0, ...idx] : idx;

  const translate = opts.translate;
  const move = (cell: SortCell, shift: number): SortCell => {
    if (!cell || shift === 0 || !translate || typeof cell.f !== "string" || !cell.f) return cell;
    const f = byRows ? translate(cell.f, shift, 0) : translate(cell.f, 0, shift);
    return f === cell.f ? cell : { ...cell, f };
  };

  const h = r2 - r1 + 1;
  const w = c2 - c1 + 1;
  const block: SortCell[][] = [];
  for (let r = 0; r < h; r++) {
    const row: SortCell[] = [];
    for (let c = 0; c < w; c++) {
      if (byRows) {
        const from = order[r];
        row.push(move(cellAt(grid, r1 + from, c1 + c), r - from));
      } else {
        const from = order[c];
        row.push(move(cellAt(grid, r1 + r, c1 + from), c - from));
      }
    }
    block.push(row);
  }
  return { block, order };
}

/** Returns a copy of `grid` with `block` written at the range's top-left corner. */
export function writeBlock(grid: SortCell[][], range: CellRect, block: SortCell[][]): SortCell[][] {
  const out = grid.map((row) => (row ? [...row] : row));
  for (let r = 0; r < block.length; r++) {
    const rr = range.r1 + r;
    if (!out[rr]) out[rr] = [];
    for (let c = 0; c < block[r].length; c++) out[rr][range.c1 + c] = block[r][c];
  }
  return out;
}

/** sortBlock + writeBlock; returns the original grid untouched when nothing sorts. */
export function sortGrid(grid: SortCell[][], range: CellRect, opts: SortOptions): SortCell[][] {
  const res = sortBlock(grid, range, opts);
  return res ? writeBlock(grid, range, res.block) : grid;
}

// ---- header detection -------------------------------------------------------

function styleSig(cell: SortCell): string {
  if (!cell || typeof cell !== "object") return "";
  return [cell.bl ? 1 : 0, cell.it ? 1 : 0, cell.un ? 1 : 0, normColor(cell.bg) ?? "", normColor(cell.fc) ?? ""].join("|");
}

/**
 * Guesses whether the first row of `range` is a header, the way Excel does: the
 * first row must hold only text, and some column has a non-text value right
 * below it, or the first row is styled differently from the second (bold,
 * italic, underline, fill or font colour).
 */
export function detectHeader(grid: SortCell[][], range: CellRect, orientation: "rows" | "columns" = "rows"): boolean {
  const byRows = orientation === "rows";
  const lines = byRows ? range.r2 - range.r1 + 1 : range.c2 - range.c1 + 1;
  if (lines < 2) return false;
  const [lo, hi] = byRows ? [range.c1, range.c2] : [range.r1, range.r2];
  const at = (line: number, i: number): SortCell =>
    byRows ? cellAt(grid, range.r1 + line, i) : cellAt(grid, i, range.c1 + line);
  let anyText = false;
  for (let i = lo; i <= hi; i++) {
    const v = sortValue(at(0, i));
    if (v === null) continue;
    if (typeof v !== "string") return false;
    anyText = true;
  }
  if (!anyText) return false;
  for (let i = lo; i <= hi; i++) {
    const top = sortValue(at(0, i));
    const below = sortValue(at(1, i));
    if (top !== null && below !== null && typeof below !== "string") return true;
  }
  for (let i = lo; i <= hi; i++) {
    const a = at(0, i);
    if (sortValue(a) === null) continue;
    if (styleSig(a) !== styleSig(at(1, i))) return true;
  }
  return false;
}

// ---- spreadsheet-API style SetSort ------------------------------------------

/** Excel's XlSortOrientation: xlSortColumns sorts by a column (rows move), xlSortRows by a row (columns move). */
export type XlSortOrientation = "xlSortColumns" | "xlSortRows";
export type XlSortOrder = "xlAscending" | "xlDescending";
export type XlYesNoGuess = "xlYes" | "xlNo" | "xlGuess";

/** Maps the API orientation constant to sortBlock's orientation. */
export function apiOrientation(o: XlSortOrientation | null | undefined): "rows" | "columns" {
  return o === "xlSortRows" ? "columns" : "rows";
}

/**
 * Resolves a SetSort key — a cell/range address ("B1", "$C$1:$C$9") or a
 * defined name looked up in `names` — to the absolute column (orientation
 * "rows") or row (orientation "columns") it designates: the first
 * column/row of the resolved range. null when the key cannot be resolved.
 */
export function resolveSortKey(
  key: string | null | undefined,
  orientation: "rows" | "columns",
  names: Record<string, string> = {},
): number | null {
  if (key == null) return null;
  const trimmed = String(key).trim();
  if (!trimmed) return null;
  const nameHit = Object.keys(names).find((n) => n.toLowerCase() === trimmed.toLowerCase());
  const rect = parseA1Range(nameHit ? names[nameHit] : trimmed);
  if (!rect) return null;
  return orientation === "rows" ? rect.c1 : rect.r1;
}

export interface ApiSortCall {
  /** A1 address of the range to sort. */
  range: string;
  key1?: string | null;
  order1?: XlSortOrder | null;
  key2?: string | null;
  order2?: XlSortOrder | null;
  key3?: string | null;
  order3?: XlSortOrder | null;
  header?: XlYesNoGuess | null;
  orientation?: XlSortOrientation | null;
  caseSensitive?: boolean;
}

export interface ApiSortPlan {
  range: CellRect;
  opts: SortOptions;
}

/**
 * Turns SetSort-style arguments into sortBlock input. Null keys are skipped
 * (so key1 + key3 is a valid two-key sort); a key that names nothing, or a
 * range that does not parse, makes the call a no-op (null).
 */
export function planApiSort(grid: SortCell[][], call: ApiSortCall, names: Record<string, string> = {}): ApiSortPlan | null {
  const rect = parseA1Range(names[call.range] ?? call.range);
  if (!rect) return null;
  const range: CellRect = { c1: rect.c1, r1: rect.r1, c2: rect.c2, r2: rect.r2 };
  const orientation = apiOrientation(call.orientation);
  const keys: SortKey[] = [];
  const pairs: [string | null | undefined, XlSortOrder | null | undefined][] = [
    [call.key1, call.order1],
    [call.key2, call.order2],
    [call.key3, call.order3],
  ];
  for (const [k, o] of pairs) {
    if (k == null) continue;
    const index = resolveSortKey(k, orientation, names);
    if (index == null) return null;
    keys.push({ index, ascending: o !== "xlDescending" });
  }
  if (keys.length === 0) return null;
  const header =
    call.header === "xlYes" ? true : call.header === "xlGuess" ? detectHeader(grid, range, orientation) : false;
  return { range, opts: { keys, header, orientation, caseSensitive: !!call.caseSensitive } };
}

/** Applies a SetSort-style call to `grid`; returns the same grid when it is a no-op. */
export function apiSetSort(grid: SortCell[][], call: ApiSortCall, names: Record<string, string> = {}): SortCell[][] {
  const plan = planApiSort(grid, call, names);
  return plan ? sortGrid(grid, plan.range, plan.opts) : grid;
}
