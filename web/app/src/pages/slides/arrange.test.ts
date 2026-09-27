// Multi-element arrange ops (align, distribute, z-order, cycling, locking)
// and the finer-grained collab ops, plus the OnlyOffice M2 ports.
import { describe, it, expect } from "vitest";
import {
  alignElements,
  alignTarget,
  applyCollabOp,
  arrangeMany,
  centerOnPage,
  cycleSelection,
  distributeElements,
  duplicateElements,
  moveElementsBy,
  removeAnimation,
  removeElements,
  reorderElements,
  setLocked,
  upsertElements,
} from "./deckOps";
import { groupElements, removeDeep, ungroupElement } from "./groupOps";
import { editorKeyAction } from "./keymap";
import { CANVAS_H, CANVAS_W, newElement, type DeckDoc, type Slide, type SlideElement } from "./model";

function el(id: string, x = 0, y = 0, w = 100, h = 100, over: Partial<SlideElement> = {}): SlideElement {
  return { ...newElement("rect"), id, x, y, w, h, ...over };
}
function slide(id: string, elements: SlideElement[]): Slide {
  return { id, background: "#fff", elements };
}
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const byId = (xs: SlideElement[]) => Object.fromEntries(xs.map((e) => [e.id, [e.x, e.y]]));

describe("alignElements", () => {
  const a = el("a", 10, 10, 50, 50);
  const b = el("b", 100, 200, 100, 20);
  it("aligns a selection to its own union box", () => {
    expect(byId(alignElements([a, b], "left", "selection"))).toEqual({ a: [10, 10], b: [10, 200] });
    expect(byId(alignElements([a, b], "right", "selection"))).toEqual({ a: [150, 10], b: [100, 200] });
    expect(byId(alignElements([a, b], "center", "selection"))).toEqual({ a: [80, 10], b: [55, 200] });
    expect(byId(alignElements([a, b], "top", "selection"))).toEqual({ a: [10, 10], b: [100, 10] });
    expect(byId(alignElements([a, b], "bottom", "selection"))).toEqual({ a: [10, 170], b: [100, 200] });
    expect(byId(alignElements([a, b], "middle", "selection"))).toEqual({ a: [10, 90], b: [100, 105] });
  });
  it("aligns to the slide on request, and always for a single element", () => {
    expect(byId(alignElements([a, b], "right", "slide"))).toEqual({ a: [CANVAS_W - 50, 10], b: [CANVAS_W - 100, 200] });
    expect(byId(alignElements([a], "center", "selection"))).toEqual({ a: [CANVAS_W / 2 - 25, 10] });
    expect(alignTarget([a], "selection")).toEqual({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });
  });
  it("uses drawn (rotated) bounds and skips locked elements", () => {
    const r = el("r", 100, 100, 100, 20, { rotation: 90 }); // drawn x = 140
    expect(byId(alignElements([r], "left", "slide"))).toEqual({ r: [-40, 100] });
    expect(alignElements([a, { ...b, locked: true }], "left", "selection").map((e) => e.id)).toEqual(["a"]);
  });
  it("moves group members with the group", () => {
    const g = groupElements([a, b], ["a", "b"], () => "g")!.elements[0];
    const [moved] = alignElements([g], "left", "slide");
    expect(moved.x).toBe(0);
    expect(moved.children!.map((c) => c.x)).toEqual([0, 90]);
  });
});

describe("centerOnPage / distribute", () => {
  it("centres the selection as a block", () => {
    const out = centerOnPage([el("a", 0, 0, 100, 100), el("b", 200, 0, 100, 100)], "horizontal");
    expect(byId(out)).toEqual({ a: [330, 0], b: [530, 0] });
    expect(byId(centerOnPage([el("a", 0, 0, 100, 100)], "vertical"))).toEqual({ a: [0, 220] });
  });
  it("distributes horizontally with equal gaps, outer elements fixed", () => {
    const out = distributeElements([el("c", 400, 0, 100, 10), el("a", 0, 0, 100, 10), el("b", 110, 50, 50, 10)], "horizontal");
    // span 0..500, widths 250 → gap 125
    expect(byId(out)).toEqual({ a: [0, 0], b: [225, 50], c: [400, 0] });
  });
  it("distributes vertically", () => {
    const out = distributeElements([el("a", 0, 0, 10, 100), el("b", 0, 150, 10, 10), el("c", 0, 300, 10, 100)], "vertical");
    expect(byId(out).b).toEqual([0, 195]);
  });
  it("needs three elements, or spans the slide when asked", () => {
    expect(distributeElements([el("a"), el("b")], "horizontal")).toEqual([]);
    const out = distributeElements([el("a", 50, 0, 100, 10), el("b", 300, 0, 100, 10)], "horizontal", "slide");
    expect(byId(out)).toEqual({ a: [0, 0], b: [CANVAS_W - 100, 0] });
  });
});

