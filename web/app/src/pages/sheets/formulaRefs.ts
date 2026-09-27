/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet models are loosely typed. */

// Sheet-reference helpers for the editor.
//
// - Renaming a sheet rewrites every formula (and named range) that refers to
//   it, so Sheet1!A1 keeps pointing at the same cells ("rename sheet" fix-up).
// - The server formula engine is authoritative; recalcWrites works out which
//   cells the editor should update after POST …/recalc (see recalc in api.ts).
//
// Both are pure so they can be unit-tested without a grid.

/** Characters allowed in an unquoted sheet name (letters, marks, digits, _ .). */
const IDENT_CHAR = /[\p{L}\p{M}\p{N}_.]/u;
const CELL_LIKE = /^[A-Za-z]{1,3}[0-9]+$/;

/** quoteSheetName renders a sheet name for a formula, quoting when needed. */
export function quoteSheetName(name: string): string {
  if (name === "") return "";
  const plain =
    /^[\p{L}\p{M}_][\p{L}\p{M}\p{N}_.]*$/u.test(name) && !CELL_LIKE.test(name);
  return plain ? name : `'${name.replace(/'/g, "''")}'`;
}

/**
 * renameSheetInFormula rewrites references to sheet oldName (Sheet1!A1,
 * 'Old name'!A1:B2) so they point at newName. Text inside string literals is
 * left alone. Sheet names compare case-insensitively.
 */
