// Charts on slides (M11). A chart element keeps its own small data sheet
// (`SlideChart.data`) and the Sheets chart options; everything that draws or
// serialises it goes through the Sheets chart code (pages/sheets/chartData.ts,
// ChartRenderer.tsx, xlsx/xlsxCharts.ts) via the ChartConfig built here.
// Series colours follow the deck theme's accents unless a series has its own.

import {
  buildChartInputFromGrid,
  themeSeriesColor,
  type ChartConfig,
  type ChartInput,
  type ChartType,
} from "../sheets/chartData";
import { uid, type DeckTheme, type SlideChart, type SlideElement } from "./model";

/** Chart types offered on slides (the shared renderer's types). */
export const SLIDE_CHART_TYPES: { type: ChartType; label: string }[] = [
  { type: "column", label: "Column" },
  { type: "bar", label: "Bar" },
  { type: "line", label: "Line" },
  { type: "area", label: "Area" },
  { type: "pie", label: "Pie" },
  { type: "doughnut", label: "Doughnut" },
  { type: "scatter", label: "Scatter" },
  { type: "combo", label: "Combo" },
  { type: "waterfall", label: "Waterfall" },
  { type: "histogram", label: "Histogram" },
];

/** Data grids are capped so a pasted table can't blow up a deck. */
export const MAX_CHART_ROWS = 200;
export const MAX_CHART_COLS = 30;

/** The data sheet a new chart of `type` starts with. */
export function defaultChartData(type: ChartType): string[][] {
  if (type === "pie" || type === "doughnut")
    return [
      ["", "Sales"],
      ["1st Qtr", "8.2"],
      ["2nd Qtr", "3.2"],
      ["3rd Qtr", "1.4"],
      ["4th Qtr", "1.2"],
    ];
  if (type === "scatter")
    return [
      ["", "Y values"],
      ["0.7", "2.7"],
      ["1.8", "3.2"],
      ["2.6", "0.8"],
    ];
  if (type === "waterfall")
    return [
      ["", "Change"],
      ["Start", "10"],
      ["Q1", "4"],
      ["Q2", "-3"],
      ["Q3", "5"],
      ["End", "16"],
    ];
  if (type === "histogram")
    return [["", "Values"], ...[3, 7, 8, 12, 13, 13, 17, 21, 22, 24, 30].map((v, i) => [String(i + 1), String(v)])];
  return [
    ["", "Series 1", "Series 2", "Series 3"],
    ["Category 1", "4.3", "2.4", "2"],
    ["Category 2", "2.5", "4.4", "2"],
    ["Category 3", "3.5", "1.8", "3"],
    ["Category 4", "4.5", "2.8", "5"],
  ];
}

/** A new chart element (centred, 480×300) of `type` with sample data. */
export function newChartElement(type: ChartType = "column", at?: { x: number; y: number }): SlideElement {
  const chart: SlideChart = { type, title: "", data: defaultChartData(type) };
  if (type === "waterfall") chart.totals = [0, 5];
  return { id: uid(), type: "chart", x: at?.x ?? 240, y: at?.y ?? 120, w: 480, h: 300, chart };
}

/** A rectangular copy of the grid (short rows padded with ""), at least 2×2. */
export function normalizeGrid(data: readonly (readonly string[])[]): string[][] {
  const rows = Math.min(MAX_CHART_ROWS, Math.max(2, data.length));
  const cols = Math.min(MAX_CHART_COLS, Math.max(2, ...data.map((r) => r?.length ?? 0)));
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => String(data[r]?.[c] ?? "")));
}

/** Set one cell (growing the grid when r/c is just past its edge). */
export function setChartCell(data: readonly (readonly string[])[], r: number, c: number, v: string): string[][] {
  const g = normalizeGrid(data);
  if (r < 0 || c < 0 || r >= MAX_CHART_ROWS || c >= MAX_CHART_COLS) return g;
  while (g.length <= r) g.push(new Array(g[0].length).fill(""));
  if (c >= g[0].length) for (const row of g) while (row.length <= c) row.push("");
  g[r][c] = v;
  return g;
}

/** Insert an empty row (category) at `at` (default: the end). */
export function addChartRow(data: readonly (readonly string[])[], at?: number): string[][] {
  const g = normalizeGrid(data);
  if (g.length >= MAX_CHART_ROWS) return g;
  const i = at === undefined ? g.length : Math.max(1, Math.min(g.length, at));
  g.splice(i, 0, g[0].map((_, c) => (c === 0 ? `Category ${g.length}` : "")));
  return g;
}

