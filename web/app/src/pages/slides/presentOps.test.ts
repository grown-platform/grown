import { describe, it, expect } from "vitest";
import {
  autoAdvanceDelay,
  clickAdvances,
  formatElapsed,
  initialPresent,
  isShowMessage,
  nextSlideIndex,
  presentReduce,
  prevSlideIndex,
  stepsOf,
  type PresentAction,
  type PresentState,
} from "./presentOps";
import { buildTimeline } from "./animOps";
import { presentKeyAction } from "./keymap";
import { showSlides } from "./slideProps";
import type { AnimEffect, Slide, SlideElement } from "./model";

function el(id: string, order?: number): SlideElement {
  return {
    id,
    type: "rect",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    ...(order !== undefined ? { animation: { type: "appear" as const, order } } : {}),
  };
}
function slide(id: string, elements: SlideElement[] = [], extra: Partial<Slide> = {}): Slide {
  return { id, background: "#fff", elements, ...extra };
}
const fx = (id: string, target: string, start: AnimEffect["start"], extra: Partial<AnimEffect> = {}): AnimEffect => ({
  id,
  el: target,
  cls: "entr",
  kind: "fade",
  start,
  ...extra,
});

function run(steps: number[], actions: PresentAction[], s = initialPresent(), loop = false): PresentState {
  for (const a of actions) s = presentReduce(s, a, steps, { loop });
  return s;
}

describe("presentReduce", () => {
  const slides = [slide("a"), slide("b", [el("x", 1), el("y", 2)]), slide("c")];
  const steps = stepsOf(slides);

  it("counts click steps per slide (legacy orders are clicks)", () => {
    expect(steps).toEqual([0, 2, 0]);
  });

  it("plays each animation step before leaving the slide", () => {
    let s = run(steps, ["next"]);
    expect([s.cur, s.step]).toEqual([1, 0]);
    s = run(steps, ["next"], s);
    expect([s.cur, s.step, s.animate]).toEqual([1, 1, true]);
    s = run(steps, ["next", "next"], s);
    expect([s.cur, s.step]).toEqual([2, 0]);
  });

  it("prev undoes a step, then goes to the previous slide fully built", () => {
    let s = run(steps, ["next", "next", "next"]);
    expect([s.cur, s.step]).toEqual([1, 2]);
    s = run(steps, ["prev"], s);
    expect([s.cur, s.step, s.animate]).toEqual([1, 1, false]);
    s = run(steps, ["next", "next", "prev"], s);
    expect([s.cur, s.step, s.animate]).toEqual([1, 2, false]);
    const first = initialPresent();
    expect(presentReduce(first, "prev", steps)).toBe(first);
  });

  it("ends after the last slide, and a further next exits", () => {
    let s = run(steps, ["last", "next"]);
    expect(s.ended).toBe(true);
    expect(s.cur).toBe(2);
    expect(run(steps, ["prev"], s).ended).toBe(false);
    s = run(steps, ["next"], s);
    expect(s.exited).toBe(true);
  });

  it("loops to the first slide (and back) when looping", () => {
    const s = run(steps, ["last", "next"], initialPresent(), true);
    expect([s.cur, s.ended]).toEqual([0, false]);
    const back = run(steps, ["prev"], initialPresent(), true);
    expect([back.cur, back.step]).toEqual([2, 0]);
  });

  it("goes to a typed slide number on Enter; Enter alone is next", () => {
    const many = Array(12).fill(0);
    let s = run(many, [{ digit: "1" }, { digit: "0" }]);
    expect(s.digits).toBe("10");
    s = run(many, ["enter"], s);
    expect([s.cur, s.digits]).toEqual([9, ""]);
    s = run(many, ["enter"], s);
    expect(s.cur).toBe(10);
    s = run(many, [{ digit: "9" }, { digit: "9" }, "enter"], s);
    expect(s.cur).toBe(11);
  });

  it("toggles a black/white screen, which navigation clears first", () => {
    let s = run(steps, ["black"]);
    expect(s.blank).toBe("black");
    s = run(steps, ["white"], s);
    expect(s.blank).toBe("white");
    s = run(steps, ["next"], s);
    expect([s.blank, s.cur]).toEqual([null, 0]);
    expect(run(steps, ["black", "black"]).blank).toBeNull();
  });

  it("jumps with goto (clamped)", () => {
    expect(run(steps, [{ goto: 7 }]).cur).toBe(2);
    expect(run(steps, [{ goto: -1 }]).cur).toBe(0);
  });

  it("counts after-previous and with-previous chains into one click", () => {
    const s = slide("s", [el("a"), el("b"), el("c")], {
      anims: [fx("1", "a", "click"), fx("2", "b", "after"), fx("3", "c", "with")],
    });
    expect(stepsOf([s])).toEqual([1]);
    // An effect before the first click plays automatically (no step).
    const auto = slide("t", [el("a"), el("b")], { anims: [fx("1", "a", "after"), fx("2", "b", "click")] });
    expect(stepsOf([auto])).toEqual([1]);
  });

  it("skips hidden slides (the show list comes from showSlides)", () => {
    const deck = { slides: [slide("a"), slide("b", [], { hidden: true }), slide("c")] };
    const show = showSlides(deck);
    expect(show.slides.map((x) => x.id)).toEqual(["a", "c"]);
    expect(run(stepsOf(show.slides), ["next"]).cur).toBe(1);
  });
});

