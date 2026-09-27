// Chart trendlines (M10): least-squares fits for linear, logarithmic, power,
// exponential and polynomial trendlines, moving averages, R², the equation
// label and the curve a chart draws.
//
// Conventions (the spreadsheet ones):
// - linear      y = m·x + b              coefs [m, b]
// - log         y = m·ln(x) + b          coefs [m, b]      (x > 0)
// - power       y = b·x^m                coefs [m, b]      (x > 0, y > 0; fitted on ln x, ln y)
// - exp         y = b·e^(m·x)            coefs [m, b]      (y > 0; fitted on ln y)
// - poly        y = c0·x^d + … + cd      coefs highest degree first
// R² is 1 − SSres/SStot in the space the fit is linear in (ln y for power and
// exponential, ln x for log and power), which is what spreadsheets report.
// A fixed intercept is honoured for linear, exponential and polynomial fits
// (as in Excel; log and power ignore it).

export type TrendType = "linear" | "log" | "power" | "exp" | "poly" | "movingAvg";

export interface TrendlineSpec {
  type: TrendType;
  /** Polynomial degree 2–6. */
  order?: number;
  /** Moving-average period ≥ 2. */
  period?: number;
  /** Fixed intercept (linear, exponential, polynomial). */
  intercept?: number | null;
  /** Extend the line forward / backward by this many x units. */
  forward?: number;
  backward?: number;
  showEquation?: boolean;
  showR2?: boolean;
  /** Legend name (default "Linear (Sales)" style). */
  name?: string;
}

export interface TrendFit {
  type: Exclude<TrendType, "movingAvg">;
  coefs: number[];
  r2: number;
  predict: (x: number) => number;
}

const finitePairs = (xs: number[], ys: number[]) => {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      x.push(xs[i]);
      y.push(ys[i]);
    }
  }
  return { x, y };
};

/** Least squares for A·c ≈ y by Householder QR (columns of A given as arrays). */
export function leastSquares(cols: number[][], y: number[]): number[] | null {
  const n = y.length;
  const p = cols.length;
  if (p === 0 || n < p) return null;
  // Column scaling keeps high powers of x well conditioned.
  const scale = cols.map((col) => Math.max(1e-300, Math.sqrt(col.reduce((s, v) => s + v * v, 0))));
  const a = Array.from({ length: n }, (_, i) => cols.map((col, j) => col[i] / scale[j]));
  const b = y.slice();
  for (let k = 0; k < p; k++) {
    let norm = 0;
    for (let i = k; i < n; i++) norm += a[i][k] * a[i][k];
    norm = Math.sqrt(norm);
    if (norm < 1e-14) return null;
    const alpha = a[k][k] > 0 ? -norm : norm;
    const v = new Array(n).fill(0);
    v[k] = a[k][k] - alpha;
    for (let i = k + 1; i < n; i++) v[i] = a[i][k];
    const vv = v.reduce((s, t) => s + t * t, 0);
    if (vv === 0) continue;
    for (let j = k; j < p; j++) {
      let d = 0;
      for (let i = k; i < n; i++) d += v[i] * a[i][j];
      const f = (2 * d) / vv;
      for (let i = k; i < n; i++) a[i][j] -= f * v[i];
    }
    let d = 0;
    for (let i = k; i < n; i++) d += v[i] * b[i];
    const f = (2 * d) / vv;
    for (let i = k; i < n; i++) b[i] -= f * v[i];
  }
  const c = new Array(p).fill(0);
  for (let k = p - 1; k >= 0; k--) {
    let s = b[k];
    for (let j = k + 1; j < p; j++) s -= a[k][j] * c[j];
    if (Math.abs(a[k][k]) < 1e-14) return null;
    c[k] = s / a[k][k];
  }
  return c.map((v, j) => v / scale[j]);
}

function fitLine(x: number[], y: number[], intercept?: number | null): [number, number] | undefined {
  if (x.length < 1) return undefined;
  if (intercept !== undefined && intercept !== null && Number.isFinite(intercept)) {
    const sxx = x.reduce((s, v) => s + v * v, 0);
    if (sxx === 0) return undefined;
    const sxy = x.reduce((s, v, i) => s + v * (y[i] - intercept), 0);
    return [sxy / sxx, intercept];
  }
  if (x.length < 2) return undefined;
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) * (x[i] - mx);
    sxy += (x[i] - mx) * (y[i] - my);
  }
  if (sxx === 0) return undefined;
  const m = sxy / sxx;
  return [m, my - m * mx];
}

