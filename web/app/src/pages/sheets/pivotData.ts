/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

// Pivot tables on the FortuneSheet workbook: reading a pivot's source range
// and computing its report. The model lives in pivotModel.ts, the report in
// pivotEngine.ts and the grid writes in pivotGrid.ts.

import type { Cell } from "./cellValue";
import { computeReport, type PivotReport } from "./pivotEngine";
import { normalizeConfig, sourceFromGrid, type PivotConfig, type PivotRange, type PivotSource } from "./pivotModel";

export * from "./pivotModel";

/** The sheet a pivot reads (its source sheet, else the active sheet). */
export function sourceSheet(wb: any, cfg: Pick<PivotConfig, "sourceSheetId">): any {
  try {
    const all: any[] = wb.getAllSheets?.() ?? [];
    if (cfg.sourceSheetId) {
      const s = all.find((x) => String(x.id) === String(cfg.sourceSheetId));
      if (s) return s;
    }
    const curId = wb.getSheet?.()?.id;
    return all.find((s) => s.id === curId) ?? all[0];
  } catch {
    return null;
  }
}

/** The cells of a range on a sheet, from its live grid (or its celldata). */
export function rangeCells(sheet: any, range: PivotRange): Cell[][] {
  const out: Cell[][] = [];
  const data: any[][] | null = Array.isArray(sheet?.data) ? sheet.data : null;
  let map: Map<string, any> | null = null;
  if (!data) {
    map = new Map();
    for (const cd of sheet?.celldata ?? []) if (cd) map.set(`${cd.r}_${cd.c}`, cd.v);
  }
  for (let r = range.r0; r <= range.r1; r++) {
    const row: Cell[] = [];
    for (let c = range.c0; c <= range.c1; c++) {
      const v = data ? data[r]?.[c] : map!.get(`${r}_${c}`);
      row.push(v == null ? null : typeof v === "object" ? v : { v, m: String(v) });
    }
    out.push(row);
  }
  return out;
}

/** The pivot's source records. */
export function readSource(wb: any, cfg: PivotConfig): PivotSource {
  return sourceFromGrid(rangeCells(sourceSheet(wb, cfg), cfg.range));
}

/** readHeaders returns the field names (first row of the range). */
export function readHeaders(wb: any, range: PivotRange, sourceSheetId?: string): string[] {
  return sourceFromGrid(rangeCells(sourceSheet(wb, { sourceSheetId }), { ...range, r1: range.r0 })).names;
}

/** buildReport computes a pivot's report from the live workbook. */
export function buildReport(wb: any, cfg: PivotConfig): PivotReport {
  return computeReport(normalizeConfig(cfg), readSource(wb, cfg));
}