describe("arrangeMany (z-order for a selection)", () => {
  const els = ["a", "b", "c", "d", "e"].map((i) => el(i));
  it("front/back move the selection as a block keeping its order", () => {
    expect(ids(arrangeMany(els, ["d", "b"], "front"))).toEqual(["a", "c", "e", "b", "d"]);
    expect(ids(arrangeMany(els, ["d", "b"], "back"))).toEqual(["b", "d", "a", "c", "e"]);
  });
  it("forward/backward step each selected element past one unselected neighbour", () => {
    expect(ids(arrangeMany(els, ["b", "c"], "forward"))).toEqual(["a", "d", "b", "c", "e"]);
    expect(ids(arrangeMany(els, ["b", "d"], "backward"))).toEqual(["b", "a", "d", "c", "e"]);
    expect(ids(arrangeMany(els, ["e"], "forward"))).toEqual(ids(els));
  });
});

describe("selection-wide edits", () => {
  it("moves all selected unlocked elements", () => {
    const out = moveElementsBy([el("a"), el("b", 0, 0, 1, 1, { locked: true }), el("c")], ["a", "b"], 5, -5);
    expect(byId(out)).toEqual({ a: [5, -5] });
  });
  it("cycles with Tab / Shift+Tab, wrapping", () => {
    const els = [el("1"), el("2"), el("3")];
    expect(cycleSelection(els, ["3"], 1)).toBe("1");
    expect(cycleSelection(els, ["1"], -1)).toBe("3");
    expect(cycleSelection(els, [], 1)).toBe("1");
    expect(cycleSelection(els, [], -1)).toBe("3");
    expect(cycleSelection([], [], 1)).toBeNull();
  });
  it("locks and unlocks", () => {
    const [l] = setLocked([el("a")], true);
    expect(l.locked).toBe(true);
    expect("locked" in setLocked([l], false)[0]).toBe(false);
  });
  it("duplicates a selection under fresh ids, offset", () => {
    let n = 0;
    const out = duplicateElements([el("a", 0, 0), el("b", 10, 10)], () => `n${++n}`);
    expect(out.map((e) => [e.id, e.x, e.y])).toEqual([["n1", 16, 16], ["n2", 26, 26]]);
  });
  it("upserts, removes and reorders several at once", () => {
    const s = slide("s", [el("a"), el("b"), el("c")]);
    expect(ids(upsertElements(s, [el("b", 5), el("d")]).elements)).toEqual(["a", "b", "c", "d"]);
    expect(ids(removeElements(s, ["a", "c", "zz"]).elements)).toEqual(["b"]);
    expect(ids(reorderElements(s, ["c", "zz", "a"]).elements)).toEqual(["c", "a", "b"]);
  });
});