/**
 * Trendline coefficients for type ("poly" takes `degree`), or undefined when
 * the data can't be fitted (power/exp need positive y, log/power positive x).
 */
export function equationCoefficients(
  xsIn: number[],
  ysIn: number[],
  type: Exclude<TrendType, "movingAvg">,
  degree = 2,
  intercept?: number | null,
): number[] | undefined {
  const { x, y } = finitePairs(xsIn, ysIn);
  switch (type) {
    case "linear":
      return fitLine(x, y, intercept);
    case "log": {
      if (x.some((v) => v <= 0)) return undefined;
      return fitLine(x.map(Math.log), y);
    }
    case "power": {
      if (x.some((v) => v <= 0) || y.some((v) => v <= 0)) return undefined;
      const r = fitLine(x.map(Math.log), y.map(Math.log));
      return r ? [r[0], Math.exp(r[1])] : undefined;
    }
    case "exp": {
      if (y.some((v) => v <= 0)) return undefined;
      const fixed = intercept !== undefined && intercept !== null && intercept > 0 ? Math.log(intercept) : null;
      const r = fitLine(x, y.map(Math.log), fixed);
      return r ? [r[0], Math.exp(r[1])] : undefined;
    }
    case "poly": {
      if (!x.length) return undefined;
      const fixed = intercept !== undefined && intercept !== null && Number.isFinite(intercept);
      // Degree is capped by the data: n points fit at most degree n−1.
      let d = Math.max(1, Math.min(Math.floor(degree), x.length - (fixed ? 0 : 1)));
      if (d < 1) d = 1;
      for (; d >= 1; d--) {
        const cols: number[][] = [];
        for (let k = d; k >= (fixed ? 1 : 0); k--) cols.push(x.map((v) => Math.pow(v, k)));
        const target = fixed ? y.map((v) => v - (intercept as number)) : y;
        const c = leastSquares(cols, target);
        if (c) return fixed ? [...c, intercept as number] : c;
      }
      return undefined;
    }
  }
}

/** y for x under a fitted model (NaN outside its domain). */
export function evaluate(type: Exclude<TrendType, "movingAvg">, coefs: number[], x: number): number {
  const [m, b] = coefs;
  switch (type) {
    case "linear":
      return m * x + b;
    case "log":
      return x > 0 ? m * Math.log(x) + b : NaN;
    case "power":
      return x > 0 ? b * Math.pow(x, m) : NaN;
    case "exp":
      return b * Math.exp(m * x);
    case "poly":
      return coefs.reduce((s, c) => s * x + c, 0);
  }
}

/** R² of a model over raw data (in the fit's linear space). */
export function rSquared(xsIn: number[], ysIn: number[], type: Exclude<TrendType, "movingAvg">, coefs: number[]): number {
  const { x, y } = finitePairs(xsIn, ysIn);
  const logY = type === "power" || type === "exp";
  const obs: number[] = [];
  const pred: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const p = evaluate(type, coefs, x[i]);
    if (logY) {
      if (!(y[i] > 0) || !(p > 0)) continue;
      obs.push(Math.log(y[i]));
      pred.push(Math.log(p));
    } else {
      if (!Number.isFinite(p)) continue;
      obs.push(y[i]);
      pred.push(p);
    }
  }
  if (!obs.length) return NaN;
  const mean = obs.reduce((s, v) => s + v, 0) / obs.length;
  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < obs.length; i++) {
    ssr += (obs[i] - pred[i]) ** 2;
    sst += (obs[i] - mean) ** 2;
  }
  if (sst === 0) return ssr === 0 ? 1 : 0;
  return 1 - ssr / sst;
}

