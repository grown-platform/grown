/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet API and models are loosely typed. */

// FortuneSheet glue for Excel tables (tables.ts): creating and changing
// tables in the live grid, following edits (header renames, auto-expand,
// calculated columns, typed structured references), the header filter
// buttons (the M8 filter model: grownFilter with `table` set), and painting
// the table style from the render hooks M8 uses.
//
// The model is each sheet's `grownTables`, written with patchSheet (an
// applyOp patch that is also sent to collaborators). Cell writes go through
// setCellValue, so each action is an undo step of its own.

import type { CellRect } from "./cellRange";
import { cellDisplay } from "./cellValue";
import { applyWholeSheetOp, writeCells } from "./editActions";
import { applyFilter, currentSheet, patchSheet, sheetById, sheetFilter } from "./sheetDataTools";
import { sheetViewOptions } from "./sheetView";
import { effectiveHorizontalAlign } from "./cellAlign";
import { normalizeStructuredRefs, structuredRefsValid, structuredTokens, tableSelectionString } from "./structuredRefs";
import {
  autoExpand,
  calculatedColumnFill,
  clearCalculated,
  convertToRange,
  createTable,
  dataRect,
  dropColumnFormulas,
  filterRect,
  headerEdited,
  renameColumnFormulas,
  renameTableFormulas,
  resizeTable,
  setStyle,
  setTotalsFunction,
  setTotalsRow,
  sheetTables,
  tableAt,
  tableCellLook,
  tableName,
  tableNameError,
  tableShape,
  totalsFunctionOf,
  type CellLook,
  type TableModel,
  type TableWrite,
  type TotalsFunction,
} from "./tables";

type Wb = any;

// ---- reading ----------------------------------------------------------------------------------

function allSheets(w: Wb): any[] {
  try {
    return w?.getAllSheets?.() ?? [];
  } catch {
    return [];
  }
}

/** Every table of the workbook with its sheet. */
export function workbookTables(w: Wb): { sheet: any; table: TableModel }[] {
  const out: { sheet: any; table: TableModel }[] = [];
  for (const sheet of allSheets(w)) for (const table of sheetTables(sheet)) out.push({ sheet, table });
  return out;
}

/** Names a new table or a rename may not use: tables and defined names. */
export function takenNames(w: Wb, except?: string): string[] {
  const names = workbookTables(w)
    .map((x) => tableName(x.table))
    .filter((n) => !except || n.toUpperCase() !== except.toUpperCase());
  const nr = allSheets(w)[0]?._namedRanges;
  if (Array.isArray(nr)) for (const x of nr) if (x?.name) names.push(String(x.name));
  return names;
}

export function findTable(w: Wb, name: string): { sheet: any; table: TableModel } | null {
  return workbookTables(w).find((x) => tableName(x.table).toUpperCase() === name.toUpperCase()) ?? null;
}

function getter(sheet: any) {
  const data: any[][] = Array.isArray(sheet?.data) ? sheet.data : [];
  return (r: number, c: number) => data[r]?.[c] ?? null;
}

/** The table at the active cell of the current sheet. */
export function activeTable(w: Wb, cell?: { r: number; c: number } | null): TableModel | null {
  const sheet = currentSheet(w);
  if (!sheet) return null;
  let r = cell?.r;
  let c = cell?.c;
  if (r === undefined || c === undefined) {
    try {
      const s = w.getSelection?.();
      const sel = Array.isArray(s) ? s[s.length - 1] : s;
      r = sel?.row_focus ?? sel?.row?.[0];
      c = sel?.column_focus ?? sel?.column?.[0];
    } catch {
      return null;
    }
  }
  if (typeof r !== "number" || typeof c !== "number") return null;
  return tableAt(sheetTables(sheet), r, c);
}

// ---- writing ------------------------------------------------------------------------------------

