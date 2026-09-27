import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { deckToPptx, patchElements, ELEMENT_MARKER } from "./write";
import { readAdjust, readPptx } from "./read";
import { newConnector, newShape, type DeckDoc, type SlideElement } from "../model";
import { connectorEnds } from "../connectorOps";
import { PRESET_DEFS } from "../presetDefs";

// pptx round trip of preset geometry: prstGeom + avLst for shapes, p:cxnSp
// with arrowheads, dash and stCxn/endCxn glue for connectors.

const deckOf = (elements: SlideElement[]): DeckDoc => ({
  slides: [{ id: "s1", background: "#ffffff", elements }],
});

async function slideXml(deck: DeckDoc): Promise<string> {
  const zip = await JSZip.loadAsync(await deckToPptx(deck));
  return zip.file("ppt/slides/slide1.xml")!.async("string");
}

const shape = (preset: string, over: Partial<SlideElement> = {}): SlideElement => ({
  ...newShape(preset, { x: 96, y: 96, w: 192, h: 96 }),
  fill: "#ff8800",
  stroke: "#003366",
  strokeWidth: 2,
  ...over,
});

describe("pptx write: presets", () => {
  it("writes prstGeom with the adjust values in avLst", async () => {
    const xml = await slideXml(
      deckOf([shape("wedgeRoundRectCallout", { adj: { adj1: -40000, adj2: 90000, adj3: 16667 } })]),
    );
    expect(xml).toContain(
      '<a:prstGeom prst="wedgeRoundRectCallout"><a:avLst><a:gd name="adj1" fmla="val -40000"/><a:gd name="adj2" fmla="val 90000"/><a:gd name="adj3" fmla="val 16667"/></a:avLst></a:prstGeom>',
    );
    expect(xml).not.toContain(ELEMENT_MARKER);
  });

  it("writes an empty avLst for default adjusts and a dash preset", async () => {
    const xml = await slideXml(deckOf([shape("star5", { dash: "lgDash" })]));
    expect(xml).toContain('<a:prstGeom prst="star5"><a:avLst/></a:prstGeom>');
    expect(xml).toContain('<a:prstDash val="lgDash"/>');
  });

  it("writes connectors as p:cxnSp with arrowheads and glue ids", async () => {
    const a = { ...shape("rect"), id: "a", x: 0, y: 0, w: 96, h: 48 };
    const b = { ...shape("ellipse"), id: "b", x: 480, y: 240, w: 96, h: 96 };
    const c: SlideElement = {
      ...newConnector("bentConnector3", { from: [96, 24], to: [480, 288], tailEnd: "triangle", headEnd: "oval" }),
      id: "c",
      stCxn: { id: "a", idx: 3 },
      endCxn: { id: "b", idx: 2 },
      adj: { adj1: 30000 },
    };
    const xml = await slideXml(deckOf([a, b, c]));
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const cxn = doc.getElementsByTagNameNS("*", "cxnSp")[0];
    expect(cxn).toBeTruthy();
    expect(cxn.getElementsByTagNameNS("*", "txBody")).toHaveLength(0);
    const idOf = (name: string) =>
      Array.from(doc.getElementsByTagNameNS("*", "cNvPr")).find((e) => e.getAttribute("name")?.startsWith(name))!.getAttribute("id");
    const st = cxn.getElementsByTagNameNS("*", "stCxn")[0];
    const en = cxn.getElementsByTagNameNS("*", "endCxn")[0];
    const shapes = Array.from(doc.getElementsByTagNameNS("*", "sp"));
    const ids = shapes.map((s) => s.getElementsByTagNameNS("*", "cNvPr")[0].getAttribute("id"));
    expect(st.getAttribute("id")).toBe(ids[0]);
    expect(st.getAttribute("idx")).toBe("3");
    expect(en.getAttribute("id")).toBe(ids[1]);
    expect(en.getAttribute("idx")).toBe("2");
    expect(idOf("Connector")).toBeTruthy();
    expect(xml).toContain('<a:headEnd type="oval"/><a:tailEnd type="triangle"/>');
    expect(xml).toContain('<a:gd name="adj1" fmla="val 30000"/>');
  });

  it("patchElements leaves unmarked shapes alone", () => {
    const xml = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Keep"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp></p:spTree></p:cSld></p:sld>`;
    expect(patchElements(xml, [])).toContain('name="Keep"');
  });
});

