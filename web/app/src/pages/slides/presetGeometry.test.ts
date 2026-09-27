import { describe, it, expect } from "vitest";
import {
  builtinGuides,
  evalFormula,
  evaluatePreset,
  geometryBounds,
  hasPreset,
  pathEnds,
  samplePoints,
  solveHandle,
} from "./presetGeometry";
import { PRESET_DEFS, PRESET_GALLERY } from "./presetDefs";

const env = { ...builtinGuides(200, 100), a: 3, b: 4, c: -2, z: 0 };
const ev = (f: string) => evalFormula(f, env);

describe("guide formulas (ECMA-376 §20.1.9.11)", () => {
  it("evaluates the 17 operators", () => {
    expect(ev("*/ a b 2")).toBe(6);
    expect(ev("+- a b 1")).toBe(6);
    expect(ev("+/ a b 7")).toBe(1);
    expect(ev("?: a 10 20")).toBe(10);
    expect(ev("?: z 10 20")).toBe(20); // 0 is not > 0
    expect(ev("?: c 10 20")).toBe(20);
    expect(ev("abs c")).toBe(2);
    expect(ev("at2 1 1")).toBeCloseTo(2700000, 6); // 45° in 60000ths
    expect(ev("at2 -1 0")).toBeCloseTo(10800000, 6);
    expect(ev("cat2 10 a b")).toBeCloseTo(6, 9); // 10·cos(atan2(4,3))
    expect(ev("sat2 10 a b")).toBeCloseTo(8, 9);
    expect(ev("cos 10 5400000")).toBeCloseTo(0, 9);
    expect(ev("sin 10 5400000")).toBeCloseTo(10, 9);
    expect(ev("tan 10 2700000")).toBeCloseTo(10, 9);
    expect(ev("max a b")).toBe(4);
    expect(ev("min a c")).toBe(-2);
    expect(ev("mod a b 0")).toBe(5);
    expect(ev("pin 0 c 10")).toBe(0);
    expect(ev("pin 0 50 10")).toBe(10);
    expect(ev("pin 0 a 10")).toBe(3);
    expect(ev("sqrt 16")).toBe(4);
    expect(ev("val 42")).toBe(42);
  });

  it("resolves built-in guides", () => {
    expect(ev("val ss")).toBe(100);
    expect(ev("val ls")).toBe(200);
    expect(ev("val wd4")).toBe(50);
    expect(ev("val hd3")).toBeCloseTo(33.333, 3);
    expect(ev("val 3cd4")).toBe(16200000);
    expect(ev("*/ w 1 2")).toBe(100);
  });

  it("rejects unknown guides and operators", () => {
    expect(() => ev("val nope")).toThrow();
    expect(() => ev("pow a b")).toThrow();
  });
});

const pts = (d: string) => d;

