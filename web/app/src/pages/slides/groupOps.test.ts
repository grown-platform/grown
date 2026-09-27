import { describe, it, expect } from "vitest";
import {
  bakeChild,
  findDeep,
  flattenGroups,
  groupElements,
  parentGroupOf,
  reId,
  relativeTo,
  removeDeep,
  ungroupElement,
  ungroupMany,
} from "./groupOps";
import { elementBounds } from "./geometry";
import { newElement, type SlideElement } from "./model";

function el(id: string, x = 0, y = 0, w = 100, h = 100, over: Partial<SlideElement> = {}): SlideElement {
  return { ...newElement("rect"), id, x, y, w, h, ...over };
}
function counter(prefix = "g") {
  let n = 0;
  return () => `${prefix}${++n}`;
}
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const xywh = (e: SlideElement) => [e.x, e.y, e.w, e.h];

describe("groupElements", () => {
  const els = [el("a", 0, 0), el("b", 200, 50), el("c", 50, 300)];
  it("wraps members into one group sized to their union", () => {
    const r = groupElements(els, ["a", "b"], counter())!;
    expect(ids(r.elements)).toEqual(["g1", "c"]);
    const g = r.elements[0];
    expect(g.type).toBe("group");
    expect(xywh(g)).toEqual([0, 0, 300, 150]);
    expect(ids(g.children!)).toEqual(["a", "b"]);
  });
  it("takes the z-position of the topmost member and keeps member z-order", () => {
    const r = groupElements(els, ["c", "a"], counter())!;
    expect(ids(r.elements)).toEqual(["b", "g1"]);
    expect(ids(r.elements[1].children!)).toEqual(["a", "c"]);
  });
  it("needs at least two members on the slide", () => {
    expect(groupElements(els, ["a"])).toBeNull();
    expect(groupElements(els, ["a", "zz"])).toBeNull();
  });
  it("uses rotated member bounds", () => {
    const r = groupElements([el("a", 0, 0, 100, 20, { rotation: 90 }), el("b", 0, 0, 10, 10)], ["a", "b"], counter())!;
    expect(xywh(r.elements[0])).toEqual([0, -40, 60, 100]);
  });
});

describe("ungroup", () => {
  it("round-trips group → ungroup to the original elements", () => {
    const els = [el("x"), el("a", 0, 0), el("b", 200, 50), el("y")];
    const g = groupElements(els, ["a", "b"], counter())!;
    const u = ungroupElement(g.elements, g.groupId)!;
    expect(u.elements).toEqual(els);
    expect(u.ids).toEqual(["a", "b"]);
  });
  it("bakes the group's rotation into members", () => {
    const g: SlideElement = {
      ...el("g", 0, 0, 200, 100),
      type: "group",
      rotation: 180,
      children: [el("a", 0, 0, 50, 50)],
    };
    const [a] = ungroupElement([g], "g")!.elements;
    expect(xywh(a)).toEqual([150, 50, 50, 50]);
    expect(a.rotation).toBe(180);
  });
  it("bakes 90° about the group centre and adds to the member's rotation", () => {
    const g: SlideElement = { ...el("g", 0, 0, 200, 100), type: "group", rotation: 90, children: [el("a", 0, 0, 50, 50, { rotation: 10 })] };
    const b = bakeChild(g.children![0], g);
    // member centre (25,25) about (100,50) by 90° → (125,-25)
    expect(xywh(b)).toEqual([100, -50, 50, 50]);
    expect(b.rotation).toBe(100);
  });
  it("bakes a horizontal flip: mirrors position, negates rotation, toggles flip", () => {
    const g: SlideElement = { ...el("g", 0, 0, 200, 100), type: "group", flipH: true, children: [el("a", 0, 0, 50, 50, { rotation: 30, flipH: true })] };
    const b = bakeChild(g.children![0], g);
    expect(xywh(b)).toEqual([150, 0, 50, 50]);
    expect(b.rotation).toBe(330);
    expect(b.flipH).toBeUndefined();
  });
  it("ungroupMany leaves non-groups selected and reports null when nothing changed", () => {
    const g = groupElements([el("a"), el("b", 200)], ["a", "b"], counter())!;
    const els = [...g.elements, el("z")];
    expect(ungroupMany(els, ["g1", "z"])!.ids).toEqual(["a", "b", "z"]);
    expect(ungroupMany(els, ["z"])).toBeNull();
  });
  it("is null for a non-group", () => {
    expect(ungroupElement([el("a")], "a")).toBeNull();
  });
});

describe("removeDeep / findDeep", () => {
  const g: SlideElement = {
    ...el("g", 0, 0, 300, 100),
    type: "group",
    children: [el("a", 0, 0), el("b", 100, 0), el("c", 200, 0)],
  };
  it("removes a member and refits the group", () => {
    const [ng] = removeDeep([g], "c");
    expect(ids(ng.children!)).toEqual(["a", "b"]);
    expect(xywh(ng)).toEqual([0, 0, 200, 100]);
  });
  it("dissolves a group left with one member", () => {
    const out = removeDeep(removeDeep([g], "a"), "b");
    expect(ids(out)).toEqual(["c"]);
  });
  it("removes a whole group, and leaves unrelated lists identical", () => {
    expect(removeDeep([g, el("z")], "g").map((e) => e.id)).toEqual(["z"]);
    const list = [g];
    expect(removeDeep(list, "nope")[0]).toBe(g);
  });
  it("finds nested members and their top-level group", () => {
    const outer: SlideElement = { ...el("o"), type: "group", children: [g, el("d")] };
    expect(findDeep([outer], "b")?.id).toBe("b");
    expect(parentGroupOf([outer], "b")?.id).toBe("o");
    expect(parentGroupOf([outer], "o")).toBeUndefined();
  });
});

describe("helpers", () => {
  it("reId renews every id in a group", () => {
    const g: SlideElement = { ...el("g"), type: "group", children: [el("a"), { ...el("h"), type: "group", children: [el("b")] }] };
    const r = reId(g, counter("n"));
    expect(r.id).toBe("n1");
    expect(ids(r.children!)).toEqual(["n2", "n3"]);
    expect(r.children![1].children![0].id).toBe("n4");
  });
  it("flattenGroups yields leaves with transforms baked", () => {
    const g: SlideElement = { ...el("g", 0, 0, 200, 100), type: "group", rotation: 180, children: [el("a", 0, 0, 50, 50), el("b", 150, 50, 50, 50)] };
    const flat = flattenGroups([el("z"), g]);
    expect(ids(flat)).toEqual(["z", "a", "b"]);
    expect(xywh(flat[1])).toEqual([150, 50, 50, 50]);
    // Baking keeps drawn bounds inside the group's drawn bounds.
    const gb = elementBounds(g);
    for (const f of flat.slice(1)) {
      const b = elementBounds(f);
      expect(b.x >= gb.x && b.x + b.w <= gb.x + gb.w).toBe(true);
    }
  });
  it("relativeTo shifts a group's members too", () => {
    const g: SlideElement = { ...el("g", 100, 100), type: "group", children: [el("a", 120, 130, 10, 10)] };
    const r = relativeTo(g, 100, 100);
    expect(xywh(r)).toEqual([0, 0, 100, 100]);
    expect(xywh(r.children![0])).toEqual([20, 30, 10, 10]);
  });
});
