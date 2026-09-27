import { describe, expect, it } from "vitest";
import {
  applyLayout,
  builtinLayouts,
  findLayout,
  footerElements,
  hfFlags,
  isEmptyPlaceholder,
  layoutByType,
  nextLayoutFor,
  nextPlaceholder,
  placeholderPrompt,
  resetSlide,
  slideFromLayout,
  withFooters,
} from "./layouts";
import { applyTheme, findTheme, OFFICE_THEME } from "./theme";
import type { DeckDoc, Slide } from "./model";

const L = builtinLayouts(OFFICE_THEME, 540);
const lay = (type: string) => layoutByType(L, type)!;
let n = 0;
const ids = () => `id${++n}`;

describe("built-in layouts", () => {
  it("covers PowerPoint's standard set with placeholders and footer boxes", () => {
    expect(L.map((l) => l.type)).toEqual(["title", "obj", "secHead", "twoObj", "twoTxTwoObj", "titleOnly", "objTx", "blank"]);
    for (const l of L) {
      const types = l.elements.map((e) => e.placeholder?.type);
      expect(types).toEqual(expect.arrayContaining(["dt", "ftr", "sldNum"]));
    }
    expect(lay("title").elements.map((e) => e.placeholder!.type).slice(0, 2)).toEqual(["ctrTitle", "subTitle"]);
    expect(lay("twoObj").elements.filter((e) => e.placeholder?.type === "body").length).toBe(2);
    // Fonts/colours come from the theme and are bound to it.
    const title = lay("obj").elements[0];
    expect(title.themeRefs).toEqual({ color: "tx1", font: "major" });
  });

  it("scales boxes to the slide height (4:3)", () => {
    const tall = builtinLayouts(OFFICE_THEME, 720);
    const a = lay("obj").elements[1];
    const b = layoutByType(tall, "obj")!.elements[1];
    expect(b.x).toBe(a.x);
    expect(b.y).toBeCloseTo((a.y * 720) / 540, 1);
    expect(b.h).toBeCloseTo((a.h * 720) / 540, 1);
  });
});

describe("slides from layouts", () => {
  it("new slide copies placeholders (empty, fresh ids) but not footer boxes", () => {
    const s = slideFromLayout(lay("obj"), ids);
    expect(s.layout).toBe("obj");
    expect(s.elements.map((e) => e.placeholder!.type)).toEqual(["title", "body"]);
    expect(s.elements.every((e) => isEmptyPlaceholder(e))).toBe(true);
    expect(s.elements.map((e) => e.id)).not.toContain("title");
    expect(placeholderPrompt(s.elements[0])).toBe("Click to add title");
    expect(s.bgRef).toBe("bg1");
  });

  it("Ctrl+M uses the current layout; a title slide is followed by title and content", () => {
    const deck: DeckDoc = { slides: [slideFromLayout(lay("title")), slideFromLayout(lay("twoObj"))] };
    expect(nextLayoutFor(deck, 0)!.type).toBe("obj");
    expect(nextLayoutFor(deck, 1)!.type).toBe("twoObj");
    expect(nextLayoutFor({ slides: [{ id: "x", background: "#fff", elements: [] }] }, 0)!.type).toBe("obj");
  });

  it("apply layout moves matching placeholders, keeps content, adds missing and drops empty ones", () => {
    const s0 = slideFromLayout(lay("obj"), ids);
    const [title, body] = s0.elements;
    const deco = { id: "deco", type: "rect" as const, x: 1, y: 1, w: 5, h: 5 };
    const s: Slide = {
      ...s0,
      elements: [{ ...title, text: "Hello", bold: true }, { ...body, text: "Point" }, deco],
    };
    const two = applyLayout(s, lay("twoObj"));
    expect(two.layout).toBe("twoObj");
    const t = two.elements.find((e) => e.id === title.id)!;
    expect(t.text).toBe("Hello");
    expect(t.bold).toBe(true);
    const b1 = two.elements.find((e) => e.id === body.id)!;
    const lb1 = lay("twoObj").elements[1];
    expect([b1.x, b1.y, b1.w, b1.h]).toEqual([lb1.x, lb1.y, lb1.w, lb1.h]);
    expect(b1.text).toBe("Point");
    expect(two.elements.some((e) => e.id === "deco")).toBe(true);
    // The second body placeholder is new and empty.
    const bodies = two.elements.filter((e) => e.placeholder?.type === "body");
    expect(bodies.length).toBe(2);
    expect(isEmptyPlaceholder(bodies[1])).toBe(true);

    // Title only: the filled body is kept, an empty one would be removed.
    const only = applyLayout(two, lay("titleOnly"));
    expect(only.elements.some((e) => e.id === body.id)).toBe(true);
    expect(only.elements.filter((e) => e.placeholder?.type === "body").length).toBe(1);
    // Title slide: title → centred title, body → subtitle.
    const ts = applyLayout(s, lay("title"));
    expect(ts.elements.find((e) => e.id === title.id)!.placeholder!.type).toBe("ctrTitle");
    expect(ts.elements.find((e) => e.id === body.id)!.placeholder!.type).toBe("subTitle");
  });

  it("reset slide restores placeholder boxes and formatting, keeping the text", () => {
    const s0 = slideFromLayout(lay("obj"), ids);
    const moved: Slide = {
      ...s0,
      background: "#ff0000",
      elements: s0.elements.map((e, i) => (i === 0 ? { ...e, x: 300, fontSize: 80, text: "Keep", runs: [{ text: "Keep", bold: true }] } : e)),
    };
    const r = resetSlide(moved, lay("obj"));
    const t = r.elements[0];
    expect(t.id).toBe(s0.elements[0].id);
    expect(t.text).toBe("Keep");
    expect(t.runs).toBeUndefined();
    expect(t.x).toBe(lay("obj").elements[0].x);
    expect(t.fontSize).toBe(lay("obj").elements[0].fontSize);
    expect(r.background).toBe("#ffffff");
    expect(resetSlide(moved, undefined)).toBe(moved);
  });

  it("oo:slide/shortcuts/shortcuts.js#Check actions for objects with placeholder", () => {
    // Ctrl+Enter selects the next placeholder; on the last one the editor
    // adds a slide (nextPlaceholder → null) and moves to its first placeholder.
    const s = slideFromLayout(lay("twoObj"), ids);
    const [a, b, c] = s.elements.map((e) => e.id);
    expect(nextPlaceholder(s, null)).toBe(a);
    expect(nextPlaceholder(s, a)).toBe(b);
    expect(nextPlaceholder(s, b)).toBe(c);
    expect(nextPlaceholder(s, c)).toBeNull();
    // A non-placeholder selection starts at the first placeholder.
    expect(nextPlaceholder(s, "other")).toBe(a);
    const next = slideFromLayout(nextLayoutFor({ slides: [s] }, 0)!, ids);
    expect(nextPlaceholder(next, null)).toBe(next.elements[0].id);
    expect(nextPlaceholder({ id: "x", background: "#fff", elements: [] }, null)).toBeNull();
  });
});