describe("preset paths (hand-computed from the spec formulas)", () => {
  it("rect", () => {
    const g = evaluatePreset("rect", 100, 50)!;
    expect(g.paths[0].d).toBe(pts("M0 0 L100 0 L100 50 L0 50 Z"));
    expect(g.textRect).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });

  it("roundRect: corner radius = ss·adj/100000, text rect inset by r·(1−√½)", () => {
    const g = evaluatePreset("roundRect", 200, 100)!;
    // x1 = 100 · 16667/100000 = 16.667
    expect(g.paths[0].d.startsWith("M0 16.67 C")).toBe(true);
    expect(g.textRect.x).toBeCloseTo(16.667 * 0.29289, 3);
    expect(g.handles[0]).toMatchObject({ x: 16.667, y: 0 });
    const b = geometryBounds(g);
    expect(b.x).toBeCloseTo(0, 6);
    expect(b.w).toBeCloseTo(200, 6);
    expect(b.h).toBeCloseTo(100, 6);
  });

  it("ellipse: every sampled point lies on the ellipse", () => {
    const g = evaluatePreset("ellipse", 200, 100)!;
    for (const [x, y] of samplePoints(g.paths[0].segs)) {
      const r = ((x - 100) / 100) ** 2 + ((y - 50) / 50) ** 2;
      expect(r).toBeGreaterThan(0.999);
      expect(r).toBeLessThan(1.001);
    }
    const b = geometryBounds(g);
    expect(b.w).toBeCloseTo(200, 1);
    expect(b.h).toBeCloseTo(100, 1);
    // cxn at 45°: hc ± wd2·cos45
    expect(g.cxn[1].x).toBeCloseTo(100 - 100 * Math.SQRT1_2, 6);
  });

  it("triangle: apex follows adj (x2 = w·adj/100000)", () => {
    const g = evaluatePreset("triangle", 200, 100, { adj: 25000 })!;
    expect(g.paths[0].d).toBe("M0 100 L50 0 L200 100 Z");
    expect(g.handles[0]).toMatchObject({ x: 50, y: 0 });
  });

  it("rightArrow default: head 50 px long, shaft half the height", () => {
    const g = evaluatePreset("rightArrow", 200, 100)!;
    expect(g.paths[0].d).toBe("M0 25 L150 25 L150 0 L200 50 L150 100 L150 75 L0 75 Z");
    // dx2 = y1·dx1/hd2 = 25·50/50 → text rect right edge at 175
    expect(g.textRect).toEqual({ x: 0, y: 25, w: 175, h: 50 });
    expect(g.handles.map((h) => [h.x, h.y])).toEqual([
      [0, 25],
      [150, 0],
    ]);
  });

  it("star5 fills its box: top point at hc, outer points reach l/r/b", () => {
    const g = evaluatePreset("star5", 100, 100)!;
    const b = geometryBounds(g);
    expect(b.x).toBeCloseTo(0, 3); // hc − wd2·1.05146·cos18° = 0
    expect(b.y).toBeCloseTo(0, 6);
    expect(b.w).toBeCloseTo(100, 3);
    expect(b.h).toBeCloseTo(100, 3); // svc + shd2·sin54°·… = h
    expect(g.cxn[0]).toMatchObject({ x: 50, y: 0, ang: 270 });
  });

  it("pie default: 270° clockwise sweep from 0° back to the top", () => {
    const g = evaluatePreset("pie", 100, 100)!;
    const segs = g.paths[0].segs;
    expect(segs[0]).toEqual({ c: "M", p: [100, 50] });
    const arcEnd = segs[segs.length - 3]; // …C (end of arc) L centre Z
    expect(arcEnd.c).toBe("C");
    if (arcEnd.c === "C") {
      expect(arcEnd.p[4]).toBeCloseTo(50, 6);
      expect(arcEnd.p[5]).toBeCloseTo(0, 6);
    }
    expect(segs.at(-2)).toEqual({ c: "L", p: [50, 50] });
  });

  it("path w/h scales flowchart coordinates", () => {
    expect(evaluatePreset("flowChartDecision", 100, 60)!.paths[0].d).toBe(
      "M0 30 L50 0 L100 30 L50 60 Z",
    );
    const doc = evaluatePreset("flowChartDocument", 216, 216)!;
    expect(doc.paths[0].d.startsWith("M0 0 L216 0 L216 173.22 C108 173.22")).toBe(true);
  });

  it("wedgeRectCallout default: tail below-left, wedge on the bottom edge", () => {
    const g = evaluatePreset("wedgeRectCallout", 120, 80)!;
    // xPos = 60 − 25 = 35, yPos = 40 + 50 = 90; base at w·5/12 … w·2/12
    expect(g.handles[0].x).toBeCloseTo(35, 2);
    expect(g.handles[0].y).toBe(90);
    expect(g.paths[0].d).toContain("L50 80 L35 90 L20 80");
    expect(geometryBounds(g).h).toBeCloseTo(90, 6);
  });

  it("wedgeEllipseCallout: the tail tip is on the path, the rest is on the ellipse", () => {
    const g = evaluatePreset("wedgeEllipseCallout", 200, 100)!;
    const segs = g.paths[0].segs;
    expect(segs[1]).toEqual({ c: "L", p: [100 - 41.666, 50 + 62.5] });
    const arc = samplePoints(segs.slice(2));
    for (const [x, y] of arc.slice(1)) {
      const r = ((x - 100) / 100) ** 2 + ((y - 50) / 50) ** 2;
      expect(Math.abs(r - 1)).toBeLessThan(0.002);
    }
  });

  it("can: body, lighter top ellipse and an unfilled outline", () => {
    const g = evaluatePreset("can", 100, 200)!;
    expect(g.paths.map((p) => [p.fill, p.stroke])).toEqual([
      ["norm", false],
      ["lighten", false],
      ["none", true],
    ]);
    expect(g.handles[0]).toMatchObject({ x: 50, y: 25 }); // y2 = 2·ss·adj/200000
  });

  it("bentConnector3: elbow at adj1, handle on the middle segment", () => {
    const g = evaluatePreset("bentConnector3", 200, 100, { adj1: 25000 })!;
    expect(g.paths[0].d).toBe("M0 0 L50 0 L50 100 L200 100");
    expect(g.handles[0]).toMatchObject({ x: 50, y: 50 });
    const e = pathEnds(g.paths[0].segs)!;
    expect(e.start).toEqual([0, 0]);
    expect(e.startFrom).toEqual([50, 0]);
    expect(e.end).toEqual([200, 100]);
    expect(e.endFrom).toEqual([50, 100]);
  });

  it("curvedConnector3 ends leave horizontally", () => {
    const e = pathEnds(evaluatePreset("curvedConnector3", 200, 100)!.paths[0].segs)!;
    expect(e.startFrom[1]).toBe(0);
    expect(e.endFrom[1]).toBe(100);
  });

  it("every preset evaluates to finite geometry at several sizes", () => {
    const names = Object.keys(PRESET_DEFS);
    expect(names.length).toBeGreaterThanOrEqual(60);
    for (const n of names)
      for (const [w, h] of [
        [200, 100],
        [50, 300],
        [120, 0],
        [0, 0],
      ]) {
        const g = evaluatePreset(n, w, h)!;
        expect(g, n).toBeTruthy();
        const nums = [
          ...g.paths.flatMap((p) => p.segs.flatMap((s) => ("p" in s ? s.p : []))),
          ...g.handles.flatMap((x) => [x.x, x.y]),
          ...g.cxn.flatMap((c) => [c.x, c.y, c.ang]),
          g.textRect.x,
          g.textRect.w,
        ];
        expect(nums.every(Number.isFinite), `${n} ${w}x${h}`).toBe(true);
        expect(g.paths.every((p) => !p.d.includes("NaN")), n).toBe(true);
      }
  });

  // heart's Bézier control points sit at hc ± 49/48·w, so the spec curve
  // bulges ~0.2 % past the box; allow 1 px.
  it("filled presets stay inside their box (callout tails excepted)", () => {
    for (const n of Object.keys(PRESET_DEFS)) {
      if (/Callout/.test(n)) continue;
      const b = geometryBounds(evaluatePreset(n, 200, 100)!);
      expect(b.x, n).toBeGreaterThanOrEqual(-1);
      expect(b.y, n).toBeGreaterThanOrEqual(-1);
      expect(b.x + b.w, n).toBeLessThanOrEqual(201);
      expect(b.y + b.h, n).toBeLessThanOrEqual(101);
    }
  });

  it("the gallery only lists known presets", () => {
    for (const g of PRESET_GALLERY)
      for (const it of g.items) expect(hasPreset(it.prst.split(":")[0]), it.prst).toBe(true);
    expect(PRESET_GALLERY.map((g) => g.group)).toEqual([
      "Lines",
      "Basic shapes",
      "Block arrows",
      "Equation shapes",
      "Flowchart",
      "Stars and banners",
      "Callouts",
    ]);
  });

  it("unknown presets evaluate to null", () => {
    expect(evaluatePreset("cloud", 10, 10)).toBeNull();
    expect(hasPreset("toString")).toBe(false);
  });
});

