/**
 * ChartRenderer — a dependency-free SVG chart component.
 *
 * Draws every Grown chart type from a ChartConfig and the series read from
 * the sheet (chartData.buildChartInput): column / bar / line / area (plain,
 * stacked, 100 %), combo (columns, lines or areas per series, optional
 * secondary axis), scatter (points or lines), pie, doughnut, histogram and
 * waterfall; trendlines with equation and R², data labels, axis titles,
 * fixed axis bounds, number formats and legend placement. Plain SVG, so it
 * works offline and exports as-is.
 */
import type { ReactNode } from "react";
import { axisFraction, axisScale, formatTick, type AxisScale } from "./chartAxis";
import {
  layoutSeries,
  pieShares,
  seriesColor,
  themeSeriesColor,
  waterfallBars,
  type AxisConfig,
  type ChartConfig,
  type ChartInput,
  type ChartSeries,
  type ChartType,
  type LegendPosition,
} from "./chartData";
import { aggregateByCategory, binLabel, binValues } from "./histogram";
import { formatRuns } from "./numberFormat";
import {
  fitTrendline,
  movingAverage,
  movingAveragePoints,
  r2Label,
  trendlineCurve,
  trendlineEquation,
  trendlineName,
  type TrendlineSpec,
} from "./trendlines";

export type { ChartType, ChartSeries };

/** @deprecated kept for callers of the pre-M10 palette; charts use the theme accents. */
export const CHART_PALETTE = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => themeSeriesColor(k));

const INK = "#1f1f1f";
const INK2 = "#555";
const MUTED = "#8a8a8a";
const GRID = "#e6e6e6";
const AXIS = "#bdbdbd";
const SURFACE = "#ffffff";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export interface ChartRendererProps {
  config: ChartConfig;
  input: ChartInput;
  width?: number;
  height?: number;
}

interface LegendItem {
  name: string;
  color: string;
  kind: "box" | "line" | "dash";
}

function fmtWith(numFmt: string | undefined, v: number): string {
  if (!Number.isFinite(v)) return "";
  if (numFmt && numFmt !== "General") {
    try {
      return formatRuns(v, numFmt).runs.map((r) => r.text).join("");
    } catch {
      /* fall through */
    }
  }
  return formatTick(v);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s;
}

/** A bar with its data end rounded and the baseline end square. */
function barPath(x: number, y: number, w: number, h: number, end: "top" | "bottom" | "right" | "left"): string {
  const r = Math.max(0, Math.min(3, w / 2, h / 2));
  if (w <= 0 || h <= 0) return "";
  switch (end) {
    case "top":
      return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
    case "bottom":
      return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
    case "right":
      return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
    case "left":
      return `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`;
  }
}

function legendDefault(cfg: ChartConfig, seriesCount: number): LegendPosition {
  if (cfg.legend) return cfg.legend;
  if (cfg.type === "pie" || cfg.type === "doughnut") return "right";
  if (cfg.type === "waterfall") return "bottom";
  const hasTrend = (cfg.series ?? []).some((s) => s?.trendline);
  return seriesCount > 1 || hasTrend ? "bottom" : "none";
}

/** Per-series draw kind for column/bar/line/area/combo charts. */
function seriesKind(cfg: ChartConfig, k: number): "column" | "line" | "area" {
  if (cfg.type === "combo") return cfg.series?.[k]?.type ?? (k === 0 ? "column" : "line");
  if (cfg.type === "line") return "line";
  if (cfg.type === "area") return "area";
  return "column";
}

