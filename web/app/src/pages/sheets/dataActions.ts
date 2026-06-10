/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */
import {
  sortGridRows,
  shuffleGridRows,
  splitDelimited,
  detectDelimiter,
  cellText,
  type Cell,
  type CellGrid,
} from "./sheetOps";

// FortuneSheet glue for the Data menu. These functions take the Workbook ref
// (the `getWb()` result) and mutate the sheet via the documented public API
// (getSelection / getSheet / setCellValuesByRange / updateSheet). Keeping the
// glue thin here lets sheetOps.ts stay pure and unit-tested.

type Wb = any;

interface Sel {
  row: [number, number];
  column: [number, number];
}

function selection(wb: Wb): Sel | null {
  const s = wb?.getSelection?.();
  const sel = Array.isArray(s) ? s[0] : s;
  if (!sel) return null;
  return {
    row: [sel.row[0], sel.row[1]],
    column: [sel.column[0], sel.column[1]],
  };
}

function fullGrid(wb: Wb): CellGrid {
  const sheet = wb?.getSheet?.();
  const grid = sheet?.data;
  if (Array.isArray(grid)) return grid as CellGrid;
  return [];
}

/** Extent of the used data on the current sheet: [maxRow, maxCol] inclusive. */
function usedExtent(grid: CellGrid): { rows: number; cols: number } {
  let rows = 0,
    cols = 0;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (cellText(row[c]) !== "") {
        rows = Math.max(rows, r);
        cols = Math.max(cols, c);
      }
    }
  }
  return { rows, cols };
}

function writeRange(wb: Wb, rows: CellGrid, r0: number, c0: number) {
  // setCellValuesByRange requires data dims to match the range exactly.
  const r1 = r0 + rows.length - 1;
  const width = rows[0]?.length ?? 0;
  const c1 = c0 + width - 1;
  if (width === 0) return;
  // Normalise: each cell is written as its object (preserves formatting) or null.
  const data = rows.map((row) => row.map((cell) => cell ?? null));
  wb.setCellValuesByRange?.(data, { row: [r0, r1], column: [c0, c1] });
}

export type SortError = "no-selection" | "single-cell" | null;

/**
 * Sort the currently selected range by its first column (or `byCol` offset within
 * the range). Returns null on success or an error code the caller can surface.
 */
export function sortRange(wb: Wb, asc: boolean, byCol = 0): SortError {
  const sel = selection(wb);
  if (!sel) return "no-selection";
  const [r0, r1] = sel.row;
  const [c0, c1] = sel.column;
  if (r0 === r1 && c0 === c1) return "single-cell";
  const grid = fullGrid(wb);
  const block: CellGrid = [];
  for (let r = r0; r <= r1; r++) {
    const row: Cell[] = [];
    for (let c = c0; c <= c1; c++) row.push(grid[r]?.[c] ?? null);
    block.push(row);
  }
  const sorted = sortGridRows(block, byCol, asc);
  writeRange(wb, sorted, r0, c0);
  return null;
}

/**
 * Sort the entire sheet by `byCol` (absolute column index). Treats row 0 as a
 * header (left in place) — matching Sheets' "Sort sheet" default which keeps
 * the frozen/first row. We keep row 0 fixed only when it looks like a header
 * (non-empty); otherwise sort everything.
 */
export function sortSheet(wb: Wb, asc: boolean, byCol: number): SortError {
  const grid = fullGrid(wb);
  const { rows, cols } = usedExtent(grid);
  if (rows < 1) return "single-cell";
  // Heuristic header detection: row 0 has text in the sort column and row 1 differs.
  const headerCell = cellText(grid[0]?.[byCol] ?? null);
  const hasHeader = headerCell !== "" && Number.isNaN(Number(headerCell));
  const startRow = hasHeader ? 1 : 0;
  const block: CellGrid = [];
  for (let r = startRow; r <= rows; r++) {
    const row: Cell[] = [];
    for (let c = 0; c <= cols; c++) row.push(grid[r]?.[c] ?? null);
    block.push(row);
  }
  const sorted = sortGridRows(block, byCol, asc);
  writeRange(wb, sorted, startRow, 0);
  return null;
}