describe("header & footer", () => {
  const deck = (): DeckDoc => ({
    slides: [slideFromLayout(lay("title")), slideFromLayout(lay("obj")), slideFromLayout(lay("obj"))],
    hf: { sldNum: true, ftr: true, footerText: "Grown", dt: true, dateText: "1 May 2026", notOnTitle: true },
  });

  it("draws number/footer/date from the layout boxes, not on title slides", () => {
    const d = deck();
    expect(footerElements(d, 0)).toEqual([]);
    const f = footerElements(d, 1);
    expect(f.map((e) => [e.id, e.text])).toEqual([
      ["hf-dt", "1 May 2026"],
      ["hf-ftr", "Grown"],
      ["hf-sldNum", "2"],
    ]);
    const box = lay("obj").elements.find((e) => e.placeholder?.type === "sldNum")!;
    expect(f[2].x).toBe(box.x);
    expect(withFooters(d, 2).elements.length).toBe(d.slides[2].elements.length + 3);
  });

  it("per-slide toggles override the deck and numbering can start elsewhere", () => {
    const d = deck();
    d.slides[1] = { ...d.slides[1], hf: { ftr: false, dt: false } };
    d.hf!.startAt = 0;
    expect(hfFlags(d, 1)).toEqual({ dt: false, ftr: false, sldNum: true });
    expect(footerElements(d, 1).map((e) => e.text)).toEqual(["1"]);
    d.slides[0] = { ...d.slides[0], hf: { sldNum: true } };
    expect(footerElements(d, 0)).toEqual([]); // notOnTitle wins
    d.hf!.notOnTitle = false;
    expect(footerElements(d, 0).map((e) => e.text)).toContain("0");
  });

  it("layouts follow theme changes when the deck carries them", () => {
    const d: DeckDoc = { slides: [], layouts: builtinLayouts(OFFICE_THEME) };
    const coral = findTheme("coral")!;
    const out = applyTheme(d, coral);
    const t = findLayout(out, "obj")!.elements[0];
    expect(t.fontFamily).toBe(coral.fonts.major);
    expect(t.color).toBe(coral.colors.dk1);
  });
});
