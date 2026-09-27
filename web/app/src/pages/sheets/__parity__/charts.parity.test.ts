import { describe, expect, it } from "vitest";
import {
  equationCoefficients,
  movingAverage,
  rSquared,
  trendlineCurve,
  trendlineExtent,
  type TrendType,
} from "../trendlines";
import { aggregateByCategory, aggregateRange, binValues, type HistogramOptions } from "../histogram";
import { roundValue } from "../chartAxis";
import { buildChartInput, layoutSeries, type ChartConfig } from "../chartData";
import type { ChartType } from "../chartData";

// Ports of OnlyOffice's ChartsDrawTest.js (cell/spreadsheet-calculation) onto
// Grown's chart modules: trendlines.ts, histogram.ts, chartAxis.ts and the
// series layout in chartData.ts. The cases below restate the suite's inputs
// and expected results as data tables; comparisons use the suite's own
// tolerance (both numbers rounded to the precision the expected value is
// written with, then within 0.005).

function decimals(n: number): number {
  const s = String(n);
  const e = /e-(\d+)$/.exec(s);
  if (e) return Number(e[1]);
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}
/** Close in the suite's sense. */
function close(got: number, want: number): boolean {
  const d = Math.min(decimals(got), decimals(want));
  const r = (v: number) => Math.round((v + Number.EPSILON) * 10 ** d) / 10 ** d;
  return Math.abs(r(got) - r(want)) < 0.005;
}
function expectClose(got: number | undefined, want: number, what: string) {
  expect(got, what).toBeDefined();
  expect(close(got as number, want), `${what}: got ${got}, want ${want}`).toBe(true);
}
function expectAllClose(got: number[], want: number[], what: string) {
  expect(got.length, `${what} length (${got} vs ${want})`).toBe(want.length);
  want.forEach((w, i) => expectClose(got[i], w, `${what}[${i}]`));
}

const X6 = [1, 2, 3, 4, 5, 6];
const X7 = [1, 2, 3, 4, 5, 6, 7];

// [x, y, m, b] per case.
type Two = [number[], number[], number, number];

const LINEAR: Two[] = [
  [X6, [4, 6, 3, 7, 8, 9], 1, 2.6667],
  [[1, 2], [5, 15], 10, -5],
  [X6, [-1, -2, -3, -4, -5, -6], -1, 0],
  [X6, [-3, 6, -9, 12, -15, 18], 1.8, -4.8],
  [X6, [2, 3, 6, 8, 10, 12], 2.0857, -0.4667],
  [X6, [0, 2, -3, 6, 8, 9], 2.0571, -3.5333],
  [X6, [0, 1, 0, 2, 0, 3], 0.4, -0.4],
  [X6, [-9, -7, -6, -5, -4, -2], 1.2857, -10],
  [X6, [0.1, 0.3, 0.2, 0.5, 0.7, 0.9], 0.1571, -0.1],
  [X6, [-0.5, -0.4, -0.2, -0.1, 0.6, 0.9], 0.2886, -0.96],
  [X6, [2, 1, 4, 3, 6, 5], 0.8286, 0.6],
  [[1, 2, 3, 4], [2, 8, 16, 50], 15.2, -19],
  [X6, [4, -6, 3, -7, 8, 10], 1.7714, -4.2],
  [X6, [5, 50, 500, 5000, 50000, 500000], 75838, -172840],
  [X6, [0, 2, 3, 4, 5, 0], 0.2857, 1.3333],
];

const LOG: Two[] = [
  [X6, [4, 6, 3, 7, 8, 9], 2.5453, 3.3757],
  [[1, 2], [5, 15], 14.427, 5],
  [X6, [-1, -2, -3, -4, -5, -6], -2.732, -0.5044],
  [X6, [-3, 6, -9, 12, -15, 18], 4.1668, -3.0691],
  [X6, [2, 3, 6, 8, 10, 12], 5.6474, 0.6407],
  [X6, [0, 2, -3, 6, 8, 9], 5.1404, -1.97],
  [X6, [0, 1, 0, 2, 0, 3], 1.0302, -0.1296],
  [X6, [-9, -7, -6, -5, -4, -2], 3.5479, -9.3905],
  [X6, [0.1, 0.3, 0.2, 0.5, 0.7, 0.9], 0.4096, 0.0008],
  [X6, [-0.5, -0.4, -0.2, -0.1, 0.6, 0.9], 0.735, -0.756],
  [X6, [2, 1, 4, 3, 6, 5], 2.202, 1.0854],
  [[1, 2, 3, 4], [2, 8, 16, 50], 29.565, -4.4898],
  [X6, [4, -6, 3, -7, 8, 10], 3.2191, -1.5299],
  [X6, [5, 50, 500, 5000, 50000, 500000], 170659, -94542],
  [X6, [0, 2, 3, 4, 5, 0], 1.3313, 0.8735],
];

const POWER: Two[] = [
  [X6, [4, 6, 3, 7, 8, 9], 0.4178, 3.6391],
  [[1, 2], [5, 15], 1.585, 5],
  [X6, [2, 3, 6, 8, 10, 12], 1.0529, 1.799],
  [X6, [0.1, 0.3, 0.2, 0.5, 0.7, 0.9], 1.1616, 0.0984],
  [X6, [2, 1, 4, 3, 6, 5], 0.7283, 1.347],
  [[1, 2, 3, 4], [2, 8, 16, 50], 2.2106, 1.8367],
  [X6, [5, 50, 500, 5000, 50000, 500000], 6.2903, 1.5974],
];

const EXP: Two[] = [
  [X6, [4, 6, 3, 7, 8, 9], 0.1647, 3.2329],
  [[1, 2], [5, 15], 1.0986, 1.6667],
  [X6, [2, 3, 6, 8, 10, 12], 0.3674, 1.5776],
  [X6, [0.1, 0.3, 0.2, 0.5, 0.7, 0.9], 0.4127, 0.0829],
  [X6, [2, 1, 4, 3, 6, 5], 0.2763, 1.1384],
  [[1, 2, 3, 4], [2, 8, 16, 50], 1.035, 0.8],
  [X6, [5, 50, 500, 5000, 50000, 500000], 2.3026, 0.5],
];

