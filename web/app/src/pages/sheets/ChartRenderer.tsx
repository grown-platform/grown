/**
 * ChartRenderer — a dependency-free SVG chart component.
 *
 * Supports column, bar, line, area, and pie charts with one or more numeric
 * series and category labels. Rendered as plain SVG so there is no charting
 * dependency and it works fully offline.
 */

export type ChartType = "column" | "bar" | "line" | "area" | "pie";

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartRenderProps {
  type: ChartType;
  title?: string;
  categories: string[];
  series: ChartSeries[];
  width?: number;
  height?: number;
}

export const CHART_PALETTE = [
  "#4285f4",
  "#ea4335",
  "#34a853",
  "#fbbc04",
  "#a142f4",
  "#24c1e0",
  "#ff6d01",
  "#46bdc6",
];

function niceCeil(x: number): number {
  if (x <= 0) return 0;
  const pow = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function fmt(n: number): string {
  if (!isFinite(n)) return "";
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return String(Math.round(n * 100) / 100);
}

export function ChartRenderer({
  type,
  title,
  categories,
  series,
  width = 480,
  height = 300,
}: ChartRenderProps) {
  const padTop = title ? 34 : 16;
  const padBottom = 46;
  const padLeft = 48;
  const padRight = 16;
  const legendH = series.length > 1 || type === "pie" ? 22 : 0;
  const plotW = Math.max(10, width - padLeft - padRight);
  const plotH = Math.max(10, height - padTop - padBottom - legendH);
  const x0 = padLeft;
  const y0 = padTop;

  const legend = (() => {
    const items =
      type === "pie"
        ? categories.map((c, i) => ({ name: c, color: CHART_PALETTE[i % CHART_PALETTE.length] }))
        : series.map((s, i) => ({ name: s.name, color: CHART_PALETTE[i % CHART_PALETTE.length] }));
    if (legendH === 0) return null;
    return (
      <g transform={`translate(${x0}, ${y0 + plotH + padBottom - 6})`}>
        {items.slice(0, 8).map((it, i) => (
          <g key={i} transform={`translate(${i * Math.min(110, plotW / Math.min(items.length, 8))}, 0)`}>
            <rect width={10} height={10} rx={2} fill={it.color} />
            <text x={14} y={9} fontSize={11} fill="#444">
              {it.name.length > 12 ? it.name.slice(0, 11) + "…" : it.name}
            </text>
          </g>
        ))}
      </g>
    );
  })();

  const titleEl = title ? (
    <text x={width / 2} y={20} textAnchor="middle" fontSize={14} fontWeight={600} fill="#222">
      {title}
    </text>
  ) : null;

  // ---- PIE ----
  if (type === "pie") {
    const vals = (series[0]?.values ?? []).map((v) => (isFinite(v) && v > 0 ? v : 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = x0 + plotW / 2;
    const cy = y0 + plotH / 2;
    const rad = Math.max(10, Math.min(plotW, plotH) / 2 - 4);
    let angle = -Math.PI / 2;
    const slices = vals.map((v, i) => {
      const frac = v / total;
      const a1 = angle;
      const a2 = angle + frac * Math.PI * 2;
      angle = a2;
      const large = a2 - a1 > Math.PI ? 1 : 0;
      const p1 = [cx + rad * Math.cos(a1), cy + rad * Math.sin(a1)];
      const p2 = [cx + rad * Math.cos(a2), cy + rad * Math.sin(a2)];
      const mid = (a1 + a2) / 2;
      const lx = cx + rad * 0.6 * Math.cos(mid);
      const ly = cy + rad * 0.6 * Math.sin(mid);
      return { i, frac, large, p1, p2, lx, ly };
    });
    return (
      <svg width={width} height={height} role="img">
        {titleEl}
        {slices.map((s) =>
          s.frac >= 0.999 ? (
            <circle key={s.i} cx={cx} cy={cy} r={rad} fill={CHART_PALETTE[s.i % CHART_PALETTE.length]} />
          ) : s.frac > 0 ? (
            <path
              key={s.i}
              d={`M ${cx} ${cy} L ${s.p1[0]} ${s.p1[1]} A ${rad} ${rad} 0 ${s.large} 1 ${s.p2[0]} ${s.p2[1]} Z`}
              fill={CHART_PALETTE[s.i % CHART_PALETTE.length]}
              stroke="#fff"
              strokeWidth={1}
            />
          ) : null,
        )}
        {slices
          .filter((s) => s.frac > 0.05)
          .map((s) => (
            <text key={`l${s.i}`} x={s.lx} y={s.ly} textAnchor="middle" fontSize={11} fill="#fff" fontWeight={600}>
              {Math.round(s.frac * 100)}%
            </text>
          ))}
        {legend}
      </svg>
    );
  }

  // ---- Cartesian (column / bar / line / area) ----
  const allVals = series.flatMap((s) => s.values).filter((v) => isFinite(v));
  const dataMax = allVals.length ? Math.max(...allVals) : 0;
  const dataMin = allVals.length ? Math.min(...allVals) : 0;
  const yMax = dataMax > 0 ? niceCeil(dataMax) : 0;
  const yMin = dataMin < 0 ? -niceCeil(-dataMin) : 0;
  const span = yMax - yMin || 1;
  const horizontal = type === "bar";

  // value → pixel along the value axis
  const vPix = (v: number) =>
    horizontal
      ? x0 + ((v - yMin) / span) * plotW
      : y0 + plotH - ((v - yMin) / span) * plotH;

  const n = categories.length || 1;
  // category slot center along the category axis
  const catPix = (i: number) =>
    horizontal ? y0 + ((i + 0.5) / n) * plotH : x0 + ((i + 0.5) / n) * plotW;
  const slot = (horizontal ? plotH : plotW) / n;

  // gridlines (5 steps)
  const ticks = 5;
  const gridlines = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = yMin + (span * i) / ticks;
    if (horizontal) {
      const x = vPix(v);
      return (
        <g key={i}>
          <line x1={x} y1={y0} x2={x} y2={y0 + plotH} stroke="#eee" />
          <text x={x} y={y0 + plotH + 14} textAnchor="middle" fontSize={10} fill="#888">
            {fmt(v)}
          </text>
        </g>
      );
    }
    const y = vPix(v);
    return (
      <g key={i}>
        <line x1={x0} y1={y} x2={x0 + plotW} y2={y} stroke="#eee" />
        <text x={x0 - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#888">
          {fmt(v)}
        </text>
      </g>
    );
  });

  // category labels along the category axis
  const catLabels = categories.map((c, i) => {
    const p = catPix(i);
    const label = c.length > 8 ? c.slice(0, 7) + "…" : c;
    return horizontal ? (
      <text key={i} x={x0 - 6} y={p + 3} textAnchor="end" fontSize={10} fill="#666">
        {label}
      </text>
    ) : (
      <text key={i} x={p} y={y0 + plotH + 14} textAnchor="middle" fontSize={10} fill="#666">
        {label}
      </text>
    );
  });

  const baseline = vPix(0);

  const marks: React.ReactNode[] = [];
  if (type === "column" || type === "bar") {
    const groupPad = slot * 0.18;
    const innerW = slot - groupPad * 2;
    const bw = innerW / Math.max(series.length, 1);
    series.forEach((s, si) => {
      const color = CHART_PALETTE[si % CHART_PALETTE.length];
      s.values.forEach((v, i) => {
        if (!isFinite(v)) return;
        const center = catPix(i) - slot / 2 + groupPad + bw * si + bw / 2;
        if (horizontal) {
          const x1 = Math.min(baseline, vPix(v));
          const len = Math.abs(vPix(v) - baseline);
          marks.push(
            <rect key={`${si}-${i}`} x={x1} y={center - bw / 2} width={len} height={bw * 0.9} fill={color} rx={1} />,
          );
        } else {
          const y1 = Math.min(baseline, vPix(v));
          const len = Math.abs(vPix(v) - baseline);
          marks.push(
            <rect key={`${si}-${i}`} x={center - bw / 2} y={y1} width={bw * 0.9} height={len} fill={color} rx={1} />,
          );
        }
      });
    });
  } else {
    // line / area
    series.forEach((s, si) => {
      const color = CHART_PALETTE[si % CHART_PALETTE.length];
      const pts = s.values.map((v, i) => [catPix(i), vPix(isFinite(v) ? v : 0)] as [number, number]);
      const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
      if (type === "area" && pts.length) {
        const area =
          `M ${pts[0][0]} ${baseline} ` +
          pts.map((p) => `L ${p[0]} ${p[1]}`).join(" ") +
          ` L ${pts[pts.length - 1][0]} ${baseline} Z`;
        marks.push(<path key={`a${si}`} d={area} fill={color} fillOpacity={0.25} />);
      }
      marks.push(<path key={`p${si}`} d={path} fill="none" stroke={color} strokeWidth={2} />);
      pts.forEach((p, i) => marks.push(<circle key={`c${si}-${i}`} cx={p[0]} cy={p[1]} r={2.5} fill={color} />));
    });
  }

  return (
    <svg width={width} height={height} role="img">
      {titleEl}
      {gridlines}
      {/* axes */}
      <line x1={x0} y1={y0} x2={x0} y2={y0 + plotH} stroke="#ccc" />
      <line x1={x0} y1={y0 + plotH} x2={x0 + plotW} y2={y0 + plotH} stroke="#ccc" />
      {marks}
      {catLabels}
      {legend}
    </svg>
  );
}
