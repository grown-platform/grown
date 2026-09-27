import { describe, it, expect } from "vitest";
import {
  CANVAS_W,
  CANVAS_H,
  SHAPE_TYPES,
  defaultDeck,
  elementTransform,
  isShape,
  connectorBox,
  newConnector,
  newElement,
  newShape,
  newSlide,
  presetDefaultSize,
  newTable,
  parseDeck,
  shapeClipPath,
  titleSlide,
  uid,
  type ElementType,
} from "./model";

describe("canvas", () => {
  it("is a 16:9 logical canvas", () => {
    expect(CANVAS_W / CANVAS_H).toBeCloseTo(16 / 9);
  });
});

describe("parseDeck", () => {
  it("falls back to a default one-slide deck for missing/invalid data", () => {
    for (const bad of [undefined, "", "not json", "{}", '{"slides":[]}', "null", '{"slides":"x"}']) {
      const d = parseDeck(bad);
      expect(d.slides).toHaveLength(1);
      expect(d.slides[0].elements.map((e) => e.text)).toEqual([
        "Click to add title",
        "Click to add subtitle",
      ]);
    }
  });

  it("returns a valid saved deck unchanged", () => {
    const saved = { slides: [{ id: "s1", background: "#000", elements: [] }] };
    expect(parseDeck(JSON.stringify(saved))).toEqual(saved);
  });
});

describe("slide constructors", () => {
  it("newSlide is blank with the given background", () => {
    const s = newSlide("#123456");
    expect(s.background).toBe("#123456");
    expect(s.elements).toEqual([]);
    expect(newSlide().background).toBe("#ffffff");
  });

  it("titleSlide has centred title and subtitle placeholders", () => {
    const s = titleSlide();
    expect(s.elements).toHaveLength(2);
    expect(s.elements.every((e) => e.type === "text" && e.align === "center")).toBe(true);
    expect(s.elements[0].fontSize).toBeGreaterThan(s.elements[1].fontSize!);
  });

  it("defaultDeck starts with a title slide", () => {
    expect(defaultDeck().slides).toHaveLength(1);
  });

  it("uid returns short distinct ids", () => {
    const ids = new Set(Array.from({ length: 200 }, uid));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id.length).toBe(8);
  });
});

describe("newElement defaults", () => {
  const types: ElementType[] = [
    "text", "rect", "ellipse", "image", "line", "triangle", "diamond", "rightArrow", "roundRect", "table",
  ];

  it("creates every type at the default position with a fresh id", () => {
    for (const t of types) {
      const a = newElement(t);
      const b = newElement(t);
      expect(a.type).toBe(t);
      expect(a.x).toBe(360);
      expect(a.y).toBe(220);
      expect(a.id).not.toBe(b.id);
    }
  });

  it("gives text sensible typography", () => {
    const e = newElement("text");
    expect(e).toMatchObject({ text: "Text", fontSize: 18, align: "left", valign: "top", fontFamily: "Arial", w: 240, h: 100 });
  });

  it("gives legacy shapes a fill and no stroke", () => {
    for (const t of SHAPE_TYPES.filter((x) => x !== "shape")) {
      const e = newElement(t);
      expect(e.fill).toMatch(/^#[0-9a-f]{6}$/);
      expect(e.stroke).toBe("none");
    }
  });

  it("gives preset shapes a fill and a thin outline, sized per preset", () => {
    expect(newElement("shape")).toMatchObject({ type: "shape", preset: "rect", fill: "#4285f4", strokeWidth: 1 });
    expect(newShape("star5")).toMatchObject({ w: 160, h: 160, x: 400, y: 190 });
    expect(newShape("upArrow")).toMatchObject({ w: 120, h: 200 });
    expect(newShape("flowChartProcess", { x: 1, y: 2, w: 3, h: 4 })).toMatchObject({ x: 1, y: 2, w: 3, h: 4 });
    expect(presetDefaultSize("chevron")).toEqual({ w: 240, h: 120 });
  });

  it("connectors span two points; flips pick the diagonal", () => {
    expect(newElement("connector")).toMatchObject({ type: "connector", preset: "straightConnector1", x: 360, y: 270, w: 240, h: 0 });
    const c = newConnector("bentConnector3", { from: [500, 400], to: [100, 100], tailEnd: "triangle", headEnd: "none" });
    expect(c).toMatchObject({ x: 100, y: 100, w: 400, h: 300, flipH: true, flipV: true, tailEnd: "triangle" });
    expect(c.headEnd).toBeUndefined();
    expect(connectorBox(0, 0, 10.004, 5)).toMatchObject({ w: 10, h: 5, flipH: undefined });
  });

  it("makes lines zero-height with a stroke", () => {
    expect(newElement("line")).toMatchObject({ h: 0, w: 280, strokeWidth: 3 });
  });

  it("carries the image source", () => {
    expect(newElement("image", "data:x").src).toBe("data:x");
    expect(newElement("image").src).toBe("");
  });

  it("creates a 3x3 empty table", () => {
    const e = newElement("table");
    expect(e.table).toEqual(newTable(3, 3));
    expect(e.table!.cells.flat().every((c) => c === "")).toBe(true);
  });
});

describe("newTable", () => {
  it("builds independent rows", () => {
    const t = newTable(2, 4);
    expect(t.rows).toBe(2);
    expect(t.cols).toBe(4);
    t.cells[0][0] = "x";
    expect(t.cells[1][0]).toBe("");
  });
});

describe("shapes", () => {
  it("isShape covers the fill/stroke shapes only", () => {
    expect(isShape("rect")).toBe(true);
    expect(isShape("roundRect")).toBe(true);
    expect(isShape("text")).toBe(false);
    expect(isShape("line")).toBe(false);
    expect(isShape("image")).toBe(false);
    expect(isShape("table")).toBe(false);
  });

  it("shapeClipPath is a polygon only for non-box shapes", () => {
    expect(shapeClipPath("triangle")).toMatch(/^polygon\(/);
    expect(shapeClipPath("diamond")).toMatch(/^polygon\(/);
    expect(shapeClipPath("rightArrow")).toMatch(/^polygon\(/);
    expect(shapeClipPath("rect")).toBeUndefined();
    expect(shapeClipPath("ellipse")).toBeUndefined();
    expect(shapeClipPath("roundRect")).toBeUndefined();
  });
});

describe("elementTransform", () => {
  const base = newElement("rect");
  it("is undefined for an upright, unflipped element", () => {
    expect(elementTransform(base)).toBeUndefined();
    expect(elementTransform({ ...base, rotation: 0 })).toBeUndefined();
  });
  it("combines rotation and flips", () => {
    expect(elementTransform({ ...base, rotation: 90 })).toBe("rotate(90deg)");
    expect(elementTransform({ ...base, flipH: true })).toBe("scale(-1, 1)");
    expect(elementTransform({ ...base, flipV: true })).toBe("scale(1, -1)");
    expect(elementTransform({ ...base, rotation: 270, flipH: true, flipV: true })).toBe(
      "rotate(270deg) scale(-1, -1)",
    );
  });
});
