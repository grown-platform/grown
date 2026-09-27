import { describe, it, expect } from "vitest";
import type { SlideElement } from "./model";
import { buildEditorDom, domPoint, readEditorDom, textOffset } from "./textDom";
import { formatRange, withRuns } from "./textOps";

const box = (text: string, extra: Partial<SlideElement> = {}): SlideElement => ({
  id: "t",
  type: "text",
  x: 0,
  y: 0,
  w: 200,
  h: 100,
  text,
  fontSize: 18,
  ...extra,
});

function roundTrip(el: SlideElement): SlideElement {
  const root = document.createElement("div");
  buildEditorDom(root, el);
  const { runs, paras } = readEditorDom(root);
  return withRuns(el, runs, paras);
}

describe("editor DOM ↔ runs", () => {
  it("round-trips runs, paragraphs, levels and line breaks", () => {
    let el = box("Hello bold\nline\vbreak\n\nlast", { list: "bullet", paras: [{}, { level: 2, align: "center" }] });
    el = formatRange(el, 6, 10, { bold: true, color: "#ff0000" });
    el = formatRange(el, 11, 15, { url: "https://example.com", baseline: "super" });
    const back = roundTrip(el);
    expect(back.text).toBe(el.text);
    expect(back.runs).toEqual(el.runs);
    expect(back.paras).toEqual(el.paras);
  });

  it("round-trips a trailing line break and empty text", () => {
    expect(roundTrip(box("a\v")).text).toBe("a\v");
    expect(roundTrip(box("")).text).toBe("");
    expect(roundTrip(box("\n")).text).toBe("\n");
  });

  it("reads browser-made markup: divs, <br>, formatting tags, bare text", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div data-para=""><span data-run="" data-style=\'{"italic":true}\'>ab<b>c</b></span></div>' +
      "<div>x<br>y</div><div><br></div>tail";
    const { runs } = readEditorDom(root);
    const el = withRuns(box(""), runs);
    expect(el.text).toBe("abc\nx\vy\n\ntail");
    expect(el.runs?.slice(0, 2)).toEqual([
      { text: "ab", italic: true },
      { text: "c\n", italic: true, bold: true },
    ]);
  });

  it("maps DOM points to model offsets and back", () => {
    const el = formatRange(box("ab\ncd\ve"), 1, 2, { bold: true });
    const root = document.createElement("div");
    document.body.appendChild(root);
    buildEditorDom(root, el);
    for (const off of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const p = domPoint(root, off);
      expect(textOffset(root, p.node, p.offset)).toBe(off);
    }
    root.remove();
  });
});
