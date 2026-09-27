import { describe, it, expect } from "vitest";
import {
  ANIM_CATALOG,
  addEffect,
  buildTimeline,
  clickSteps,
  effectCss,
  effectLabel,
  effectsOf,
  framesAt,
  frameStyle,
  groupEnd,
  moveEffect,
  remapEffects,
  removeEffects,
  removeElementEffects,
  updateEffect,
} from "./animOps";
import { editorKeyAction } from "./keymap";
import type { AnimEffect, Slide, SlideElement } from "./model";

const box = (id: string, extra: Partial<SlideElement> = {}): SlideElement => ({
  id,
  type: "rect",
  x: 100,
  y: 100,
  w: 50,
  h: 50,
  ...extra,
});
const fx = (id: string, el: string, start: AnimEffect["start"], extra: Partial<AnimEffect> = {}): AnimEffect => ({
  id,
  el,
  cls: "entr",
  kind: "fade",
  start,
  ...extra,
});
const slideOf = (anims: AnimEffect[] | undefined, els = ["a", "b", "c", "d"].map((i) => box(i))): Slide => ({
  id: "s",
  background: "#fff",
  elements: els,
  ...(anims ? { anims } : {}),
});
let n = 0;
const ids = () => `n${++n}`;

describe("effect list", () => {
  it("reads pre-M8 element animations as click effects (equal orders together)", () => {
    const s = slideOf(undefined, [
      box("a", { animation: { type: "fly-in-left", order: 2 } }),
      box("b", { animation: { type: "fade-in", order: 1 } }),
      box("c", { animation: { type: "appear", order: 2 } }),
      box("d"),
    ]);
    const e = effectsOf(s);
    expect(e.map((x) => [x.el, x.kind, x.start, x.dir])).toEqual([
      ["b", "fade", "click", undefined],
      ["a", "fly", "click", "l"],
      ["c", "appear", "with", undefined],
    ]);
  });

  it("adds effects (first on click, the rest with it) and migrates legacy ones", () => {
    const s = slideOf(undefined, [box("a", { animation: { type: "appear", order: 1 } }), box("b"), box("c")]);
    const r = addEffect(s, ["b", "c"], "entr", "fly", ids);
    expect(r.slide.elements.some((e) => e.animation)).toBe(false);
    expect(r.slide.anims!.map((e) => [e.el, e.kind, e.start, e.dir])).toEqual([
      ["a", "appear", "click", undefined],
      ["b", "fly", "click", "b"],
      ["c", "fly", "with", "b"],
    ]);
    expect(r.slide.anims!.every((e) => !e.id.startsWith("legacy-"))).toBe(true);
    expect(r.ids).toHaveLength(2);
  });

  it("updates, reorders and removes effects", () => {
    let s = slideOf([fx("1", "a", "click"), fx("2", "b", "click", { kind: "fly", dir: "l" }), fx("3", "c", "after")]);
    s = updateEffect(s, "2", { kind: "spin", cls: "emph" });
    expect(s.anims![1]).toEqual({ id: "2", el: "b", cls: "emph", kind: "spin", start: "click" });
    s = updateEffect(s, "1", { kind: "wipe" });
    expect(s.anims![0].dir).toBe("b");
    s = updateEffect(s, "1", { delay: 250, dur: 900, start: "with" });
    expect(s.anims![0]).toMatchObject({ delay: 250, dur: 900, start: "with" });
    s = moveEffect(s, "3", -1);
    expect(s.anims!.map((e) => e.id)).toEqual(["1", "3", "2"]);
    expect(moveEffect(s, "1", -1)).toBe(s);
    s = removeEffects(s, ["3"]);
    expect(s.anims!.map((e) => e.id)).toEqual(["1", "2"]);
    s = removeElementEffects(s, "a");
    expect(s.anims!.map((e) => e.id)).toEqual(["2"]);
    s = removeEffects(s, ["2"]);
    expect(s.anims).toBeUndefined();
  });

  it("drops effects whose element is gone, and remaps on copy", () => {
    const s = slideOf([fx("1", "a", "click"), fx("2", "zzz", "click")]);
    expect(effectsOf(s).map((e) => e.id)).toEqual(["1"]);
    const m = remapEffects(s.anims, new Map([["a", "A"]]), ids)!;
    expect(m.map((e) => e.el)).toEqual(["A"]);
    expect(remapEffects(undefined, new Map())).toBeUndefined();
  });

  it("labels effects", () => {
    expect(effectLabel(fx("1", "a", "click", { kind: "fly", dir: "l" }))).toBe("Fly in from left");
    expect(effectLabel(fx("1", "a", "click", { cls: "exit", kind: "fly", dir: "r" }))).toBe("Fly out to right");
    expect(effectLabel(fx("1", "a", "click", { cls: "emph", kind: "grow" }))).toBe("Grow/Shrink");
    for (const cls of ["entr", "emph", "exit"] as const) expect(ANIM_CATALOG[cls].length).toBeGreaterThanOrEqual(5);
  });

  // #10: Delete with an effect selected removes the effect, not the shape.
  it("oo:slide/shortcuts/shortcuts.js#Check remove graphic objects (animation effect)", () => {
    const s = slideOf([fx("1", "a", "click")]);
    expect(editorKeyAction({ key: "Delete" }, { hasSelection: true })).toEqual({ type: "deleteSelected" });
    const after = removeEffects(s, ["1"]);
    expect(effectsOf(after)).toEqual([]);
    expect(after.elements.map((e) => e.id)).toEqual(s.elements.map((e) => e.id));
  });
});

