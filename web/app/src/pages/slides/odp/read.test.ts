import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { deckToOdp, ODP_MIME } from "./write";
import { isOdp, lengthCm, presetForOdfType, readOdp } from "./read";
import type { DeckDoc, SlideElement } from "../model";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const near = (a: number | undefined, b: number, eps = 0.6) => {
  expect(a).toBeDefined();
  expect(Math.abs((a as number) - b)).toBeLessThanOrEqual(eps);
};

describe("odp read: units and shapes", () => {
  it("parses ODF lengths", () => {
    expect(lengthCm("2.5cm")).toBe(2.5);
    expect(lengthCm("10mm")).toBe(1);
    expect(lengthCm("1in")).toBe(2.54);
    expect(lengthCm("72pt")).toBeCloseTo(2.54);
    expect(lengthCm("bogus")).toBeNull();
  });
  it("maps LibreOffice shape types to presets", () => {
    expect(presetForOdfType("rectangle")).toBe("rect");
    expect(presetForOdfType("round-rectangle")).toBe("roundRect");
    expect(presetForOdfType("ooxml-star5")).toBe("star5");
    expect(presetForOdfType("mso-spt100")).toBeNull();
  });
});

describe("odp read: Grown's own ODP comes back", () => {
  it("keeps slides, text, shapes, pictures, lines, notes and the page size", async () => {
    const els: SlideElement[] = [
      { id: "t", type: "text", x: 96, y: 48, w: 480, h: 96, text: "Hello\nsecond line", fontSize: 32, color: "#1a73e8", fontFamily: "Arial", bold: true, align: "center", valign: "top" },
      { id: "s", type: "shape", preset: "star5", x: 600, y: 60, w: 120, h: 120, fill: "#fbbc04", stroke: "#202124", strokeWidth: 2, rotation: 30 },
      { id: "r", type: "shape", preset: "roundRect", x: 100, y: 300, w: 200, h: 100, fill: "#34a853", stroke: "none", strokeWidth: 0 },
      { id: "i", type: "image", x: 400, y: 300, w: 100, h: 50, src: PNG_1PX },
      { id: "l", type: "line", x: 100, y: 450, w: 300, h: 0, stroke: "#ea4335", strokeWidth: 3 },
    ];
    const deck: DeckDoc = {
      size: { w: 960, h: 720 },
      slides: [
        { id: "a", background: "#fef7e0", elements: els, notes: "Speak slowly" },
        { id: "b", background: "#ffffff", elements: [], hidden: true },
      ],
    };
    const bytes = await deckToOdp(deck, "Round trip");
    expect(isOdp(bytes)).toBe(true);
    const { deck: back, title } = await readOdp(bytes);
    expect(title).toBe("Round trip");
    expect(back.size).toEqual({ w: 960, h: 720 });
    expect(back.slides).toHaveLength(2);
    const [s1, s2] = back.slides;
    expect(s1.background).toBe("#fef7e0");
    expect(s1.notes).toBe("Speak slowly");
    expect(s2.hidden).toBe(true);

    const text = s1.elements.find((e) => e.type === "text")!;
    expect(text.text).toBe("Hello\nsecond line");
    near(text.x, 96);
    near(text.y, 48);
    near(text.w, 480);
    near(text.fontSize, 32, 0.1);
    expect(text.color).toBe("#1a73e8");
    expect(text.bold).toBe(true);
    expect(text.align).toBe("center");

    const star = s1.elements.find((e) => e.preset === "star5")!;
    expect(star.type).toBe("shape");
    near(star.x, 600);
    near(star.y, 60);
    near(star.w, 120);
    near(star.rotation, 30, 0.05);
    expect(star.fill).toBe("#fbbc04");
    expect(star.stroke).toBe("#202124");
    near(star.strokeWidth, 2, 0.05);

    const rr = s1.elements.find((e) => e.preset === "roundRect")!;
    expect(rr.fill).toBe("#34a853");
    expect(rr.stroke).toBe("none");

    const img = s1.elements.find((e) => e.type === "image")!;
    expect(img.src).toMatch(/^data:image\/png;base64,/);
    near(img.w, 100);

    const line = s1.elements.find((e) => e.type === "line")!;
    near(line.x, 100);
    near(line.y, 450);
    near(line.w, 300);
    expect(line.stroke).toBe("#ea4335");
  });
});

