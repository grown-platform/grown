// Row/column commands behind the keyboard shortcuts (sheetShortcuts.ts):
// insert / delete / hide / unhide rows or columns and select whole rows or
// columns, from the current selection.
import { deleteRowsCols, insertRowsCols } from "./editActions";
import { selectionRanges } from "./numberFormatActions";
import { currentSheet } from "./sheetDataTools";

type Wb = any;
export type Axis = "row" | "col";

export interface Span {
  axis: Axis;
  start: number;
  end: number;
}

export interface SelRange {
  row: number[];
  column: number[];
}

/** The sheet's grid size (at least FortuneSheet's default 100 x 26). */
export function sheetSize(sheet: any): { rows: number; cols: number } {
  const data: any[][] = Array.isArray(sheet?.data) ? sheet.data : [];
  return {
    rows: Math.max(data.length, Number(sheet?.row) || 0, 1),
    cols: Math.max(data[0]?.length ?? 0, Number(sheet?.column) || 0, 1),
  };
}

/** structureTarget: what insert/delete act on. Whole columns selected (every
 *  row) -> those columns; otherwise the selected rows, as in Google Sheets
 *  and Excel with entire rows selected. */
export function structureTarget(sel: SelRange, rows: number): Span {
  const [r1, r2] = [Math.min(sel.row[0], sel.row[1]), Math.max(sel.row[0], sel.row[1])];
  const [c1, c2] = [Math.min(sel.column[0], sel.column[1]), Math.max(sel.column[0], sel.column[1])];
  if (r1 === 0 && r2 >= rows - 1) return { axis: "col", start: c1, end: c2 };
  return { axis: "row", start: r1, end: r2 };
}

/** The row or column indices a selection covers (for hide / unhide). */
export function spanIndices(sel: SelRange, axis: Axis): string[] {
  const [a, b] = axis === "row" ? sel.row : sel.column;
  const out: string[] = [];
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(String(i));
  return out;
}

/** The selection widened to whole rows or whole columns. */
export function wholeSpan(sel: SelRange, axis: Axis, size: { rows: number; cols: number }): SelRange {
  return axis === "row"
    ? { row: [...sel.row], column: [0, size.cols - 1] }
    : { row: [0, size.rows - 1], column: [...sel.column] };
}

function firstSel(wb: Wb): SelRange | null {
  const s = selectionRanges(wb);
  return s.length ? s[s.length - 1] : null;
}

/** Inserts as many rows (or columns) as are selected, above (left of) them. */
export function insertAtSelection(wb: Wb): void {
  const sel = firstSel(wb);
  if (!sel) return;
  const t = structureTarget(sel, sheetSize(currentSheet(wb)).rows);
  insertRowsCols(wb, t.axis, t.start, t.end - t.start + 1, "before");
}

/** Deletes the selected rows (or whole columns). */
export function deleteAtSelection(wb: Wb): void {
  const sel = firstSel(wb);
  if (!sel) return;
  const t = structureTarget(sel, sheetSize(currentSheet(wb)).rows);
  deleteRowsCols(wb, t.axis, t.start, t.end);
}

/** Hides (or shows) the selected rows or columns. */
export function setHidden(wb: Wb, axis: Axis, hidden: boolean): void {
  const type = axis === "row" ? "row" : "column";
  for (const sel of selectionRanges(wb)) {
    const idx = spanIndices(sel, axis);
    if (hidden) wb.hideRowOrColumn(idx, type);
    else wb.showRowOrColumn(idx, type);
  }
}

/** Selects the whole rows (Shift+Space) or columns (Ctrl+Space) of the selection. */
export function selectWhole(wb: Wb, axis: Axis): void {
  const sel = firstSel(wb);
  if (!sel) return;
  wb.setSelection([wholeSpan(sel, axis, sheetSize(currentSheet(wb)))]);
}
