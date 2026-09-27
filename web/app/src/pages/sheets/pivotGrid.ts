/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API and cell objects are loosely typed. */

// Pivot tables written onto the grid, like Excel and Google Sheets: a pivot
// with an anchor owns the cells of its report there. The report is written
// when the pivot is made or changed and again whenever its source changes;
// typing into the report is refused (the pivot is edited instead), and any
// cell changed some other way is put back on the next refresh. What was
// written is kept on the pivot (`output`) for GETPIVOTDATA and the guard.

import { formatGeneral, formatValue } from "./numberFormat";
import { cellText, detailRecords, type GridCell, type PivotReport } from "./pivotEngine";
import { buildReport, type PivotConfig, type PivotEntry, type PivotOutput } from "./pivotData";
import { blockingProtection, sheetProtection } from "./protection";
import { editContext } from "./viewTools";

type Wb = any;

export const HEADER_BG = "#e8f0fe";

function notify(kind: "error" | "info", title: string, message: string): void {
  try {
    window.dispatchEvent(new CustomEvent("grown-sheet-notice", { detail: { kind, title, message } }));
  } catch {
    /* ignore */
  }
}

/** The FortuneSheet cell for a report cell (null for an empty one). */
export function fortuneCell(cell: GridCell | null): any {
  if (!cell || cell.v === null) return null;
  const v = cell.v;
  const out: Record<string, any> = {};
  if (typeof v === "number") {
    const fa = cell.fmt ?? cell.autoFmt ?? "General";
    out.v = v;
    out.m = fa === "General" ? formatGeneral(v) : formatValue(v, fa);
    out.ct = { fa, t: "n" };
  } else if (typeof v === "boolean") {
    out.v = v;
    out.m = v ? "TRUE" : "FALSE";
    out.ct = { fa: "General", t: "b" };
  } else if (typeof v === "object") {
    out.v = v.error;
    out.m = v.error;
    out.ct = { fa: "General", t: "e" };
  } else {
    out.v = v;
    out.m = cellText(cell);
    out.ct = { fa: "General", t: "g" };
  }
  if (cell.bold) out.bl = 1;
  if (cell.kind === "caption" || cell.kind === "colLabel" || cell.kind === "pageName") out.bg = HEADER_BG;
  return out;
}

function sameCell(a: any, b: any): boolean {
  const empty = (x: any) => x == null || (typeof x === "object" && (x.v == null || x.v === "") && !x.f);
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  return a.v === b.v && (a.m ?? "") === (b.m ?? "") && (a.bl ?? 0) === (b.bl ?? 0) && (a.bg ?? "") === (b.bg ?? "") && !a.f === !b.f;
}

function sheetOf(wb: Wb, id: string): any {
  const all: any[] = wb?.getAllSheets?.() ?? [];
  return all.find((s) => String(s.id) === String(id)) ?? null;
}

function gridCell(sheet: any, r: number, c: number): any {
  const data = sheet?.data;
  if (Array.isArray(data)) return data[r]?.[c] ?? null;
  return (sheet?.celldata ?? []).find((cd: any) => cd.r === r && cd.c === c)?.v ?? null;
}

/** The stored output for a report written at the pivot's anchor. */
export function outputOf(cfg: PivotConfig, rep: PivotReport): PivotOutput | undefined {
  const a = cfg.anchor;
  if (!a) return undefined;
  return {
    sheetId: a.sheetId,
    r0: a.r,
    c0: a.c,
    rows: rep.rows,
    cols: rep.cols,
    dataFields: rep.dataFields,
    entries: rep.entries,
    pages: rep.pages,
  };
}

export interface WriteResult {
  cfg: PivotConfig;
  written: number;
  blocked?: string;
}

/**
 * writePivot writes a pivot's report at its anchor: only cells that differ
 * are written, cells of the previous report outside the new one are
 * cleared. It refuses to overwrite other data or protected cells.
 */
