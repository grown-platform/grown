import { describe, expect, it } from "vitest";
import { newElement, type SlideElement } from "./model";
import {
  actualSize,
  cropPan,
  cropResize,
  cropShapePath,
  cropToFill,
  cropToFit,
  fitToSlide,
  fullImageRect,
  insertBox,
  normCrop,
  replaceImage,
  resetCrop,
  setAlt,
  setCropShape,
  setOpacity,
} from "./imageOps";

const img = (over: Partial<SlideElement> = {}): SlideElement => ({
  ...newElement("image", "data:image/png;base64,AA=="),
  x: 100,
  y: 100,
  w: 200,
  h: 100,
  ...over,
});

describe("crop maths", () => {
  it("normCrop clamps and keeps a visible strip", () => {
    expect(normCrop({ l: -0.1, t: 0.2, r: 0.3, b: 2 })).toEqual({ l: 0, t: 0.2, r: 0.3, b: 0.78 });
    expect(normCrop({ l: 0.6, t: 0, r: 0.6, b: 0 })).toEqual({ l: 0.6, t: 0, r: 0.38, b: 0 });
  });

  it("the full picture extends past the box by the crop", () => {
    const el = img({ crop: { l: 0.25, t: 0, r: 0.25, b: 0.5 } });
    expect(fullImageRect(el)).toEqual({ x: -100, y: 0, w: 400, h: 200 });
  });

  it("dragging the left crop handle crops without moving the picture", () => {
    const el = cropResize(img(), "w", 50, 0);
    expect(el).toMatchObject({ x: 150, w: 150, crop: { l: 0.25, t: 0, r: 0, b: 0 } });
    // the picture itself stays put
    expect(el.x + fullImageRect(el).x).toBeCloseTo(100);
    // dragging back past the picture's edge stops at the edge
    const back = cropResize(el, "w", -500, 0);
    expect(back).toMatchObject({ x: 100, w: 200, crop: { l: 0 } });
  });

  it("corner handles crop two sides", () => {
    const el = cropResize(img(), "se", -100, -50);
    expect(el).toMatchObject({ w: 100, h: 50, crop: { l: 0, t: 0, r: 0.5, b: 0.5 } });
  });

  it("panning moves the picture inside the crop box, within the picture", () => {
    const el = img({ w: 100, crop: { l: 0.25, t: 0, r: 0.25, b: 0 } });
    expect(cropPan(el, 50, 0).crop).toEqual({ l: 0, t: 0, r: 0.5, b: 0 });
    expect(cropPan(el, -1000, 0).crop).toEqual({ l: 0.5, t: 0, r: 0, b: 0 });
  });

  it("reset crop shows the whole picture at the same scale", () => {
    const el = resetCrop(img({ x: 150, w: 150, crop: { l: 0.25, t: 0, r: 0, b: 0 } }));
    expect(el).toMatchObject({ x: 100, y: 100, w: 200, h: 100 });
    expect(el.crop).toBeUndefined();
  });

  it("fill crops the overflowing axis evenly; fit shrinks the box", () => {
    expect(cropToFill(img({ w: 100, h: 100 }), { w: 400, h: 200 }).crop).toEqual({ l: 0.25, t: 0, r: 0.25, b: 0 });
    expect(cropToFill(img({ w: 200, h: 100 }), { w: 100, h: 100 }).crop).toEqual({ l: 0, t: 0.25, r: 0, b: 0.25 });
    expect(cropToFit(img({ w: 200, h: 200 }), { w: 400, h: 200 })).toMatchObject({ x: 100, y: 150, w: 200, h: 100 });
  });
});

describe("sizes", () => {
  it("insert box keeps the picture's proportions within 60 % of the slide", () => {
    expect(insertBox({ w: 200, h: 100 })).toEqual({ x: 380, y: 220, w: 200, h: 100 });
    expect(insertBox({ w: 4000, h: 1000 })).toEqual({ x: 192, y: 198, w: 576, h: 144 });
    expect(insertBox(null)).toEqual({ x: 320, y: 170, w: 320, h: 200 });
  });

  it("actual size uses the natural size of the visible part, capped to the slide", () => {
    expect(actualSize(img({ crop: { l: 0.5, t: 0, r: 0, b: 0 } }), { w: 400, h: 300 })).toMatchObject({ w: 200, h: 300 });
    expect(actualSize(img(), { w: 1920, h: 1080 })).toMatchObject({ w: 960, h: 540 });
  });

  it("fit to slide centres the picture at the largest size", () => {
    expect(fitToSlide(img({ rotation: 30 }), { w: 100, h: 100 })).toMatchObject({ x: 210, y: 0, w: 540, h: 540, rotation: undefined });
  });

  it("replace keeps the box area, fitted to the new proportions, and drops the crop", () => {
    const el = replaceImage(img({ crop: { l: 0.1, t: 0, r: 0, b: 0 } }), "/x.png", { w: 100, h: 100 });
    expect(el).toMatchObject({ src: "/x.png", x: 150, y: 100, w: 100, h: 100 });
    expect(el.crop).toBeUndefined();
  });
});

describe("properties", () => {
  it("opacity clamps; 1 removes it", () => {
    expect(setOpacity(img(), 0.456).opacity).toBe(0.46);
    expect(setOpacity(img(), -1).opacity).toBe(0);
    expect(setOpacity(img({ opacity: 0.5 }), 1).opacity).toBeUndefined();
  });

  it("alt text trims; blank removes it", () => {
    expect(setAlt(img(), "  A cat ").alt).toBe("A cat");
    expect(setAlt(img({ alt: "x" }), " ").alt).toBeUndefined();
  });

  it("crop to shape uses the preset geometry as the clip path", () => {
    const el = setCropShape(img({ w: 100, h: 100 }), "ellipse");
    expect(el.cropShape).toBe("ellipse");
    expect(cropShapePath(el)).toMatch(/^M/);
    expect(setCropShape(el, "rect").cropShape).toBeUndefined();
    expect(setCropShape(el, "notAPreset").cropShape).toBeUndefined();
    const tri = setCropShape(img({ w: 100, h: 100 }), "triangle");
    expect(cropShapePath(tri)).toBe("M0 100 L50 0 L100 100 Z");
  });
});