/** Fits a trendline spec over (x, y) pairs; null when it can't be drawn. */
export function fitTrendline(xs: number[], ys: number[], spec: TrendlineSpec): TrendFit | null {
  if (spec.type === "movingAvg") return null;
  const type = spec.type;
  const coefs = equationCoefficients(xs, ys, type, type === "poly" ? Math.max(2, Math.min(6, spec.order ?? 2)) : 2, spec.intercept);
  if (!coefs || coefs.some((c) => !Number.isFinite(c))) return null;
  return { type, coefs, r2: rSquared(xs, ys, type, coefs), predict: (x) => evaluate(type, coefs, x) };
}

/**
 * Moving average over a category axis: points sit at x = 1…ptCount (x values
 * are 1-based slot numbers, gaps allowed). The average at slot k covers slots
 * k−period+1…k and uses the points present there; windows with no points
 * are skipped. period ≥ ptCount gives no line.
 */
export function movingAverage(xs: number[], ys: number[], ptCount: number, period: number): { x: number[]; y: number[] } {
  const out = { x: [] as number[], y: [] as number[] };
  const p = Math.floor(period);
  if (p < 2 || p >= ptCount) return out;
  const at = new Map<number, number>();
  xs.forEach((x, i) => {
    if (Number.isFinite(x) && Number.isFinite(ys[i])) at.set(Math.round(x), ys[i]);
  });
  for (let k = p; k <= ptCount; k++) {
    let sum = 0;
    let n = 0;
    for (let j = k - p + 1; j <= k; j++) {
      const v = at.get(j);
      if (v !== undefined) {
        sum += v;
        n++;
      }
    }
    if (n) {
      out.x.push(k);
      out.y.push(sum / n);
    }
  }
  return out;
}

/** Moving average over scatter points: consecutive points in x order. */
export function movingAveragePoints(xs: number[], ys: number[], period: number): { x: number[]; y: number[] } {
  const pts = xs.map((x, i) => [x, ys[i]] as [number, number]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  pts.sort((a, b) => a[0] - b[0]);
  const out = { x: [] as number[], y: [] as number[] };
  const p = Math.floor(period);
  if (p < 2 || p > pts.length) return out;
  for (let k = p - 1; k < pts.length; k++) {
    let s = 0;
    for (let j = k - p + 1; j <= k; j++) s += pts[j][1];
    out.x.push(pts[k][0]);
    out.y.push(s / p);
  }
  return out;
}

function num(v: number): string {
  if (!Number.isFinite(v)) return "?";
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-4)) return v.toExponential(3).replace(/\.?0+e/, "E").replace("E+", "E+");
  return String(Number(v.toFixed(4)));
}

function term(c: number, body: string, first: boolean): string {
  const sign = c < 0 ? (first ? "-" : " - ") : first ? "" : " + ";
  return `${sign}${num(Math.abs(c))}${body}`;
}

const SUP: Record<string, string> = { "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶" };

/** The equation label a chart shows, e.g. "y = 0.8286x + 0.6". */
export function trendlineEquation(fit: Pick<TrendFit, "type" | "coefs">): string {
  const [m, b] = fit.coefs;
  switch (fit.type) {
    case "linear":
      return `y = ${term(m, "x", true)}${b ? term(b, "", false) : ""}`;
    case "log":
      return `y = ${term(m, "ln(x)", true)}${b ? term(b, "", false) : ""}`;
    case "power":
      return `y = ${num(b)}x^${num(m)}`;
    case "exp":
      return `y = ${num(b)}e^${num(m)}x`;
    case "poly": {
      const d = fit.coefs.length - 1;
      const parts = fit.coefs
        .map((c, i) => ({ c, k: d - i }))
        .filter(({ c, k }) => c !== 0 || k === 0)
        .map(({ c, k }, i) => term(c, k === 0 ? "" : k === 1 ? "x" : `x${SUP[String(k)] ?? `^${k}`}`, i === 0));
      return `y = ${parts.join("")}`;
    }
  }
}

export function r2Label(r2: number): string {
  return `R² = ${Number.isFinite(r2) ? String(Number(r2.toFixed(4))) : "?"}`;
}

export interface CurveOptions {
  /** Axis minimum / maximum the line is clipped to. */
  valMin?: number | null;
  valMax?: number | null;
  /** Log value axis: points ≤ 0 can't be drawn. */
  logBase?: number | null;
  /** On a log axis without a minimum, the line stops this many decades below its top (3). */
  cutDecades?: number;
  /** Samples along x (curves). */
  samples?: number;
}

