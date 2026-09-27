import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  PictureStore,
  cm,
  contentXml,
  deckToOdp,
  esc,
  manifestXml,
  metaXml,
  odfColor,
  placement,
  stylesXml,
  textContent,
  ODP_MIME,
} from "./write";
import type { DeckDoc, Slide, SlideElement } from "../model";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const NS = {
  draw: "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0",
  text: "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
  table: "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
  style: "urn:oasis:names:tc:opendocument:xmlns:style:1.0",
  fo: "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0",
  presentation: "urn:oasis:names:tc:opendocument:xmlns:presentation:1.0",
  xlink: "http://www.w3.org/1999/xlink",
  manifest: "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0",
};

function parse(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  expect(doc.getElementsByTagName("parsererror").length).toBe(0);
  return doc;
}

const slide = (elements: SlideElement[], extra: Partial<Slide> = {}): Slide => ({
  id: Math.random().toString(36).slice(2),
  background: "#ffffff",
  elements,
  ...extra,
});

const text = (over: Partial<SlideElement> = {}): SlideElement => ({
  id: "t",
  type: "text",
  x: 100,
  y: 50,
  w: 400,
  h: 80,
  text: "Hello bold world",
  fontSize: 24,
  color: "#202124",
  fontFamily: "Arial",
  ...over,
});

const table = (): SlideElement => ({
  id: "tb",
  type: "table",
  x: 100,
  y: 200,
  w: 480,
  h: 150,
  fontSize: 16,
  table: {
    rows: 3,
    cols: 3,
    cells: [
      ["Merged", "", "C"],
      ["a", "b", "c"],
      ["d", "e", "f"],
    ],
    merges: [{ r: 0, c: 0, rs: 1, cs: 2 }],
    props: [[{ fill: "#ff0000" }, null, null], [null, null, null], [null, null, null]],
  },
});

function richDeck(): DeckDoc {
  return {
    slides: [
      slide(
        [
          text({
            runs: [
              { text: "Hello " },
              { text: "bold", bold: true, color: "#ff0000" },
              { text: " x" },
              { text: "2", baseline: "super" },
              { text: "\nlink", url: "https://example.com/?a=1&b=2" },
              { text: " bad", url: "javascript:alert(1)" },
            ],
            text: "Hello bold x2\nlink bad",
          }),
          { id: "s", type: "shape", preset: "star5", x: 600, y: 60, w: 160, h: 160, fill: "#4285f4", stroke: "#1a5dc8", strokeWidth: 1, rotation: 30 },
          { id: "e", type: "ellipse", x: 50, y: 400, w: 100, h: 60, fill: "#34a853" },
          table(),
        ],
        { notes: "First note\nSecond <note> & more" },
      ),
      slide(
        [
          { id: "img", type: "image", x: 10, y: 10, w: 100, h: 100, src: PNG_1PX, alt: "A pixel" },
          { id: "ln", type: "line", x: 100, y: 300, w: 200, h: 0, stroke: "#000000", strokeWidth: 2 },
        ],
        { hidden: true, bgFill: { kind: "gradient", stops: [{ pos: 0, color: "#ff0000" }, { pos: 1, color: "#0000ff" }], angle: 0 } },
      ),
    ],
  };
}

async function unzip(deck: DeckDoc) {
  const bytes = await deckToOdp(deck, "My <Deck>");
  const zip = await JSZip.loadAsync(bytes);
  return { bytes, zip, content: await zip.file("content.xml")!.async("string") };
}

