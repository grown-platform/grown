import { describe, it, expect } from "vitest";
import {
  addNextSlide,
  applyCollabOp,
  arrangeElements,
  copySlide,
  deleteSlideAt,
  duplicateElement,
  duplicateSlideAt,
  insertSlideAfter,
  mapSlide,
  moveElementBy,
  moveSlide,
  patchSlide,
  removeAnimation,
  removeElement,
  rotateElement,
  setLink,
  setList,
  setTableCell,
  toggleStyle,
  upsertElement,
} from "./deckOps";
import { newElement, newShape, newTable, type Slide, type SlideElement } from "./model";
import { setFlip } from "./elementOps";
import { editorKeyAction } from "./keymap";

// Deterministic fixtures: slides/elements with readable ids.
function slide(id: string, elements: SlideElement[] = [], background = "#ffffff"): Slide {
  return { id, background, elements };
}
function el(id: string, over: Partial<SlideElement> = {}): SlideElement {
  return { ...newElement("rect"), id, ...over };
}
function deck(n: number): Slide[] {
  return Array.from({ length: n }, (_, i) => slide(`s${i}`));
}
function ids(xs: { id: string }[]): string[] {
  return xs.map((x) => x.id);
}
function counter(prefix = "n") {
  let i = 0;
  return () => `${prefix}${i++}`;
}

describe("insertSlideAfter / addNextSlide", () => {
  it("inserts after the current slide and moves to it", () => {
    const r = insertSlideAfter(deck(3), 1, slide("new"));
    expect(ids(r.slides)).toEqual(["s0", "s1", "new", "s2"]);
    expect(r.cur).toBe(2);
  });

  it("new slide inherits the current background and is a new object", () => {
    const slides = [slide("a", [], "#111111"), slide("b", [], "#222222")];
    const r = addNextSlide(slides, 1);
    expect(r.cur).toBe(2);
    expect(r.slides[2].background).toBe("#222222");
    expect(r.slides[2].elements).toEqual([]);
    expect(slides).not.toContain(r.slides[2]);
  });

  it("falls back to white when there is no current slide", () => {
    const r = addNextSlide([], -1);
    expect(r.slides).toHaveLength(1);
    expect(r.slides[0].background).toBe("#ffffff");
    expect(r.cur).toBe(0);
  });
});

describe("duplicateSlideAt / copySlide", () => {
  it("copies background and elements under fresh ids, dropping notes/transition", () => {
    const src: Slide = {
      ...slide("a", [el("e1"), el("e2")], "#abcdef"),
      notes: "hi",
      transition: "fade",
    };
    const c = copySlide(src, counter());
    expect(c).toEqual({
      id: "n0",
      background: "#abcdef",
      elements: [
        { ...src.elements[0], id: "n1" },
        { ...src.elements[1], id: "n2" },
      ],
    });
  });

  it("inserts the copy after the current slide", () => {
    const r = duplicateSlideAt(deck(3), 0, counter())!;
    expect(ids(r.slides)).toEqual(["s0", "n0", "s1", "s2"]);
    expect(r.cur).toBe(1);
  });

  it("returns null without a current slide", () => {
    expect(duplicateSlideAt(deck(2), 5)).toBeNull();
  });
});

describe("deleteSlideAt", () => {
  it("removes the current slide and selects the previous one", () => {
    const r = deleteSlideAt(deck(4), 2);
    expect(ids(r.slides)).toEqual(["s0", "s1", "s3"]);
    expect(r.cur).toBe(1);
  });

  it("stays at 0 when deleting the first slide", () => {
    const r = deleteSlideAt(deck(3), 0);
    expect(ids(r.slides)).toEqual(["s1", "s2"]);
    expect(r.cur).toBe(0);
  });

  it("replaces the last remaining slide with a blank one", () => {
    const r = deleteSlideAt([slide("only", [el("x")])], 0, () => slide("blank"));
    expect(ids(r.slides)).toEqual(["blank"]);
    expect(r.cur).toBe(0);
  });
});

