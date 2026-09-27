import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { deckToPptx } from "./write";
import { readPptx } from "./read";
import type { DeckDoc, SlideElement } from "../model";
import { newChartElement } from "../chartElement";
import { newDiagram } from "../diagrams";
import { findTheme, OFFICE_THEME } from "../theme";
import { readSlideChart, srgbXml, wordArtRunXml } from "./objectsXml";

// M11 objects through pptx: charts (graphic frame + chart part + embedded
// workbook), video/audio (p:pic with a:videoFile/a:audioFile), word art
// (run effects + warp), diagrams (groups), and SmartArt's drawing fallback.

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const MP4 = "data:video/mp4;base64," + btoa("\u0000\u0000\u0000\u0018ftypisom\u0000\u0000\u0002\u0000isomiso2");

const deckOf = (els: SlideElement[], extra: Partial<DeckDoc> = {}): DeckDoc => ({ slides: [{ id: "s1", background: "#ffffff", elements: els }], ...extra });

async function pkg(els: SlideElement[], extra: Partial<DeckDoc> = {}) {
  return JSZip.loadAsync(await deckToPptx(deckOf(els, extra)));
}
async function roundTrip(els: SlideElement[], extra: Partial<DeckDoc> = {}): Promise<SlideElement[]> {
  const r = await readPptx(await deckToPptx(deckOf(els, extra)));
  return r.deck.slides[0].elements;
}

describe("charts in pptx", () => {
  const chartEl = (): SlideElement => ({
    ...newChartElement("column", { x: 96, y: 48 }),
    id: "c1",
    chart: {
      type: "column",
      title: "Sales & costs",
      stacking: "stacked",
      legend: "right",
      dataLabels: true,
      data: [
        ["", "North", "South"],
        ["Q1", "1.5", "2"],
        ["Q2", "3", ""],
      ],
    },
  });

  it("writes a graphic frame, a chart part with cached values, and an embedded workbook", async () => {
    const zip = await pkg([chartEl()]);
    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide).toMatch(/<p:graphicFrame>[\s\S]*<a:graphicData uri="http:\/\/schemas\.openxmlformats\.org\/drawingml\/2006\/chart"><c:chart [^>]*r:id="rId\d+"/);
    expect(slide).not.toContain("grown-el:");
    const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    expect(rels).toMatch(/relationships\/chart" Target="\.\.\/charts\/chart1\.xml"/);
    const chart = await zip.file("ppt/charts/chart1.xml")!.async("string");
    expect(chart).toContain("<c:barChart>");
    expect(chart).toContain('<c:grouping val="stacked"/>');
    expect(chart).toContain("<c:f>Sheet1!$B$1</c:f><c:strCache>");
    expect(chart).toMatch(/<c:numCache><c:formatCode>General<\/c:formatCode><c:ptCount val="2"\/><c:pt idx="0"><c:v>1\.5<\/c:v><\/c:pt><c:pt idx="1"><c:v>3<\/c:v><\/c:pt><\/c:numCache>/);
    // The blank South/Q2 point is left out of the cache.
    expect(chart).toMatch(/<c:ptCount val="2"\/><c:pt idx="0"><c:v>2<\/c:v><\/c:pt><\/c:numCache>/);
    expect(chart).toContain('<c:externalData r:id="rId1">');
    // Series colours are the deck theme's accents.
    expect(chart).toContain(`<a:srgbClr val="${OFFICE_THEME.colors.accent1.replace("#", "").toUpperCase()}"/>`);
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    expect(ct).toContain('PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"');
    expect(ct).toMatch(/Extension="xlsx"/);
    const book = await JSZip.loadAsync(await zip.file("ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx")!.async("uint8array"));
    const sheet = await book.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheet).toContain('<c r="B2"><v>1.5</v></c>');
  });

  it("round-trips the chart exactly through Grown's extension entry", async () => {
    const [back] = await roundTrip([chartEl()]);
    expect(back.type).toBe("chart");
    expect({ x: back.x, y: back.y, w: back.w, h: back.h }).toEqual({ x: 96, y: 48, w: 480, h: 300 });
    expect(back.chart).toEqual(chartEl().chart);
  });

  it("follows the deck theme: colours are not pinned on import", async () => {
    const coral = findTheme("coral")!;
    const zip = await pkg([chartEl()], { theme: coral });
    const chart = await zip.file("ppt/charts/chart1.xml")!.async("string");
    expect(chart).toContain(`<a:srgbClr val="${coral.colors.accent1.replace("#", "").toUpperCase()}"/>`);
    const [back] = await roundTrip([chartEl()], { theme: coral });
    expect(back.chart!.series).toBeUndefined();
  });

  it("reads a foreign chart from its XML and cached values", async () => {
    const zip = await pkg([chartEl()]);
    let xml = await zip.file("ppt/charts/chart1.xml")!.async("string");
    xml = xml.replace(/<c:extLst>[\s\S]*<\/c:extLst>/, "");
    const chart = readSlideChart(new DOMParser().parseFromString(xml, "application/xml"))!;
    expect(chart.type).toBe("column");
    expect(chart.title).toBe("Sales & costs");
    expect(chart.stacking).toBe("stacked");
    expect(chart.legend).toBe("right");
    expect(chart.data).toEqual([
      ["", "North", "South"],
      ["Q1", "1.5", "2"],
      ["Q2", "3", ""],
    ]);
  });

  it("pie, line and scatter survive a double round trip; charts keep rotation", async () => {
    const els: SlideElement[] = [
      { ...newChartElement("pie"), id: "a", rotation: 10 },
      { ...newChartElement("line"), id: "b", y: 10 },
      { ...newChartElement("scatter"), id: "c", y: 20 },
    ];
    const once = await roundTrip(els);
    const twice = (await readPptx(await deckToPptx(deckOf(once)))).deck.slides[0].elements;
    expect(twice.map((e) => e.chart!.type)).toEqual(["pie", "line", "scatter"]);
    expect(twice[0].rotation).toBe(10);
    expect(twice.map((e) => e.chart!.data)).toEqual(els.map((e) => e.chart!.data));
  });
});