describe("collab ops", () => {
  const doc = (): DeckDoc => ({ slides: [slide("s0", [el("a"), el("b"), el("c")]), slide("s1", [el("x")])] });
  const ops = [
    { t: "upsertMany", si: "s0", els: [el("a", 50), el("n")] },
    { t: "removeMany", si: "s0", ids: ["b"] },
    { t: "reorder", si: "s0", ids: ["c", "b", "a"] },
    { t: "setElements", si: "s0", elements: [el("only")] },
  ];
  it("applies each op to its slide only", () => {
    const d = doc();
    expect(ids(applyCollabOp(d, ops[0]).slides[0].elements)).toEqual(["a", "b", "c", "n"]);
    expect(ids(applyCollabOp(d, ops[1]).slides[0].elements)).toEqual(["a", "c"]);
    expect(ids(applyCollabOp(d, ops[2]).slides[0].elements)).toEqual(["c", "b", "a"]);
    expect(ids(applyCollabOp(d, ops[3]).slides[0].elements)).toEqual(["only"]);
    for (const op of ops) expect(applyCollabOp(d, op).slides[1]).toBe(d.slides[1]);
  });
  it("is idempotent", () => {
    for (const op of ops) {
      const once = applyCollabOp(doc(), op);
      expect(applyCollabOp(once, op)).toEqual(once);
    }
  });
  it("ignores malformed multi ops", () => {
    const d = doc();
    expect(applyCollabOp(d, { t: "upsertMany", si: "s0" })).toBe(d);
    expect(applyCollabOp(d, { t: "reorder", ids: ["a"] })).toBe(d);
    expect(applyCollabOp(d, { t: "setElements", si: "s0", elements: "x" as unknown as SlideElement[] })).toBe(d);
  });
  it("relays a group as one setElements op the peer can apply", () => {
    const d = doc();
    const g = groupElements(d.slides[0].elements, ["a", "b"], () => "g")!;
    const peer = applyCollabOp(d, { t: "setElements", si: "s0", elements: g.elements });
    expect(peer.slides[0].elements[0].children!.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

// ---- OnlyOffice parity (sdkjs-tests v9.3.1) ----

describe("OnlyOffice parity: shapes", () => {
  // Arrow keys nudge the selection; Tab/Shift+Tab cycle it through the slide's
  // objects in z-order with wrap-around; Ctrl+G groups the selection into one
  // selected group and Ctrl+Shift+G ungroups it back into its shapes; Esc
  // clears the selection. Grown variant: the nudge step stays at Grown's
  // 2 px (Shift = 10) instead of OnlyOffice's 5 (Ctrl = 1), and Enter-to-edit,
  // Ctrl+A inside a shape and table-cell navigation belong to M4/M5.
  it("oo:slide/shortcuts/shortcuts.js#Check main actions with shapes", () => {
    const d1 = el("d1", 0, 0, 200, 100);
    const d2 = el("d2", 0, 0, 10, 10);
    const d3 = el("d3", 0, 0, 10, 10);
    const els = [d1, d2, d3];
    const sel = { hasSelection: true };

    const left = editorKeyAction({ key: "ArrowLeft" }, sel);
    expect(left && left.type === "nudge" && moveElementsBy([d1], ["d1"], left.dx, left.dy)[0].x).toBe(-2);

    // Tab from d3 (topmost) wraps to d1, then d2, d3; Shift+Tab walks back.
    expect(editorKeyAction({ key: "Tab" }, sel)).toEqual({ type: "cycle", dir: 1 });
    let cur = ["d3"];
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) seen.push((cur = [cycleSelection(els, cur, 1)!])[0]);
    expect(seen).toEqual(["d1", "d2", "d3"]);
    expect(editorKeyAction({ key: "Tab", shiftKey: true }, sel)).toEqual({ type: "cycle", dir: -1 });
    const back: string[] = [];
    for (let i = 0; i < 3; i++) back.push((cur = [cycleSelection(els, cur, -1)!])[0]);
    expect(back).toEqual(["d2", "d1", "d3"]);

    // Ctrl+G → one group selected; Ctrl+Shift+G → two shapes.
    expect(editorKeyAction({ key: "g", ctrlKey: true }, sel)).toEqual({ type: "group" });
    const g = groupElements(els, ["d1", "d2"], () => "grp")!;
    expect(g.elements.find((e) => e.id === g.groupId)!.type).toBe("group");
    expect(editorKeyAction({ key: "G", ctrlKey: true, shiftKey: true }, sel)).toEqual({ type: "ungroup" });
    const u = ungroupElement(g.elements, g.groupId)!;
    expect(u.ids).toEqual(["d1", "d2"]);
    expect(u.ids.map((i) => u.elements.find((e) => e.id === i)!.type)).toEqual(["rect", "rect"]);

    // Esc resets the selection.
    expect(editorKeyAction({ key: "Escape" }, sel)).toEqual({ type: "deselect" });
  });

  // Delete removes, in turn: the animation effect (Grown: the element's
  // entrance animation), the shape, a shape inside a group, then the group.
  // Grown variant: there are no chart objects yet (M11), so that step is
  // omitted; a group left with one member dissolves, so the group here has
  // three members like OnlyOffice's.
  it("oo:slide/shortcuts/shortcuts.js#Check remove graphic objects", () => {
    const animated = el("shape", 0, 0, 100, 100, { animation: { type: "fade-in", order: 1 } });
    expect(removeAnimation(animated).animation).toBeUndefined();
    let els: SlideElement[] = [removeAnimation(animated)];
    expect(editorKeyAction({ key: "Delete" }, { hasSelection: true })).toEqual({ type: "deleteSelected" });
    els = removeDeep(els, "shape");
    expect(els).toEqual([]);

    els = groupElements([el("s1"), el("s2"), el("s3")], ["s1", "s2", "s3"], () => "group")!.elements;
    els = removeDeep(els, "s1");
    expect(els[0].children!.map((c) => c.id)).toEqual(["s2", "s3"]);
    els = removeDeep(els, "group");
    expect(els).toEqual([]);
  });
});
