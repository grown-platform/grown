import { describe, expect, it } from "vitest";
import type { DeckDoc, SlideElement } from "./model";
import { carryChanges, deepEqual, diffOps } from "./deckDiff";
import { applyOp } from "./collabSync";

const el = (id: string, x = 0, extra: Partial<SlideElement> = {}): SlideElement =>
  ({ id, type: "text", x, y: 0, w: 10, h: 10, text: id, ...extra }) as SlideElement;

const deck = (...slides: [string, SlideElement[], Record<string, unknown>?][]): DeckDoc => ({
  slides: slides.map(([id, elements, props]) => ({ id, background: "#fff", elements, ...(props ?? {}) })),
});

const replay = (d: DeckDoc, ops: ReturnType<typeof diffOps>) => ops.reduce(applyOp, d);

describe("deepEqual", () => {
  it("ignores undefined-valued keys and compares deeply", () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual([1, { x: [2] }], [1, { x: [2] }])).toBe(true);
    expect(deepEqual([1], [1, 2])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe("diffOps", () => {
  it("turns a notes change into a slideProps op, not a whole-deck op", () => {
    const a = deck(["s1", [el("x")]], ["s2", []]);
    const b = { ...a, slides: [{ ...a.slides[0], notes: "hi" }, a.slides[1]] };
    const ops = diffOps(a, b);
    expect(ops).toEqual([{ t: "slideProps", si: "s1", patch: { notes: "hi" } }]);
    expect(replay(a, ops)).toEqual(b);
  });

  it("unsets a removed slide prop with null", () => {
    const a = deck(["s1", [], { hidden: true }]);
    const b = deck(["s1", []]);
    const ops = diffOps(a, b);
    expect(ops).toEqual([{ t: "slideProps", si: "s1", patch: { hidden: null } }]);
    expect(deepEqual(replay(a, ops), b)).toBe(true);
  });

  it("gives element ops for element changes, setElements for z-order", () => {
    const a = deck(["s1", [el("x"), el("y"), el("z")]]);
    const b = deck(["s1", [el("x", 5), el("z"), el("n")]]);
    const ops = diffOps(a, b);
    expect(ops.map((o) => o.t)).toEqual(["removeMany", "upsertMany"]);
    expect(replay(a, ops)).toEqual(b);
    const c = deck(["s1", [el("z"), el("x"), el("y")]]);
    const ops2 = diffOps(a, c);
    expect(ops2.map((o) => o.t)).toEqual(["setElements"]);
    expect(replay(a, ops2)).toEqual(c);
  });

  it("falls back to slides for slide list changes and deck for deck props", () => {
    const a = deck(["s1", []], ["s2", []]);
    expect(diffOps(a, deck(["s2", []], ["s1", []]))[0].t).toBe("slides");
    expect(diffOps(a, { ...a, size: { w: 960, h: 720 } })[0].t).toBe("deck");
    expect(diffOps(a, a)).toEqual([]);
  });
});

describe("carryChanges (own-op undo)", () => {
  it("undoes my move but keeps a collaborator's edit of another element", () => {
    const before = deck(["s1", [el("mine"), el("theirs")]]);
    const after = deck(["s1", [el("mine", 50), el("theirs")]]);
    // A collaborator moved "theirs" after my change.
    const current = deck(["s1", [el("mine", 50), el("theirs", 99)]]);
    const undone = carryChanges(after, before, current, true);
    expect(undone).toEqual(deck(["s1", [el("mine", 0), el("theirs", 99)]]));
  });

  it("leaves an element a collaborator changed after me", () => {
    const before = deck(["s1", [el("x")]]);
    const after = deck(["s1", [el("x", 50)]]);
    const current = deck(["s1", [el("x", 70)]]);
    expect(carryChanges(after, before, current, true)).toBe(current);
  });

  it("undoes an insert and a delete, keeping positions", () => {
    const before = deck(["s1", [el("a"), el("b"), el("c")]]);
    const after = deck(["s1", [el("a"), el("c"), el("new")]]);
    const current = deck(["s1", [el("a"), el("c"), el("new"), el("peer")]]);
    const undone = carryChanges(after, before, current, true);
    expect(undone.slides[0].elements.map((e) => e.id)).toEqual(["a", "b", "c", "peer"]);
    // Redo brings it back.
    const redone = carryChanges(before, after, undone, true);
    expect(redone.slides[0].elements.map((e) => e.id)).toEqual(["a", "c", "new", "peer"]);
  });

  it("undoes a slide added or removed, and slide props", () => {
    const before = deck(["s1", []], ["s2", []]);
    const after = deck(["s1", [], { notes: "n" }], ["s3", []], ["s2", []]);
    const current = deck(["s1", [], { notes: "n" }], ["s3", []], ["s2", [el("peer")]]);
    const undone = carryChanges(after, before, current, true);
    expect(undone.slides.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(undone.slides[0].notes).toBeUndefined();
    expect(undone.slides[1].elements.map((e) => e.id)).toEqual(["peer"]);
  });

  it("undoes a slide move only if nobody reordered since", () => {
    const before = deck(["s1", []], ["s2", []], ["s3", []]);
    const after = deck(["s3", []], ["s1", []], ["s2", []]);
    expect(carryChanges(after, before, after, true).slides.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    const moved = deck(["s1", []], ["s3", []], ["s2", []]);
    expect(carryChanges(after, before, moved, true)).toBe(moved);
  });

  it("forward-carries (non-strict) onto a step's after state", () => {
    const stepAfter = deck(["s1", [el("a")]]);
    const prev = deck(["s1", [el("a"), el("peer")]]);
    const next = deck(["s1", [el("a", 5), el("peer")]]);
    expect(carryChanges(prev, next, stepAfter, false)).toEqual(deck(["s1", [el("a", 5)]]));
  });

  it("does not touch comments", () => {
    const before: DeckDoc = { ...deck(["s1", []]), comments: [] };
    const after: DeckDoc = { ...before, comments: [{ id: "c" } as never] };
    expect(carryChanges(after, before, after, true)).toBe(after);
  });
});