// [x, y, number of coefficients, coefficients highest power first]
const POLY: [number[], number[], number, number[]][] = [
  [[1, 2], [5, 15], 2, [10, -5]],
  [X7, [4, 6, 3, 7, 8, 9, 11], 3, [0.1667, -0.1905, 4.2857]],
  [X7, [-1, -2, -3, -4, -5, -6, -7], 3, [0, -1, 0]],
  [X7, [-3, 6, -9, 12, -15, 18, -21], 3, [-1.1429, 7.8571, -10.286]],
  [X7, [2, 3, 6, 8, 10, 12, 14], 3, [0, 2.0714, -0.4286]],
  [X7, [0, 2, -3, 6, 8, 9, 15], 3, [0.4286, -0.9286, 0.4286]],
  [X7, [0, 1, 0, 2, 0, 3, 0], 3, [-0.0952, 0.9048, -0.8571]],
  [X7, [-9, -7, -6, -5, -4, -2, -1], 3, [9e-16, 1.2857, -10]],
  [X7, [0.1, 0.3, 0.2, 0.5, 0.7, 0.9, 1], 3, [0.0095, 0.081, 0.0143]],
  [X7, [-0.5, -0.4, -0.2, -0.1, 0.6, 0.9, 1], 3, [0.0202, 0.1202, -0.7]],
  [X7, [2, 1, 4, 3, 6, 5, 7], 3, [0.0357, 0.6071, 0.8571]],
  [[1, 2, 3, 4], [2, 8, 16, 50], 3, [7, -19.8, 16]],
  [X7, [4, -6, 3, -7, 8, 10, -12], 3, [-0.5357, 3.8929, -4.8571]],
  // oo-diff: the suite writes the last coefficient as 231822; the least-squares value is 231822.5.
  [X6, [5, 50, 500, 5000, 50000, 500000], 3, [43357, -227659, 231822.5]],
  [X6, [0, 2, 3, 4, 5, 0], 3, [-0.625, 4.6607, -4.5]],
  [X7, [4, 6, 3, 7, 8, 9, 11], 4, [-0.0278, 0.5, -1.3294, 5.2857]],
  [X7, [-1, -2, -3, -4, -5, -6, -7], 4, [0, 0, -1, 5e-12]],
  [X7, [-3, 6, -9, 12, -15, 18, -21], 4, [-0.6667, 6.8571, -19.476, 13.714]],
  [X7, [2, 3, 6, 8, 10, 12, 14], 4, [-0.0278, 0.3333, 0.9325, 0.5714]],
  [X7, [0, 2, -3, 6, 8, 9, 15], 4, [-0.0833, 1.4286, -4.3452, 3.4286]],
  [X7, [0, 1, 0, 2, 0, 3, 0], 4, [-0.0556, 0.5714, -1.373, 1.1429]],
  [X7, [-9, -7, -6, -5, -4, -2, -1], 4, [0.0278, -0.3333, 2.4246, -11]],
  [X7, [0.1, 0.3, 0.2, 0.5, 0.7, 0.9, 1], 4, [-0.0056, 0.0762, -0.1468, 0.2143]],
  [X7, [-0.5, -0.4, -0.2, -0.1, 0.6, 0.9, 1], 4, [-0.0167, 0.2202, -0.5631, -0.1]],
  [X7, [2, 1, 4, 3, 6, 5, 7], 4, [-0.0278, 0.369, -0.5317, 1.8571]],
  [[1, 2, 3, 4], [2, 8, 16, 50], 4, [4, -23, 47, -26]],
  [X7, [4, -6, 3, -7, 8, 10, -12], 4, [-1.0278, 11.798, -38.246, 32.143]],
  [X6, [5, 50, 500, 5000, 50000, 500000], 4, [19744, -163953, 398218, -265720]],
  [X6, [0, 2, 3, 4, 5, 0], 4, [-0.2315, 1.8056, -2.6772, 1.3333]],
  [X7, [4, 6, 3, 7, 8, 9, 11], 5, [-0.0265, 0.3965, -1.7917, 3.4282, 2.2857]],
  [X7, [-1, -2, -3, -4, -5, -6, -7], 5, [0, 5e-13, 0, -1, 6e-11]],
  [X7, [-3, 6, -9, 12, -15, 18, -21], 5, [-0.7273, 10.97, -56, 111.02, -68.571]],
  [X7, [2, 3, 6, 8, 10, 12, 14], 5, [0.0265, -0.452, 2.625, -3.825, 3.5714]],
  [X7, [0, 2, -3, 6, 8, 9, 15], 5, [0.0341, -0.6288, 4.375, -10.462, 7.2857]],
  [X7, [0, 1, 0, 2, 0, 3, 0], 5, [-0.0606, 0.9141, -4.6667, 9.5014, -5.7143]],
  [X7, [-9, -7, -6, -5, -4, -2, -1], 5, [-0.0265, 0.452, -2.625, 7.1822, -14]],
  [X7, [0.1, 0.3, 0.2, 0.5, 0.7, 0.9, 1], 5, [-0.0045, 0.0672, -0.3167, 0.6688, -0.3]],
  [X7, [-0.5, -0.4, -0.2, -0.1, 0.6, 0.9, 1], 5, [-0.0083, 0.1167, -0.5, 0.9321, -1.0429]],
  [X7, [2, 1, 4, 3, 6, 5, 7], 5, [0.0492, -0.8157, 4.625, -9.3672, 7.4286]],
  [X7, [4, -6, 3, -7, 8, 10, -12], 5, [-0.3144, 4.0025, -15.375, 18.165, -3.4286]],
  [X6, [5, 50, 500, 5000, 50000, 500000], 5, [7517.8, -85506, 337593, -533991, 275562.5]], // oo-diff: written 275562 in the suite (truncated)
  [X6, [0, 2, 3, 4, 5, 0], 5, [-0.1458, 1.8102, -7.9236, 15.406, -9.1667]],
  [X7, [4, 6, 3, 7, 8, 9, 11], 6, [0.0833, -1.6932, 12.758, -43.458, 65.508, -29.143]],
  [X7, [-1, -2, -3, -4, -5, -6, -7], 6, [-6e-14, 0, 7e-12, -3e-11, -1, 4e-9]],
  [X7, [-3, 6, -9, 12, -15, 18, -21], 6, [-0.4, 7.2727, -48.364, 144, -186.96, 82.286]],
  [X7, [2, 3, 6, 8, 10, 12, 14], 6, [-0.0167, 0.3598, -2.9242, 10.958, -16.241, 9.8571]],
  [X7, [0, 2, -3, 6, 8, 9, 15], 6, [0.175, -3.4659, 25.33, -83.125, 119.9, -58.714]],
  [X7, [0, 1, 0, 2, 0, 3, 0], 6, [-0.0333, 0.6061, -4.0303, 12, -15.33, 6.8571]],
  [X7, [-9, -7, -6, -5, -4, -2, -1], 6, [-0.0083, 0.1402, -0.7841, 1.5417, 0.9742, -10.857]],
  [X7, [0.1, 0.3, 0.2, 0.5, 0.7, 0.9, 1], 6, [0.0042, -0.0879, 0.6852, -2.4, 3.7727, -1.8714]],
  [X7, [-0.5, -0.4, -0.2, -0.1, 0.6, 0.9, 1], 6, [0.0013, -0.0333, 0.3021, -1.125, 1.8633, -1.5143]],
  [X7, [2, 1, 4, 3, 6, 5, 7], 6, [-0.0042, 0.1326, -1.4337, 6.7083, -12.471, 9]],
  [X7, [4, -6, 3, -7, 8, 10, -12], 6, [-0.2292, 4.2689, -29.991, 99.208, -152.55, 83]],
  [X6, [5, 50, 500, 5000, 50000, 500000], 6, [2460.4, -35539, 196071, -509186, 611919, -265720]],
  [X6, [0, 2, 3, 4, 5, 0], 6, [-0.0417, 0.5833, -2.9583, 6.4167, -4, -1e-8]],
  [X7, [4, 6, 3, 7, 8, 9, 11], 7, [-0.0694, 1.75, -17.444, 87, -224.99, 279.75, -122]],
  [X7, [-1, -2, -3, -4, -5, -6, -7], 7, [0, -3e-11, -8e-10, 2e-9, 2e-8, -1, -1e-6]],
  [X7, [-3, 6, -9, 12, -15, 18, -21], 7, [-1.0667, 25.2, -234.67, 1092, -2644.3, 3103.8, -1344]],
  [X7, [2, 3, 6, 8, 10, 12, 14], 7, [0.0083, -0.2167, 2.25, -11.833, 32.742, -41.95, 21]],
  [X7, [0, 2, -3, 6, 8, 9, 15], 7, [-0.1333, 3.375, -33.708, 167.88, -431.66, 531.25, -237]],
  [X7, [0, 1, 0, 2, 0, 3, 0], 7, [-0.0889, 2.1, -19.556, 91, -220.36, 258.9, -112]],
  [X7, [-9, -7, -6, -5, -4, -2, -1], 7, [-0.0083, 0.1917, -1.75, 8.125, -20.242, 26.683, -22]],
  [X7, [0.1, 0.3, 0.2, 0.5, 0.7, 0.9, 1], 7, [-0.0036, 0.0908, -0.9069, 4.5458, -11.839, 14.913, -6.7]],
  [X7, [-0.5, -0.4, -0.2, -0.1, 0.6, 0.9, 1], 7, [0.0076, -0.1821, 1.6993, -7.8646, 18.843, -21.703, 8.7]],
  [X7, [2, 1, 4, 3, 6, 5, 7], 7, [0.0875, -2.1042, 19.979, -94.979, 235.43, -282.42, 126]],
  [X7, [4, -6, 3, -7, 8, 10, -12], 7, [0.3792, -9.3292, 90.271, -435.35, 1090.4, -1322.3, 590]],
  // Fewer points than coefficients: the degree drops to what the data fits.
  [[1, 2], [5, 15], 3, [10, -5]],
  [[1, 2, 3, 4], [2, 8, 16, 50], 5, [4, -23, 47, -26]],
];

