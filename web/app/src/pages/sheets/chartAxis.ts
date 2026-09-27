// Chart value-axis scaling (M10): the "nice" minimum, maximum and major unit
// a spreadsheet picks for a value axis, plus the value rounding charts use
// for labels and bin edges.
//
// Rules (Excel's documented behaviour, written from its description):
// - An axis over data that is all positive starts at 0 unless the smallest
//   value is more than 5/6 of the largest (then it starts near the data);
//   the mirror rule applies to all-negative data.
// - The major unit is 1, 2 or 5 × 10^k, the smallest that keeps the number
//   of intervals at or below the target (about one per 40 px of axis).
// - The maximum is the data maximum plus 5 % of the span, rounded up to the
//   major unit (so a bar that reaches a round number keeps some headroom).
// - Fixed min / max / major unit from the chart options win.

export interface AxisOptions {
  /** Fixed minimum (null/undefined: automatic). */
  min?: number | null;
  /** Fixed maximum. */
  max?: number | null;
  /** Fixed major unit. */
  majorUnit?: number | null;
  /** Logarithmic scale with this base (10 by default when `log` is true). */
  logBase?: number | null;
}

export interface AxisScale {
  min: number;
  max: number;
  /** Major unit (for a log axis: the exponent step, normally 1). */
  major: number;
  /** Tick values from min to max inclusive. */
  ticks: number[];
  logBase?: number;
}

/**
 * roundValue tidies a floating-point value for display: with no options, to
 * 10 significant digits (drops noise like 105.965000000002); with
 * `significant` true, to digits+1 significant digits (106.82, 2 → 107); with
 * `significant` false, to `digits` decimals. Non-finite values become 1.
 */
export function roundValue(v: number, significant?: boolean, digits?: number): number {
  if (!Number.isFinite(v)) return 1;
  if (v === 0) return 0;
  if (significant === undefined && digits === undefined) return Number(v.toPrecision(10));
  const d = digits ?? 0;
  if (significant) return Number(v.toPrecision(Math.max(1, Math.min(21, d + 1))));
  const f = Math.pow(10, d);
  return Math.round((v + Math.sign(v) * Number.EPSILON * Math.abs(v)) * f) / f;
}

/** The smallest 1/2/5 × 10^k step ≥ raw. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const m = n <= 1 + 1e-9 ? 1 : n <= 2 + 1e-9 ? 2 : n <= 5 + 1e-9 ? 5 : 10;
  return roundValue(m * pow);
}

function ticksFor(min: number, max: number, major: number): number[] {
  const out: number[] = [];
  const n = Math.round((max - min) / major);
  if (!Number.isFinite(n) || n > 1000) return [min, max];
  for (let i = 0; i <= n; i++) out.push(roundValue(min + i * major));
  return out;
}

/**
 * axisScale picks the axis for data in [dataMin, dataMax]. `targetTicks` is
 * the most intervals wanted (charts pass about axisLengthPx / 40).
 */
