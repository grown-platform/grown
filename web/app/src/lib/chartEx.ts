// ChartEx (Office 2016+ "cx:" charts: waterfall, histogram/pareto, funnel,
// treemap, sunburst, box & whisker, region map) ↔ a plain model, written
// from [MS-ODRAWXML] §2.24 (namespace
// http://schemas.microsoft.com/office/drawing/2014/chartex).
//
//   parseChartEx(xml)   cx:chartSpace → ChartEx (null if it isn't one)
//   chartExXml(model)   ChartEx → cx:chartSpace, elements in schema order
//   chartExToGrown(m)   the closest Grown chart (categories + series)
//   grownToChartEx(g)   a Grown waterfall/histogram/column/bar chart → ChartEx
//
// The model keeps what a chart means: the data sets (numeric and string
// dimensions with their formulas, number formats and cached points, kept as
// the exact strings the file had), the series (layout, data link, name,
// visibility, layout properties such as waterfall subtotals, histogram
// binning, treemap label layout, box-plot statistics), the axes, the title
// and the legend. Drawing properties (spPr/txPr) and extensions are not kept.
// Writing then reading a model gives the same model; reading then writing a
// document written by chartExXml gives the same text.

export const NS_CX = "http://schemas.microsoft.com/office/drawing/2014/chartex";
export const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export type CxLayout =
  | "waterfall"
  | "clusteredColumn"
  | "paretoLine"
  | "funnel"
  | "treemap"
  | "sunburst"
  | "boxWhisker"
  | "regionMap";

export interface CxPoint {
  idx: number;
  /** The cached value exactly as written. */
  v: string;
}
export interface CxLevel {
  ptCount?: number;
  formatCode?: string;
  name?: string;
  pts: CxPoint[];
}
export interface CxDim {
  kind: "num" | "str";
  /** val, x, y, size, colorVal (numeric) or cat, colorStr, entityId (string). */
  type: string;
  f?: { ref: string; dir?: "row" | "col" };
  nf?: { ref: string; dir?: "row" | "col" };
  levels: CxLevel[];
}
export interface CxData {
  id: number;
  dims: CxDim[];
}
export interface CxBinning {
  intervalClosed?: "r" | "l";
  /** "auto" or a number. */
  underflow?: string;
  overflow?: string;
  binSize?: number;
  binCount?: number;
}
export interface CxLayoutPr {
  parentLabelLayout?: "none" | "banner" | "overlapping";
  visibility?: Partial<Record<"connectorLines" | "meanLine" | "meanMarker" | "nonoutliers" | "outliers", boolean>>;
  /** Histogram with category aggregation (instead of binning). */
  aggregation?: boolean;
  binning?: CxBinning;
  quartileMethod?: "inclusive" | "exclusive";
  /** Waterfall: indexes of points drawn as totals. */
  subtotals?: number[];
}
export interface CxSeries {
  layoutId: CxLayout;
  hidden?: boolean;
  ownerIdx?: number;
  uniqueId?: string;
  formatIdx?: number;
  name?: string;
  nameRef?: string;
  dataLabels?: { pos?: string; seriesName?: boolean; categoryName?: boolean; value?: boolean };
  dataId?: number;
  layoutPr?: CxLayoutPr;
  axisIds?: number[];
}
export interface CxAxis {
  id: number;
  hidden?: boolean;
  /** Category axis (gap width) or value axis (bounds). */
  scaling: { kind: "cat"; gapWidth?: string } | { kind: "val"; min?: string; max?: string; majorUnit?: string; minorUnit?: string };
  title?: string;
  majorGridlines?: boolean;
  minorGridlines?: boolean;
  tickLabels?: boolean;
  numFmt?: { formatCode: string; sourceLinked?: boolean };
}
export interface ChartEx {
  externalData?: { id: string; autoUpdate?: boolean };
  data: CxData[];
  title?: { text: string; pos?: string; align?: string; overlay?: boolean };
  series: CxSeries[];
  axes: CxAxis[];
  legend?: { pos?: string; align?: string; overlay?: boolean };
}

// ------------------------------------------------------------------ reading

const kids = (el: Element | null | undefined, local?: string): Element[] =>
  el ? Array.from(el.children).filter((c) => c.namespaceURI === NS_CX && (!local || c.localName === local)) : [];
