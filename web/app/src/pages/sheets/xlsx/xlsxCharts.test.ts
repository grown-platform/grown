/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet workbooks are loosely typed. */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { workbookToXlsx } from "./xlsxWrite";
import { readXlsx } from "./xlsxRead";
import { GROWN_CHART_URI, parseChartRef, readChartSpace } from "./xlsxCharts";
import { parseXml } from "./ooxml";
import type { ChartConfig } from "../chartData";

const rows = [
  ["Month", "Revenue", "Costs"],
  ["Jan", 120, 80],
  ["Feb", 150, 90],
  ["Mar", 170, 120],
  ["Apr", 160, 110],
];

function workbook(charts: ChartConfig[]): any[] {
  const celldata: any[] = [];
  rows.forEach((row, r) => row.forEach((v, c) => celldata.push({ r, c, v: { v, m: String(v) } })));
  return [
    { name: "Data sheet", id: "s1", order: 0, celldata, grownCharts: charts },
    { name: "Other", id: "s2", order: 1, celldata: [{ r: 0, c: 0, v: { v: 5, m: "5" } }] },
  ];
}

const base = { title: "Sales", range: { r0: 0, r1: 4, c0: 0, c1: 2 }, headerRow: true, labelCol: true, sheetId: "s1" };
const CHARTS: ChartConfig[] = [
  { ...base, id: "a", type: "column", stacking: "stacked", legend: "right", anchor: { r: 1, c: 4, dx: 5, dy: 6, w: 400, h: 250 }, series: [{ color: "#112233", trendline: { type: "poly", order: 3, showEquation: true } }] },
  { ...base, id: "b", type: "combo", series: [{ type: "column" }, { type: "line", secondary: true }], y2Axis: { title: "Costs", numFmt: "$#,##0" }, anchor: { r: 10, c: 4, dx: 0, dy: 0, w: 480, h: 300 } },
  { ...base, id: "c", type: "scatter", scatterLines: true, labelCol: false, range: { r0: 0, r1: 4, c0: 1, c1: 2 }, yAxis: { min: 0, max: 200, majorUnit: 50, logBase: null }, anchor: { r: 20, c: 4, dx: 0, dy: 0, w: 480, h: 300 } },
  { ...base, id: "d", type: "doughnut", holeSize: 0.6, dataLabels: true, range: { r0: 0, r1: 4, c0: 0, c1: 1 }, anchor: { r: 30, c: 4, dx: 0, dy: 0, w: 360, h: 300 } },
  { ...base, id: "e", type: "histogram", histogram: { binSize: 20, overflow: 160 }, range: { r0: 0, r1: 4, c0: 1, c1: 1 }, labelCol: false, anchor: { r: 40, c: 4, dx: 0, dy: 0, w: 360, h: 300 } },
];

async function parts(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const get = async (p: string) => (await zip.file(p)?.async("string")) ?? "";
  return { zip, get };
}