describe("moveSlide", () => {
  it("moves a slide down/up by one and follows it", () => {
    const down = moveSlide(deck(4), 1, 2)!;
    expect(ids(down.slides)).toEqual(["s0", "s2", "s1", "s3"]);
    expect(down.cur).toBe(2);
    const up = moveSlide(deck(4), 1, 0)!;
    expect(ids(up.slides)).toEqual(["s1", "s0", "s2", "s3"]);
    expect(up.cur).toBe(0);
  });

  it("ignores moves past either end", () => {
    expect(moveSlide(deck(3), 0, -1)).toBeNull();
    expect(moveSlide(deck(3), 2, 3)).toBeNull();
  });

  it("does not mutate the input", () => {
    const d = deck(3);
    moveSlide(d, 0, 2);
    expect(ids(d)).toEqual(["s0", "s1", "s2"]);
  });
});

describe("patchSlide / mapSlide", () => {
  it("patches only the target slide", () => {
    const d = deck(3);
    const next = patchSlide(d, "s1", { background: "#000", notes: "n", transition: "fade" });
    expect(next[1]).toEqual({ ...d[1], background: "#000", notes: "n", transition: "fade" });
    expect(next[0]).toBe(d[0]);
    expect(next[2]).toBe(d[2]);
  });

  it("maps one slide of a doc", () => {
    const doc = { slides: deck(2) };
    const next = mapSlide(doc, "s0", (s) => ({ ...s, background: "red" }));
    expect(next.slides[0].background).toBe("red");
    expect(next.slides[1]).toBe(doc.slides[1]);
  });
});

describe("upsertElement / removeElement", () => {
  it("appends a new element on top", () => {
    const s = upsertElement(slide("s", [el("a")]), el("b"));
    expect(ids(s.elements)).toEqual(["a", "b"]);
  });

  it("replaces an existing element in place (keeps z-order)", () => {
    const s = upsertElement(slide("s", [el("a"), el("b")]), el("a", { x: 5 }));
    expect(ids(s.elements)).toEqual(["a", "b"]);
    expect(s.elements[0].x).toBe(5);
  });

  it("removes by id and tolerates unknown ids", () => {
    const s0 = slide("s", [el("a"), el("b")]);
    expect(ids(removeElement(s0, "a").elements)).toEqual(["b"]);
    expect(ids(removeElement(s0, "zz").elements)).toEqual(["a", "b"]);
  });
});

describe("arrangeElements", () => {
  const els = ["a", "b", "c", "d"].map((i) => el(i));
  it("brings to front / sends to back", () => {
    expect(ids(arrangeElements(els, "b", "front")!)).toEqual(["a", "c", "d", "b"]);
    expect(ids(arrangeElements(els, "c", "back")!)).toEqual(["c", "a", "b", "d"]);
  });
  it("moves one step forward / backward, clamped at the ends", () => {
    expect(ids(arrangeElements(els, "b", "forward")!)).toEqual(["a", "c", "b", "d"]);
    expect(ids(arrangeElements(els, "c", "backward")!)).toEqual(["a", "c", "b", "d"]);
    expect(ids(arrangeElements(els, "d", "forward")!)).toEqual(["a", "b", "c", "d"]);
    expect(ids(arrangeElements(els, "a", "backward")!)).toEqual(["a", "b", "c", "d"]);
  });
  it("returns null for an element not on the slide", () => {
    expect(arrangeElements(els, "zz", "front")).toBeNull();
  });
});

describe("rotateElement", () => {
  const e = el("r");
  it("rotates in 90° steps normalised to [0, 360)", () => {
    expect(rotateElement(e, "cw").rotation).toBe(90);
    expect(rotateElement(e, "ccw").rotation).toBe(270);
    expect(rotateElement({ ...e, rotation: 270 }, "cw").rotation).toBe(0);
    expect(rotateElement({ ...e, rotation: 45 }, "ccw").rotation).toBe(315);
  });
  it("toggles flips independently", () => {
    const h = rotateElement(e, "flipH");
    expect(h.flipH).toBe(true);
    expect(h.flipV).toBeFalsy();
    expect(rotateElement(h, "flipH").flipH).toBe(false);
    expect(rotateElement(e, "flipV").flipV).toBe(true);
  });
});