describe("autoAdvanceDelay", () => {
  const s = slide("s", [el("a")], { anims: [fx("1", "a", "after", { dur: 800 })], advanceAfter: 3000 });
  const t = buildTimeline(s);
  it("waits for the timing measured from the slide start", () => {
    expect(autoAdvanceDelay(s, t, 0, 0, 0)).toBe(3000);
    expect(autoAdvanceDelay(s, t, 0, 2500, 2500)).toBe(500);
    expect(autoAdvanceDelay(s, t, 0, 4000, 4000)).toBe(0);
  });
  it("never cuts off the step that is playing", () => {
    const short = { ...s, advanceAfter: 100 };
    expect(autoAdvanceDelay(short, t, 0, 0, 0)).toBe(800);
  });
  it("is null without a timing; clicks advance unless switched off", () => {
    expect(autoAdvanceDelay(slide("x"), buildTimeline(slide("x")), 0, 0, 0)).toBeNull();
    expect(clickAdvances(slide("x"))).toBe(true);
    expect(clickAdvances(slide("x", [], { advanceOnClick: false }))).toBe(false);
  });
});

describe("helpers", () => {
  it("clamps next/prev", () => {
    expect(nextSlideIndex(0, 3)).toBe(1);
    expect(nextSlideIndex(2, 3)).toBe(2);
    expect(prevSlideIndex(2)).toBe(1);
    expect(prevSlideIndex(0)).toBe(0);
  });
  it("formats the elapsed time", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(65_400)).toBe("01:05");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
  });
  it("validates channel messages", () => {
    expect(isShowMessage({ t: "hello" })).toBe(true);
    expect(isShowMessage({ t: "cmd", action: "next" })).toBe(true);
    expect(isShowMessage({ t: "state", state: { cur: 1 } })).toBe(true);
    expect(isShowMessage({ t: "state" })).toBe(false);
    expect(isShowMessage({ t: "nope" })).toBe(false);
    expect(isShowMessage(null)).toBe(false);
  });
});

describe("OnlyOffice parity", () => {
  // The slideshow half of the case, through the key map and the reducer
  // (12 slides, as in the OnlyOffice test). The editor half (Ctrl+P print,
  // Shift+F10 context menu, Ctrl+K hyperlink) is not part of the show:
  // Ctrl+K is covered by the text shortcuts; Ctrl+P and Shift+F10 are M13.
  it("oo:slide/shortcuts/shortcuts.js#Check actions with catch events", () => {
    const steps = Array(12).fill(0);
    let s = initialPresent(0);
    const press = (key: string) => {
      const a = presentKeyAction({ key });
      expect(a).not.toBeNull();
      if (a === "exit") s = { ...s, exited: true };
      else if (typeof a === "object" || ["next", "prev", "first", "last", "enter"].includes(a as string))
        s = presentReduce(s, a as PresentAction, steps);
      return s.cur;
    };
    expect(["ArrowRight", "ArrowDown", " ", "Enter", "PageDown"].map(press)).toEqual([1, 2, 3, 4, 5]);
    expect(["ArrowLeft", "ArrowUp", "PageUp"].map(press)).toEqual([4, 3, 2]);
    expect(press("Home")).toBe(0);
    expect(press("End")).toBe(11);
    press("5");
    expect(press("Enter")).toBe(4);
    press("8");
    expect(press("Enter")).toBe(7);
    press("1");
    press("0");
    expect(press("Enter")).toBe(9);
    expect(press("Enter")).toBe(10);
    press("Escape");
    expect(s.exited).toBe(true);
  });
});
