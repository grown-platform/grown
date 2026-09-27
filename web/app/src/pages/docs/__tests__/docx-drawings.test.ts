// DOCX drawings both ways (Docs M7): wp:inline and wp:anchor pictures
// (wrap types, positions, distances, crop, rotation, flips, alt text,
// names, z-order), wps shapes and text boxes, a VML text box (read only)
// and a chart part, from a Word-shaped document; then Word → Grown → docx
// → Grown equality and the XML shapes Word expects.
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import type { Editor, JSONContent } from "@tiptap/core";
import { makeEditor } from "./harness";
import { buildDocx, PNG_1PX } from "./docx-fixture";
import { readDocx } from "../docx/read";
import { writeDocx } from "../docx/write";
import { applyDocxImport, collectDocxInput } from "../docx/apply";
import { parseXml } from "../docx/xml";
import { insertChart, insertShape, insertObject, chartOf } from "../objectNodes";

const NS =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';
const r = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const E = 9525;

const pic = (rid: string, cx: number, cy: number, extra = "", xfrm = "") =>
  `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic ${NS}><pic:nvPicPr><pic:cNvPr id="0" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
  `<pic:blipFill><a:blip r:embed="${rid}"/>${extra}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
  `<pic:spPr><a:xfrm${xfrm}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;

// 1. an inline picture in a sentence;
// 2. a square-wrapped picture on the right, cropped, rotated 90°, flipped,
//    offset from the margin, with alt text and a name;
// 3. a picture behind the text, positioned against the page with a
//    percentage offset and a relative width;
// 4. a wps rounded rectangle with text, in front of the text;
// 5. a wps text box (top and bottom);
// 6. a VML text box (legacy fallback, read only);
// 7. a chart.
const BODY =
  `<w:p>${r("Before ")}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" ${NS}><wp:extent cx="${40 * E}" cy="${20 * E}"/><wp:docPr id="1" name="Tiny" descr="Tiny logo"/>${pic("rIdImg", 40 * E, 20 * E)}</wp:inline></w:drawing></w:r>${r(" after.")}</w:p>` +
  `<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="${24 * E}" distR="${24 * E}" simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1" ${NS}>` +
  `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>${10 * E}</wp:posOffset></wp:positionV>` +
  `<wp:extent cx="${200 * E}" cy="${150 * E}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="left"/><wp:docPr id="2" name="Photo" descr="A cropped photo"/><wp:cNvGraphicFramePr/>` +
  pic("rIdImg", 200 * E, 150 * E, '<a:srcRect l="10000" t="5000" r="20000" b="0"/>', ' rot="5400000" flipH="1"') +
  `</wp:anchor></w:drawing></w:r>${r("Text that wraps around the photo.")}</w:p>` +
  `<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251658240" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1" ${NS}>` +
  `<wp:simplePos x="0" y="0"/><mc:AlternateContent><mc:Choice Requires="wp14"><wp:positionH relativeFrom="page"><wp14:pctPosHOffset>25000</wp14:pctPosHOffset></wp:positionH></mc:Choice><mc:Fallback><wp:positionH relativeFrom="page"><wp:posOffset>1905000</wp:posOffset></wp:positionH></mc:Fallback></mc:AlternateContent>` +
  `<wp:positionV relativeFrom="page"><wp:posOffset>${96 * E}</wp:posOffset></wp:positionV>` +
  `<wp:extent cx="${300 * E}" cy="${100 * E}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="3" name="Watermark"/><wp:cNvGraphicFramePr/>` +
  pic("rIdImg", 300 * E, 100 * E) +
  `<wp14:sizeRelH relativeFrom="margin"><wp14:pctWidth>50000</wp14:pctWidth></wp14:sizeRelH></wp:anchor></w:drawing></w:r>${r("Behind this text.")}</w:p>` +
  `<w:p><w:r><mc:AlternateContent ${NS}><mc:Choice Requires="wps"><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251660288" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
  `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>${50 * E}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
  `<wp:extent cx="${180 * E}" cy="${90 * E}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="4" name="Callout"/><wp:cNvGraphicFramePr/>` +
  `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${180 * E}" cy="${90 * E}"/></a:xfrm>` +
  `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="70AD47"/></a:solidFill><a:ln w="${2 * E}"><a:solidFill><a:srgbClr val="385723"/></a:solidFill><a:prstDash val="dash"/></a:ln></wps:spPr>` +
  `<wps:style><a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></wps:style>` +
  `<wps:txbx><w:txbxContent><w:p>${r("Shape ")}<w:r><w:rPr><w:b/></w:rPr><w:t>text</w:t></w:r></w:p><w:p>${r("line two")}</w:p></w:txbxContent></wps:txbx><wps:bodyPr anchor="ctr"/></wps:wsp></a:graphicData></a:graphic>` +
  `</wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:roundrect style="width:135pt;height:67.5pt"><v:textbox><w:txbxContent><w:p>${r("Shape text line two")}</w:p></w:txbxContent></v:textbox></v:roundrect></w:pict></mc:Fallback></mc:AlternateContent></w:r>${r("Shape anchor.")}</w:p>` +
  `<w:p><w:r><mc:AlternateContent ${NS}><mc:Choice Requires="wps"><w:drawing><wp:anchor distT="${6 * E}" distB="${6 * E}" distL="114300" distR="114300" simplePos="0" relativeHeight="251661312" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
  `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:align>center</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
  `<wp:extent cx="${240 * E}" cy="${60 * E}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapTopAndBottom/><wp:docPr id="5" name="Text Box 5"/><wp:cNvGraphicFramePr/>` +
  `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${240 * E}" cy="${60 * E}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="6350"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr>` +
  `<wps:txbx><w:txbxContent><w:p>${r("Boxed words")}</w:p></w:txbxContent></wps:txbx><wps:bodyPr anchor="t"/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice></mc:AlternateContent></w:r></w:p>` +
  `<w:p><w:r><w:pict ${NS}><v:shape style="position:absolute;margin-left:12pt;margin-top:6pt;width:150pt;height:45pt" fillcolor="#fff2cc" strokecolor="#bf9000"><v:textbox><w:txbxContent><w:p>${r("Legacy box")}</w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r>${r("VML anchor.")}</w:p>` +
  `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" ${NS}><wp:extent cx="${480 * E}" cy="${300 * E}"/><wp:docPr id="7" name="Chart 7" descr="Sales chart"/>` +
  `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rIdChart"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

const strCache = (vals: string[]) => `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("")}</c:strCache>`;
const numCache = (vals: number[]) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("")}</c:numCache>`;
const CHART =
  `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Quarterly sales</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>` +
  [
    ["B", "North", [4, 2.5, 3.5]],
    ["C", "South", [2.4, 4.4, 1.8]],
  ]
    .map(
      ([col, name, vals], k) =>
        `<c:ser><c:idx val="${k}"/><c:order val="${k}"/><c:tx><c:strRef><c:f>Sheet1!$${col}$1</c:f>${strCache([name as string])}</c:strRef></c:tx>` +
        `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$4</c:f>${strCache(["Q1", "Q2", "Q3"])}</c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$${col}$2:$${col}$4</c:f>${numCache(vals as number[])}</c:numRef></c:val></c:ser>`,
    )
    .join("") +
  `<c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>` +
  `<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/></c:legend></c:chart></c:chartSpace>`;

