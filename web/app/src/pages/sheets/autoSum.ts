import type { CellRect } from "./cellRange";

// AutoSum (Alt+=), the spreadsheet way.
//
// One cell: propose the run of numbers above it (else to its left), skipping
// the blanks between; the proposal ends next to the cell and stops after a
// cell that already holds a SUM (a subtotal).
//
// A selection:
// - a row or column of cells: a leading header (text, and the blanks after
//   it) is left out; the total goes into the selection's last cell when that
//   is empty, else into the next cell after the selection. A selection of
//   empty cells gets its first cell's proposal, copied along relatively.
// - a block: rows before the first row with numbers are left out; an empty
//   last row gets column totals, an empty last column row totals (and the
//   corner the total of the totals); with neither, totals go in the row
//   below.
// Only numbers count: dates and numbers stored as text are not summed.

export type CellKind = "empty" | "num" | "date" | "text" | "sum";
export type KindAt = (r: number, c: number) => CellKind;

export interface AutoSumWrite {
  r: number;
  c: number;
  f: string;
}
export interface AutoSumResult {
  writes: AutoSumWrite[];
  selection: CellRect;
}

function colLetters(c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const x = (n - 1) % 26;
    s = String.fromCharCode(65 + x) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
const a1 = (r: number, c: number) => `${colLetters(c)}${r + 1}`;
const rangeText = (r1: number, c1: number, r2: number, c2: number) =>
  r1 === r2 && c1 === c2 ? a1(r1, c1) : `${a1(r1, c1)}:${a1(r2, c2)}`;
const isNum = (k: CellKind) => k === "num" || k === "sum";

/** The range AutoSum proposes for a single cell, "" when there is none. */
export function proposeSum(kind: KindAt, r: number, c: number): string {
  const scan = (dr: number, dc: number): string => {
    let i = r + dr;
    let j = c + dc;
    while (i >= 0 && j >= 0 && kind(i, j) === "empty") {
      i += dr;
      j += dc;
    }
    if (i < 0 || j < 0 || !isNum(kind(i, j))) return "";
    // Extend over the run of numbers; a SUM cell ends it (it is included).
    while (kind(i, j) !== "sum" && i + dr >= 0 && j + dc >= 0 && isNum(kind(i + dr, j + dc))) {
      i += dr;
      j += dc;
    }
    return dr ? rangeText(i, c, r - 1, c) : rangeText(r, j, r, c - 1);
  };
  return scan(-1, 0) || scan(0, -1);
}

// Moves a proposal "A1:C1" by (dr, dc) for the relative copy along a vector.
function shiftRange(text: string, dr: number, dc: number): string {
  return text.replace(/([A-Z]+)(\d+)/g, (_m, col: string, row: string) => {
    let c = 0;
    for (const ch of col) c = c * 26 + ch.charCodeAt(0) - 64;
    return a1(Number(row) - 1 + dr, c - 1 + dc);
  });
}

/** AutoSum over a selection of two or more cells; null when nothing is written. */
export function autoSumSelection(kind: KindAt, sel: CellRect): AutoSumResult | null {
  const rows = sel.r2 - sel.r1 + 1;
  const cols = sel.c2 - sel.c1 + 1;
  if (rows === 1 && cols === 1) return null;
  if (rows === 1 || cols === 1) return vector(kind, sel, rows > 1);
  return block(kind, sel);
}

function vector(kind: KindAt, sel: CellRect, vertical: boolean): AutoSumResult | null {
  const n = vertical ? sel.r2 - sel.r1 + 1 : sel.c2 - sel.c1 + 1;
  const at = (i: number): [number, number] => (vertical ? [sel.r1 + i, sel.c1] : [sel.r1, sel.c1 + i]);
  const k = (i: number) => kind(...at(i));
  let allEmpty = true;
  for (let i = 0; i < n; i++) if (k(i) !== "empty") allEmpty = false;
  if (allEmpty) {
    const [r0, c0] = at(0);
    const first = proposeSum(kind, r0, c0);
    if (!first) return null;
    const writes: AutoSumWrite[] = [];
    for (let i = 0; i < n; i++) {
      const [r, c] = at(i);
      writes.push({ r, c, f: `=SUM(${shiftRange(first, r - r0, c - c0)})` });
    }
    return { writes, selection: sel };
  }
  const lastEmpty = k(n - 1) === "empty";
  const end = lastEmpty ? n - 2 : n - 1;
  let start = 0;
  if (k(0) === "text") while (start <= end && (k(start) === "text" || k(start) === "empty")) start++;
  let any = false;
  for (let i = start; i <= end; i++) if (isNum(k(i))) any = true;
  if (!any) return null;
  const target = lastEmpty ? n - 1 : n;
  const [sr, sc] = at(start);
  const [er, ec] = at(end);
  const [tr, tc] = at(target);
  return {
    writes: [{ r: tr, c: tc, f: `=SUM(${rangeText(sr, sc, er, ec)})` }],
    selection: { r1: sr, c1: sc, r2: tr, c2: tc },
  };
}

function block(kind: KindAt, sel: CellRect): AutoSumResult | null {
  const rowHasNum = (r: number, c1: number, c2: number) => {
    for (let c = c1; c <= c2; c++) if (isNum(kind(r, c))) return true;
    return false;
  };
  const colHasNum = (c: number, r1: number, r2: number) => {
    for (let r = r1; r <= r2; r++) if (isNum(kind(r, c))) return true;
    return false;
  };
  const rowEmpty = (r: number) => {
    for (let c = sel.c1; c <= sel.c2; c++) if (kind(r, c) !== "empty") return false;
    return true;
  };
  const colEmpty = (c: number, r1: number) => {
    for (let r = r1; r <= sel.r2; r++) if (kind(r, c) !== "empty") return false;
    return true;
  };
  let r1 = sel.r1;
  while (r1 <= sel.r2 && !rowHasNum(r1, sel.c1, sel.c2)) r1++;
  if (r1 > sel.r2) return null;
  const lastRowEmpty = r1 < sel.r2 && rowEmpty(sel.r2);
  const lastColEmpty = sel.c1 < sel.c2 && colEmpty(sel.c2, r1);
  const writes: AutoSumWrite[] = [];
  if (!lastRowEmpty && !lastColEmpty) {
    for (let c = sel.c1; c <= sel.c2; c++) {
      if (colHasNum(c, r1, sel.r2)) writes.push({ r: sel.r2 + 1, c, f: `=SUM(${rangeText(r1, c, sel.r2, c)})` });
    }
    return writes.length ? { writes, selection: { r1, c1: sel.c1, r2: sel.r2 + 1, c2: sel.c2 } } : null;
  }
  const dataR2 = lastRowEmpty ? sel.r2 - 1 : sel.r2;
  const dataC2 = lastColEmpty ? sel.c2 - 1 : sel.c2;
  if (lastRowEmpty) {
    for (let c = sel.c1; c <= dataC2; c++) {
      if (colHasNum(c, r1, dataR2)) writes.push({ r: sel.r2, c, f: `=SUM(${rangeText(r1, c, dataR2, c)})` });
    }
  }
  if (lastColEmpty) {
    for (let r = r1; r <= dataR2; r++) {
      if (rowHasNum(r, sel.c1, dataC2)) writes.push({ r, c: sel.c2, f: `=SUM(${rangeText(r, sel.c1, r, dataC2)})` });
    }
  }
  if (lastRowEmpty && lastColEmpty && writes.length) {
    writes.push({ r: sel.r2, c: sel.c2, f: `=SUM(${rangeText(sel.r2, sel.c1, sel.r2, dataC2)})` });
  }
  return writes.length ? { writes, selection: { r1, c1: sel.c1, r2: sel.r2, c2: sel.c2 } } : null;
}