export function axisScale(dataMin: number, dataMax: number, opts: AxisOptions = {}, targetTicks = 8): AxisScale {
  if (opts.logBase && opts.logBase > 1) return logScale(dataMin, dataMax, opts);
  let lo = Number.isFinite(dataMin) ? dataMin : 0;
  let hi = Number.isFinite(dataMax) ? dataMax : 0;
  if (lo > hi) [lo, hi] = [hi, lo];
  const fixedMin = opts.min ?? null;
  const fixedMax = opts.max ?? null;
  if (fixedMin !== null) lo = Math.min(lo, fixedMin);
  if (fixedMax !== null) hi = Math.max(hi, fixedMax);
  // Zero-based unless the data sits well away from zero.
  if (fixedMin === null) {
    if (lo >= 0 && !(lo > (5 / 6) * hi)) lo = 0;
  }
  if (fixedMax === null) {
    if (hi <= 0 && !(hi < (5 / 6) * lo)) hi = 0;
  }
  if (fixedMin !== null) lo = fixedMin;
  if (fixedMax !== null) hi = fixedMax;
  if (hi === lo) {
    // Flat data: one unit around the value (or 0..1).
    if (hi === 0) hi = 1;
    else if (hi > 0) lo = fixedMin ?? 0;
    else hi = fixedMax ?? 0;
    if (hi === lo) hi = lo + 1;
  }
  const target = Math.max(2, Math.floor(targetTicks));
  let major = opts.majorUnit && opts.majorUnit > 0 ? opts.majorUnit : 0;
  if (!major) {
    const span = hi - lo;
    // Headroom first, then the step that fits the padded span.
    const padHi = fixedMax === null && hi > 0 ? hi + 0.05 * span : hi;
    const padLo = fixedMin === null && lo < 0 ? lo - 0.05 * span : lo;
    major = niceStep((padHi - padLo) / target);
    // A step that no longer fits after rounding the ends grows one notch.
    for (let guard = 0; guard < 4; guard++) {
      const a = fixedMin ?? Math.floor(padLo / major + 1e-9) * major;
      const b = fixedMax ?? Math.ceil(padHi / major - 1e-9) * major;
      if ((b - a) / major <= target + 1e-9) break;
      major = niceStep(major * 1.01);
    }
    const min = fixedMin ?? roundValue(Math.floor(padLo / major + 1e-9) * major);
    const max = fixedMax ?? roundValue(Math.ceil(padHi / major - 1e-9) * major);
    return { min, max, major, ticks: ticksFor(min, max, major) };
  }
  const min = fixedMin ?? roundValue(Math.floor(lo / major + 1e-9) * major);
  const max = fixedMax ?? roundValue(Math.ceil(hi / major - 1e-9) * major);
  return { min, max, major, ticks: ticksFor(min, Math.max(max, min + major), major) };
}

function logScale(dataMin: number, dataMax: number, opts: AxisOptions): AxisScale {
  const base = opts.logBase as number;
  const lg = (x: number) => Math.log(x) / Math.log(base);
  const lo = dataMin > 0 ? dataMin : 1;
  const hi = dataMax > 0 ? dataMax : lo;
  let e0 = opts.min && opts.min > 0 ? lg(opts.min) : Math.floor(lg(lo) + 1e-9);
  let e1 = opts.max && opts.max > 0 ? lg(opts.max) : Math.ceil(lg(hi) - 1e-9);
  if (e1 <= e0) e1 = e0 + 1;
  e0 = roundValue(e0);
  e1 = roundValue(e1);
  const step = opts.majorUnit && opts.majorUnit > 0 ? Math.max(1, Math.round(lg(opts.majorUnit))) : 1;
  const ticks: number[] = [];
  for (let e = Math.ceil(e0 - 1e-9); e <= e1 + 1e-9 && ticks.length < 60; e += step) ticks.push(roundValue(Math.pow(base, e)));
  return { min: roundValue(Math.pow(base, e0)), max: roundValue(Math.pow(base, e1)), major: step, ticks, logBase: base };
}

/** Position of v on an axis as a 0..1 fraction (log axes included). */
export function axisFraction(scale: AxisScale, v: number): number {
  if (scale.logBase) {
    if (!(v > 0)) return 0;
    const lg = (x: number) => Math.log(x) / Math.log(scale.logBase as number);
    return (lg(v) - lg(scale.min)) / (lg(scale.max) - lg(scale.min) || 1);
  }
  return (v - scale.min) / (scale.max - scale.min || 1);
}

/** Compact tick text: 1,200 · 0.25 · 1.5M · 2e-7. */
export function formatTick(v: number): string {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e15 || a < 1e-6)) return v.toExponential(1).replace("e+", "E+").replace("e-", "E-");
  if (a >= 1e9) return `${roundValue(v / 1e9, true, 2)}B`;
  if (a >= 1e6) return `${roundValue(v / 1e6, true, 2)}M`;
  return roundValue(v).toLocaleString("en-US", { maximumFractionDigits: 6 });
}
