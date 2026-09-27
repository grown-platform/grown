/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet models are loosely typed. */

// Load-time normalisation of a FortuneSheet workbook before it reaches the
// <Workbook> component. Workbooks don't only come from FortuneSheet itself:
// the JSON API, imports and the server-side formula engine all write cells,
// and FortuneSheet's canvas paints a cell's display text `m`, never its raw
// value `v`. A numeric cell saved as `{v: 10}` with no `m` therefore renders
// blank. Filling `m` here, on the one path every workbook takes into the grid,
// covers API saves, imports and anything already stored.
//
// It also seeds each sheet's selection: when a sheet has no saved
// `luckysheet_select_save`, FortuneSheet 1.0.4 selects `{row: [0], column:
// [0]}` (no end index), which the name box renders as "A1:NaN".

import { formatValue } from "./numberFormat";

/** Display text for a raw value under number format `fa` (numberFormat.ts). */
function displayText(v: unknown, fa: string | undefined): string {
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") {
    try {
      return formatValue(v, fa || "General");
    } catch {
      return String(v);
    }
  }
  if (typeof v === "string" && fa && fa !== "General" && fa !== "@") {
    try {
      return formatValue(v, fa);
    } catch {
      return v;
    }
  }
  return String(v);
}

/**
 * Fill a cell's missing display text `m` from its value `v`, formatted with
 * the cell's number format (`ct.fa`). Numeric cells without a `ct` get the
 * General number type FortuneSheet itself assigns to typed-in numbers, so
 * they right-align like any other number. Numbers with a custom format get
 * `m` rewritten from numberFormat.ts. Returns the cell (mutated) for
 * convenience; non-cells and other cells that already have `m` are left alone.
 */
export function fillCellDisplay(cell: any): any {
  if (cell == null || typeof cell !== "object") return cell;
  const v = cell.v;
  if (v == null || typeof v === "object") return cell; // empty or rich text
  const fa = cell.ct?.fa;
  // A stored `m` is kept, except for numbers under a custom format: those are
  // re-rendered so every workbook shows the same text (FortuneSheet's own
  // formatter lacks accounting padding, elapsed time, fractions, conditions…).
  const custom = typeof v === "number" && fa && fa !== "General" && fa !== "@";
  if (cell.m != null && !custom) return cell;
  if (typeof v === "number" && cell.ct == null) {
    cell.ct = { fa: "General", t: "n" };
  }
  cell.m = displayText(v, cell.ct?.fa);
  return cell;
}

const isIndex = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0;

/** Complete a [start, end] pair: a missing/invalid end collapses onto start. */
function span(pair: unknown): [number, number] | null {
  if (!Array.isArray(pair) || !isIndex(pair[0])) return null;
  return [pair[0], isIndex(pair[1]) ? pair[1] : pair[0]];
}

/** A1's merge extent, when A1 is the top-left of a merged block. */
function a1Merge(sheet: any): { rs: number; cs: number } | null {
  const fromData = sheet.data?.[0]?.[0]?.mc;
  const fromCells = Array.isArray(sheet.celldata)
    ? sheet.celldata.find((cd: any) => cd?.r === 0 && cd?.c === 0)?.v?.mc
    : undefined;
  const mc = fromData ?? fromCells;
  return mc && isIndex(mc.rs) && isIndex(mc.cs) && mc.rs > 0 && mc.cs > 0
    ? { rs: mc.rs, cs: mc.cs }
    : null;
}

/**
 * Give a sheet a complete saved selection. A missing or empty
 * `luckysheet_select_save` becomes A1 (or A1's merged block); saved ranges
 * missing an end index or focus cell get them filled in, and unusable ones
 * are dropped.
 * Mutates and returns the sheet.
 */
export function seedSelection(sheet: any): any {
  if (sheet == null || typeof sheet !== "object") return sheet;
  const saved = Array.isArray(sheet.luckysheet_select_save)
    ? sheet.luckysheet_select_save
    : [];
  const fixed = saved.flatMap((sel: any) => {
    const row = span(sel?.row);
    const column = span(sel?.column);
    if (!row || !column) return [];
    // The name box stays blank without a focus cell; default to the range's
    // top-left, as FortuneSheet does when it normalises a selection.
    return [
      {
        ...sel,
        row,
        column,
        row_focus: isIndex(sel.row_focus) ? sel.row_focus : row[0],
        column_focus: isIndex(sel.column_focus) ? sel.column_focus : column[0],
      },
    ];
  });
  if (fixed.length === 0) {
    const mc = a1Merge(sheet);
    fixed.push({
      row: [0, mc ? mc.rs - 1 : 0],
      column: [0, mc ? mc.cs - 1 : 0],
      row_focus: 0,
      column_focus: 0,
    });
  }
  sheet.luckysheet_select_save = fixed;
  return sheet;
}

/** Normalise every sheet of a workbook in place and return it. */
export function normalizeWorkbook(sheets: any): any {
  if (!Array.isArray(sheets)) return sheets;
  for (const sheet of sheets) {
    if (sheet == null || typeof sheet !== "object") continue;
    seedSelection(sheet);
    if (Array.isArray(sheet.celldata)) {
      for (const cd of sheet.celldata) fillCellDisplay(cd?.v);
    }
    if (Array.isArray(sheet.data)) {
      for (const row of sheet.data) {
        if (Array.isArray(row)) for (const cell of row) fillCellDisplay(cell);
      }
    }
  }
  return sheets;
}
