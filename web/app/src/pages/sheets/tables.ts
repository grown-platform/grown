/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet cells are loosely typed. */

// Excel tables (ListObjects): the model and its operations, pure.
//
// A table lives on its sheet in `grownTables` (the same TableModel the xlsx
// reader/writer uses, xlsx/xlsxTables.ts): a name, the whole range (header
// row, data rows, optional totals row), columns with names, a totals
// function per column, an optional calculated-column formula, and a style
// (a TableStyle… name plus banded rows/columns and first/last column
// emphasis). Formulas address it with structured references
// (structuredRefs.ts), which the Go engine evaluates.
//
// Every operation here returns the new table and the cell writes it needs;
// the editor applies them (tableTools.ts) as one undo step.

import type { CellRect } from "./cellRange";
import { cellDisplay } from "./cellValue";
import { translateFormula } from "./formulaShift";
import {
  dropTableColumnsInFormula,
  normalizeStructuredRefs,
  renameColumnInFormula,
  renameTableInFormula,
  structuredToA1,
  structuredTokens,
  type TableShape,
} from "./structuredRefs";
import type { TableColumn, TableModel, TableStyleInfo } from "./xlsx/xlsxTables";

export type { TableColumn, TableModel, TableStyleInfo };

export type Getter = (r: number, c: number) => any;

/** A cell write: `cell` null clears it. */
export interface TableWrite {
  r: number;
  c: number;
  cell: any;
}

export interface TableEdit {
  table: TableModel;
  writes: TableWrite[];
}

export const DEFAULT_TABLE_STYLE = "TableStyleMedium2";

// ---- reading -------------------------------------------------------------------------------

export function sheetTables(sheet: any): TableModel[] {
  return Array.isArray(sheet?.grownTables) ? (sheet.grownTables as TableModel[]).filter((t) => t && t.ref) : [];
}

export function tableShape(t: TableModel): TableShape {
  return { name: t.displayName || t.name, ref: t.ref, headerRowCount: t.headerRowCount, totalsRowCount: t.totalsRowCount, columns: t.columns };
}

export function tableName(t: TableModel): string {
  return t.displayName || t.name;
}

/** The data rows (without header and totals). */
export function dataRect(t: TableModel): CellRect {
  return { ...t.ref, r1: t.ref.r1 + (t.headerRowCount ? 1 : 0), r2: t.ref.r2 - (t.totalsRowCount ? 1 : 0) };
}

/** The part a filter covers: header row and data rows. */
export function filterRect(t: TableModel): CellRect {
  return { ...t.ref, r2: t.ref.r2 - (t.totalsRowCount ? 1 : 0) };
}

export function tableAt(tables: TableModel[], r: number, c: number): TableModel | null {
  return tables.find((t) => r >= t.ref.r1 && r <= t.ref.r2 && c >= t.ref.c1 && c <= t.ref.c2) ?? null;
}

const overlaps = (a: CellRect, b: CellRect) => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;

const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

function isBlank(cell: any): boolean {
  if (cell == null) return true;
  if (typeof cell !== "object") return cell === "";
  if (typeof cell.f === "string" && cell.f.startsWith("=")) return false;
  return cellDisplay(cell) === "";
}

// ---- names -----------------------------------------------------------------------------------

/**
 * Why a table name is not allowed, or null. Excel's rules: starts with a
 * letter, "_" or "\"; then letters, digits, "." and "_"; no spaces; not a
 * cell reference (A1, R1C1, R, C); at most 255 characters; unique among
 * tables and defined names (case-insensitive).
 */
export function tableNameError(name: string, taken: string[]): string | null {
  if (!name) return "Enter a name.";
  if (name.length > 255) return "A table name can have at most 255 characters.";
  if (/\s/.test(name)) return "A table name cannot contain spaces.";
  if (!/^[\p{L}_\\][\p{L}\p{N}_.\\]*$/u.test(name)) return "Start with a letter or underscore; use letters, numbers, periods and underscores.";
  if (/^[A-Za-z]{1,3}[0-9]+$/.test(name) || /^[Rr]([0-9]+)?[Cc]([0-9]+)?$/.test(name) || /^[RrCc]$/.test(name)) return "A table name cannot look like a cell reference.";
  if (taken.some((t) => same(t, name))) return "That name is already used by a table or named range.";
  return null;
}

/** The first free TableN. */
export function nextTableName(taken: string[], base = "Table"): string {
  for (let n = 1; ; n++) {
    const name = `${base}${n}`;
    if (!taken.some((t) => same(t, name))) return name;
  }
}

/** The next table id (xlsx needs ids unique in the workbook). */
export function nextTableId(all: TableModel[]): number {
  return all.reduce((m, t) => Math.max(m, t.id || 0), 0) + 1;
}

