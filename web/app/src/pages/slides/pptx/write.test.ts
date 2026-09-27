import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  deckToPptx,
  hex6,
  insertTransition,
  pxToInch,
  pxToPt,
  transitionXml,
  transparencyOf,
} from "./write";
import type { DeckDoc, SlideElement } from "../model";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function deckOf(
  elements: SlideElement[],
  extra: Partial<DeckDoc["slides"][0]> = {},
): DeckDoc {
  return { slides: [{ id: "s1", background: "#ffffff", elements, ...extra }] };
}

async function slideXml(
  deck: DeckDoc,
  n = 1,
): Promise<{ xml: string; rels: string; zip: JSZip }> {
  const zip = await JSZip.loadAsync(await deckToPptx(deck));
  return {
    zip,
    xml: await zip.file(`ppt/slides/slide${n}.xml`)!.async("string"),
    rels: await zip
      .file(`ppt/slides/_rels/slide${n}.xml.rels`)!
      .async("string"),
  };
}

const text = (over: Partial<SlideElement> = {}): SlideElement => ({
  id: "t",
  type: "text",
  x: 96,
  y: 48,
  w: 480,
  h: 96,
  text: "Hello",
  fontSize: 24,
  color: "#202124",
  fontFamily: "Arial",
  align: "left",
  valign: "top",
  ...over,
});

describe("unit helpers", () => {
  it("maps the 960 px canvas to 10 in and 720 pt", () => {
    expect(pxToInch(960)).toBe(10);
    expect(pxToInch(96)).toBe(1);
    expect(pxToPt(24)).toBe(18);
  });
  it("hex6 strips # and alpha; transparencyOf reads the alpha byte", () => {
    expect(hex6("#aabbcc")).toBe("AABBCC");
    expect(hex6("#aabbcc80")).toBe("AABBCC");
    expect(hex6(undefined)).toBe("000000");
    expect(transparencyOf("#aabbcc")).toBeUndefined();
    expect(transparencyOf("#aabbcc80")).toBe(50);
    expect(transparencyOf("#aabbccff")).toBeUndefined();
  });
});

describe("transition XML", () => {
  it("maps each Grown transition", () => {
    expect(transitionXml("none")).toBe("");
    expect(transitionXml(undefined)).toBe("");
    expect(transitionXml("fade")).toContain("<p:fade/>");
    expect(transitionXml("slide-left")).toContain(`<p:push dir="l"/>`);
    expect(transitionXml("slide-right")).toContain(`<p:push dir="r"/>`);
    expect(transitionXml("slide-up")).toContain(`<p:push dir="u"/>`);
  });
  it("inserts after clrMapOvr and before timing", () => {
    const src = `<p:sld><p:cSld/><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr><p:timing/></p:sld>`;
    expect(insertTransition(src, "<p:transition/>")).toBe(
      `<p:sld><p:cSld/><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr><p:transition/><p:timing/></p:sld>`,
    );
  });
  it("falls back to after cSld and replaces an existing transition", () => {
    expect(
      insertTransition(`<p:sld><p:cSld></p:cSld></p:sld>`, "<p:transition/>"),
    ).toBe(`<p:sld><p:cSld></p:cSld><p:transition/></p:sld>`);
    const had = `<p:sld><p:cSld></p:cSld><p:transition spd="fast"><p:wipe/></p:transition></p:sld>`;
    expect(
      insertTransition(had, `<p:transition><p:fade/></p:transition>`),
    ).toBe(
      `<p:sld><p:cSld></p:cSld><p:transition><p:fade/></p:transition></p:sld>`,
    );
    expect(insertTransition(had, "")).toBe(`<p:sld><p:cSld></p:cSld></p:sld>`);
  });
});