const kid = (el: Element | null | undefined, local: string) => kids(el, local)[0] ?? null;
const attr = (el: Element | null | undefined, name: string) => el?.getAttribute(name) ?? null;
const bool = (v: string | null) => (v === null ? undefined : v === "1" || v === "true");
const int = (v: string | null) => (v === null || !/^-?\d+$/.test(v.trim()) ? undefined : parseInt(v, 10));
const dir = (v: string | null): "row" | "col" | undefined => (v === "row" || v === "col" ? v : undefined);

function formula(el: Element | null): { ref: string; dir?: "row" | "col" } | undefined {
  if (!el) return undefined;
  const d = dir(attr(el, "dir"));
  return { ref: el.textContent ?? "", ...(d ? { dir: d } : {}) };
}

function richText(tx: Element | null): { text: string; ref?: string } | undefined {
  if (!tx) return undefined;
  const data = kid(tx, "txData");
  if (data) {
    const f = kid(data, "f")?.textContent ?? undefined;
    return { text: kid(data, "v")?.textContent ?? "", ...(f !== undefined ? { ref: f } : {}) };
  }
  const rich = kid(tx, "rich");
  if (!rich) return undefined;
  const paras = Array.from(rich.getElementsByTagNameNS(NS_A, "p")).map((p) =>
    Array.from(p.getElementsByTagNameNS(NS_A, "t"))
      .map((t) => t.textContent ?? "")
      .join(""),
  );
  return { text: paras.join("\n") };
}

function readLevel(lvl: Element): CxLevel {
  const ptCount = int(attr(lvl, "ptCount"));
  const formatCode = attr(lvl, "formatCode");
  const name = attr(lvl, "name");
  return {
    ...(ptCount !== undefined ? { ptCount } : {}),
    ...(formatCode !== null ? { formatCode } : {}),
    ...(name !== null ? { name } : {}),
    pts: kids(lvl, "pt").map((p) => ({ idx: int(attr(p, "idx")) ?? 0, v: p.textContent ?? "" })),
  };
}

function readDim(el: Element): CxDim {
  const f = formula(kid(el, "f"));
  const nf = formula(kid(el, "nf"));
  return {
    kind: el.localName === "numDim" ? "num" : "str",
    type: attr(el, "type") ?? (el.localName === "numDim" ? "val" : "cat"),
    ...(f ? { f } : {}),
    ...(nf ? { nf } : {}),
    levels: kids(el, "lvl").map(readLevel),
  };
}

const LAYOUTS = new Set<CxLayout>(["waterfall", "clusteredColumn", "paretoLine", "funnel", "treemap", "sunburst", "boxWhisker", "regionMap"]);

function readLayoutPr(el: Element | null): CxLayoutPr | undefined {
  if (!el) return undefined;
  const out: CxLayoutPr = {};
  const pll = attr(kid(el, "parentLabelLayout"), "val");
  if (pll === "none" || pll === "banner" || pll === "overlapping") out.parentLabelLayout = pll;
  const vis = kid(el, "visibility");
  if (vis) {
    const v: NonNullable<CxLayoutPr["visibility"]> = {};
    for (const k of ["connectorLines", "meanLine", "meanMarker", "nonoutliers", "outliers"] as const) {
      const b = bool(attr(vis, k));
      if (b !== undefined) v[k] = b;
    }
    out.visibility = v;
  }
  if (kid(el, "aggregation")) out.aggregation = true;
  const bin = kid(el, "binning");
  if (bin) {
    const b: CxBinning = {};
    const ic = attr(bin, "intervalClosed");
    if (ic === "r" || ic === "l") b.intervalClosed = ic;
    const u = attr(bin, "underflow");
    const o = attr(bin, "overflow");
    if (u !== null) b.underflow = u;
    if (o !== null) b.overflow = o;
    const size = kid(bin, "binSize");
    const count = kid(bin, "binCount");
    if (size) b.binSize = Number(attr(size, "val"));
    if (count) b.binCount = Number(attr(count, "val"));
    out.binning = b;
  }
  const qm = attr(kid(el, "statistics"), "quartileMethod");
  if (qm === "inclusive" || qm === "exclusive") out.quartileMethod = qm;
  const st = kid(el, "subtotals");
  if (st) out.subtotals = kids(st, "idx").map((i) => int(attr(i, "val")) ?? 0);
  return out;
}

