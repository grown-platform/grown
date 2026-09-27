/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API and cell objects are loosely typed. */

// FortuneSheet glue for the M7 editing tools: fill (drag handle, Ctrl+D/R,
// Fill ▸ Series), sort, paste special, change case and sheet structure
// (insert/delete/move rows, columns and cells). The logic lives in pure
// modules (autofill.ts, sortOps.ts, pasteSpecial.ts, textCase.ts,
// formulaShift.ts); this file reads the grid and writes the results back.
//
// Writes go through batchCallApis so each action is a single undo step and
// reaches collaborators as ordinary ops. Formula cells are written without a
// value so FortuneSheet's engine computes them; the server /recalc round trip
// then corrects anything only the Go engine knows.

import { dropCellCache } from "@fortune-sheet/core";
import {
  autofillRange,
  defaultSeriesSettings,
  fillEdge,
  fillSeries,
  type CellWrite,
  type FillDirection,
  type SeriesSettings,
} from "./autofill";
import type { CellRect } from "./cellRange";
import {
  applyStructureOp,
  structureFormulaEdits,
  structureModelPatches,
  structureTableHeaders,
  translateFormula,
  type StructureOp,
} from "./formulaShift";
import { pasteSpecial, type CopiedBlock, type PasteSpecialOptions } from "./pasteSpecial";
import { patchSheet, setSheetCF, setSheetDV } from "./sheetDataTools";
import { detectHeader, sortBlock, type SortOptions } from "./sortOps";
import { changeCase, changeRunsCase, type TextCase } from "./textCase";

type Wb = any;
type Getter = (r: number, c: number) => any;

// ---- reading ----------------------------------------------------------------------------

/** The active selection as a rectangle (first range when there are several). */
export function selectionRect(wb: Wb): CellRect | null {
  try {
    const s = wb?.getSelection?.();
    const sel = Array.isArray(s) ? s[0] : s;
    if (!sel?.row || !sel?.column) return null;
    return {
      r1: Math.min(sel.row[0], sel.row[1]),
      r2: Math.max(sel.row[0], sel.row[1]),
      c1: Math.min(sel.column[0], sel.column[1]),
      c2: Math.max(sel.column[0], sel.column[1]),
    };
  } catch {
    return null;
  }
}

function sheetGrid(wb: Wb): any[][] {
  const data = wb?.getSheet?.()?.data;
  return Array.isArray(data) ? data : [];
}

/** Reads cells of the current sheet. */
export function cellGetter(wb: Wb): Getter {
  const grid = sheetGrid(wb);
  return (r, c) => grid[r]?.[c] ?? null;
}

// ---- writing ----------------------------------------------------------------------------

/** Prepares a cell for setCellValue: formulas lose their cached value so they are recomputed. */
function writable(cell: any): any {
  if (!cell) return null;
  const out: Record<string, any> = { ...cell };
  delete out.grownSpill;
  if (typeof out.f === "string" && out.f.startsWith("=")) {
    delete out.v;
    delete out.m;
  } else {
    delete out.f;
    // setCellValue treats a missing value as "keep the old one".
    if (out.v === undefined) out.v = null;
  }
  return out;
}

/** Writes cells as one undo step. sheetId targets another sheet (default: the active one). */
export function writeCells(wb: Wb, writes: CellWrite[] | { r: number; c: number; cell: any }[], sheetId?: string): void {
  if (!writes.length) return;
  const opts = sheetId ? { id: sheetId } : {};
  wb.batchCallApis?.(
    writes.map((w) => ({ name: "setCellValue", args: [w.r, w.c, writable(w.cell), null, opts] })),
  );
}

// ---- fill -------------------------------------------------------------------------------

/** Edit ▸ Fill ▸ Down/Right/Up/Left (Ctrl+D, Ctrl+R). */
export function fillSelection(wb: Wb, direction: FillDirection): boolean {
  const sel = selectionRect(wb);
  if (!sel) return false;
  const writes = fillEdge(cellGetter(wb), sel, direction, { translate: translateFormula });
  writeCells(wb, writes);
  return writes.length > 0;
}