function checkTwo(type: Exclude<TrendType, "movingAvg" | "poly">, rows: Two[]) {
  rows.forEach(([x, y, m, b], i) => {
    const c = equationCoefficients(x, y, type);
    expect(c, `${type} case ${i}`).toBeDefined();
    expectClose(c![0], m, `${type} case ${i} slope`);
    expectClose(c![1], b, `${type} case ${i} constant`);
  });
}

describe("ChartsDrawTest: trendline equations", () => {
  it("oo:cell/spreadsheet-calculation/ChartsDrawTest.js#Test: Linear trendlines equation", () => checkTwo("linear", LINEAR));
  it("oo:cell/spreadsheet-calculation/ChartsDrawTest.js#Test: Logarithmic trendlines equation", () => checkTwo("log", LOG));
  it("oo:cell/spreadsheet-calculation/ChartsDrawTest.js#Test: Power trendlines equation", () => {
    checkTwo("power", POWER);
    // A zero or negative y can't be fitted.
    expect(equationCoefficients(X6, [5, 50, 500, 0, 50000, 500000], "power")).toBeUndefined();
    expect(equationCoefficients(X6, [5, 50, 500, -1, 50000, 500000], "power")).toBeUndefined();
  });
  it("oo:cell/spreadsheet-calculation/ChartsDrawTest.js#Test: Exponential trendlines equation", () => {
    checkTwo("exp", EXP);
    expect(equationCoefficients(X6, [5, 50, 500, 0, 50000, 500000], "exp")).toBeUndefined();
    expect(equationCoefficients(X6, [5, 50, 500, -1, 50000, 500000], "exp")).toBeUndefined();
  });
  it("oo:cell/spreadsheet-calculation/ChartsDrawTest.js#Test: Polynomial trendlines equation", () => {
    POLY.forEach(([x, y, n, want], i) => {
      const c = equationCoefficients(x, y, "poly", n - 1);
      expect(c, `poly case ${i}`).toBeDefined();
      expectAllClose(c!.slice(0, want.length), want, `poly case ${i}`);
    });
  });
});