/** Replaces one table (by name) on its sheet, or adds it; null removes it. */
export function saveTable(w: Wb, sheetId: string, oldName: string | null, next: TableModel | null): void {
  const sheet = sheetById(w, sheetId);
  const list = sheetTables(sheet);
  let out = oldName ? list.filter((t) => tableName(t).toUpperCase() !== oldName.toUpperCase()) : [...list];
  if (next) {
    const i = oldName ? list.findIndex((t) => tableName(t).toUpperCase() === oldName.toUpperCase()) : -1;
    out = [...out];
    if (i >= 0) out.splice(Math.min(i, out.length), 0, next);
    else out.push(next);
  }
  patchSheet(w, sheetId, { grownTables: out });
  // The patch lands with FortuneSheet's next update: pass the new list on.
  syncTableFilter(w, sheetId, out);
  invalidatePaint();
}

// Cells written here: their afterUpdateCell echoes are not user edits.
const ownWrites = new Set<string>();

function write(w: Wb, sheetId: string, writes: TableWrite[]) {
  for (const x of writes) ownWrites.add(`${sheetId}:${x.r}:${x.c}`);
  window.setTimeout(() => {
    for (const x of writes) ownWrites.delete(`${sheetId}:${x.r}:${x.c}`);
  }, 1000);
  const sets = writes.filter((x) => x.cell);
  if (sets.length) writeCells(w, sets.map((x) => ({ r: x.r, c: x.c, cell: x.cell })), sheetId);
  for (const x of writes) {
    if (x.cell) continue;
    try {
      w.clearCell(x.r, x.c, { id: sheetId });
    } catch {
      /* already empty */
    }
  }
}

function formulaWrites(w: Wb, edits: { sheetId: string; r: number; c: number; f: string }[]) {
  const bySheet = new Map<string, TableWrite[]>();
  for (const e of edits) {
    const sheet = sheetById(w, e.sheetId);
    const old = sheet?.data?.[e.r]?.[e.c];
    const list = bySheet.get(e.sheetId) ?? [];
    list.push({ r: e.r, c: e.c, cell: { ...(old ?? {}), f: e.f } });
    bySheet.set(e.sheetId, list);
  }
  for (const [sheetId, list] of bySheet) write(w, sheetId, list);
}

/** The first row of a table's header filter: header row + data rows. */
export function syncTableFilter(w: Wb, sheetId: string, list?: TableModel[]): void {
  const sheet = sheetById(w, sheetId);
  const cur = currentSheet(w);
  if (!sheet || cur?.id !== sheetId) return; // filters apply to the active sheet
  const tables = list ?? sheetTables(sheet);
  const filter = sheetFilter(sheet);
  if (filter && !filter.table) return; // a plain sheet filter owns the buttons
  if (filter?.table) {
    const t = tables.find((x) => tableName(x).toUpperCase() === filter.table!.toUpperCase());
    if (!t || !t.autoFilter) {
      applyFilter(w, null);
    } else {
      const range = filterRect(t);
      if (JSON.stringify(range) !== JSON.stringify(filter.range) || filter.table !== tableName(t)) applyFilter(w, { ...filter, range, table: tableName(t) });
      return;
    }
  }
  const owner = tables.find((t) => t.autoFilter);
  if (owner) applyFilter(w, { range: filterRect(owner), columns: {}, table: tableName(owner) });
}

// ---- actions ------------------------------------------------------------------------------------

/** Insert ▸ Table / Format as table over range. Returns an error message or null. */
export function insertTable(w: Wb, range: CellRect, hasHeaders: boolean, style: string): string | null {
  const sheet = currentSheet(w);
  if (!sheet?.id) return "No sheet.";
  const res = createTable({
    range,
    hasHeaders,
    style,
    taken: takenNames(w),
    allTables: workbookTables(w).map((x) => x.table),
    sheetTables: sheetTables(sheet),
    get: getter(sheet),
  });
  if (typeof res === "string") return res;
  if (res.insertHeaderRow) {
    // A header row goes above the data: the range's cells move down one row.
    applyWholeSheetOp(w, { kind: "insertCells", sheet: String(sheet.name), rect: { ...res.table.ref, r2: res.table.ref.r1 }, shift: "down" });
  }
  write(w, sheet.id, res.writes);
  // A plain sheet filter over the same cells becomes the table's.
  const f = sheetFilter(currentSheet(w));
  if (f && !f.table && f.range.r1 === res.table.ref.r1 && f.range.c1 === res.table.ref.c1) applyFilter(w, null);
  saveTable(w, sheet.id, null, res.table);
  // Outside the update in progress (FortuneSheet's setSelection mutates its
  // argument, which fails on frozen state while React replays the update).
  const ref = res.table.ref;
  window.setTimeout(() => {
    try {
      w.setSelection([{ row: [ref.r1, ref.r2], column: [ref.c1, ref.c2] }], { id: sheet.id });
    } catch {
      /* the table is made either way */
    }
  }, 0);
  return null;
}