function readSeries(el: Element): CxSeries | null {
  const layoutId = attr(el, "layoutId") as CxLayout | null;
  if (!layoutId || !LAYOUTS.has(layoutId)) return null;
  const s: CxSeries = { layoutId };
  const hidden = bool(attr(el, "hidden"));
  if (hidden !== undefined) s.hidden = hidden;
  const owner = int(attr(el, "ownerIdx"));
  if (owner !== undefined) s.ownerIdx = owner;
  const uniq = attr(el, "uniqueId");
  if (uniq !== null) s.uniqueId = uniq;
  const fmt = int(attr(el, "formatIdx"));
  if (fmt !== undefined) s.formatIdx = fmt;
  const tx = richText(kid(el, "tx"));
  if (tx) {
    s.name = tx.text;
    if (tx.ref !== undefined) s.nameRef = tx.ref;
  }
  const dl = kid(el, "dataLabels");
  if (dl) {
    const vis = kid(dl, "visibility");
    const lab: NonNullable<CxSeries["dataLabels"]> = {};
    const pos = attr(dl, "pos");
    if (pos) lab.pos = pos;
    for (const k of ["seriesName", "categoryName", "value"] as const) {
      const b = bool(attr(vis, k));
      if (b !== undefined) lab[k] = b;
    }
    s.dataLabels = lab;
  }
  const did = int(attr(kid(el, "dataId"), "val"));
  if (did !== undefined) s.dataId = did;
  const lp = readLayoutPr(kid(el, "layoutPr"));
  if (lp) s.layoutPr = lp;
  const ax = kids(el, "axisId").map((a) => int(attr(a, "val")) ?? 0);
  if (ax.length) s.axisIds = ax;
  return s;
}

function readAxis(el: Element): CxAxis {
  const cat = kid(el, "catScaling");
  const val = kid(el, "valScaling");
  let scaling: CxAxis["scaling"];
  if (cat) {
    const g = attr(cat, "gapWidth");
    scaling = { kind: "cat", ...(g !== null ? { gapWidth: g } : {}) };
  } else {
    const v: { kind: "val"; min?: string; max?: string; majorUnit?: string; minorUnit?: string } = { kind: "val" };
    for (const k of ["min", "max", "majorUnit", "minorUnit"] as const) {
      const a = attr(val, k);
      if (a !== null) v[k] = a;
    }
    scaling = v;
  }
  const a: CxAxis = { id: int(attr(el, "id")) ?? 0, scaling };
  const hidden = bool(attr(el, "hidden"));
  if (hidden !== undefined) a.hidden = hidden;
  const title = richText(kid(kid(el, "title"), "tx"));
  if (title) a.title = title.text;
  if (kid(el, "majorGridlines")) a.majorGridlines = true;
  if (kid(el, "minorGridlines")) a.minorGridlines = true;
  if (kid(el, "tickLabels")) a.tickLabels = true;
  const nf = kid(el, "numFmt");
  if (nf) {
    const sl = bool(attr(nf, "sourceLinked"));
    a.numFmt = { formatCode: attr(nf, "formatCode") ?? "General", ...(sl !== undefined ? { sourceLinked: sl } : {}) };
  }
  return a;
}

/** Read a cx:chartSpace document; null when the text isn't XML or the root
 *  isn't a ChartEx chart space. */
export function parseChartEx(xml: string | Document): ChartEx | null {
  let doc: Document;
  if (typeof xml === "string") {
    if (!/<\s*[\w.-]+:?[\w.-]*/.test(xml)) return null;
    doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) return null;
  } else doc = xml;
  const root = doc.documentElement;
  if (!root || root.namespaceURI !== NS_CX || root.localName !== "chartSpace") return null;
  const cd = kid(root, "chartData");
  const ext = kid(cd, "externalData");
  const chart = kid(root, "chart");
  const plot = kid(chart, "plotArea");
  const region = kid(plot, "plotAreaRegion");
  const m: ChartEx = {
    data: kids(cd, "data").map((d) => ({
      id: int(attr(d, "id")) ?? 0,
      dims: kids(d).filter((c) => c.localName === "numDim" || c.localName === "strDim").map(readDim),
    })),
    series: kids(region, "series").map(readSeries).filter((s): s is CxSeries => !!s),
    axes: kids(plot, "axis").map(readAxis),
  };
  if (ext) {
    const au = bool(attr(ext, "autoUpdate"));
    m.externalData = { id: attr(ext, "r:id") ?? ext.getAttributeNS(NS_R, "id") ?? attr(ext, "id") ?? "", ...(au !== undefined ? { autoUpdate: au } : {}) };
  }
  const t = kid(chart, "title");
  if (t) {
    const text = richText(kid(t, "tx"))?.text ?? "";
    const ov = bool(attr(t, "overlay"));
    m.title = {
      text,
      ...(attr(t, "pos") ? { pos: attr(t, "pos")! } : {}),
      ...(attr(t, "align") ? { align: attr(t, "align")! } : {}),
      ...(ov !== undefined ? { overlay: ov } : {}),
    };
  }
  const lg = kid(chart, "legend");
  if (lg) {
    const ov = bool(attr(lg, "overlay"));
    m.legend = {
      ...(attr(lg, "pos") ? { pos: attr(lg, "pos")! } : {}),
      ...(attr(lg, "align") ? { align: attr(lg, "align")! } : {}),
      ...(ov !== undefined ? { overlay: ov } : {}),
    };
  }
  return m;
}

