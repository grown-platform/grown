/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet API and models are loosely typed. */

// FortuneSheet glue for filters (filterOps.ts), conditional formatting
// (cfOps.ts) and data validation (validationOps.ts).
//
// Models live on each sheet object: `grownFilter`, `grownCF`, `grownDV`, and
// a `grownCircleInvalid` flag. They are written with applyOp "replace" patches
// (no undo entry) and the same ops are sent to collaborators. FortuneSheet's
// own fields are derived from them:
//   - `luckysheet_conditionformat_save`: font-colour entries (FortuneSheet
//     paints text colour itself)
//   - `dataVerification`: per-cell entries for dropdowns, checkboxes, hints
//   - `filter_select` / `filter` / `config.rowhidden`: filter buttons and rows
// Fills, colour scales, data bars, icons and invalid-data circles are painted
// by the render hooks in dataToolHooks.

import {
  evaluateCF,
  fromFortuneRules,
  toFortuneRules,
  ICON_SETS,
  type CfCellResult,
  type CfRule,
  type IconGlyph,
} from "./cfOps";
import {
  checkValue,
  errorMessage,
  fromFortuneVerification,
  inputDecision,
  inputValue,
  invalidCells,
  toFortuneVerification,
  validationAt,
  type DvRule,
} from "./validationOps";
import { hiddenRows, setColumnFilter, sortByColumn, type FilterState } from "./filterOps";
import { typedCell, type Grid } from "./cellValue";

type Wb = any;

/** Sparse celldata ([{r, c, v}]) → a dense grid, for sheets not loaded yet. */
function cellValueGrid(celldata: unknown): Grid {
  const g: Grid = [];
  for (const x of Array.isArray(celldata) ? celldata : []) {
    if (!x || typeof x.r !== "number" || typeof x.c !== "number") continue;
    (g[x.r] ??= [])[x.c] = x.v ?? null;
  }
  return g;
}
type Send = (ops: any[]) => void;

interface Binding {
  getWb: () => Wb;
  send: Send;
}

let binding: Binding | null = null;

/** Connects the hooks to the editor's workbook ref and collaboration sender. */
export function bindDataTools(getWb: () => Wb, send: Send): () => void {
  binding = { getWb, send };
  return () => {
    if (binding?.getWb === getWb) binding = null;
  };
}

function wb(): Wb {
  try {
    return binding?.getWb() ?? null;
  } catch {
    return null;
  }
}

// ---- reading the models --------------------------------------------------------------

export function sheetById(w: Wb, id: string | undefined): any {
  const all: any[] = w?.getAllSheets?.() ?? [];
  return all.find((s) => s.id === id) ?? null;
}

/** The active sheet (FortuneSheet's getSheet() also rebuilds celldata, so read it once). */
export function currentSheet(w: Wb): any {
  try {
    const s = w?.getSheet?.();
    return sheetById(w, s?.id) ?? s;
  } catch {
    return null;
  }
}

export function sheetCF(sheet: any): CfRule[] {
  return Array.isArray(sheet?.grownCF) ? sheet.grownCF : [];
}
export function sheetDV(sheet: any): DvRule[] {
  return Array.isArray(sheet?.grownDV) ? sheet.grownDV : [];
}
export function sheetFilter(sheet: any): FilterState | null {
  const f = sheet?.grownFilter;
  return f && f.range ? f : null;
}

function otherSheets(w: Wb, exceptId?: string): Record<string, Grid> {
  const out: Record<string, Grid> = {};
  for (const s of (w?.getAllSheets?.() ?? []) as any[]) {
    if (!s || s.id === exceptId) continue;
    out[s.name] = Array.isArray(s.data) ? s.data : cellValueGrid(s.celldata);
  }
  return out;
}