/** Column names made unique (case-insensitive; "Qty", "Qty2", …); blanks become ColumnN. */
export function uniqueColumnNames(names: string[]): string[] {
  const out: string[] = [];
  names.forEach((raw, i) => {
    let base = String(raw ?? "").replace(/[\r\n]+/g, " ").trim();
    if (!base) base = `Column${i + 1}`;
    let name = base;
    for (let k = 2; out.some((o) => same(o, name)); k++) name = `${base}${k}`;
    out.push(name);
  });
  return out;
}

/** A new column's default name: ColumnN with the smallest free N from `from`. */
export function newColumnName(existing: string[], from = existing.length + 1): string {
  for (let n = from; ; n++) {
    const name = `Column${n}`;
    if (!existing.some((e) => same(e, name))) return name;
  }
}

// ---- create ------------------------------------------------------------------------------------

/** Excel's guess for "My table has headers": the first row is all text and some row below is not. */
export function guessHasHeaders(range: CellRect, get: Getter): boolean {
  if (range.r2 <= range.r1) return false;
  for (let c = range.c1; c <= range.c2; c++) {
    const cell = get(range.r1, c);
    if (isBlank(cell)) return false;
    const v = typeof cell === "object" ? cell.v : cell;
    if (typeof v !== "string" || (typeof cell === "object" && typeof cell.f === "string" && cell.f.startsWith("="))) return false;
  }
  for (let r = range.r1 + 1; r <= range.r2; r++) {
    for (let c = range.c1; c <= range.c2; c++) {
      const cell = get(r, c);
      const v = cell && typeof cell === "object" ? cell.v : cell;
      if (v != null && v !== "" && typeof v !== "string") return true;
    }
  }
  return false;
}

export interface CreateOptions {
  range: CellRect;
  hasHeaders: boolean;
  style?: string;
  /** Names already used by tables and defined names in the workbook. */
  taken: string[];
  /** Every table of the workbook (for ids) and of this sheet (for overlap). */
  allTables: TableModel[];
  sheetTables: TableModel[];
  get: Getter;
}

export interface CreateResult extends TableEdit {
  /** The header row must be inserted first (cells of the range shift down one row). */
  insertHeaderRow: boolean;
}

/**
 * Format as table / Insert ▸ Table. With headers the first row names the
 * columns (made unique, blanks become ColumnN, header cells become text);
 * without, a header row of Column1… is inserted above the data.
 */
export function createTable(o: CreateOptions): CreateResult | string {
  const range = { r1: Math.min(o.range.r1, o.range.r2), r2: Math.max(o.range.r1, o.range.r2), c1: Math.min(o.range.c1, o.range.c2), c2: Math.max(o.range.c1, o.range.c2) };
  const ref = o.hasHeaders ? range : { ...range, r2: range.r2 + 1 };
  if (o.hasHeaders && ref.r2 === ref.r1) ref.r2 = ref.r1 + 1; // a header needs a data row
  if (o.sheetTables.some((t) => overlaps(t.ref, ref))) return "A table can't overlap another table.";
  const width = range.c2 - range.c1 + 1;
  const raw = o.hasHeaders ? Array.from({ length: width }, (_, i) => cellDisplay(o.get(range.r1, range.c1 + i))) : [];
  const names = o.hasHeaders ? uniqueColumnNames(raw) : Array.from({ length: width }, (_, i) => `Column${i + 1}`);
  const name = nextTableName(o.taken);
  const table: TableModel = {
    id: nextTableId(o.allTables),
    name,
    displayName: name,
    ref,
    headerRowCount: 1,
    totalsRowCount: 0,
    totalsRowShown: false,
    insertRow: false,
    autoFilter: true,
    columns: names.map((n, i) => ({ id: i + 1, name: n })),
    style: { name: o.style ?? DEFAULT_TABLE_STYLE, showFirstColumn: false, showLastColumn: false, showRowStripes: true, showColumnStripes: false },
  };
  const writes: TableWrite[] = [];
  names.forEach((n, i) => {
    const cur = o.hasHeaders ? o.get(range.r1, range.c1 + i) : null;
    const isText = cur && typeof cur === "object" && typeof cur.v === "string" && !cur.f && cur.v === n;
    if (!isText) writes.push({ r: ref.r1, c: range.c1 + i, cell: headerCell(cur, n) });
  });
  return { table, writes, insertHeaderRow: !o.hasHeaders };
}

/** A header cell holding `name` as text, keeping the cell's formatting. */
function headerCell(cur: any, name: string): any {
  const base = cur && typeof cur === "object" ? { ...cur } : {};
  delete base.f;
  delete base.grownSpill;
  return { ...base, v: name, m: name, ct: { fa: "@", t: "s" } };
}

// ---- style & options ----------------------------------------------------------------------------

export type StyleFlag = "showRowStripes" | "showColumnStripes" | "showFirstColumn" | "showLastColumn";

