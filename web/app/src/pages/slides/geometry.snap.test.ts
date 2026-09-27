import { describe, it, expect } from "vitest";
import {
  dragElement,
  elementBounds,
  guidesFor,
  hitTest,
  marqueeSelect,
  normalizeRect,
  pointInElement,
  rectContains,
  rectsIntersect,
  resizeBox,
  resizeSelection,
  rotatePoint,
  selectionBounds,
  setElementBox,
  snapMove,
  snapResize,
  snapTargets,
  unionRects,
} from "./geometry";
import { CANVAS_H, CANVAS_W, newElement, type SlideElement } from "./model";

function el(id: string, x: number, y: number, w: number, h: number, over: Partial<SlideElement> = {}): SlideElement {
  return { ...newElement("rect"), id, x, y, w, h, ...over };
}
const xywh = (e: { x: number; y: number; w: number; h: number }) => [e.x, e.y, e.w, e.h];

describe("bounds", () => {
  it("is the element box when upright", () => {
    expect(elementBounds(el("a", 10, 20, 100, 50))).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });
  it("swaps extents at 90° about the centre", () => {
    expect(xywh(elementBounds(el("a", 0, 0, 100, 50, { rotation: 90 })))).toEqual([25, -25, 50, 100]);
  });
  it("grows at 45°", () => {
    const b = elementBounds(el("a", 0, 0, 100, 100, { rotation: 45 }));
    expect(b.w).toBeCloseTo(141.421356, 5);
    expect(b.x).toBeCloseTo(50 - 70.710678, 5);
  });
  it("union covers every rect; empty → null", () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: -5, w: 5, h: 5 }])).toEqual({ x: 0, y: -5, w: 25, h: 15 });
    expect(selectionBounds([el("a", 10, 10, 10, 10), el("b", 30, 40, 10, 10)])).toEqual({ x: 10, y: 10, w: 30, h: 40 });
  });
  it("normalises marquee corners dragged in any direction", () => {
    expect(normalizeRect(50, 60, 10, 20)).toEqual({ x: 10, y: 20, w: 40, h: 40 });
  });
  it("contains and intersects", () => {
    const outer = { x: 0, y: 0, w: 100, h: 100 };
    expect(rectContains(outer, { x: 10, y: 10, w: 90, h: 90 })).toBe(true);
    expect(rectContains(outer, { x: 10, y: 10, w: 91, h: 90 })).toBe(false);
    expect(rectsIntersect(outer, { x: 100, y: 100, w: 5, h: 5 })).toBe(true);
    expect(rectsIntersect(outer, { x: 101, y: 0, w: 5, h: 5 })).toBe(false);
  });
  it("rotatePoint turns clockwise on a y-down screen", () => {
    expect(rotatePoint(10, 0, 0, 0, 90)).toEqual({ x: 0, y: 10 });
  });
});

describe("marqueeSelect", () => {
  const els = [el("a", 10, 10, 50, 50), el("b", 100, 10, 50, 50), el("c", 40, 40, 100, 100)];
  it("selects only fully enclosed elements, in z-order", () => {
    expect(marqueeSelect(els, normalizeRect(0, 0, 160, 70))).toEqual(["a", "b"]);
  });
  it("intersect mode selects anything touched", () => {
    expect(marqueeSelect(els, { x: 0, y: 0, w: 45, h: 45 }, "intersect")).toEqual(["a", "c"]);
  });
  it("uses rotated bounds", () => {
    const r = el("r", 100, 100, 100, 20, { rotation: 90 });
    // Upright box fits a wide marquee; the rotated one (140..160 × 50..150) does not.
    expect(marqueeSelect([r], { x: 90, y: 95, w: 120, h: 30 })).toEqual([]);
    expect(marqueeSelect([r], { x: 130, y: 40, w: 40, h: 120 })).toEqual(["r"]);
  });
});

describe("hitTest", () => {
  const els = [el("bottom", 0, 0, 100, 100), el("top", 50, 50, 100, 100)];
  it("returns the topmost element under the point", () => {
    expect(hitTest(els, 75, 75)).toBe("top");
    expect(hitTest(els, 10, 10)).toBe("bottom");
    expect(hitTest(els, 500, 500)).toBeNull();
  });
  it("honours rotation", () => {
    const r = el("r", 0, 40, 100, 20, { rotation: 90 });
    expect(pointInElement(r, 5, 50)).toBe(false);
    expect(pointInElement(r, 50, 5)).toBe(true);
  });
  it("gives 0-height lines a clickable band", () => {
    const ln = { ...newElement("line"), id: "l", x: 0, y: 50, w: 100, h: 0 };
    expect(pointInElement(ln, 50, 53)).toBe(true);
    expect(pointInElement(ln, 50, 60)).toBe(false);
  });
  it("hits a group as a whole", () => {
    const g: SlideElement = { ...el("g", 0, 0, 200, 100), type: "group", children: [el("k1", 0, 0, 50, 50), el("k2", 150, 50, 50, 50)] };
    expect(hitTest([g], 100, 50)).toBe("g");
  });
});

