/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet cells are loosely typed. */

// Default horizontal alignment by value type, as Excel and Google Sheets do:
// numbers and dates right, booleans and errors centred, text left. A cell's
// own `ht` (0 centre, 1 left, 2 right) always wins.
//
// FortuneSheet 1.0.4 treats a missing `ht` as left for every cell, so numbers
// rendered left-aligned. The default is applied at render time and never
// written into the cell: vite.config.ts patches FortuneSheet's
// `normalizedCellAttr` (the one place it resolves `ht` for painting and
// overflow) to ask `defaultHorizontalAlign` below, which is registered on
// globalThis when this module loads. Saved workbooks and the xlsx export
// therefore keep "no alignment" for cells that had none.

export type HAlign = "0" | "1" | "2";

const ERRORS = new Set([
  "#NULL!",
  "#DIV/0!",
  "#VALUE!",
  "#REF!",
  "#NAME?",
  "#NUM!",
  "#N/A",
  "#GETTING_DATA",
  "#SPILL!",
  "#CALC!",
]);

/** The cell's explicit alignment, or null when it has none. */
export function explicitHorizontalAlign(cell: any): HAlign | null {
  const ht = cell?.ht;
  if (ht === undefined || ht === null || ht === "") return null;
  const s = String(ht);
  return s === "0" || s === "1" || s === "2" ? s : null;
}

/** Alignment a cell without an explicit `ht` gets from its value type. */
export function defaultHorizontalAlign(cell: any): HAlign {
  if (cell == null || typeof cell !== "object") return "1";
  const v = cell.v;
  if (v == null || v === "" || typeof v === "object") return "1"; // empty or rich text
  const t = cell.ct?.t;
  const fa = cell.ct?.fa;
  // Text-formatted cells (a leading apostrophe, the "@" format) stay left,
  // numbers included, as a number stored as text does in Excel.
  if (t === "s" || t === "inlineStr" || fa === "@") return "1";
  if (typeof v === "boolean" || t === "b") return "0";
  // The server's formula engine stores a logical result as 1/0 shown "TRUE"/"FALSE".
  if ((v === 1 || v === 0) && (cell.m === "TRUE" || cell.m === "FALSE")) return "0";
  if (typeof v === "string" && (t === "e" || ERRORS.has(v.trim().toUpperCase()))) return "0";
  if (typeof v === "number") return Number.isFinite(v) ? "2" : "0";
  if ((t === "n" || t === "d") && typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return "2";
  if (t === "d") return "2";
  return "1";
}

/** The alignment a cell is painted with: its own `ht`, else the type default. */
export function effectiveHorizontalAlign(cell: any): HAlign {
  return explicitHorizontalAlign(cell) ?? defaultHorizontalAlign(cell);
}

/** CSS text-align for an alignment code. */
export function cssAlign(ht: HAlign): "center" | "left" | "right" {
  return ht === "0" ? "center" : ht === "2" ? "right" : "left";
}

// Consumed by the patched FortuneSheet core (see vite.config.ts).
(globalThis as any).__grownDefaultHt = defaultHorizontalAlign;