// [x, y, points on the category axis, period, x out, y out]
const MA: [number[], number[], number, number, number[], number[]][] = [
  [X6, [4, 6, 3, 7, 8, 9], 6, 2, [2, 3, 4, 5, 6], [5, 4.5, 5, 7.5, 8.5]],
  [[1, 2], [5, 15], 2, 3, [], []],
  [X6, [-1, -2, -3, -4, -5, -6], 6, 4, [4, 5, 6], [-2.5, -3.5, -4.5]],
  [X6, [-3, 6, -9, 12, -15, 18], 6, 5, [5, 6], [-1.8, 2.4]],
  [X6, [2, 3, 6, 8, 10, 12], 6, 6, [], []],
  [X6, [0, 2, -3, 6, 8, 9], 6, 2, [2, 3, 4, 5, 6], [1, -0.5, 1.5, 7, 8.5]],
  [X6, [0, 1, 0, 2, 0, 3], 6, 3, [3, 4, 5, 6], [0.333333, 1, 0.666667, 1.666667]],
  [X6, [-9, -7, -6, -5, -4, -2], 6, 4, [4, 5, 6], [-6.75, -5.5, -4.25]],
  [X6, [0.1, 0.3, 0.2, 0.5, 0.7, 0.9], 6, 5, [5, 6], [0.36, 0.52]],
  [X6, [-0.5, -0.4, -0.2, -0.1, 0.6, 0.9], 6, 2, [2, 3, 4, 5, 6], [-0.45, -0.3, -0.15, 0.25, 0.75]],
  [X6, [2, 1, 4, 3, 6, 5], 6, 3, [3, 4, 5, 6], [2.333333, 2.666667, 4.333333, 4.666667]],
  [[1, 2, 3, 4], [2, 8, 16, 50], 4, 3, [3, 4], [8.666667, 24.666667]],
  [X6, [4, -6, 3, -7, 8, 10], 6, 4, [4, 5, 6], [-1.5, -0.5, 3.5]],
  [X6, [5, 50, 500, 5000, 50000, 500000], 6, 5, [5, 6], [11111, 111110]],
  [X6, [0, 2, 3, 4, 5, 0], 6, 2, [2, 3, 4, 5, 6], [1, 2.5, 3.5, 4.5, 2.5]],
  // Gaps: windows use whatever points they hold; empty windows are skipped.
  [[1, 2, 6], [4, 6, 10], 6, 2, [2, 3, 6], [5, 6, 10]],
  [[1, 2], [4, 6], 3, 2, [2, 3], [5, 6]],
  [[1, 2, 6, 7], [4, 6, 10, 13], 7, 2, [2, 3, 6, 7], [5, 6, 10, 11.5]],
  [[1, 4, 6, 7], [4, 5, 10, 13], 7, 2, [2, 4, 5, 6, 7], [4, 5, 5, 10, 11.5]],
  [[4, 6, 7], [5, 10, 13], 7, 2, [4, 5, 6, 7], [5, 5, 10, 11.5]],
  [[1, 2, 3, 4, 6], [4, 6, 3, 7, 10], 7, 3, [3, 4, 5, 6, 7], [4.333333, 5.333333, 5, 8.5, 10]],
  [[1, 2, 3, 6], [4, 6, 3, 10], 7, 3, [3, 4, 5, 6, 7], [4.333333, 4.5, 3, 10, 10]],
  [[4, 6], [5, 10], 7, 2, [4, 5, 6, 7], [5, 5, 10, 10]],
];

describe("ChartsDrawTest: moving average and R²", () => {
  it("oo:cell/spreadsheet-calculation/ChartsDrawTest.js#Test: MovingAverage trendlines results", () => {
    MA.forEach(([x, y, n, p, wx, wy], i) => {
      const r = movingAverage(x, y, n, p);
      expectAllClose(r.x, wx, `MA case ${i} x`);
      expectAllClose(r.y, wy, `MA case ${i} y`);
    });
  });

  it("oo:cell/spreadsheet-calculation/ChartsDrawTest.js#Test: Check R squared", () => {
    // R² of the fitted model over the raw data. (The suite passes ln-transformed
    // x or y for the log/power/exponential rows; the raw data is given here.)
    const e = (xs: number[]) => xs.map(Math.exp);
    const rows: [number[], number[], Exclude<TrendType, "movingAvg">, number[], number][] = [
      [X6, [4, 6, 3, 7, 8, 9], "linear", [1, 2.6667], 0.6522],
      [[1, 2], [5, 15], "linear", [10, -5], 1],
      [X6, [-1, -2, -3, -4, -5, -6], "linear", [-1, 0], 1],
      [e([0, 0.693147181, 1.098612289, 1.386294361, 1.609437912, 1.791759469]), [-3, 6, -9, 12, -15, 18], "log", [4.1668, -3.0691], 0.0473],
      [X6, e([0.693147181, 1.098612289, 1.791759469, 2.079441542, 2.302585093, 2.48490665]), "exp", [0.3674, 1.5776], 0.9291],
      [X6, [0, 2, -3, 6, 8, 9], "poly", [0.4107, -0.8179, 0.3], 0.709],
      [X6, [0, 1, 0, 2, 0, 3], "poly", [0.1296, -1.254, 3.75973, -2.6667], 0.5397],
      [X6, [-9, -7, -6, -5, -4, -2], "poly", [3e-14, 0.0926, -0.9722, 4.2209, -12.333], 0.9995],
      [
        e([0, 0.693147181, 1.098612289, 1.386294361, 1.609437912, 1.791759469]),
        e([-2.302585093, -1.203972804, -1.609437912, -0.693147181, -0.356674944, -0.105360516]),
        "power",
        [1.1616, 0.0984],
        0.9217,
      ],
      [X6, [-0.5, -0.4, -0.2, -0.1, 0.6, 0.9], "poly", [-0.0217, 0.3625, -2.25, 6.4375, -8.2283, 3.2], 1],
      [X6, e([0.693147181, 0, 1.386294361, 1.098612289, 1.791759469, 1.609437912]), "exp", [0.2763, 1.1384], 0.6496],
      [[1, 2, 3, 4], [2, 8, 16, 50], "linear", [15.2, -19], 0.8371],
      [X6, [4, -6, 3, -7, 8, 10], "linear", [1.7714, -4.2], 0.2197],
      [
        e([0, 0.693147181, 1.098612289, 1.386294361, 1.609437912, 1.791759469]),
        e([1.609437912, 3.912023005, 6.214608098, 8.517193191, 10.81977828, 13.12236338]),
        "power",
        [6.2903, 1.5974],
        0.9537,
      ],
      [X6, [0, 2, 3, 4, 5, 0], "linear", [0.2857, 1.3333], 0.067],
    ];
    const misses: string[] = [];
    rows.forEach(([x, y, type, coefs, want], i) => {
      const got = rSquared(x, y, type, coefs);
      if (!close(got, want)) misses.push(`${i}: ${type} got ${got.toFixed(4)} want ${want}`);
    });
    // oo-diff: for exponential and power trendlines Grown reports R² in the
    // space the fit is made in (ln y against x, or ln y against ln x), which is
    // the spreadsheet convention and equals the squared correlation there;
    // OnlyOffice reports different values for these four rows.
    expect(misses).toEqual([
      "4: exp got 0.9461 want 0.9291",
      "8: power got 0.8697 want 0.9217",
      "10: exp got 0.6083 want 0.6496",
      "13: power got 0.9363 want 0.9537",
    ]);
  });

  it("oo:cell/spreadsheet-calculation/ChartsDrawTest.js#Test: Interception equation + rSquared", () => {
    // [x, y, type, coefficient count, intercept, expected coefficients]
    const rows: [number[], number[], Exclude<TrendType, "movingAvg">, number, number, number[]][] = [
      [X6, [4, 6, 3, 7, 8, 9], "linear", 2, 0, [1.6154, 0]],
      [[1, 2], [5, 15], "linear", 2, 0, [7, 0]],
      // Log trendlines have no fixed intercept: the ordinary fit.
      [X6, [-1, -2, -3, -4, -5, -6], "log", 2, 0, [-2.732, -0.5044]],
      [X6, [-3, 6, -9, 12, -15, 18], "poly", 3, 0, [0.7232, -2.8125, 0]],
      [X6, [2, 3, 6, 8, 10, 12], "exp", 2, 1, [0.4726, 1]],
      [X6, [2, 3, 6, 8, 10, 12], "exp", 2, 2, [0.3126, 2]],
      [X6, [0, 2, -3, 6, 8, 9], "poly", 4, 0, [-0.0662, 0.9524, -1.7176, 0]],
      [X6, [0, 1, 0, 2, 0, 3], "poly", 5, 0, [0.045, -0.4827, 1.5552, -1.1891, 0]],
      [X6, [-9, -7, -6, -5, -4, -2], "poly", 6, 0, [-0.0501, 0.8914, -5.857, 17.348, -21.228, 0]],
      [X7, [0.1, 0.3, 0.2, 0.5, 0.7, 0.9, 1], "poly", 7, 0, [0.001, -0.0219, 0.1707, -0.5973, 0.9099, -0.3486, 0]],
      [X6, [-0.5, -0.4, -0.2, -0.1, 0.6, 0.9], "linear", 2, -2, [0.5286, -2]],
      [X6, [2, 1, 4, 3, 6, 5], "linear", 2, 12.365, [-1.8864, 12.365]],
      [[1, 2, 3, 4], [2, 8, 16, 50], "exp", 2, 12.365, [0.1223, 12.365]],
      [X6, [4, -6, 3, -7, 8, 10], "linear", 2, -6.958, [2.4079, -6.958]],
      [X6, [5, 50, 500, 5000, 50000, 500000], "exp", 2, 0.1265, [2.6197, 0.1265]],
      [X6, [0, 2, 3, 4, 5, 0], "linear", 2, 0.1265, [0.5642, 0.1265]],
    ];
    rows.forEach(([x, y, type, n, b, want], i) => {
      const c = equationCoefficients(x, y, type, n - 1, b);
      expect(c, `intercept case ${i}`).toBeDefined();
      expectAllClose(c!, want, `intercept case ${i}`);
    });
    // R² with a free intercept, and where the fixed one changes nothing.
    expectClose(rSquared([1, 2], [5, 15], "linear", [7, 0]), 0.9, "R² [5,15] through 0");
    expectClose(rSquared(X6, [-1, -2, -3, -4, -5, -6], "log", [-2.732, -0.5044]), 0.9363, "R² log");
    // oo-diff: with a fixed intercept OnlyOffice reports the R² of the free
    // fit (e.g. 0.6522 for the first row); Grown reports 1 − SSres/SStot of
    // the line actually drawn (0.3464), the usual definition.
    expectClose(rSquared(X6, [4, 6, 3, 7, 8, 9], "linear", [1.6154, 0]), 0.3464, "R² through 0 (Grown)");
  });
});

