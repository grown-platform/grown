import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChartRenderer } from "./ChartRenderer";
import type { ChartConfig, ChartInput, ChartType } from "./chartData";
import { sparklineFormulas } from "./sparklines";

const input: ChartInput = {
  categories: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
  series: [
    { name: "Revenue", values: [120, 150, 170, 160, 210, 240] },
    { name: "Margin", values: [0.2, 0.22, 0.25, 0.21, 0.28, 0.3] },
  ],
  xValues: [1, 2, 3, 4, 5, 6],
};
const cfg = (over: Partial<ChartConfig>): ChartConfig => ({
  id: "c",
  type: "column",
  title: "T",
  range: { r0: 0, r1: 6, c0: 0, c1: 2 },
  headerRow: true,
  labelCol: true,
  ...over,
});
const count = (html: string, mark: string) => html.split(`data-mark="${mark}"`).length - 1;

describe("ChartRenderer", () => {
  it.each<[ChartType, string]>([
    ["column", "bar"],
    ["bar", "bar"],
    ["line", "line"],
    ["area", "area"],
    ["pie", "slice"],
    ["doughnut", "slice"],
    ["scatter", "point"],
    ["histogram", "bar"],
    ["waterfall", "bar"],
  ])("%s draws %s marks", (type, mark) => {
    const html = renderToStaticMarkup(<ChartRenderer config={cfg({ type })} input={input} />);
    expect(count(html, mark)).toBeGreaterThan(0);
  });

  it("combo: columns + line on a secondary axis, with a trendline and its equation", () => {
    const html = renderToStaticMarkup(
      <ChartRenderer
        config={cfg({
          type: "combo",
          series: [{ type: "column", trendline: { type: "linear", showEquation: true, showR2: true } }, { type: "line", secondary: true }],
          y2Axis: { numFmt: "0%" },
        })}
        input={input}
      />,
    );
    expect(count(html, "bar")).toBe(6);
    expect(count(html, "line")).toBe(1);
    expect(count(html, "trendline")).toBe(1);
    expect(html).toContain("R² = ");
    expect(html).toContain("30%");
    expect(html).toContain("Linear (Revenue)");
  });

  it("legend position and data labels", () => {
    const html = renderToStaticMarkup(<ChartRenderer config={cfg({ legend: "right", dataLabels: true })} input={input} />);
    expect(html).toContain('data-legend="right"');
    expect(html).toContain(">240<");
    expect(renderToStaticMarkup(<ChartRenderer config={cfg({ legend: "none" })} input={input} />)).not.toContain("data-legend");
  });
});

describe("sparkline groups", () => {
  it("one formula per data row into a column", () => {
    const f = sparklineFormulas({ id: "g", data: { r0: 1, r1: 2, c0: 1, c1: 4 }, location: { r0: 1, r1: 2, c0: 5, c1: 5 }, type: "column" });
    expect(f).toEqual([
      { r: 1, c: 5, f: '=SPARKLINE(B2:E2,{"charttype","column"})' },
      { r: 2, c: 5, f: '=SPARKLINE(B3:E3,{"charttype","column"})' },
    ]);
  });
  it("rejects a mismatched or overlapping location", () => {
    expect(sparklineFormulas({ id: "g", data: { r0: 0, r1: 2, c0: 0, c1: 2 }, location: { r0: 0, r1: 1, c0: 4, c1: 4 }, type: "line" })).toHaveProperty("error");
    expect(sparklineFormulas({ id: "g", data: { r0: 0, r1: 2, c0: 0, c1: 2 }, location: { r0: 0, r1: 2, c0: 2, c1: 2 }, type: "line" })).toHaveProperty("error");
  });
});
