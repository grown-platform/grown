/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet models are loosely typed. */

// Load-time normalisation of a FortuneSheet workbook before it reaches the
// <Workbook> component. Workbooks don't only come from FortuneSheet itself:
// the JSON API, imports and the server-side formula engine all write cells,
// and FortuneSheet's canvas paints a cell's display text `m`, never its raw
// value `v`. A numeric cell saved as `{v: 10}` with no `m` therefore renders
// blank. Filling `m` here, on the one path every workbook takes into the grid,
// covers API saves, imports and anything already stored.

import { update as formatValue } from "@fortune-sheet/core";

/** Display text for a raw value under number format `fa` (FortuneSheet's own formatter). */
function displayText(v: unknown, fa: string | undefined): string {
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") {
    try {
      const m = formatValue(fa || "General", v);
      if (m != null && m !== "") return String(m);
    } catch {
      /* fall through to the plain rendering */
    }
    return String(v);
  }
  return String(v);
}

/**
 * Fill a cell's missing display text `m` from its value `v`, formatted with
 * the cell's number format (`ct.fa`). Numeric cells without a `ct` get the
 * General number type FortuneSheet itself assigns to typed-in numbers, so
 * they right-align like any other number. Returns the cell (mutated) for
 * convenience; non-cells and cells that already have `m` are left alone.
 */
export function fillCellDisplay(cell: any): any {
  if (cell == null || typeof cell !== "object") return cell;
  const v = cell.v;
  if (v == null || typeof v === "object") return cell; // empty or rich text
  if (cell.m != null) return cell;
  if (typeof v === "number" && cell.ct == null) {
    cell.ct = { fa: "General", t: "n" };
  }
  cell.m = displayText(v, cell.ct?.fa);
  return cell;
}

/** Normalise every sheet of a workbook in place and return it. */
export function normalizeWorkbook(sheets: any): any {
  if (!Array.isArray(sheets)) return sheets;
  for (const sheet of sheets) {
    if (sheet == null || typeof sheet !== "object") continue;
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