// Trendline curves drawn between catMin and catMax: [coefs as [m, b], type,
// catMin, catMax, fixed axis minimum, log base, first point, last point].
type Curve = [[number, number], Exclude<TrendType, "movingAvg" | "poly">, number, number, number | null, number | null, [number, number], [number, number]];
const CURVES: Curve[] = [
  [[0.8285714285714283, 0.6000000000000014], "linear", 1, 6, null, null, [1, 1.4285714285714297], [6, 5.571428571428571]],
  [[15.200000000000003, -19], "linear", 1, 4, null, null, [1, -3.799999999999997], [4, 41.80000000000001]],
  [[1.7714285714285714, -4.199999999999999], "linear", 1, 6, null, null, [1, -2.428571428571428], [6, 6.428571428571429]],
  [[75837.85714285713, -172840], "linear", 1, 6, null, null, [1, -97002.14285714287], [6, 282187.1428571428]],
  [[0.28571428571428514, 1.333333333333334], "linear", 1, 6, null, null, [1, 1.619047619047619], [6, 3.047619047619045]],
  [[0.8285714285714283, 0.6000000000000014], "linear", 1, 6, null, 10, [1, 1.4285714285714297], [6, 5.57142857142857]],
  // On a log axis the line starts where it rises above the axis floor.
  [[15.200000000000003, -19], "linear", 1, 4, 0.1, 10, [1.256578947368421, 0.10000000000000005], [4, 41.800000000000004]],
  [[1.7714285714285714, -4.199999999999999], "linear", 1, 6, null, 10, [2.376612903225806, 0.01000000000000001], [6, 6.428571428571428]],
  [[75837.85714285713, -172840], "linear", 1, 6, null, 10, [2.2827937611257103, 282.187142857143], [6, 282187.1428571427]],
  [[0.28571428571428514, 1.333333333333334], "linear", 1, 6, null, 10, [1, 1.619047619047619], [6, 3.047619047619045]],
  [[2.202033537057911, 1.0853780304041418], "log", 1, 6, null, null, [1, 1.0853780304041418], [6, 5.030892471985402]],
  [[29.565068994571178, -4.489845190674558], "log", 1, 4, null, null, [1, -4.489845190674558], [4, 36.496043242619976]],
  [[3.2191057898549253, -1.5298842782486233], "log", 1, 6, null, null, [1, -1.5298842782486233], [6, 4.237979003170796]],
  [[170658.5375973549, -94541.7317212114], "log", 1, 6, null, null, [1, -94541.7317212114], [6, 211237.3190234613]],
  [[1.3313304643014572, 0.8734737381931108], "log", 1, 6, null, null, [1, 0.8734737381931108], [6, 3.2588977042770297]],
  [[2.202033537057911, 1.0853780304041418], "log", 1, 6, null, 10, [1, 1.0853780304041418], [6, 5.0308924719854]],
  [[29.565068994571178, -4.489845190674558], "log", 1, 4, null, 10, [1.165438725217985, 0.03649604324262], [4, 36.49604324261996]],
  [[3.2191057898549253, -1.5298842782486233], "log", 1, 6, null, 10, [1.6134226199693829, 0.01000000000000001], [6, 4.2379790031707945]],
  [[170658.5375973549, -94541.7317212114], "log", 1, 6, null, 10, [1.7423235984576693, 211.23731902346108], [6, 211237.31902346085]],
  [[1.3313304643014572, 0.8734737381931108], "log", 1, 6, null, 10, [1, 0.8734737381931108], [6, 3.2588977042770293]],
  [[0.7283261086204962, 1.3470294984018791], "power", 1, 6, null, null, [1, 1.3470294984018791], [6, 4.967352481769911]],
  [[2.210556099993931, 1.8367239858577353], "power", 1, 4, null, null, [1, 1.8367239858577353], [4, 39.34878110454656]],
  [[6.290262865578015, 1.597378819226662], "power", 1, 6, null, null, [1, 1.5974], [6, 125367.1738292479]],
  [[0.7283261086204962, 1.3470294984018791], "power", 1, 6, null, 10, [1, 1.3470294984018791], [6, 4.967352481769911]],
  [[2.210556099993931, 1.8367239858577353], "power", 1, 4, null, 10, [1, 1.8367239858577353], [4, 39.34878110454656]],
  [[6.056432353383194, 1.9540401412926336], "power", 1, 10, null, 10, [1, 1.9540401412926336], [10, 2225183.5179863917]],
  [[0.2762585712743759, 1.1384149147480012], "exp", 1, 6, null, null, [1, 1.5006456374707577], [6, 5.97263555719961]],
  [[1.034977465516456, 0.7999999999999979], "exp", 1, 4, null, null, [1, 2.252034239498936], [4, 50.23772863019174]],
  [[2.302585092994045, 0.5000000000000027], "exp", 1, 6, null, null, [1, 5.00007], [6, 500000.00000000064]],
  [[0.2762585712743759, 1.1384149147480012], "exp", 1, 6, null, 10, [1, 1.5006456374707577], [6, 5.9726355571996095]],
  [[1.034977465516456, 0.7999999999999979], "exp", 1, 4, null, 10, [1, 2.2520342394989354], [4, 50.237728630191725]],
  [[2.302585092994045, 0.5000000000000027], "exp", 1, 6, null, 10, [1, 5.000000000000022], [6, 499999.99999999994]],
];

