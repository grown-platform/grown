import { describe, it, expect } from "vitest";
import {
  TRANSITION_CSS,
  TRANSITION_DEFS,
  morphPairs,
  morphStyle,
  normalizeTransition,
  slideTransition,
  transitionFx,
} from "./transitions";
import type { Slide, SlideElement } from "./model";

const slide = (extra: Partial<Slide> = {}, elements: SlideElement[] = []): Slide => ({
  id: "s",
  background: "#fff",
  elements,
  ...extra,
});

describe("transition catalogue", () => {
  it("maps the pre-M8 names to push directions", () => {
    expect(normalizeTransition("slide-left")).toEqual({ type: "push", dir: "l" });
    expect(normalizeTransition("slide-right")).toEqual({ type: "push", dir: "r" });
    expect(normalizeTransition("slide-up")).toEqual({ type: "push", dir: "u" });
    expect(normalizeTransition(undefined)).toEqual({ type: "none" });
  });

  it("defaults the option and duration, and honours overrides", () => {
    expect(slideTransition(slide({ transition: "wipe" }))).toEqual({ type: "wipe", dir: "l", dur: 1000 });
    expect(slideTransition(slide({ transition: "split", transitionDir: "horz-in", transitionDur: 400 }))).toEqual({
      type: "split",
      dir: "horz-in",
      dur: 400,
    });
    // An option the type does not have falls back to its default.
    expect(slideTransition(slide({ transition: "zoom", transitionDir: "l" })).dir).toBe("in");
    expect(slideTransition(slide({ transition: "cut", transitionDur: 900 })).dur).toBe(0);
  });

  it("gives every type (and option) CSS whose keyframes exist", () => {
    const names = new Set([...TRANSITION_CSS.matchAll(/@keyframes (\w+)/g)].map((m) => m[1]));
    for (const d of TRANSITION_DEFS) {
      for (const o of d.options.length ? d.options : [{ value: undefined as unknown as string }]) {
        const f = transitionFx(slide({ transition: d.type, transitionDir: o.value }));
        if (d.type === "none" || d.type === "cut") {
          expect(f).toEqual({ total: 0 });
          continue;
        }
        expect(f.total).toBe(d.dur);
        for (const a of [f.incoming, f.outgoing]) {
          expect(a).toBeDefined();
          expect(names.has(a!.split(" ")[0])).toBe(true);
        }
      }
    }
  });

  it("maps directions and layering", () => {
    expect(transitionFx(slide({ transition: "push", transitionDir: "l", transitionDur: 600 }))).toEqual({
      incoming: "trInR 600ms ease-in-out 0ms both",
      outgoing: "trOutL 600ms ease-in-out 0ms both",
      total: 600,
    });
    expect(transitionFx(slide({ transition: "uncover", transitionDir: "d" })).outgoing).toMatch(/^trOutB /);
    expect(transitionFx(slide({ transition: "uncover" })).outgoingOnTop).toBe(true);
    expect(transitionFx(slide({ transition: "cover", transitionDir: "u" })).incoming).toMatch(/^trInB /);
    expect(transitionFx(slide({ transition: "wipe", transitionDir: "r" })).incoming).toMatch(/^trWipeL /);
    expect(transitionFx(slide({ transition: "split", transitionDir: "vert-out" })).incoming).toMatch(/^trSplitOpenV /);
    expect(transitionFx(slide({ transition: "fade", transitionDir: "black", transitionDur: 1000 })).incoming).toBe(
      "trFadeIn 500ms ease-in-out 500ms both",
    );
    expect(transitionFx(slide({ transition: "slide-up" })).incoming).toMatch(/^trInB /);
  });
});

describe("morph-lite", () => {
  const a = (id: string, extra: Partial<SlideElement>): SlideElement => ({ id, type: "rect", x: 0, y: 0, w: 100, h: 50, ...extra });
  it("matches by name, then id, then content; each old element once", () => {
    const prev = slide({}, [
      a("p1", { name: "Logo", x: 10 }),
      a("p2", { x: 20 }),
      { id: "p3", type: "text", text: "Title", x: 30, y: 0, w: 100, h: 50 },
      a("p4", { fill: "#f00", x: 40 }),
    ]);
    const next = slide({}, [
      a("n1", { name: "Logo", x: 500 }),
      a("p2", { x: 600 }),
      { id: "n3", type: "text", text: "Title", x: 700, y: 0, w: 100, h: 50 },
      a("n4", { fill: "#f00" }),
      a("n5", { fill: "#f00" }),
    ]);
    const pairs = morphPairs(prev, next);
    expect(pairs.map((p) => [p.id, p.fromId, p.from.x])).toEqual([
      ["n1", "p1", 10],
      ["p2", "p2", 20],
      ["n3", "p3", 30],
      ["n4", "p4", 40],
    ]);
    expect(morphPairs(undefined, next)).toEqual([]);
  });

  it("tweens from the old box about the centre", () => {
    const st = morphStyle(a("n", { x: 100, y: 100, w: 200, h: 100 }), { x: 0, y: 0, w: 100, h: 50 }, 1000);
    expect(st).toEqual({
      "--mx": "-150px",
      "--my": "-125px",
      "--msx": "0.5",
      "--msy": "0.5",
      animation: "trMorph 1000ms ease-in-out 0ms both",
    });
  });
});
