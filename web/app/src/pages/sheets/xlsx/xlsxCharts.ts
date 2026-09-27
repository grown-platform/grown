/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet workbooks are loosely typed. */

// Charts ↔ DrawingML chart parts (ECMA-376 Part 1, §21.2 "DrawingML -
// Charts" and §20.5 "SpreadsheetML Drawing"), written from the spec.
//
// Writing: each sheet with charts gets xl/drawings/drawingN.xml with one
// oneCellAnchor per chart (the Grown anchor: a cell, an EMU offset and an
// extent) pointing at xl/charts/chartM.xml. Chart types map to c:barChart
// (column/bar, clustered/stacked/percentStacked), c:lineChart, c:areaChart,
// c:scatterChart, c:pieChart and c:doughnutChart; combo charts put the
// column and line/area series in separate chart groups, with a second value
// axis for secondary series. Titles, legend position, data labels, axis
// titles/bounds/major unit/number format/log base, series colours and
// trendlines are written too. Histogram and waterfall are chartEx (cx:) types
// in Excel 2016+; they are written as clustered columns over the same data.
// Every chart also carries its full Grown definition in a c:extLst entry, so
// Grown reads back exactly what it wrote (Excel ignores the entry).
//
// Reading: drawing anchors with a c:chart graphic frame become charts. A
// chart with the Grown entry is taken from it; any other chart is rebuilt
// from its first chart group, its series references and the options above.

import type { AxisConfig, ChartAnchor, ChartConfig, ChartRange, ChartType, LegendPosition, SeriesConfig } from "../chartData";
import { defaultAnchor, themeSeriesColor } from "../chartData";
import type { TrendlineSpec, TrendType } from "../trendlines";
import { all, attr, esc, kid, kids, numAttr, quoteSheet, text } from "./ooxml";
import { colToLetters } from "../cellValue";

export const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
export const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
export const GROWN_CHART_URI = "{8A3C2F1E-47B5-4E0B-9D6A-6772726F7763}";
export const GROWN_CHART_NS = "https://grown.pick.haus/xlsx/2026/chart";
export const CT_DRAWING = "application/vnd.openxmlformats-officedocument.drawing+xml";
export const CT_CHART = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
export const REL_DRAWING = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
export const REL_CHART = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";

const EMU_PER_PX = 9525;

// ---------------------------------------------------------------- series references

interface SeriesRef {
  name: string | null;
  cat: string | null;
  val: string;
}

const abs = (r: number, c: number) => `$${colToLetters(c)}$${r + 1}`;
const absRange = (r0: number, c0: number, r1: number, c1: number) => `${abs(r0, c0)}:${abs(r1, c1)}`;