// ------------------------------------------------------------------ writing

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function el(name: string, attrs: Record<string, string | number | boolean | undefined>, body?: string): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${esc(typeof v === "boolean" ? (v ? "1" : "0") : String(v))}"`)
    .join("");
  return body === undefined || body === "" ? `<${name}${a}/>` : `<${name}${a}>${body}</${name}>`;
}

const fXml = (name: string, f: CxDim["f"]) => (f ? el(name, { dir: f.dir }, esc(f.ref) || undefined) : "");

function dimXml(d: CxDim): string {
  const levels = d.levels
    .map((l) =>
      el(
        "cx:lvl",
        { ptCount: l.ptCount, formatCode: l.formatCode, name: l.name },
        l.pts.map((p) => el("cx:pt", { idx: p.idx }, esc(p.v) || undefined)).join(""),
      ),
    )
    .join("");
  return el(d.kind === "num" ? "cx:numDim" : "cx:strDim", { type: d.type }, fXml("cx:f", d.f) + fXml("cx:nf", d.nf) + levels);
}

const richXml = (text: string) =>
  el(
    "cx:tx",
    {},
    el(
      "cx:rich",
      {},
      `<a:bodyPr/>` + text.split("\n").map((p) => `<a:p><a:r><a:t>${esc(p)}</a:t></a:r></a:p>`).join(""),
    ),
  );

function layoutPrXml(p: CxLayoutPr | undefined): string {
  if (!p) return "";
  let b = "";
  if (p.parentLabelLayout) b += el("cx:parentLabelLayout", { val: p.parentLabelLayout });
  if (p.visibility) b += el("cx:visibility", { ...p.visibility });
  if (p.aggregation) b += el("cx:aggregation", {});
  else if (p.binning) {
    const n = p.binning;
    const inner = n.binSize !== undefined ? el("cx:binSize", { val: n.binSize }) : n.binCount !== undefined ? el("cx:binCount", { val: n.binCount }) : "";
    b += el("cx:binning", { intervalClosed: n.intervalClosed, underflow: n.underflow, overflow: n.overflow }, inner);
  }
  if (p.quartileMethod) b += el("cx:statistics", { quartileMethod: p.quartileMethod });
  if (p.subtotals) b += el("cx:subtotals", {}, p.subtotals.map((i) => el("cx:idx", { val: i })).join(""));
  return el("cx:layoutPr", {}, b);
}

function seriesXml(s: CxSeries): string {
  let b = "";
  if (s.name !== undefined || s.nameRef !== undefined)
    b += el(
      "cx:tx",
      {},
      el("cx:txData", {}, (s.nameRef !== undefined ? el("cx:f", {}, esc(s.nameRef) || undefined) : "") + el("cx:v", {}, esc(s.name ?? "") || undefined)),
    );
  if (s.dataLabels) {
    const { pos, ...vis } = s.dataLabels;
    b += el("cx:dataLabels", { pos }, Object.keys(vis).length ? el("cx:visibility", { ...vis }) : "");
  }
  if (s.dataId !== undefined) b += el("cx:dataId", { val: s.dataId });
  b += layoutPrXml(s.layoutPr);
  for (const a of s.axisIds ?? []) b += el("cx:axisId", { val: a });
  return el("cx:series", { layoutId: s.layoutId, hidden: s.hidden, ownerIdx: s.ownerIdx, uniqueId: s.uniqueId, formatIdx: s.formatIdx }, b);
}

