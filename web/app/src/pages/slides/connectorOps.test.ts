import { describe, it, expect } from "vitest";
import { newConnector, newShape, type SlideElement } from "./model";
import {
  adjustHandles,
  connectionSites,
  connectorEnds,
  dragAdjustHandle,
  localToSlide,
  nearestSite,
  rerouteConnectors,
  setConnectorEnds,
  slideToLocal,
  withGluedConnectors,
} from "./connectorOps";

const box = (id: string, x: number, y: number, w = 100, h = 50): SlideElement => ({
  ...newShape("rect"),
  id,
  x,
  y,
  w,
  h,
});

describe("connector endpoints", () => {
  it("flips choose the diagonal", () => {
    const c = newConnector("straightConnector1", { from: [300, 200], to: [100, 250] });
    expect(c).toMatchObject({ x: 100, y: 200, w: 200, h: 50, flipH: true });
    expect(c.flipV).toBeUndefined();
    expect(connectorEnds(c)).toEqual({ start: [300, 200], end: [100, 250] });
  });

  it("local ↔ slide round-trips through rotation and flips", () => {
    const el = { ...box("a", 100, 100, 200, 100), rotation: 30, flipV: true };
    const p = localToSlide(el, 20, 70);
    const q = slideToLocal(el, p[0], p[1]);
    expect(q[0]).toBeCloseTo(20, 9);
    expect(q[1]).toBeCloseTo(70, 9);
  });
});

describe("connection sites", () => {
  it("rect sites are the edge midpoints, in slide coordinates", () => {
    expect(connectionSites(box("a", 10, 20))).toEqual([
      [60, 20],
      [10, 45],
      [60, 70],
      [110, 45],
    ]);
  });

  it("follow rotation", () => {
    const s = connectionSites({ ...box("a", 0, 0, 100, 50), rotation: 90 });
    // top-middle (50,0) rotates about (50,25) to (75,25)
    expect(s[0][0]).toBeCloseTo(75, 9);
    expect(s[0][1]).toBeCloseTo(25, 9);
  });

  it("text boxes get edge midpoints; connectors and groups none", () => {
    expect(connectionSites({ ...box("t", 0, 0), type: "text", preset: undefined })).toHaveLength(4);
    expect(connectionSites(newConnector("line"))).toEqual([]);
  });

  it("nearestSite snaps within the glue distance only", () => {
    const els = [box("a", 0, 0), box("b", 200, 0)];
    expect(nearestSite(els, 105, 27)).toMatchObject({ ref: { id: "a", idx: 3 }, x: 100, y: 25 });
    expect(nearestSite(els, 150, 25)).toBeNull();
    expect(nearestSite(els, 105, 27, "a")).toBeNull();
  });
});

describe("glue", () => {
  const a = box("a", 0, 0);
  const b = box("b", 300, 200);
  const glued = setConnectorEnds({ ...newConnector("bentConnector3"), id: "c" }, [100, 25], [300, 225], {
    stCxn: { id: "a", idx: 3 },
    endCxn: { id: "b", idx: 1 },
  });

  it("moving a glued shape reroutes the connector end", () => {
    const moved = { ...b, x: 400, y: 100 };
    const out = rerouteConnectors([a, b, glued], [moved]);
    expect(out).toHaveLength(1);
    expect(connectorEnds(out[0])).toEqual({ start: [100, 25], end: [400, 125] });
    expect(out[0].endCxn).toEqual({ id: "b", idx: 1 });
  });

  it("dragging the connector away on its own unglues it", () => {
    const dragged = { ...glued, x: glued.x + 30 };
    const [out] = rerouteConnectors([a, b, glued], [dragged]);
    expect(out.stCxn).toBeUndefined();
    expect(out.endCxn).toBeUndefined();
    expect(out.x).toBe(glued.x + 30);
  });

  it("moving the connector with both shapes keeps the glue", () => {
    const d = (e: SlideElement) => ({ ...e, x: e.x + 10, y: e.y + 5 });
    const out = withGluedConnectors([a, b, glued], [d(a), d(b), d(glued)]);
    const c = out.find((e) => e.id === "c")!;
    expect(c.stCxn).toBeDefined();
    expect(connectorEnds(c).start).toEqual([110, 30]);
  });

  it("a deleted target drops the glue", () => {
    const [out] = rerouteConnectors([a, glued], [glued]);
    expect(out.endCxn).toBeUndefined();
    expect(out.stCxn).toEqual({ id: "a", idx: 3 });
  });

  it("unrelated changes leave connectors alone", () => {
    expect(withGluedConnectors([a, b, glued, box("z", 0, 400)], [box("z", 5, 400)])).toHaveLength(1);
  });
});

describe("adjust handles on elements", () => {
  it("drag in slide space maps through rotation/flip into the adjust value", () => {
    const el: SlideElement = { ...newShape("roundRect"), x: 100, y: 100, w: 200, h: 100, flipH: true };
    // Flipped: local x1 = 30 appears at slide x = 100 + 200 − 30.
    const next = dragAdjustHandle(el, 0, 270, 100);
    expect(next.adj).toEqual({ adj: 30000 });
    expect(adjustHandles(next)[0]).toEqual({ x: 30, y: 0 });
  });

  it("legacy shapes have no adjust handles", () => {
    expect(adjustHandles({ ...box("a", 0, 0), type: "rect", preset: undefined })).toEqual([]);
  });
});
