// Every M1–M11 feature survives the picture-based export paths (SVG/PNG/
// JPEG via slideToSVG, the PDF/print pages via printRender, HTML via
// slideHTML). pptx has its own round-trip suite (pptx/*.test.ts) and ODP
// its writer tests (odp/write.test.ts).
import { describe, expect, it } from "vitest";
import { newElement, newShape, newTable, type DeckDoc, type Slide, type SlideElement } from "./model";
import { slideHTML, slideToSVG } from "./export";
import { objectsToPictures } from "./exportObjects";
import { newChartElement } from "./chartElement";
import { newDiagram } from "./diagrams";
import { OFFICE_THEME } from "./theme";
import { newWordArt } from "./wordArt";
import { estimateMeasure } from "./svgText";
import { DEFAULT_PRINT, printPages } from "./printLayout";
import { renderPage, slideSvgCache } from "./printRender";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function richDeck(): DeckDoc {
  const title: SlideElement = { ...newElement("text"), id: "title", x: 40, y: 20, w: 500, h: 60, text: "Bold and plain", runs: [{ text: "Bold", bold: true, color: "#c00000" }, { text: " and plain" }] };
  const bullets: SlideElement = { ...newElement("text"), id: "list", x: 40, y: 90, w: 300, h: 120, text: "One\nTwo", list: "bullet", rotation: 30 };
  const table: SlideElement = { ...newElement("table"), id: "tbl", x: 600, y: 20, w: 300, h: 100, table: { ...newTable(2, 2), cells: [["Head A", "Head B"], ["1", "2"]] } };
  const star = { ...newShape("star5"), id: "star", x: 380, y: 100, w: 100, h: 100 };
  const a = { ...newElement("rect"), id: "ga", x: 40, y: 300, w: 50, h: 50, fill: "#00ff00" };
  const b = { ...newElement("ellipse"), id: "gb", x: 120, y: 300, w: 50, h: 50, fill: "#0000ff" };
  const group: SlideElement = { ...newElement("rect"), id: "grp", type: "group", x: 40, y: 300, w: 130, h: 50, children: [a, b] };
  const img: SlideElement = { ...newElement("image", PNG), id: "img", x: 200, y: 380, w: 60, h: 60, alt: "A dot" };
  const chart = { ...newChartElement("column", { x: 600, y: 200 }), id: "chart" };
  const media: SlideElement = { id: "clip", type: "media", x: 300, y: 380, w: 160, h: 90, media: { kind: "video", src: "https://example.com/a.mp4", poster: PNG } };
  const art: SlideElement = { ...newElement("text"), ...newWordArt("gradient", "Wow"), id: "art" } as SlideElement;
  const warp: SlideElement = { ...newElement("text"), ...newWordArt("arch", "Arched"), id: "warp" } as SlideElement;
  const diagram = { ...newDiagram("process", "Plan\nBuild\nShip", { x: 500, y: 400, w: 400, h: 100 }, OFFICE_THEME), id: "diag" };
  const s1: Slide = {
    id: "s1",
    background: "#ffffff",
    bgFill: { kind: "gradient", stops: [{ pos: 0, color: "#ffeeee" }, { pos: 1, color: "#eeeeff" }], angle: 90 },
    elements: [title, bullets, table, star, group, img, chart, media, art, warp, diagram],
    notes: "Remember the demo.",
  };
  const s2: Slide = { id: "s2", background: "#202124", elements: [{ ...newElement("text"), id: "t2", text: "Second" }] };
  return { slides: [s1, s2], theme: OFFICE_THEME };
}

const parses = (svg: string) => {
  const d = new DOMParser().parseFromString(svg, "image/svg+xml");
  return !d.getElementsByTagName("parsererror").length;
};

