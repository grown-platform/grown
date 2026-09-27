import type { CellRect } from "./cellRange";

// Ctrl+A the spreadsheet way: the first press selects the block of data
// around the active cell (Excel's current region), or inside a table its
// data rows, then the whole table; the next press selects the whole sheet.

export type CellFilled = (r: number, c: number) => boolean;

const same = (a: CellRect, b: CellRect) => a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;
const contains = (a: CellRect, b: CellRect) => a.r1 <= b.r1 && a.c1 <= b.c1 && a.r2 >= b.r2 && a.c2 >= b.c2;

/**
 * The current region: the rectangle around (r, c) grown while any cell just
 * outside it (edges and corners) holds data. A lone empty cell is itself.
 */
export function currentRegion(filled: CellFilled, r: number, c: number, maxR = 1_048_575, maxC = 16_383): CellRect {
  const rect = { r1: r, c1: c, r2: r, c2: c };
  for (let grew = true; grew; ) {
    grew = false;
    const rowHas = (row: number, c1: number, c2: number) => {
      for (let j = c1; j <= c2; j++) if (filled(row, j)) return true;
      return false;
    };
    const colHas = (col: number, r1: number, r2: number) => {
      for (let i = r1; i <= r2; i++) if (filled(i, col)) return true;
      return false;
    };
    const c1 = Math.max(0, rect.c1 - 1);
    const c2 = Math.min(maxC, rect.c2 + 1);
    if (rect.r1 > 0 && rowHas(rect.r1 - 1, c1, c2)) {
      rect.r1--;
      grew = true;
    }
    if (rect.r2 < maxR && rowHas(rect.r2 + 1, c1, c2)) {
      rect.r2++;
      grew = true;
    }
    const r1 = Math.max(0, rect.r1 - 1);
    const r2 = Math.min(maxR, rect.r2 + 1);
    if (rect.c1 > 0 && colHas(rect.c1 - 1, r1, r2)) {
      rect.c1--;
      grew = true;
    }
    if (rect.c2 < maxC && colHas(rect.c2 + 1, r1, r2)) {
      rect.c2++;
      grew = true;
    }
  }
  return rect;
}

export interface TableRange {
  ref: CellRect;
  headerRowCount?: number;
}

/**
 * The range Ctrl+A selects next, or null for the whole sheet. `sel` is the
 * current selection and (r, c) the active cell.
 */
export function selectAllTarget(filled: CellFilled, sel: CellRect, r: number, c: number, tables: TableRange[] = []): CellRect | null {
  const steps: CellRect[] = [];
  const t = tables.find((x) => r >= x.ref.r1 && r <= x.ref.r2 && c >= x.ref.c1 && c <= x.ref.c2);
  if (t) {
    const header = t.headerRowCount ?? 1;
    const body = { ...t.ref, r1: t.ref.r1 + header };
    if (r >= body.r1 && body.r1 <= body.r2) steps.push(body);
    steps.push(t.ref);
  }
  const region = currentRegion(filled, r, c);
  if (region.r2 > region.r1 || region.c2 > region.c1) steps.push(region);
  for (const s of steps) if (!same(s, sel) && contains(s, sel)) return s;
  return null;
}