function locate(w: Wb, name: string) {
  const hit = findTable(w, name);
  return hit ? { sheetId: String(hit.sheet.id), sheet: hit.sheet, table: hit.table } : null;
}

/** Table ▸ Total row on/off (Ctrl+Shift+R). */
export function toggleTotalsRow(w: Wb, name: string, on?: boolean): void {
  const hit = locate(w, name);
  if (!hit) return;
  const want = on ?? !hit.table.totalsRowCount;
  let res = setTotalsRow(hit.table, want, getter(hit.sheet));
  if (res.insertRow) {
    const t = hit.table;
    applyWholeSheetOp(w, { kind: "insertCells", sheet: String(hit.sheet.name), rect: { r1: t.ref.r2 + 1, r2: t.ref.r2 + 1, c1: t.ref.c1, c2: t.ref.c2 }, shift: "down" });
    const again = locate(w, name);
    if (!again) return;
    res = setTotalsRow(again.table, want, getter(again.sheet));
  }
  write(w, hit.sheetId, res.writes);
  saveTable(w, hit.sheetId, name, res.table);
}

export function setTableOptions(w: Wb, name: string, patch: Partial<NonNullable<TableModel["style"]>> & { autoFilter?: boolean }): void {
  const hit = locate(w, name);
  if (!hit) return;
  const { autoFilter, ...style } = patch;
  let t = Object.keys(style).length ? setStyle(hit.table, style) : hit.table;
  if (autoFilter !== undefined) t = { ...t, autoFilter };
  if (autoFilter === false) {
    const f = sheetFilter(currentSheet(w));
    if (f?.table && f.table.toUpperCase() === name.toUpperCase()) applyFilter(w, null);
  }
  if (autoFilter === true) {
    // Take the sheet's filter buttons over (one filter per sheet).
    const f = sheetFilter(currentSheet(w));
    if (f && f.table?.toUpperCase() !== name.toUpperCase()) applyFilter(w, null);
    saveTable(w, hit.sheetId, name, t);
    if (currentSheet(w)?.id === hit.sheetId) applyFilter(w, { range: filterRect(t), columns: {}, table: tableName(t) });
    return;
  }
  saveTable(w, hit.sheetId, name, t);
}

export function setColumnTotal(w: Wb, name: string, index: number, fn: TotalsFunction): void {
  const hit = locate(w, name);
  if (!hit) return;
  const res = setTotalsFunction(hit.table, index, fn);
  write(w, hit.sheetId, res.writes);
  saveTable(w, hit.sheetId, name, res.table);
}

/** Rename; formulas everywhere follow. Returns an error message or null. */
export function renameTable(w: Wb, name: string, next: string): string | null {
  const hit = locate(w, name);
  if (!hit) return "No such table.";
  if (next === tableName(hit.table)) return null;
  const err = tableNameError(next, takenNames(w, name));
  if (err) return err;
  formulaWrites(w, renameTableFormulas(allSheets(w), tableName(hit.table), next));
  saveTable(w, hit.sheetId, name, { ...hit.table, name: next, displayName: next });
  const f = sheetFilter(currentSheet(w));
  if (f?.table && f.table.toUpperCase() === name.toUpperCase()) applyFilter(w, { ...f, table: next });
  return null;
}

/** Resize to a new range (A1 or rect). Returns an error message or null. */
export function resizeTableTo(w: Wb, name: string, rect: CellRect): string | null {
  const hit = locate(w, name);
  if (!hit) return "No such table.";
  const res = resizeTable(hit.table, rect, getter(hit.sheet), sheetTables(hit.sheet));
  if (typeof res === "string") return res;
  write(w, hit.sheetId, res.writes);
  if (res.removed.length) formulaWrites(w, dropColumnFormulas(allSheets(w), { [tableName(hit.table)]: res.removed }));
  saveTable(w, hit.sheetId, name, res.table);
  return null;
}