export function ChartRenderer({ config: cfg, input, width = 480, height = 300 }: ChartRendererProps) {
  const type = cfg.type;
  const title = cfg.title?.trim();
  const pad = 10;
  const titleH = title ? 26 : 0;

  // ---------- derived data per type ----------
  let categories = input.categories;
  let series = input.series;
  let histogramNote: string | null = null;
  if (type === "histogram") {
    const values = series[0]?.values ?? [];
    if (cfg.histogram?.byCategory) {
      const rows = aggregateByCategory(values, categories);
      categories = rows.map((r) => r.label);
      series = [{ name: series[0]?.name ?? "Values", values: rows.map((r) => r.value) }];
    } else {
      const b = binValues(values, cfg.histogram ?? {});
      const fmt = (v: number) => fmtWith(cfg.xAxis?.numFmt, v);
      categories = b.bins.map((bin, i) => binLabel(bin, i - (b.bins[0]?.min === null ? 1 : 0), cfg.histogram?.closed, fmt));
      series = [{ name: series[0]?.name ?? "Frequency", values: b.bins.map((x) => x.count) }];
      if (!b.bins.length) histogramNote = "No numeric values";
    }
  }

  // ---------- legend ----------
  const legendItems: LegendItem[] = [];
  const isPie = type === "pie" || type === "doughnut";
  if (isPie) categories.forEach((c, i) => legendItems.push({ name: c, color: seriesColor(cfg, i), kind: "box" }));
  else if (type === "waterfall") {
    legendItems.push({ name: "Increase", color: themeSeriesColor(0), kind: "box" });
    legendItems.push({ name: "Decrease", color: themeSeriesColor(1), kind: "box" });
    if ((cfg.totals ?? []).length) legendItems.push({ name: "Total", color: themeSeriesColor(2), kind: "box" });
  } else {
    series.forEach((s, k) => {
      const kind = type === "scatter" ? (cfg.scatterLines ? "line" : "box") : seriesKind(cfg, k) === "line" ? "line" : "box";
      legendItems.push({ name: s.name, color: seriesColor(cfg, k), kind });
    });
    series.forEach((s, k) => {
      const t = cfg.series?.[k]?.trendline;
      if (t) legendItems.push({ name: trendlineName(t, s.name), color: seriesColor(cfg, k), kind: "dash" });
    });
  }
  const legendPos = legendDefault(cfg, series.length);
  const showLegend = legendPos !== "none" && legendItems.length > 0;
  const legendW = showLegend && (legendPos === "right" || legendPos === "left") ? Math.min(150, Math.max(70, 26 + 6.2 * Math.max(...legendItems.map((l) => Math.min(18, l.name.length))))) : 0;
  // Horizontal legends wrap onto rows.
  const itemW = (l: LegendItem) => 24 + 6.2 * Math.min(22, l.name.length) + 12;
  const legendRows: LegendItem[][] = [];
  if (showLegend && (legendPos === "top" || legendPos === "bottom")) {
    let row: LegendItem[] = [];
    let used = 0;
    for (const l of legendItems) {
      if (row.length && used + itemW(l) > width - 2 * pad) {
        legendRows.push(row);
        row = [];
        used = 0;
      }
      row.push(l);
      used += itemW(l);
    }
    if (row.length) legendRows.push(row);
  }
  const legendH = legendRows.length * 18;

  const box = {
    x: pad + (legendPos === "left" ? legendW : 0),
    y: pad + titleH + (legendPos === "top" ? legendH + 4 : 0),
    w: width - 2 * pad - legendW,
    h: height - 2 * pad - titleH - (legendPos === "top" || legendPos === "bottom" ? legendH + 4 : 0),
  };

  const legend = showLegend ? renderLegend(legendItems, legendPos, legendRows, box, width, legendW) : null;
  const titleEl = title ? (
    <text x={width / 2} y={pad + 15} textAnchor="middle" fontSize={14} fontWeight={600} fill={INK}>
      {truncate(title, Math.floor(width / 8))}
    </text>
  ) : null;

  const wrap = (children: ReactNode) => (
    <svg width={width} height={height} role="img" aria-label={title || `${type} chart`} fontFamily={FONT} data-chart-type={type} style={{ display: "block" }}>
      <rect x={0} y={0} width={width} height={height} fill={SURFACE} />
      {titleEl}
      {children}
      {legend}
    </svg>
  );

  if (histogramNote || (!series.length && !isPie)) {
    return wrap(
      <text x={width / 2} y={height / 2} textAnchor="middle" fontSize={12} fill={MUTED}>
        {histogramNote ?? "No data"}
      </text>,
    );
  }

  if (isPie) return wrap(renderPie(cfg, series[0]?.values ?? [], categories, box));
  if (type === "scatter") return wrap(renderScatter(cfg, input, series, box));
  return wrap(renderCategory(cfg, categories, series, box));
}

// ---------------------------------------------------------------- legend

