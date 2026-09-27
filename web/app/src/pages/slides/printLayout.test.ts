import { describe, expect, it } from "vitest";
import { newElement, newTable, type Slide, type SlideElement } from "./model";
import {
  DEFAULT_PRINT,
  PAPER_PT,
  fitBox,
  handoutGrid,
  parseRange,
  printPages,
  printedSlides,
  slideOutline,
  type PrintOptions,
} from "./printLayout";

const opts = (o: Partial<PrintOptions>): PrintOptions => ({ ...DEFAULT_PRINT, ...o });
const text = (id: string, t: string, over: Partial<SlideElement> = {}): SlideElement => ({ ...newElement("text"), id, text: t, ...over });
const slides = (n: number, hidden: number[] = []): Slide[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, background: "#fff", elements: [text(`t${i}`, `Slide ${i + 1}`)], hidden: hidden.includes(i) || undefined }));
const within = (inner: { x: number; y: number; w: number; h: number }, outer: { w: number; h: number }) =>
  inner.x >= 0 && inner.y >= 0 && inner.x + inner.w <= outer.w + 1e-6 && inner.y + inner.h <= outer.h + 1e-6;

describe("parseRange", () => {
  it("reads lists, ranges and open ranges (1-based → 0-based)", () => {
    expect(parseRange("1-3, 5", 10)).toEqual([0, 1, 2, 4]);
    expect(parseRange("8-", 10)).toEqual([7, 8, 9]);
    expect(parseRange("-2", 10)).toEqual([0, 1]);
    expect(parseRange("3 3 2", 10)).toEqual([1, 2]);
    expect(parseRange("9-20", 10)).toEqual([8, 9]);
  });
  it("rejects malformed or empty selections", () => {
    expect(parseRange("", 5)).toBeNull();
    expect(parseRange("a", 5)).toBeNull();
    expect(parseRange("4-2", 5)).toBeNull();
    expect(parseRange("0", 5)).toBeNull();
    expect(parseRange("7", 5)).toBeNull();
    expect(parseRange("-", 5)).toBeNull();
  });
});

describe("printedSlides", () => {
  const deck = slides(5, [1]);
  it("skips hidden slides unless included", () => {
    expect(printedSlides(deck, opts({}))).toEqual([0, 2, 3, 4]);
    expect(printedSlides(deck, opts({ includeHidden: true }))).toEqual([0, 1, 2, 3, 4]);
  });
  it("prints the current slide even when hidden, and custom ranges", () => {
    expect(printedSlides(deck, opts({ range: "current" }), 1)).toEqual([1]);
    expect(printedSlides(deck, opts({ range: "custom", custom: "1-3" }))).toEqual([0, 2]);
    expect(printedSlides(deck, opts({ range: "custom", custom: "junk" }))).toEqual([]);
  });
});

