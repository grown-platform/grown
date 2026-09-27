import { describe, expect, it } from "vitest";
import { gradientCss, newWordArt, warpFit, setWordArt, shadowOffset, warpPath, warpText, wordArtCss, wordArtCssText, wordArtFilter, TEXT_WARPS } from "./wordArt";
import { newElement } from "./model";

describe("word art effects", () => {
  it("outline and gradient map to text stroke and clipped background", () => {
    const css = wordArtCss({ outline: { color: "#000", width: 2 }, gradient: { from: "#f00", to: "#00f", angle: 90 } });
    expect(css.WebkitTextStroke).toBe("2px #000");
    expect(css.backgroundImage).toBe("linear-gradient(180deg, #f00, #00f)");
    expect(css.WebkitTextFillColor).toBe("transparent");
    expect(css.backgroundClip).toBe("text");
  });

  it("DrawingML gradient angles become CSS angles (0° = left to right)", () => {
    expect(gradientCss({ from: "a", to: "b", angle: 0 })).toBe("linear-gradient(90deg, a, b)");
    expect(gradientCss({ from: "a", to: "b", angle: 315 })).toBe("linear-gradient(45deg, a, b)");
  });

  it("shadow and glow are drop-shadow filters", () => {
    expect(shadowOffset(4, 90)).toEqual({ dx: 0, dy: 4 });
    expect(wordArtFilter({ shadow: { color: "#000", blur: 3, dist: 4, dir: 0 } })).toBe("drop-shadow(4px 0px 3px #000)");
    expect(wordArtFilter({ glow: { color: "#ff0", radius: 8 } })).toBe("drop-shadow(0 0 4px #ff0) drop-shadow(0 0 4px #ff0)");
    expect(wordArtFilter({})).toBeUndefined();
  });

  it("css text for the HTML export", () => {
    expect(wordArtCssText({ outline: { color: "red", width: 1 } })).toBe("-webkit-text-stroke:1px red;paint-order:stroke fill");
  });

  it("setting and clearing properties", () => {
    let el = { ...newElement("text"), ...newWordArt("glow") };
    expect(el.wordArt?.glow).toBeTruthy();
    el = setWordArt(el, "glow", undefined);
    el = setWordArt(el, "outline", undefined);
    expect(el.wordArt).toBeUndefined();
    el = setWordArt(el, "warp", "textCircle");
    expect(el.wordArt).toEqual({ warp: "textCircle" });
  });
});

describe("text warps (SVG textPath subset, F5)", () => {
  it("every preset yields a finite path inside a sane length", () => {
    for (const { value } of TEXT_WARPS) {
      const p = warpPath(value, 600, 200, 40);
      expect(p.d).toMatch(/^M/);
      expect(p.d).not.toMatch(/NaN|Infinity/);
      expect(p.length).toBeGreaterThan(100);
      expect(Number.isFinite(p.length)).toBe(true);
    }
    for (const { value } of TEXT_WARPS) expect(warpPath(value, 0, 0, 40).d).not.toMatch(/NaN/);
  });

  it("arch up rises from the box's lower corners to its top", () => {
    const fs = 20;
    const p = warpPath("textArchUp", 400, 200, fs);
    expect(p.d).toContain(" 0 0 1 ");
    const [, x0, y0] = /^M([\d.]+),([\d.]+)/.exec(p.d)!.map(Number);
    const [, x1, y1] = / ([\d.]+),([\d.]+)$/.exec(p.d)!.map(Number);
    expect(x0).toBeCloseTo(12, 0); // margin 0.6 em
    expect(x1).toBeCloseTo(388, 0);
    expect(y0).toBeCloseTo(200 - fs * 0.35, 0); // ends near the bottom
    expect(y1).toBeCloseTo(y0, 5);
    // Longer than the chord, shorter than the half ellipse.
    expect(p.length).toBeGreaterThan(376);
    expect(p.length).toBeLessThan(600);
  });

  it("text fits its path: centred when short, squeezed when long, spread round a circle", () => {
    expect(warpFit("textArchUp", "Hi", 20, 400)).toBe(' startOffset="50%" text-anchor="middle"');
    expect(warpFit("textArchUp", "x".repeat(60), 20, 400)).toBe(' textLength="392" lengthAdjust="spacingAndGlyphs"');
    expect(warpFit("textCircle", "Hi", 20, 400)).toBe(' textLength="392" lengthAdjust="spacing"');
  });

  it("slants run corner to corner", () => {
    expect(warpPath("textSlantUp", 100, 100, 10).d).toBe("M3,97.5 L97,10");
    expect(warpPath("textSlantDown", 100, 100, 10).d).toBe("M3,10 L97,97.5");
  });

  it("warped text is one line", () => {
    expect(warpText({ text: "a\nb\vc" })).toBe("a b c");
  });
});
