import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { deckToPptx } from "./write";
import { readPptx } from "./read";
import type { DeckDoc, SlideElement } from "../model";
import { inlineImages } from "../assets";

// Pictures through pptx (M6): srcRect crop, crop to shape, opacity, border,
// shadow and alt text survive export → import.

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const deckOf = (els: SlideElement[]): DeckDoc => ({ slides: [{ id: "s1", background: "#ffffff", elements: els }] });

const pic = (over: Partial<SlideElement> = {}): SlideElement => ({
  id: "p",
  type: "image",
  x: 96,
  y: 48,
  w: 192,
  h: 96,
  src: PNG_1PX,
  ...over,
});

async function slideXml(els: SlideElement[]): Promise<string> {
  const zip = await JSZip.loadAsync(await deckToPptx(deckOf(els)));
  return zip.file("ppt/slides/slide1.xml")!.async("string");
}

async function roundTrip(el: SlideElement): Promise<SlideElement> {
  const r = await readPptx(await deckToPptx(deckOf([el])));
  return r.deck.slides[0].elements[0];
}

const FULL = pic({
  crop: { l: 0.1, t: 0.2, r: 0.05, b: 0 },
  cropShape: "ellipse",
  opacity: 0.6,
  stroke: "#ff0000",
  strokeWidth: 2,
  dash: "dash",
  shadow: true,
  alt: "A red circle & friends",
});

describe("pptx pictures", () => {
  it("writes srcRect, alphaModFix, the crop shape, border, shadow and descr", async () => {
    const xml = await slideXml([FULL]);
    expect(xml).toMatch(/<a:srcRect l="10000" t="20000" r="5000"\/>/);
    expect(xml).toContain(`<a:alphaModFix amt="60000"/>`);
    expect(xml).toContain(`<a:prstGeom prst="ellipse">`);
    expect(xml).toMatch(/<a:ln w="25400"><a:solidFill><a:srgbClr val="FF0000"\/><\/a:solidFill><a:prstDash val="dash"\/><\/a:ln>/);
    expect(xml).toContain(`<a:outerShdw`);
    expect(xml).toContain(`descr="A red circle &amp; friends"`);
  });

  it("doesn't leak the image data into descr when there is no alt text", async () => {
    const xml = await slideXml([pic()]);
    expect(xml).not.toContain("descr=");
    expect(xml).not.toContain("srcRect");
  });

  it("round-trips crop, crop shape, opacity, border, shadow and alt text", async () => {
    const back = await roundTrip(FULL);
    expect(back).toMatchObject({
      type: "image",
      x: 96,
      y: 48,
      w: 192,
      h: 96,
      crop: { l: 0.1, t: 0.2, r: 0.05, b: 0 },
      cropShape: "ellipse",
      opacity: 0.6,
      stroke: "#ff0000",
      strokeWidth: 2,
      dash: "dash",
      shadow: true,
      alt: "A red circle & friends",
    });
    expect(back.src).toMatch(/^data:image\/png;base64,/);
  });

  it("a plain picture comes back plain", async () => {
    const back = await roundTrip(pic());
    for (const k of ["crop", "cropShape", "opacity", "stroke", "shadow", "alt"] as const) expect(back[k]).toBeUndefined();
  });

  it("alt text is kept on other elements too", async () => {
    const shape: SlideElement = { id: "r", type: "rect", x: 0, y: 0, w: 10, h: 10, fill: "#000000", alt: "Decorative box" };
    const xml = await slideXml([shape, pic()]);
    expect(xml).toContain(`descr="Decorative box"`);
  });
});

describe("inlineImages", () => {
  it("replaces asset URLs (in groups too) with data URLs, once per URL", async () => {
    const calls: string[] = [];
    const deck = deckOf([
      pic({ id: "a", src: "/api/v1/slides/d/x/assets/1" }),
      { id: "g", type: "group", x: 0, y: 0, w: 1, h: 1, children: [pic({ id: "b", src: "/api/v1/slides/d/x/assets/1" })] },
      pic({ id: "c", src: PNG_1PX }),
      pic({ id: "d", src: "/api/v1/slides/d/x/assets/missing" }),
    ]);
    const out = await inlineImages(deck, async (u) => {
      calls.push(u);
      return u.endsWith("/1") ? PNG_1PX : null;
    });
    const els = out.slides[0].elements;
    expect(els[0].src).toBe(PNG_1PX);
    expect(els[1].children![0].src).toBe(PNG_1PX);
    expect(els[2].src).toBe(PNG_1PX);
    expect(els[3].src).toBe("/api/v1/slides/d/x/assets/missing");
    expect(calls.sort()).toEqual(["/api/v1/slides/d/x/assets/1", "/api/v1/slides/d/x/assets/missing"]);
  });
});

describe("externalizeImages", () => {
  it("uploads each inline raster picture once and keeps SVGs and failures inline", async () => {
    const { externalizeImages } = await import("../assets");
    const svg = "data:image/svg+xml;base64,PHN2Zy8+";
    const bad = "data:image/png;base64,AAAA";
    const slides = [
      { id: "s", background: "#fff", elements: [pic({ id: "a" }), pic({ id: "b" }), pic({ id: "c", src: svg }), pic({ id: "d", src: bad })] },
    ];
    let n = 0;
    const out = await externalizeImages(slides, async (b) => {
      n++;
      if (b.size === 3) throw new Error("refused");
      expect(b.type).toBe("image/png");
      return "/api/v1/slides/d/x/assets/" + "a".repeat(64);
    });
    const els = out[0].elements;
    expect(els[0].src).toBe("/api/v1/slides/d/x/assets/" + "a".repeat(64));
    expect(els[1].src).toBe(els[0].src);
    expect(els[2].src).toBe(svg);
    expect(els[3].src).toBe(bad);
    expect(n).toBe(2);
  });
});