/** Shuffle the rows of the current selection randomly. */
export function randomizeRange(wb: Wb): SortError {
  const sel = selection(wb);
  if (!sel) return "no-selection";
  const [r0, r1] = sel.row;
  const [c0, c1] = sel.column;
  if (r0 === r1) return "single-cell";
  const grid = fullGrid(wb);
  const block: CellGrid = [];
  for (let r = r0; r <= r1; r++) {
    const row: Cell[] = [];
    for (let c = c0; c <= c1; c++) row.push(grid[r]?.[c] ?? null);
    block.push(row);
  }
  writeRange(wb, shuffleGridRows(block), r0, c0);
  return null;
}

/**
 * Create a filter over the current selection (or the contiguous data region if
 * a single cell is selected). FortuneSheet renders filter dropdowns when the
 * sheet carries `filter_select`; we set it via updateSheet on a cloned sheet.
 * Calling again with a filter present clears it (toggle, like Sheets).
 */
export function toggleFilter(wb: Wb): SortError {
  const sheet = wb?.getSheet?.();
  if (!sheet) return "no-selection";
  const all: any[] = wb.getAllSheets?.() || [];
  const idx = all.findIndex((s) => s.id === sheet.id);
  if (idx < 0) return "no-selection";

  // Toggle off if already filtered.
  if (sheet.filter_select) {
    const cloned = all.map((s) =>
      s.id === sheet.id
        ? { ...s, filter_select: undefined, filter: undefined }
        : s,
    );
    wb.updateSheet?.(cloned);
    return null;
  }

  const grid = fullGrid(wb);
  const sel = selection(wb);
  let r0: number, r1: number, c0: number, c1: number;
  if (sel && (sel.row[0] !== sel.row[1] || sel.column[0] !== sel.column[1])) {
    [r0, r1] = sel.row;
    [c0, c1] = sel.column;
  } else {
    // Single cell (or none): use the contiguous used region from the top-left.
    const { rows, cols } = usedExtent(grid);
    if (rows < 0) return "single-cell";
    r0 = 0;
    c0 = 0;
    r1 = rows;
    c1 = cols;
  }
  if (r0 === r1 && c0 === c1) return "single-cell";

  const filter_select = { row: [r0, r1], column: [c0, c1] };
  const cloned = all.map((s) =>
    s.id === sheet.id ? { ...s, filter_select, filter: {} } : s,
  );
  wb.updateSheet?.(cloned);
  return null;
}

/**
 * Split the selected single column's cells into multiple columns by a delimiter
 * (auto-detected when not given). Writes results to the right, shifting nothing
 * (overwrites adjacent cells like Sheets does).
 */
export function splitTextToColumns(wb: Wb, delimiter?: string): SortError {
  const sel = selection(wb);
  if (!sel) return "no-selection";
  const [r0, r1] = sel.row;
  const [c0] = sel.column;
  const grid = fullGrid(wb);
  const texts: string[] = [];
  for (let r = r0; r <= r1; r++) texts.push(cellText(grid[r]?.[c0] ?? null));
  const delim = delimiter ?? detectDelimiter(texts);
  const split = texts.map((t) => splitDelimited(t, delim));
  const width = Math.max(1, ...split.map((p) => p.length));
  const rows: CellGrid = split.map((parts) => {
    const row: Cell[] = [];
    for (let i = 0; i < width; i++)
      row.push(parts[i] != null ? { v: parts[i], m: parts[i] } : null);
    return row;
  });
  writeRange(wb, rows, r0, c0);
  return null;
}

/** Column headers (A, B, ... AA) for the used columns, for sort-by-column submenus. */
export function columnLabels(wb: Wb): string[] {
  const grid = fullGrid(wb);
  const { cols } = usedExtent(grid);
  const labels: string[] = [];
  for (let c = 0; c <= Math.max(cols, 0); c++) labels.push(colName(c));
  return labels;
}

export function colName(c: number): string {
  let s = "";
  let n = c;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