describe("export paths keep every feature", () => {
  it("SVG (and so PNG/JPEG): runs, lists, tables, presets, groups, charts, media, word art, backgrounds, rotation", async () => {
    const deck = await objectsToPictures(richDeck());
    const svg = slideToSVG(deck.slides[0], estimateMeasure);
    expect(parses(svg)).toBe(true);
    expect(svg).toMatch(/font-weight="bold"[^>]*>Bold</);
    expect(svg).toContain('fill="#c00000"');
    expect(svg).toContain(">•</tspan>"); // bullet marker
    expect(svg).toContain("rotate(30)");
    expect(svg).toContain(">Head A<");
    expect(svg).toMatch(/<path[^>]+d="M/); // the star preset
    expect(svg).toContain('fill="#00ff00"'); // group member
    expect(svg).toContain('fill="#0000ff"');
    expect(svg).toContain("<title>A dot</title>");
    expect((svg.match(/<image /g) ?? []).length).toBeGreaterThanOrEqual(4); // picture, chart, poster, warp
    expect(svg).toContain("data:image/svg+xml;base64"); // chart / warp pictures
    expect(svg).toContain(">Wow<");
    expect(svg).toMatch(/linearGradient id="wa-art"/);
    expect(svg).toContain('<linearGradient id="slide-bg"');
    expect(svg).toContain(">Plan<");
  });

  it("HTML: the same features", async () => {
    const deck = await objectsToPictures(richDeck());
    const html = slideHTML(deck.slides[0], 0, deck.slides);
    for (const s of ["Bold", "Head A", "Plan", "Wow", "linear-gradient", "rotate(30deg)", 'alt="A dot"', "#00ff00", "data:image/svg+xml"]) expect(html).toContain(s);
  });

  it("print pages: handouts nest each slide with unique ids; notes pages carry the notes", async () => {
    const deck = await objectsToPictures(richDeck());
    const slides = deck.slides;
    const svgOf = slideSvgCache(slides, estimateMeasure);
    const [hand] = printPages(slides, [0, 1], { ...DEFAULT_PRINT, layout: "handouts", perPage: 2, grayscale: true }, 540 / 960, "Deck");
    const r = renderPage(hand, slides, { grayscale: true }, svgOf, estimateMeasure);
    expect(parses(r.svg)).toBe(true);
    expect(r.svg).toContain('<filter id="gray">');
    expect(r.svg).toMatch(/id="p\d+-slide-bg"/);
    const ids = [...r.svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.pdf.texts!.map((t) => t.text)).toEqual(expect.arrayContaining(["Deck", "Bold and plain", "Second"]));
    const [notes] = printPages(slides, [0], { ...DEFAULT_PRINT, layout: "notes" }, 540 / 960);
    const n = renderPage(notes, slides, { grayscale: false }, svgOf, estimateMeasure);
    expect(n.svg).toContain("Remember the demo.");
    expect(n.pdf.texts!.some((t) => t.text === "Remember the demo.")).toBe(true);
  });

  it("print pages: outline lists titles and body text", () => {
    const deck = richDeck();
    const [page] = printPages(deck.slides, [0, 1], { ...DEFAULT_PRINT, layout: "outline" }, 540 / 960);
    const r = renderPage(page, deck.slides, { grayscale: false }, slideSvgCache(deck.slides, estimateMeasure), estimateMeasure);
    const text = r.pdf.texts!.map((t) => t.text).join("\n");
    expect(text).toContain("1   Bold and plain");
    expect(text).toContain("One");
    expect(text).toContain("Head A | Head B");
    expect(text).toContain("[Picture: A dot]");
    expect(text).toContain("2   Second");
  });

  it("links become PDF link areas", () => {
    const s: Slide = {
      id: "s",
      background: "#fff",
      elements: [
        { ...newElement("rect"), id: "r", x: 0, y: 0, w: 96, h: 54, url: "https://example.com/" },
        { ...newElement("text"), id: "t", x: 100, y: 100, w: 400, h: 50, text: "see docs", runs: [{ text: "see " }, { text: "docs", url: "mailto:a@b.c" }] },
      ],
    };
    const [page] = printPages([s], [0], DEFAULT_PRINT, 540 / 960);
    const r = renderPage(page, [s], { grayscale: false }, slideSvgCache([s], estimateMeasure), estimateMeasure);
    expect(r.pdf.links!.map((l) => l.url)).toEqual(["https://example.com/", "mailto:a@b.c"]);
    expect(r.pdf.links![0].box).toEqual({ x: 0, y: 0, w: 72, h: 40.5 });
  });
});