export function setStyle(t: TableModel, patch: Partial<TableStyleInfo>): TableModel {
  const base: TableStyleInfo = t.style ?? { name: DEFAULT_TABLE_STYLE, showFirstColumn: false, showLastColumn: false, showRowStripes: true, showColumnStripes: false };
  return { ...t, style: { ...base, ...patch } };
}

// ---- totals row ----------------------------------------------------------------------------------

export type TotalsFunction = "none" | "sum" | "average" | "count" | "countNums" | "max" | "min" | "stdDev" | "var" | "custom";

/** SUBTOTAL codes of the totals functions (1xx: ignore hidden rows, as Excel writes them). */
export const SUBTOTAL_CODE: Record<string, number> = { average: 101, countNums: 102, count: 103, max: 104, min: 105, stdDev: 107, sum: 109, var: 110 };

export const TOTALS_FUNCTIONS: { id: TotalsFunction; label: string }[] = [
  { id: "none", label: "None" },
  { id: "sum", label: "Sum" },
  { id: "average", label: "Average" },
  { id: "count", label: "Count" },
  { id: "countNums", label: "Count numbers" },
  { id: "max", label: "Max" },
  { id: "min", label: "Min" },
  { id: "stdDev", label: "StdDev" },
  { id: "var", label: "Var" },
];