describe("media in pptx", () => {
  const video = (over: Partial<SlideElement["media"]> = {}): SlideElement => ({
    id: "v",
    type: "media",
    x: 240,
    y: 120,
    w: 480,
    h: 270,
    media: { kind: "video", src: MP4, mime: "video/mp4", poster: PNG_1PX, autoplay: true, loop: true, ...over },
  });

  it("embeds an uploaded clip with its poster and playback options", async () => {
    const zip = await pkg([video()]);
    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide).toMatch(/<a:videoFile r:link="rId\d+"\/>/);
    expect(slide).toContain("p14:media");
    expect(slide).toContain('autoplay="1"');
    expect(slide).toContain('loop="1"');
    expect(Object.keys(zip.files).some((f) => /^ppt\/media\/.*\.mp4$/.test(f))).toBe(true);
    const [back] = await roundTrip([video()]);
    expect(back.type).toBe("media");
    expect(back.media).toMatchObject({ kind: "video", mime: "video/mp4", autoplay: true, loop: true });
    expect(back.media!.src).toBe(MP4);
    expect(back.media!.poster).toMatch(/^data:image\/png;base64,/);
    expect({ x: back.x, y: back.y, w: back.w, h: back.h }).toEqual({ x: 240, y: 120, w: 480, h: 270 });
  });

  it("links a YouTube clip and recovers the player", async () => {
    const yt = video({ src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", embed: { provider: "youtube", id: "dQw4w9WgXcQ" }, mime: undefined, autoplay: undefined, loop: undefined });
    const zip = await pkg([yt]);
    const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    expect(rels).toMatch(/Target="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ" TargetMode="External"/);
    const [back] = await roundTrip([yt]);
    expect(back.media).toMatchObject({ kind: "video", src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", embed: { provider: "youtube", id: "dQw4w9WgXcQ" } });
    expect(back.media!.autoplay).toBeUndefined();
  });

  it("writes audio as a:audioFile (embedded and linked)", async () => {
    const mp3 = "data:audio/mpeg;base64," + btoa("ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000");
    const els: SlideElement[] = [
      { id: "a1", type: "media", x: 0, y: 0, w: 96, h: 96, media: { kind: "audio", src: mp3, mime: "audio/mpeg" } },
      { id: "a2", type: "media", x: 100, y: 0, w: 96, h: 96, media: { kind: "audio", src: "https://example.com/a.mp3", mime: "audio/mpeg", loop: true } },
    ];
    const zip = await pkg(els);
    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect((slide.match(/<a:audioFile r:link="rId\d+"\/>/g) ?? []).length).toBe(2);
    expect(slide).not.toContain("a:videoFile");
    const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    expect(rels).toMatch(/relationships\/audio" Target="https:\/\/example\.com\/a\.mp3" TargetMode="External"/);
    const back = await roundTrip(els);
    expect(back.map((e) => e.media!.kind)).toEqual(["audio", "audio"]);
    expect(back[0].media!.src).toBe(mp3);
    expect(back[1].media).toMatchObject({ src: "https://example.com/a.mp3", loop: true });
  });
});

describe("word art in pptx", () => {
  const art = (): SlideElement => ({
    id: "t",
    type: "text",
    x: 100,
    y: 100,
    w: 600,
    h: 200,
    text: "Hello",
    fontSize: 48,
    fontFamily: "Arial",
    bold: true,
    color: "#ff0000",
    align: "center",
    valign: "middle",
    wordArt: {
      outline: { color: "#112233", width: 2 },
      gradient: { from: "#ff0000", to: "#0000ff", angle: 90 },
      shadow: { color: "#00000080", blur: 4, dist: 3, dir: 45 },
      glow: { color: "#ffff00", radius: 6 },
      warp: "textArchUp",
    },
  });

  it("writes run ln, gradFill, effectLst and the body warp in schema order", async () => {
    const zip = await pkg([art()]);
    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide).toContain('<a:prstTxWarp prst="textArchUp"><a:avLst/></a:prstTxWarp>');
    expect(slide).toMatch(/<a:rPr [^>]*><a:ln w="19050"><a:solidFill><a:srgbClr val="112233"\/><\/a:solidFill><\/a:ln><a:gradFill[^>]*><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"\/><\/a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"\/><\/a:gs><\/a:gsLst><a:lin ang="5400000" scaled="0"\/><\/a:gradFill><a:effectLst><a:glow rad="57150">/);
    expect(slide).toMatch(/<a:outerShdw blurRad="38100" dist="28575" dir="2700000"[^>]*><a:srgbClr val="000000"><a:alpha val="50196"\/><\/a:srgbClr><\/a:outerShdw><\/a:effectLst><a:latin/);
  });

  it("round-trips every effect", async () => {
    const [back] = await roundTrip([art()]);
    expect(back.wordArt).toEqual({
      outline: { color: "#112233", width: 2 },
      gradient: { from: "#ff0000", to: "#0000ff", angle: 90 },
      shadow: { color: "#00000080", blur: 4, dist: 3, dir: 45 },
      glow: { color: "#ffff00", radius: 6 },
      warp: "textArchUp",
    });
  });

  it("colour helpers", () => {
    expect(srgbXml("#abc")).toBe('<a:srgbClr val="AABBCC"/>');
    expect(srgbXml("#11223380")).toBe('<a:srgbClr val="112233"><a:alpha val="50196"/></a:srgbClr>');
    expect(wordArtRunXml(undefined)).toEqual({ ln: "", fill: null, effects: "" });
  });
});

describe("diagrams in pptx", () => {
  it("a diagram is written as a group of shapes and read back as one", async () => {
    const g = newDiagram("process", "Plan\nBuild\nShip", { x: 96, y: 108, w: 768, h: 300 }, OFFICE_THEME);
    const [back] = await roundTrip([g]);
    expect(back.type).toBe("group");
    const kids = back.children!;
    expect(kids.filter((k) => k.preset === "roundRect").length).toBe(3);
    // Arrows at their default adjust read back as the legacy right arrow.
    expect(kids.filter((k) => k.preset === "rightArrow" || k.type === "rightArrow").length).toBe(2);
    expect(kids.filter((k) => k.type === "text").map((k) => k.text)).toEqual(["Plan", "Build", "Ship"]);
    expect(kids.find((k) => k.preset === "roundRect")!.themeRefs?.fill).toBe("accent1");
  });

  it("imports a SmartArt frame from its cached drawing (dsp:drawing)", async () => {
    // Start from a Grown export and add a SmartArt frame by hand.
    const zip = await pkg([]);
    const slidePath = "ppt/slides/slide1.xml";
    let slide = await zip.file(slidePath)!.async("string");
    const frame =
      '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="90" name="Diagram 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>' +
      '<p:xfrm><a:off x="914400" y="914400"/><a:ext cx="4572000" cy="1828800"/></p:xfrm>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">' +
      '<dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId90" r:lo="rId91" r:qs="rId92" r:cs="rId93"/>' +
      "</a:graphicData></a:graphic></p:graphicFrame>";
    slide = slide.replace("</p:spTree>", `${frame}</p:spTree>`);
    zip.file(slidePath, slide);
    const relsPath = "ppt/slides/_rels/slide1.xml.rels";
    let rels = await zip.file(relsPath)!.async("string");
    rels = rels.replace(
      "</Relationships>",
      '<Relationship Id="rId90" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="../diagrams/data1.xml"/>' +
        '<Relationship Id="rId94" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/drawing1.xml"/></Relationships>',
    );
    zip.file(relsPath, rels);
    zip.file(
      "ppt/diagrams/data1.xml",
      '<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst/><dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:dataModelExt xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" relId="rId94" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:ext></dgm:extLst></dgm:dataModel>',
    );
    const sp = (id: number, x: number, text: string) =>
      `<dsp:sp modelId="{${id}}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr>` +
      `<dsp:spPr><a:xfrm><a:off x="${x}" y="0"/><a:ext cx="1371600" cy="914400"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></dsp:spPr>` +
      `<dsp:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${text}</a:t></a:r></a:p></dsp:txBody></dsp:sp>`;
    zip.file(
      "ppt/diagrams/drawing1.xml",
      '<dsp:drawing xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
        `<dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>${sp(1, 0, "Alpha")}${sp(2, 1828800, "Beta")}</dsp:spTree></dsp:drawing>`,
    );
    const r = await readPptx(await zip.generateAsync({ type: "uint8array" }));
    const els = r.deck.slides[0].elements;
    expect(r.warnings.join(" ")).not.toMatch(/SmartArt/);
    expect(els.length).toBe(1);
    const g = els[0];
    expect(g.type).toBe("group");
    expect({ x: g.x, y: g.y, w: g.w, h: g.h }).toEqual({ x: 96, y: 96, w: 480, h: 192 });
    const texts = g.children!.filter((c) => c.type === "text");
    expect(texts.map((t) => t.text)).toEqual(["Alpha", "Beta"]);
    // Member positions are the frame offset plus their drawing offset.
    expect(texts[1].x).toBe(96 + 192);
    expect(g.children!.filter((c) => c.preset === "roundRect" || c.type === "roundRect").length).toBe(2);
  });
});
