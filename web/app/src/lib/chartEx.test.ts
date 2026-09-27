import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { chartExToGrown, chartExXml, grownToChartEx, parseChartEx, type ChartEx } from "./chartEx";
import { deckToPptx } from "../pages/slides/pptx/write";
import { readPptx } from "../pages/slides/pptx/read";

// OnlyOffice's chartEx suite serialises a schema-generated cx:chartSpace
// and compares the text it writes with the text it read (ignoring
// whitespace and quote style). Grown's fixtures are written here.

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CX = "http://schemas.microsoft.com/office/drawing/2014/chartex";

/** A waterfall + a histogram-with-pareto document, every modelled element used. */
const DOC =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<cx:chartSpace xmlns:a="${A}" xmlns:r="${R}" xmlns:cx="${CX}">` +
  `<cx:chartData>` +
  `<cx:externalData r:id="rId1" autoUpdate="0"/>` +
  `<cx:data id="0">` +
  `<cx:strDim type="cat"><cx:f dir="col">Sheet1!$A$2:$A$5</cx:f><cx:lvl ptCount="4"><cx:pt idx="0">Start</cx:pt><cx:pt idx="1">Sales &amp; fees</cx:pt><cx:pt idx="2">Costs</cx:pt><cx:pt idx="3">End</cx:pt></cx:lvl></cx:strDim>` +
  `<cx:numDim type="val"><cx:f>Sheet1!$B$2:$B$5</cx:f><cx:nf>Sheet1!$B$1</cx:nf><cx:lvl ptCount="4" formatCode="General" name="Cash"><cx:pt idx="0">100</cx:pt><cx:pt idx="1">43401800000000.2</cx:pt><cx:pt idx="2">-31.5</cx:pt><cx:pt idx="3">112</cx:pt></cx:lvl></cx:numDim>` +
  `</cx:data>` +
  `<cx:data id="1"><cx:numDim type="val"><cx:lvl ptCount="6" formatCode="0.0"><cx:pt idx="0">1</cx:pt><cx:pt idx="1">2.5</cx:pt><cx:pt idx="2">2.5</cx:pt><cx:pt idx="3">4</cx:pt><cx:pt idx="4">9</cx:pt><cx:pt idx="5">12</cx:pt></cx:lvl></cx:numDim></cx:data>` +
  `</cx:chartData>` +
  `<cx:chart>` +
  `<cx:title pos="t" align="ctr" overlay="0"><cx:tx><cx:rich><a:bodyPr/><a:p><a:r><a:t>Cash flow</a:t></a:r></a:p></cx:rich></cx:tx></cx:title>` +
  `<cx:plotArea><cx:plotAreaRegion>` +
  `<cx:series layoutId="waterfall" uniqueId="{A1}" formatIdx="0"><cx:tx><cx:txData><cx:f>Sheet1!$B$1</cx:f><cx:v>Cash</cx:v></cx:txData></cx:tx>` +
  `<cx:dataLabels pos="outEnd"><cx:visibility seriesName="0" categoryName="0" value="1"/></cx:dataLabels>` +
  `<cx:dataId val="0"/><cx:layoutPr><cx:visibility connectorLines="1"/><cx:subtotals><cx:idx val="0"/><cx:idx val="3"/></cx:subtotals></cx:layoutPr></cx:series>` +
  `<cx:series layoutId="clusteredColumn" hidden="1" uniqueId="{A2}" formatIdx="1"><cx:dataId val="1"/><cx:layoutPr><cx:binning intervalClosed="l" underflow="auto" overflow="10"><cx:binCount val="3"/></cx:binning></cx:layoutPr><cx:axisId val="0"/><cx:axisId val="1"/></cx:series>` +
  `<cx:series layoutId="paretoLine" ownerIdx="1" uniqueId="{A3}" formatIdx="2"><cx:axisId val="2"/></cx:series>` +
  `</cx:plotAreaRegion>` +
  `<cx:axis id="0"><cx:catScaling gapWidth="0.5"/><cx:tickLabels/></cx:axis>` +
  `<cx:axis id="1"><cx:valScaling max="150" min="auto" majorUnit="25"/><cx:title><cx:tx><cx:rich><a:bodyPr/><a:p><a:r><a:t>USD</a:t></a:r></a:p></cx:rich></cx:tx></cx:title><cx:majorGridlines/><cx:tickLabels/><cx:numFmt formatCode="#,##0" sourceLinked="0"/></cx:axis>` +
  `<cx:axis id="2" hidden="1"><cx:valScaling max="1" min="0"/><cx:tickLabels/></cx:axis>` +
  `</cx:plotArea>` +
  `<cx:legend pos="b" align="ctr" overlay="0"/>` +
  `</cx:chart>` +
  `</cx:chartSpace>`;

/** The OnlyOffice comparison's normalisation: no whitespace between tags, one quote style. */
const canon = (s: string) => s.replace(/>\s+</g, "><").replace(/'/g, '"').trim();

describe("chartEx serialize", () => {
  it("oo:common/charts/chartEx-serialize.js#Compare 1xml", () => {
    const m = parseChartEx(DOC)!;
    expect(m).not.toBeNull();
    // What was read…
    expect(m.data).toHaveLength(2);
    expect(m.data[0].dims.map((d) => `${d.kind}:${d.type}`)).toEqual(["str:cat", "num:val"]);
    expect(m.data[0].dims[1].levels[0].pts[1].v).toBe("43401800000000.2"); // kept exactly
    expect(m.series.map((s) => s.layoutId)).toEqual(["waterfall", "clusteredColumn", "paretoLine"]);
    expect(m.series[0].layoutPr?.subtotals).toEqual([0, 3]);
    expect(m.series[1].layoutPr?.binning).toEqual({ intervalClosed: "l", underflow: "auto", overflow: "10", binCount: 3 });
    expect(m.axes[1]).toMatchObject({ id: 1, title: "USD", scaling: { kind: "val", max: "150", min: "auto", majorUnit: "25" } });
    // …is written back as the same text.
    expect(canon(chartExXml(m))).toBe(canon(DOC));
  });

  it("oo:common/charts/chartEx-serialize.js#Compare 1xml ignoring quotes and line breaks", () => {
    const loose = DOC.replace(/"/g, "'").replace(/></g, ">\n\t<");
    const m = parseChartEx(loose)!;
    expect(m).toEqual(parseChartEx(DOC));
    expect(canon(chartExXml(m))).toBe(canon(DOC));
  });

  it("oo:common/charts/chartEx-serialize.js#Class for parse not found", () => {
    // A classic chart part or any other root is not a chartEx chart space.
    expect(parseChartEx(`<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>`)).toBeNull();
    expect(parseChartEx(`<cx:chart xmlns:cx="${CX}"/>`)).toBeNull();
  });

  it("oo:common/charts/chartEx-serialize.js#rootTagNameMatchResult is false", () => {
    expect(parseChartEx("")).toBeNull();
    expect(parseChartEx("not xml at all")).toBeNull();
    expect(parseChartEx("<cx:chartSpace")).toBeNull();
  });

  it("oo:common/charts/chartEx-serialize.js#File serialize use parse compare", () => {
    // Grown → chartEx → text → chartEx → Grown, for the native chartEx types.
    const waterfall = { type: "waterfall" as const, title: "Bridge", categories: ["Start", "Up", "Down", "End"], series: [{ name: "Cash", values: [10, 4, -3, 11] }], totals: [0, 3], legend: "none" as const, dataLabels: true };
    const histogram = { type: "histogram" as const, title: "", categories: ["1", "2", "3", "4", "5"], series: [{ name: "Ages", values: [3, 7, 8, 12, 30] }], histogram: { binSize: 5, underflow: 5, overflow: 25, closed: "left" as const }, legend: "none" as const };
    for (const g of [waterfall, histogram]) {
      const m: ChartEx = grownToChartEx(g);
      const text = chartExXml(m);
      const again = parseChartEx(text)!;
      expect(again).toEqual(m);
      expect(chartExXml(again)).toBe(text);
      expect(chartExToGrown(again)).toEqual(g);
    }
    // The document above becomes a Grown waterfall (the hidden histogram and
    // its pareto line are not drawn).
    expect(chartExToGrown(parseChartEx(DOC)!)).toEqual({
      type: "waterfall",
      title: "Cash flow",
      categories: ["Start", "Sales & fees", "Costs", "End"],
      series: [{ name: "Cash", values: [100, 43401800000000.2, -31.5, 112] }],
      totals: [0, 3],
      legend: "bottom",
      dataLabels: true,
    });
  });

  it("oo:common/charts/chartEx-serialize.js#Test api.OpenDocumentFromZip", async () => {
    // A pptx whose slide holds a chartEx frame (mc:Choice) with a picture-less
    // fallback shape: the slide importer reads the chart, not the fallback.
    const bytes = await deckToPptx({ slides: [{ id: "s", background: "#ffffff", elements: [] }] });
    const zip = await JSZip.loadAsync(bytes);
    const slidePath = "ppt/slides/slide1.xml";
    const relsPath = "ppt/slides/_rels/slide1.xml.rels";
    const frame = (rid: string) =>
      `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">` +
      `<mc:Choice xmlns:cx1="http://schemas.microsoft.com/office/drawing/2015/9/8/chartex" Requires="cx1">` +
      `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="90" name="Chart 1" descr="Cash bridge"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
      `<p:xfrm><a:off x="914400" y="914400"/><a:ext cx="4572000" cy="2743200"/></p:xfrm>` +
      `<a:graphic><a:graphicData uri="${CX}"><cx:chart xmlns:cx="${CX}" r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>` +
      `</mc:Choice><mc:Fallback>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="91" name="Fallback"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="4572000" cy="2743200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="CCCCCC"/></a:solidFill></p:spPr></p:sp>` +
      `</mc:Fallback></mc:AlternateContent>`;
    const slide = (await zip.file(slidePath)!.async("string")).replace("</p:spTree>", frame("rIdCx1") + "</p:spTree>");
    zip.file(slidePath, slide);
    const rels = (await zip.file(relsPath)!.async("string")).replace(
      "</Relationships>",
      `<Relationship Id="rIdCx1" Type="http://schemas.microsoft.com/office/2014/relationships/chartEx" Target="../charts/chartEx1.xml"/></Relationships>`,
    );
    zip.file(relsPath, rels);
    zip.file("ppt/charts/chartEx1.xml", DOC);
    const { deck } = await readPptx(await zip.generateAsync({ type: "uint8array" }));
    const els = deck.slides[0].elements;
    expect(els).toHaveLength(1);
    expect(els[0].type).toBe("chart");
    expect(els[0].alt).toBe("Cash bridge");
    expect(els[0].chart).toMatchObject({
      type: "waterfall",
      title: "Cash flow",
      totals: [0, 3],
      data: [
        ["", "Cash"],
        ["Start", "100"],
        ["Sales & fees", "43401800000000.2"],
        ["Costs", "-31.5"],
        ["End", "112"],
      ],
    });

    // Without a readable chart part the fallback is drawn instead.
    zip.remove("ppt/charts/chartEx1.xml");
    const { deck: fb } = await readPptx(await zip.generateAsync({ type: "uint8array" }));
    expect(fb.slides[0].elements.map((e) => e.type)).toEqual(["rect"]);
  });
});