async function wordDoc(): Promise<Uint8Array> {
  return buildDocx({
    body: BODY,
    rels: [
      ["rIdImg", "image", "media/image1.png"],
      ["rIdChart", "chart", "charts/chart1.xml"],
    ],
    media: { "image1.png": PNG_1PX },
    extraParts: { "charts/chart1.xml": CHART },
  });
}

function objects(json: JSONContent): JSONContent[] {
  const out: JSONContent[] = [];
  const walk = (n: JSONContent) => {
    if (["image", "inlineImage", "shape", "textBox", "chart"].includes(n.type ?? "")) out.push(n);
    n.content?.forEach(walk);
  };
  walk(json);
  return out;
}

async function load(bytes: Uint8Array): Promise<Editor> {
  const e = makeEditor("<p></p>");
  applyDocxImport(e, await readDocx(bytes));
  return e;
}

async function write(e: Editor): Promise<{ bytes: Uint8Array; zip: JSZip; xml: string }> {
  const input = collectDocxInput(e, { title: "T" });
  input.now = new Date("2026-09-27T00:00:00Z");
  const bytes = await writeDocx(input);
  const zip = await JSZip.loadAsync(bytes);
  return { bytes, zip, xml: await zip.file("word/document.xml")!.async("string") };
}

describe("docx drawings (M7): reader", () => {
  it("reads pictures, shapes, text boxes and charts with their layout", async () => {
    const imp = await readDocx(await wordDoc());
    const e = makeEditor("<p></p>");
    applyDocxImport(e, imp);
    const objs = objects(e.getJSON());
    expect(objs.map((o) => o.type)).toEqual(["inlineImage", "inlineImage", "inlineImage", "shape", "textBox", "textBox", "chart"]);
    const [tiny, photo, behind, shape, box, legacy, chart] = objs.map((o) => o.attrs!);

    // An inline picture stays in its sentence.
    expect(e.state.doc.child(0).textContent).toBe("Before  after.");
    expect(tiny).toMatchObject({ wrap: "inline", width: 40, height: 20, alt: "Tiny logo", name: "Tiny" });

    expect(photo).toMatchObject({
      wrap: "square",
      wrapSide: "left",
      dist: 24,
      hRel: "margin",
      hAlign: "right",
      vRel: "paragraph",
      vOffset: 10,
      width: 200,
      height: 150,
      cropL: 0.1,
      cropT: 0.05,
      cropR: 0.2,
      rotate: 90,
      flipH: true,
      alt: "A cropped photo",
      name: "Photo",
    });
    expect(photo.cropB).toBe(0);

    expect(behind).toMatchObject({ wrap: "behind", hRel: "page", hPct: 25, vRel: "page", vOffset: 96, relW: 50, relWFrom: "margin", name: "Watermark" });
    // relativeHeight → ranks, order kept (behind < photo < shape < box;
    // the VML box has none, so it is lowest).
    expect([behind.z, photo.z, shape.z, box.z, legacy.z]).toEqual([2, 3, 4, 5, 1]);

    expect(shape).toMatchObject({ prst: "roundRect", fill: "#70ad47", stroke: "#385723", strokeWidth: 2, dash: "dash", textAnchor: "ctr", textColor: "#ffffff", wrap: "inFront", hOffset: 50, width: 180, height: 90 });
    expect(JSON.parse(String(shape.adj))).toEqual({ adj: 25000 });
    const shapeNode = objs[3];
    expect(shapeNode.content!.map((c) => (c.type === "text" ? c.text : "⏎"))).toEqual(["Shape ", "text", "⏎", "line two"]);
    expect(shapeNode.content![1].marks).toEqual([{ type: "bold" }]);

    expect(box).toMatchObject({ wrap: "topBottom", hAlign: "center", dist: 6, prst: "rect", fill: "#ffffff", stroke: "#000000", textAnchor: "t" });
    expect(objs[4].content).toEqual([{ type: "text", text: "Boxed words" }]);

    expect(legacy).toMatchObject({ wrap: "square", width: 200, height: 60, hOffset: 16, vOffset: 8, fill: "#fff2cc", stroke: "#bf9000" });
    expect(objs[5].content).toEqual([{ type: "text", text: "Legacy box" }]);

    const c = chartOf({ attrs: chart });
    expect(chart).toMatchObject({ wrap: "inline", width: 480, height: 300, alt: "Sales chart" });
    expect(c.type).toBe("column");
    expect(c.title).toBe("Quarterly sales");
    expect(c.data).toEqual([
      ["", "North", "South"],
      ["Q1", "4", "2.4"],
      ["Q2", "2.5", "4.4"],
      ["Q3", "3.5", "1.8"],
    ]);
    expect(imp.warnings).not.toContain("floating image position");
    expect(imp.warnings).not.toContain("text boxes (content kept inline)");
  });
});