function renderLegend(
  items: LegendItem[],
  pos: LegendPosition,
  rows: LegendItem[][],
  box: { x: number; y: number; w: number; h: number },
  width: number,
  legendW: number,
): ReactNode {
  const swatch = (l: LegendItem) =>
    l.kind === "box" ? (
      <rect width={10} height={10} y={-9} rx={2} fill={l.color} />
    ) : (
      <line x1={0} x2={14} y1={-4} y2={-4} stroke={l.color} strokeWidth={2} strokeDasharray={l.kind === "dash" ? "4 3" : undefined} />
    );
  if (pos === "right" || pos === "left") {
    const x0 = pos === "right" ? width - 10 - legendW + 8 : 10;
    const top = box.y + Math.max(0, (box.h - items.length * 18) / 2) + 12;
    return (
      <g data-legend={pos}>
        {items.slice(0, Math.floor(box.h / 18)).map((l, i) => (
          <g key={i} transform={`translate(${x0}, ${top + i * 18})`}>
            {swatch(l)}
            <text x={l.kind === "box" ? 15 : 19} fontSize={11} fill={INK2}>
              {truncate(l.name, 18)}
            </text>
          </g>
        ))}
      </g>
    );
  }
  const y0 = pos === "top" ? box.y - rows.length * 18 - 4 + 13 : box.y + box.h + 4 + 13;
  return (
    <g data-legend={pos}>
      {rows.map((row, ri) => {
        const total = row.reduce((s, l) => s + 24 + 6.2 * Math.min(22, l.name.length) + 12, 0) - 12;
        let x = Math.max(10, (width - total) / 2);
        return row.map((l, i) => {
          const g = (
            <g key={`${ri}-${i}`} transform={`translate(${x}, ${y0 + ri * 18})`}>
              {swatch(l)}
              <text x={l.kind === "box" ? 15 : 19} fontSize={11} fill={INK2}>
                {truncate(l.name, 22)}
              </text>
            </g>
          );
          x += 24 + 6.2 * Math.min(22, l.name.length) + 12;
          return g;
        });
      })}
    </g>
  );
}

// ---------------------------------------------------------------- pie / doughnut

