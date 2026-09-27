import { describe, it, expect } from "vitest";
import {
  HANDLES,
  MIN_CANVAS_PX,
  MIN_ELEMENT_SIZE,
  canvasHeight,
  canvasScale,
  dragElement,
  fitCanvasWidth,
  fitPresentWidth,
  handleCursor,
  handlePosition,
  screenToLogical,
} from "./geometry";
import { CANVAS_W, newElement, type SlideElement } from "./model";

const box: SlideElement = { ...newElement("rect"), x: 100, y: 100, w: 200, h: 100 };
const xywh = (e: SlideElement) => [e.x, e.y, e.w, e.h];

describe("dragElement", () => {
  it("moves the whole element", () => {
    expect(xywh(dragElement(box, "move", 15, -20))).toEqual([115, 80, 200, 100]);
  });

  it("resizes from east/south edges without moving the origin", () => {
    expect(xywh(dragElement(box, "e", 30, 999))).toEqual([100, 100, 230, 100]);
    expect(xywh(dragElement(box, "s", 999, 30))).toEqual([100, 100, 200, 130]);
    expect(xywh(dragElement(box, "se", 10, 20))).toEqual([100, 100, 210, 120]);
  });

  it("resizes from west/north edges keeping the opposite edge fixed", () => {
    expect(xywh(dragElement(box, "w", 50, 0))).toEqual([150, 100, 150, 100]);
    expect(xywh(dragElement(box, "n", 0, -40))).toEqual([100, 60, 200, 140]);
    expect(xywh(dragElement(box, "nw", -10, -10))).toEqual([90, 90, 210, 110]);
  });

  it("clamps to the minimum size, pinning the far edge", () => {
    const w = dragElement(box, "w", 1000, 0);
    expect(w.w).toBe(MIN_ELEMENT_SIZE);
    expect(w.x + w.w).toBe(box.x + box.w);
    expect(dragElement(box, "e", -1000, 0).w).toBe(MIN_ELEMENT_SIZE);
    expect(dragElement(box, "s", 0, -1000).h).toBe(MIN_ELEMENT_SIZE);
    const n = dragElement(box, "n", 0, 1000);
    expect(n.h).toBe(MIN_ELEMENT_SIZE);
    expect(n.y + n.h).toBe(box.y + box.h);
  });

  it("lets a line collapse to zero height from the south edge", () => {
    const line = { ...newElement("line"), h: 5 };
    expect(dragElement(line, "s", 0, -100).h).toBe(0);
  });

  it("does not mutate the start element", () => {
    dragElement(box, "se", 50, 50);
    expect(xywh(box)).toEqual([100, 100, 200, 100]);
  });
});

describe("scale helpers", () => {
  it("converts screen deltas to logical px", () => {
    expect(screenToLogical(30, -15, 0.5)).toEqual({ dx: 60, dy: -30 });
  });
  it("computes scale and 16:9 height", () => {
    expect(canvasScale(CANVAS_W)).toBe(1);
    expect(canvasScale(480)).toBe(0.5);
    expect(canvasHeight(960)).toBe(540);
  });
});

describe("handles", () => {
  it("places the 8 handles on corners and edge midpoints", () => {
    expect(HANDLES).toHaveLength(8);
    expect(handlePosition("nw")).toMatchObject({ top: "0%", left: "0%" });
    expect(handlePosition("se")).toMatchObject({ top: "100%", left: "100%" });
    expect(handlePosition("n")).toMatchObject({ top: "0%", left: "50%" });
    expect(handlePosition("w")).toMatchObject({ top: "50%", left: "0%" });
    expect(handlePosition("e").transform).toBe("translate(-50%, -50%)");
  });
  it("uses matching resize cursors", () => {
    expect(handleCursor("n")).toBe("ns-resize");
    expect(handleCursor("e")).toBe("ew-resize");
    expect(handleCursor("ne")).toBe("nesw-resize");
    expect(handleCursor("sw")).toBe("nesw-resize");
    expect(handleCursor("nw")).toBe("nwse-resize");
    expect(handleCursor("se")).toBe("nwse-resize");
  });
});

describe("fitting", () => {
  it("fits the canvas by width or height, minus stage padding", () => {
    // Wide stage: height-limited. (548-48) * 16/9
    expect(fitCanvasWidth(2000, 548)).toBeCloseTo(500 * (16 / 9));
    // Tall stage: width-limited.
    expect(fitCanvasWidth(848, 2000)).toBe(800);
  });
  it("never shrinks below the minimum", () => {
    expect(fitCanvasWidth(100, 100)).toBe(MIN_CANVAS_PX);
  });
  it("fits present mode to the viewport", () => {
    expect(fitPresentWidth(1920, 1080)).toBe(1920);
    expect(fitPresentWidth(1920, 900)).toBe(1600);
  });
});

describe("zoomStep", () => {
  it("steps through the zoom stops from any scale", async () => {
    const { zoomStep } = await import("./geometry");
    expect(zoomStep(1, 1)).toBe(1.25);
    expect(zoomStep(1, -1)).toBe(0.9);
    expect(zoomStep(0.8, 1)).toBe(0.9); // a fitted 80 % canvas
    expect(zoomStep(0.8, -1)).toBe(0.75);
    expect(zoomStep(4, 1)).toBe(4);
    expect(zoomStep(0.25, -1)).toBe(0.25);
  });
});