describe("buildTimeline", () => {
  it("orders click groups with with/after chains and delays", () => {
    const s = slideOf([
      fx("1", "a", "click", { dur: 500 }),
      fx("2", "b", "with", { dur: 1000, delay: 200 }),
      fx("3", "c", "after", { dur: 400 }),
      fx("4", "d", "with", { dur: 100, delay: 50 }),
      fx("5", "a", "click", { cls: "exit", dur: 300 }),
      fx("6", "b", "after", { cls: "exit", dur: 300, delay: 100 }),
    ]);
    const t = buildTimeline(s);
    expect(clickSteps(t)).toBe(2);
    expect(t.groups[0]).toEqual([]);
    expect(t.groups[1].map((x) => [x.effect.id, x.begin, x.end])).toEqual([
      ["1", 0, 500],
      ["2", 200, 1200],
      ["3", 1200, 1600],
      ["4", 1250, 1350],
    ]);
    expect(groupEnd(t.groups[1])).toBe(1600);
    expect(t.groups[2].map((x) => [x.effect.id, x.begin, x.end])).toEqual([
      ["5", 0, 300],
      ["6", 400, 700],
    ]);
  });

  it("plays leading with/after effects automatically (group 0)", () => {
    const t = buildTimeline(slideOf([fx("1", "a", "with"), fx("2", "b", "after"), fx("3", "c", "click")]));
    expect(t.groups[0].map((x) => [x.effect.id, x.begin])).toEqual([
      ["1", 0],
      ["2", 500],
    ]);
    expect(clickSteps(t)).toBe(1);
  });

  it("uses each kind's default duration", () => {
    const t = buildTimeline(slideOf([fx("1", "a", "click", { cls: "emph", kind: "spin" }), fx("2", "b", "after", { kind: "appear" })]));
    expect(t.groups[1].map((x) => [x.begin, x.end])).toEqual([
      [0, 2000],
      [2000, 2001],
    ]);
  });

  it("splits a by-paragraph text effect into one step per paragraph", () => {
    const s = slideOf(
      [fx("1", "t", "click", { byPara: true }), fx("2", "u", "after", { byPara: true })],
      [
        { id: "t", type: "text", text: "one\n\ntwo\nthree", x: 0, y: 0, w: 10, h: 10 },
        { id: "u", type: "text", text: "x\ny", x: 0, y: 0, w: 10, h: 10 },
      ],
    );
    const t = buildTimeline(s);
    expect(t.groups.map((g) => g.map((x) => `${x.effect.el}:${x.para}@${x.begin}`))).toEqual([
      [],
      ["t:0@0"],
      ["t:2@0"],
      ["t:3@0", "u:0@500", "u:1@1000"],
    ]);
  });
});

describe("framesAt", () => {
  const s = slideOf([
    fx("1", "a", "click"),
    fx("2", "b", "after", { kind: "fly", dir: "l" }),
    fx("3", "c", "click", { cls: "exit" }),
    fx("4", "d", "click", { cls: "emph", kind: "grow", scale: 2 }),
  ]);
  const t = buildTimeline(s);

  it("hides entrances until played and shows exits until played", () => {
    const f = framesAt(s, t, 0, true);
    expect(f.get("a")).toEqual({ hidden: true });
    expect(f.get("b")).toEqual({ hidden: true });
    expect(f.get("c")).toEqual({});
    expect(f.get("d")).toEqual({});
  });

  it("animates the group that was just triggered, with delays", () => {
    const f = framesAt(s, t, 1, true);
    expect(f.get("a")!.animation).toBe("anFade 500ms ease 0ms 1 both");
    expect(f.get("a")!.hidden).toBeUndefined();
    expect(f.get("b")!.animation).toBe("anFlyL 500ms ease-out 500ms 1 both");
    expect(f.get("b")!.vars!["--fl"]).toBe("-160px");
    expect(f.get("a")!.nonce).toBe(1);
  });

  it("settles earlier groups: exits hide, grow keeps its scale", () => {
    let f = framesAt(s, t, 2, true);
    expect(f.get("a")).toEqual({});
    expect(f.get("c")!.animation).toContain("reverse both");
    f = framesAt(s, t, 3, false);
    expect(f.get("c")).toEqual({ hidden: true });
    expect(f.get("d")).toEqual({ scale: 2 });
    expect(frameStyle(f.get("c"))).toEqual({ opacity: 0, pointerEvents: "none" });
    expect(frameStyle(f.get("d"))).toEqual({ scale: "2" });
  });

  it("builds CSS for every catalogue entry", () => {
    for (const cls of ["entr", "emph", "exit"] as const)
      for (const d of ANIM_CATALOG[cls]) {
        const css = effectCss({ effect: fx("x", "a", "click", { cls, kind: d.kind, dir: "t" }), start: "click", begin: 10, end: 510 });
        expect(css).toMatch(/^an\w+ \d+ms [\w-]+ 10ms 1( reverse)? both$/);
        if (cls === "exit") expect(css).toContain("reverse");
      }
  });
});