describe("ChartsDrawTest: trendline curves", () => {
  it("oo:cell/spreadsheet-calculation/ChartsDrawTest.js#Test: Line Builder approximated bezier function", () => {
    // Where the drawn line starts and ends. (OnlyOffice also returns its Bézier
    // control points; Grown samples the curve, so only the ends are compared.)
    CURVES.forEach(([coefs, type, a, b, valMin, logBase, first, last], i) => {
      const c = trendlineCurve({ type, coefs }, a, b, { valMin, logBase });
      expect(c.x.length, `curve ${i}`).toBeGreaterThanOrEqual(2);
      expectClose(c.x[0], first[0], `curve ${i} start x`);
      expectClose(c.y[0], first[1], `curve ${i} start y`);
      expectClose(c.x[c.x.length - 1], last[0], `curve ${i} end x`);
      expectClose(c.y[c.y.length - 1], last[1], `curve ${i} end y`);
    });
  });

  it("oo:cell/spreadsheet-calculation/ChartsDrawTest.js#Test: Line Builder boundaries calculation", () => {
    CURVES.forEach(([coefs, type, a, b, valMin, logBase, first, last], i) => {
      const ext = trendlineExtent({ type, coefs }, a, b, { valMin, logBase });
      expect(ext, `extent ${i}`).not.toBeNull();
      // All of these curves are monotonic, so the box is spanned by the ends.
      expectClose(ext!.catMin, first[0], `extent ${i} catMin`);
      expectClose(ext!.catMax, last[0], `extent ${i} catMax`);
      expectClose(ext!.valMin, Math.min(first[1], last[1]), `extent ${i} valMin`);
      expectClose(ext!.valMax, Math.max(first[1], last[1]), `extent ${i} valMax`);
    });
  });
});

const D13 = [7, 9, 31, 31, 47, 75, 87, 115, 116, 119, 119, 155, 177];
const D11 = D13.slice(0, 11);
const D9 = D13.slice(0, 9);
const D7 = D13.slice(0, 7);
const D5 = D13.slice(0, 5);
const D3 = [7, 9, 31];
const L13 = ["c", "#", "f", "c", "c", "c", "c", "f", "f", "d", "f", "d", "d"];

