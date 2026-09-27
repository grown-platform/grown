import { describe, expect, it } from "vitest";
import { axisFraction, axisScale, formatTick, niceStep } from "./chartAxis";
import { fitTrendline, movingAveragePoints, r2Label, trendlineEquation, trendlineName } from "./trendlines";
import { autoBinWidth, binLabel, binValues } from "./histogram";
import { layoutSeries, parseRangeText, pieShares, themeSeriesColor, waterfallBars } from "./chartData";
import { anchorAt, anchorRect, gridGeometry } from "./chartAnchor";
import { applyStructureOp, structureModelPatches } from "./formulaShift";

describe("axisScale", () => {
  it("starts at zero for positive data and keeps headroom", () => {
    const s = axisScale(0, 100);
    expect(s.min).toBe(0);
    expect(s.max).toBeGreaterThan(100);
    expect(s.ticks[0]).toBe(0);
    expect(s.ticks[s.ticks.length - 1]).toBe(s.max);
    expect([1, 2, 5].some((m) => Math.abs(s.major / Math.pow(10, Math.floor(Math.log10(s.major))) - m) < 1e-9)).toBe(true);
  });

  it("leaves zero out when the data sits far from it", () => {
    const s = axisScale(950, 1000);
    expect(s.min).toBeGreaterThan(0);
    expect(s.min).toBeLessThanOrEqual(950);
    expect(s.max).toBeGreaterThanOrEqual(1000);
  });

  it("spans negative data and honours fixed bounds and unit", () => {
    const s = axisScale(-35, 80);
    expect(s.min).toBeLessThanOrEqual(-35);
    expect(s.ticks).toContain(0);
    const f = axisScale(3, 7, { min: 0, max: 10, majorUnit: 2.5 });
    expect(f.ticks).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  it("uses powers of the base on a log axis", () => {
    const s = axisScale(3, 4200, { logBase: 10 });
    expect(s.ticks).toEqual([1, 10, 100, 1000, 10000]);
    expect(axisFraction(s, 100)).toBeCloseTo(0.5);
  });

  it("niceStep and tick text", () => {
    expect(niceStep(0.13)).toBe(0.2);
    expect(niceStep(37)).toBe(50);
    expect(formatTick(1200)).toBe("1,200");
    expect(formatTick(2500000)).toBe("2.5M");
  });
});

describe("trendline labels", () => {
  it("formats equations and R² like a spreadsheet", () => {
    const lin = fitTrendline([1, 2, 3, 4, 5, 6], [2, 1, 4, 3, 6, 5], { type: "linear" })!;
    expect(trendlineEquation(lin)).toBe("y = 0.8286x + 0.6");
    expect(r2Label(lin.r2)).toBe("R² = 0.6865");
    const poly = fitTrendline([1, 2, 3, 4, 5, 6, 7], [4, 6, 3, 7, 8, 9, 11], { type: "poly", order: 2 })!;
    expect(trendlineEquation(poly)).toBe("y = 0.1667x² - 0.1905x + 4.2857");
    const exp = fitTrendline([1, 2], [5, 15], { type: "exp" })!;
    expect(trendlineEquation(exp)).toBe("y = 1.6667e^1.0986x");
    expect(trendlineName({ type: "movingAvg", period: 3 }, "Sales")).toBe("3 per. Mov. Avg. (Sales)");
  });

  it("moving average over scatter points uses consecutive points", () => {
    expect(movingAveragePoints([3, 1, 2], [30, 10, 20], 2)).toEqual({ x: [2, 3], y: [15, 25] });
  });
});

describe("histogram helpers", () => {
  it("auto width and labels", () => {
    expect(autoBinWidth([7, 9])).toBe(3.9);
    const b = binValues([7, 9, 31, 31, 47, 75, 87, 115, 116, 119, 119, 155, 177], { underflow: 7.1, overflow: 176.99 });
    expect(binLabel(b.bins[0], 0)).toBe("≤7.1");
    expect(binLabel(b.bins[1], 1)).toBe("(7.1, 89.1]");
    expect(binLabel(b.bins[b.bins.length - 1], 9)).toBe(">176.99");
  });
});

describe("chart layout", () => {
  const input = {
    categories: ["a", "b"],
    series: [
      { name: "x", values: [10, -5] },
      { name: "y", values: [30, NaN] },
    ],
  };
  it("stacks positives and negatives separately", () => {
    const l = layoutSeries(input, { stacking: "stacked" });
    expect(l.series[1].base).toEqual([10, 0]);
    expect(l.series[1].top).toEqual([40, 0]);
    expect(l.min).toBe(-5);
    expect(l.max).toBe(40);
  });
  it("100 % stacks to one", () => {
    const l = layoutSeries(input, { stacking: "percent" });
    expect(l.series[1].top[0]).toBeCloseTo(1);
    expect(l.series[0].top[1]).toBeCloseTo(-1);
  });
  it("waterfall runs a total", () => {
    expect(waterfallBars([100, -30, 20, NaN], [3])).toEqual([
      { start: 0, end: 100, kind: "up" },
      { start: 100, end: 70, kind: "down" },
      { start: 70, end: 90, kind: "up" },
      { start: 0, end: 90, kind: "total" },
    ]);
  });
  it("pie shares ignore negatives", () => {
    expect(pieShares([1, 3, -2, NaN])).toEqual([0.25, 0.75, 0, 0]);
  });
  it("theme colours cycle accents, then shade them", () => {
    expect(themeSeriesColor(0)).toBe("#4472c4");
    expect(themeSeriesColor(1)).toBe("#ed7d31");
    expect(themeSeriesColor(6)).not.toBe(themeSeriesColor(0));
  });
  it("parses range text", () => {
    expect(parseRangeText("$B$2:D10")).toEqual({ r0: 1, r1: 9, c0: 1, c1: 3 });
    expect(parseRangeText("Sheet1!A1")).toEqual({ r0: 0, r1: 0, c0: 0, c1: 0 });
    expect(parseRangeText("nope")).toBeNull();
  });
});

describe("charts on the grid", () => {
  const sheets = () => [
    {
      id: "s1",
      name: "Data",
      celldata: [],
      grownCharts: [
        { id: "a", range: { r0: 0, r1: 4, c0: 0, c1: 2 }, anchor: { r: 2, c: 5, dx: 3, dy: 4, w: 400, h: 300 } },
        { id: "b", sheetId: "s2", range: { r0: 0, r1: 4, c0: 0, c1: 2 }, anchor: { r: 0, c: 0, dx: 0, dy: 0, w: 400, h: 300 } },
      ],
    },
    { id: "s2", name: "Other", celldata: [] },
  ];

  it("row inserts move the anchor and the range; other sheets' charts stay", () => {
    const next = applyStructureOp(sheets(), { kind: "insert", axis: "row", sheet: "Data", index: 1, count: 2 });
    const [a, b] = next[0].grownCharts;
    expect(a.range).toEqual({ r0: 0, r1: 6, c0: 0, c1: 2 });
    expect(a.anchor).toMatchObject({ r: 4, c: 5, dx: 3, dy: 4 });
    expect(b.range).toEqual({ r0: 0, r1: 4, c0: 0, c1: 2 });
  });

  it("column deletes under the anchor park it at the deletion", () => {
    const next = applyStructureOp(sheets(), { kind: "delete", axis: "col", sheet: "Data", index: 4, count: 3 });
    expect(next[0].grownCharts[0].anchor).toMatchObject({ c: 4, dx: 0 });
    expect(structureModelPatches(sheets(), { kind: "insert", axis: "col", sheet: "Data", index: 0, count: 1 })[0].fields.grownCharts).toBeDefined();
  });

  it("anchor ↔ pixels follow FortuneSheet's grid", () => {
    const g = gridGeometry({ config: { columnlen: { 1: 100 }, rowhidden: { 0: 0 } } });
    expect(g.colLeft(2)).toBe(74 + 101);
    expect(g.rowTop(2)).toBe(20);
    const a = { r: 2, c: 2, dx: 5, dy: 6, w: 300, h: 200 };
    const box = anchorRect(a, g);
    expect(box).toEqual({ left: 180, top: 26, width: 300, height: 200 });
    expect(anchorAt(box.left, box.top, 300, 200, g)).toEqual(a);
    const z = gridGeometry({}, 2);
    expect(anchorRect(a, z).width).toBe(600);
  });
});
