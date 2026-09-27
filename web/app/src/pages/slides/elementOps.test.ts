import { describe, it, expect } from "vitest";
import {
  defaultElementName,
  elementName,
  findElementsByName,
  setElementName,
  setGradientFill,
  setOutline,
  setSolidFill,
} from "./elementOps";
import { shapeLayers, shapeLayersMarkup } from "./shapeRender";
import { deckToPptx } from "./pptx/write";
import { readPptx } from "./pptx/read";
import { newElement, newShape, type Slide, type SlideElement } from "./model";

const mk = (id: string, over: Partial<SlideElement> = {}): SlideElement => ({ ...newElement("rect"), id, ...over });

describe("element names", () => {
  it("default names come from the type and are unique", () => {
    const els = [mk("a", { name: "Rectangle 3" }), mk("b")];
    expect(defaultElementName(mk("c"), els)).toBe("Rectangle 4");
    expect(defaultElementName({ ...newElement("ellipse"), id: "e" }, els)).toBe("Oval 3");
  });
  it("names inside groups are found and renamed", () => {
    const g: SlideElement = { ...mk("g"), type: "group", children: [mk("k", { name: "Kid" })] };
    const r = setElementName([g, mk("b")], "b", "Kid");
    expect(r.ok).toBe(true);
    expect(r.elements[0].children![0].name).not.toBe("Kid");
  });
});

describe("OnlyOffice parity: drawing names", () => {
  // A drawing always has a non-empty name, even before one is set.
  it("oo:slide/js-api/api-drawing.js#Test: GetName", () => {
    const els = [mk("a")];
    const name = elementName(els[0], els);
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });

  // Setting a name succeeds; empty/null/undefined are rejected. Giving a
  // second drawing an existing name moves the name to it and the first one
  // gets a new default name.
  it("oo:slide/js-api/api-drawing.js#Test: SetName", () => {
    let els = [mk("d1")];
    let r = setElementName(els, "d1", "TestShape");
    expect(r.ok).toBe(true);
    expect(r.elements[0].name).toBe("TestShape");
    for (const bad of ["", null, undefined]) expect(setElementName(r.elements, "d1", bad).ok).toBe(false);

    els = [...r.elements, mk("d2")];
    r = setElementName(els, "d1", "DuplicateName");
    const first = r.elements[0].name;
    expect(first).toBe("DuplicateName");
    r = setElementName(r.elements, "d2", "DuplicateName");
    expect(r.elements[1].name).toBe("DuplicateName");
    expect(r.elements[0].name).not.toBe("DuplicateName");
    expect(r.elements[0].name).toBeTruthy();
  });
});

describe("OnlyOffice parity: presentation", () => {
  // GetDrawingsByName filters the drawings by a list of names.
  it("oo:slide/js-api/api-presentation.js#Test: GetDrawingsByName", () => {
    const slides: Slide[] = [
      { id: "s", background: "#fff", elements: [mk("a", { name: "Shape1" }), mk("b", { name: "Shape2" }), mk("c")] },
    ];
    expect(findElementsByName(slides, ["Shape1", "Shape2"])).toHaveLength(2);
    const one = findElementsByName(slides, ["Shape1"]);
    expect(one).toHaveLength(1);
    expect(one[0].name).toBe("Shape1");
  });
});

describe("OnlyOffice parity: outline", () => {
  // CreateStroke(25400 EMU = 2 pt, red) → SetOutLine returns true and the
  // shape's outline is 2 pt red; null / {} are rejected (false, unchanged).
  it("oo:slide/js-api/api-drawing.js#Test: SetOutLine", () => {
    const shape = mk("r", { fill: "#646464", stroke: "none", strokeWidth: 0 });
    expect(shape.stroke).toBe("none");
    const r = setOutline(shape, { width: 25400 / 12700, color: "#ff0000" });
    expect(r.ok).toBe(true);
    expect(r.el.strokeWidth).toBe(2);
    expect(r.el.stroke).toBe("#ff0000");
    for (const bad of [null, {}, { width: -1, color: "#ff0000" }, { width: 1, color: "red" }]) {
      const b = setOutline(r.el, bad);
      expect(b.ok).toBe(false);
      expect(b.el).toBe(r.el);
    }
    expect(setOutline(r.el, { width: 0, color: "#000000" }).el.stroke).toBe("none");
  });
});