describe("ChartsDrawTest: histograms", () => {
  it("oo:cell/spreadsheet-calculation/ChartsDrawTest.js#Test: Histogram aggregation calculations", () => {
    const got = (v: number[], l: string[]) => aggregateByCategory(v, l).map((r) => [r.label, r.value]);
    expect(got([7, 9], ["c", "#"])).toEqual([["c", 7], ["#", 9]]);
    expect(got(D13, L13)).toEqual([["c", 247], ["#", 9], ["f", 381], ["d", 451]]);
    expect(got([7], [])).toEqual([["", 7]]);
    expect(got(D13, ["7", "7", ...D13.slice(2).map(String)])).toEqual([
      ["7", 16], ["31", 62], ["47", 47], ["75", 75], ["87", 87], ["115", 115], ["116", 116], ["119", 238], ["155", 155], ["177", 177],
    ]);
    expect(got([0, 9, 31, 0], ["c", "#", "f", "c"])).toEqual([["c", 0], ["#", 9], ["f", 31]]);
  });

  it("oo:cell/spreadsheet-calculation/ChartsDrawTest.js#Test: Histogram aggregation min and max calculations", () => {
    const range = (v: number[], l: string[]) => {
      const r = aggregateRange(v, l);
      return [r.min, r.max];
    };
    expect(range([7, 9], ["c", "#"])).toEqual([7, 9]);
    expect(range(D13, L13)).toEqual([7, 451]);
    expect(range([7], [])).toEqual([7, 7]);
    expect(range(D13, ["7", "7", ...D13.slice(2).map(String)])).toEqual([7, 238]);
    expect(range([0, 9, 31, 0], ["c", "#", "f", "c"])).toEqual([0, 31]);
  });

  // [data, options, bins as [min, max, count], axis max count, category scale]
  type BinCase = [number[], HistogramOptions, [number | null, number | null, number][], number, number[]];
  const B = (overflow: number | null, underflow: number | null, binCount: number | null, binSize: number | null): HistogramOptions => ({
    overflow,
    underflow,
    binCount,
    binSize,
  });
  const BINS: BinCase[] = [
    [D13, B(null, null, null, null), [[7, 89, 7], [89, 171, 5], [171, 253, 1]], 7, [7, 89, 171, 253]],
    [D11, B(null, null, null, null), [[7, 78, 6], [78, 149, 5]], 6, [7, 78, 149]],
    [D9, B(null, null, null, null), [[7, 78, 6], [78, 149, 3]], 6, [7, 78, 149]],
    [D7, B(null, null, null, null), [[7, 63, 5], [63, 119, 2]], 5, [7, 63, 119]],
    [D5, B(null, null, null, null), [[7, 41, 4], [41, 75, 1]], 4, [7, 41, 75]],
    [D3, B(null, null, null, null), [[7, 39, 3]], 3, [7, 39]],
    [[7, 9], B(null, null, null, null), [[7, 10.9, 2]], 2, [7, 10.9]],
    [[7], B(null, null, null, null), [[7, 12, 1]], 1, [7, 12]],
    [[7, 7, 7, 7, 7, 7, 7, 7], B(null, null, null, null), [[7, 12, 8]], 8, [7, 12]],
    [D13, B(null, null, null, 26), [[7, 33, 4], [33, 59, 1], [59, 85, 1], [85, 111, 1], [111, 137, 4], [137, 163, 1], [163, 189, 1]], 4, [7, 33, 59, 85, 111, 137, 163, 189]],
    [D3, B(null, null, null, 5), [[7, 12, 2], [12, 17, 0], [17, 22, 0], [22, 27, 0], [27, 32, 1]], 2, [7, 12, 17, 22, 27, 32]],
    [[7, 18], B(null, null, null, 10), [[7, 17, 1], [17, 27, 1]], 1, [7, 17, 27]],
    [D13, B(null, null, 1, null), [[7, 177, 13]], 13, [7, 177]],
    [[7, 9], B(null, null, 3, null), [[7, 7.666666667, 1], [7.666666667, 8.3333333333, 0], [8.3333333333, 9, 1]], 1, [7, 7.666666667, 8.333333333, 9]],
    [[31], B(null, null, 2, null), [[31, 31, 1], [31, 31, 0]], 1, [31, 31, 31]],
    [D13, B(null, 7.1, null, null), [[null, 7.1, 1], [7.1, 89.1, 6], [89.1, 171.1, 5], [171.1, 253.1, 1]], 6, [7.1, 89.1, 171.1, 253.1]],
    [D11, B(null, 25, null, null), [[null, 25, 2], [25, 96, 5], [96, 167, 4]], 5, [25, 96, 167]],
    [D9, B(null, 78, null, null), [[null, 78, 6], [78, 149, 3]], 6, [78, 149]],
    [D7, B(null, 86.9999, null, null), [[null, 86.9999, 6], [86.9999, 142.9999, 1]], 6, [86.9999, 142.9999]],
    [D5, B(null, 7, null, null), [[7, 41, 4], [41, 75, 1]], 4, [7, 41, 75]],
    [D3, B(null, 30, null, null), [[null, 30, 2], [30, 62, 1]], 2, [30, 62]],
    [[7, 7.5], B(null, 7.4, null, null), [[null, 7.4, 1], [7.4, 8.38, 1]], 1, [7.4, 8.38]],
    [[7], B(null, 6.99999, null, null), [[7, 12, 1]], 1, [7, 12]],
    [[7, 7, 7, 7, 7, 7, 7, 7], B(null, 7, null, null), [[7, 12, 8]], 8, [7, 12]],
    [[7, 9], B(null, 7.5, null, null), [[null, 7.5, 1], [7.5, 11.4, 1]], 1, [7.5, 11.4]],
    [[7, 8], B(null, 8, null, null), [[null, 8, 2], [8, 10, 0]], 2, [8, 10]],
    [D13, B(176.99, null, null, null), [[7, 89, 7], [89, 171, 5], [171, 176.99, 0], [176.99, null, 1]], 7, [7, 89, 171, 176.99]],
    [D11, B(116, null, null, null), [[7, 78, 6], [78, 116, 3], [116, null, 2]], 6, [7, 78, 116]],
    [D9, B(78, null, null, null), [[7, 78, 6], [78, null, 3]], 6, [7, 78]],
    [D7, B(7, null, null, null), [[7, 7, 1], [7, null, 6]], 6, [7, 7]],
    [D5, B(47, null, null, null), [[7, 41, 4], [41, 75, 1]], 4, [7, 41, 75]],
    [D3, B(8, null, null, null), [[7, 8, 1], [8, null, 2]], 2, [7, 8]],
    [[7, 9], B(8.9, null, null, null), [[7, 8.9, 1], [8.9, null, 1]], 1, [7, 8.9]],
    [[7], B(116, null, null, null), [[7, 12, 1]], 1, [7, 12]],
    [[7, 7, 7, 7, 7, 7, 7, 7], B(7.111111, null, null, null), [[7, 12, 8]], 8, [7, 12]],
    [[7, 8], B(8, null, null, null), [[7, 9, 2]], 2, [7, 9]],
    [D13, B(176.99, 7.1, null, null), [[null, 7.1, 1], [7.1, 89.1, 6], [89.1, 171.1, 5], [171.1, 176.99, 0], [176.99, null, 1]], 6, [7.1, 89.1, 171.1, 176.99]],
    [D11, B(116, 25, null, null), [[null, 25, 2], [25, 96, 5], [96, 116, 2], [116, null, 2]], 5, [25, 96, 116]],
    [D9, B(78, 78, null, null), [[null, 78, 6], [78, 78, 0], [78, null, 3]], 6, [78, 78]],
    [D7, B(7, 86.999, null, null), [[null, 86.999, 6], [86.999, 142.999, 1]], 6, [86.999, 142.999]],
    [D5, B(47, 7, null, null), [[7, 41, 4], [41, 75, 1]], 4, [7, 41, 75]],
    [D3, B(8, 30, null, null), [[null, 30, 2], [30, 62, 1]], 2, [30, 62]],
    [[7, 9], B(8.9, 7.4, null, null), [[null, 7.4, 1], [7.4, 8.9, 0], [8.9, null, 1]], 1, [7.4, 8.9]],
    [[7], B(6.999, 7.1111, null, null), [[7, 12, 1]], 1, [7, 12]],
    [[7, 7, 7, 7, 7, 7, 7, 7], B(7.0, 7.1111, null, null), [[7, 12, 8]], 8, [7, 12]],
    [D13, B(null, 7.1, null, 40), [[null, 7.1, 1], [7.1, 47.1, 4], [47.1, 87.1, 2], [87.1, 127.1, 4], [127.1, 167.1, 1], [167.1, 207.1, 1]], 4, [7.1, 47.1, 87.1, 127.1, 167.1, 207.1]],
    [D3, B(null, 20, null, 15), [[null, 20, 2], [20, 35, 1]], 2, [20, 35]],
    [[7, 18], B(null, 18, null, 110), [[null, 18, 2], [18, 128, 0]], 2, [18, 128]],
    [D13, B(null, 7, null, 50), [[7, 57, 5], [57, 107, 2], [107, 157, 5], [157, 207, 1]], 5, [7, 57, 107, 157, 207]],
    [D13, B(169.9, null, null, 40), [[7, 47, 5], [47, 87, 2], [87, 127, 4], [127, 167, 1], [167, 169.9, 0], [169.9, null, 1]], 5, [7, 47, 87, 127, 167, 169.9]],
    [D3, B(20, null, null, 8), [[7, 15, 2], [15, 20, 0], [20, null, 1]], 2, [7, 15, 20]],
    [[7, 18], B(7, null, null, 15), [[7, 7, 1], [7, null, 1]], 1, [7, 7]],
    [D13, B(177, null, null, 50), [[7, 57, 5], [57, 107, 2], [107, 157, 5], [157, 207, 1]], 5, [7, 57, 107, 157, 207]],
    [D13, B(176.9, 7.9, null, 70), [[null, 7.9, 1], [7.9, 77.9, 5], [77.9, 147.9, 5], [147.9, 176.9, 1], [176.9, null, 1]], 5, [7.9, 77.9, 147.9, 176.9]],
    [D3, B(20, 20, null, 10), [[null, 20, 2], [20, 20, 0], [20, null, 1]], 2, [20, 20]],
    [[7, 18], B(null, null, null, null), [[7, 29, 2]], 2, [7, 29]],
    [D13, B(177, 7, null, 50), [[7, 57, 5], [57, 107, 2], [107, 157, 5], [157, 207, 1]], 5, [7, 57, 107, 157, 207]],
    [D13, B(null, 7.1, 2, null), [[null, 7.1, 1], [7.1, 177, 12]], 12, [7.1, 177]],
    [[7, 9, 31, 31], B(null, 7.1, 1, null), [[null, 7.1, 1]], 1, [7.1]],
    [[7, 18], B(null, 18, 3, null), [[null, 18, 2], [18, 18, 0], [18, 18, 0]], 2, [18, 18, 18]],
    [D13, B(176.9, null, 2, null), [[7, 176.9, 12], [176.9, null, 1]], 12, [7, 176.9]],
    [D3, B(30.9, null, 1, null), [[30.9, null, 1]], 1, [7]],
    [[7, 18], B(7, null, 3, null), [[7, 7, 1], [7, 7, 0], [7, null, 1]], 1, [7, 7, 7]],
    [D13, B(169.9, 7.1, 1, null), [[null, 7.1, 1], [169.9, null, 12]], 12, [7.1, 169.9]],
    [D3, B(28, 28, 3, null), [[null, 28, 2], [28, 28, 0], [28, null, 1]], 2, [28, 28]],
    [[7, 18], B(17.5, 8.5, 2, null), [[null, 8.5, 1], [17.5, null, 1]], 1, [8.5, 17.5]],
    [D3, B(10, 8, 2, null), [[null, 8, 1], [10, null, 2]], 2, [8, 10]],
  ];

  const sameEdge = (got: number | null, want: number | null) => (want === null ? got === null : got !== null && close(got, want));

  it("oo:cell/spreadsheet-calculation/ChartsDrawTest.js#Test: Histogram binning calculations", () => {
    BINS.forEach(([data, opts, want], i) => {
      const got = binValues(data, opts).bins;
      expect(got.length, `binning case ${i}: ${JSON.stringify(got)}`).toBe(want.length);
      want.forEach(([a, b, n], k) => {
        const g = got[k];
        expect(sameEdge(g.min, a) && sameEdge(g.max, b) && g.count === n, `binning case ${i} bin ${k}: ${JSON.stringify(g)} vs ${[a, b, n]}`).toBe(true);
      });
    });
  });

  it("oo:cell/spreadsheet-calculation/ChartsDrawTest.js#Test: Histogram binning min and max and scale", () => {
    BINS.forEach(([data, opts, , max, scale], i) => {
      const got = binValues(data, opts);
      expect(got.valMax, `scale case ${i} max`).toBe(max);
      expect(got.valMin, `scale case ${i} min`).toBe(1);
      expectAllClose(got.scale, scale, `scale case ${i}`);
    });
  });
});