export function writePivot(wb: Wb, cfg: PivotConfig, others: PivotConfig[] = []): WriteResult {
  const a = cfg.anchor;
  if (!a) return { cfg, written: 0 };
  const sheet = sheetOf(wb, a.sheetId);
  if (!sheet) return { cfg, written: 0, blocked: "sheet" };
  let rep: PivotReport;
  try {
    rep = buildReport(wb, cfg);
  } catch {
    return { cfg, written: 0 };
  }
  const prev = cfg.output && String(cfg.output.sheetId) === String(a.sheetId) ? cfg.output : undefined;
  const inPrev = (r: number, c: number) =>
    !!prev && r >= prev.r0 && r < prev.r0 + prev.rows && c >= prev.c0 && c < prev.c0 + prev.cols;
  const inOther = (r: number, c: number) =>
    others.some((o) => {
      const out = o.output;
      return o.id !== cfg.id && out && String(out.sheetId) === String(a.sheetId) && r >= out.r0 && r < out.r0 + out.rows && c >= out.c0 && c < out.c0 + out.cols;
    });
  // Protection: the whole report range must be editable.
  const rect = { r1: a.r, c1: a.c, r2: a.r + Math.max(rep.rows, 1) - 1, c2: a.c + Math.max(rep.cols, 1) - 1 };
  if (blockingProtection(sheetProtection(sheet), rect, editContext())) {
    return { cfg, written: 0, blocked: "protected" };
  }
  const writes: { name: string; args: any[] }[] = [];
  const opts = { id: a.sheetId };
  for (let r = 0; r < rep.rows; r++) {
    for (let c = 0; c < rep.cols; c++) {
      const R = a.r + r;
      const C = a.c + c;
      const want = fortuneCell(rep.cells[r][c]);
      const have = gridCell(sheet, R, C);
      if (sameCell(want, have)) continue;
      if (!inPrev(R, C) && (inOther(R, C) || (have && have.v != null && have.v !== "") || have?.f)) {
        return { cfg, written: 0, blocked: "occupied" };
      }
      writes.push(want ? { name: "setCellValue", args: [R, C, want, null, opts] } : { name: "clearCell", args: [R, C, opts] });
    }
  }
  if (prev) {
    for (let r = prev.r0; r < prev.r0 + prev.rows; r++) {
      for (let c = prev.c0; c < prev.c0 + prev.cols; c++) {
        if (r >= a.r && r < a.r + rep.rows && c >= a.c && c < a.c + rep.cols) continue;
        const have = gridCell(sheet, r, c);
        if (have && (have.v != null || have.m)) writes.push({ name: "clearCell", args: [r, c, opts] });
      }
    }
  }
  if (writes.length) {
    try {
      wb.batchCallApis?.(writes);
    } catch {
      return { cfg, written: 0 };
    }
  }
  const output = outputOf(cfg, rep);
  const changed = JSON.stringify(output) !== JSON.stringify(cfg.output);
  return { cfg: changed ? { ...cfg, output } : cfg, written: writes.length };
}

/** clearPivot empties the cells a pivot wrote. */
export function clearPivot(wb: Wb, cfg: PivotConfig): void {
  const out = cfg.output;
  if (!out) return;
  const sheet = sheetOf(wb, out.sheetId);
  if (!sheet) return;
  const writes: { name: string; args: any[] }[] = [];
  for (let r = out.r0; r < out.r0 + out.rows; r++) {
    for (let c = out.c0; c < out.c0 + out.cols; c++) {
      const have = gridCell(sheet, r, c);
      if (have && (have.v != null || have.m)) writes.push({ name: "clearCell", args: [r, c, { id: out.sheetId }] });
    }
  }
  if (writes.length) wb.batchCallApis?.(writes);
}

/** The pivot whose written report holds cell (r, c) of a sheet. */
export function pivotAt(pivots: PivotConfig[], sheetId: string, r: number, c: number): PivotConfig | null {
  for (const p of pivots) {
    const o = p.output;
    if (o && String(o.sheetId) === String(sheetId) && r >= o.r0 && r < o.r0 + o.rows && c >= o.c0 && c < o.c0 + o.cols) return p;
  }
  return null;
}

/** Warns that pivot cells are not typed into; the pivot is edited instead. */
export function pivotEditNotice(): void {
  notify("error", "Pivot table", "You can't change this part of a pivot table. Edit the pivot (Pivots ▸ Edit) or its source data instead.");
}

/**
 * A pivot-refresh scheduler: after edits, every anchored pivot is
 * recomputed and rewritten where its cells differ. Writing settles in one
 * pass (the second pass finds nothing to change), so it cannot loop.
 */