/** Convert to range: references become A1, the look stays as formatting. */
export function convertTableToRange(w: Wb, name: string): void {
  const hit = locate(w, name);
  if (!hit) return;
  const res = convertToRange(allSheets(w), hit.table, getter(hit.sheet));
  formulaWrites(w, res.edits);
  const sheet = sheetById(w, hit.sheetId);
  const fmt = res.formats.map((x) => {
    const cur = sheet?.data?.[x.r]?.[x.c];
    const cell: any = { ...(cur ?? {}) };
    if (x.bg) cell.bg = x.bg;
    if (x.fc) cell.fc = x.fc;
    if (x.bl) cell.bl = x.bl;
    return { r: x.r, c: x.c, cell };
  });
  write(w, hit.sheetId, fmt);
  const f = sheetFilter(currentSheet(w));
  if (f?.table && f.table.toUpperCase() === name.toUpperCase()) applyFilter(w, { ...f, table: undefined });
  saveTable(w, hit.sheetId, name, null);
}

/** Deletes the table and its cells; references to it become #REF!. */
export function deleteTable(w: Wb, name: string): void {
  const hit = locate(w, name);
  if (!hit) return;
  const t = hit.table;
  const clears: TableWrite[] = [];
  for (let r = t.ref.r1; r <= t.ref.r2; r++) for (let c = t.ref.c1; c <= t.ref.c2; c++) clears.push({ r, c, cell: null });
  write(w, hit.sheetId, clears);
  formulaWrites(w, dropColumnFormulas(allSheets(w), { [tableName(t)]: "*" }));
  const f = sheetFilter(currentSheet(w));
  if (f?.table && f.table.toUpperCase() === name.toUpperCase()) applyFilter(w, null);
  saveTable(w, hit.sheetId, name, null);
}

/** Selects part of a table: the data rows, or all of it. */
export function selectTable(w: Wb, name: string, part: "data" | "all" = "data"): void {
  const hit = locate(w, name);
  if (!hit) return;
  const rc = part === "data" ? dataRect(hit.table) : hit.table.ref;
  try {
    if (currentSheet(w)?.id !== hit.sheetId) w.activateSheet?.({ id: hit.sheetId });
  } catch {
    /* ignore */
  }
  window.setTimeout(() => {
    try {
      w.setSelection([{ row: [rc.r1, rc.r2], column: [rc.c1, rc.c2] }], { id: hit.sheetId });
    } catch {
      /* ignore */
    }
  }, 0);
}

// ---- following edits ------------------------------------------------------------------------------

let applying = false;

/**
 * After a cell edit (FortuneSheet's afterUpdateCell): a header edit renames
 * the column (formulas follow), a formula in a data cell of an empty or
 * calculated column fills the column, a value typed in a calculated column
 * ends it, typed structured references take the edit form, and a value typed
 * just below or right of a table expands it.
 */
