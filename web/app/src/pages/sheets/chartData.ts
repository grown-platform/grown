import { resolveColor, toHex, type ColorMod } from "../../lib/colorMods";
import type { HistogramOptions } from "./histogram";
import type { TrendlineSpec } from "./trendlines";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

// Chart model (grownCharts on sheet[0]) and the pure helpers that turn a
// chart's source range into series. M10 added chart types, stacking, axes,
// legends, data labels, per-series options, trendlines and an anchor on the
// grid; every new field is optional so older charts load unchanged.

export type ChartType =
  | "column"
  | "bar"
  | "line"
  | "area"
  | "pie"
  | "doughnut"
  | "scatter"
  | "combo"
  | "histogram"
  | "waterfall";

export type Stacking = "none" | "stacked" | "percent";
export type LegendPosition = "right" | "left" | "top" | "bottom" | "none";

export interface ChartRange {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

export interface AxisConfig {
  min?: number | null;
  max?: number | null;
  majorUnit?: number | null;
  title?: string;
  /** Number format code for tick labels (M6 formats, e.g. "0%", "$#,##0"). */
  numFmt?: string;
  /** Logarithmic scale base. */
  logBase?: number | null;
}

export interface SeriesConfig {
  /** CSS colour; default from the theme accents. */
  color?: string;
  /** Combo charts: how this series is drawn. */
  type?: "column" | "line" | "area";
  /** Plot against the secondary value axis (combo). */
  secondary?: boolean;
  trendline?: TrendlineSpec | null;
  dataLabels?: boolean;
}

/** Top-left cell plus pixel offset, and the size in (unzoomed) pixels. */
export interface ChartAnchor {
  r: number;
  c: number;
  dx: number;
  dy: number;
  w: number;
  h: number;
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
  /** Sheet the range (and anchor) belong to; older charts use the first sheet. */
  sheetId?: string;
  /** Series run across rows instead of down columns. */
  seriesInRows?: boolean;
  stacking?: Stacking;
  /** Scatter: join points with lines. */
  scatterLines?: boolean;
  legend?: LegendPosition;
  /** Value labels on every point. */
  dataLabels?: boolean;
  xAxis?: AxisConfig;
  yAxis?: AxisConfig;
  /** Secondary value axis (combo). */
  y2Axis?: AxisConfig;
  /** Per-series options, by series index. */
  series?: SeriesConfig[];
  histogram?: HistogramOptions & { byCategory?: boolean };
  /** Waterfall: category indexes drawn as totals (bars from zero). */
  totals?: number[];
  /** Doughnut hole as a fraction of the radius (0.5). */
  holeSize?: number;
  /** Position on the grid; charts without one are listed in the charts panel. */
  anchor?: ChartAnchor;
}

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartInput {
  categories: string[];
  series: ChartSeries[];
  /** Numeric x values (scatter): the label column, or 1…n. */
  xValues?: number[];
}

/** Theme colours: Office default accents 1–6 (xl/theme/theme1.xml). */
export const THEME_ACCENTS = ["4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"];

/**
 * Series colour k from the theme accents, the way spreadsheets cycle them:
 * accents 1–6, then the same accents darker (lumMod 60 %), then lighter
 * (lumMod 80 % + lumOff 20 %), then darker again (lumMod 80 %).
 */
export function themeSeriesColor(k: number, accents: string[] = THEME_ACCENTS): string {
  const n = accents.length || 1;
  const base = accents[k % n] ?? THEME_ACCENTS[k % THEME_ACCENTS.length];
  const round = Math.floor(k / n) % 4;
  const mods: ColorMod[][] = [[], [{ name: "lumMod", val: 60000 }], [{ name: "lumMod", val: 80000 }, { name: "lumOff", val: 20000 }], [{ name: "lumMod", val: 80000 }]];
  return toHex(resolveColor({ srgb: base, mods: mods[round] }));
}

export function seriesColor(cfg: Pick<ChartConfig, "series">, k: number): string {
  return cfg.series?.[k]?.color || themeSeriesColor(k);
}

// ---------------------------------------------------------------- reading cells

function sheetFor(wb: any, sheetId?: string): any {
  try {
    const all: any[] = wb.getAllSheets?.() ?? [];
    if (sheetId) {
      const s = all.find((x) => String(x?.id) === String(sheetId));
      if (s) return s;
    }
    const curId = wb.getSheet?.()?.id;
    return all.find((s) => s.id === curId) ?? all[0];
  } catch {
    return null;
  }
}

// cellMap builds a "r_c" → cell-value lookup for a sheet (celldata or data).
function cellMap(sheet: any): Map<string, any> {
  const m = new Map<string, any>();
  if (!sheet) return m;
  if (Array.isArray(sheet.data) && sheet.data.length) {
    sheet.data.forEach((row: any[], r: number) =>
      (row ?? []).forEach((v: any, c: number) => {
        if (v != null) m.set(`${r}_${c}`, v);
      }),
    );
  }
  (sheet.celldata ?? []).forEach((cd: any) => {
    if (cd && cd.v != null && !m.has(`${cd.r}_${cd.c}`)) m.set(`${cd.r}_${cd.c}`, cd.v);
  });
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
  if (raw === "" || raw == null) return NaN;
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

/** Parses "A1:C5" (or a single cell, "$" allowed) into a ChartRange. */
export function parseRangeText(text: string): ChartRange | null {
  const m = /^\s*(?:(?:'[^']+'|[^!]+)!)?\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?\s*$/.exec(text);
  if (!m) return null;
  const col = (s: string) => s.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const c0 = col(m[1]);
  const r0 = Number(m[2]) - 1;
  const c1 = m[3] ? col(m[3]) : c0;
  const r1 = m[4] ? Number(m[4]) - 1 : r0;
  if (r0 < 0 || r1 < 0) return null;
  return { r0: Math.min(r0, r1), r1: Math.max(r0, r1), c0: Math.min(c0, c1), c1: Math.max(c0, c1) };
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
 * shapes them into categories + numeric series. By default columns become
 * series and rows categories (seriesInRows swaps them). headerRow/labelCol
 * mark the first row/column as series names / category labels (for series in
 * rows the first column names the series and the first row the categories).
 */
export function buildChartInput(wb: any, cfg: ChartConfig): ChartInput {
  const map = cellMap(sheetFor(wb, cfg.sheetId));
  const { r0, r1, c0, c1 } = cfg.range;
  // Names/labels: "outer" runs along series, "inner" along categories.
  const rows = cfg.seriesInRows;
  const catHeader = rows ? cfg.headerRow : cfg.labelCol; // the category labels
  const nameHeader = rows ? cfg.labelCol : cfg.headerRow; // the series names
  // The line of names sits across the categories and vice versa.
  const cat0 = rows ? (nameHeader ? c0 + 1 : c0) : nameHeader ? r0 + 1 : r0;
  const cat1 = rows ? c1 : r1;
  const ser0 = rows ? (catHeader ? r0 + 1 : r0) : catHeader ? c0 + 1 : c0;
  const ser1 = rows ? r1 : c1;
  const at = (s: number, k: number) => (rows ? [s, k] : [k, s]) as [number, number];

  const categories: string[] = [];
  const xValues: number[] = [];
  let numericX = catHeader;
  for (let k = cat0; k <= cat1; k++) {
    const [r, c] = rows ? [r0, k] : [k, c0];
    const label = catHeader ? cellText(map, r, c) : "";
    categories.push(catHeader ? label || `${rows ? "Col" : "Row"} ${k - cat0 + 1}` : `${k - cat0 + 1}`);
    const x = catHeader ? cellNum(map, r, c) : NaN;
    if (!Number.isFinite(x)) numericX = false;
    xValues.push(x);
  }

  const series: ChartSeries[] = [];
  let n = 1;
  for (let s = ser0; s <= ser1; s++) {
    const [hr, hc] = rows ? [s, c0] : [r0, s];
    const name = nameHeader ? cellText(map, hr, hc) || `Series ${n}` : `Series ${n}`;
    const values: number[] = [];
    for (let k = cat0; k <= cat1; k++) {
      const [r, c] = at(s, k);
      values.push(cellNum(map, r, c));
    }
    series.push({ name, values });
    n++;
  }
  return { categories, series, xValues: numericX ? xValues : categories.map((_, i) => i + 1) };
}

// ---------------------------------------------------------------- layout

export interface LaidSeries {
  name: string;
  values: number[];
  /** Where each value's mark starts and ends on the value axis. */
  base: number[];
  top: number[];
}

export interface Layout {
  series: LaidSeries[];
  min: number;
  max: number;
}

/**
 * Stacks series for column/bar/line/area charts. "stacked" adds positive and
 * negative values on separate stacks (as spreadsheets do); "percent" scales
 * each category to its total of absolute values (0…1). Blank values add
 * nothing. min/max are the value extent including 0.
 */
export function layoutSeries(input: ChartInput, cfg: Pick<ChartConfig, "stacking">): Layout {
  const stacking = cfg.stacking ?? "none";
  const n = Math.max(0, ...input.series.map((s) => s.values.length));
  const posAcc = new Array(n).fill(0);
  const negAcc = new Array(n).fill(0);
  const totals = new Array(n).fill(0);
  if (stacking === "percent") {
    for (const s of input.series) s.values.forEach((v, i) => Number.isFinite(v) && (totals[i] += Math.abs(v)));
  }
  let min = 0;
  let max = 0;
  const series = input.series.map((s) => {
    const base: number[] = [];
    const top: number[] = [];
    for (let i = 0; i < n; i++) {
      const raw = s.values[i];
      const v = Number.isFinite(raw) ? raw : 0;
      if (stacking === "none") {
        base.push(0);
        top.push(Number.isFinite(raw) ? raw : NaN);
      } else {
        const scaled = stacking === "percent" ? (totals[i] ? v / totals[i] : 0) : v;
        const acc = scaled < 0 ? negAcc : posAcc;
        base.push(acc[i]);
        acc[i] += scaled;
        top.push(acc[i]);
      }
      const t = top[i];
      if (Number.isFinite(t)) {
        min = Math.min(min, t, base[i]);
        max = Math.max(max, t, base[i]);
      }
    }
    return { name: s.name, values: s.values, base, top };
  });
  return { series, min, max };
}

export interface WaterfallBar {
  start: number;
  end: number;
  kind: "up" | "down" | "total";
}

/**
 * Waterfall bars: each value moves a running total; categories listed in
 * `totals` show the running total itself as a bar from zero.
 */
export function waterfallBars(values: number[], totals: number[] = []): WaterfallBar[] {
  const isTotal = new Set(totals);
  let run = 0;
  return values.map((raw, i) => {
    const v = Number.isFinite(raw) ? raw : 0;
    if (isTotal.has(i)) {
      run = Number.isFinite(raw) ? raw : run;
      return { start: 0, end: run, kind: "total" as const };
    }
    const start = run;
    run += v;
    return { start, end: run, kind: v < 0 ? ("down" as const) : ("up" as const) };
  });
}

/** Share of each value in a pie/doughnut (negatives and blanks count as 0). */
export function pieShares(values: number[]): number[] {
  const vals = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = vals.reduce((a, b) => a + b, 0);
  return vals.map((v) => (total ? v / total : 0));
}

/** A new chart's default size and a spot next to its data. */
export function defaultAnchor(range: ChartRange): ChartAnchor {
  return { r: range.r0, c: range.c1 + 2, dx: 0, dy: 0, w: 480, h: 300 };
}

/** The sheet a chart belongs to: its sheetId, or the first sheet for older charts. */
export function chartSheetId(cfg: ChartConfig, sheets: any[]): string | undefined {
  if (cfg.sheetId) return cfg.sheetId;
  const first = sheets?.[0];
  return first?.id !== undefined ? String(first.id) : undefined;
}
