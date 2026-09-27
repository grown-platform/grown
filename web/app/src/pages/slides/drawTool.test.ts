import { describe, it, expect } from "vitest";
import { drawnElement, toolFromGalleryId } from "./drawTool";
import { connectorEnds } from "./connectorOps";
import { newShape, type SlideElement } from "./model";

describe("toolFromGalleryId", () => {
  it("parses connector variants", () => {
    expect(toolFromGalleryId("star5")).toEqual({ preset: "star5", kind: "shape" });
    expect(toolFromGalleryId("straightConnector1")).toEqual({ preset: "straightConnector1", kind: "connector" });
    expect(toolFromGalleryId("bentConnector3:arrow")).toEqual({
      preset: "bentConnector3",
      kind: "connector",
      tailEnd: "triangle",
    });
    expect(toolFromGalleryId("straightConnector1:double")).toMatchObject({
      headEnd: "triangle",
      tailEnd: "triangle",
    });
  });
});

describe("drawnElement", () => {
  const star = toolFromGalleryId("star5");
  it("a drag draws the box in any direction; Shift keeps it square", () => {
    expect(drawnElement(star, 300, 200, 100, 150)).toMatchObject({ type: "shape", preset: "star5", x: 100, y: 150, w: 200, h: 50 });
    expect(drawnElement(star, 100, 100, 150, 300, { shift: true })).toMatchObject({ x: 100, y: 100, w: 200, h: 200 });
  });

  it("a click inserts the default size centred on the point", () => {
    expect(drawnElement(star, 400, 300, 401, 301)).toMatchObject({ x: 320, y: 220, w: 160, h: 160 });
  });

  it("connector ends glue to nearby connection sites", () => {
    const a: SlideElement = { ...newShape("rect"), id: "a", x: 0, y: 0, w: 100, h: 50 };
    const b: SlideElement = { ...newShape("rect"), id: "b", x: 300, y: 200, w: 100, h: 50 };
    const c = drawnElement(toolFromGalleryId("bentConnector3:arrow"), 103, 26, 298, 224, { elements: [a, b] });
    expect(c).toMatchObject({ type: "connector", preset: "bentConnector3", tailEnd: "triangle" });
    expect(c.stCxn).toEqual({ id: "a", idx: 3 });
    expect(c.endCxn).toEqual({ id: "b", idx: 1 });
    expect(connectorEnds(c)).toEqual({ start: [100, 25], end: [300, 225] });
  });

  it("a connector click makes a 200 px line", () => {
    const c = drawnElement(toolFromGalleryId("straightConnector1"), 100, 100, 100, 100);
    expect(connectorEnds(c)).toEqual({ start: [100, 100], end: [300, 100] });
    expect(c.stCxn).toBeUndefined();
  });
});