export function seriesDefaults(wb: Wb, sel: CellRect): SeriesSettings {
  return defaultSeriesSettings(cellGetter(wb), sel);
}

/** Edit ▸ Fill ▸ Series… */
export function applySeries(wb: Wb, sel: CellRect, settings: SeriesSettings): number {
  const writes = fillSeries(cellGetter(wb), sel, settings, { translate: translateFormula });
  writeCells(wb, writes);
  return writes.length;
}

let lastDrop: unknown = dropCellCache.applyRange;

/**
 * After a fill-handle drag FortuneSheet has already written its own fill;
 * this replaces it with Grown's (weekday/month cycles, even/odd steps, dates,
 * "Item 1" counters, reverse fills). Call it after the mouse is released.
 * Returns true when a drag fill was handled.
 */
export function afterDragFill(wb: Wb): boolean {
  const apply = dropCellCache.applyRange as any;
  if (apply === lastDrop) return false;
  lastDrop = apply;
  const copy = dropCellCache.copyRange as any;
  const dir = dropCellCache.direction as FillDirection | null;
  if (!copy?.row || !dir) return false;
  // FortuneSheet builds applyRange inside an immer draft: the axis it did not
  // change still points at the (now revoked) draft array, so only the moved
  // axis is read from it; the other comes from copyRange (a deep clone).
  const vertical = dir === "down" || dir === "up";
  let moved: [number, number];
  try {
    const a = vertical ? apply.row : apply.column;
    moved = [Number(a[0]), Number(a[1])];
  } catch {
    return false;
  }
  if (!moved.every(Number.isFinite)) return false;
  const src: CellRect = { r1: copy.row[0], r2: copy.row[1], c1: copy.column[0], c2: copy.column[1] };
  const dest: CellRect = vertical
    ? { ...src, r1: Math.min(src.r1, moved[0]), r2: Math.max(src.r2, moved[1]) }
    : { ...src, c1: Math.min(src.c1, moved[0]), c2: Math.max(src.c2, moved[1]) };
  const writes = autofillRange(cellGetter(wb), src, dest, dir, { translate: translateFormula });
  writeCells(wb, writes);
  return true;
}

// ---- sort -------------------------------------------------------------------------------

/** Sorts `range` of the active sheet; returns false when the options select nothing to sort. */
export function sortRangeWith(wb: Wb, range: CellRect, opts: SortOptions): boolean {
  const grid = sheetGrid(wb);
  const res = sortBlock(grid, range, { ...opts, translate: translateFormula });
  if (!res) return false;
  const writes: CellWrite[] = [];
  res.block.forEach((row, i) =>
    row.forEach((cell, j) => {
      const r = range.r1 + i;
      const c = range.c1 + j;
      if (cell !== (grid[r]?.[c] ?? null)) writes.push({ r, c, cell });
    }),
  );
  writeCells(wb, writes);
  return true;
}

export function guessHeader(wb: Wb, range: CellRect, orientation: "rows" | "columns" = "rows"): boolean {
  return detectHeader(sheetGrid(wb), range, orientation);
}

// ---- copy / paste special -----------------------------------------------------------------

let copied: CopiedBlock | null = null;

/** Remembers the selection when the user copies, for Paste special. */
export function rememberCopy(wb: Wb): void {
  const sel = selectionRect(wb);
  if (!sel) return;
  const grid = sheetGrid(wb);
  const cells: any[][] = [];
  for (let r = sel.r1; r <= sel.r2; r++) {
    const row: any[] = [];
    for (let c = sel.c1; c <= sel.c2; c++) {
      const cell = grid[r]?.[c];
      row.push(cell ? JSON.parse(JSON.stringify(cell)) : null);
    }
    cells.push(row);
  }
  copied = { cells, r: sel.r1, c: sel.c1 };
}

export function hasCopy(): boolean {
  return copied !== null;
}