describe("element edits", () => {
  it("duplicateElement offsets the copy by 16 and gives it a new id", () => {
    const src = el("a", { x: 100, y: 50 });
    const c = duplicateElement(src, () => "copy");
    expect(c).toEqual({ ...src, id: "copy", x: 116, y: 66 });
  });

  it("moveElementBy translates", () => {
    expect(moveElementBy(el("a", { x: 10, y: 10 }), -2, 10)).toMatchObject({ x: 8, y: 20 });
  });

  it("toggleStyle flips a style flag", () => {
    const e = newElement("text");
    const b = toggleStyle(e, "bold");
    expect(b.bold).toBe(true);
    expect(toggleStyle(b, "bold").bold).toBe(false);
    expect(toggleStyle(e, "strike").strike).toBe(true);
  });

  it("setList sets and clears", () => {
    const e = newElement("text");
    expect(setList(e, "number").list).toBe("number");
    expect(setList(setList(e, "bullet"), null).list).toBeUndefined();
  });

  it("setLink trims and removes on blank", () => {
    const e = newElement("text");
    expect(setLink(e, "  https://x.test ").url).toBe("https://x.test");
    expect(setLink({ ...e, url: "https://x.test" }, "   ").url).toBeUndefined();
  });

  it("setTableCell copies the grid", () => {
    const t = newTable(2, 2);
    const n = setTableCell(t, 1, 0, "hi");
    expect(n.cells[1][0]).toBe("hi");
    expect(t.cells[1][0]).toBe("");
  });

  it("removeAnimation strips the key", () => {
    const e = { ...el("a"), animation: { type: "appear" as const, order: 1 } };
    const r = removeAnimation(e);
    expect("animation" in r).toBe(false);
    expect(r.id).toBe("a");
  });
});

describe("applyCollabOp", () => {
  const doc = { slides: [slide("s0", [el("a")]), slide("s1")] };
  it("applies upsert and remove ops to the named slide", () => {
    const up = applyCollabOp(doc, { t: "upsert", si: "s1", el: el("b") });
    expect(ids(up.slides[1].elements)).toEqual(["b"]);
    expect(up.slides[0]).toBe(doc.slides[0]);
    const rm = applyCollabOp(up, { t: "remove", si: "s0", elId: "a" });
    expect(rm.slides[0].elements).toEqual([]);
  });
  it("replaces all slides on a slides op", () => {
    const next = [slide("z")];
    expect(applyCollabOp(doc, { t: "slides", slides: next }).slides).toBe(next);
  });
  it("keeps deck props on a slides op and replaces the deck on a deck op (M7)", () => {
    const themed = { ...doc, size: { w: 960, h: 720 }, hf: { sldNum: true } };
    const out = applyCollabOp(themed, { t: "slides", slides: [slide("z")] });
    expect(out.size).toEqual({ w: 960, h: 720 });
    expect(out.hf).toEqual({ sldNum: true });
    const deck = { slides: [slide("q")], size: { w: 960, h: 600 } };
    expect(applyCollabOp(themed, { t: "deck", deck })).toBe(deck);
    expect(applyCollabOp(themed, { t: "deck" })).toBe(themed);
    // Element ops keep deck props too.
    const up = applyCollabOp(themed, { t: "upsert", si: "s1", el: el("b") });
    expect(up.size).toEqual({ w: 960, h: 720 });
  });
  it("ignores unknown/malformed ops", () => {
    expect(applyCollabOp(doc, { t: "presence" })).toBe(doc);
    expect(applyCollabOp(doc, { t: "upsert", si: "s0" })).toBe(doc);
  });
});