describe("odp package", () => {
  it("writes mimetype first and uncompressed", async () => {
    const { bytes, zip } = await unzip(richDeck());
    // Local file header: signature, method at offset 8, name at offset 30.
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(bytes[8] | (bytes[9] << 8)).toBe(0);
    const nameLen = bytes[26] | (bytes[27] << 8);
    const extraLen = bytes[28] | (bytes[29] << 8);
    expect(new TextDecoder().decode(bytes.slice(30, 30 + nameLen))).toBe("mimetype");
    const body = new TextDecoder().decode(bytes.slice(30 + nameLen + extraLen, 30 + nameLen + extraLen + ODP_MIME.length));
    expect(body).toBe(ODP_MIME);
    expect(await zip.file("mimetype")!.async("string")).toBe(ODP_MIME);
  });

  it("lists every file in the manifest", async () => {
    const { zip } = await unzip(richDeck());
    const man = parse(await zip.file("META-INF/manifest.xml")!.async("string"));
    const listed = Array.from(man.getElementsByTagNameNS(NS.manifest, "file-entry")).map((e) =>
      e.getAttributeNS(NS.manifest, "full-path"),
    );
    const files = Object.keys(zip.files).filter((f) => !zip.files[f].dir && f !== "mimetype" && f !== "META-INF/manifest.xml");
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) expect(listed).toContain(f);
    expect(listed).toContain("/");
    expect(files.some((f) => f.startsWith("Pictures/"))).toBe(true);
  });

  it("writes meta with title and generator", async () => {
    const { zip } = await unzip(richDeck());
    const meta = await zip.file("meta.xml")!.async("string");
    parse(meta);
    expect(meta).toContain("<dc:title>My &lt;Deck&gt;</dc:title>");
    expect(meta).toContain("<meta:generator>Grown Slides</meta:generator>");
  });

  it("parses as XML and has no oo: tags", async () => {
    const { zip, content } = await unzip(richDeck());
    parse(content);
    parse(await zip.file("styles.xml")!.async("string"));
    for (const f of ["content.xml", "styles.xml", "meta.xml", "META-INF/manifest.xml"])
      expect(await zip.file(f)!.async("string")).not.toMatch(/<\/?oo:/);
  });
});