describe("deckToPptx emitted XML", () => {
  it("writes a 16:9 10in × 5.625in slide size", async () => {
    const { zip } = await slideXml(deckOf([]));
    const pres = await zip.file("ppt/presentation.xml")!.async("string");
    expect(pres).toContain(`<p:sldSz cx="9144000" cy="5143500"/>`);
  });

  it("writes the slide background colour", async () => {
    const { xml } = await slideXml({
      slides: [{ id: "s", background: "#123abc", elements: [] }],
    });
    expect(xml).toMatch(
      /<p:bg><p:bgPr><a:solidFill><a:srgbClr val="123ABC"\/>/,
    );
  });

  it("writes text geometry, rotation, run formatting and line spacing", async () => {
    const { xml } = await slideXml(
      deckOf([
        text({
          rotation: 45,
          bold: true,
          italic: true,
          strike: true,
          lineSpacing: 1.5,
        }),
      ]),
    );
    expect(xml).toContain(
      `<a:xfrm rot="2700000"><a:off x="914400" y="457200"/>`,
    );
    expect(xml).toMatch(
      /<a:rPr [^>]*sz="1800"[^>]*b="1"[^>]*i="1"[^>]*strike="sngStrike"/,
    );
    expect(xml).toContain(`<a:spcPct val="150000"/>`);
  });

  it("writes one paragraph per line with bullets or numbering", async () => {
    const bullets = (
      await slideXml(deckOf([text({ text: "a\nb\nc", list: "bullet" })]))
    ).xml;
    expect(bullets.match(/<a:p>/g)).toHaveLength(3);
    expect(bullets.match(/<a:buChar /g)).toHaveLength(3);
    const nums = (
      await slideXml(deckOf([text({ text: "a\nb", list: "number" })]))
    ).xml;
    expect(nums.match(/<a:buAutoNum type="arabicPeriod"/g)).toHaveLength(2);
  });

  it("writes hyperlinks on text runs and on shapes as external relationships", async () => {
    const { xml, rels } = await slideXml(
      deckOf([
        text({ url: "https://grown.example/a" }),
        {
          id: "r",
          type: "rect",
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          fill: "#ff0000",
          url: "https://grown.example/b",
        },
      ]),
    );
    expect(xml).toMatch(/<a:rPr[^>]*>[\s\S]*<a:hlinkClick r:id="rId\d+"/);
    expect(xml).toMatch(
      /<p:cNvPr id="\d+" name="[^"]*"><a:hlinkClick r:id="rId\d+"/,
    );
    expect(rels).toContain(
      `Target="https://grown.example/a" TargetMode="External"`,
    );
    expect(rels).toContain(
      `Target="https://grown.example/b" TargetMode="External"`,
    );
  });

  it("writes flips and the roundRect corner adjust", async () => {
    const { xml } = await slideXml(
      deckOf([
        {
          id: "r",
          type: "roundRect",
          x: 0,
          y: 0,
          w: 200,
          h: 100,
          fill: "#00ff00",
          flipH: true,
          flipV: true,
        },
      ]),
    );
    expect(xml).toContain(`<a:xfrm flipH="1" flipV="1">`);
    expect(xml).toContain(
      `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 18000"/>`,
    );
  });

  it("writes each preset shape with its ECMA name and no fill for fill:none", async () => {
    const types = [
      "rect",
      "ellipse",
      "triangle",
      "diamond",
      "rightArrow",
      "roundRect",
    ] as const;
    const { xml } = await slideXml(
      deckOf(
        types.map((t, i) => ({
          id: t,
          type: t,
          x: i * 10,
          y: 0,
          w: 10,
          h: 10,
          fill: i ? "#abcdef" : "none",
        })),
      ),
    );
    for (const t of types) expect(xml).toContain(`<a:prstGeom prst="${t}">`);
    // No fill element and no <p:style>: PowerPoint draws the shape unfilled.
    expect(xml).toMatch(
      /prst="rect"><a:avLst><\/a:avLst><\/a:prstGeom><a:ln><\/a:ln><\/p:spPr>/,
    );
    expect(xml).not.toContain("<p:style>");
  });

  it("writes semi-transparent fills as alpha", async () => {
    const { xml } = await slideXml(
      deckOf([
        { id: "r", type: "rect", x: 0, y: 0, w: 10, h: 10, fill: "#ff000080" },
      ]),
    );
    expect(xml).toMatch(
      /<a:srgbClr val="FF0000"><a:alpha val="50000"\/><\/a:srgbClr>/,
    );
  });

  it("writes tables as a:tbl with a column per cell and borders", async () => {
    const { xml } = await slideXml(
      deckOf([
        {
          id: "tb",
          type: "table",
          x: 96,
          y: 96,
          w: 288,
          h: 96,
          table: {
            rows: 2,
            cols: 3,
            cells: [
              ["a", "b", "c"],
              ["d", "e", "f"],
            ],
          },
          fill: "#eeeeee",
          stroke: "#333333",
          strokeWidth: 2,
          fontSize: 16,
          color: "#111111",
        },
      ]),
    );
    expect(xml).toContain("<a:tbl>");
    expect(xml.match(/<a:gridCol w="914400"\/>/g)).toHaveLength(3);
    expect(xml.match(/<a:tr h="457200">/g)).toHaveLength(2);
    expect(xml.match(/<a:tc>/g)).toHaveLength(6);
    expect(xml).toContain(`<a:lnL w="25400"`);
    expect(xml).toContain(`<a:srgbClr val="333333"/>`);
    expect(xml).toContain(`sz="1200"`);
    for (const c of "abcdef") expect(xml).toContain(`<a:t>${c}</a:t>`);
  });

  it("writes images from data URLs into ppt/media", async () => {
    const { xml, rels, zip } = await slideXml(
      deckOf([
        {
          id: "i",
          type: "image",
          x: 0,
          y: 0,
          w: 96,
          h: 96,
          src: PNG_1PX,
          rotation: 90,
        },
      ]),
    );
    expect(xml).toContain("<p:pic>");
    expect(xml).toMatch(/<a:xfrm rot="5400000">/);
    expect(rels).toMatch(
      /relationships\/image" Target="\.\.\/media\/[^"]+\.png"/,
    );
    expect(
      Object.keys(zip.files).some(
        (p) => p.startsWith("ppt/media/") && p.endsWith(".png"),
      ),
    ).toBe(true);
  });

  it("writes speaker notes to a notes slide", async () => {
    const { zip, rels } = await slideXml(
      deckOf([], { notes: "Say hello\nthen wave" }),
    );
    expect(rels).toContain("notesSlide");
    const notes = await zip
      .file("ppt/notesSlides/notesSlide1.xml")!
      .async("string");
    expect(notes).toContain("Say hello");
  });

  it("post-processes transitions into the right slides only", async () => {
    const deck: DeckDoc = {
      slides: [
        { id: "a", background: "#ffffff", elements: [], transition: "fade" },
        { id: "b", background: "#ffffff", elements: [] },
        {
          id: "c",
          background: "#ffffff",
          elements: [],
          transition: "slide-up",
        },
      ],
    };
    const zip = await JSZip.loadAsync(await deckToPptx(deck));
    const s = (n: number) =>
      zip.file(`ppt/slides/slide${n}.xml`)!.async("string");
    expect(await s(1)).toMatch(
      /<\/p:clrMapOvr><p:transition spd="med"><p:fade\/><\/p:transition><\/p:sld>/,
    );
    expect(await s(2)).not.toContain("<p:transition");
    expect(await s(3)).toContain(`<p:push dir="u"/>`);
  });
});