export function createPivotSync(opts: {
  getWb: () => Wb;
  getPivots: () => PivotConfig[];
  setPivots: (next: PivotConfig[]) => void;
  delay?: number;
}) {
  let timer: number | undefined;
  let running = false;
  let warned = "";
  const run = () => {
    const wb = opts.getWb();
    const list = opts.getPivots();
    if (!wb || running || !list.some((p) => p.anchor)) return;
    running = true;
    try {
      let changed = false;
      const next = list.map((p) => {
        if (!p.anchor) return p;
        const res = writePivot(wb, p, list);
        if (res.blocked) {
          const key = `${p.id}:${res.blocked}`;
          if (warned !== key) {
            warned = key;
            notify(
              "error",
              "Pivot table not updated",
              res.blocked === "protected"
                ? `"${p.title || "Pivot table"}" sits in a protected range you can't edit.`
                : `"${p.title || "Pivot table"}" needs more room: other data is in the way.`,
            );
          }
          return p;
        }
        if (res.cfg !== p) changed = true;
        return res.cfg;
      });
      if (changed) opts.setPivots(next);
    } finally {
      running = false;
    }
  };
  return {
    schedule() {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, opts.delay ?? 250);
    },
    runNow: run,
    /** beforeUpdateCell guard: typing into a pivot's cells is refused. */
    guard(r: number, c: number): boolean {
      const wb = opts.getWb();
      const id = wb?.getSheet?.()?.id;
      if (id == null) return true;
      if (pivotAt(opts.getPivots(), String(id), r, c)) {
        pivotEditNotice();
        return false;
      }
      return true;
    },
  };
}

// ---- show details ------------------------------------------------------------------

/**
 * showDetails puts the records behind a pivot value cell on a new sheet
 * (Excel's drill-down): the source header and rows, formats kept.
 * (r, c) are report coordinates. Returns the new sheet's id.
 */
export function showDetails(wb: Wb, cfg: PivotConfig, r: number, c: number): string | null {
  const rep = buildReport(wb, cfg);
  const d = detailRecords(rep, r, c);
  if (!d) return null;
  const all: any[] = wb.getAllSheets?.() ?? [];
  const names = new Set(all.map((s) => s.name));
  let n = 1;
  while (names.has(`Details${n}`)) n++;
  const id = `details_${Date.now().toString(36)}`;
  wb.addSheet?.(id);
  try {
    wb.setSheetName?.(`Details${n}`, { id });
  } catch {
    /* keep the default name */
  }
  const writes: { name: string; args: any[] }[] = [];
  d.header.forEach((h, c2) => writes.push({ name: "setCellValue", args: [0, c2, { v: h, m: h, bl: 1, bg: HEADER_BG }, null, { id }] }));
  d.rows.forEach((rec, i) =>
    rec.forEach((x, c2) => {
      if (x.s === null) return;
      const v = typeof x.s === "object" ? x.s.error : x.s;
      const cell: any = { v, m: x.text };
      if (x.fmt) cell.ct = { fa: x.fmt, t: typeof v === "number" ? "n" : "g" };
      writes.push({ name: "setCellValue", args: [i + 1, c2, cell, null, { id }] });
    }),
  );
  if (writes.length) wb.batchCallApis?.(writes);
  try {
    wb.activateSheet?.({ id });
  } catch {
    /* ignore */
  }
  return id;
}

// ---- GETPIVOTDATA ------------------------------------------------------------------------

function a1(r: number, c: number): string {
  let s = "";
  let x = c + 1;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return `$${s}$${r + 1}`;
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/** The entry for a report value cell (report coordinates). */
export function entryAt(out: PivotOutput, r: number, c: number): PivotEntry | null {
  return out.entries.find((e) => e.r === r && e.c === c) ?? null;
}

/**
 * The GETPIVOTDATA formula that reads a pivot value cell (sheet
 * coordinates), as Excel writes it when you point at a pivot cell.
 */
export function getPivotDataFormula(out: PivotOutput, r: number, c: number, table?: { r: number; c: number }): string | null {
  const e = entryAt(out, r - out.r0, c - out.c0);
  if (!e) return null;
  const d = out.dataFields[e.d];
  if (!d) return null;
  const at = table ?? { r: out.r0, c: out.c0 };
  const args = [quote(d.name), a1(at.r, at.c)];
  for (const [f, cap, num] of e.f) {
    args.push(quote(f));
    args.push(num !== undefined && String(num) === cap ? String(num) : quote(cap));
  }
  return `GETPIVOTDATA(${args.join(",")})`;
}