function renderPie(cfg: ChartConfig, values: number[], categories: string[], box: { x: number; y: number; w: number; h: number }): ReactNode {
  const shares = pieShares(values);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rad = Math.max(10, Math.min(box.w, box.h) / 2 - 4);
  const hole = cfg.type === "doughnut" ? rad * Math.max(0.1, Math.min(0.9, cfg.holeSize ?? 0.5)) : 0;
  let angle = -Math.PI / 2;
  const out: ReactNode[] = [];
  const labels: ReactNode[] = [];
  shares.forEach((frac, i) => {
    if (frac <= 0) return;
    const a1 = angle;
    const a2 = angle + frac * Math.PI * 2;
    angle = a2;
    const color = seriesColor(cfg, i);
    const tip = <title>{`${categories[i] ?? ""}: ${fmtWith(cfg.yAxis?.numFmt, values[i])} (${Math.round(frac * 1000) / 10}%)`}</title>;
    if (frac >= 0.9999) {
      out.push(
        <g key={i}>
          <circle cx={cx} cy={cy} r={rad} fill={color} />
          {hole ? <circle cx={cx} cy={cy} r={hole} fill={SURFACE} /> : null}
          {tip}
        </g>,
      );
    } else {
      const large = a2 - a1 > Math.PI ? 1 : 0;
      const p = (r: number, a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
      const d = hole
        ? `M ${p(rad, a1)} A ${rad} ${rad} 0 ${large} 1 ${p(rad, a2)} L ${p(hole, a2)} A ${hole} ${hole} 0 ${large} 0 ${p(hole, a1)} Z`
        : `M ${cx} ${cy} L ${p(rad, a1)} A ${rad} ${rad} 0 ${large} 1 ${p(rad, a2)} Z`;
      out.push(
        <path key={i} d={d} fill={color} stroke={SURFACE} strokeWidth={2} data-mark="slice">
          {tip}
        </path>,
      );
    }
    if (frac > 0.05) {
      const mid = (a1 + a2) / 2;
      const lr = hole ? (rad + hole) / 2 : rad * 0.62;
      const text = cfg.dataLabels ? fmtWith(cfg.yAxis?.numFmt, values[i]) : `${Math.round(frac * 100)}%`;
      labels.push(
        <text key={`l${i}`} x={cx + lr * Math.cos(mid)} y={cy + lr * Math.sin(mid) + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="#fff">
          {text}
        </text>,
      );
    }
  });
  return (
    <g>
      {out}
      {labels}
    </g>
  );
}

// ---------------------------------------------------------------- axes helpers

interface Plot {
  x: number;
  y: number;
  w: number;
  h: number;
}

function valueTicks(scale: AxisScale, axis: AxisConfig | undefined, percent: boolean): string[] {
  const fmt = axis?.numFmt || (percent ? "0%" : undefined);
  return scale.ticks.map((t) => fmtWith(fmt, t));
}

function axisTitle(text: string | undefined, x: number, y: number, rotate = false): ReactNode {
  if (!text) return null;
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={11} fill={INK2} transform={rotate ? `rotate(-90 ${x} ${y})` : undefined}>
      {truncate(text, 40)}
    </text>
  );
}

/** Plot rect after axis labels and titles are placed. */
function plotRect(
  box: Plot,
  horizontal: boolean,
  leftLabels: string[],
  hasY2: boolean,
  y2Labels: string[],
  cfg: ChartConfig,
): Plot {
  const labelW = Math.min(90, 8 + 6.4 * Math.max(1, ...leftLabels.map((s) => s.length)));
  const y2W = hasY2 ? Math.min(90, 8 + 6.4 * Math.max(1, ...y2Labels.map((s) => s.length))) : 0;
  const leftTitle = (horizontal ? cfg.xAxis?.title : cfg.yAxis?.title) ? 16 : 0;
  const bottomTitle = (horizontal ? cfg.yAxis?.title : cfg.xAxis?.title) ? 16 : 0;
  const rightTitle = hasY2 && cfg.y2Axis?.title ? 16 : 0;
  const x = box.x + leftTitle + labelW;
  const w = Math.max(20, box.w - leftTitle - labelW - y2W - rightTitle - 6);
  const y = box.y + 6;
  const h = Math.max(20, box.h - 6 - 20 - bottomTitle);
  return { x, y, w, h };
}

// ---------------------------------------------------------------- category charts

function renderCategory(cfg: ChartConfig, categories: string[], series: ChartSeries[], box: Plot): ReactNode {
  const type = cfg.type;
  const horizontal = type === "bar";
  const n = Math.max(1, categories.length);
  const stacking = type === "combo" || type === "waterfall" || type === "histogram" ? "none" : cfg.stacking ?? "none";
  const percent = stacking === "percent";

  // Primary and secondary series.
  const secondary = (k: number) => type === "combo" && !!cfg.series?.[k]?.secondary;
  const prim = series.map((s, k) => ({ s, k })).filter(({ k }) => !secondary(k));
  const sec = series.map((s, k) => ({ s, k })).filter(({ k }) => secondary(k));

  const water = type === "waterfall" ? waterfallBars(series[0]?.values ?? [], cfg.totals) : null;
  const layout = layoutSeries({ categories, series: prim.map((p) => p.s) }, { stacking });
  let lo = layout.min;
  let hi = layout.max;
  if (water) {
    lo = Math.min(0, ...water.map((b) => Math.min(b.start, b.end)));
    hi = Math.max(0, ...water.map((b) => Math.max(b.start, b.end)));
  }
  // Trendline curves widen the value range a little (within the data span).
  const yAxis = percent ? { ...cfg.yAxis, max: cfg.yAxis?.max ?? 1, min: cfg.yAxis?.min ?? (lo < 0 ? -1 : 0) } : cfg.yAxis;
  const valueLen = horizontal ? box.w : box.h;
  const scale = axisScale(lo, hi, yAxis ?? {}, Math.max(2, Math.floor(valueLen / 44)));
  let scale2: AxisScale | null = null;
  if (sec.length) {
    const vs = sec.flatMap((p) => p.s.values).filter(Number.isFinite);
    scale2 = axisScale(Math.min(0, ...vs), Math.max(0, ...vs), cfg.y2Axis ?? {}, Math.max(2, Math.floor(valueLen / 44)));
  }
  const vLabels = valueTicks(scale, cfg.yAxis, percent);
  const v2Labels = scale2 ? valueTicks(scale2, cfg.y2Axis, false) : [];
  const catLabels = categories.map((c) => c);
  const plot = plotRect(box, horizontal, horizontal ? catLabels.map((c) => truncate(c, 14)) : vLabels, !!scale2, v2Labels, cfg);

  const vPix = (sc: AxisScale, v: number) => {
    const f = Math.max(-0.05, Math.min(1.05, axisFraction(sc, v)));
    return horizontal ? plot.x + f * plot.w : plot.y + plot.h - f * plot.h;
  };
  const slot = (horizontal ? plot.h : plot.w) / n;
  const catPix = (i: number) => (horizontal ? plot.y + (i + 0.5) * slot : plot.x + (i + 0.5) * slot);
  const zero = (sc: AxisScale) => vPix(sc, sc.logBase ? sc.min : Math.max(sc.min, Math.min(sc.max, 0)));

  const out: ReactNode[] = [];
  // Gridlines and value labels.
  scale.ticks.forEach((t, i) => {
    const p = vPix(scale, t);
    out.push(
      horizontal ? (
        <g key={`g${i}`}>
          <line x1={p} x2={p} y1={plot.y} y2={plot.y + plot.h} stroke={GRID} />
          <text x={p} y={plot.y + plot.h + 14} textAnchor="middle" fontSize={10} fill={MUTED}>
            {vLabels[i]}
          </text>
        </g>
      ) : (
        <g key={`g${i}`}>
          <line x1={plot.x} x2={plot.x + plot.w} y1={p} y2={p} stroke={GRID} />
          <text x={plot.x - 6} y={p + 3.5} textAnchor="end" fontSize={10} fill={MUTED}>
            {vLabels[i]}
          </text>
        </g>
      ),
    );
  });
  if (scale2) {
    scale2.ticks.forEach((t, i) => {
      const p = vPix(scale2 as AxisScale, t);
      out.push(
        <text key={`g2${i}`} x={plot.x + plot.w + 6} y={p + 3.5} textAnchor="start" fontSize={10} fill={MUTED}>
          {v2Labels[i]}
        </text>,
      );
    });
  }
  // Category labels, thinned to fit.
  const maxChars = Math.max(3, Math.floor((horizontal ? 90 : slot) / 6.2));
  const every = horizontal ? Math.max(1, Math.ceil(12 / Math.max(1, slot))) : Math.max(1, Math.ceil((Math.min(12, Math.max(...catLabels.map((c) => c.length), 1)) * 6.2 + 6) / Math.max(1, slot)));
  catLabels.forEach((c, i) => {
    if (i % every) return;
    const p = catPix(i);
    out.push(
      horizontal ? (
        <text key={`c${i}`} x={plot.x - 6} y={p + 3.5} textAnchor="end" fontSize={10} fill={INK2}>
          {truncate(c, 14)}
        </text>
      ) : (
        <text key={`c${i}`} x={p} y={plot.y + plot.h + 14} textAnchor="middle" fontSize={10} fill={INK2}>
          {truncate(c, Math.max(maxChars * every, 4))}
        </text>
      ),
    );
  });
  // Baseline axis.
  const z = zero(scale);
  out.push(
    horizontal ? (
      <line key="axis" x1={z} x2={z} y1={plot.y} y2={plot.y + plot.h} stroke={AXIS} />
    ) : (
      <line key="axis" x1={plot.x} x2={plot.x + plot.w} y1={z} y2={z} stroke={AXIS} />
    ),
  );
  // Axis titles.
  const xTitle = horizontal ? cfg.yAxis?.title : cfg.xAxis?.title;
  const yTitle = horizontal ? cfg.xAxis?.title : cfg.yAxis?.title;
  out.push(<g key="xt">{axisTitle(xTitle, plot.x + plot.w / 2, box.y + box.h - 2)}</g>);
  out.push(<g key="yt">{axisTitle(yTitle, box.x + 10, plot.y + plot.h / 2, true)}</g>);
  if (scale2) out.push(<g key="y2t">{axisTitle(cfg.y2Axis?.title, box.x + box.w - 6, plot.y + plot.h / 2, true)}</g>);

  const labelsOn = (k: number) => !!cfg.dataLabels || !!cfg.series?.[k]?.dataLabels;
  const labelText = (v: number) => fmtWith(percent ? "0%" : cfg.yAxis?.numFmt, v);
  const marks: ReactNode[] = [];
  const labels: ReactNode[] = [];

  // ---- waterfall ----
  if (water) {
    const bw = Math.min(56, slot * 0.62);
    water.forEach((b, i) => {
      const a = vPix(scale, b.start);
      const e = vPix(scale, b.end);
      const color = b.kind === "total" ? themeSeriesColor(2) : b.kind === "down" ? themeSeriesColor(1) : themeSeriesColor(0);
      const c = catPix(i);
      const x = Math.min(a, e);
      const len = Math.max(1, Math.abs(e - a));
      marks.push(
        horizontal ? (
          <rect key={`w${i}`} x={x} y={c - bw / 2} width={len} height={bw} fill={color} rx={2} data-mark="bar">
            <title>{`${categories[i]}: ${labelText(series[0].values[i])}`}</title>
          </rect>
        ) : (
          <rect key={`w${i}`} x={c - bw / 2} y={x} width={bw} height={len} fill={color} rx={2} data-mark="bar">
            <title>{`${categories[i]}: ${labelText(b.kind === "total" ? b.end : series[0].values[i])}`}</title>
          </rect>
        ),
      );
      // Connector to the next bar.
      if (i < water.length - 1 && !horizontal) {
        const y = vPix(scale, b.end);
        marks.push(<line key={`wc${i}`} x1={c + bw / 2} x2={catPix(i + 1) - bw / 2} y1={y} y2={y} stroke={AXIS} strokeDasharray="2 2" />);
      }
      {
        const v = b.kind === "total" ? b.end : series[0].values[i];
        if (Number.isFinite(v))
          labels.push(
            <text key={`wl${i}`} x={c} y={Math.min(a, e) - 4} textAnchor="middle" fontSize={10} fill={INK2}>
              {labelText(v)}
            </text>,
          );
      }
    });
    return (
      <g>
        {out}
        {marks}
        {labels}
      </g>
    );
  }

  // ---- bars (column / bar / histogram / combo columns) ----
  const barSeries = prim.map((p, j) => ({ ...p, lay: layout.series[j] })).filter(({ k }) => seriesKind(cfg, k) === "column" || type === "histogram");
  const secBars = sec.filter(({ k }) => seriesKind(cfg, k) === "column");
  const groups = stacking === "none" ? barSeries.length + secBars.length : 1;
  if (barSeries.length || secBars.length) {
    const gap = type === "histogram" ? 0.04 : 0.2;
    const inner = slot * (1 - 2 * gap);
    const bw = Math.min(stacking === "none" ? 40 : 56, inner / Math.max(1, groups));
    const offset0 = (slot - bw * groups) / 2;
    const draw = (sc: AxisScale, k: number, g: number, base: number[], top: number[], values: number[]) => {
      const color = seriesColor(cfg, k);
      top.forEach((t, i) => {
        if (!Number.isFinite(t) || !Number.isFinite(values[i])) return;
        const a = vPix(sc, base[i]);
        const e = vPix(sc, t);
        const c0 = (horizontal ? plot.y : plot.x) + i * slot + offset0 + g * bw;
        const gapPx = groups > 1 || stacking !== "none" ? 1 : 0;
        const neg = t < base[i];
        const tip = <title>{`${series[k]?.name}: ${categories[i]} = ${labelText(values[i])}`}</title>;
        const d = horizontal
          ? barPath(Math.min(a, e), c0 + gapPx, Math.abs(e - a), bw - 2 * gapPx, neg ? "left" : "right")
          : barPath(c0 + gapPx, Math.min(a, e), bw - 2 * gapPx, Math.abs(e - a), neg ? "bottom" : "top");
        if (d)
          marks.push(
            <path key={`b${k}-${i}`} d={d} fill={color} stroke={stacking !== "none" ? SURFACE : "none"} strokeWidth={stacking !== "none" ? 1 : 0} data-mark="bar">
              {tip}
            </path>,
          );
        if (labelsOn(k)) {
          const lx = horizontal ? Math.max(a, e) + 4 : c0 + bw / 2;
          const ly = horizontal ? c0 + bw / 2 + 3.5 : Math.min(a, e) - 4;
          const inside = stacking !== "none";
          labels.push(
            <text
              key={`bl${k}-${i}`}
              x={inside ? (horizontal ? (a + e) / 2 : lx) : lx}
              y={inside ? (horizontal ? ly : (a + e) / 2 + 3.5) : ly}
              textAnchor={horizontal && !inside ? "start" : "middle"}
              fontSize={10}
              fill={inside ? "#fff" : INK2}
            >
              {labelText(values[i])}
            </text>,
          );
        }
      });
    };
    barSeries.forEach(({ k, lay }, g) => draw(scale, k, stacking === "none" ? g : 0, lay.base, lay.top, lay.values));
    secBars.forEach(({ k, s }, j) =>
      draw(scale2 as AxisScale, k, barSeries.length + j, s.values.map(() => 0), s.values, s.values),
    );
  }

  // ---- lines and areas ----
  const lineLike = [
    ...prim.map((p, j) => ({ ...p, lay: layout.series[j], sc: scale })),
    ...sec.map((p) => ({ ...p, lay: { name: p.s.name, values: p.s.values, base: p.s.values.map(() => 0), top: p.s.values }, sc: scale2 as AxisScale })),
  ].filter(({ k }) => seriesKind(cfg, k) !== "column" && type !== "histogram");
  // Areas first so lines sit on top.
  const areaFirst = [...lineLike].sort((a, b) => Number(seriesKind(cfg, b.k) === "area") - Number(seriesKind(cfg, a.k) === "area"));
  for (const { k, lay, sc } of areaFirst) {
    const color = seriesColor(cfg, k);
    const kind = seriesKind(cfg, k);
    const pts: [number, number, number][] = [];
    lay.top.forEach((t, i) => {
      if (Number.isFinite(t)) pts.push(horizontal ? [vPix(sc, t), catPix(i), i] : [catPix(i), vPix(sc, t), i]);
    });
    if (!pts.length) continue;
    if (kind === "area") {
      const basePts = lay.base.map((b, i) => [catPix(i), vPix(sc, b)] as [number, number]).filter((_, i) => Number.isFinite(lay.top[i]));
      const d =
        `M ${pts[0][0]} ${pts[0][1]} ` +
        pts.slice(1).map((p) => `L ${p[0]} ${p[1]}`).join(" ") +
        " " +
        basePts
          .slice()
          .reverse()
          .map((p) => `L ${p[0]} ${p[1]}`)
          .join(" ") +
        " Z";
      marks.push(<path key={`a${k}`} d={d} fill={color} fillOpacity={stacking === "none" ? 0.35 : 0.85} stroke="none" data-mark="area" />);
      marks.push(<path key={`al${k}`} d={pts.map((p, i) => `${i ? "L" : "M"} ${p[0]} ${p[1]}`).join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />);
    } else {
      // Blank cells break the line (gaps), as spreadsheets draw them by default.
      let d = "";
      let prev = -2;
      for (const p of pts) {
        d += `${p[2] === prev + 1 ? "L" : "M"} ${p[0]} ${p[1]} `;
        prev = p[2];
      }
      marks.push(<path key={`l${k}`} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" data-mark="line" />);
      if (pts.length <= 40)
        pts.forEach((p) =>
          marks.push(
            <circle key={`m${k}-${p[2]}`} cx={p[0]} cy={p[1]} r={3.5} fill={color} stroke={SURFACE} strokeWidth={1.5}>
              <title>{`${series[k]?.name}: ${categories[p[2]]} = ${labelText(lay.values[p[2]])}`}</title>
            </circle>,
          ),
        );
    }
    if (labelsOn(k))
      pts.forEach((p) =>
        labels.push(
          <text key={`ll${k}-${p[2]}`} x={p[0]} y={p[1] - 7} textAnchor="middle" fontSize={10} fill={INK2}>
            {labelText(lay.values[p[2]])}
          </text>,
        ),
      );
  }

  // ---- trendlines (x = 1…n on a category axis) ----
  if (!horizontal && type !== "histogram") {
    series.forEach((s, k) => {
      const spec = cfg.series?.[k]?.trendline;
      if (!spec) return;
      const sc = secondary(k) ? scale2 ?? scale : scale;
      const xs = s.values.map((_, i) => i + 1);
      const toPix = (x: number, y: number) => [plot.x + (x - 0.5) * slot, vPix(sc, y)] as [number, number];
      drawTrend(spec, xs, s.values, 1, n, toPix, sc, seriesColor(cfg, k), s.name, marks, labels, plot, k, true);
    });
  }

  return (
    <g>
      {out}
      <g clipPath={undefined}>{marks}</g>
      {labels}
    </g>
  );
}

function drawTrend(
  spec: TrendlineSpec,
  xs: number[],
  ys: number[],
  xMin: number,
  xMax: number,
  toPix: (x: number, y: number) => [number, number],
  sc: AxisScale,
  color: string,
  name: string,
  marks: ReactNode[],
  labels: ReactNode[],
  plot: Plot,
  k: number,
  categoryAxis: boolean,
) {
  let px: number[] = [];
  let py: number[] = [];
  let label: string[] = [];
  if (spec.type === "movingAvg") {
    const m = categoryAxis ? movingAverage(xs, ys, xs.length, spec.period ?? 2) : movingAveragePoints(xs, ys, spec.period ?? 2);
    px = m.x;
    py = m.y;
  } else {
    const fit = fitTrendline(xs, ys, spec);
    if (!fit) return;
    const a = xMin - (spec.backward ?? 0);
    const b = xMax + (spec.forward ?? 0);
    const c = trendlineCurve(fit, a, b, { valMin: sc.min, valMax: sc.max, logBase: sc.logBase });
    px = c.x;
    py = c.y;
    if (spec.showEquation) label.push(trendlineEquation(fit));
    if (spec.showR2) label.push(r2Label(fit.r2));
  }
  if (px.length < 2) return;
  const pts = px.map((x, i) => toPix(x, py[i]));
  marks.push(
    <path
      key={`t${k}`}
      d={pts.map((p, i) => `${i ? "L" : "M"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ")}
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      strokeDasharray="5 4"
      data-mark="trendline"
    >
      <title>{trendlineName(spec, name)}</title>
    </path>,
  );
  label = label.filter(Boolean);
  if (label.length) {
    const end = pts[pts.length - 1];
    const x = Math.min(plot.x + plot.w - 4, Math.max(plot.x + 4, end[0]));
    const y = Math.max(plot.y + 12, Math.min(plot.y + plot.h - 4 - 13 * (label.length - 1), end[1] - 8 - 13 * (label.length - 1)));
    labels.push(
      <text key={`te${k}`} x={x} y={y} textAnchor="end" fontSize={10.5} fill={INK} data-mark="trend-label">
        {label.map((l, i) => (
          <tspan key={i} x={x} dy={i ? 13 : 0}>
            {l}
          </tspan>
        ))}
      </text>,
    );
  }
}

// ---------------------------------------------------------------- scatter

function renderScatter(cfg: ChartConfig, input: ChartInput, series: ChartSeries[], box: Plot): ReactNode {
  const xs = input.xValues ?? series[0]?.values.map((_, i) => i + 1) ?? [];
  const allX = xs.filter(Number.isFinite);
  const allY = series.flatMap((s) => s.values).filter(Number.isFinite);
  const yScale = axisScale(Math.min(...allY, Infinity) === Infinity ? 0 : Math.min(...allY), allY.length ? Math.max(...allY) : 1, cfg.yAxis ?? {}, Math.max(2, Math.floor(box.h / 44)));
  const xScale = axisScale(allX.length ? Math.min(...allX) : 0, allX.length ? Math.max(...allX) : 1, cfg.xAxis ?? {}, Math.max(2, Math.floor(box.w / 70)));
  const yLabels = valueTicks(yScale, cfg.yAxis, false);
  const xLabels = valueTicks(xScale, cfg.xAxis, false);
  const plot = plotRect(box, false, yLabels, false, [], cfg);
  const X = (v: number) => plot.x + Math.max(-0.05, Math.min(1.05, axisFraction(xScale, v))) * plot.w;
  const Y = (v: number) => plot.y + plot.h - Math.max(-0.05, Math.min(1.05, axisFraction(yScale, v))) * plot.h;
  const out: ReactNode[] = [];
  yScale.ticks.forEach((t, i) =>
    out.push(
      <g key={`y${i}`}>
        <line x1={plot.x} x2={plot.x + plot.w} y1={Y(t)} y2={Y(t)} stroke={GRID} />
        <text x={plot.x - 6} y={Y(t) + 3.5} textAnchor="end" fontSize={10} fill={MUTED}>
          {yLabels[i]}
        </text>
      </g>,
    ),
  );
  xScale.ticks.forEach((t, i) =>
    out.push(
      <g key={`x${i}`}>
        <line x1={X(t)} x2={X(t)} y1={plot.y} y2={plot.y + plot.h} stroke={GRID} />
        <text x={X(t)} y={plot.y + plot.h + 14} textAnchor="middle" fontSize={10} fill={MUTED}>
          {xLabels[i]}
        </text>
      </g>,
    ),
  );
  out.push(<line key="ax" x1={plot.x} x2={plot.x + plot.w} y1={Y(Math.max(yScale.min, Math.min(yScale.max, 0)))} y2={Y(Math.max(yScale.min, Math.min(yScale.max, 0)))} stroke={AXIS} />);
  out.push(<line key="ay" x1={plot.x} x2={plot.x} y1={plot.y} y2={plot.y + plot.h} stroke={AXIS} />);
  out.push(<g key="xt">{axisTitle(cfg.xAxis?.title, plot.x + plot.w / 2, box.y + box.h - 2)}</g>);
  out.push(<g key="yt">{axisTitle(cfg.yAxis?.title, box.x + 10, plot.y + plot.h / 2, true)}</g>);
  const marks: ReactNode[] = [];
  const labels: ReactNode[] = [];
  series.forEach((s, k) => {
    const color = seriesColor(cfg, k);
    const pts = s.values.map((v, i) => [xs[i], v] as [number, number]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (cfg.scatterLines && pts.length > 1) {
      const sorted = pts.slice();
      marks.push(<path key={`sl${k}`} d={sorted.map(([x, y], i) => `${i ? "L" : "M"} ${X(x)} ${Y(y)}`).join(" ")} fill="none" stroke={color} strokeWidth={2} data-mark="line" />);
    }
    pts.forEach(([x, y], i) =>
      marks.push(
        <circle key={`p${k}-${i}`} cx={X(x)} cy={Y(y)} r={4} fill={color} stroke={SURFACE} strokeWidth={1.5} data-mark="point">
          <title>{`${s.name}: (${fmtWith(cfg.xAxis?.numFmt, x)}, ${fmtWith(cfg.yAxis?.numFmt, y)})`}</title>
        </circle>,
      ),
    );
    if (cfg.dataLabels || cfg.series?.[k]?.dataLabels)
      pts.forEach(([x, y], i) =>
        labels.push(
          <text key={`pl${k}-${i}`} x={X(x)} y={Y(y) - 8} textAnchor="middle" fontSize={10} fill={INK2}>
            {fmtWith(cfg.yAxis?.numFmt, y)}
          </text>,
        ),
      );
    const spec = cfg.series?.[k]?.trendline;
    if (spec && allX.length) {
      drawTrend(spec, xs, s.values, Math.min(...allX), Math.max(...allX), (x, y) => [X(x), Y(y)], yScale, color, s.name, marks, labels, plot, k, false);
    }
  });
  return (
    <g>
      {out}
      {marks}
      {labels}
    </g>
  );
}

/** A small preview of a chart type (the type picker's icons). */
export function chartTypeLabel(type: ChartType): string {
  const names: Record<ChartType, string> = {
    column: "Column",
    bar: "Bar",
    line: "Line",
    area: "Area",
    pie: "Pie",
    doughnut: "Doughnut",
    scatter: "Scatter",
    combo: "Combo",
    histogram: "Histogram",
    waterfall: "Waterfall",
  };
  return names[type];
}