/** Insert an empty column (series) at `at` (default: the end). */
export function addChartCol(data: readonly (readonly string[])[], at?: number): string[][] {
  const g = normalizeGrid(data);
  if (g[0].length >= MAX_CHART_COLS) return g;
  const i = at === undefined ? g[0].length : Math.max(1, Math.min(g[0].length, at));
  const name = `Series ${g[0].length}`;
  g.forEach((row, r) => row.splice(i, 0, r === 0 ? name : ""));
  return g;
}

/** Remove data row `r` (never the header row or the last data row). */
export function removeChartRow(data: readonly (readonly string[])[], r: number): string[][] {
  const g = normalizeGrid(data);
  if (r < 1 || r >= g.length || g.length <= 2) return g;
  g.splice(r, 1);
  return g;
}

/** Remove series column `c` (never the label column or the last series). */
export function removeChartCol(data: readonly (readonly string[])[], c: number): string[][] {
  const g = normalizeGrid(data);
  if (c < 1 || c >= g[0].length || g[0].length <= 2) return g;
  for (const row of g) row.splice(c, 1);
  return g;
}

/** Parse pasted text (tab/comma separated lines) into a grid. */
export function parseChartPaste(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : ",";
  return normalizeGrid(lines.map((l) => l.split(sep).map((c) => c.trim())));
}

/** The number of series the chart draws. */
export function seriesCount(chart: SlideChart): number {
  const g = normalizeGrid(chart.data);
  return chart.seriesInRows ? g.length - 1 : g[0].length - 1;
}

/** The deck theme's six accents as bare hex (for themeSeriesColor). */
export function themeAccents(theme: DeckTheme): string[] {
  const c = theme.colors;
  return [c.accent1, c.accent2, c.accent3, c.accent4, c.accent5, c.accent6].map((h) => h.replace("#", "").toUpperCase());
}

/**
 * The Sheets ChartConfig for a slide chart: the range covers the whole data
 * grid (header row + label column), and every series (every slice, for a
 * pie or doughnut) without an explicit colour takes the theme's accent
 * cycle — accents 1–6, then darker and lighter variants, as in PowerPoint.
 */
export function chartConfigOf(chart: SlideChart, theme?: DeckTheme, id = "slide-chart"): ChartConfig {
  const g = normalizeGrid(chart.data);
  const { data: _data, ...opts } = chart;
  void _data;
  const cfg: ChartConfig = {
    ...opts,
    id,
    range: { r0: 0, c0: 0, r1: g.length - 1, c1: g[0].length - 1 },
    headerRow: true,
    labelCol: true,
  };
  if (theme) {
    const accents = themeAccents(theme);
    const pie = chart.type === "pie" || chart.type === "doughnut";
    const n = pie ? (chart.seriesInRows ? g[0].length - 1 : g.length - 1) : seriesCount(chart);
    cfg.series = Array.from({ length: Math.max(n, chart.series?.length ?? 0) }, (_, k) => {
      const own = chart.series?.[k] ?? {};
      return { ...own, color: own.color || themeSeriesColor(k, accents) };
    });
  }
  return cfg;
}

/** The categories and numeric series the chart draws (via the Sheets reader). */
export function chartInputOf(chart: SlideChart): ChartInput {
  const g = normalizeGrid(chart.data);
  return buildChartInputFromGrid(g, chartConfigOf(chart));
}

/** A slide chart rebuilt from cached chart values (pptx import): the grid
 *  is the categories down column 0 and one column per series. */
export function chartDataFromCache(cache: { categories: string[]; series: { name: string; values: number[] }[]; xValues?: number[] }): string[][] {
  const cats = cache.xValues ? cache.xValues.map((x) => String(x)) : cache.categories;
  const n = Math.min(MAX_CHART_ROWS - 1, Math.max(cats.length, ...cache.series.map((s) => s.values.length)));
  const series = cache.series.slice(0, MAX_CHART_COLS - 1);
  const out: string[][] = [["", ...series.map((s) => s.name)]];
  for (let i = 0; i < n; i++)
    out.push([cats[i] ?? String(i + 1), ...series.map((s) => (Number.isFinite(s.values[i]) ? String(s.values[i]) : ""))]);
  return normalizeGrid(out);
}
