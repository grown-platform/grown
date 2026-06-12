import type { ChartSeries, ChartType } from "./ChartRenderer";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

export interface ChartRange {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

export interface ChartConfig {
  id: string;
  type: ChartType;
  title: string;
  range: ChartRange;
  /** first row of the range holds the series names */
  headerRow: boolean;
  /** first column of the range holds the category labels */
  labelCol: boolean;
}

export interface ChartInput {
  categories: string[];
  series: ChartSeries[];
}

// cellMap builds a "r_c" → cell-value lookup for the current sheet.
function cellMap(wb: any): Map<string, any> {
  const m = new Map<string, any>();
  try {
    const curId = wb.getSheet?.()?.id;
    const all: any[] = wb.getAllSheets?.() ?? [];
    const sheet = all.find((s) => s.id === curId) ?? all[0];
    (sheet?.celldata ?? []).forEach((cd: any) => {
      if (cd && cd.v != null) m.set(`${cd.r}_${cd.c}`, cd.v);
    });
  } catch {
    /* ignore */
  }
  return m;
}

function cellText(map: Map<string, any>, r: number, c: number): string {
  const v = map.get(`${r}_${c}`);
  if (v == null) return "";
  if (typeof v === "object") return (v.m ?? v.v ?? "").toString();
  return v.toString();
}

function cellNum(map: Map<string, any>, r: number, c: number): number {
  const v = map.get(`${r}_${c}`);
  const raw = v != null && typeof v === "object" ? (v.v ?? v.m) : v;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? "").replace(/[, $%]/g, ""));
  return isFinite(n) ? n : NaN;
}

/** colName converts a 0-based column index to A1 letters. */
export function colName(c: number): string {
  let s = "";
  c += 1;
  while (c > 0) {
    c -= 1;
    s = String.fromCharCode(65 + (c % 26)) + s;
    c = Math.floor(c / 26);
  }
  return s;
}

export function rangeText(r: ChartRange): string {
  return `${colName(r.c0)}${r.r0 + 1}:${colName(r.c1)}${r.r1 + 1}`;
}

/** getSelectionRange reads the current FortuneSheet selection as a ChartRange. */
export function getSelectionRange(wb: any): ChartRange | null {
  try {
    const selArr = wb?.getSelection?.();
    const sel = Array.isArray(selArr) ? selArr[0] : selArr;
    if (sel && sel.row && sel.column) {
      return {
        r0: Math.min(sel.row[0], sel.row[1]),
        r1: Math.max(sel.row[0], sel.row[1]),
        c0: Math.min(sel.column[0], sel.column[1]),
        c1: Math.max(sel.column[0], sel.column[1]),
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * buildChartInput reads the live cell values over a chart's source range and
 * shapes them into categories + numeric series. Columns become series; rows
 * become categories. headerRow/labelCol mark the first row/column as
 * series-names / category-labels respectively.
 */
export function buildChartInput(wb: any, cfg: ChartConfig): ChartInput {
  const map = cellMap(wb);
  const { r0, r1, c0, c1 } = cfg.range;
  const startRow = cfg.headerRow ? r0 + 1 : r0;
  const startCol = cfg.labelCol ? c0 + 1 : c0;

  const categories: string[] = [];
  for (let r = startRow; r <= r1; r++) {
    categories.push(cfg.labelCol ? cellText(map, r, c0) || `Row ${r - startRow + 1}` : `${r - startRow + 1}`);
  }

  const series: ChartSeries[] = [];
  let k = 1;
  for (let c = startCol; c <= c1; c++) {
    const name = cfg.headerRow ? cellText(map, r0, c) || `Series ${k}` : `Series ${k}`;
    const values: number[] = [];
    for (let r = startRow; r <= r1; r++) values.push(cellNum(map, r, c));
    series.push({ name, values });
    k++;
  }
  return { categories, series };
}