/** The cell references of each series, the same split as chartData.buildChartInput. */
export function seriesRefs(cfg: ChartConfig, sheetName: string): SeriesRef[] {
  const q = quoteSheet(sheetName);
  const { r0, r1, c0, c1 } = cfg.range;
  const rows = !!cfg.seriesInRows;
  const catHeader = rows ? cfg.headerRow : cfg.labelCol;
  const nameHeader = rows ? cfg.labelCol : cfg.headerRow;
  const cat0 = rows ? (nameHeader ? c0 + 1 : c0) : nameHeader ? r0 + 1 : r0;
  const cat1 = rows ? c1 : r1;
  const ser0 = rows ? (catHeader ? r0 + 1 : r0) : catHeader ? c0 + 1 : c0;
  const ser1 = rows ? r1 : c1;
  const out: SeriesRef[] = [];
  const cat = catHeader ? (rows ? `${q}!${absRange(r0, cat0, r0, cat1)}` : `${q}!${absRange(cat0, c0, cat1, c0)}`) : null;
  for (let s = ser0; s <= ser1; s++) {
    out.push({
      name: nameHeader ? `${q}!${rows ? abs(s, c0) : abs(r0, s)}` : null,
      cat,
      val: rows ? `${q}!${absRange(s, cat0, s, cat1)}` : `${q}!${absRange(cat0, s, cat1, s)}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------- writing

const hex = (css: string) => css.replace(/^#/, "").slice(0, 6).toUpperCase();
const val = (name: string, v: string | number) => `<c:${name} val="${esc(v)}"/>`;

function richTitle(s: string): string {
  return (
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${esc(s)}</a:t></a:r></a:p></c:rich></c:tx>` +
    '<c:overlay val="0"/></c:title>'
  );
}

function solid(color: string): string {
  return `<a:solidFill><a:srgbClr val="${hex(color)}"/></a:solidFill>`;
}

function dLbls(on: boolean, percent = false): string {
  if (!on && !percent) return "";
  return (
    "<c:dLbls>" +
    val("showLegendKey", 0) +
    val("showVal", on ? 1 : 0) +
    val("showCatName", 0) +
    val("showSerName", 0) +
    val("showPercent", percent && !on ? 1 : 0) +
    val("showBubbleSize", 0) +
    "</c:dLbls>"
  );
}

function trendlineXml(t: TrendlineSpec | null | undefined): string {
  if (!t) return "";
  let x = "<c:trendline>" + val("trendlineType", t.type);
  if (t.type === "poly") x += val("order", Math.max(2, Math.min(6, t.order ?? 2)));
  if (t.type === "movingAvg") x += val("period", Math.max(2, t.period ?? 2));
  if (t.forward) x += val("forward", t.forward);
  if (t.backward) x += val("backward", t.backward);
  if (t.intercept !== undefined && t.intercept !== null) x += val("intercept", t.intercept);
  if (t.type !== "movingAvg") x += val("dispRSqr", t.showR2 ? 1 : 0) + val("dispEq", t.showEquation ? 1 : 0);
  return x + "</c:trendline>";
}

type Kind = "bar" | "line" | "area" | "scatter" | "pie" | "doughnut";

function serXml(kind: Kind, idx: number, ref: SeriesRef, cfg: ChartConfig, sc: SeriesConfig): string {
  const color = sc.color || themeSeriesColor(idx);
  let x = `<c:ser>${val("idx", idx)}${val("order", idx)}`;
  if (ref.name) x += `<c:tx><c:strRef><c:f>${esc(ref.name)}</c:f></c:strRef></c:tx>`;
  if (kind === "line" || (kind === "scatter" && cfg.scatterLines)) x += `<c:spPr><a:ln w="28575" cap="rnd">${solid(color)}<a:round/></a:ln></c:spPr>`;
  else if (kind === "scatter") x += '<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr>';
  else if (kind !== "pie" && kind !== "doughnut") x += `<c:spPr>${solid(color)}</c:spPr>`;
  if (kind === "bar") x += val("invertIfNegative", 0);
  if (kind === "line" || kind === "scatter") x += `<c:marker>${val("symbol", "circle")}${val("size", 5)}<c:spPr>${solid(color)}</c:spPr></c:marker>`;
  if (kind === "pie" || kind === "doughnut") {
    // Slice colours: the theme accents (or the per-point series colours).
    const n = 64;
    for (let i = 0; i < Math.min(n, pointCount(cfg)); i++) {
      const c = cfg.series?.[i]?.color || themeSeriesColor(i);
      x += `<c:dPt>${val("idx", i)}${val("bubble3D", 0)}<c:spPr>${solid(c)}<a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`;
    }
  }
  x += dLbls(!!(cfg.dataLabels || sc.dataLabels), kind === "pie" || kind === "doughnut");
  if (kind !== "pie" && kind !== "doughnut") x += trendlineXml(sc.trendline);
  if (kind === "scatter") {
    if (ref.cat) x += `<c:xVal><c:numRef><c:f>${esc(ref.cat)}</c:f></c:numRef></c:xVal>`;
    x += `<c:yVal><c:numRef><c:f>${esc(ref.val)}</c:f></c:numRef></c:yVal>` + val("smooth", 0);
  } else {
    if (ref.cat) x += `<c:cat><c:strRef><c:f>${esc(ref.cat)}</c:f></c:strRef></c:cat>`;
    x += `<c:val><c:numRef><c:f>${esc(ref.val)}</c:f></c:numRef></c:val>`;
    if (kind === "line") x += val("smooth", 0);
  }
  return x + "</c:ser>";
}

function pointCount(cfg: ChartConfig): number {
  const { r0, r1, c0, c1 } = cfg.range;
  return cfg.seriesInRows ? c1 - c0 + 1 - (cfg.labelCol ? 1 : 0) : r1 - r0 + 1 - (cfg.headerRow ? 1 : 0);
}

function axisXml(
  tag: "catAx" | "valAx",
  id: number,
  cross: number,
  pos: "b" | "l" | "r" | "t",
  axis: AxisConfig | undefined,
  opts: { grid?: boolean; deleted?: boolean; crossesMax?: boolean; percent?: boolean } = {},
): string {
  const a = axis ?? {};
  let x = `<c:${tag}>${val("axId", id)}<c:scaling>`;
  if (a.logBase) x += val("logBase", a.logBase);
  x += val("orientation", "minMax");
  if (a.max !== undefined && a.max !== null) x += val("max", a.max);
  if (a.min !== undefined && a.min !== null) x += val("min", a.min);
  x += "</c:scaling>" + val("delete", opts.deleted ? 1 : 0) + val("axPos", pos);
  if (opts.grid) x += "<c:majorGridlines><c:spPr><a:ln w=\"9525\"><a:solidFill><a:srgbClr val=\"E6E6E6\"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>";
  if (a.title) x += richTitle(a.title);
  const fmt = a.numFmt || (opts.percent ? "0%" : "");
  if (fmt) x += `<c:numFmt formatCode="${esc(fmt)}" sourceLinked="0"/>`;
  x += val("majorTickMark", "out") + val("minorTickMark", "none") + val("tickLblPos", "nextTo") + val("crossAx", cross);
  x += opts.crossesMax ? val("crosses", "max") : val("crosses", "autoZero");
  if (tag === "catAx") x += val("auto", 1) + val("lblAlgn", "ctr") + val("lblOffset", 100) + val("noMultiLvlLbl", 0);
  else {
    x += val("crossBetween", "between");
    if (a.majorUnit) x += val("majorUnit", a.majorUnit);
  }
  return x + `</c:${tag}>`;
}

function grouping(cfg: ChartConfig, kind: Kind): string {
  const s = cfg.stacking ?? "none";
  if (kind === "bar") return s === "stacked" ? "stacked" : s === "percent" ? "percentStacked" : "clustered";
  return s === "stacked" ? "stacked" : s === "percent" ? "percentStacked" : "standard";
}

function groupXml(kind: Kind, cfg: ChartConfig, sers: string, axIds: [number, number], barDir: "col" | "bar" = "col", groupingVal?: string): string {
  const g = groupingVal ?? grouping(cfg, kind);
  switch (kind) {
    case "bar": {
      const stacked = g !== "clustered";
      return (
        `<c:barChart>${val("barDir", barDir)}${val("grouping", g)}${val("varyColors", 0)}${sers}` +
        `${val("gapWidth", cfg.type === "histogram" ? 5 : 150)}${stacked ? val("overlap", 100) : ""}${val("axId", axIds[0])}${val("axId", axIds[1])}</c:barChart>`
      );
    }
    case "line":
      return `<c:lineChart>${val("grouping", g)}${val("varyColors", 0)}${sers}${val("marker", 1)}${val("axId", axIds[0])}${val("axId", axIds[1])}</c:lineChart>`;
    case "area":
      return `<c:areaChart>${val("grouping", g)}${val("varyColors", 0)}${sers}${val("axId", axIds[0])}${val("axId", axIds[1])}</c:areaChart>`;
    case "scatter":
      return `<c:scatterChart>${val("scatterStyle", cfg.scatterLines ? "lineMarker" : "marker")}${val("varyColors", 0)}${sers}${val("axId", axIds[0])}${val("axId", axIds[1])}</c:scatterChart>`;
    case "pie":
      return `<c:pieChart>${val("varyColors", 1)}${sers}${val("firstSliceAng", 0)}</c:pieChart>`;
    case "doughnut":
      return `<c:doughnutChart>${val("varyColors", 1)}${sers}${val("firstSliceAng", 0)}${val("holeSize", Math.round((cfg.holeSize ?? 0.5) * 100))}</c:doughnutChart>`;
  }
}

const LEGEND_POS: Record<Exclude<LegendPosition, "none">, string> = { bottom: "b", top: "t", right: "r", left: "l" };

/** One c:chartSpace part for a chart whose data lives on sheetName. */
export function chartSpaceXml(cfg: ChartConfig, sheetName: string): string {
  const refs = seriesRefs(cfg, sheetName);
  const sc = (k: number) => cfg.series?.[k] ?? {};
  const percent = cfg.stacking === "percent";
  let plot = "";
  let axes = "";
  const type = cfg.type;
  if (type === "pie" || type === "doughnut") {
    plot = groupXml(type, cfg, refs.slice(0, 1).map((r, k) => serXml(type, k, r, cfg, sc(k))).join(""), [0, 0]);
  } else if (type === "scatter") {
    plot = groupXml("scatter", cfg, refs.map((r, k) => serXml("scatter", k, r, cfg, sc(k))).join(""), [1, 2]);
    axes = axisXml("valAx", 1, 2, "b", cfg.xAxis, {}) + axisXml("valAx", 2, 1, "l", cfg.yAxis, { grid: true });
  } else if (type === "combo") {
    const kindOf = (k: number): Kind => {
      const t = sc(k).type ?? (k === 0 ? "column" : "line");
      return t === "column" ? "bar" : t;
    };
    const groups = new Map<string, string[]>();
    refs.forEach((r, k) => {
      const key = `${kindOf(k)}|${sc(k).secondary ? 2 : 1}`;
      const list = groups.get(key) ?? [];
      list.push(serXml(kindOf(k), k, r, cfg, sc(k)));
      groups.set(key, list);
    });
    let hasSecondary = false;
    for (const [key, list] of groups) {
      const [kind, axis] = key.split("|");
      const ids: [number, number] = axis === "2" ? [3, 4] : [1, 2];
      if (axis === "2") hasSecondary = true;
      plot += groupXml(kind as Kind, cfg, list.join(""), ids, "col", kind === "bar" ? "clustered" : "standard");
    }
    axes = axisXml("catAx", 1, 2, "b", cfg.xAxis) + axisXml("valAx", 2, 1, "l", cfg.yAxis, { grid: true });
    if (hasSecondary) axes += axisXml("catAx", 3, 4, "b", undefined, { deleted: true }) + axisXml("valAx", 4, 3, "r", cfg.y2Axis, { crossesMax: true });
  } else {
    const kind: Kind = type === "line" ? "line" : type === "area" ? "area" : "bar";
    const barDir = type === "bar" ? "bar" : "col";
    const g = type === "histogram" || type === "waterfall" ? (kind === "bar" ? "clustered" : "standard") : undefined;
    const list = type === "histogram" || type === "waterfall" ? refs.slice(0, 1) : refs;
    plot = groupXml(kind, cfg, list.map((r, k) => serXml(kind, k, r, cfg, sc(k))).join(""), [1, 2], barDir, g);
    const horizontal = type === "bar";
    axes =
      axisXml("catAx", 1, 2, horizontal ? "l" : "b", cfg.xAxis) +
      axisXml("valAx", 2, 1, horizontal ? "b" : "l", cfg.yAxis, { grid: true, percent });
  }
  const legendPos = cfg.legend ?? (type === "pie" || type === "doughnut" ? "right" : refs.length > 1 ? "bottom" : "none");
  const legend = legendPos === "none" ? "" : `<c:legend>${val("legendPos", LEGEND_POS[legendPos])}${val("overlay", 0)}</c:legend>`;
  const title = cfg.title ? richTitle(cfg.title) + val("autoTitleDeleted", 0) : val("autoTitleDeleted", 1);
  const grown = JSON.stringify({ ...cfg, anchor: undefined, sheetId: undefined });
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    val("roundedCorners", 0) +
    "<c:chart>" +
    title +
    `<c:plotArea><c:layout/>${plot}${axes}</c:plotArea>` +
    legend +
    val("plotVisOnly", 1) +
    val("dispBlanksAs", "gap") +
    "</c:chart>" +
    `<c:spPr>${solid("#FFFFFF")}<a:ln w="9525"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr>` +
    `<c:extLst><c:ext uri="${GROWN_CHART_URI}" xmlns:g="${GROWN_CHART_NS}"><g:chart>${esc(grown)}</g:chart></c:ext></c:extLst>` +
    "</c:chartSpace>"
  );
}

/** xdr:wsDr drawing part with one anchor per chart (rIds rId1…rIdN in order). */
export function drawingXml(charts: ChartConfig[]): string {
  const anchors = charts
    .map((cfg, i) => {
      const a: ChartAnchor = cfg.anchor ?? defaultAnchor(cfg.range);
      const name = esc(cfg.title || `Chart ${i + 1}`);
      return (
        "<xdr:oneCellAnchor>" +
        `<xdr:from><xdr:col>${a.c}</xdr:col><xdr:colOff>${Math.round(a.dx * EMU_PER_PX)}</xdr:colOff><xdr:row>${a.r}</xdr:row><xdr:rowOff>${Math.round(a.dy * EMU_PER_PX)}</xdr:rowOff></xdr:from>` +
        `<xdr:ext cx="${Math.round(a.w * EMU_PER_PX)}" cy="${Math.round(a.h * EMU_PER_PX)}"/>` +
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="${name}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
        '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
        `<a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" r:id="rId${i + 1}"/></a:graphicData></a:graphic>` +
        "</xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>"
      );
    })
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`
  );
}

// ---------------------------------------------------------------- reading

/** "'My Sheet'!$B$2:$B$7" → sheet name and 0-based range. */
export function parseChartRef(f: string): { sheet: string; range: ChartRange } | null {
  const m = /^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(f.trim().replace(/^\(|\)$/g, ""));
  if (!m) return null;
  const col = (s: string) => s.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const c0 = col(m[3]);
  const r0 = Number(m[4]) - 1;
  const c1 = m[5] ? col(m[5]) : c0;
  const r1 = m[6] ? Number(m[6]) - 1 : r0;
  return {
    sheet: (m[1] ?? m[2]).replace(/''/g, "'"),
    range: { r0: Math.min(r0, r1), r1: Math.max(r0, r1), c0: Math.min(c0, c1), c1: Math.max(c0, c1) },
  };
}

function richText(el: Element | null): string {
  if (!el) return "";
  return all(el, "t").map((t) => text(t)).join("");
}

function readAxis(ax: Element | null): AxisConfig | undefined {
  if (!ax) return undefined;
  const out: AxisConfig = {};
  const sc = kid(ax, "scaling");
  const mn = numAttr(kid(sc, "min"), "val");
  const mx = numAttr(kid(sc, "max"), "val");
  const lb = numAttr(kid(sc, "logBase"), "val");
  const mu = numAttr(kid(ax, "majorUnit"), "val");
  if (mn !== null) out.min = mn;
  if (mx !== null) out.max = mx;
  if (lb !== null) out.logBase = lb;
  if (mu !== null) out.majorUnit = mu;
  const t = richText(kid(ax, "title"));
  if (t) out.title = t;
  const nf = kid(ax, "numFmt");
  if (nf && attr(nf, "sourceLinked") !== "1") {
    const code = attr(nf, "formatCode");
    if (code && code !== "General") out.numFmt = code;
  }
  return Object.keys(out).length ? out : undefined;
}

function readTrendline(ser: Element): TrendlineSpec | null {
  const t = kid(ser, "trendline");
  if (!t) return null;
  const type = (attr(kid(t, "trendlineType"), "val") ?? "linear") as TrendType;
  const spec: TrendlineSpec = { type };
  const order = numAttr(kid(t, "order"), "val");
  const period = numAttr(kid(t, "period"), "val");
  const fwd = numAttr(kid(t, "forward"), "val");
  const back = numAttr(kid(t, "backward"), "val");
  const icpt = numAttr(kid(t, "intercept"), "val");
  if (order !== null) spec.order = order;
  if (period !== null) spec.period = period;
  if (fwd) spec.forward = fwd;
  if (back) spec.backward = back;
  if (icpt !== null) spec.intercept = icpt;
  if (attr(kid(t, "dispEq"), "val") === "1") spec.showEquation = true;
  if (attr(kid(t, "dispRSqr"), "val") === "1") spec.showR2 = true;
  return spec;
}

function serColor(ser: Element): string | undefined {
  const sp = kid(ser, "spPr");
  const fill = kid(sp, "solidFill") ?? kid(kid(sp, "ln"), "solidFill");
  const v = attr(kid(fill, "srgbClr"), "val");
  return v ? `#${v.toLowerCase()}` : undefined;
}

/**
 * A chart part → ChartConfig (without id/anchor/sheetId, which come from the
 * drawing and workbook). Null when the chart has no usable series.
 */
export function readChartSpace(doc: Document): { cfg: Omit<ChartConfig, "id">; sheet: string | null } | null {
  const root = doc.documentElement;
  for (const ext of all(root, "ext")) {
    if (attr(ext, "uri") !== GROWN_CHART_URI) continue;
    try {
      const cfg = JSON.parse(text(kid(ext, "chart"))) as ChartConfig;
      if (cfg && cfg.range && cfg.type) return { cfg, sheet: null };
    } catch {
      /* fall back to the chart XML */
    }
  }
  const chart = kid(root, "chart");
  const plot = kid(chart, "plotArea");
  if (!plot) return null;
  const groupNames = ["barChart", "bar3DChart", "lineChart", "line3DChart", "areaChart", "area3DChart", "scatterChart", "pieChart", "pie3DChart", "doughnutChart", "radarChart"];
  const groups = Array.from(plot.children).filter((e) => groupNames.includes(e.localName));
  if (!groups.length) return null;
  const first = groups[0];
  const gName = first.localName.replace("3D", "");
  const groupingVal = attr(kid(first, "grouping"), "val") ?? "";
  let type: ChartType =
    gName === "barChart" ? (attr(kid(first, "barDir"), "val") === "bar" ? "bar" : "column") : gName === "lineChart" ? "line" : gName === "areaChart" ? "area" : gName === "scatterChart" ? "scatter" : gName === "doughnutChart" ? "doughnut" : gName === "pieChart" ? "pie" : "line";
  const stacking = groupingVal === "stacked" ? "stacked" : groupingVal === "percentStacked" ? "percent" : "none";

  // Series and their references (every group, in order).
  const axIdOf = (g: Element) => kids(g, "axId").map((a) => attr(a, "val"));
  const valAxes = kids(plot, "valAx");
  const primaryVal = attr(kid(valAxes[0], "axId"), "val");
  const series: { ser: Element; group: Element }[] = [];
  for (const g of groups) for (const ser of kids(g, "ser")) series.push({ ser, group: g });
  const refs: { name: ReturnType<typeof parseChartRef>; cat: ReturnType<typeof parseChartRef>; val: ReturnType<typeof parseChartRef> }[] = series.map(({ ser }) => ({
    name: parseChartRef(text(all(kid(ser, "tx"), "f")[0])),
    cat: parseChartRef(text(all(kid(ser, "cat") ?? kid(ser, "xVal"), "f")[0])),
    val: parseChartRef(text(all(kid(ser, "val") ?? kid(ser, "yVal"), "f")[0])),
  }));
  const vals = refs.map((r) => r.val).filter(Boolean) as NonNullable<ReturnType<typeof parseChartRef>>[];
  if (!vals.length) return null;
  const sheet = vals[0].sheet;
  const inRows = vals[0].range.r0 === vals[0].range.r1 && vals[0].range.c1 > vals[0].range.c0;
  const boxes = refs.flatMap((r) => [r.name, r.cat, r.val]).filter((x) => x && x.sheet === sheet).map((x) => x!.range);
  const range: ChartRange = {
    r0: Math.min(...boxes.map((b) => b.r0)),
    r1: Math.max(...boxes.map((b) => b.r1)),
    c0: Math.min(...boxes.map((b) => b.c0)),
    c1: Math.max(...boxes.map((b) => b.c1)),
  };
  const hasNames = refs.some((r) => r.name);
  const hasCats = refs.some((r) => r.cat);
  const seriesCfg: SeriesConfig[] = series.map(({ ser, group }) => {
    const sc: SeriesConfig = {};
    const color = serColor(ser);
    if (color) sc.color = color;
    const t = readTrendline(ser);
    if (t) sc.trendline = t;
    if (attr(kid(kid(ser, "dLbls"), "showVal"), "val") === "1") sc.dataLabels = true;
    if (groups.length > 1) {
      const n = group.localName.replace("3D", "");
      sc.type = n === "barChart" ? "column" : n === "areaChart" ? "area" : "line";
      if (primaryVal && !axIdOf(group).includes(primaryVal)) sc.secondary = true;
    }
    return sc;
  });
  if (groups.length > 1) type = "combo";
  const legendPos = attr(kid(kid(chart, "legend"), "legendPos"), "val");
  const legend: LegendPosition = !kid(chart, "legend") ? "none" : legendPos === "t" ? "top" : legendPos === "l" ? "left" : legendPos === "r" ? "right" : "bottom";
  const cfg: Omit<ChartConfig, "id"> = {
    type,
    title: richText(kid(chart, "title")),
    range,
    // Names sit on the first line across the categories, labels on the other.
    headerRow: inRows ? hasCats : hasNames,
    labelCol: inRows ? hasNames : hasCats,
    legend,
  };
  if (inRows) cfg.seriesInRows = true;
  if (stacking !== "none" && type !== "combo") cfg.stacking = stacking;
  if (type === "scatter" && /line/i.test(attr(kid(first, "scatterStyle"), "val") ?? "")) cfg.scatterLines = true;
  if (type === "doughnut") {
    const hs = numAttr(kid(first, "holeSize"), "val");
    if (hs !== null) cfg.holeSize = hs / 100;
  }
  if (type === "pie" || type === "doughnut") {
    // Slice colours come from data points.
    const pts = kids(series[0].ser, "dPt");
    if (pts.length) cfg.series = pts.map((p) => ({ color: serColor(p) }));
  } else if (seriesCfg.some((s) => Object.keys(s).length)) cfg.series = seriesCfg;
  if (series.some(({ ser }) => attr(kid(kid(ser, "dLbls"), "showVal"), "val") === "1") && seriesCfg.every((s) => s.dataLabels)) {
    cfg.dataLabels = true;
    cfg.series?.forEach((s) => delete s.dataLabels);
  }
  const catAx = kids(plot, "catAx")[0] ?? (type === "scatter" ? valAxes[0] : null);
  const yAx = type === "scatter" ? valAxes[1] : valAxes[0];
  const x = readAxis(catAx);
  const y = readAxis(yAx ?? null);
  if (x) cfg.xAxis = x;
  if (y) cfg.yAxis = y;
  if (type === "combo" && valAxes[1]) {
    const y2 = readAxis(valAxes[1]);
    if (y2) cfg.y2Axis = y2;
  }
  return { cfg, sheet };
}

/** Anchors of a drawing part: chart relationship id + Grown anchor. */
export function readDrawingAnchors(doc: Document, colPx: (c: number) => number, rowPx: (r: number) => number): { rid: string; anchor: ChartAnchor; name: string }[] {
  const out: { rid: string; anchor: ChartAnchor; name: string }[] = [];
  const root = doc.documentElement;
  for (const a of Array.from(root.children)) {
    const kind = a.localName;
    if (kind !== "twoCellAnchor" && kind !== "oneCellAnchor" && kind !== "absoluteAnchor") continue;
    const chartEl = all(a, "chart")[0];
    if (!chartEl) continue;
    const rid = chartEl.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? attr(chartEl, "id") ?? "";
    const from = kid(a, "from");
    const n = (el: Element | null, name: string) => Number(text(kid(el, name))) || 0;
    let anchor: ChartAnchor;
    if (kind === "absoluteAnchor") {
      const pos = kid(a, "pos");
      const ext = kid(a, "ext");
      anchor = { r: 0, c: 0, dx: Math.round((numAttr(pos, "x") ?? 0) / EMU_PER_PX), dy: Math.round((numAttr(pos, "y") ?? 0) / EMU_PER_PX), w: Math.round((numAttr(ext, "cx") ?? 4572000) / EMU_PER_PX), h: Math.round((numAttr(ext, "cy") ?? 2743200) / EMU_PER_PX) };
    } else {
      const c = n(from, "col");
      const r = n(from, "row");
      const dx = Math.round(n(from, "colOff") / EMU_PER_PX);
      const dy = Math.round(n(from, "rowOff") / EMU_PER_PX);
      let w = 480;
      let h = 300;
      if (kind === "oneCellAnchor") {
        const ext = kid(a, "ext");
        w = Math.round((numAttr(ext, "cx") ?? w * EMU_PER_PX) / EMU_PER_PX);
        h = Math.round((numAttr(ext, "cy") ?? h * EMU_PER_PX) / EMU_PER_PX);
      } else {
        const to = kid(a, "to");
        const c2 = n(to, "col");
        const r2 = n(to, "row");
        let x = -dx + Math.round(n(to, "colOff") / EMU_PER_PX);
        for (let i = c; i < c2; i++) x += colPx(i);
        let y = -dy + Math.round(n(to, "rowOff") / EMU_PER_PX);
        for (let i = r; i < r2; i++) y += rowPx(i);
        w = Math.max(120, x);
        h = Math.max(90, y);
      }
      anchor = { r, c, dx, dy, w, h };
    }
    const name = attr(all(a, "cNvPr")[0], "name") ?? "";
    out.push({ rid, anchor, name });
  }
  return out;
}
