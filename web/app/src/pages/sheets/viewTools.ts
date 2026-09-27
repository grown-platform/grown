/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet API and models are loosely typed. */

// FortuneSheet glue for M11: view options (show formulas, page-break
// preview) painted through the grid's render hooks, and protected sheets/
// ranges enforced on input, paste and relayed ops. Models: sheetView.ts,
// printSettings.ts, protection.ts.

import type { CellRect } from "./cellRange";
import { paginate, sheetGeometry, sheetPrintSettings } from "./printSettings";
import { blockingProtection, canEditCell, sheetProtection, type EditContext, type ProtectionModel } from "./protection";
import { sheetViewOptions, type SheetViewOptions } from "./sheetView";

type Wb = any;

let getWb: () => Wb = () => null;
let editCtx: EditContext = { user: "" };

/** Connects the hooks to the editor's workbook ref and the signed-in user. */
export function bindViewTools(get: () => Wb, ctx: EditContext): void {
  getWb = get;
  editCtx = ctx;
}

export function setEditContext(ctx: EditContext): void {
  editCtx = ctx;
}

export function editContext(): EditContext {
  return editCtx;
}

function activeSheet(): any {
  try {
    const w = getWb();
    const s = w?.getSheet?.();
    const all: any[] = w?.getAllSheets?.() ?? [];
    return all.find((x) => x?.id === s?.id) ?? s ?? null;
  } catch {
    return null;
  }
}

function notify(kind: "error" | "info", title: string, message: string): void {
  try {
    window.dispatchEvent(new CustomEvent("grown-sheet-notice", { detail: { kind, title, message } }));
  } catch {
    /* ignore */
  }
}

export function protectedNotice(what = "cell"): void {
  notify("error", "Protected", `This ${what} is protected. Ask the owner or an editor of the protected range for access.`);
}

// ---- render state (computed once per frame) --------------------------------------------

interface PageBreakState {
  range: CellRect | null;
  colEnds: Set<number>;
  rowEnds: Set<number>;
  manualCols: Set<number>;
  manualRows: Set<number>;
}

interface RenderState {
  sheetId: string | null;
  view: SheetViewOptions;
  breaks: PageBreakState | null;
  breaksKey: string;
}

const state: RenderState = {
  sheetId: null,
  view: sheetViewOptions({}),
  breaks: null,
  breaksKey: "",
};

let refreshedAt = 0;

/** Header cells may paint before the cell area in a frame: refresh when stale. */
function refreshIfStale(): void {
  if (Date.now() - refreshedAt > 100) {
    try {
      refresh();
    } catch {
      /* ignore */
    }
  }
}

function refresh(): void {
  refreshedAt = Date.now();
  const sheet = activeSheet();
  state.sheetId = sheet?.id ?? null;
  state.view = sheetViewOptions(sheet);
  if (!state.view.pageBreakPreview || !sheet) {
    state.breaks = null;
    state.breaksKey = "";
    return;
  }
  const ps = sheetPrintSettings(sheet);
  const cfg = sheet.config ?? {};
  // Recompute only when the settings, sizes or used range change.
  const geo = sheetGeometry(sheet);
  const key = JSON.stringify([ps, cfg.columnlen, cfg.rowlen, cfg.rowhidden, cfg.colhidden, geo.usedRange]);
  if (key === state.breaksKey && state.breaks) return;
  const p = paginate(geo, ps);
  state.breaksKey = key;
  state.breaks = {
    range: p.range,
    colEnds: new Set(p.pages.map((x) => x.range.c2)),
    rowEnds: new Set(p.pages.map((x) => x.range.r2)),
    manualCols: new Set(ps.fitToPage ? [] : ps.colBreaks.map((c) => c - 1)),
    manualRows: new Set(ps.fitToPage ? [] : ps.rowBreaks.map((r) => r - 1)),
  };
}

/** Forget cached pagination (after print settings change). */
export function invalidateView(): void {
  state.breaksKey = "";
  state.breaks = null;
}

