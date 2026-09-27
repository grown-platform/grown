import { describe, expect, it } from "vitest";
import { newElement, type SlideElement } from "./model";
import { layoutTextLines, lineText, type Measure } from "./svgText";

// Every character is 10 px wide at size 20 (0.5 em), so widths are exact.
const mono: Measure = (t, _f, size) => [...t].length * size * 0.5;
const box = (over: Partial<SlideElement>): SlideElement => ({ ...newElement("text"), x: 0, y: 0, w: 120, h: 200, fontSize: 20, insets: { l: 0, t: 0, r: 0, b: 0 }, ...over });

describe("layoutTextLines", () => {
  it("wraps at the box width between words", () => {
    const lines = layoutTextLines(box({ text: "aaaa bbbb cccc dd" }), mono);
    expect(lines.map(lineText)).toEqual(["aaaa bbbb", "cccc dd"]);
    expect(lines[1].y - lines[0].y).toBeCloseTo(24); // 20 × 1.2
  });
  it("breaks an over-long word between characters", () => {
    expect(layoutTextLines(box({ text: "abcdefghijklmnop" }), mono).map(lineText)).toEqual(["abcdefghijkl", "mnop"]);
  });
  it("keeps paragraphs and \\v line breaks", () => {
    expect(layoutTextLines(box({ text: "one\ntwo\vthree" }), mono).map(lineText)).toEqual(["one", "two", "three"]);
  });
  it("aligns centre and right using the measured width", () => {
    expect(layoutTextLines(box({ text: "ab", align: "center" }), mono)[0].segs[0].x).toBe(50);
    expect(layoutTextLines(box({ text: "ab", align: "right" }), mono)[0].segs[0].x).toBe(100);
  });
  it("anchors vertically and honours insets", () => {
    const top = layoutTextLines(box({ text: "a", insets: { l: 5, t: 7, r: 0, b: 0 } }), mono)[0];
    expect(top.segs[0].x).toBe(5);
    expect(top.y).toBeCloseTo(7 + 2 + 18);
    const bottom = layoutTextLines(box({ text: "a", valign: "bottom" }), mono)[0];
    expect(bottom.y).toBeCloseTo(200 - 24 + 2 + 18);
  });
  it("indents list paragraphs and places the marker in the hanging indent", () => {
    const lines = layoutTextLines(box({ w: 400, text: "x\ny", list: "bullet", paras: [{}, { level: 1 }] }), mono);
    expect(lines[0].marker?.text).toBe("•");
    expect(lines[0].segs[0].x).toBe(42);
    expect(lines[0].marker?.x).toBe(0);
    expect(lines[1].segs[0].x).toBe(84);
  });
  it("keeps run styles as separate segments", () => {
    const el = box({ w: 400, text: "bold plain", runs: [{ text: "bold", bold: true }, { text: " plain" }] });
    const [line] = layoutTextLines(el, mono);
    expect(line.segs.map((s) => s.text)).toEqual(["bold", " plain"]);
    expect(line.segs[0].font).toContain("bold");
    expect(line.segs[1].x).toBe(40);
  });
});