describe("setElementBox / group scaling", () => {
  const g: SlideElement = {
    ...el("g", 100, 100, 200, 100),
    type: "group",
    children: [el("k1", 100, 100, 100, 50), el("k2", 200, 150, 100, 50)],
  };
  it("moving a group moves its children", () => {
    const m = dragElement(g, "move", 10, 20);
    expect(xywh(m)).toEqual([110, 120, 200, 100]);
    expect(m.children!.map(xywh)).toEqual([[110, 120, 100, 50], [210, 170, 100, 50]]);
  });
  it("resizing a group scales children into the new box", () => {
    const r = dragElement(g, "se", 200, 100); // 2x
    expect(xywh(r)).toEqual([100, 100, 400, 200]);
    expect(r.children!.map(xywh)).toEqual([[100, 100, 200, 100], [300, 200, 200, 100]]);
  });
  it("resizing from the west keeps the east edge and mirrors the scale", () => {
    const r = dragElement(g, "w", 100, 0); // width 200 → 100
    expect(xywh(r)).toEqual([200, 100, 100, 100]);
    expect(r.children!.map(xywh)).toEqual([[200, 100, 50, 50], [250, 150, 50, 50]]);
  });
  it("nested groups scale recursively; fonts and strokes don't", () => {
    const inner: SlideElement = { ...g, id: "in", children: [{ ...g.children![0], strokeWidth: 3 }] };
    const outer: SlideElement = { ...el("o", 100, 100, 200, 100), type: "group", children: [inner] };
    const r = setElementBox(outer, { x: 0, y: 0, w: 400, h: 200 });
    expect(xywh(r.children![0].children![0])).toEqual([0, 0, 200, 100]);
    expect(r.children![0].children![0].strokeWidth).toBe(3);
  });
});

describe("resize helpers", () => {
  it("resizeBox keeps the opposite edge fixed", () => {
    expect(resizeBox({ x: 0, y: 0, w: 100, h: 100 }, "nw", 20, 30)).toEqual({ x: 20, y: 30, w: 80, h: 70 });
    expect(resizeBox({ x: 0, y: 0, w: 100, h: 100 }, "e", -500, 0)).toEqual({ x: 0, y: 0, w: 10, h: 100 });
  });
  it("resizeSelection scales every element into the new union box", () => {
    const a = el("a", 0, 0, 100, 100);
    const b = el("b", 100, 100, 100, 100);
    const out = resizeSelection([a, b], { x: 0, y: 0, w: 100, h: 100 });
    expect(out.map(xywh)).toEqual([[0, 0, 50, 50], [50, 50, 50, 50]]);
  });
});

describe("snapping", () => {
  const other = el("o", 300, 200, 100, 100);
  const targets = snapTargets([other, el("me", 0, 0, 10, 10)], new Set(["me"]));
  it("snapTargets excludes the dragged elements", () => {
    expect(targets).toEqual([{ x: 300, y: 200, w: 100, h: 100 }]);
  });
  it("locks the left edge onto another element's left edge within the threshold", () => {
    const r = snapMove({ x: 296, y: 400, w: 50, h: 50 }, targets, { guides: true });
    expect(r.dx).toBe(4);
    expect(r.guides).toContainEqual({ axis: "x", pos: 300, from: 200, to: 450 });
  });
  it("snaps the centre to the slide centre", () => {
    const r = snapMove({ x: CANVAS_W / 2 - 25 + 3, y: 10, w: 50, h: 20 }, [], { guides: true });
    expect(r.dx).toBe(-3);
    expect(r.guides).toContainEqual({ axis: "x", pos: CANVAS_W / 2, from: 0, to: CANVAS_H });
  });
  it("snaps edges to the slide edges", () => {
    const r = snapMove({ x: 2, y: CANVAS_H - 52, w: 50, h: 50 }, [], { guides: true });
    expect([r.dx, r.dy]).toEqual([-2, 2]);
  });
  it("picks the nearest candidate and ignores anything past the threshold", () => {
    expect(snapMove({ x: 280, y: 400, w: 10, h: 10 }, targets, { guides: true }).dx).toBe(0);
    // right edge 399 → 400 (1px) beats left edge 389 → ... nothing
    expect(snapMove({ x: 389, y: 400, w: 10, h: 10 }, targets, { guides: true }).dx).toBe(1);
  });
  it("falls back to the grid, and does nothing when disabled", () => {
    expect(snapMove({ x: 107, y: 33, w: 10, h: 10 }, [], { grid: 20 })).toEqual({ dx: -7, dy: 7, guides: [] });
    expect(snapMove({ x: 107, y: 33, w: 10, h: 10 }, targets, {})).toEqual({ dx: 0, dy: 0, guides: [] });
  });
  it("snapResize moves only the dragged edges", () => {
    const r = snapResize({ x: 250, y: 250, w: 147, h: 20 }, "e", targets, { guides: true });
    expect(r.box).toEqual({ x: 250, y: 250, w: 150, h: 20 });
    const w = snapResize({ x: 303, y: 250, w: 50, h: 20 }, "w", targets, { guides: true });
    expect(w.box).toEqual({ x: 300, y: 250, w: 53, h: 20 });
    const g = snapResize({ x: 0, y: 0, w: 47, h: 47 }, "se", [], { grid: 20 });
    expect(g.box).toEqual({ x: 0, y: 0, w: 40, h: 40 });
  });
  it("guidesFor reports every aligned line once", () => {
    const g = guidesFor({ x: 300, y: 0, w: 100, h: 50 }, targets);
    expect(g.filter((x) => x.axis === "x").map((x) => x.pos).sort((a, b) => a - b)).toEqual([300, 350, 400]);
  });
});