/** Pastes the remembered block at the selection's top-left corner. */
export function pasteSpecialHere(wb: Wb, opts: Omit<PasteSpecialOptions, "translate">): boolean {
  const sel = selectionRect(wb);
  if (!sel || !copied) return false;
  const target = { rows: sel.r2 - sel.r1 + 1, cols: sel.c2 - sel.c1 + 1 };
  const full = { ...opts, target, translate: translateFormula };
  const writes = pasteSpecial(copied, sel.r1, sel.c1, cellGetter(wb), full);
  writeCells(wb, writes);
  // The selection is left alone: FortuneSheet's setSelection normalises the
  // range objects in place, and React may replay the update on frozen state.
  return true;
}

// ---- change case ------------------------------------------------------------------------

/** Format ▸ Text ▸ change case on the selected text cells (formulas and numbers are left alone). */
export function changeSelectionCase(wb: Wb, mode: TextCase): void {
  const sel = selectionRect(wb);
  if (!sel) return;
  const get = cellGetter(wb);
  const writes: CellWrite[] = [];
  for (let r = sel.r1; r <= sel.r2; r++) {
    for (let c = sel.c1; c <= sel.c2; c++) {
      const cell = get(r, c);
      if (!cell || cell.f) continue;
      if (cell.ct?.t === "inlineStr" && Array.isArray(cell.ct.s)) {
        const s = changeRunsCase(cell.ct.s, mode);
        writes.push({ r, c, cell: { ...cell, ct: { ...cell.ct, s }, v: undefined } });
        continue;
      }
      if (typeof cell.v !== "string") continue;
      const v = changeCase(cell.v, mode);
      if (v !== cell.v) writes.push({ r, c, cell: { ...cell, v, m: changeCase(String(cell.m ?? cell.v), mode) } });
    }
  }
  // Rich text keeps its runs; FortuneSheet reads them from ct.s.
  writeCells(
    wb,
    writes.map((w) => (w.cell?.ct?.t === "inlineStr" ? { ...w, cell: { ...w.cell, v: w.cell.ct.s.map((x: any) => x.v).join("") } } : w)),
  );
}

// ---- structure --------------------------------------------------------------------------

function sheetsSnapshot(wb: Wb): any[] {
  return (wb?.getAllSheets?.() ?? []) as any[];
}

/**
 * After FortuneSheet has inserted or deleted rows/columns itself (it moves
 * cells, merges and sizes, but only shifts formulas it has in its calc chain,
 * and does so on every sheet regardless of the sheet a reference names), put
 * every formula, named range and Grown rule model where it belongs.
 */
export function fixUpAfterStructure(wb: Wb, before: any[], op: StructureOp): void {
  let edits: ReturnType<typeof structureFormulaEdits> = [];
  let patches: ReturnType<typeof structureModelPatches> = [];
  try {
    // Every formula is rewritten from its pre-op text: FortuneSheet may have
    // shifted some of them (wrongly, on other sheets) and not others.
    edits = structureFormulaEdits(before, op, { includeUnchanged: true });
    patches = structureModelPatches(before, op);
  } catch {
    return;
  }
  // Queued after FortuneSheet's own update, so the positions are post-op ones.
  // The cached value is kept: the formula text changed, not what it computes
  // (a #REF! result arrives with the next recalc).
  const calls: { name: string; args: any[] }[] = edits.map((e) => {
    const { v, m, ct } = e.cell ?? {};
    return { name: "setCellValue", args: [e.r, e.c, { f: e.f, v: v ?? "", m: m ?? "", ct }, null, { id: e.sheetId }] };
  });
  // Table columns the op inserted get their ColumnN header.
  try {
    for (const h of structureTableHeaders(before, op)) {
      calls.push({ name: "setCellValue", args: [h.r, h.c, { v: h.name, m: h.name, ct: { fa: "@", t: "s" } }, null, { id: h.sheetId }] });
    }
  } catch {
    /* the model still names the column */
  }
  if (calls.length) wb.batchCallApis?.(calls);
  for (const p of patches) {
    // CF and validation also refresh FortuneSheet's derived per-cell fields.
    const { grownCF, grownDV, ...rest } = p.fields as Record<string, any>;
    if (grownCF !== undefined) setSheetCF(wb, p.sheetId, grownCF);
    if (grownDV !== undefined) setSheetDV(wb, p.sheetId, grownDV);
    if (Object.keys(rest).length) patchSheet(wb, p.sheetId, rest);
  }
}