interface CellInfo {
  row: number;
  column: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

function paintFormula(cell: any, info: CellInfo, ctx: CanvasRenderingContext2D): void {
  const w = info.endX - info.startX;
  const h = info.endY - info.startY;
  ctx.save();
  ctx.beginPath();
  ctx.rect(info.startX, info.startY, w, h);
  ctx.clip();
  ctx.fillStyle = cell?.bg || "#ffffff";
  ctx.fillRect(info.startX, info.startY, w, h);
  // Gridlines are part of the cell paint FortuneSheet skipped.
  if (state.view.showGridLines) {
    ctx.strokeStyle = "#dfdfdf";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(info.endX - 0.5, info.startY);
    ctx.lineTo(info.endX - 0.5, info.endY);
    ctx.moveTo(info.startX, info.endY - 0.5);
    ctx.lineTo(info.endX, info.endY - 0.5);
    ctx.stroke();
  }
  const zoom = state.view.zoom || 1;
  ctx.fillStyle = cell?.fc || "#000000";
  ctx.font = `${Math.round(13 * zoom)}px Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(String(cell.f), info.startX + 3 * zoom, info.startY + h / 2);
  ctx.restore();
}

function paintBreaks(info: CellInfo, ctx: CanvasRenderingContext2D): void {
  const b = state.breaks;
  if (!b) return;
  const r = b.range;
  const inside = !!r && info.row >= r.r1 && info.row <= r.r2 && info.column >= r.c1 && info.column <= r.c2;
  ctx.save();
  if (!inside) {
    ctx.fillStyle = "rgba(95, 99, 104, 0.12)";
    ctx.fillRect(info.startX, info.startY, info.endX - info.startX, info.endY - info.startY);
    ctx.restore();
    return;
  }
  ctx.lineWidth = 2;
  if (b.colEnds.has(info.column)) {
    ctx.strokeStyle = "#1a73e8";
    ctx.setLineDash(b.manualCols.has(info.column) || info.column === r!.c2 ? [] : [6, 4]);
    ctx.beginPath();
    ctx.moveTo(info.endX - 1, info.startY);
    ctx.lineTo(info.endX - 1, info.endY);
    ctx.stroke();
  }
  if (b.rowEnds.has(info.row)) {
    ctx.strokeStyle = "#1a73e8";
    ctx.setLineDash(b.manualRows.has(info.row) || info.row === r!.r2 ? [] : [6, 4]);
    ctx.beginPath();
    ctx.moveTo(info.startX, info.endY - 1);
    ctx.lineTo(info.endX, info.endY - 1);
    ctx.stroke();
  }
  ctx.restore();
}

// ---- protection ------------------------------------------------------------------------

function unlockedFn(sheet: any): (r: number, c: number) => boolean {
  const data: any[][] | undefined = Array.isArray(sheet?.data) ? sheet.data : undefined;
  return (r, c) => data?.[r]?.[c]?.lo === 0;
}

/** Whether the signed-in user may change (r, c) of the active sheet. */
export function canEditActive(r: number, c: number): boolean {
  const sheet = activeSheet();
  const model = sheetProtection(sheet);
  return canEditCell(model, r, c, editCtx, unlockedFn(sheet)(r, c));
}

/** The protection blocking a change of `rect` on the active sheet, or null. */
export function activeBlock(rect: CellRect): ReturnType<typeof blockingProtection> {
  const sheet = activeSheet();
  return blockingProtection(sheetProtection(sheet), rect, editCtx, unlockedFn(sheet));
}

/**
 * Cells that ops (FortuneSheet `onOp`) change although the user may not:
 * cell ops (`["data", r, c, …]`) on protected cells. Pure.
 */
export function blockedCellOps(ops: any[], sheets: any[], ctx: EditContext): { sheetId: string; r: number; c: number }[] {
  const out: { sheetId: string; r: number; c: number }[] = [];
  const models = new Map<string, { model: ProtectionModel; unlocked: (r: number, c: number) => boolean }>();
  for (const s of Array.isArray(sheets) ? sheets : []) {
    if (s?.grownProtection) models.set(String(s.id), { model: sheetProtection(s), unlocked: unlockedFn(s) });
  }
  if (!models.size) return out;
  for (const op of Array.isArray(ops) ? ops : []) {
    const m = models.get(String(op?.id));
    if (!m || !Array.isArray(op?.path) || op.path[0] !== "data") continue;
    const r = Number(op.path[1]);
    const c = Number(op.path[2]);
    if (!Number.isInteger(r)) continue;
    if (Number.isInteger(c)) {
      if (!canEditCell(m.model, r, c, ctx, m.unlocked(r, c))) out.push({ sheetId: String(op.id), r, c });
      continue;
    }
    // A whole row replaced: check the cells of the row that are protected.
    const row: any[] = Array.isArray(op.value) ? op.value : [];
    for (let cc = 0; cc < Math.max(row.length, 1); cc++) {
      if (!canEditCell(m.model, r, cc, ctx, m.unlocked(r, cc))) out.push({ sheetId: String(op.id), r, c: cc });
    }
  }
  return out;
}

// ---- hooks -----------------------------------------------------------------------------

export const viewHooks = {
  beforeRenderCellArea: (): void => {
    try {
      refresh();
    } catch {
      /* ignore */
    }
  },
  /** False when the cell was painted here (formula shown) and FortuneSheet must skip it. */
  beforeRenderCell: (cell: any, info: CellInfo, ctx: CanvasRenderingContext2D): boolean => {
    if (!state.view.showFormulas || !cell || typeof cell.f !== "string" || !cell.f) return true;
    try {
      paintFormula(cell, info, ctx);
      paintBreaks(info, ctx);
      return false;
    } catch {
      return true;
    }
  },
  afterRenderCell: (_cell: any, info: CellInfo, ctx: CanvasRenderingContext2D): void => {
    if (state.breaks) paintBreaks(info, ctx);
  },
  // Headings hidden: the header strips stay (FortuneSheet 1.0.4 mis-positions
  // its overlays with a zero-width header) but are painted blank.
  beforeRenderRowHeaderCell: (_n: string, _i: number, top: number, width: number, height: number, ctx: CanvasRenderingContext2D): boolean => {
    refreshIfStale();
    if (state.view.showHeadings) return true;
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, top, width, height + 1);
    ctx.restore();
    return false;
  },
  beforeRenderColumnHeaderCell: (_n: string, _i: number, left: number, width: number, height: number, ctx: CanvasRenderingContext2D): boolean => {
    refreshIfStale();
    if (state.view.showHeadings) return true;
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(left, 0, width + 1, height);
    ctx.restore();
    return false;
  },
  beforeUpdateCell: (r: number, c: number): boolean => {
    try {
      if (canEditActive(r, c)) return true;
    } catch {
      return true;
    }
    setTimeout(() => protectedNotice(), 0);
    return false;
  },
  beforePaste: (selection: any): boolean => {
    try {
      const sel = Array.isArray(selection) ? selection[0] : selection;
      if (!sel?.row || !sel?.column) return true;
      const rect = { r1: sel.row[0], r2: sel.row[1] ?? sel.row[0], c1: sel.column[0], c2: sel.column[1] ?? sel.column[0] };
      // Cells a larger paste spills into are caught by the op check (SheetEditor.onOp).
      if (!activeBlock(rect)) return true;
    } catch {
      return true;
    }
    setTimeout(() => protectedNotice("range"), 0);
    return false;
  },
};