describe("groups (p:grpSp)", () => {
  const rect = (id: string, x: number, y: number): SlideElement => ({
    id,
    type: "rect",
    x,
    y,
    w: 96,
    h: 48,
    fill: "#4285f4",
    stroke: "none",
    strokeWidth: 0,
  });
  const group = (id: string, children: SlideElement[], over: Partial<SlideElement> = {}): SlideElement => ({
    id,
    type: "group",
    x: 0,
    y: 0,
    w: 480,
    h: 240,
    children,
    ...over,
  });

  it("wraps members in a p:grpSp with chOff = off and chExt = ext", async () => {
    const { xml } = await slideXml(
      deckOf([rect("before", 0, 0), group("g", [rect("a", 0, 0), text({ id: "b" })], { rotation: 30, flipV: true }), rect("after", 0, 0)]),
    );
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const tree = doc.getElementsByTagName("p:spTree")[0];
    const kinds = Array.from(tree.children).map((c) => c.localName).filter((n) => n === "sp" || n === "grpSp");
    expect(kinds).toEqual(["sp", "grpSp", "sp"]);
    const grp = doc.getElementsByTagName("p:grpSp")[0];
    expect(grp.getElementsByTagName("p:sp")).toHaveLength(2);
    const xfrm = grp.getElementsByTagName("a:xfrm")[0];
    expect(xfrm.getAttribute("rot")).toBe("1800000");
    expect(xfrm.getAttribute("flipV")).toBe("1");
    const attr = (n: string, a: string) => xfrm.getElementsByTagName(n)[0].getAttribute(a);
    expect(attr("a:ext", "cx")).toBe(String(Math.round(pxToInch(480) * 914400)));
    expect(attr("a:chExt", "cx")).toBe(attr("a:ext", "cx"));
    expect(attr("a:chOff", "x")).toBe(attr("a:off", "x"));
    // No marker names leak into the package; ids stay unique.
    expect(xml).not.toContain("grown-grp:");
    const ids = Array.from(doc.getElementsByTagName("p:cNvPr")).map((c) => c.getAttribute("id"));
    expect(new Set(ids).size).toBe(ids.length);
    expect(xml.startsWith("<?xml")).toBe(true);
  });

  it("nests groups", async () => {
    const { xml } = await slideXml(deckOf([group("o", [group("i", [rect("a", 0, 0), rect("b", 100, 0)]), rect("c", 200, 0)])]));
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const outer = doc.getElementsByTagName("p:grpSp")[0];
    const direct = Array.from(outer.children).map((c) => c.localName);
    expect(direct).toEqual(["nvGrpSpPr", "grpSpPr", "grpSp", "sp"]);
    expect(outer.getElementsByTagName("p:grpSp")[0].getElementsByTagName("p:sp")).toHaveLength(2);
  });

  it("keeps two adjacent sibling groups apart", async () => {
    const { xml } = await slideXml(deckOf([group("g1", [rect("a", 0, 0), rect("b", 1, 1)]), group("g2", [rect("c", 0, 0), rect("d", 1, 1)])]));
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const tree = doc.getElementsByTagName("p:spTree")[0];
    expect(Array.from(tree.children).filter((c) => c.localName === "grpSp")).toHaveLength(2);
  });
});