describe("OnlyOffice parity: gradient fill", () => {
  // A "cube" shape (150 × 80 mm) filled solid #333333 is re-filled with a
  // radial gradient of two stops, RGB(255,213,191) at 0 and RGB(255,111,61)
  // at 100%: the shape now holds a gradient fill of exactly those two
  // colours, in order.
  it("oo:slide/js-api/api-drawing.js#Test: Create shape with gradient fill", () => {
    const mm = 96 / 25.4;
    const cube: SlideElement = { ...newShape("cube"), id: "cube", w: 150 * mm, h: 80 * mm, fill: "#333333", stroke: "none", strokeWidth: 0 };
    const r = setGradientFill(cube, {
      kind: "gradient",
      radial: true,
      stops: [
        { pos: 1, color: "#ff6f3d" },
        { pos: 0, color: "#ffd5bf" },
      ],
    });
    expect(r.ok).toBe(true);
    const g = r.el.gradFill!;
    expect(g.radial).toBe(true);
    expect(g.stops).toHaveLength(2);
    expect(g.stops.map((s) => s.color)).toEqual(["#ffd5bf", "#ff6f3d"]);
    const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    expect(rgb(g.stops[0].color)).toEqual([255, 213, 191]);
    expect(rgb(g.stops[1].color)).toEqual([255, 111, 61]);
    // The fallback colour is the first stop; malformed gradients are refused.
    expect(r.el.fill).toBe("#ffd5bf");
    for (const bad of [null, {}, { kind: "gradient", stops: [{ pos: 0, color: "#fff" }] }, { kind: "gradient", stops: [{ pos: 0, color: "#ffffff" }, { pos: 2, color: "#000000" }] }]) {
      const b = setGradientFill(r.el, bad);
      expect(b.ok).toBe(false);
      expect(b.el).toBe(r.el);
    }
    // Drawn with an SVG gradient; a solid colour replaces it again.
    expect(shapeLayers(r.el).some((l) => l.gradient)).toBe(true);
    expect(shapeLayersMarkup(r.el)).toMatch(/<radialGradient id="g-grad-cube"[^>]*><stop offset="0%" stop-color="#ffd5bf"\/><stop offset="100%" stop-color="#ff6f3d"\/>/);
    expect(shapeLayersMarkup(r.el)).toContain('fill="url(#g-grad-cube)"');
    const solid = setSolidFill(r.el, "#00ff00");
    expect(solid.gradFill).toBeUndefined();
    expect(shapeLayersMarkup(solid)).not.toContain("Gradient");
  });

  it("round-trips a shape gradient through pptx", async () => {
    const cube = setGradientFill(
      { ...newShape("cube"), id: "c", fill: "#333333" },
      { kind: "gradient", radial: true, stops: [{ pos: 0, color: "#ffd5bf" }, { pos: 1, color: "#ff6f3d" }] },
    ).el;
    const lin = setGradientFill(
      { ...newShape("roundRect"), id: "l", x: 400 },
      { kind: "gradient", angle: 45, stops: [{ pos: 0, color: "#112233" }, { pos: 0.5, color: "#445566" }, { pos: 1, color: "#778899" }] },
    ).el;
    const bytes = await deckToPptx({ slides: [{ id: "s", background: "#ffffff", elements: [cube, lin] }] });
    const { deck } = await readPptx(bytes);
    const els = deck.slides[0].elements.filter((e) => e.gradFill);
    expect(els).toHaveLength(2);
    expect(els[0].gradFill).toEqual({ kind: "gradient", radial: true, stops: [{ pos: 0, color: "#ffd5bf" }, { pos: 1, color: "#ff6f3d" }] });
    expect(els[1].gradFill).toEqual({ kind: "gradient", angle: 45, stops: [{ pos: 0, color: "#112233" }, { pos: 0.5, color: "#445566" }, { pos: 1, color: "#778899" }] });
    expect(els[1].fill).toBe("#112233");
  });
});