/** The totals-row formula of a column: =SUBTOTAL(109,[Qty]). */
export function totalsFormula(fn: TotalsFunction, column: string): string | null {
  const code = SUBTOTAL_CODE[fn];
  if (!code) return null;
  return `=SUBTOTAL(${code},${normalizeStructuredRefs(`[${column.replace(/(['#@[\]])/g, "'$1")}]`, "edit")})`;
}

function columnIsNumeric(t: TableModel, i: number, get: Getter): boolean {
  const d = dataRect(t);
  let nums = 0;
  let other = 0;
  for (let r = d.r1; r <= d.r2; r++) {
    const cell = get(r, t.ref.c1 + i);
    if (isBlank(cell)) continue;
    const v = typeof cell === "object" ? cell.v : cell;
    if (typeof v === "number") nums++;
    else other++;
  }
  return nums > 0 && other === 0;
}

export interface TotalsResult extends TableEdit {
  /** The row below the table is not empty: shift the table columns' cells down one row first. */
  insertRow: boolean;
}

/**
 * Turns the totals row on (a row below the data: "Total" in the first
 * column, a sum — or a count for text — in the last) or off (its cells are
 * cleared and the table ends at the last data row).
 */
export function setTotalsRow(t: TableModel, on: boolean, get: Getter): TotalsResult {
  const has = !!t.totalsRowCount;
  if (on === has) return { table: t, writes: [], insertRow: false };
  const writes: TableWrite[] = [];
  if (!on) {
    for (let c = t.ref.c1; c <= t.ref.c2; c++) writes.push({ r: t.ref.r2, c, cell: null });
    const columns = t.columns.map((c) => ({ ...c }));
    return { table: { ...t, ref: { ...t.ref, r2: t.ref.r2 - 1 }, totalsRowCount: 0, totalsRowShown: true, columns }, writes, insertRow: false };
  }
  const row = t.ref.r2 + 1;
  let occupied = false;
  for (let c = t.ref.c1; c <= t.ref.c2; c++) if (!isBlank(get(row, c))) occupied = true;
  const last = t.columns.length - 1;
  const columns = t.columns.map((c, i) => {
    const out: TableColumn = { ...c };
    delete out.totalsRowFunction;
    delete out.totalsRowLabel;
    if (c.totalsRowFunction || c.totalsRowLabel) {
      if (c.totalsRowFunction) out.totalsRowFunction = c.totalsRowFunction;
      if (c.totalsRowLabel) out.totalsRowLabel = c.totalsRowLabel;
      return out;
    }
    if (i === 0 && last > 0) out.totalsRowLabel = "Total";
    if (i === last) out.totalsRowFunction = columnIsNumeric(t, i, get) ? "sum" : "count";
    return out;
  });
  const table: TableModel = { ...t, ref: { ...t.ref, r2: row }, totalsRowCount: 1, totalsRowShown: true, columns };
  columns.forEach((c, i) => {
    const cell = totalsCell(c);
    if (cell) writes.push({ r: row, c: t.ref.c1 + i, cell });
  });
  return { table, writes, insertRow: occupied };
}

function totalsCell(c: TableColumn): any {
  if (c.totalsRowFunction && c.totalsRowFunction !== "none") {
    if (c.totalsRowFunction === "custom") return c.totalsRowFormula ? { f: c.totalsRowFormula } : null;
    const f = totalsFormula(c.totalsRowFunction as TotalsFunction, c.name);
    return f ? { f } : null;
  }
  if (c.totalsRowLabel) return { v: c.totalsRowLabel, m: c.totalsRowLabel, ct: { fa: "@", t: "s" } };
  return null;
}

/** Sets one column's totals function (or a label, for "none" with text). */
export function setTotalsFunction(t: TableModel, index: number, fn: TotalsFunction, label?: string): TableEdit {
  if (!t.totalsRowCount || index < 0 || index >= t.columns.length) return { table: t, writes: [] };
  const columns = t.columns.map((c, i) => {
    if (i !== index) return c;
    const out: TableColumn = { ...c };
    delete out.totalsRowFunction;
    delete out.totalsRowLabel;
    delete out.totalsRowFormula;
    if (fn !== "none") out.totalsRowFunction = fn;
    else if (label) out.totalsRowLabel = label;
    return out;
  });
  const cell = totalsCell(columns[index]);
  return { table: { ...t, columns }, writes: [{ r: t.ref.r2, c: t.ref.c1 + index, cell }] };
}

/** Which totals function a totals-row formula is (for a formula typed there). */
export function totalsFunctionOf(formula: string): TotalsFunction | null {
  const m = /^=\s*SUBTOTAL\(\s*(\d+)\s*,/i.exec(formula ?? "");
  if (!m) return null;
  const code = Number(m[1]);
  const hit = Object.entries(SUBTOTAL_CODE).find(([, v]) => v === code || v - 100 === code);
  return hit ? (hit[0] as TotalsFunction) : null;
}

// ---- rename ------------------------------------------------------------------------------------

/** Formula edits for a table rename across the workbook. */
export function renameTableFormulas(sheets: any[], oldName: string, newName: string): { sheetId: string; r: number; c: number; f: string }[] {
  return formulaEdits(sheets, (f) => renameTableInFormula(f, oldName, newName));
}

/** Formula edits after a column rename (header cell edited). */
export function renameColumnFormulas(sheets: any[], table: string, oldName: string, newName: string): { sheetId: string; r: number; c: number; f: string }[] {
  return formulaEdits(sheets, (f, host) => renameColumnInFormula(f, table, oldName, newName, host));
}

/** Formula edits after columns (or whole tables, "*") were removed. */
export function dropColumnFormulas(sheets: any[], removed: Record<string, string[] | "*">): { sheetId: string; r: number; c: number; f: string }[] {
  return formulaEdits(sheets, (f, host) => dropTableColumnsInFormula(f, removed, host));
}

/** Runs fn over every formula (with the name of the table the cell is in) and lists the changes. */
export function formulaEdits(sheets: any[], fn: (f: string, host: string | undefined) => string): { sheetId: string; r: number; c: number; f: string }[] {
  const out: { sheetId: string; r: number; c: number; f: string }[] = [];
  for (const sheet of Array.isArray(sheets) ? sheets : []) {
    const tables = sheetTables(sheet);
    forEachFormula(sheet, (r, c, f) => {
      const host = tableAt(tables, r, c);
      const next = fn(f, host ? tableName(host) : undefined);
      if (next !== f) out.push({ sheetId: String(sheet.id), r, c, f: next });
    });
  }
  return out;
}

function forEachFormula(sheet: any, fn: (r: number, c: number, f: string) => void) {
  if (Array.isArray(sheet?.data)) {
    sheet.data.forEach((row: any[], r: number) =>
      row?.forEach?.((cell: any, c: number) => {
        if (cell && typeof cell.f === "string" && cell.f.startsWith("=")) fn(r, c, cell.f);
      }),
    );
    return;
  }
  for (const cd of Array.isArray(sheet?.celldata) ? sheet.celldata : []) {
    const f = cd?.v?.f;
    if (typeof f === "string" && f.startsWith("=")) fn(cd.r, cd.c, f);
  }
}

/**
 * A header cell was edited: the column takes the new text as its name (made
 * unique; empty → ColumnN, as Excel does). Returns the table, the header
 * write when the name had to change, and the old → new name.
 */
export function headerEdited(t: TableModel, c: number, text: string): { table: TableModel; writes: TableWrite[]; from: string; to: string } | null {
  const i = c - t.ref.c1;
  if (!t.headerRowCount || i < 0 || i >= t.columns.length) return null;
  const from = t.columns[i].name;
  const others = t.columns.filter((_, k) => k !== i).map((x) => x.name);
  let to = String(text ?? "").replace(/[\r\n]+/g, " ").trim();
  if (!to) to = newColumnName(others, i + 1);
  for (let k = 2; others.some((o) => same(o, to)); k++) to = `${text.trim() || "Column"}${k}`;
  const writes: TableWrite[] = to !== text ? [{ r: t.ref.r1, c, cell: headerCell(null, to) }] : [];
  if (to === from) return { table: t, writes, from, to };
  const columns = t.columns.map((x, k) => (k === i ? { ...x, name: to } : x));
  return { table: { ...t, columns }, writes, from, to };
}

// ---- resize / expand ----------------------------------------------------------------------------

/**
 * Resize: the header row stays where it is and the new range must still
 * overlap the old one. Columns keep their names by position; new columns
 * take their header text (or ColumnN). Returns the table, header writes and
 * the names of dropped columns (their references become #REF!).
 */
export function resizeTable(t: TableModel, next: CellRect, get: Getter, sheetTables: TableModel[]): { table: TableModel; writes: TableWrite[]; removed: string[] } | string {
  const n = { r1: Math.min(next.r1, next.r2), r2: Math.max(next.r1, next.r2), c1: Math.min(next.c1, next.c2), c2: Math.max(next.c1, next.c2) };
  if (n.r1 !== t.ref.r1) return "The header row must stay in the same row.";
  if (!overlaps(n, t.ref)) return "The new range must overlap the table.";
  if (n.r2 - n.r1 < (t.headerRowCount ? 1 : 0) + (t.totalsRowCount ? 1 : 0)) return "The table needs at least one data row.";
  if (sheetTables.some((o) => o !== t && tableName(o) !== tableName(t) && overlaps(o.ref, n))) return "A table can't overlap another table.";
  const writes: TableWrite[] = [];
  const columns: TableColumn[] = [];
  const kept = new Set<number>();
  for (let c = n.c1; c <= n.c2; c++) {
    const old = c - t.ref.c1;
    if (old >= 0 && old < t.columns.length) {
      columns.push({ ...t.columns[old] });
      kept.add(old);
    } else {
      const text = t.headerRowCount ? cellDisplay(get(n.r1, c)) : "";
      const name = text.trim() && !columns.some((x) => same(x.name, text.trim())) && !t.columns.some((x) => same(x.name, text.trim())) ? text.trim() : newColumnName([...t.columns.map((x) => x.name), ...columns.map((x) => x.name)], c - n.c1 + 1);
      columns.push({ id: 0, name });
      if (t.headerRowCount && cellDisplay(get(n.r1, c)) !== name) writes.push({ r: n.r1, c, cell: headerCell(get(n.r1, c), name) });
    }
  }
  let id = t.columns.reduce((m, x) => Math.max(m, x.id || 0), 0);
  for (const col of columns) if (!col.id) col.id = ++id;
  const removed = t.columns.filter((_, i) => !kept.has(i)).map((x) => x.name);
  return { table: { ...t, ref: n, columns }, writes, removed };
}

/**
 * Auto-expand after typing into (r, c): the row just below the data (no
 * totals row) or the column just right of the table grows it, as Excel
 * does. New rows get the calculated-column formulas, a new column its name
 * (the typed header text, or ColumnN). null when (r, c) does not extend t.
 */
export function autoExpand(t: TableModel, r: number, c: number, get: Getter): TableEdit | null {
  const ref = t.ref;
  const writes: TableWrite[] = [];
  if (r === ref.r2 + 1 && c >= ref.c1 && c <= ref.c2 && !t.totalsRowCount) {
    const table: TableModel = { ...t, ref: { ...ref, r2: r } };
    t.columns.forEach((col, i) => {
      const cc = ref.c1 + i;
      if (col.calculatedColumnFormula && cc !== c && isBlank(get(r, cc))) {
        writes.push({ r, c: cc, cell: { f: calcFormulaAt(t, col.calculatedColumnFormula, r) } });
      }
    });
    return { table, writes };
  }
  if (c === ref.c2 + 1 && r >= ref.r1 && r <= ref.r2 - (t.totalsRowCount ? 1 : 0)) {
    const header = t.headerRowCount ? cellDisplay(get(ref.r1, c)).trim() : "";
    const existing = t.columns.map((x) => x.name);
    const name = header && !existing.some((e) => same(e, header)) ? header : newColumnName(existing);
    const id = t.columns.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
    const table: TableModel = { ...t, ref: { ...ref, c2: c }, columns: [...t.columns, { id, name }] };
    if (t.headerRowCount && cellDisplay(get(ref.r1, c)) !== name) writes.push({ r: ref.r1, c, cell: headerCell(get(ref.r1, c), name) });
    return { table, writes };
  }
  return null;
}

// ---- calculated columns ------------------------------------------------------------------------

/** The calculated-column formula as it reads in data row r (stored for the first data row). */
export function calcFormulaAt(t: TableModel, formula: string, r: number): string {
  const d = dataRect(t);
  return translateFormula(formula, r - d.r1, 0);
}

/**
 * A formula entered in a data cell: when the rest of the column is empty, or
 * still holds the column's calculated formula, the whole column gets it (each
 * row's copy moved like a fill) and it becomes the calculated column. null
 * when the column keeps other values.
 */
export function calculatedColumnFill(t: TableModel, r: number, c: number, formula: string, get: Getter): TableEdit | null {
  const d = dataRect(t);
  const i = c - t.ref.c1;
  if (r < d.r1 || r > d.r2 || i < 0 || i >= t.columns.length || !formula.startsWith("=")) return null;
  const base = translateFormula(formula, d.r1 - r, 0);
  const cur = t.columns[i].calculatedColumnFormula;
  for (let rr = d.r1; rr <= d.r2; rr++) {
    if (rr === r) continue;
    const cell = get(rr, c);
    if (isBlank(cell)) continue;
    const f = cell && typeof cell === "object" ? cell.f : undefined;
    if (cur && typeof f === "string" && f === calcFormulaAt(t, cur, rr)) continue;
    return null;
  }
  if (d.r1 === d.r2 && !cur) {
    // One data row: nothing to fill, but the column becomes calculated.
    const columns = t.columns.map((col, k) => (k === i ? { ...col, calculatedColumnFormula: base } : col));
    return { table: { ...t, columns }, writes: [] };
  }
  const writes: TableWrite[] = [];
  for (let rr = d.r1; rr <= d.r2; rr++) {
    if (rr === r) continue;
    const f = calcFormulaAt(t, base, rr);
    if (get(rr, c)?.f === f) continue; // already there
    writes.push({ r: rr, c, cell: { f } });
  }
  if (!writes.length && cur === base) return null; // nothing changes
  const columns = t.columns.map((col, k) => (k === i ? { ...col, calculatedColumnFormula: base } : col));
  return { table: { ...t, columns }, writes };
}

/** A data cell of a calculated column got a value or another formula: the column stops being calculated (Excel keeps it as an exception; Grown drops the rule). */
export function clearCalculated(t: TableModel, c: number): TableModel {
  const i = c - t.ref.c1;
  if (i < 0 || i >= t.columns.length || !t.columns[i].calculatedColumnFormula) return t;
  const columns = t.columns.map((col, k) => {
    if (k !== i) return col;
    const out = { ...col };
    delete out.calculatedColumnFormula;
    return out;
  });
  return { ...t, columns };
}

// ---- convert to range --------------------------------------------------------------------------

/**
 * Convert to range: the table goes; formulas that referred to it get A1
 * references ([@Col] the cell in the formula's row); the style stays as
 * ordinary cell formatting (fill, text colour, bold) where the cell has none.
 */
export function convertToRange(sheets: any[], t: TableModel, get: Getter): { edits: { sheetId: string; r: number; c: number; f: string }[]; formats: { r: number; c: number; bg?: string; fc?: string; bl?: number }[] } {
  const shape = tableShape(t);
  const edits: { sheetId: string; r: number; c: number; f: string }[] = [];
  for (const sheet of Array.isArray(sheets) ? sheets : []) {
    const tables = sheetTables(sheet);
    forEachFormula(sheet, (r, c, f) => {
      const host = tableAt(tables, r, c);
      const next = structuredToA1(f, shape, { r, c }, host ? tableName(host) : undefined);
      if (next !== f) edits.push({ sheetId: String(sheet.id), r, c, f: next });
    });
  }
  const formats: { r: number; c: number; bg?: string; fc?: string; bl?: number }[] = [];
  for (let r = t.ref.r1; r <= t.ref.r2; r++) {
    for (let c = t.ref.c1; c <= t.ref.c2; c++) {
      const look = tableCellLook(t, r, c);
      if (!look) continue;
      const cur = get(r, c);
      const fmt: { r: number; c: number; bg?: string; fc?: string; bl?: number } = { r, c };
      if (look.fill && !cur?.bg) fmt.bg = look.fill;
      if (look.text && !cur?.fc) fmt.fc = look.text;
      if (look.bold) fmt.bl = 1;
      if (fmt.bg || fmt.fc || fmt.bl) formats.push(fmt);
    }
  }
  return { edits, formats };
}

// ---- copy / paste ------------------------------------------------------------------------------

/**
 * Pasting a block that holds whole tables makes copies of them at each
 * destination (with new names, and new ids), as Excel does.
 */
export function pasteTables(copied: TableModel[], src: CellRect, dests: CellRect[], taken: string[], allTables: TableModel[]): TableModel[] {
  const inside = copied.filter((t) => t.ref.r1 >= src.r1 && t.ref.r2 <= src.r2 && t.ref.c1 >= src.c1 && t.ref.c2 <= src.c2);
  const out: TableModel[] = [];
  const names = [...taken];
  let id = nextTableId(allTables);
  for (const d of dests) {
    const dr = Math.min(d.r1, d.r2) - src.r1;
    const dc = Math.min(d.c1, d.c2) - src.c1;
    for (const t of inside) {
      const name = nextTableName(names);
      names.push(name);
      out.push({
        ...t,
        id: id++,
        name,
        displayName: name,
        ref: { r1: t.ref.r1 + dr, r2: t.ref.r2 + dr, c1: t.ref.c1 + dc, c2: t.ref.c2 + dc },
        columns: t.columns.map((c) => ({ ...c })),
      });
    }
  }
  return out;
}

// ---- structure ops ------------------------------------------------------------------------------

/**
 * A table after a structure op, given where its header cells went: the new
 * range (from shiftRect) and, per new column position, the old column (or -1
 * for an inserted column, which gets a new ColumnN name). null when the
 * table is gone (its header row or every data row deleted).
 */
export function remapTableColumns(t: TableModel, ref: CellRect | null, oldAt: (c: number) => number): { table: TableModel; removed: string[]; added: { c: number; name: string }[] } | null {
  if (!ref) return null;
  const minRows = (t.headerRowCount ? 1 : 0) + (t.totalsRowCount ? 1 : 0) + 1;
  if (ref.r2 - ref.r1 + 1 < minRows) return null;
  const used = new Set<number>();
  const cols: TableColumn[] = [];
  const added: { c: number; name: string }[] = [];
  let id = t.columns.reduce((m, x) => Math.max(m, x.id || 0), 0);
  for (let c = ref.c1; c <= ref.c2; c++) {
    const old = oldAt(c);
    if (old >= 0 && old < t.columns.length && !used.has(old)) {
      used.add(old);
      cols.push({ ...t.columns[old] });
    } else {
      const name = newColumnName([...t.columns.map((x) => x.name), ...cols.map((x) => x.name), ...added.map((x) => x.name)], c - ref.c1 + 1);
      cols.push({ id: ++id, name });
      added.push({ c, name });
    }
  }
  const removed = t.columns.filter((_, i) => !used.has(i)).map((x) => x.name);
  return { table: { ...t, ref, columns: cols }, removed, added };
}

// ---- style rendering ------------------------------------------------------------------------------

/** How one cell of a table looks: fill, text colour, bold, borders. */
export interface CellLook {
  fill?: string;
  text?: string;
  bold?: boolean;
  /** Line under the header / above the totals row, and the outline colour. */
  bottom?: string;
  top?: string;
  topDouble?: boolean;
  outline?: string;
}

interface StylePalette {
  header?: { fill?: string; text?: string; bold: boolean; bottom?: string };
  band1?: string; // odd data rows (or columns)
  band2?: string;
  total?: { fill?: string; text?: string; top?: string; double: boolean };
  firstLast?: { fill?: string; text?: string };
  outline?: string;
  inner?: string;
}

const THEME = ["#000000", "#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47"];

const tint = (hex: string, t: number) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * t);
  return "#" + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("").toUpperCase();
};
const shade = (hex: string, t: number) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) * (1 - t));
  return "#" + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("").toUpperCase();
};

/**
 * The palette of an Excel table style name (TableStyleLight1…21,
 * Medium1…28, Dark1…11), approximated from the Office theme colours: each
 * family of seven runs black/grey, then accents 1–6.
 */
function palette(name: string): StylePalette {
  const m = /^TableStyle(Light|Medium|Dark)(\d+)$/.exec(name ?? "");
  if (!m) return palette(DEFAULT_TABLE_STYLE);
  const n = Number(m[2]);
  const k = (n - 1) % 7;
  const group = Math.floor((n - 1) / 7);
  const base = THEME[k];
  const accent = k === 0 ? "#000000" : base;
  const light = k === 0 ? "#D9D9D9" : tint(base, 0.8);
  switch (m[1]) {
    case "Light":
      if (group === 0)
        return { header: { text: k === 0 ? "#000000" : shade(base, 0.25), bold: true, bottom: accent }, band1: light, total: { top: accent, double: false, text: k === 0 ? "#000000" : shade(base, 0.25) }, outline: accent };
      if (group === 1) return { header: { fill: accent, text: "#FFFFFF", bold: true }, band1: undefined, total: { top: accent, double: true }, outline: accent, inner: accent };
      return { header: { text: "#000000", bold: true, bottom: accent }, band1: light, total: { top: accent, double: true }, outline: accent, inner: k === 0 ? "#808080" : tint(base, 0.4) };
    case "Medium":
      if (group === 0) return { header: { fill: accent, text: "#FFFFFF", bold: true }, band1: light, total: { top: accent, double: true }, inner: k === 0 ? "#808080" : tint(base, 0.4) };
      if (group === 1) return { header: { fill: accent, text: "#FFFFFF", bold: true }, band1: light, band2: tint(k === 0 ? "#808080" : base, 0.9), total: { top: "#FFFFFF", double: true }, inner: "#FFFFFF" };
      if (group === 2) return { header: { fill: "#000000", text: "#FFFFFF", bold: true }, band1: k === 0 ? "#BFBFBF" : tint(base, 0.6), band2: light, total: { fill: "#000000", text: "#FFFFFF", double: true }, firstLast: { fill: accent, text: "#FFFFFF" } };
      if (group === 3) return { header: { text: "#000000", bold: true, bottom: accent }, band1: k === 0 ? "#BFBFBF" : tint(base, 0.6), band2: light, total: { top: accent, double: true }, outline: accent, inner: accent };
      return palette(DEFAULT_TABLE_STYLE);
    default:
      if (group === 0) return { header: { fill: "#000000", text: "#FFFFFF", bold: true, bottom: "#FFFFFF" }, band1: shade(k === 0 ? "#808080" : base, 0.25), band2: k === 0 ? "#595959" : base, total: { fill: shade(k === 0 ? "#595959" : base, 0.5), text: "#FFFFFF", double: true }, firstLast: { fill: shade(k === 0 ? "#595959" : base, 0.25), text: "#FFFFFF" } };
      return { header: { fill: k === 0 ? "#000000" : shade(base, 0.5), text: "#FFFFFF", bold: true }, band1: light, total: { top: "#000000", double: true }, outline: undefined };
  }
}

/** The data-row text colour of a style (white on the dark styles). */
function bodyText(name: string): string | undefined {
  return /^TableStyleDark[1-7]$/.test(name) ? "#FFFFFF" : undefined;
}

/** The look of cell (r, c) of table t (null outside it). */
export function tableCellLook(t: TableModel, r: number, c: number): CellLook | null {
  const ref = t.ref;
  if (r < ref.r1 || r > ref.r2 || c < ref.c1 || c > ref.c2) return null;
  const st = t.style ?? { name: DEFAULT_TABLE_STYLE, showFirstColumn: false, showLastColumn: false, showRowStripes: true, showColumnStripes: false };
  if (!st.name) return null;
  const p = palette(st.name);
  const look: CellLook = {};
  if (p.outline) look.outline = p.outline;
  const isHeader = !!t.headerRowCount && r === ref.r1;
  const isTotal = !!t.totalsRowCount && r === ref.r2;
  if (isHeader) {
    look.fill = p.header?.fill;
    look.text = p.header?.text;
    look.bold = p.header?.bold;
    look.bottom = p.header?.bottom;
    return look;
  }
  if (isTotal) {
    look.fill = p.total?.fill;
    look.text = p.total?.text ?? bodyText(st.name);
    look.bold = true;
    look.top = p.total?.top;
    look.topDouble = p.total?.double;
    return look;
  }
  const d = dataRect(t);
  look.text = bodyText(st.name);
  if (st.showRowStripes) {
    look.fill = (r - d.r1) % 2 === 0 ? p.band1 : p.band2;
  } else if (/^TableStyleDark[1-7]$/.test(st.name)) look.fill = p.band2;
  if (st.showColumnStripes && (c - ref.c1) % 2 === 0) look.fill = p.band1 && look.fill === p.band1 ? shade(p.band1, 0.08) : p.band1;
  if ((st.showFirstColumn && c === ref.c1) || (st.showLastColumn && c === ref.c2)) {
    look.bold = true;
    if (p.firstLast?.fill) look.fill = p.firstLast.fill;
    if (p.firstLast?.text) look.text = p.firstLast.text;
  }
  return look;
}

/** The gallery: every built-in style name, light → medium → dark. */
export const TABLE_STYLE_GALLERY: { group: "Light" | "Medium" | "Dark"; names: string[] }[] = [
  { group: "Light", names: Array.from({ length: 21 }, (_, i) => `TableStyleLight${i + 1}`) },
  { group: "Medium", names: Array.from({ length: 28 }, (_, i) => `TableStyleMedium${i + 1}`) },
  { group: "Dark", names: Array.from({ length: 11 }, (_, i) => `TableStyleDark${i + 1}`) },
];

/** A 5×4 preview grid of a style (for the gallery swatches). */
export function stylePreview(name: string): CellLook[][] {
  const t: TableModel = {
    id: 0,
    name: "p",
    displayName: "p",
    ref: { r1: 0, c1: 0, r2: 4, c2: 3 },
    headerRowCount: 1,
    totalsRowCount: 0,
    totalsRowShown: false,
    insertRow: false,
    autoFilter: false,
    columns: [],
    style: { name, showFirstColumn: false, showLastColumn: false, showRowStripes: true, showColumnStripes: false },
  };
  return Array.from({ length: 5 }, (_, r) => Array.from({ length: 4 }, (_, c) => tableCellLook(t, r, c) ?? {}));
}

// ---- formula entry --------------------------------------------------------------------------------

/**
 * A formula typed into a cell, normalised the way Excel shows it:
 * [[#This Row],[Qty]] → [@Qty], Table1[[Qty]] → Table1[Qty]. A reference to
 * the cell's own table keeps its name (Excel drops it when you point at the
 * cells; typing it is allowed).
 */
export function normalizeTyped(formula: string): string {
  if (!formula.startsWith("=") || !structuredTokens(formula).length) return formula;
  return normalizeStructuredRefs(formula, "edit");
}
