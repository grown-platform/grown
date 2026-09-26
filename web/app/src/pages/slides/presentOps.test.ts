import { describe, it, expect } from "vitest";
import {
  animationSteps,
  nextSlideIndex,
  presentReduce,
  prevSlideIndex,
  revealedElementIds,
  transitionAnimation,
  type PresentState,
} from "./presentOps";
import { TRANSITIONS, type Slide, type SlideElement } from "./model";

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
function slide(id: string, elements: SlideElement[] = []): Slide {
  return { id, background: "#fff", elements };
}

describe("animationSteps", () => {
  it("returns sorted unique orders and ignores un-animated elements", () => {
    const s = slide("s", [el("a", 3), el("b"), el("c", 1), el("d", 3)]);
    expect(animationSteps(s)).toEqual([1, 3]);
    expect(animationSteps(slide("x"))).toEqual([]);
    expect(animationSteps(undefined)).toEqual([]);
  });
});

describe("revealedElementIds", () => {
  const s = slide("s", [el("static"), el("first", 1), el("second", 5), el("alsoSecond", 5)]);
  const steps = animationSteps(s);
  it("shows only static elements before any click", () => {
    expect([...revealedElementIds(s, steps, 0)]).toEqual(["static"]);
  });
  it("reveals elements up to the current step, same-order ones together", () => {
    expect([...revealedElementIds(s, steps, 1)].sort()).toEqual(["first", "static"]);
    expect([...revealedElementIds(s, steps, 2)].sort()).toEqual([
      "alsoSecond",
      "first",
      "second",
      "static",
    ]);
  });
  it("is empty without a slide", () => {
    expect(revealedElementIds(undefined, [], 0).size).toBe(0);
  });
});

describe("presentReduce", () => {
  const slides = [slide("a"), slide("b", [el("x", 1), el("y", 2)]), slide("c")];
  const at = (cur: number, animStep = 0): PresentState => ({ cur, animStep });

  it("advances plain slides and clamps at the last", () => {
    expect(presentReduce(at(0), "next", slides)).toEqual(at(1));
    const last = at(2);
    expect(presentReduce(last, "next", slides)).toBe(last);
  });

  it("plays each animation step before leaving the slide", () => {
    let s = presentReduce(at(0), "next", slides);
    s = presentReduce(s, "next", slides);
    expect(s).toEqual(at(1, 1));
    s = presentReduce(s, "next", slides);
    expect(s).toEqual(at(1, 2));
    s = presentReduce(s, "next", slides);
    expect(s).toEqual(at(2, 0));
  });

  it("goes back a slide (resetting steps) and clamps at 0", () => {
    expect(presentReduce(at(1, 2), "prev", slides)).toEqual(at(0, 0));
    const first = at(0);
    expect(presentReduce(first, "prev", slides)).toBe(first);
  });
});

describe("slide index clamps", () => {
  it("clamps next/prev", () => {
    expect(nextSlideIndex(0, 3)).toBe(1);
    expect(nextSlideIndex(2, 3)).toBe(2);
    expect(prevSlideIndex(2)).toBe(1);
    expect(prevSlideIndex(0)).toBe(0);
  });
});

describe("transitionAnimation", () => {
  it("maps every non-none transition to a CSS animation", () => {
    for (const t of TRANSITIONS) {
      const a = transitionAnimation(t.type);
      if (t.type === "none") expect(a).toBeUndefined();
      else expect(a).toMatch(/^slides\w+ 350ms ease$/);
    }
    expect(transitionAnimation(undefined)).toBeUndefined();
  });
});

describe("OnlyOffice parity", () => {
  // SKIP: Grown's slideshow supports Right/Down/Space → next, Left/Up → prev
  // and Esc → exit (see keymap tests), but not PgDn/PgUp/Enter/Backspace,
  // Home/End, typing a slide number + Enter, Ctrl+P print, Shift+F10 context
  // menu or Ctrl+K hyperlink dialog from the shortcut set this case covers.
  it.skip("oo:slide/shortcuts/shortcuts.js#Check actions with catch events", () => {
    const slides = Array.from({ length: 12 }, (_, i) => slide(`s${i}`));
    // End → last slide in one step.
    expect(presentReduce({ cur: 0, animStep: 0 }, "next", slides).cur).toBe(11);
  });
});