function namedRanges(w: Wb): Record<string, string> {
  const first = (w?.getAllSheets?.() ?? [])[0];
  const out: Record<string, string> = {};
  for (const nr of Array.isArray(first?._namedRanges) ? first._namedRanges : []) {
    if (!nr?.name || !nr?.range) continue;
    const sheet = String(nr.sheetName ?? "");
    const q = /^[A-Za-z_][\w.]*$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`;
    out[nr.name] = sheet ? `${q}!${nr.range}` : nr.range;
  }
  return out;
}

// ---- writing ----------------------------------------------------------------------------

/** Replaces top-level fields of a sheet; broadcast sends the ops to collaborators. */
/**
 * Writes cells without an undo step (applyOp is FortuneSheet's remote-op
 * path) and relays them to collaborators: for values the editor derives from
 * an edit the user already made (the typed-input reading), so one Ctrl+Z
 * undoes the edit as a whole.
 */
export function writeCellsQuietly(w: Wb, sheetId: string, cells: { r: number; c: number; value: any }[]): void {
  const ops = cells.map(({ r, c, value }) => ({ op: "replace", id: sheetId, path: ["data", r, c], value }));
  if (!ops.length) return;
  w.applyOp(ops);
  binding?.send(ops);
}

export function patchSheet(w: Wb, sheetId: string, fields: Record<string, unknown>, broadcast = true): void {
  const ops = Object.entries(fields).map(([k, value]) => ({ op: "replace", id: sheetId, path: [k], value }));
  if (!ops.length) return;
  try {
    w.applyOp(ops);
  } catch {
    return;
  }
  if (broadcast) binding?.send(ops);
}

function sheetSize(sheet: any): { rows: number; cols: number } {
  const data: Grid = Array.isArray(sheet?.data) ? sheet.data : [];
  return {
    rows: Math.max(data.length, Number(sheet?.row) || 0, 100),
    cols: Math.max(data[0]?.length ?? 0, Number(sheet?.column) || 0, 26),
  };
}

/** Saves CF rules on a sheet and refreshes the derived FortuneSheet entries. */
export function setSheetCF(w: Wb, sheetId: string, rules: CfRule[]): void {
  const sheet = sheetById(w, sheetId);
  const grid: Grid = Array.isArray(sheet?.data) ? sheet.data : [];
  const derived = toFortuneRules(evaluateCF(rules, grid, { sheets: otherSheets(w, sheetId), names: namedRanges(w) }));
  patchSheet(w, sheetId, { grownCF: rules, luckysheet_conditionformat_save: derived });
}

/** Saves validation rules on a sheet and refreshes FortuneSheet's per-cell map. */
export function setSheetDV(w: Wb, sheetId: string, rules: DvRule[]): void {
  const sheet = sheetById(w, sheetId);
  const { rows, cols } = sheetSize(sheet);
  patchSheet(w, sheetId, { grownDV: rules, dataVerification: toFortuneVerification(rules, rows, cols) });
}

export function setCircleInvalid(w: Wb, sheetId: string, on: boolean): void {
  patchSheet(w, sheetId, { grownCircleInvalid: on }, false);
}

/**
 * Keeps derived fields in step after an edit: adopts rules FortuneSheet's own
 * toolbar dialogs added, and refreshes CF font-colour entries when values
 * change. Returns true when it wrote something.
 */
export function syncDerived(w: Wb): boolean {
  const sheet = currentSheet(w);
  if (!sheet?.id) return false;
  let wrote = false;
  const native: any[] = Array.isArray(sheet.luckysheet_conditionformat_save) ? sheet.luckysheet_conditionformat_save : [];
  let cf = sheetCF(sheet);
  const adoptedCF = fromFortuneRules(native);
  if (adoptedCF.length) {
    const base = cf.reduce((m, r) => Math.max(m, r.priority), 0);
    cf = [...cf, ...adoptedCF.map((r, i) => ({ ...r, priority: base + i + 1 }))];
    setSheetCF(w, sheet.id, cf);
    wrote = true;
  } else if (cf.length || native.length) {
    const grid: Grid = Array.isArray(sheet.data) ? sheet.data : [];
    const derived = cf.length
      ? toFortuneRules(evaluateCF(cf, grid, { sheets: otherSheets(w, sheet.id), names: namedRanges(w) }))
      : [];
    if (JSON.stringify(derived) !== JSON.stringify(native)) {
      patchSheet(w, sheet.id, { luckysheet_conditionformat_save: derived }, false);
      wrote = true;
    }
  }
  const adoptedDV = fromFortuneVerification(sheet.dataVerification);
  if (adoptedDV.length) {
    // Rules made in FortuneSheet's own dialog replace Grown rules on those cells.
    let dv = sheetDV(sheet);
    for (const r of adoptedDV) for (const g of r.ranges) dv = dv.filter((x) => !x.ranges.some((y) => overlaps(y, g)));
    setSheetDV(w, sheet.id, [...dv, ...adoptedDV]);
    wrote = true;
  }
  const filter = sheetFilter(sheet);
  if (filter && !sheet.filter_select) {
    // The filter was removed (toolbar or Data ▸ Create a filter toggle): drop the model.
    clearFilterRows(w, sheet, filter);
    patchSheet(w, sheet.id, { grownFilter: null });
    wrote = true;
  }
  return wrote;
}

function overlaps(a: { r1: number; c1: number; r2: number; c2: number }, b: { r1: number; c1: number; r2: number; c2: number }): boolean {
  return a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;
}

/**
 * Load-time migration of a stored workbook: FortuneSheet-native CF rules and
 * validation entries (older Grown sheets) become Grown rules, and the derived
 * fields are rebuilt. Pure; returns new sheet objects.
 */
export function migrateWorkbook(sheets: any[]): any[] {
  if (!Array.isArray(sheets)) return sheets;
  return sheets.map((s) => {
    if (!s || typeof s !== "object") return s;
    const out = { ...s };
    const native: any[] = Array.isArray(s.luckysheet_conditionformat_save) ? s.luckysheet_conditionformat_save : [];
    const adopted = fromFortuneRules(native);
    if (adopted.length || native.some((x) => x?.grownDerived)) {
      const cf = sheetCF(s);
      const base = cf.reduce((m, r) => Math.max(m, r.priority), 0);
      out.grownCF = [...cf, ...adopted.map((r, i) => ({ ...r, priority: base + i + 1 }))];
      // Derived font-colour entries are rebuilt after the first paint.
      out.luckysheet_conditionformat_save = native.filter((x) => x?.grownDerived);
    }
    const dvAdopted = fromFortuneVerification(s.dataVerification);
    if (dvAdopted.length) {
      out.grownDV = [...sheetDV(s), ...dvAdopted];
    }
    if (Array.isArray(out.grownDV) && out.grownDV.length) {
      const { rows, cols } = sheetSize(s);
      out.dataVerification = toFortuneVerification(out.grownDV, rows, cols);
    }
    return out;
  });
}

// ---- filters ----------------------------------------------------------------------------

function clearFilterRows(w: Wb, sheet: any, state: FilterState): void {
  const rowhidden = sheet?.config?.rowhidden ?? {};
  const show: string[] = [];
  for (let r = state.range.r1 + 1; r <= state.range.r2; r++) if (String(r) in rowhidden) show.push(String(r));
  if (show.length) {
    try {
      w.showRowOrColumn(show, "row");
    } catch {
      /* ignore */
    }
  }
}

/**
 * Stores a filter on the active sheet and applies it: rows the criteria
 * reject are hidden, others in the range shown, and FortuneSheet's filter
 * buttons/state updated so its own menu composes with ours.
 */
export function applyFilter(w: Wb, state: FilterState | null, now?: Date): void {
  const sheet = currentSheet(w);
  if (!sheet?.id) return;
  const prev = sheetFilter(sheet);
  if (!state) {
    if (prev) clearFilterRows(w, sheet, prev);
    patchSheet(w, sheet.id, { grownFilter: null, filter_select: null, filter: null });
    return;
  }
  const grid: Grid = Array.isArray(sheet.data) ? sheet.data : [];
  const { r1, c1, r2, c2 } = state.range;
  const nativeFilter: Record<string, any> = {};
  for (const key of Object.keys(state.columns)) {
    const only: FilterState = { range: state.range, columns: { [key]: state.columns[key] } };
    const rows = hiddenRows(grid, only, { now });
    const rowhidden: Record<string, number> = {};
    rows.forEach((r) => (rowhidden[String(r)] = 0));
    nativeFilter[key] = { caljs: {}, rowhidden, optionstate: true, cindex: c1 + Number(key), str: r1, edr: r2, stc: c1, edc: c2 };
  }
  patchSheet(w, sheet.id, {
    grownFilter: state,
    filter_select: { row: [r1, r2], column: [c1, c2] },
    filter: nativeFilter,
  });
  const hide = hiddenRows(grid, state, { now });
  const rowhidden = currentSheet(w)?.config?.rowhidden ?? {};
  const toHide: string[] = [];
  const toShow: string[] = [];
  for (let r = r1 + 1; r <= r2; r++) {
    const isHidden = String(r) in rowhidden;
    if (hide.has(r) && !isHidden) toHide.push(String(r));
    if (!hide.has(r) && isHidden) toShow.push(String(r));
  }
  try {
    if (toShow.length) w.showRowOrColumn(toShow, "row");
    if (toHide.length) w.hideRowOrColumn(toHide, "row");
  } catch {
    /* ignore */
  }
}

/** Sorts the filter range by a column (header stays) and re-applies the criteria. */
export function sortFilter(w: Wb, colId: number, desc: boolean): void {
  const sheet = currentSheet(w);
  const state = sheetFilter(sheet);
  if (!sheet || !state) return;
  const grid: Grid = Array.isArray(sheet.data) ? sheet.data : [];
  const res = sortByColumn(grid, state, colId, desc);
  if (res.rows.length) {
    const width = res.rows[0].length;
    try {
      w.setCellValuesByRange(
        res.rows.map((row) => row.map((c) => c ?? null)),
        { row: [res.r1, res.r1 + res.rows.length - 1], column: [res.c1, res.c1 + width - 1] },
      );
    } catch {
      /* ignore */
    }
  }
  applyFilter(w, res.state);
}

export { setColumnFilter };

// ---- render & input hooks -----------------------------------------------------------------

interface RenderCache {
  data: unknown;
  cf: unknown;
  dv: unknown;
  circle: boolean;
  sheetId: string | null;
  result: Map<string, CfCellResult>;
  invalid: Set<string>;
}

const cache: RenderCache = {
  data: null,
  cf: null,
  dv: null,
  circle: false,
  sheetId: null,
  result: new Map(),
  invalid: new Set(),
};

/** The CF result last painted (for tests and the e2e check). */
export function lastRender(): { sheetId: string | null; cells: Record<string, CfCellResult>; invalid: string[] } {
  return { sheetId: cache.sheetId, cells: Object.fromEntries(cache.result), invalid: [...cache.invalid] };
}

function refresh(cells: Grid): void {
  const w = wb();
  if (!w) return;
  const all: any[] = w.getAllSheets?.() ?? [];
  const sheet = all.find((s) => s?.data === cells) ?? null;
  if (!sheet) return;
  const cf = sheet.grownCF ?? null;
  const dv = sheet.grownDV ?? null;
  const circle = !!sheet.grownCircleInvalid;
  if (cache.data === cells && cache.cf === cf && cache.dv === dv && cache.circle === circle && cache.sheetId === sheet.id)
    return;
  cache.data = cells;
  cache.cf = cf;
  cache.dv = dv;
  cache.circle = circle;
  cache.sheetId = sheet.id;
  const opts = { sheets: otherSheets(w, sheet.id), names: namedRanges(w) };
  try {
    cache.result = Array.isArray(cf) && cf.length ? evaluateCF(cf, cells, opts) : new Map();
  } catch {
    cache.result = new Map();
  }
  cache.invalid = new Set();
  if (circle && Array.isArray(dv) && dv.length) {
    try {
      for (const p of invalidCells(dv, { grid: cells, ...opts })) cache.invalid.add(`${p.r}_${p.c}`);
    } catch {
      /* ignore */
    }
  }
}

type CellInfo = { row: number; column: number; startX: number; startY: number; endX: number; endY: number };

function drawBar(ctx: CanvasRenderingContext2D, res: CfCellResult, info: CellInfo): void {
  const b = res.bar!;
  const w = info.endX - info.startX;
  const h = info.endY - info.startY;
  const pad = 2;
  const x0 = info.startX + pad + (w - 2 * pad) * Math.min(b.x0, b.x1);
  const x1 = info.startX + pad + (w - 2 * pad) * Math.max(b.x0, b.x1);
  const y0 = info.startY + pad;
  const bh = Math.max(1, h - 2 * pad - 1);
  if (x1 - x0 > 0.5) {
    if (b.gradient) {
      const g = ctx.createLinearGradient(b.negative ? x1 : x0, 0, b.negative ? x0 : x1, 0);
      g.addColorStop(0, b.color);
      g.addColorStop(1, "#ffffff");
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = b.color;
    }
    ctx.fillRect(x0, y0, x1 - x0, bh);
    if (b.border) {
      ctx.strokeStyle = b.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, bh - 1);
    }
  }
  if (b.axis !== null) {
    const ax = info.startX + pad + (w - 2 * pad) * b.axis;
    ctx.strokeStyle = b.axisColor;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(ax + 0.5, info.startY);
    ctx.lineTo(ax + 0.5, info.endY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Draws one icon glyph in a square box at (x, y). */
export function drawIcon(ctx: CanvasRenderingContext2D, g: IconGlyph, x: number, y: number, s: number): void {
  const cx = x + s / 2;
  const cy = y + s / 2;
  const r = s / 2 - 1;
  ctx.save();
  ctx.fillStyle = g.color;
  ctx.strokeStyle = g.color;
  ctx.lineWidth = Math.max(1.5, s / 7);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const arrow = (angle: number) => {
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, r);
    ctx.lineTo(0, -r + 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, -r * 0.1);
    ctx.lineTo(0, -r);
    ctx.lineTo(r * 0.7, -r * 0.1);
    ctx.stroke();
  };
  switch (g.shape) {
    case "arrowUp":
      arrow(0);
      break;
    case "arrowUpRight":
      arrow(Math.PI / 4);
      break;
    case "arrowRight":
      arrow(Math.PI / 2);
      break;
    case "arrowDownRight":
      arrow((3 * Math.PI) / 4);
      break;
    case "arrowDown":
      arrow(Math.PI);
      break;
    case "circle":
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "diamond":
      ctx.beginPath();
      ctx.moveTo(cx, y + 1);
      ctx.lineTo(x + s - 1, cy);
      ctx.lineTo(cx, y + s - 1);
      ctx.lineTo(x + 1, cy);
      ctx.closePath();
      ctx.fill();
      break;
    case "triangle":
    case "triUp":
      ctx.beginPath();
      ctx.moveTo(cx, y + 1);
      ctx.lineTo(x + s - 1, y + s - 2);
      ctx.lineTo(x + 1, y + s - 2);
      ctx.closePath();
      ctx.fill();
      break;
    case "triDown":
      ctx.beginPath();
      ctx.moveTo(x + 1, y + 2);
      ctx.lineTo(x + s - 1, y + 2);
      ctx.lineTo(cx, y + s - 1);
      ctx.closePath();
      ctx.fill();
      break;
    case "dash":
      ctx.fillRect(x + 2, cy - s / 8, s - 4, s / 4);
      break;
    case "flag":
      ctx.fillRect(x + 2, y + 1, 1.5, s - 2);
      ctx.beginPath();
      ctx.moveTo(x + 3.5, y + 1);
      ctx.lineTo(x + s - 1, y + s * 0.3);
      ctx.lineTo(x + 3.5, y + s * 0.6);
      ctx.closePath();
      ctx.fill();
      break;
    case "check":
      ctx.beginPath();
      ctx.moveTo(x + 2, cy);
      ctx.lineTo(cx - 1, y + s - 3);
      ctx.lineTo(x + s - 2, y + 3);
      ctx.stroke();
      break;
    case "cross":
      ctx.beginPath();
      ctx.moveTo(x + 3, y + 3);
      ctx.lineTo(x + s - 3, y + s - 3);
      ctx.moveTo(x + s - 3, y + 3);
      ctx.lineTo(x + 3, y + s - 3);
      ctx.stroke();
      break;
    case "excl":
      ctx.fillRect(cx - 1, y + 2, 2, s * 0.5);
      ctx.fillRect(cx - 1, y + s - 4, 2, 2);
      break;
    case "star":
    case "starHalf":
    case "starEmpty": {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? r : r * 0.45;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        ctx.lineTo(cx + rad * Math.cos(a), cy + rad * Math.sin(a));
      }
      ctx.closePath();
      ctx.lineWidth = 1;
      ctx.stroke();
      if (g.shape === "star") ctx.fill();
      if (g.shape === "starHalf") {
        ctx.save();
        ctx.clip();
        ctx.fillRect(x, y, s / 2, s);
        ctx.restore();
      }
      break;
    }
    case "quarter": {
      const lvl = g.level ?? 0;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      if (lvl > 0) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (lvl / 4) * Math.PI * 2);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "bars": {
      const lvl = g.level ?? 0;
      const bw = (s - 2) / 4;
      for (let i = 0; i < 4; i++) {
        const bhh = ((i + 1) / 4) * (s - 2);
        ctx.globalAlpha = i < lvl ? 1 : 0.25;
        ctx.fillRect(x + 1 + i * bw, y + s - 1 - bhh, bw - 1, bhh);
      }
      break;
    }
    case "box": {
      const lvl = g.level ?? 0;
      const q = (s - 3) / 2;
      const cells = [
        [0, 1],
        [1, 1],
        [0, 0],
        [1, 0],
      ];
      cells.forEach(([i, j], k) => {
        ctx.globalAlpha = k < lvl ? 1 : 0.25;
        ctx.fillRect(x + 1 + i * (q + 1), y + 1 + j * (q + 1), q, q);
      });
      break;
    }
  }
  ctx.restore();
}

function drawGridLines(ctx: CanvasRenderingContext2D, info: CellInfo): void {
  ctx.strokeStyle = "#dfdfdf";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(info.endX - 0.5, info.startY);
  ctx.lineTo(info.endX - 0.5, info.endY);
  ctx.moveTo(info.startX, info.endY - 0.5);
  ctx.lineTo(info.endX, info.endY - 0.5);
  ctx.stroke();
}

function paintIconAndCircle(key: string, res: CfCellResult | undefined, info: CellInfo, ctx: CanvasRenderingContext2D) {
  if (res?.icon) {
    const glyphs = ICON_SETS[res.icon.set];
    const g = glyphs?.[res.icon.index];
    if (g) {
      const h = info.endY - info.startY;
      const s = Math.max(8, Math.min(14, h - 6));
      const x = res.hideValue ? info.startX + (info.endX - info.startX - s) / 2 : info.startX + 3;
      drawIcon(ctx, g, x, info.startY + (h - s) / 2, s);
    }
  }
  if (cache.invalid.has(key)) {
    ctx.save();
    ctx.strokeStyle = "#e53935";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const cx = (info.startX + info.endX) / 2;
    const cy = (info.startY + info.endY) / 2;
    ctx.ellipse(cx, cy, (info.endX - info.startX) / 2 - 1, (info.endY - info.startY) / 2 - 1, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function notify(kind: "error" | "info", title: string, message: string): void {
  try {
    window.dispatchEvent(new CustomEvent("grown-sheet-notice", { detail: { kind, title, message } }));
  } catch {
    /* ignore */
  }
}

/** Hooks for <Workbook hooks>: CF painting, invalid-data circles and validation on input. */
export const dataToolHooks = {
  beforeRenderCellArea: (cells: any, _ctx: CanvasRenderingContext2D) => {
    try {
      refresh(cells as Grid);
    } catch {
      /* ignore */
    }
    return true;
  },
  beforeRenderCell: (_cell: any, info: CellInfo, ctx: CanvasRenderingContext2D) => {
    const key = `${info.row}_${info.column}`;
    const res = cache.result.get(key);
    if (!res) return true;
    if (!res.bar && !res.hideValue) {
      if (res.fill) ctx.fillStyle = res.fill;
      return true;
    }
    ctx.save();
    if (res.fill) ctx.fillStyle = res.fill;
    ctx.fillRect(info.startX, info.startY, info.endX - info.startX, info.endY - info.startY);
    ctx.restore();
    if (res.bar) drawBar(ctx, res, info);
    if (res.hideValue) {
      // Bar/icon only: skip FortuneSheet's text for this cell.
      drawGridLines(ctx, info);
      paintIconAndCircle(key, res, info, ctx);
      return false;
    }
    ctx.fillStyle = "rgba(0,0,0,0)";
    return true;
  },
  afterRenderCell: (_cell: any, info: CellInfo, ctx: CanvasRenderingContext2D) => {
    const key = `${info.row}_${info.column}`;
    const res = cache.result.get(key);
    if (res?.hideValue) return;
    if (res?.icon || cache.invalid.size) paintIconAndCircle(key, res, info, ctx);
  },
  beforeUpdateCell: (r: number, c: number, value: any) => {
    const w = wb();
    if (!w) return true;
    try {
      const all: any[] = w.getAllSheets?.() ?? [];
      const sheet = all.find((s) => s.id === cache.sheetId) ?? currentSheet(w);
      const rules = sheetDV(sheet);
      if (!rules.length) return true;
      const rule = validationAt(rules, r, c);
      if (!rule) return true;
      const text = typeof value === "string" ? value : value == null ? "" : String(value);
      // Formulas are checked by value later ("Circle invalid data"); raw input here.
      if (text.startsWith("=")) return true;
      const data: Grid = Array.isArray(sheet?.data) ? sheet.data : [];
      const grid = data.slice();
      grid[r] = (data[r] ?? []).slice();
      grid[r][c] = typedCell(text);
      const ok = checkValue(rule, inputValue(text === "" ? null : text), r, c, {
        grid,
        sheets: otherSheets(w, sheet?.id),
        names: namedRanges(w),
      });
      const decision = inputDecision(rule, ok);
      const msg = errorMessage(rule);
      if (decision === "reject") {
        setTimeout(() => notify("error", msg.title, msg.message), 0);
        return false;
      }
      if (decision === "confirm") {
        return window.confirm(`${msg.title}\n\n${msg.message}\n\nContinue?`);
      }
      if (decision === "inform") setTimeout(() => notify("info", msg.title, msg.message), 0);
    } catch {
      /* never block input on an evaluator bug */
    }
    return true;
  },
};

export type { CfRule, DvRule, FilterState };