/** The lowest value a trendline is drawn down to on a log axis. */
function logFloor(top: number, opts: CurveOptions): number {
  if (opts.valMin !== undefined && opts.valMin !== null && opts.valMin > 0) return opts.valMin;
  const base = opts.logBase ?? 10;
  return Math.max(top / Math.pow(base, opts.cutDecades ?? 3), 0.01);
}

/**
 * Points of the trendline between xMin and xMax (after forward/backward
 * extension by the caller), clipped to what the value axis can show. A
 * straight line is its two ends; curves are sampled.
 */
export function trendlineCurve(
  fit: Pick<TrendFit, "type" | "coefs">,
  xMin: number,
  xMax: number,
  opts: CurveOptions = {},
): { x: number[]; y: number[] } {
  const f = (x: number) => evaluate(fit.type, fit.coefs, x);
  const straight = fit.type === "linear" && !opts.logBase;
  const n = straight ? 2 : Math.max(8, opts.samples ?? 64);
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(xMin + ((xMax - xMin) * i) / (n - 1));
  let top = -Infinity;
  for (const x of xs) {
    const y = f(x);
    if (Number.isFinite(y)) top = Math.max(top, y);
  }
  // A log axis can't show y ≤ 0: a line that dips there stops at a floor.
  const dips = xs.some((x) => !(f(x) > 0));
  const lo = opts.logBase ? (dips ? logFloor(top, opts) : (opts.valMin ?? 0)) : (opts.valMin ?? -Infinity);
  const hi = opts.valMax ?? Infinity;
  const inside = (y: number) => Number.isFinite(y) && y >= lo - 1e-12 && y <= hi + 1e-12;
  // Where the curve crosses a clip bound between two samples.
  const cross = (a: number, b: number, bound: number) => {
    let x0 = a;
    let x1 = b;
    const s0 = Math.sign(f(x0) - bound);
    for (let i = 0; i < 60; i++) {
      const mid = (x0 + x1) / 2;
      const fm = f(mid);
      if (Number.isFinite(fm) && Math.sign(fm - bound) === s0) x0 = mid;
      else x1 = mid;
    }
    return (x0 + x1) / 2;
  };
  const out = { x: [] as number[], y: [] as number[] };
  const push = (x: number) => {
    const y = Math.min(hi, Math.max(lo, f(x)));
    if (out.x.length && Math.abs(out.x[out.x.length - 1] - x) < 1e-12) return;
    out.x.push(x);
    out.y.push(y);
  };
  for (let i = 0; i < xs.length; i++) {
    const y = f(xs[i]);
    if (i > 0) {
      const py = f(xs[i - 1]);
      const pIn = inside(py);
      const cIn = inside(y);
      if (pIn !== cIn) {
        const bound = (pIn ? y : py) < lo || !Number.isFinite(pIn ? y : py) ? lo : hi;
        if (Number.isFinite(py) && Number.isFinite(y)) push(cross(xs[i - 1], xs[i], bound));
      }
    }
    if (inside(y)) push(xs[i]);
  }
  return out;
}

/** The box a trendline occupies: {catMin, catMax, valMin, valMax}. */
export function trendlineExtent(
  fit: Pick<TrendFit, "type" | "coefs">,
  xMin: number,
  xMax: number,
  opts: CurveOptions = {},
): { catMin: number; catMax: number; valMin: number; valMax: number } | null {
  const c = trendlineCurve(fit, xMin, xMax, { ...opts, samples: Math.max(opts.samples ?? 0, 400) });
  if (!c.x.length) return null;
  return {
    catMin: Math.min(...c.x),
    catMax: Math.max(...c.x),
    valMin: Math.min(...c.y),
    valMax: Math.max(...c.y),
  };
}

/** Default legend name, e.g. "Linear (Sales)", "2 per. Mov. Avg. (Sales)". */
export function trendlineName(spec: TrendlineSpec, series: string): string {
  if (spec.name) return spec.name;
  const label: Record<TrendType, string> = {
    linear: "Linear",
    log: "Log.",
    power: "Power",
    exp: "Expon.",
    poly: "Poly.",
    movingAvg: `${spec.period ?? 2} per. Mov. Avg.`,
  };
  return `${label[spec.type]} (${series})`;
}