function axisXml(a: CxAxis): string {
  const sc = a.scaling;
  let b =
    sc.kind === "cat"
      ? el("cx:catScaling", { gapWidth: sc.gapWidth })
      : el("cx:valScaling", { max: sc.max, min: sc.min, majorUnit: sc.majorUnit, minorUnit: sc.minorUnit });
  if (a.title !== undefined) b += el("cx:title", {}, richXml(a.title));
  if (a.majorGridlines) b += el("cx:majorGridlines", {});
  if (a.minorGridlines) b += el("cx:minorGridlines", {});
  if (a.tickLabels) b += el("cx:tickLabels", {});
  if (a.numFmt) b += el("cx:numFmt", { formatCode: a.numFmt.formatCode, sourceLinked: a.numFmt.sourceLinked });
  return el("cx:axis", { id: a.id, hidden: a.hidden }, b);
}

/** Write a ChartEx model as a cx:chartSpace document. */
export function chartExXml(m: ChartEx): string {
  const data =
    (m.externalData ? el("cx:externalData", { "r:id": m.externalData.id, autoUpdate: m.externalData.autoUpdate }) : "") +
    m.data.map((d) => el("cx:data", { id: d.id }, d.dims.map(dimXml).join(""))).join("");
  const title = m.title
    ? el("cx:title", { pos: m.title.pos, align: m.title.align, overlay: m.title.overlay }, richXml(m.title.text))
    : "";
  const plot = el("cx:plotArea", {}, el("cx:plotAreaRegion", {}, m.series.map(seriesXml).join("")) + m.axes.map(axisXml).join(""));
  const legend = m.legend ? el("cx:legend", { pos: m.legend.pos, align: m.legend.align, overlay: m.legend.overlay }) : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<cx:chartSpace xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:cx="${NS_CX}">` +
    el("cx:chartData", {}, data) +
    el("cx:chart", {}, title + plot + legend) +
    `</cx:chartSpace>`
  );
}

// ------------------------------------------------------------------ Grown charts

/** A chart in Grown's terms (see pages/sheets/chartData.ts ChartConfig). */
export interface GrownChartEx {
  type: "waterfall" | "histogram" | "column" | "bar" | "pie";
  title: string;
  categories: string[];
  series: { name: string; values: number[] }[];
  /** Waterfall: category indexes drawn as totals. */
  totals?: number[];
  histogram?: { binSize?: number | null; binCount?: number | null; underflow?: number | null; overflow?: number | null; closed?: "right" | "left" };
  legend?: "right" | "left" | "top" | "bottom" | "none";
  dataLabels?: boolean;
  /** Set when the chartEx layout has no Grown equivalent and was drawn as `type`. */
  approximated?: CxLayout;
}

/** Cached points of the first level of a dimension, in idx order. */
function points(d: CxDim | undefined): string[] {
  const lvl = d?.levels[0];
  if (!lvl) return [];
  const n = Math.max(lvl.ptCount ?? 0, ...lvl.pts.map((p) => p.idx + 1));
  const out = new Array<string>(n).fill("");
  for (const p of lvl.pts) if (p.idx >= 0 && p.idx < n) out[p.idx] = p.v;
  return out;
}

const LEGEND: Record<string, GrownChartEx["legend"]> = { l: "left", r: "right", t: "top", b: "bottom" };

/** The closest Grown chart for a ChartEx model; null when nothing is drawable. */
export function chartExToGrown(m: ChartEx): GrownChartEx | null {
  const main = m.series.filter((s) => !s.hidden && s.layoutId !== "paretoLine" && s.layoutId !== "regionMap");
  if (!main.length) return null;
  const layout = main[0].layoutId;
  const dataOf = (s: CxSeries) => m.data.find((d) => d.id === (s.dataId ?? 0));
  const first = dataOf(main[0]);
  const cat = first?.dims.find((d) => d.type === "cat");
  const valueDim = (d: CxData | undefined) => d?.dims.find((x) => x.kind === "num" && (x.type === "val" || x.type === "size" || x.type === "y"));
  const series = main
    .filter((s) => s.layoutId === layout)
    .map((s, i) => ({ name: s.name ?? `Series ${i + 1}`, values: points(valueDim(dataOf(s))).map((v) => (v === "" ? NaN : Number(v))) }))
    .filter((s) => s.values.length);
  if (!series.length) return null;
  const categories = points(cat);
  const base = {
    title: m.title?.text ?? "",
    categories: categories.length ? categories : series[0].values.map((_, i) => String(i + 1)),
    series,
    ...(m.legend?.pos && LEGEND[m.legend.pos] ? { legend: LEGEND[m.legend.pos] } : m.legend ? {} : { legend: "none" as const }),
    ...(main[0].dataLabels?.value ? { dataLabels: true } : {}),
  };
  const lp = main[0].layoutPr;
  const num = (v: string | undefined) => (v === undefined || v === "auto" || !Number.isFinite(Number(v)) ? null : Number(v));
  switch (layout) {
    case "waterfall":
      return { type: "waterfall", ...base, ...(lp?.subtotals?.length ? { totals: [...lp.subtotals] } : {}) };
    case "clusteredColumn":
      if (lp?.aggregation || !lp?.binning) return { type: "column", ...base };
      return {
        type: "histogram",
        ...base,
        histogram: {
          ...(lp.binning.binSize !== undefined ? { binSize: lp.binning.binSize } : {}),
          ...(lp.binning.binCount !== undefined ? { binCount: lp.binning.binCount } : {}),
          ...(num(lp.binning.underflow) !== null ? { underflow: num(lp.binning.underflow) } : {}),
          ...(num(lp.binning.overflow) !== null ? { overflow: num(lp.binning.overflow) } : {}),
          ...(lp.binning.intervalClosed === "l" ? { closed: "left" as const } : {}),
        },
      };
    case "funnel":
      return { type: "bar", ...base, approximated: layout };
    case "treemap":
    case "sunburst":
      return { type: "pie", ...base, approximated: layout };
    default:
      return { type: "column", ...base, approximated: layout };
  }
}

/** A Grown chart as ChartEx (waterfall and histogram are native chartEx
 *  layouts; column and bar become clustered columns / a funnel). */
export function grownToChartEx(g: GrownChartEx): ChartEx {
  const layout: CxLayout = g.type === "waterfall" ? "waterfall" : g.type === "bar" ? "funnel" : g.type === "pie" ? "treemap" : "clusteredColumn";
  const data: CxData[] = g.series.map((s, i) => ({
    id: i,
    dims: [
      ...(g.type === "histogram"
        ? []
        : [{ kind: "str" as const, type: "cat", levels: [{ ptCount: g.categories.length, pts: g.categories.map((v, idx) => ({ idx, v })) }] }]),
      {
        kind: "num" as const,
        type: g.type === "pie" ? "size" : "val",
        levels: [{ ptCount: s.values.length, formatCode: "General", pts: s.values.flatMap((v, idx) => (Number.isFinite(v) ? [{ idx, v: String(v) }] : [])) }],
      },
    ],
  }));
  const series: CxSeries[] = g.series.map((s, i) => {
    const layoutPr: CxLayoutPr = {};
    if (g.type === "waterfall" && g.totals?.length) layoutPr.subtotals = [...g.totals];
    if (g.type === "histogram") {
      const h = g.histogram ?? {};
      layoutPr.binning = {
        intervalClosed: h.closed === "left" ? "l" : "r",
        ...(h.underflow != null ? { underflow: String(h.underflow) } : {}),
        ...(h.overflow != null ? { overflow: String(h.overflow) } : {}),
        ...(h.binCount != null ? { binCount: h.binCount } : h.binSize != null ? { binSize: h.binSize } : {}),
      };
    }
    return {
      layoutId: layout,
      uniqueId: `{0000000${i}-0000-4000-8000-000000000000}`,
      name: s.name,
      ...(g.dataLabels ? { dataLabels: { pos: "outEnd", value: true } } : {}),
      dataId: i,
      ...(Object.keys(layoutPr).length ? { layoutPr } : {}),
    };
  });
  const axes: CxAxis[] =
    g.type === "pie" || g.type === "bar"
      ? []
      : [
          { id: 0, scaling: { kind: "cat", gapWidth: g.type === "histogram" ? "0" : "0.5" }, tickLabels: true },
          { id: 1, scaling: { kind: "val" }, majorGridlines: true, tickLabels: true },
        ];
  const pos = Object.entries(LEGEND).find(([, v]) => v === g.legend)?.[0];
  return {
    data,
    ...(g.title ? { title: { text: g.title, pos: "t", align: "ctr", overlay: false } } : {}),
    series,
    axes,
    ...(g.legend && g.legend !== "none" ? { legend: { pos: pos ?? "b", align: "ctr", overlay: false } } : {}),
  };
}