describe("docx drawings (M7): writer and round trips", () => {
  it("Word → Grown → docx → Grown keeps every object; the second trip is stable", async () => {
    const e = await load(await wordDoc());
    const first = await write(e);
    const f = await load(first.bytes);
    expect(f.getJSON()).toEqual(e.getJSON());
    const second = await write(f);
    const g = await load(second.bytes);
    expect(g.getJSON()).toEqual(f.getJSON());
  });

  it("writes wp:anchor / wp:inline, wps and chart parts the way Word expects", async () => {
    const { zip, xml } = await write(await load(await wordDoc()));
    const doc = parseXml(xml);
    const anchors = Array.from(doc.getElementsByTagName("wp:anchor"));
    expect(anchors).toHaveLength(5);
    // CT_Anchor child order.
    const ORDER = ["wp:simplePos", "wp:positionH", "wp:positionV", "wp:extent", "wp:effectExtent", "wrap", "wp:docPr", "wp:cNvGraphicFramePr", "a:graphic", "wp14:sizeRelH", "wp14:sizeRelV"];
    for (const a of anchors) {
      const names = Array.from(a.children).map((c) => (c.nodeName.startsWith("wp:wrap") ? "wrap" : c.nodeName === "mc:AlternateContent" ? "wp:positionH" : c.nodeName));
      const idx = names.map((n) => ORDER.indexOf(n));
      expect(idx.every((v) => v >= 0)).toBe(true);
      expect([...idx].sort((x, y) => x - y)).toEqual(idx);
    }
    const photo = anchors[0];
    expect(photo.getAttribute("distL")).toBe(String(24 * E));
    expect(photo.getElementsByTagName("wp:wrapSquare")[0].getAttribute("wrapText")).toBe("left");
    expect(photo.getElementsByTagName("a:srcRect")[0].getAttribute("l")).toBe("10000");
    const xfrm = photo.getElementsByTagName("a:xfrm")[0];
    expect([xfrm.getAttribute("rot"), xfrm.getAttribute("flipH")]).toEqual(["5400000", "1"]);
    expect(photo.getElementsByTagName("wp:docPr")[0].getAttribute("descr")).toBe("A cropped photo");
    expect(anchors[1].getAttribute("behindDoc")).toBe("1");
    // Shapes sit in mc:AlternateContent / Choice Requires="wps".
    const choices = Array.from(doc.getElementsByTagName("mc:Choice")).filter((c) => c.getAttribute("Requires") === "wps");
    expect(choices).toHaveLength(3);
    expect(xml).toContain('<wps:cNvSpPr txBox="1"/>');
    expect(xml).toContain('<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom>');
    // The chart part, its content type and the embedded workbook.
    expect(zip.file("word/charts/chart1.xml")).toBeTruthy();
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    expect(ct).toContain('PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"');
    expect(zip.file("word/embeddings/Microsoft_Excel_Worksheet1.xlsx")).toBeTruthy();
    const chartRels = await zip.file("word/charts/_rels/chart1.xml.rels")!.async("string");
    expect(chartRels).toContain("../embeddings/Microsoft_Excel_Worksheet1.xlsx");
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    expect(rels).toContain('Target="charts/chart1.xml"');
    const chartXml = parseXml(await zip.file("word/charts/chart1.xml")!.async("string"));
    expect(chartXml.getElementsByTagName("c:numCache").length).toBeGreaterThan(0);
    // Every r:id / r:embed resolves.
    for (const m of xml.matchAll(/r:(?:id|embed)="([^"]+)"/g)) expect(rels).toContain(`Id="${m[1]}"`);
  });

  it("an editor-built picture, shape, text box and chart survive a round trip", async () => {
    const e = makeEditor("<p>Intro text</p>");
    e.commands.setTextSelection(3);
    insertObject(e, "inlineImage", { src: `data:image/png;base64,${PNG_1PX}`, width: 120, height: 80, wrap: "tight", hAlign: "left", cropT: 0.1, rotate: 15, flipV: true, alt: "Pic" });
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    insertShape(e, "ellipse", { text: "Hi", attrs: { wrap: "inFront", hOffset: 30, vOffset: 12, z: 3 } });
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    insertShape(e, "rect", { textBox: true, text: "Box", attrs: { wrap: "through", wrapSide: "right", dist: 4 } });
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    insertChart(e, { type: "line", title: "Trend", data: [["", "A"], ["x", "1"], ["y", "3"]] }, { width: 300, height: 200 });
    const before = objects(e.getJSON());
    const { bytes } = await write(e);
    const f = await load(bytes);
    const after = objects(f.getJSON());
    expect(after.map((o) => o.type)).toEqual(before.map((o) => o.type));
    // z becomes Word's relativeHeight: ranks over the anchored objects in
    // stacking order (ties in document order), so compare the order.
    const zs = (list: JSONContent[]) => list.filter((o) => o.attrs!.wrap !== "inline").map((o) => Number(o.attrs!.z));
    const order = (z: number[]) => z.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[1]);
    expect(order(zs(after))).toEqual(order(zs(before)));
    for (let i = 0; i < before.length; i++) {
      const { z: _za, ...a } = before[i].attrs!;
      const { z: _zb, ...b } = after[i].attrs!;
      void _za;
      void _zb;
      expect(b).toEqual(a);
      expect(after[i].content ?? []).toEqual(before[i].content ?? []);
    }
  });
});