export function renameSheetInFormula(
  formula: string,
  oldName: string,
  newName: string,
): string {
  const want = oldName.toLowerCase();
  const repl = quoteSheetName(newName) + "!";
  let out = "";
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      // String literal ("" escapes a quote).
      let j = i + 1;
      while (j < formula.length) {
        if (formula[j] === '"') {
          if (formula[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let name = "";
      while (j < formula.length) {
        if (formula[j] === "'") {
          if (formula[j + 1] === "'") {
            name += "'";
            j += 2;
            continue;
          }
          break;
        }
        name += formula[j];
        j++;
      }
      if (formula[j + 1] === "!" && name.toLowerCase() === want) {
        out += repl;
        i = j + 2;
        continue;
      }
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (IDENT_CHAR.test(ch) && (i === 0 || !IDENT_CHAR.test(formula[i - 1]))) {
      let j = i;
      while (j < formula.length && IDENT_CHAR.test(formula[j])) j++;
      const word = formula.slice(i, j);
      if (formula[j] === "!" && word.toLowerCase() === want) {
        out += repl;
        i = j + 1;
        continue;
      }
      out += word;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export interface NamedRangeLike {
  name: string;
  range: string;
  sheetId?: string;
  sheetName?: string;
}

/** renameSheetInNamedRanges updates named-range text and owner sheet names. */
export function renameSheetInNamedRanges<T extends NamedRangeLike>(
  list: T[],
  oldName: string,
  newName: string,
): T[] {
  return list.map((nr) => ({
    ...nr,
    range: renameSheetInFormula(nr.range, oldName, newName),
    sheetName:
      nr.sheetName !== undefined &&
      nr.sheetName.toLowerCase() === oldName.toLowerCase()
        ? newName
        : nr.sheetName,
  }));
}

export interface FormulaEdit {
  sheetId: string;
  r: number;
  c: number;
  f: string;
  /** The cell's current value and display text (kept until the next recalc). */
  v?: unknown;
  m?: string;
}

/** Iterate the cells of a FortuneSheet sheet (live `data` matrix or `celldata`). */
function forEachCell(sheet: any, fn: (r: number, c: number, cell: any) => void) {
  if (Array.isArray(sheet?.data)) {
    sheet.data.forEach((row: any[], r: number) =>
      row?.forEach((cell: any, c: number) => {
        if (cell && typeof cell === "object") fn(r, c, cell);
      }),
    );
    return;
  }
  for (const cd of sheet?.celldata ?? []) {
    if (cd?.v && typeof cd.v === "object") fn(cd.r, cd.c, cd.v);
  }
}

/** sheetRenameEdits lists the formula cells whose text changes on a rename. */
export function sheetRenameEdits(
  sheets: any[],
  oldName: string,
  newName: string,
): FormulaEdit[] {
  const edits: FormulaEdit[] = [];
  for (const sheet of sheets ?? []) {
    forEachCell(sheet, (r, c, cell) => {
      if (typeof cell.f !== "string" || !cell.f.startsWith("=")) return;
      const f = renameSheetInFormula(cell.f, oldName, newName);
      if (f !== cell.f) edits.push({ sheetId: sheet.id, r, c, f, v: cell.v, m: cell.m });
    });
  }
  return edits;
}

/** One computed cell returned by POST /api/v1/sheets/d/{id}/recalc. */
export interface RecalcCell {
  sheetId: string;
  sheetIndex: number;
  r: number;
  c: number;
  f?: string;
  v: unknown;
  m: string;
  spill?: boolean;
}

export interface CellWrite {
  sheetId: string;
  r: number;
  c: number;
  /** null clears the cell (spill output the array no longer covers). */
  value: { f?: string; v: unknown; m: string; grownSpill?: string } | null;
}

function cellAt(sheet: any, r: number, c: number): any {
  if (Array.isArray(sheet?.data)) return sheet.data[r]?.[c] ?? null;
  const cd = (sheet?.celldata ?? []).find((x: any) => x.r === r && x.c === c);
  return cd?.v ?? null;
}

const sameValue = (a: unknown, b: unknown) =>
  (a ?? "") === (b ?? "") || String(a ?? "") === String(b ?? "");

/**
 * recalcWrites compares server-computed cells with what the grid shows and
 * returns the writes that bring the grid in line. A formula cell is only
 * updated while it still holds the formula the server computed; a spill cell
 * only when it is empty or still holds earlier spill output (never over data
 * the user typed). Earlier spill output that no array covers any more (the
 * array shrank, was deleted, or is now blocked: #SPILL!) is cleared.
 */
export function recalcWrites(sheets: any[], cells: RecalcCell[]): CellWrite[] {
  const writes: CellWrite[] = [];
  for (const rc of cells ?? []) {
    const sheet =
      (sheets ?? []).find((s) => rc.sheetId && s?.id === rc.sheetId) ??
      sheets?.[rc.sheetIndex];
    if (!sheet) continue;
    const cur = cellAt(sheet, rc.r, rc.c);
    if (!rc.spill) {
      if (!cur || cur.f !== rc.f) continue;
      if (sameValue(cur.v, rc.v) && sameValue(cur.m, rc.m)) continue;
      writes.push({ sheetId: sheet.id, r: rc.r, c: rc.c, value: { f: rc.f, v: rc.v, m: rc.m } });
      continue;
    }
    if (cur?.f) continue;
    const empty = !cur || cur.v === undefined || cur.v === null || cur.v === "";
    const ours = cur && cur.grownSpill !== undefined && sameValue(cur.m ?? cur.v, cur.grownSpill);
    if (!empty && !ours) continue;
    if (cur && sameValue(cur.v, rc.v) && sameValue(cur.m, rc.m) && cur.grownSpill === rc.m) continue;
    writes.push({
      sheetId: sheet.id,
      r: rc.r,
      c: rc.c,
      value: { v: rc.v, m: rc.m, grownSpill: rc.m },
    });
  }
  const covered = new Set<string>();
  for (const rc of cells ?? []) {
    if (!rc.spill) continue;
    const sheet = (sheets ?? []).find((s) => rc.sheetId && s?.id === rc.sheetId) ?? sheets?.[rc.sheetIndex];
    if (sheet) covered.add(`${sheet.id}:${rc.r}:${rc.c}`);
  }
  for (const sheet of sheets ?? []) {
    forEachCell(sheet, (r, c, cell) => {
      if (cell.grownSpill === undefined || (typeof cell.f === "string" && cell.f)) return;
      if (!sameValue(cell.m ?? cell.v, cell.grownSpill)) return; // typed over: user data
      if (covered.has(`${sheet.id}:${r}:${c}`)) return;
      writes.push({ sheetId: sheet.id, r, c, value: null });
    });
  }
  return writes;
}

/**
 * workbookHasFormulas reports whether any cell of any sheet holds a formula,
 * or holds spill output a deleted array left behind (the recalc answer then
 * clears it).
 */
export function workbookHasFormulas(sheets: any[]): boolean {
  for (const sheet of sheets ?? []) {
    let found = false;
    forEachCell(sheet, (_r, _c, cell) => {
      if (typeof cell.f === "string" && cell.f.startsWith("=")) found = true;
      else if (cell.grownSpill !== undefined) found = true;
    });
    if (found) return true;
  }
  return false;
}