describe("ChartsDrawTest: drawing", () => {
  it("oo:cell/spreadsheet-calculation/ChartsDrawTest.js#Test: RoundValues function", () => {
    const rows: [number, boolean | undefined, number | undefined, number][] = [
      [105.965, undefined, undefined, 105.965],
      [105.965000000002, undefined, undefined, 105.965],
      [105.965000000002, true, 2, 106],
      [106.82, true, 2, 107],
      [106.823, false, 2, 106.82],
      [1.452369, true, 1, 1.5],
      [10536.236958, true, 1, 11000],
      [0.5623695865465845, undefined, undefined, 0.5623695865],
      [15262.1262653592, undefined, undefined, 15262.12626536],
      [15262.1262653592 / 0, undefined, undefined, 1],
      [-105.965000000002, undefined, undefined, -105.965],
      [-105.965000000002, true, 2, -106],
      [-106.82, true, 2, -107],
    ];
    for (const [v, sig, d, want] of rows) expectClose(roundValue(v, sig, d), want, `roundValue(${v}, ${sig}, ${d})`);
  });

  it("oo:cell/spreadsheet-calculation/ChartsDrawTest.js#Test: Base Charts Draw ", () => {
    // Two series over three years, one cell left empty. Every 2-D chart type
    // Grown draws lays the data out; stacked kinds add up, 100 % kinds reach 1.
    const rows = [
      ["", "2014", "2015", "2016"],
      ["Projected Revenue", 200, 240, 280],
      ["Estimated Costs", 250, 260, ""],
    ];
    const celldata: { r: number; c: number; v: unknown }[] = [];
    rows.forEach((row, r) => row.forEach((v, c) => v !== "" && celldata.push({ r, c, v: { v, m: String(v) } })));
    const wb = { getSheet: () => ({ id: "s" }), getAllSheets: () => [{ id: "s", celldata }] };
    const types: [ChartType, ChartConfig["stacking"]][] = [
      ["column", "none"], ["column", "stacked"], ["column", "percent"],
      ["bar", "none"], ["bar", "stacked"], ["bar", "percent"],
      ["line", "none"], ["line", "stacked"], ["line", "percent"],
      ["pie", "none"], ["doughnut", "none"], ["scatter", "none"],
      ["area", "none"], ["area", "stacked"], ["area", "percent"],
    ];
    for (const [type, stacking] of types) {
      const cfg: ChartConfig = {
        id: "c", type, title: "", range: { r0: 0, r1: 2, c0: 0, c1: 3 }, headerRow: true, labelCol: true, stacking, seriesInRows: true,
      };
      const input = buildChartInput(wb, cfg);
      expect(input.categories, type).toEqual(["2014", "2015", "2016"]);
      expect(input.series.map((s) => s.name), type).toEqual(["Projected Revenue", "Estimated Costs"]);
      const lay = layoutSeries(input, cfg);
      expect(lay.series.length, type).toBe(2);
      if (stacking === "stacked") expect(lay.series[1].top[1], `${type} stacked`).toBe(500);
      if (stacking === "percent") {
        expect(lay.series[1].top[0], `${type} percent`).toBeCloseTo(1);
        expect(lay.series[1].top[2], `${type} percent blank`).toBeCloseTo(1);
      }
      if (stacking === "none") expect(lay.series[1].top[1], type).toBe(260);
    }
  });
});