// ---- OnlyOffice parity (sdkjs-tests v9.3.1). Behaviour learned from their
// test descriptions and re-expressed against Grown's own model. ----

describe("OnlyOffice parity: drawings", () => {
  // A fresh shape reports no horizontal flip; after flipping it reports one.
  // Grown exposes flipping as a toggle (Arrange → Rotate → Flip horizontally).
  it("oo:slide/js-api/api-drawing.js#Test: GetFlipH", () => {
    const shape = newElement("rect");
    expect(!!shape.flipH).toBe(false);
    expect(rotateElement(shape, "flipH").flipH).toBe(true);
  });

  it("oo:slide/js-api/api-drawing.js#Test: GetFlipV", () => {
    const shape = newElement("rect");
    expect(!!shape.flipV).toBe(false);
    expect(rotateElement(shape, "flipV").flipV).toBe(true);
  });

  // SetFlipH/SetFlipV: an explicit boolean setter (elementOps.setFlip) that
  // reports success and rejects non-boolean input; the toolbar keeps toggles.
  it("oo:slide/js-api/api-drawing.js#Test: SetFlipH", () => {
    const shape = newShape("cube");
    let r = setFlip(shape, "h", true);
    expect(r.ok).toBe(true);
    expect(r.el.flipH).toBe(true);
    r = setFlip(r.el, "h", true); // setting twice stays flipped (not a toggle)
    expect(r.el.flipH).toBe(true);
    r = setFlip(r.el, "h", false);
    expect(r.ok).toBe(true);
    expect(!!r.el.flipH).toBe(false);
    const bad = setFlip(r.el, "h", "invalid");
    expect(bad.ok).toBe(false);
    expect(bad.el).toBe(r.el);
  });

  it("oo:slide/js-api/api-drawing.js#Test: SetFlipV", () => {
    const shape = newShape("cube");
    let r = setFlip(shape, "v", true);
    expect(r.ok).toBe(true);
    expect(r.el.flipV).toBe(true);
    r = setFlip(r.el, "v", false);
    expect(r.ok).toBe(true);
    expect(!!r.el.flipV).toBe(false);
    expect(setFlip(r.el, "v", "invalid").ok).toBe(false);
  });
});

describe("OnlyOffice parity: shortcuts", () => {
  // SKIP: Grown's thumbnail rail has no keyboard navigation (Up/Down/PgUp/PgDn/
  // Home/End), no multi-slide selection (Shift+…, Ctrl+A) and no multi-slide
  // move (Ctrl+Up/Down, Ctrl+Shift+Up/Down). What exists — Ctrl+M add next
  // slide, single-slide Up/Down buttons, Delete slide — is covered by the
  // addNextSlide/moveSlide/deleteSlideAt tests above.
  it.skip("oo:slide/shortcuts/shortcuts.js#Check actions with slides", () => {
    // Expected: moving the selected slides [0..3] down one position keeps
    // them selected at [1..4]. Grown only moves one slide at a time.
    const r = moveSlide(deck(7), 0, 1)!;
    expect(r.cur).toEqual([1, 2, 3, 4]);
  });

  // Ctrl/Cmd+D dispatches like OnlyOffice: the selected element is
  // duplicated, and with nothing selected the current slide is.
  it("oo:slide/shortcuts/shortcuts.js#Check duplicate presentation objects", () => {
    const s = slide("s", [el("a")]);
    expect(editorKeyAction({ key: "d", ctrlKey: true }, { hasSelection: true })).toEqual({
      type: "duplicateElement",
    });
    const withCopy = upsertElement(s, duplicateElement(s.elements[0]));
    expect(withCopy.elements).toHaveLength(2);
    // With nothing selected OnlyOffice duplicates the slide on the same key.
    expect(editorKeyAction({ key: "d", ctrlKey: true }, { hasSelection: false })).toEqual({
      type: "duplicateSlide",
    });
    expect(duplicateSlideAt([s], 0)!.slides).toHaveLength(2);
  });

});