export function afterTableEdit(w: Wb, r: number, c: number, newValue: any): void {
  if (applying || !w) return;
  const sheet = currentSheet(w);
  if (!sheet?.id) return;
  if (ownWrites.has(`${sheet.id}:${r}:${c}`)) return;
  const tables = sheetTables(sheet);
  const get = getter(sheet);
  const cell = get(r, c);
  const f = typeof cell?.f === "string" && cell.f.startsWith("=") ? cell.f : null;
  applying = true;
  try {
    // Typed structured references: [[#This Row],[Qty]] → [@Qty].
    if (f && structuredTokens(f).length && structuredRefsValid(f)) {
      const norm = normalizeStructuredRefs(f, "edit");
      if (norm !== f) write(w, sheet.id, [{ r, c, cell: { ...cell, f: norm } }]);
    }
    const t = tableAt(tables, r, c);
    if (t) {
      const name = tableName(t);
      if (t.headerRowCount && r === t.ref.r1) {
        const res = headerEdited(t, c, cellDisplay(cell));
        if (!res) return;
        write(w, sheet.id, res.writes);
        if (res.from !== res.to) {
          formulaWrites(w, renameColumnFormulas(allSheets(w), name, res.from, res.to));
          saveTable(w, sheet.id, name, res.table);
        }
        return;
      }
      if (t.totalsRowCount && r === t.ref.r2) {
        const i = c - t.ref.c1;
        const fn = f ? totalsFunctionOf(f) : null;
        const columns = t.columns.map((col, k) => {
          if (k !== i) return col;
          const out = { ...col };
          delete out.totalsRowFunction;
          delete out.totalsRowLabel;
          delete out.totalsRowFormula;
          if (fn) out.totalsRowFunction = fn;
          else if (f) {
            out.totalsRowFunction = "custom";
            out.totalsRowFormula = f;
          } else if (cellDisplay(cell)) out.totalsRowLabel = cellDisplay(cell);
          return out;
        });
        saveTable(w, sheet.id, name, { ...t, columns });
        return;
      }
      const cur = get(r, c);
      const formula = typeof cur?.f === "string" && cur.f.startsWith("=") ? cur.f : null;
      if (formula) {
        const res = calculatedColumnFill(t, r, c, formula, get);
        if (res) {
          write(w, sheet.id, res.writes);
          saveTable(w, sheet.id, name, res.table);
        }
      } else if (t.columns[c - t.ref.c1]?.calculatedColumnFormula && newValue !== undefined) {
        saveTable(w, sheet.id, name, clearCalculated(t, c));
      }
      return;
    }
    if (cellDisplay(cell) === "" && !f) return;
    for (const tt of tables) {
      const res = autoExpand(tt, r, c, get);
      if (!res) continue;
      if (tables.some((o) => o !== tt && o.ref.r1 <= res.table.ref.r2 && res.table.ref.r1 <= o.ref.r2 && o.ref.c1 <= res.table.ref.c2 && res.table.ref.c1 <= o.ref.c2)) continue;
      write(w, sheet.id, res.writes);
      saveTable(w, sheet.id, tableName(tt), res.table);
      break;
    }
  } catch (err) {
    console.warn("table update failed", err);
  } finally {
    applying = false;
  }
}

/** The reference a selection inside a table stands for (Table1[Col]…), or null. */
export function selectionReference(w: Wb, active: { r: number; c: number }, sel: CellRect): string | null {
  const t = tableAt(sheetTables(currentSheet(w)), sel.r1, sel.c1);
  return t ? tableSelectionString(tableShape(t), active, sel) : null;
}

// ---- painting ------------------------------------------------------------------------------------

interface PaintCache {
  sheetId: string | null;
  tables: TableModel[];
  zoom: number;
  gridlines: boolean;
}

const paint: PaintCache = { sheetId: null, tables: [], zoom: 1, gridlines: true };
let paintWb: () => Wb = () => null;

export function bindTableTools(getWb: () => Wb): void {
  paintWb = getWb;
}

export function invalidatePaint(): void {
  paint.sheetId = null;
}

function refreshPaint(cells: unknown): void {
  const w = paintWb();
  const sheet = allSheets(w).find((s) => s?.data === cells) ?? currentSheet(w);
  paint.sheetId = sheet?.id ?? null;
  paint.tables = sheetTables(sheet);
  const v = sheetViewOptions(sheet);
  paint.zoom = v.zoom || 1;
  paint.gridlines = v.showGridLines !== false;
}

type CellInfo = { row: number; column: number; startX: number; startY: number; endX: number; endY: number };