describe("xlsx charts", () => {
  it("writes a drawing and one well-formed chart part per chart", async () => {
    const { zip, get } = await parts(await workbookToXlsx(workbook(CHARTS)));
    const sheet1 = await get("xl/worksheets/sheet1.xml");
    expect(sheet1).toMatch(/<drawing r:id="rId\d+"\/>/);
    expect(await get("xl/worksheets/_rels/sheet1.xml.rels")).toContain("../drawings/drawing1.xml");
    expect(await get("[Content_Types].xml")).toContain("/xl/charts/chart5.xml");
    const drawing = await get("xl/drawings/drawing1.xml");
    expect((drawing.match(/<xdr:oneCellAnchor>/g) ?? []).length).toBe(5);
    expect(drawing).toContain("<xdr:col>4</xdr:col><xdr:colOff>47625</xdr:colOff><xdr:row>1</xdr:row>");
    for (let i = 1; i <= 5; i++) {
      const xml = await get(`xl/charts/chart${i}.xml`);
      const doc = parseXml(xml);
      expect(doc.getElementsByTagName("parsererror").length, `chart${i}`).toBe(0);
    }
    const c1 = await get("xl/charts/chart1.xml");
    expect(c1).toContain('<c:barDir val="col"/><c:grouping val="stacked"/>');
    expect(c1).toContain("<c:f>'Data sheet'!$B$2:$B$5</c:f>");
    expect(c1).toContain('<c:trendlineType val="poly"/><c:order val="3"/>');
    const c2 = await get("xl/charts/chart2.xml");
    expect(c2).toContain("<c:lineChart>");
    expect(c2).toContain('<c:crosses val="max"/>');
    expect(await get("xl/charts/chart3.xml")).toContain("<c:yVal>");
    expect(await get("xl/charts/chart4.xml")).toContain('<c:holeSize val="60"/>');
    expect(zip.file("xl/drawings/drawing2.xml")).toBeNull();
  });

  it("reads Grown's charts back exactly", async () => {
    const imp = await readXlsx(await workbookToXlsx(workbook(CHARTS)), { idPrefix: "x" });
    const got = imp.sheets[0].grownCharts as ChartConfig[];
    expect(got).toHaveLength(5);
    got.forEach((g, i) => {
      const want = CHARTS[i];
      expect(g.sheetId).toBe("x-0");
      expect(g.anchor).toEqual(want.anchor);
      expect({ ...g, id: want.id, sheetId: want.sheetId }).toEqual(want);
    });
    expect(imp.warnings.filter((w) => /chart/i.test(w))).toEqual([]);
  });

  it("rebuilds a chart written by another application from its XML", async () => {
    const { zip, get } = await parts(await workbookToXlsx(workbook(CHARTS)));
    for (let i = 1; i <= 5; i++) {
      const xml = (await get(`xl/charts/chart${i}.xml`)).replace(/<c:extLst>.*<\/c:extLst>/, "");
      zip.file(`xl/charts/chart${i}.xml`, xml);
    }
    const imp = await readXlsx(await zip.generateAsync({ type: "uint8array" }), { idPrefix: "y" });
    const got = imp.sheets[0].grownCharts as ChartConfig[];
    expect(got.map((c) => c.type)).toEqual(["column", "combo", "scatter", "doughnut", "column"]);
    expect(got[0]).toMatchObject({ title: "Sales", range: base.range, headerRow: true, labelCol: true, stacking: "stacked", legend: "right" });
    expect(got[0].series?.[0]).toMatchObject({ color: "#112233", trendline: { type: "poly", order: 3, showEquation: true } });
    expect(got[1].series?.[1]).toMatchObject({ type: "line", secondary: true });
    expect(got[1].y2Axis).toMatchObject({ title: "Costs", numFmt: "$#,##0" });
    expect(got[2]).toMatchObject({ scatterLines: true, range: { r0: 0, r1: 4, c0: 1, c1: 2 }, yAxis: { min: 0, max: 200, majorUnit: 50 } });
    expect(got[3]).toMatchObject({ holeSize: 0.6, range: { r0: 0, r1: 4, c0: 0, c1: 1 } });
    expect(got[0].anchor).toEqual(CHARTS[0].anchor);
  });

  it("parses references and reads a series-in-rows chart", () => {
    expect(parseChartRef("'It''s'!$A$1:$C$1")).toEqual({ sheet: "It's", range: { r0: 0, r1: 0, c0: 0, c1: 2 } });
    const xml = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea>
      <c:lineChart><c:grouping val="standard"/>
        <c:ser><c:tx><c:strRef><c:f>S!$A$2</c:f></c:strRef></c:tx><c:cat><c:strRef><c:f>S!$B$1:$D$1</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>S!$B$2:$D$2</c:f></c:numRef></c:val></c:ser>
        <c:ser><c:tx><c:strRef><c:f>S!$A$3</c:f></c:strRef></c:tx><c:cat><c:strRef><c:f>S!$B$1:$D$1</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>S!$B$3:$D$3</c:f></c:numRef></c:val></c:ser>
      </c:lineChart></c:plotArea></c:chart></c:chartSpace>`;
    const got = readChartSpace(parseXml(xml))!;
    expect(got.sheet).toBe("S");
    expect(got.cfg).toMatchObject({ type: "line", seriesInRows: true, headerRow: true, labelCol: true, range: { r0: 0, r1: 2, c0: 0, c1: 3 }, legend: "none" });
    expect(GROWN_CHART_URI).toMatch(/^\{[0-9A-F-]+\}$/);
  });
});