describe("content.xml", () => {
  it("has one draw:page per slide", () => {
    const doc = parse(contentXml(richDeck(), new PictureStore()));
    expect(doc.getElementsByTagNameNS(NS.draw, "page").length).toBe(2);
  });

  it("writes text runs with automatic text styles", () => {
    const xml = contentXml(richDeck(), new PictureStore());
    const doc = parse(xml);
    const frame = doc.getElementsByTagNameNS(NS.draw, "text-box")[0];
    const ps = frame.getElementsByTagNameNS(NS.text, "p");
    expect(ps.length).toBe(2);
    const spans = Array.from(ps[0].getElementsByTagNameNS(NS.text, "span"));
    expect(spans.map((s) => s.textContent)).toEqual(["Hello ", "bold", " x", "2"]);
    const styleOf = (name: string) =>
      Array.from(doc.getElementsByTagNameNS(NS.style, "style")).find((s) => s.getAttributeNS(NS.style, "name") === name)!;
    const bold = styleOf(spans[1].getAttributeNS(NS.text, "style-name")!).getElementsByTagNameNS(NS.style, "text-properties")[0];
    expect(bold.getAttributeNS(NS.fo, "font-weight")).toBe("bold");
    expect(bold.getAttributeNS(NS.fo, "color")).toBe("#ff0000");
    expect(bold.getAttributeNS(NS.fo, "font-size")).toBe("18pt"); // 24 units × 0.75
    const sup = styleOf(spans[3].getAttributeNS(NS.text, "style-name")!).getElementsByTagNameNS(NS.style, "text-properties")[0];
    expect(sup.getAttributeNS(NS.style, "text-position")).toBe("super 58%");
    // Only the http link survives; javascript: is dropped.
    const links = ps[1].getElementsByTagNameNS(NS.text, "a");
    expect(links[0]?.parentElement?.localName).toBe("span");
    expect(links.length).toBe(1);
    expect(links[0].getAttributeNS(NS.xlink, "href")).toBe("https://example.com/?a=1&b=2");
    expect(xml).not.toContain("javascript:");
  });

  it("writes list markers and paragraph alignment", () => {
    const deck: DeckDoc = {
      slides: [slide([text({ text: "one\ntwo", list: "number", align: "center" })])],
    };
    const doc = parse(contentXml(deck, new PictureStore()));
    const ps = doc.getElementsByTagNameNS(NS.text, "p");
    expect(ps[0].textContent).toBe("1.one");
    expect(ps[1].textContent).toBe("2.two");
    expect(ps[0].getElementsByTagNameNS(NS.text, "tab").length).toBe(1);
    const xml = contentXml(deck, new PictureStore());
    expect(xml).toContain('fo:text-align="center"');
  });

  it("writes table structure with spans and covered cells", () => {
    const doc = parse(contentXml(richDeck(), new PictureStore()));
    const t = doc.getElementsByTagNameNS(NS.table, "table")[0];
    expect(t.getElementsByTagNameNS(NS.table, "table-column").length).toBe(3);
    const rows = t.getElementsByTagNameNS(NS.table, "table-row");
    expect(rows.length).toBe(3);
    const first = rows[0];
    const cell = first.getElementsByTagNameNS(NS.table, "table-cell")[0];
    expect(cell.getAttributeNS(NS.table, "number-columns-spanned")).toBe("2");
    expect(cell.textContent).toBe("Merged");
    expect(first.getElementsByTagNameNS(NS.table, "covered-table-cell").length).toBe(1);
    expect(rows[1].getElementsByTagNameNS(NS.table, "table-cell").length).toBe(3);
    const cs = cell.getAttributeNS(NS.table, "style-name")!;
    const style = Array.from(doc.getElementsByTagNameNS(NS.style, "style")).find((s) => s.getAttributeNS(NS.style, "name") === cs)!;
    expect(style.getElementsByTagNameNS(NS.style, "graphic-properties")[0].getAttributeNS(NS.draw, "fill-color")).toBe("#ff0000");
  });

  it("writes row spans", () => {
    const tb = table();
    tb.table!.merges = [{ r: 1, c: 0, rs: 2, cs: 1 }];
    const doc = parse(contentXml({ slides: [slide([tb])] }, new PictureStore()));
    const rows = doc.getElementsByTagNameNS(NS.table, "table-row");
    expect(rows[1].getElementsByTagNameNS(NS.table, "table-cell")[0].getAttributeNS(NS.table, "number-rows-spanned")).toBe("2");
    expect(rows[2].firstElementChild!.localName).toBe("covered-table-cell");
  });

  it("writes data: images into Pictures/ and keeps alt text", async () => {
    const pics = new PictureStore();
    const doc = parse(contentXml(richDeck(), pics));
    expect(pics.files.length).toBe(1);
    expect(pics.files[0].path).toBe("Pictures/img1.png");
    expect(pics.files[0].mime).toBe("image/png");
    expect(pics.files[0].data.slice(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47]));
    const img = doc.getElementsByTagNameNS(NS.draw, "image")[0];
    expect(img.getAttributeNS(NS.xlink, "href")).toBe("Pictures/img1.png");
    const frame = img.parentElement!;
    expect(frame.getElementsByTagNameNS("urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0", "desc")[0].textContent).toBe("A pixel");
    const { zip } = await unzip(richDeck());
    expect(zip.file("Pictures/img1.png")).not.toBeNull();
  });

  it("keeps remote images as links and skips unusable sources", () => {
    const pics = new PictureStore();
    expect(pics.add("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(pics.add("blob:xyz")).toBeNull();
    expect(pics.add("data:image/svg+xml;utf8,%3Csvg%2F%3E")).toBe("Pictures/img1.svg");
    expect(new TextDecoder().decode(pics.files[0].data)).toBe("<svg/>");
    expect(pics.add("data:image/svg+xml;utf8,%3Csvg%2F%3E")).toBe("Pictures/img1.svg");
    expect(pics.files.length).toBe(1);
  });

  it("writes speaker notes", () => {
    const doc = parse(contentXml(richDeck(), new PictureStore()));
    const notes = doc.getElementsByTagNameNS(NS.presentation, "notes");
    expect(notes.length).toBe(1);
    const frame = notes[0].getElementsByTagNameNS(NS.draw, "frame")[0];
    expect(frame.getAttributeNS(NS.presentation, "class")).toBe("notes");
    const lines = Array.from(frame.getElementsByTagNameNS(NS.text, "p")).map((p) => p.textContent);
    expect(lines).toEqual(["First note", "Second <note> & more"]);
  });

  it("marks hidden slides and writes gradient backgrounds", () => {
    const deck = richDeck();
    const doc = parse(contentXml(deck, new PictureStore()));
    const pages = doc.getElementsByTagNameNS(NS.draw, "page");
    const props = (page: Element) => {
      const name = page.getAttributeNS(NS.draw, "style-name");
      const st = Array.from(doc.getElementsByTagNameNS(NS.style, "style")).find((s) => s.getAttributeNS(NS.style, "name") === name)!;
      return st.getElementsByTagNameNS(NS.style, "drawing-page-properties")[0];
    };
    expect(props(pages[0]).getAttributeNS(NS.presentation, "visibility")).toBeNull();
    expect(props(pages[0]).getAttributeNS(NS.draw, "fill-color")).toBe("#ffffff");
    expect(props(pages[1]).getAttributeNS(NS.presentation, "visibility")).toBe("hidden");
    expect(props(pages[1]).getAttributeNS(NS.draw, "fill")).toBe("gradient");
    const styles = parse(stylesXml(deck, new PictureStore()));
    const g = styles.getElementsByTagNameNS(NS.draw, "gradient")[0];
    expect(g.getAttributeNS(NS.draw, "name")).toBe(props(pages[1]).getAttributeNS(NS.draw, "fill-gradient-name"));
    expect(g.getAttributeNS(NS.draw, "start-color")).toBe("#ff0000");
    expect(g.getAttributeNS(NS.draw, "angle")).toBe("90deg"); // Grown 0° (left→right)
  });

  it("writes a rotation transform for rotated shapes", () => {
    const doc = parse(contentXml(richDeck(), new PictureStore()));
    const shapes = doc.getElementsByTagNameNS(NS.draw, "custom-shape");
    expect(shapes.length).toBe(2);
    const star = shapes[0];
    expect(star.getAttributeNS(NS.draw, "transform")).toMatch(/^rotate\(-0\.523599\) translate\([\d.]+cm [\d.]+cm\)$/);
    expect(star.hasAttributeNS("urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0", "x")).toBe(false);
    const geo = star.getElementsByTagNameNS(NS.draw, "enhanced-geometry")[0];
    expect(geo.getAttributeNS(NS.draw, "enhanced-path")).toMatch(/^M [\d-]+ [\d-]+ L/);
    const ell = shapes[1].getElementsByTagNameNS(NS.draw, "enhanced-geometry")[0];
    expect(ell.getAttributeNS(NS.draw, "type")).toBe("ellipse");
  });

  it("writes lines as draw:line", () => {
    const doc = parse(contentXml(richDeck(), new PictureStore()));
    const ln = doc.getElementsByTagNameNS(NS.draw, "line")[0];
    const svg = "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0";
    expect(ln.getAttributeNS(svg, "x1")).toBe(cm(100));
    expect(ln.getAttributeNS(svg, "x2")).toBe(cm(300));
  });

  it("flattens groups", () => {
    const g: SlideElement = {
      id: "g",
      type: "group",
      x: 0,
      y: 0,
      w: 200,
      h: 100,
      children: [
        { id: "a", type: "rect", x: 0, y: 0, w: 100, h: 100, fill: "#000000" },
        { id: "b", type: "rect", x: 100, y: 0, w: 100, h: 100, fill: "#ffffff" },
      ],
    };
    const doc = parse(contentXml({ slides: [slide([g])] }, new PictureStore()));
    expect(doc.getElementsByTagNameNS(NS.draw, "custom-shape").length).toBe(2);
  });
});

describe("styles.xml and helpers", () => {
  it("sizes the page from the deck", () => {
    const at = (size?: { w: number; h: number }) => {
      const doc = parse(stylesXml({ slides: [slide([])], size }, new PictureStore()));
      const p = doc.getElementsByTagNameNS(NS.style, "page-layout-properties")[0];
      return [p.getAttributeNS(NS.fo, "page-width"), p.getAttributeNS(NS.fo, "page-height")];
    };
    expect(at()).toEqual(["25.4cm", "14.2875cm"]);
    expect(at({ w: 960, h: 720 })).toEqual(["25.4cm", "19.05cm"]);
  });

  it("places rotated boxes about their centre", () => {
    expect(placement(10, 20, 100, 50)).toBe(` svg:width="${cm(100)}" svg:height="${cm(50)}" svg:x="${cm(10)}" svg:y="${cm(20)}"`);
    // 180°: the local origin lands on the original bottom-right corner.
    expect(placement(10, 20, 100, 50, 180)).toContain(`translate(${cm(110)} ${cm(70)})`);
    // 90° clockwise: the origin lands at (cx + h/2, cy - w/2).
    expect(placement(0, 0, 100, 50, 90)).toContain(`rotate(-1.570796) translate(${cm(75)} ${cm(-25)})`);
  });

  it("escapes and encodes whitespace", () => {
    expect(esc(`a<b>&"'`)).toBe("a&lt;b&gt;&amp;&quot;&apos;");
    expect(textContent("a  b\tc\vd")).toBe('a <text:s/>b<text:tab/>c<text:line-break/>d');
    expect(textContent(" x")).toBe("<text:s/>x");
    expect(odfColor("#abc")).toEqual({ hex: "#aabbcc", alpha: 1 });
    expect(odfColor("#11223380")!.alpha).toBeCloseTo(0.5, 1);
    expect(odfColor("none")).toBeNull();
    expect(odfColor("rgb(255, 0, 0)")!.hex).toBe("#ff0000");
  });

  it("builds meta and manifest", () => {
    parse(metaXml("T & T"));
    const man = parse(manifestXml([{ path: "content.xml", mime: "text/xml" }]));
    expect(man.getElementsByTagNameNS(NS.manifest, "file-entry").length).toBe(2);
  });
});