function strokeLine(ctx: CanvasRenderingContext2D, color: string, x1: number, y1: number, x2: number, y2: number, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** Paints a header/totals cell (or a data cell with a style text colour) and its gridlines. */
function paintCell(cell: any, look: CellLook, info: CellInfo, ctx: CanvasRenderingContext2D): void {
  const w = info.endX - info.startX;
  const h = info.endY - info.startY;
  const zoom = paint.zoom;
  ctx.save();
  ctx.beginPath();
  ctx.rect(info.startX, info.startY, w, h);
  ctx.clip();
  ctx.fillStyle = cell?.bg || look.fill || "#ffffff";
  ctx.fillRect(info.startX, info.startY, w, h);
  if (paint.gridlines) {
    strokeLine(ctx, "#dfdfdf", info.endX - 0.5, info.startY, info.endX - 0.5, info.endY);
    strokeLine(ctx, "#dfdfdf", info.startX, info.endY - 0.5, info.endX, info.endY - 0.5);
  }
  const text = cell ? cellDisplay(cell) : "";
  if (text) {
    const size = Math.max(6, Math.round((Number(cell?.fs) || 10) * (4 / 3) * zoom));
    ctx.fillStyle = cell?.fc || look.text || "#000000";
    // FortuneSheet's default face is the first of its font list (Times New Roman).
    const ff = typeof cell?.ff === "string" && cell.ff && !/^\d+$/.test(cell.ff) ? `"${cell.ff.replace(/"/g, "")}"` : '"Times New Roman"';
    ctx.font = `${cell?.it ? "italic " : ""}${look.bold || cell?.bl ? "bold " : ""}${size}px ${ff}, "Helvetica Neue", Helvetica, Arial, sans-serif`;
    const ht = effectiveHorizontalAlign(cell);
    ctx.textAlign = ht === "0" ? "center" : ht === "2" ? "right" : "left";
    ctx.textBaseline = "middle";
    const x = ht === "0" ? info.startX + w / 2 : ht === "2" ? info.endX - 3 * zoom : info.startX + 3 * zoom;
    ctx.fillText(text, x, info.startY + h / 2 + 1);
  }
  ctx.restore();
}

/** Lines a style draws: under the header, above the totals row (double), around the table. */
function paintLines(t: TableModel, look: CellLook, info: CellInfo, ctx: CanvasRenderingContext2D): void {
  ctx.save();
  if (look.bottom) strokeLine(ctx, look.bottom, info.startX, info.endY - 0.5, info.endX, info.endY - 0.5, Math.max(1, paint.zoom));
  if (look.top) {
    strokeLine(ctx, look.top, info.startX, info.startY + 0.5, info.endX, info.startY + 0.5);
    if (look.topDouble) strokeLine(ctx, look.top, info.startX, info.startY + 2.5, info.endX, info.startY + 2.5);
  }
  if (look.outline) {
    if (info.row === t.ref.r1) strokeLine(ctx, look.outline, info.startX, info.startY + 0.5, info.endX, info.startY + 0.5);
    if (info.row === t.ref.r2) strokeLine(ctx, look.outline, info.startX, info.endY - 0.5, info.endX, info.endY - 0.5);
  }
  ctx.restore();
}

/** Render hooks: the table style under CF (CF fills paint over it; cell fills win). */
export const tableRenderHooks = {
  beforeRenderCellArea: (cells: unknown) => {
    try {
      refreshPaint(cells);
    } catch {
      paint.tables = [];
    }
  },
  beforeRenderCell: (cell: any, info: CellInfo, ctx: CanvasRenderingContext2D): boolean => {
    if (!paint.tables.length) return true;
    const t = tableAt(paint.tables, info.row, info.column);
    if (!t) return true;
    const look = tableCellLook(t, info.row, info.column);
    if (!look) return true;
    const edge = (t.headerRowCount && info.row === t.ref.r1) || (t.totalsRowCount && info.row === t.ref.r2);
    if (edge || (look.text && !cell?.fc)) {
      paintCell(cell, look, info, ctx);
      paintLines(t, look, info, ctx);
      return false;
    }
    if (look.fill && !cell?.bg) ctx.fillStyle = look.fill;
    return true;
  },
  afterRenderCell: (_cell: any, info: CellInfo, ctx: CanvasRenderingContext2D): void => {
    if (!paint.tables.length) return;
    const t = tableAt(paint.tables, info.row, info.column);
    const look = t && tableCellLook(t, info.row, info.column);
    if (t && look && (look.outline || look.bottom || look.top)) paintLines(t, look, info, ctx);
  },
};

/** For tests and the e2e: the tables painted last. */
export function paintedTables(): { sheetId: string | null; names: string[] } {
  return { sheetId: paint.sheetId, names: paint.tables.map(tableName) };
}