function sheetName(wb: Wb, id?: string): string {
  const all = sheetsSnapshot(wb);
  const sheet = id ? all.find((s) => s?.id === id) : wb?.getSheet?.();
  return String(sheet?.name ?? "");
}

/** Insert ▸ rows/columns: FortuneSheet moves the grid, Grown fixes references. */
export function insertRowsCols(wb: Wb, axis: "row" | "col", index: number, count: number, where: "before" | "after"): void {
  const before = sheetsSnapshot(wb);
  const sheet = sheetName(wb);
  wb.insertRowOrColumn(axis === "row" ? "row" : "column", index, count, where === "before" ? "lefttop" : "rightbottom");
  fixUpAfterStructure(wb, before, { kind: "insert", axis, sheet, index: where === "before" ? index : index + 1, count });
}

/** Edit ▸ Delete rows/columns. */
export function deleteRowsCols(wb: Wb, axis: "row" | "col", start: number, end: number): void {
  const before = sheetsSnapshot(wb);
  const sheet = sheetName(wb);
  wb.deleteRowOrColumn(axis === "row" ? "row" : "column", start, end);
  fixUpAfterStructure(wb, before, { kind: "delete", axis, sheet, index: start, count: end - start + 1 });
}

/**
 * The structure op a FortuneSheet op list describes (its own row/column
 * header menus emit insertRowCol/deleteRowCol), or null.
 */
export function structureOpFromOps(ops: any[], sheets: any[]): StructureOp | null {
  for (const o of ops ?? []) {
    const v = o?.value;
    if (!v || (o.op !== "insertRowCol" && o.op !== "deleteRowCol")) continue;
    const sheet = String(sheets.find((s) => s?.id === (v.id ?? o.id))?.name ?? "");
    const axis = v.type === "row" ? "row" : "col";
    if (o.op === "insertRowCol") {
      const index = v.direction === "lefttop" ? v.index : v.index + 1;
      return { kind: "insert", axis, sheet, index, count: v.count };
    }
    return { kind: "delete", axis, sheet, index: v.start, count: v.end - v.start + 1 };
  }
  return null;
}

/**
 * Structure ops FortuneSheet has no API for (move rows/columns, insert or
 * delete cells with a shift) rewrite the affected sheets in one update.
 */
export function applyWholeSheetOp(wb: Wb, op: StructureOp): boolean {
  const before = sheetsSnapshot(wb);
  let next: any[];
  try {
    next = applyStructureOp(JSON.parse(JSON.stringify(before)), op);
  } catch {
    return false;
  }
  const changed = next.filter((s, i) => JSON.stringify(s) !== JSON.stringify(before[i]));
  if (!changed.length) return false;
  wb.updateSheet?.(JSON.parse(JSON.stringify(changed)));
  return true;
}

/** Edit ▸ Move ▸ row up/down, column left/right for the selected rows/columns. */
export function moveSelection(wb: Wb, axis: "row" | "col", delta: -1 | 1): boolean {
  const sel = selectionRect(wb);
  if (!sel) return false;
  const [a, b] = axis === "row" ? [sel.r1, sel.r2] : [sel.c1, sel.c2];
  if (delta < 0 && a === 0) return false;
  const count = b - a + 1;
  // Moving down by one = moving the block to start two past its end (pre-move coordinates).
  const to = delta < 0 ? a - 1 : b + 2;
  const ok = applyWholeSheetOp(wb, { kind: "move", axis, sheet: sheetName(wb), index: a, count, to });
  return ok;
}

/** Insert ▸ Cells (shift right / down) and Edit ▸ Delete cells (shift up / left) on the selection. */
export function shiftCells(wb: Wb, shift: "down" | "right" | "up" | "left"): boolean {
  const rect = selectionRect(wb);
  if (!rect) return false;
  const sheet = sheetName(wb);
  const op: StructureOp =
    shift === "down" || shift === "right"
      ? { kind: "insertCells", sheet, rect, shift }
      : { kind: "deleteCells", sheet, rect, shift };
  return applyWholeSheetOp(wb, op);
}
