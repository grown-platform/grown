import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { deckToPptx } from "./write";
import { readPptx } from "./read";
import type { DeckDoc, SlideElement } from "../model";
import { formatRange, setLinkRange } from "../textOps";

// Mixed formatting inside one text box (F1) through pptx: runs (a:r/a:rPr),
// paragraphs (a:pPr lvl/algn/rtl/spacing/bullets), line breaks (a:br),
// body properties (insets, anchor, vert, autofit) and hyperlinks, both
// external and slide jumps.

const base = (text: string, extra: Partial<SlideElement> = {}): SlideElement => ({
  id: "t",
  type: "text",
  x: 40,
  y: 40,
  w: 500,
  h: 300,
  text,
  fontSize: 20,
  fontFamily: "Arial",
  color: "#202124",
  align: "left",
  valign: "top",
  ...extra,
});

function rich(): SlideElement {
  let el = base("Hello bold world\nSecond item\vwith break\nThird x2 H2O\n\nlink next", {
    list: "bullet",
    bulletStyle: "➢",
    paras: [{}, { level: 1 }, { level: 2, align: "center" }],
    spaceBefore: 6,
    spaceAfter: 12,
    lineSpacing: 1.5,
    insets: { l: 10, t: 2, r: 8, b: 6 },
    autofit: "shrink",
  });
  el = formatRange(el, 6, 10, { bold: true, color: "#d93025", fontSize: 28 });
  el = formatRange(el, 11, 16, { italic: true, underline: true, fontFamily: "Georgia" });
  el = formatRange(el, 17, 23, { strike: true });
  el = formatRange(el, 47, 48, { baseline: "super" });
  el = formatRange(el, 50, 51, { baseline: "sub" });
  el = setLinkRange(el, 54, 58, "https://grown.example/a?b=1&c=2");
  el = setLinkRange(el, 59, 63, "#slide:next");
  return el;
}

async function roundTrip(deck: DeckDoc) {
  return readPptx(await deckToPptx(deck));
}

async function slideXml(deck: DeckDoc, n = 1) {
  const zip = await JSZip.loadAsync(await deckToPptx(deck));
  return {
    xml: await zip.file(`ppt/slides/slide${n}.xml`)!.async("string"),
    rels: await zip.file(`ppt/slides/_rels/slide${n}.xml.rels`)!.async("string"),
  };
}

const strip = (el: SlideElement) => {
  const { id: _id, x: _x, y: _y, w: _w, h: _h, ...rest } = el;
  void _id; void _x; void _y; void _w; void _h;
  return rest;
};

describe("pptx rich text", () => {
  it("round-trips runs, paragraph levels, bullets, spacing, insets and links", async () => {
    const el = rich();
    expect(el.runs!.length).toBeGreaterThan(5);
    const deck: DeckDoc = { slides: [{ id: "s1", background: "#ffffff", elements: [el] }, { id: "s2", background: "#ffffff", elements: [] }] };
    const back = (await roundTrip(deck)).deck.slides[0].elements[0];
    expect(strip(back)).toEqual(strip(el));
  });

  it("writes run properties, a:br, levels and bullets", async () => {
    const { xml, rels } = await slideXml({ slides: [{ id: "s1", background: "#fff", elements: [rich()] }, { id: "s2", background: "#fff", elements: [] }] });
    expect(xml).toMatch(/<a:rPr lang="en-US" sz="2100" b="1" i="0"[^>]*><a:solidFill><a:srgbClr val="D93025"\/>/);
    expect(xml).toMatch(/<a:t>bold<\/a:t>/);
    expect(xml).toContain(`baseline="30000"`);
    expect(xml).toContain(`baseline="-25000"`);
    expect(xml).toMatch(/<a:br><a:rPr/);
    expect(xml).toMatch(/<a:pPr marL="\d+" indent="-400050" lvl="2" algn="ctr">/);
    expect(xml).toContain(`<a:buChar char="➢"/>`);
    expect(xml).toContain(`lIns="95250" tIns="19050" rIns="76200" bIns="57150"`);
    expect(xml).toContain("<a:normAutofit/>");
    expect(xml).toContain(`action="ppaction://hlinkshowjump?jump=nextslide"`);
    expect(xml).toMatch(/<a:hlinkClick r:id="rId\d+"\/>/);
    expect(rels).toContain(`Target="https://grown.example/a?b=1&amp;c=2" TargetMode="External"`);
    expect(xml).not.toContain("grown-el:");
  });

  it("round-trips a link to a specific slide through a slide relationship", async () => {
    const el = setLinkRange(base("go to end"), 6, 9, "#slide:s3");
    const deck: DeckDoc = {
      slides: [
        { id: "s1", background: "#fff", elements: [el] },
        { id: "s2", background: "#fff", elements: [] },
        { id: "s3", background: "#fff", elements: [] },
      ],
    };
    const { xml, rels } = await slideXml(deck);
    expect(xml).toContain(`action="ppaction://hlinksldjump"`);
    expect(rels).toMatch(/Type="[^"]*\/slide" Target="slide3.xml"/);
    const r = await roundTrip(deck);
    const run = r.deck.slides[0].elements[0].runs!.find((x) => x.url)!;
    expect(run.url).toBe(`#slide:${r.deck.slides[2].id}`);
  });

  it("keeps RTL, vertical text, justify and whole-element super/subscript", async () => {
    const el = base("abc\ndef", { rtl: true, vert: "vert270", align: "justify", baseline: "sub" });
    const back = (await roundTrip({ slides: [{ id: "s", background: "#fff", elements: [el] }] })).deck.slides[0].elements[0];
    expect(strip(back)).toEqual(strip(el));
  });

  it("a whole-box link stays an element link; numbering schemes survive", async () => {
    const el = base("one\ntwo", { url: "https://grown.example", list: "number", bulletStyle: "romanUcPeriod" });
    const back = (await roundTrip({ slides: [{ id: "s", background: "#fff", elements: [el] }] })).deck.slides[0].elements[0];
    expect(back.url).toBe("https://grown.example");
    expect(back.runs).toBeUndefined();
    expect(back.list).toBe("number");
    expect(back.bulletStyle).toBe("romanUcPeriod");
  });

  it("is stable across a second export", async () => {
    const deck: DeckDoc = { slides: [{ id: "s1", background: "#ffffff", elements: [rich()] }, { id: "s2", background: "#ffffff", elements: [] }] };
    const once = (await roundTrip(deck)).deck;
    const twice = (await roundTrip(once)).deck;
    expect(strip(twice.slides[0].elements[0])).toEqual(strip(once.slides[0].elements[0]));
  });
});