describe("adjust handles", () => {
  it("roundRect: dragging the handle sets the radius, clamped to 50000", () => {
    expect(solveHandle("roundRect", 200, 100, undefined, 0, 30, 0).adj).toBe(30000);
    expect(solveHandle("roundRect", 200, 100, undefined, 0, 500, 0).adj).toBe(50000);
    expect(solveHandle("roundRect", 200, 100, undefined, 0, -20, 3).adj).toBe(0);
  });

  it("rightArrow: head length (x) and shaft width (y) handles", () => {
    const a = solveHandle("rightArrow", 200, 100, undefined, 1, 100, 0);
    expect(a.adj2).toBe(100000); // dx1 = 100 = ss·a2/100000
    expect(a.adj1).toBe(50000); // untouched
    const b = solveHandle("rightArrow", 200, 100, a, 0, 0, 10);
    expect(b.adj1).toBe(80000); // y1 = 50 − 100·a1/200000 = 10
  });

  it("donut: polar radius handle", () => {
    expect(solveHandle("donut", 100, 100, undefined, 0, 20, 50).adj).toBe(20000);
  });

  it("pie: polar angle handle follows the pointer around the ellipse", () => {
    const a = solveHandle("pie", 100, 100, undefined, 0, 50, 100);
    expect(Math.abs(a.adj1 - 5400000)).toBeLessThan(60000); // 90° ± 1°
  });

  it("wedgeRectCallout: the two-axis tail handle is unbounded", () => {
    const a = solveHandle("wedgeRectCallout", 120, 80, undefined, 0, 0, -40);
    expect(Math.abs(a.adj1 - -50000)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.adj2 - -100000)).toBeLessThanOrEqual(1);
    const g = evaluatePreset("wedgeRectCallout", 120, 80, a)!;
    expect(g.handles[0].x).toBeCloseTo(0, 1);
    expect(g.handles[0].y).toBeCloseTo(-40, 1);
  });

  it("bentConnector3: elbow can leave the box", () => {
    expect(solveHandle("bentConnector3", 200, 100, undefined, 0, 300, 50).adj1).toBe(150000);
  });
});
