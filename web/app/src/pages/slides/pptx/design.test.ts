import { afterEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { deckToPptx } from "./write";
import { readPptx } from "./read";
import { bgXml, clrSchemeXml, patchClrMap, patchThemeXml, schemeClrXml } from "./designXml";
import { applyTheme, findTheme, OFFICE_THEME, resolveRef, withColorRef } from "../theme";
import { builtinLayouts, footerElements, layoutByType, slideFromLayout } from "../layouts";
import { resizeDeck, twoStop } from "../slideProps";
import { setCanvasSize, type DeckDoc, type Slide } from "../model";

// M7 round trips: theme, layouts + placeholders, hidden slides, slide
// size, backgrounds and header & footer, through deckToPptx → readPptx.

afterEach(() => setCanvasSize(undefined));

describe("design XML", () => {
  it("writes scheme colours with modifiers", () => {
    expect(schemeClrXml("accent1")).toBe(`<a:schemeClr val="accent1"></a:schemeClr>`);
    expect(schemeClrXml("tx1/lumMod:65000/lumOff:35000")).toBe(
      `<a:schemeClr val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr>`,
    );
    expect(schemeClrXml("nope")).toBeNull();
  });

  it("puts the theme's colour scheme and name into the theme part", () => {
    const coral = findTheme("coral")!;
    const xml = `<a:theme name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1/></a:clrScheme><a:fontScheme name="Office"/></a:themeElements></a:theme>`;
    const out = patchThemeXml(xml, coral);
    expect(out).toContain(`<a:theme name="Coral">`);
    expect(out).toContain(`<a:fontScheme name="Coral"/>`);
    expect(out).toContain(clrSchemeXml(coral));
    expect(clrSchemeXml(coral)).toContain(`<a:accent1><a:srgbClr val="F25F5C"/></a:accent1>`);
  });

  it("maps bg/tx to the dark slots for a dark theme", () => {
    const m = `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1"/>`;
    expect(patchClrMap(m, true)).toBe(`<p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1"/>`);
    expect(patchClrMap(m, false)).toBe(m);
  });

  it("writes gradient and theme-colour backgrounds", () => {
    const g = bgXml({ background: "#ff0000", bgFill: twoStop("#ff0000", "#0000ff", 90) })!;
    expect(g).toContain(`<a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>`);
    expect(g).toContain(`<a:lin ang="5400000" scaled="0"/>`);
    expect(bgXml({ background: "#fff", bgFill: { ...twoStop("#fff", "#000"), radial: true } as never })).toContain(`path="circle"`);
    expect(bgXml({ background: "#ffffff", bgRef: "bg1" })).toContain(`<a:schemeClr val="bg1">`);
    expect(bgXml({ background: "#ffffff" })).toBeNull();
  });
});

/** A themed, laid-out 4:3 deck using every M7 feature. */
function designDeck(): DeckDoc {
  const coral = findTheme("coral")!;
  setCanvasSize({ w: 960, h: 720 });
  const L = builtinLayouts(coral, 720);
  const lay = (t: string) => layoutByType(L, t)!;
  const title = slideFromLayout(lay("title"));
  title.elements[0] = { ...title.elements[0], text: "Grown design" };
  title.elements[1] = { ...title.elements[1], text: "Themes and layouts" };
  const content = slideFromLayout(lay("obj"));
  content.elements[0] = { ...content.elements[0], text: "Agenda" };
  content.elements[1] = { ...content.elements[1], text: "One\nTwo" };
  const shape = withColorRef({ id: "r", type: "rect", x: 700, y: 500, w: 100, h: 60, stroke: "none", strokeWidth: 0 }, "fill", "accent2", coral);
  content.elements.push(shape);
  const two: Slide = { ...slideFromLayout(lay("twoObj")), hidden: true, bgFill: twoStop("#112233", "#445566", 45), background: "#112233" };
  delete two.bgRef;
  two.elements[0] = { ...two.elements[0], text: "Hidden" };
  return {
    theme: coral,
    size: { w: 960, h: 720 },
    slides: [title, content, two],
    hf: { sldNum: true, ftr: true, footerText: "Grown", dt: true, dateText: "1 May 2026", notOnTitle: true },
  };
}

describe("round trip (M7)", () => {
  it("keeps theme, size, layouts, placeholders, refs, hidden slides, backgrounds and header & footer", async () => {
    const deck = designDeck();
    const r = await readPptx(await deckToPptx(deck, "Design"));
    const d = r.deck;
    expect(d.theme).toBe(findTheme("coral"));
    expect(d.size).toEqual({ w: 960, h: 720 });
    // All eight built-in layouts come back with their ids, names and placeholders.
    expect(d.layouts!.map((l) => l.id)).toEqual(builtinLayouts(OFFICE_THEME).map((l) => l.id));
    expect(d.layouts!.map((l) => l.name)).toEqual(builtinLayouts(OFFICE_THEME).map((l) => l.name));
    const obj = d.layouts!.find((l) => l.id === "obj")!;
    expect(obj.elements.map((e) => e.placeholder)).toEqual([
      { type: "title" },
      { type: "body", idx: 1 },
      { type: "dt", idx: 10 },
      { type: "ftr", idx: 11 },
      { type: "sldNum", idx: 12 },
    ]);
    const src = layoutByType(builtinLayouts(findTheme("coral")!, 720), "obj")!;
    expect(obj.elements[1]).toMatchObject({ x: src.elements[1].x, y: src.elements[1].y, w: src.elements[1].w, h: src.elements[1].h, text: "" });
    expect(obj.elements[0].themeRefs).toEqual({ color: "tx1", font: "major" });
    expect(obj.bgRef).toBe("bg1");

    expect(d.slides.map((s) => s.layout)).toEqual(["title", "obj", "twoObj"]);
    expect(d.slides.map((s) => !!s.hidden)).toEqual([false, false, true]);
    const [s0, s1, s2] = d.slides;
    expect(s0.elements.map((e) => [e.placeholder?.type, e.text])).toEqual([
      ["ctrTitle", "Grown design"],
      ["subTitle", "Themes and layouts"],
    ]);
    expect(s0.elements[0].themeRefs).toEqual({ color: "tx1", font: "major" });
    expect(s0.elements[0].fontFamily).toBe("Georgia");
    expect(s0.bgRef).toBe("bg1");
    const rect = s1.elements.find((e) => e.type === "rect")!;
    expect(rect.themeRefs).toEqual({ fill: "accent2" });
    expect(rect.fill).toBe(findTheme("coral")!.colors.accent2);
    // The footer boxes aren't elements; they are header & footer settings.
    expect(s1.elements.some((e) => e.placeholder?.type === "sldNum")).toBe(false);
    expect(d.hf).toEqual(deck.hf);
    expect(footerElements(d, 1).map((e) => e.text)).toEqual(["1 May 2026", "Grown", "2"]);
    expect(s2.bgFill).toEqual({ kind: "gradient", stops: [{ pos: 0, color: "#112233" }, { pos: 1, color: "#445566" }], angle: 45 });
    // An empty placeholder stays an (empty) placeholder.
    expect(s2.elements.filter((e) => e.placeholder?.type === "body").map((e) => e.text)).toEqual(["", ""]);

    // Changing the theme after import restyles the placeholders and the ref'd shape.
    const focus = applyTheme(d, findTheme("focus")!);
    expect(focus.slides[0].elements[0].color).toBe(findTheme("focus")!.colors.lt1); // dark: tx1 → lt1
    expect(focus.slides[0].elements[0].fontFamily).toBe("Inter");
    expect(focus.slides[1].elements.find((e) => e.type === "rect")!.fill).toBe(findTheme("focus")!.colors.accent2);
  });

  it("is stable over a double round trip", async () => {
    const once = (await readPptx(await deckToPptx(designDeck()))).deck;
    const twice = (await readPptx(await deckToPptx(once))).deck;
    const strip = (d: DeckDoc) =>
      JSON.parse(JSON.stringify({ ...d, slides: d.slides.map((s) => ({ ...s, id: "", elements: s.elements.map((e) => ({ ...e, id: "" })) })), layouts: d.layouts?.map((l) => ({ ...l, elements: l.elements.map((e) => ({ ...e, id: "" })) })) }));
    expect(strip(twice)).toEqual(strip(once));
  });

  it("writes a dark theme's colour map and reads it back", async () => {
    const slate = findTheme("slate")!;
    const deck = applyTheme({ slides: [slideFromLayout(builtinLayouts(slate)[0])] }, slate);
    const bytes = await deckToPptx(deck);
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file("ppt/slideMasters/slideMaster1.xml")!.async("string")).toContain(`bg1="dk1"`);
    const pres = await zip.file("ppt/presentation.xml")!.async("string");
    expect(pres).toContain(`<p:sldSz cx="9144000" cy="5143500"/>`);
    const d = (await readPptx(bytes)).deck;
    expect(d.theme).toBe(slate);
    expect(d.slides[0].background).toBe(resolveRef("bg1", slate));
    expect(d.size).toBeUndefined();
  });

  it("writes hidden slides as show=0 and slide numbers as fields", async () => {
    const deck = designDeck();
    const zip = await JSZip.loadAsync(await deckToPptx(deck));
    const s3 = await zip.file("ppt/slides/slide3.xml")!.async("string");
    expect(s3).toMatch(/<p:sld [^>]*show="0"/);
    const s2 = await zip.file("ppt/slides/slide2.xml")!.async("string");
    expect(s2).toContain(`type="slidenum"`);
    expect(s2).toMatch(/<p:ph type="sldNum" idx="12"\/>/);
    expect(s2).toMatch(/<p:ph type="title"\/>/);
    const pres = await zip.file("ppt/presentation.xml")!.async("string");
    expect(pres).toContain(`<p:sldSz cx="9144000" cy="6858000"/>`);
    const layouts = Object.keys(zip.files).filter((f) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f));
    expect(layouts.length).toBe(9); // pptxgenjs's default + the eight built-ins
  });

  it("keeps a legacy deck (no theme/layouts) free of layout data", async () => {
    const d = (await readPptx(await deckToPptx({ slides: [{ id: "a", background: "#ffffff", elements: [] }] }))).deck;
    expect(d.layouts).toBeUndefined();
    expect(d.slides[0].layout).toBeUndefined();
    expect(d.theme).toBe(OFFICE_THEME);
  });

  it("resizing then exporting keeps content scaled (16:9 → 4:3)", async () => {
    const deck: DeckDoc = {
      slides: [{ id: "a", background: "#ffffff", elements: [{ id: "r", type: "rect", x: 0, y: 0, w: 960, h: 540, fill: "#ff0000", stroke: "none", strokeWidth: 0 }] }],
    };
    const tall = resizeDeck(deck, { w: 4, h: 3 });
    const d = (await readPptx(await deckToPptx(tall))).deck;
    expect(d.size).toEqual({ w: 960, h: 720 });
    expect(d.slides[0].elements[0]).toMatchObject({ x: 0, y: 90, w: 960, h: 540 });
  });
});
