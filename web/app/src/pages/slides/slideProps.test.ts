import { afterEach, describe, expect, it } from "vitest";
import {
  backgroundCss,
  backgroundToAll,
  deckSize,
  presetOf,
  resizeDeck,
  setSlideBackground,
  showSlides,
  sizeFromInches,
  toggleHidden,
  twoStop,
} from "./slideProps";
import { CANVAS_H, setCanvasSize, type DeckDoc, type Slide } from "./model";

const slide = (id: string, p: Partial<Slide> = {}): Slide => ({ id, background: "#ffffff", elements: [], ...p });

afterEach(() => setCanvasSize(undefined));

describe("slide size", () => {
  it("defaults to 16:9 and knows the presets", () => {
    expect(deckSize({})).toEqual({ w: 960, h: 540 });
    expect(sizeFromInches(10, 7.5)).toEqual({ w: 960, h: 720 });
    expect(presetOf({})!.id).toBe("16:9");
    expect(presetOf({ size: { w: 960, h: 720 } })!.id).toBe("4:3");
    expect(presetOf({ size: { w: 960, h: 500 } })).toBeUndefined();
  });

  it("setCanvasSize drives the live CANVAS_H", () => {
    setCanvasSize({ w: 960, h: 720 });
    expect(CANVAS_H).toBe(720);
    setCanvasSize({ w: 4, h: 3 });
    expect(CANVAS_H).toBe(720);
    setCanvasSize(undefined);
    expect(CANVAS_H).toBe(540);
  });

  it("16:9 → 4:3 keeps the scale and centres vertically (ensure fit)", () => {
    const deck: DeckDoc = {
      slides: [slide("a", { elements: [{ id: "t", type: "text", x: 0, y: 0, w: 960, h: 540, fontSize: 20 }] })],
    };
    const out = resizeDeck(deck, { w: 960, h: 720 });
    expect(out.size).toEqual({ w: 960, h: 720 });
    expect(out.slides[0].elements[0]).toMatchObject({ x: 0, y: 90, w: 960, h: 540, fontSize: 20 });
  });

  it("4:3 → 16:9 scales content down (fit) or up (maximize), text too", () => {
    const deck: DeckDoc = {
      size: { w: 960, h: 720 },
      slides: [
        slide("a", {
          elements: [
            { id: "t", type: "text", x: 0, y: 0, w: 960, h: 720, fontSize: 40, runs: [{ text: "x", fontSize: 20 }], text: "x" },
            { id: "g", type: "group", x: 100, y: 100, w: 10, h: 10, children: [{ id: "c", type: "rect", x: 100, y: 100, w: 10, h: 10 }] },
          ],
        }),
      ],
    };
    const fit = resizeDeck(deck, { w: 16, h: 9 });
    expect(fit.size).toBeUndefined();
    const [t, g] = fit.slides[0].elements;
    expect(t).toMatchObject({ x: 120, y: 0, w: 720, h: 540, fontSize: 30 });
    expect(t.runs![0].fontSize).toBe(15);
    expect(g.children![0]).toMatchObject({ x: 195, y: 75, w: 7.5 });
    const max = resizeDeck(deck, { w: 16, h: 9 }, "max");
    expect(max.slides[0].elements[0]).toMatchObject({ x: 0, y: -90, w: 960, h: 720, fontSize: 40 });
  });
});

describe("backgrounds", () => {
  it("renders colour, gradient and picture backgrounds as CSS", () => {
    expect(backgroundCss({ background: "#abcdef" })).toBe("#abcdef");
    expect(backgroundCss({ background: "#000000", bgFill: twoStop("#ff0000", "#0000ff", 90) })).toBe(
      "linear-gradient(180deg, #ff0000 0%, #0000ff 100%), #000000",
    );
    expect(
      backgroundCss({ background: "#fff", bgFill: { kind: "gradient", stops: [{ pos: 0, color: "#fff" }, { pos: 1, color: "#000" }], radial: true } }),
    ).toBe("radial-gradient(circle, #fff 0%, #000 100%), #fff");
    expect(backgroundCss({ background: "#fff", bgFill: { kind: "image", src: "/a.png" } })).toBe('#fff url("/a.png") center / cover no-repeat');
  });

  it("sets one slide and applies to all, replacing theme refs", () => {
    const a = slide("a", { bgRef: "bg1" });
    const b = setSlideBackground(a, { background: "#112233", bgFill: twoStop("#112233", "#445566") });
    expect(b.bgRef).toBeUndefined();
    expect(b.bgFill!.kind).toBe("gradient");
    const all = backgroundToAll([a, slide("c", { bgFill: { kind: "image", src: "x" } })], b);
    expect(all.every((s) => s.background === "#112233" && s.bgFill?.kind === "gradient")).toBe(true);
    const plain = setSlideBackground(b, { background: "#ffffff", bgRef: "bg1" });
    expect(plain.bgFill).toBeUndefined();
    expect(plain.bgRef).toBe("bg1");
  });
});

describe("hidden slides", () => {
  it("toggles and is skipped by the slideshow", () => {
    let slides = [slide("a"), slide("b"), slide("c"), slide("d")];
    slides = toggleHidden(slides, ["b", "d"]);
    expect(slides.map((s) => !!s.hidden)).toEqual([false, true, false, true]);
    const show = showSlides({ slides }, 1);
    expect(show.slides.map((s) => s.id)).toEqual(["a", "c"]);
    expect(show.start).toBe(1); // editor slide b (hidden) → next visible, c
    expect(show.indexOf).toEqual([0, 2]);
    expect(showSlides({ slides }, 3).start).toBe(1); // nothing after: the last visible
    // Toggling a mixed selection hides all; toggling hidden ones shows them.
    expect(toggleHidden(slides, ["a", "b"]).every((s, i) => i > 1 || s.hidden)).toBe(true);
    const shown = toggleHidden(slides, ["b"]);
    expect("hidden" in shown[1]).toBe(false);
  });
});