describe("printPages", () => {
  const aspect = 540 / 960;
  it("full slides: one slide-sized page per slide", () => {
    const pages = printPages(slides(3), [0, 1, 2], opts({ frame: true }), aspect);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toMatchObject({ w: 720, h: 405 });
    expect(pages[2].items).toEqual([{ kind: "slide", index: 2, box: { x: 0, y: 0, w: 720, h: 405 }, frame: true }]);
  });

  it("4:3 decks keep their aspect", () => {
    expect(printPages(slides(1), [0], opts({}), 0.75)[0]).toMatchObject({ w: 720, h: 540 });
  });

  it("notes pages: slide on top, notes below, page numbers", () => {
    const pages = printPages(slides(2), [0, 1], opts({ layout: "notes" }), aspect);
    expect(pages).toHaveLength(2);
    const [s, notes] = pages[1].items;
    expect(s).toMatchObject({ kind: "slide", index: 1 });
    expect(notes).toMatchObject({ kind: "notes", index: 1 });
    if (s.kind !== "slide" || notes.kind !== "notes") throw new Error();
    expect(notes.box.y).toBeGreaterThan(s.box.y + s.box.h);
    expect(s.box.h / s.box.w).toBeCloseTo(aspect);
    expect(pages[1].items.find((i) => i.kind === "label")).toMatchObject({ text: "2" });
  });

  it.each([1, 2, 3, 4, 6, 9] as const)("handouts %i per page: grid, paging, all boxes on the page", (n) => {
    const count = 10;
    const pages = printPages(slides(count), [...Array(count).keys()], opts({ layout: "handouts", perPage: n }), aspect, "Deck");
    expect(pages).toHaveLength(Math.ceil(count / n));
    const boxes = pages.flatMap((p) => p.items.filter((i) => i.kind === "slide"));
    expect(boxes.map((b) => (b.kind === "slide" ? b.index : -1))).toEqual([...Array(count).keys()]);
    for (const p of pages) {
      expect(p).toMatchObject(PAPER_PT.letter);
      for (const it of p.items) if ("box" in it) expect(within(it.box, p)).toBe(true);
      const sl = p.items.filter((i) => i.kind === "slide");
      // No two slides overlap.
      for (let a = 0; a < sl.length; a++)
        for (let b = a + 1; b < sl.length; b++) {
          const A = sl[a].box, B = sl[b].box;
          expect(A.x + A.w <= B.x + 1e-6 || B.x + B.w <= A.x + 1e-6 || A.y + A.h <= B.y + 1e-6 || B.y + B.h <= A.y + 1e-6).toBe(true);
        }
      expect(p.items.some((i) => i.kind === "label" && i.text === "Deck")).toBe(true);
      expect(p.items.filter((i) => i.kind === "lines")).toHaveLength(n === 3 ? sl.length : 0);
    }
  });

  it("handout order: horizontal fills rows first, vertical fills columns first", () => {
    const h = printPages(slides(4), [0, 1, 2, 3], opts({ layout: "handouts", perPage: 4 }), aspect)[0].items.filter((i) => i.kind === "slide");
    const v = printPages(slides(4), [0, 1, 2, 3], opts({ layout: "handouts", perPage: 4, order: "vertical" }), aspect)[0].items.filter((i) => i.kind === "slide");
    expect(h[1].box.y).toBeCloseTo(h[0].box.y);
    expect(v[1].box.x).toBeCloseTo(v[0].box.x);
  });

  it("A4 paper", () => {
    expect(printPages(slides(1), [0], opts({ layout: "handouts", paper: "a4" }), aspect)[0]).toMatchObject(PAPER_PT.a4);
  });

  it("outline paginates long decks", () => {
    const deck = Array.from({ length: 40 }, (_, i): Slide => ({
      id: `s${i}`,
      background: "#fff",
      elements: [text(`t${i}`, `Title ${i}`, { placeholder: { type: "title" } }), text(`b${i}`, "Point one\nPoint two\nPoint three")],
    }));
    const pages = printPages(deck, [...Array(40).keys()], opts({ layout: "outline" }), aspect);
    expect(pages.length).toBeGreaterThan(1);
    const all = pages.flatMap((p) => p.items.flatMap((i) => (i.kind === "outline" ? i.entries.map((e) => e.index) : [])));
    expect(all).toEqual([...Array(40).keys()]);
  });
});

describe("slideOutline", () => {
  it("title placeholder first, body paragraphs with levels, tables and alt text", () => {
    const tbl: SlideElement = { ...newElement("table"), id: "tb", table: { ...newTable(2, 2), cells: [["A", "B"], ["1", ""]] } };
    const s: Slide = {
      id: "s",
      background: "#fff",
      elements: [
        text("b", "Intro\nDetail", { paras: [{}, { level: 1 }] }),
        text("t", "The title", { placeholder: { type: "title" } }),
        tbl,
        { ...newElement("image"), id: "i", alt: "A cat" },
        text("f", "Footer", { placeholder: { type: "ftr" } }),
      ],
    };
    expect(slideOutline(s, 0)).toEqual({
      index: 0,
      title: "The title",
      body: [
        { text: "Intro", level: 0 },
        { text: "Detail", level: 1 },
        { text: "A | B", level: 0 },
        { text: "1", level: 0 },
        { text: "[Picture: A cat]", level: 0 },
      ],
    });
  });
});

describe("layout helpers", () => {
  it("handout grids", () => {
    expect([1, 2, 3, 4, 6, 9].map((n) => handoutGrid(n as 1))).toEqual([
      { cols: 1, rows: 1 },
      { cols: 1, rows: 2 },
      { cols: 1, rows: 3 },
      { cols: 2, rows: 2 },
      { cols: 2, rows: 3 },
      { cols: 3, rows: 3 },
    ]);
  });
  it("fitBox centres the largest box of an aspect", () => {
    expect(fitBox({ x: 0, y: 0, w: 200, h: 200 }, 0.5)).toEqual({ x: 0, y: 50, w: 200, h: 100 });
    expect(fitBox({ x: 10, y: 0, w: 400, h: 100 }, 0.5)).toEqual({ x: 110, y: 0, w: 200, h: 100 });
  });
});