describe("odp read: LibreOffice-style content", () => {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:script="urn:oasis:names:tc:opendocument:xmlns:script:1.0" xmlns:anim="urn:oasis:names:tc:opendocument:xmlns:animation:1.0" office:version="1.3">
<office:automatic-styles>
 <style:style style:name="dp1" style:family="drawing-page"><style:drawing-page-properties draw:fill="solid" draw:fill-color="#003366"/></style:style>
 <style:style style:name="gr1" style:family="graphic" style:parent-style-name="standard"><style:graphic-properties draw:fill-color="#ff0000"/></style:style>
 <style:style style:name="pr1" style:family="presentation" style:parent-style-name="Default-title"/>
 <style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:text-align="end"/><style:text-properties fo:font-size="20pt"/></style:style>
 <style:style style:name="T1" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
</office:automatic-styles>
<office:body><office:presentation>
 <draw:page draw:name="page1" draw:style-name="dp1" draw:master-page-name="Default">
  <draw:frame presentation:style-name="pr1" presentation:class="title" svg:width="20cm" svg:height="3cm" svg:x="4cm" svg:y="1cm"><draw:text-box><text:p>The   <text:span text:style-name="T1">title</text:span></text:p></draw:text-box></draw:frame>
  <draw:frame presentation:class="subtitle" presentation:placeholder="true" svg:width="20cm" svg:height="3cm" svg:x="4cm" svg:y="5cm"><draw:text-box/></draw:frame>
  <draw:custom-shape draw:style-name="gr1" svg:width="4cm" svg:height="2cm" draw:transform="rotate(-1.5707963267949) translate(12cm 8cm)">
   <office:event-listeners><presentation:event-listener script:event-name="dom:click" presentation:action="show" xlink:href="https://example.com/next"/></office:event-listeners>
   <text:p text:style-name="P1">Go<text:s text:c="2"/>on</text:p>
   <draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="ellipse"/>
  </draw:custom-shape>
  <anim:par presentation:node-type="timing-root"><anim:seq><anim:par><anim:animate/></anim:par></anim:seq></anim:par>
 </draw:page>
</office:presentation></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3">
<office:styles>
 <style:default-style style:family="graphic"><style:graphic-properties draw:stroke="solid" svg:stroke-color="#3465a4" svg:stroke-width="0cm"/><style:text-properties fo:font-size="18pt"/></style:default-style>
 <style:style style:name="Default-title" style:family="presentation"><style:graphic-properties draw:fill="none" draw:stroke="none"/><style:text-properties fo:font-size="44pt" fo:color="#123456"/></style:style>
 <style:style style:name="standard" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#729fcf"/><style:text-properties fo:color="#ffffff" style:font-name="Liberation Sans"/></style:style>
</office:styles>
<office:automatic-styles>
 <style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="28cm" fo:page-height="15.75cm"/></style:page-layout>
</office:automatic-styles>
<office:master-styles>
 <style:master-page style:name="Default" style:page-layout-name="PM1"/>
</office:master-styles>
</office:document-styles>`;

  it("resolves inherited styles, rotation, click actions and warnings", async () => {
    const zip = new JSZip();
    zip.file("mimetype", ODP_MIME, { compression: "STORE" });
    zip.file("content.xml", content);
    zip.file("styles.xml", styles);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const { deck, warnings } = await readOdp(bytes);
    expect(deck.size).toBeUndefined(); // 28 × 15.75 cm is 16:9
    const s = deck.slides[0];
    expect(s.background).toBe("#003366");
    const k = 960 / 28;

    // The empty subtitle placeholder is dropped; the title keeps its text.
    const texts = s.elements.filter((e) => e.type === "text");
    expect(texts.map((e) => e.text)).toEqual(["The title", "Go  on"]) // ODF collapses space runs; text:s keeps them;
    const title = texts[0];
    near(title.x, 4 * k);
    expect(title.valign).toBe("middle");
    expect(title.color).toBe("#123456");
    near(title.fontSize, (44 * 2.54 * k) / 72, 0.05);
    expect(title.italic).toBeUndefined(); // the first span is italic, not the box

    // The ellipse: fill from its own style, outline from the default style,
    // turned 90° clockwise about its centre, with a link.
    const ell = s.elements.find((e) => e.type === "shape")!;
    expect(ell.preset).toBe("ellipse");
    expect(ell.fill).toBe("#ff0000");
    expect(ell.stroke).toBe("#3465a4");
    near(ell.rotation, 90, 0.01);
    // translate(12cm 8cm) is where the box's top-left lands after turning.
    near(ell.x, (12 - 1 - 2) * k);
    near(ell.y, (8 + 2 - 1) * k);
    expect(ell.url).toBe("https://example.com/next");

    // Its text: the paragraph style's size and alignment, inherited colour.
    const label = texts[1];
    near(label.fontSize, (20 * 2.54 * k) / 72, 0.05);
    expect(label.align).toBe("right");
    expect(label.color).toBe("#ffffff");
    expect(label.fontFamily).toBe("Liberation Sans");
    expect(label.rotation).toBe(ell.rotation);

    expect(warnings).toContain("Animations were not imported");
  });

  it("recognises ODP bytes", async () => {
    const zip = new JSZip();
    zip.file("mimetype", ODP_MIME, { compression: "STORE" });
    zip.file("content.xml", content);
    expect(isOdp(await zip.generateAsync({ type: "uint8array" }))).toBe(true);
    expect(isOdp(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe(false);
  });
});

describe("odp import wiring", () => {
  it("the deck import reads .odp as well as .pptx", async () => {
    const { readPptxSlides, importTitle, PPTX_ACCEPT } = await import("../pptx/importDeck");
    expect(PPTX_ACCEPT).toContain(".odp");
    expect(importTitle("Quarterly.odp")).toBe("Quarterly");
    const deck: DeckDoc = { slides: [{ id: "a", background: "#ffffff", elements: [{ id: "t", type: "text", x: 10, y: 10, w: 200, h: 40, text: "From ODP", fontSize: 18 }] }] };
    const r = await readPptxSlides(new Blob([(await deckToOdp(deck, "Imported")) as Uint8Array<ArrayBuffer>]));
    expect(r.title).toBe("Imported");
    expect(r.slides[0].elements.map((e) => e.text)).toEqual(["From ODP"]);
  });
});