describe("pptx read: presets", () => {
  it("readAdjust parses val formulas only", () => {
    const doc = new DOMParser().parseFromString(
      `<a:prstGeom xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" prst="x"><a:avLst><a:gd name="adj1" fmla="val -1250"/><a:gd name="adj2" fmla="*/ w 1 2"/></a:avLst></a:prstGeom>`,
      "application/xml",
    );
    expect(readAdjust(doc.documentElement)).toEqual({ adj1: -1250 });
  });
});

/** Round-trip-relevant fields of an element (ids and glue ids dropped). */
const pick = (e: SlideElement) => ({
  type: e.type,
  preset: e.preset,
  adj: e.adj,
  dash: e.dash,
  headEnd: e.headEnd,
  tailEnd: e.tailEnd,
  flipH: !!e.flipH,
  flipV: !!e.flipV,
  rotation: e.rotation || 0,
  fill: e.type === "connector" ? undefined : e.fill?.toLowerCase(),
  stroke: e.stroke?.toLowerCase(),
  strokeWidth: e.strokeWidth,
  box: [e.x, e.y, e.w, e.h].map((n) => Math.round(n * 100) / 100),
});

describe("pptx round trip: presets", () => {
  it("every non-legacy preset shape survives with its adjust values", async () => {
    const names = Object.keys(PRESET_DEFS).filter(
      (n) => !["rect", "ellipse", "diamond", "line", "straightConnector1"].includes(n) && !/Connector\d/.test(n),
    );
    const els: SlideElement[] = names.map((n, i) => {
      const def = PRESET_DEFS[n];
      const adj = def.av ? Object.fromEntries(Object.entries(def.av).map(([k, v]) => [k, v + 7])) : undefined;
      return shape(n, {
        x: (i % 10) * 90 + 10,
        y: Math.floor(i / 10) * 70 + 10,
        w: 80,
        h: 60,
        ...(adj ? { adj } : {}),
        ...(i % 3 === 0 ? { rotation: 30, flipH: true } : {}),
        ...(i % 4 === 0 ? { dash: "sysDot" as const } : {}),
      });
    });
    const r = await readPptx(await deckToPptx(deckOf(els)));
    expect(r.warnings).toEqual([]);
    expect(r.deck.slides[0].elements.map(pick)).toEqual(els.map(pick));
  });

  it("connectors keep preset, adjust, flips, arrowheads, dash and glue", async () => {
    const a = { ...shape("hexagon"), id: "a", x: 48, y: 48, w: 144, h: 96 };
    const b = { ...shape("flowChartDecision"), id: "b", x: 576, y: 288, w: 192, h: 96 };
    const c: SlideElement = {
      ...newConnector("curvedConnector3", { from: [768, 336], to: [192, 96], tailEnd: "stealth", headEnd: "diamond" }),
      id: "c",
      dash: "dash",
      adj: { adj1: 60000 },
      stCxn: { id: "b", idx: 3 },
      endCxn: { id: "a", idx: 0 },
      strokeWidth: 3,
    };
    const d: SlideElement = { ...newConnector("straightConnector1", { from: [10, 500], to: [300, 450], tailEnd: "arrow" }), id: "d" };
    const e: SlideElement = { ...newConnector("bentConnector2", { from: [400, 400], to: [500, 520] }), id: "e" };
    const r = await readPptx(await deckToPptx(deckOf([a, b, c, d, e])));
    const got = r.deck.slides[0].elements;
    expect(got.map(pick)).toEqual([a, b, c, d, e].map(pick));
    const gc = got[2];
    expect(gc.stCxn).toEqual({ id: got[1].id, idx: 3 });
    expect(gc.endCxn).toEqual({ id: got[0].id, idx: 0 });
    expect(connectorEnds(gc).start.map(Math.round)).toEqual([768, 336]);
    expect(connectorEnds(gc).end.map(Math.round)).toEqual([192, 96]);
  });

  it("a plain straight line still round-trips as a legacy line", async () => {
    const line: SlideElement = { id: "l", type: "line", x: 100, y: 200, w: 300, h: 0, stroke: "#202124", strokeWidth: 3 };
    const r = await readPptx(await deckToPptx(deckOf([line, shape("chevron")])));
    expect(r.deck.slides[0].elements.map((e) => e.type)).toEqual(["line", "shape"]);
  });

  it("round-trips twice without drift", async () => {
    const els = [shape("pie", { adj: { adj1: 1000000, adj2: 9000000 } }), shape("mathDivide")];
    const once = await readPptx(await deckToPptx(deckOf(els)));
    const twice = await readPptx(await deckToPptx(once.deck));
    expect(twice.deck.slides[0].elements.map(pick)).toEqual(once.deck.slides[0].elements.map(pick));
  });
});
