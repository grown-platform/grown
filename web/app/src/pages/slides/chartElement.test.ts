import { describe, expect, it } from "vitest";
import {
  addChartCol,
  addChartRow,
  chartConfigOf,
  chartDataFromCache,
  chartInputOf,
  newChartElement,
  normalizeGrid,
  parseChartPaste,
  removeChartCol,
  removeChartRow,
  setChartCell,
  themeAccents,
} from "./chartElement";
import { findTheme, OFFICE_THEME } from "./theme";
import type { SlideChart } from "./model";

const chart = (data: string[][], extra: Partial<SlideChart> = {}): SlideChart => ({ type: "column", title: "", data, ...extra });

describe("chart data sheet", () => {
  it("new chart element carries sample data for its type", () => {
    const el = newChartElement("column");
    expect(el.type).toBe("chart");
    expect(el.chart!.data[0]).toEqual(["", "Series 1", "Series 2", "Series 3"]);
    expect(newChartElement("pie").chart!.data[0]).toEqual(["", "Sales"]);
    expect(newChartElement("waterfall").chart!.totals).toEqual([0, 5]);
  });

  it("normalizes ragged grids to rectangles of at least 2×2", () => {
    expect(normalizeGrid([["a"]])).toEqual([
      ["a", ""],
      ["", ""],
    ]);
    expect(normalizeGrid([["a", "b", "c"], ["d"]])).toEqual([
      ["a", "b", "c"],
      ["d", "", ""],
    ]);
  });

  it("sets cells, growing the grid by one row/column at the edge", () => {
    const g = setChartCell([["", "S1"], ["A", "1"]], 2, 2, "5");
    expect(g).toEqual([
      ["", "S1", ""],
      ["A", "1", ""],
      ["", "", "5"],
    ]);
  });

  it("adds and removes categories and series, keeping the header and one of each", () => {
    let g = [["", "S1"], ["A", "1"]];
    g = addChartRow(g);
    expect(g.length).toBe(3);
    expect(g[2][0]).toBe("Category 2");
    g = addChartCol(g);
    expect(g[0]).toEqual(["", "S1", "Series 2"]);
    g = removeChartCol(g, 1);
    expect(g[0]).toEqual(["", "Series 2"]);
    expect(removeChartCol(g, 1)[0]).toEqual(["", "Series 2"]); // last series stays
    g = removeChartRow(g, 1);
    expect(g.length).toBe(2);
    expect(removeChartRow(g, 1).length).toBe(2); // last category stays
    expect(removeChartRow(g, 0)).toEqual(g); // header row stays
  });

  it("parses pasted tab- or comma-separated data", () => {
    expect(parseChartPaste("\tA\tB\nx\t1\t2\ny\t3\t4\n")).toEqual([
      ["", "A", "B"],
      ["x", "1", "2"],
      ["y", "3", "4"],
    ]);
    expect(parseChartPaste("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("chart config and input (shared Sheets chart code)", () => {
  it("reads categories and numeric series from the grid", () => {
    const input = chartInputOf(chart([["", "North", "South"], ["Q1", "1", "2"], ["Q2", "3", "x"]]));
    expect(input.categories).toEqual(["Q1", "Q2"]);
    expect(input.series.map((s) => s.name)).toEqual(["North", "South"]);
    expect(input.series[0].values).toEqual([1, 3]);
    expect(input.series[1].values[1]).toBeNaN();
  });

  it("series in rows swap the roles of rows and columns", () => {
    const input = chartInputOf(chart([["", "Q1", "Q2"], ["North", "1", "2"], ["South", "3", "4"]], { seriesInRows: true }));
    expect(input.categories).toEqual(["Q1", "Q2"]);
    expect(input.series.map((s) => s.name)).toEqual(["North", "South"]);
    expect(input.series[1].values).toEqual([3, 4]);
  });

  it("the range covers the grid with a header row and label column", () => {
    const cfg = chartConfigOf(chart([["", "A", "B"], ["x", "1", "2"], ["y", "3", "4"]], { title: "T", stacking: "stacked" }));
    expect(cfg.range).toEqual({ r0: 0, c0: 0, r1: 2, c1: 2 });
    expect(cfg.headerRow && cfg.labelCol).toBe(true);
    expect(cfg.title).toBe("T");
    expect(cfg.stacking).toBe("stacked");
    expect((cfg as unknown as { data?: unknown }).data).toBeUndefined();
  });

  it("series colours follow the deck theme accents; explicit colours win", () => {
    const coral = findTheme("coral")!;
    const acc = themeAccents(coral);
    const cfg = chartConfigOf(chart([["", "A", "B"], ["x", "1", "2"]], { series: [{}, { color: "#123456" }] }), coral);
    expect(cfg.series![0].color!.toUpperCase()).toBe(`#${acc[0]}`);
    expect(cfg.series![1].color).toBe("#123456");
    // Office theme accent 1 by default.
    expect(chartConfigOf(chart([["", "A"], ["x", "1"]]), OFFICE_THEME).series![0].color!.toLowerCase()).toBe(OFFICE_THEME.colors.accent1.toLowerCase());
  });

  it("pie slices each take the next accent", () => {
    const cfg = chartConfigOf(chart([["", "S"], ["a", "1"], ["b", "2"], ["c", "3"]], { type: "pie" }), OFFICE_THEME);
    expect(cfg.series!.length).toBe(3);
    expect(new Set(cfg.series!.map((s) => s.color)).size).toBe(3);
  });

  it("rebuilds a data grid from cached chart values", () => {
    const g = chartDataFromCache({ categories: ["a", "b"], series: [{ name: "S1", values: [1, NaN] }, { name: "S2", values: [3, 4] }] });
    expect(g).toEqual([
      ["", "S1", "S2"],
      ["a", "1", "3"],
      ["b", "", "4"],
    ]);
  });
});
