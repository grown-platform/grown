// Histogram charts (M10): category aggregation (a histogram over text
// categories sums values per label) and numeric binning with automatic bin
// width, fixed bin width or bin count, and overflow / underflow bins.
//
// Binning rules (Excel's histogram chart, as documented and observed):
// - Automatic width is Scott's rule, 3.5·s / n^(1/3) with the sample
//   standard deviation, rounded to two significant digits; 5 when every
//   value is equal.
// - Bins start at the data minimum (or at the underflow bound) and are
//   closed on the right: the first bin is [a, b], the others (a, b]
//   ("left" closes them on the left instead, the last bin including the max).
// - Underflow u collects values ≤ u; it is used only for min < u ≤ max.
//   Overflow o collects values > o; it is used only for min ≤ o < max and,
//   with an underflow, o ≥ u. The last regular bin is cut at o.
// - A bin count includes the overflow/underflow bins.

export interface HistogramOptions {
  /** Fixed bin width. */
  binSize?: number | null;
  /** Fixed number of bins (overrides binSize). */
  binCount?: number | null;
  overflow?: number | null;
  underflow?: number | null;
  /** Which end of a bin is closed (default right). */
  closed?: "right" | "left";
}

export interface Bin {
  /** Lower edge (null for the underflow bin). */
  min: number | null;
  /** Upper edge (null for the overflow bin). */
  max: number | null;
  count: number;
}

export interface Binning {
  bins: Bin[];
  /** Edges of the regular bins, as the category axis shows them. */
  scale: number[];
  /** Value-axis range: smallest positive count capped at 1, largest count. */
  valMin: number;
  valMax: number;
}

/** Category histogram: sums values per label, in first-seen order. */
export function aggregateByCategory(values: number[], labels: string[]): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = [];
  const idx = new Map<string, number>();
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    const label = labels[i] ?? "";
    const at = idx.get(label);
    if (at === undefined) {
      idx.set(label, out.length);
      out.push({ label, value: v });
    } else out[at].value += v;
  });
  return out;
}

/**
 * The value-axis range of an aggregated histogram: the smallest single value
 * (so a sum never hides how low the data goes) and the largest sum.
 */
export function aggregateRange(values: number[], labels: string[]): { min: number; max: number } {
  const rows = aggregateByCategory(values, labels);
  const raw = values.filter((v) => Number.isFinite(v));
  if (!rows.length) return { min: 0, max: 0 };
  return { min: Math.min(...raw), max: Math.max(...rows.map((r) => r.value)) };
}

function twoSig(v: number): number {
  return v > 0 ? Number(v.toPrecision(2)) : v;
}

/** Scott's-rule bin width. */
export function autoBinWidth(values: number[]): number {
  const n = values.length;
  if (n < 2) return 5;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const s = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1));
  if (!(s > 0)) return 5;
  return twoSig((3.5 * s) / Math.cbrt(n));
}

const EPS = 1e-9;

export function binValues(valuesIn: number[], opts: HistogramOptions = {}): Binning {
  const values = valuesIn.filter((v) => Number.isFinite(v));
  if (!values.length) return { bins: [], scale: [], valMin: 0, valMax: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const closedLeft = opts.closed === "left";
  const uf = opts.underflow ?? null;
  const of = opts.overflow ?? null;
  const useU = uf !== null && Number.isFinite(uf) && uf > min && uf <= max;
  const useO = of !== null && Number.isFinite(of) && of >= min && of < max && (!useU || of >= (uf as number));
  const start = useU ? (uf as number) : min;
  const end = useO ? (of as number) : max;

  let width: number;
  let regular: number;
  const count = opts.binCount && opts.binCount > 0 ? Math.floor(opts.binCount) : 0;
  if (count) {
    regular = Math.max(0, count - (useU ? 1 : 0) - (useO ? 1 : 0));
    width = regular > 0 ? (end - start) / regular : 0;
  } else {
    width = opts.binSize && opts.binSize > 0 ? opts.binSize : autoBinWidth(values);
    regular = Math.max(1, Math.ceil((end - start) / width - EPS));
  }

  const edges: number[] = [start];
  for (let i = 1; i <= regular; i++) {
    let e = start + i * width;
    if (count && i === regular) e = end;
    else if (useO && e > (of as number)) e = of as number;
    edges.push(Number(e.toPrecision(12)));
  }
  if (!regular && useU && useO) edges.push(of as number);

  const bins: Bin[] = [];
  if (useU) bins.push({ min: null, max: uf, count: 0 });
  for (let i = 0; i < regular; i++) bins.push({ min: edges[i], max: edges[i + 1], count: 0 });
  if (useO) bins.push({ min: of, max: null, count: 0 });

  const first = useU ? 1 : 0;
  for (const v of values) {
    if (useU && v <= (uf as number)) {
      bins[0].count++;
      continue;
    }
    if (useO && v > (of as number)) {
      bins[bins.length - 1].count++;
      continue;
    }
    if (!regular) {
      // Nothing between the flow bins: the overflow bin takes the rest.
      if (useU && useO) bins[bins.length - 1].count++;
      continue;
    }
    let placed = false;
    for (let i = 0; i < regular; i++) {
      const a = edges[i];
      const b = edges[i + 1];
      const firstBin = i === 0;
      const lastBin = i === regular - 1;
      const inBin = closedLeft
        ? (v >= a - EPS && v < b - EPS) || (lastBin && v <= b + EPS && v >= a - EPS)
        : (v > a + EPS && v <= b + EPS) || (firstBin && !useU && v >= a - EPS && v <= b + EPS);
      if (inBin) {
        bins[first + i].count++;
        placed = true;
        break;
      }
    }
    if (!placed && !useO && v > edges[regular]) bins[first + regular - 1].count++;
  }
  const counts = bins.map((b) => b.count);
  const positive = counts.filter((c) => c > 0);
  return {
    bins,
    scale: edges,
    valMin: positive.length ? Math.min(1, ...positive) : 0,
    valMax: counts.length ? Math.max(...counts) : 0,
  };
}

/** Axis label for a bin, e.g. "[7, 89]", "(89, 171]", "≤7.1", ">176.99". */
export function binLabel(bin: Bin, index: number, closed: "right" | "left" = "right", fmt: (v: number) => string = (v) => String(v)): string {
  if (bin.min === null) return `≤${fmt(bin.max as number)}`;
  if (bin.max === null) return `>${fmt(bin.min)}`;
  if (closed === "left") return `[${fmt(bin.min)}, ${fmt(bin.max)})`;
  return `${index === 0 ? "[" : "("}${fmt(bin.min)}, ${fmt(bin.max)}]`;
}
