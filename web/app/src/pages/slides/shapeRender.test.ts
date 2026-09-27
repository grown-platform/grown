import { describe, it, expect } from "vitest";
import { newConnector, newShape, type SlideElement } from "./model";
import {
  arrowHeadPath,
  dashArray,
  elementPreset,
  shapeLayers,
  shapeLayersMarkup,
  shapeSvgGroup,
} from "./shapeRender";

describe("shapeLayers", () => {
  it("fills then strokes a preset shape", () => {
    const el = { ...newShape("rect"), w: 100, h: 50, fill: "#ff0000", stroke: "#0000ff", strokeWidth: 2 };
    expect(shapeLayers(el)).toEqual([
      { d: "M0 0 L100 0 L100 50 L0 50 Z", fill: "#ff0000" },
      { d: "M0 0 L100 0 L100 50 L0 50 Z", stroke: "#0000ff", strokeWidth: 2, lineJoin: "miter" },
    ]);
  });

  it("omits fill for 'none' and stroke for no line", () => {
    const el = { ...newShape("ellipse"), fill: "none", stroke: "none" };
    expect(shapeLayers(el)).toEqual([]);
  });

  it("shades darken/lighten paths and skips unfilled ones", () => {
    const layers = shapeLayers({ ...newShape("cube"), stroke: "none" });
    expect(layers.map((l) => l.shade ?? "")).toEqual(["", "rgba(0,0,0,0.2)", "rgba(255,255,255,0.2)"]);
  });

  it("dashes the outline in multiples of the line width", () => {
    expect(dashArray("dash", 2)).toBe("8 6");
    expect(dashArray("sysDot", 3)).toBe("3 3");
    expect(dashArray("solid", 2)).toBeUndefined();
    expect(dashArray(undefined, 2)).toBeUndefined();
    const el = { ...newShape("rect"), dash: "lgDashDot" as const, strokeWidth: 1 };
    expect(shapeLayers(el)[1].dash).toBe("8 3 1 3");
  });

  it("connectors are never filled and get arrowheads at both ends", () => {
    const el: SlideElement = {
      ...newConnector("straightConnector1", { from: [0, 0], to: [100, 0], headEnd: "oval", tailEnd: "triangle" }),
      fill: "#ff0000",
      strokeWidth: 2,
    };
    const layers = shapeLayers(el);
    expect(layers).toHaveLength(3);
    // The line is pulled back under the filled triangle (L/2 = 3.5).
    expect(layers[0]).toMatchObject({ d: "M0 0 L96.5 0", stroke: "#202124" });
    expect(layers[1].fill).toBe("#202124"); // oval
    expect(layers[2]).toEqual({ d: "M100 0 L93 3.5 L93 -3.5 Z", fill: "#202124" });
  });

  it("the markup is a self-contained SVG fragment", () => {
    const el = { ...newShape("triangle"), x: 10, y: 20, w: 100, h: 50, rotation: 90, flipH: true };
    expect(shapeLayersMarkup(el)).toContain('<path d="M0 50 L50 0 L100 50 Z" fill="#4285f4"');
    expect(shapeSvgGroup(el)).toMatch(/^<g transform="translate\(60 45\) rotate\(90\) scale\(-1 1\) translate\(-50 -25\)">/);
  });
});

describe("arrowHeadPath", () => {
  it("draws each head kind along the line direction", () => {
    expect(arrowHeadPath("triangle", [100, 0], [0, 0], 2)).toEqual({
      d: "M100 0 L93 3.5 L93 -3.5 Z",
      filled: true,
    });
    // pointing down: the normal is (-1, 0)
    expect(arrowHeadPath("arrow", [0, 100], [0, 0], 2)).toEqual({
      d: "M-3.5 93 L0 100 L3.5 93",
      filled: false,
    });
    expect(arrowHeadPath("stealth", [10, 0], [0, 0], 2)!.d).toBe("M10 0 L3 3.5 L5.8 0 L3 -3.5 Z");
    expect(arrowHeadPath("diamond", [0, 0], [-10, 0], 2)!.d).toBe("M3.5 0 L0 3.5 L-3.5 0 L0 -3.5 Z");
    expect(arrowHeadPath("none", [0, 0], [1, 0], 2)).toBeNull();
    expect(arrowHeadPath("triangle", [0, 0], [0, 0], 2)).toBeNull();
  });
});

describe("elementPreset", () => {
  it("maps legacy shape types to their presets", () => {
    expect(elementPreset(newShape("star5"))).toBe("star5");
    expect(elementPreset({ ...newShape("rect"), type: "roundRect", preset: undefined })).toBe("roundRect");
    expect(elementPreset({ ...newShape("rect"), type: "text", preset: undefined })).toBeUndefined();
  });
});
