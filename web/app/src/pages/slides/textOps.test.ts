import { describe, it, expect } from "vitest";
import { INDENT_STEP, type SlideElement } from "./model";
import {
  applyFormat,
  applyFormatWhole,
  captureFormat,
  changeCaseRange,
  clearFormatRange,
  elementRuns,
  fontStep,
  formatNumber,
  formatRange,
  formatWhole,
  indentParas,
  insertText,
  insetsOf,
  linkAt,
  listMarkers,
  paragraphs,
  paraIndent,
  paraIndices,
  rangeHas,
  replaceRange,
  setAlignWhole,
  setInsets,
  setLinkRange,
  setParaAlign,
  splitRuns,
  stepFontRange,
  toggleRange,
  withRuns,
} from "./textOps";
import { applyCollabOp } from "./deckOps";

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

describe("runs model", () => {
  it("a plain element is one run; stale runs fall back to the text mirror", () => {
    expect(elementRuns(box("hi"))).toEqual([{ text: "hi" }]);
    const stale = box("changed", { runs: [{ text: "old", bold: true }] });
    expect(elementRuns(stale)).toEqual([{ text: "changed" }]);
  });

  it("splits runs at offsets", () => {
    expect(splitRuns([{ text: "abcdef" }], 2, 4)).toEqual([{ text: "ab" }, { text: "cd" }, { text: "ef" }]);
  });

  it("bolding a range makes runs and keeps text as the mirror", () => {
    const el = formatRange(box("Hello world"), 6, 11, { bold: true });
    expect(el.text).toBe("Hello world");
    expect(el.runs).toEqual([{ text: "Hello " }, { text: "world", bold: true }]);
    expect(el.bold).toBeUndefined();
  });

  it("formatting everything promotes to the element and drops runs", () => {
    const el = formatRange(box("Hello"), 0, 5, { italic: true });
    expect(el.runs).toBeUndefined();
    expect(el.italic).toBe(true);
  });

  it("undoing a range format merges the runs back into a plain element", () => {
    let el = formatRange(box("Hello world"), 0, 5, { bold: true });
    el = formatRange(el, 0, 5, { bold: false });
    expect(el.runs).toBeUndefined();
    expect(el.bold).toBeUndefined();
  });

  it("a run can turn off an element-level style", () => {
    const el = formatRange(box("abc", { bold: true }), 1, 2, { bold: false });
    expect(el.bold).toBe(true);
    expect(el.runs).toEqual([{ text: "a" }, { text: "b", bold: false }, { text: "c" }]);
  });

  it("formatWhole sets the element value and strips it from runs", () => {
    const el = formatWhole(formatRange(box("abcd"), 0, 2, { color: "#ff0000", bold: true }), { color: "#00ff00" });
    expect(el.color).toBe("#00ff00");
    expect(el.runs).toEqual([{ text: "ab", bold: true }, { text: "cd" }]);
  });

  it("paragraphs split runs on \\n and carry their props", () => {
    const el = { ...formatRange(box("one\ntwo"), 2, 5, { bold: true }), paras: [{}, { level: 1 }] };
    const ps = paragraphs(el);
    expect(ps.map((p) => p.runs.map((r) => r.text).join(""))).toEqual(["one", "two"]);
    expect(ps[0].runs[1]).toEqual({ text: "e", bold: true });
    expect(ps[1].props).toEqual({ level: 1 });
    expect(ps[1].start).toBe(4);
  });

  it("replaceRange keeps formatting of the text before and shifts paragraphs", () => {
    let el = formatRange(box("ab"), 0, 1, { bold: true });
    el = insertText(el, 1, "X");
    expect(el.runs).toEqual([{ text: "aX", bold: true }, { text: "b" }]);
    el = { ...box("a\nb\nc"), paras: [{}, { level: 2 }, { level: 1 }] };
    const merged = replaceRange(el, 1, 2, "");
    expect(merged.text).toBe("ab\nc");
    expect(merged.paras).toEqual([{}, { level: 1 }]);
    const split = replaceRange(el, 3, 3, "\n");
    expect(split.text).toBe("a\nb\n\nc");
    expect(split.paras).toEqual([{}, { level: 2 }, { level: 2 }, { level: 1 }]);
  });
});

describe("text properties", () => {
  it("toggleRange is on unless every character already has it", () => {
    let el = formatRange(box("abcd"), 0, 2, { bold: true });
    el = toggleRange(el, 0, 4, "bold");
    expect(el.bold).toBe(true);
    expect(el.runs).toBeUndefined();
    el = toggleRange(el, 0, 4, "bold");
    expect(el.bold).toBeUndefined();
  });

  it("super/subscript toggle through baseline", () => {
    let el = toggleRange(box("x2"), 1, 2, "super");
    expect(el.runs).toEqual([{ text: "x" }, { text: "2", baseline: "super" }]);
    expect(rangeHas(el, 1, 2, "baseline", "super")).toBe(true);
    el = toggleRange(el, 1, 2, "sub");
    expect(el.runs?.[1]).toEqual({ text: "2", baseline: "sub" });
    el = toggleRange(el, 1, 2, "sub");
    expect(el.runs).toBeUndefined();
  });

  // Ctrl+B/I/U/5/./, toggle on and off; Ctrl+] / Ctrl+[ walk the ladder
  // 10 → 11 → 12 → 14 → 16 → 14 → 12 → 11 → 10.
  it("oo:slide/shortcuts/shortcuts.js#Check text property change", () => {
    let el = box("Hello world", { fontSize: 10 });
    for (const k of ["bold", "italic", "strike", "underline"] as const) {
      el = toggleRange(el, 0, 11, k);
      expect(el[k]).toBe(true);
      el = toggleRange(el, 0, 11, k);
      expect(el[k]).toBeUndefined();
    }
    for (const k of ["super", "sub"] as const) {
      el = toggleRange(el, 0, 11, k);
      expect(el.baseline).toBe(k);
      el = toggleRange(el, 0, 11, k);
      expect(el.baseline).toBeUndefined();
    }
    const sizes: number[] = [];
    for (const dir of [1, 1, 1, 1, -1, -1, -1, -1] as const) {
      el = stepFontRange(el, 0, 11, dir);
      sizes.push(el.fontSize!);
    }
    expect(sizes).toEqual([11, 12, 14, 16, 14, 12, 11, 10]);
  });

  it("fontStep goes past the ends of the ladder", () => {
    expect(fontStep(72, 1)).toBe(80);
    expect(fontStep(80, -1)).toBe(72);
    expect(fontStep(7, 1)).toBe(8);
    expect(fontStep(8, -1)).toBe(7);
    expect(fontStep(1, -1)).toBe(1);
    expect(fontStep(13, 1)).toBe(14);
    expect(fontStep(13, -1)).toBe(12);
  });

  it("stepFontRange steps each run from its own size", () => {
    const el = stepFontRange(formatRange(box("ab", { fontSize: 12 }), 1, 2, { fontSize: 20 }), 0, 2, 1);
    expect(el.runs).toEqual([{ text: "a" }, { text: "b", fontSize: 22 }]);
    expect(el.fontSize).toBe(14);
  });

  it("changes case over a range with sentence context", () => {
    const el = formatRange(box("hello world. again"), 6, 11, { bold: true });
    const up = changeCaseRange(el, 0, 18, "upper");
    expect(up.text).toBe("HELLO WORLD. AGAIN");
    expect(up.runs?.[1]).toEqual({ text: "WORLD", bold: true });
    expect(changeCaseRange(box("hello world. again"), 0, 18, "sentence").text).toBe("Hello world. Again");
    expect(changeCaseRange(box("hello world"), 6, 11, "capitalize").text).toBe("hello World");
    expect(changeCaseRange(box("Hello"), 0, 5, "toggle").text).toBe("hELLO");
  });
});

describe("paint format and clear formatting", () => {
  // Ctrl+Shift+C captures bold/italic/strike; Ctrl+Shift+V applies them to
  // another box; Ctrl+Space clears them.
  it("oo:slide/shortcuts/shortcuts.js#Check copy/paste format and clear formatting actions", () => {
    const src = formatRange(box("Hello"), 0, 5, { bold: true, italic: true, strike: true });
    const fmt = captureFormat(src, 0, 5);
    expect(fmt.bold && fmt.italic && fmt.strike).toBe(true);
    let dst = applyFormat(box("Hello"), 0, 5, fmt);
    expect(dst.bold && dst.italic && dst.strike).toBe(true);
    dst = clearFormatRange(dst, 0, 5);
    expect(dst.bold || dst.italic || dst.strike).toBeFalsy();
  });

  it("captures the style at the start of a range and pastes onto part of a box", () => {
    const src = formatRange(box("ab", { color: "#111111" }), 1, 2, { color: "#ff0000", fontSize: 30 });
    const fmt = captureFormat(src, 1, 2);
    expect(fmt).toMatchObject({ color: "#ff0000", fontSize: 30, bold: false });
    const dst = applyFormat(box("xyz", { bold: true }), 0, 1, fmt);
    expect(dst.runs?.[0]).toEqual({ text: "x", color: "#ff0000", fontSize: 30, bold: false });
    const whole = applyFormatWhole(box("xyz", { bold: true }), fmt);
    expect(whole).toMatchObject({ color: "#ff0000", fontSize: 30 });
    expect(whole.bold).toBeUndefined();
  });

  it("clearing part of a box keeps links and falls back to the box style", () => {
    let el = formatRange(box("abc", { color: "#000000" }), 0, 3, { color: "#ff0000" });
    el = formatRange(el, 0, 1, { bold: true, url: "https://example.com" });
    el = clearFormatRange(el, 0, 2);
    expect(el.runs).toEqual([{ text: "a", url: "https://example.com" }, { text: "bc" }]);
    expect(rangeHas(el, 0, 2, "bold", true)).toBe(false);
    expect(linkAt(el, 0)).toBe("https://example.com");
  });
});

describe("paragraphs and lists", () => {
  // Tab / Shift+Tab: indent 11.1125 mm (one INDENT_STEP = 0.4375 in) and
  // back to 0; Ctrl+E/J/L/R align; Ctrl+Shift+L bullets, then the bullet
  // paragraph indents by the same step.
  it("oo:slide/shortcuts/shortcuts.js#Check paragraph property change", () => {
    let el = box("Hello world");
    for (const a of ["center", "justify", "left", "right"] as const) {
      el = setParaAlign(el, [0], a);
      expect(el.align).toBe(a);
    }
    expect((INDENT_STEP / 96) * 25.4).toBeCloseTo(11.1125, 4);
    el = indentParas(el, [0], 1);
    expect(paraIndent(el, el.paras![0])).toBe(INDENT_STEP);
    el = indentParas(el, [0], -1);
    expect(el.paras).toBeUndefined();
    expect(paraIndent(el, {})).toBe(0);
    el = { ...el, list: "bullet" };
    expect(listMarkers(el)).toEqual(["•"]);
    el = indentParas(el, [0], 1);
    expect(paraIndent(el, el.paras![0]) - paraIndent(el, {})).toBe(INDENT_STEP);
    el = indentParas(el, [0], -1);
    expect(el.paras).toBeUndefined();
  });

  it("paragraph alignment overrides only the chosen paragraphs", () => {
    let el = setParaAlign(box("a\nb\nc"), [1], "center");
    expect(el.paras).toEqual([{}, { align: "center" }]);
    el = setAlignWhole(el, "right");
    expect(el.align).toBe("right");
    expect(el.paras).toBeUndefined();
    expect(paraIndices("a\nb\nc", 0, 3)).toEqual([0, 1]);
    expect(paraIndices("a\nb\nc", 4, 4)).toEqual([2]);
  });

  it("levels clamp to 0…8", () => {
    let el = box("x");
    for (let i = 0; i < 12; i++) el = indentParas(el, [0], 1);
    expect(el.paras).toEqual([{ level: 8 }]);
  });

  it("multi-level bullets and numbering restart per level", () => {
    const el = box("a\nb\nc\nd\n\ne", {
      list: "number",
      paras: [{}, { level: 1 }, { level: 1 }, {}, {}, { level: 1 }],
    });
    expect(listMarkers(el)).toEqual(["1.", "a.", "b.", "2.", "", "a."]);
    expect(listMarkers({ ...el, list: "bullet" })).toEqual(["•", "◦", "◦", "•", "", "◦"]);
    expect(listMarkers({ ...el, list: "bullet", bulletStyle: "➢" })[1]).toBe("➢");
    expect(listMarkers({ ...el, bulletStyle: "romanUcPeriod" })[3]).toBe("II.");
  });

  it("formats list numbers", () => {
    expect(formatNumber(4, "romanLcPeriod")).toBe("iv.");
    expect(formatNumber(28, "alphaUcParenR")).toBe("AB)");
    expect(formatNumber(3, "arabicParenBoth")).toBe("(3)");
  });
});

describe("links", () => {
  it("links a range and finds the link at an offset", () => {
    const el = setLinkRange(box("see docs"), 4, 8, "https://example.com");
    expect(el.runs).toEqual([{ text: "see " }, { text: "docs", url: "https://example.com" }]);
    expect(linkAt(el, 5)).toBe("https://example.com");
    expect(linkAt(el, 8)).toBe("https://example.com");
    expect(linkAt(el, 1)).toBeUndefined();
    expect(setLinkRange(el, 4, 8, "").runs).toBeUndefined();
  });

  it("a link covering the whole text stays a run link", () => {
    const el = setLinkRange(box("docs"), 0, 4, "#slide:next");
    expect(el.runs).toEqual([{ text: "docs", url: "#slide:next" }]);
    expect(el.url).toBeUndefined();
  });
});

describe("insets", () => {
  // SetPaddings(l=4, t=2, r=3, b=5) → the text box reports exactly those
  // insets (Grown works in logical px instead of mm).
  it("oo:slide/js-api/api-shape.js#Test: SetPaddings", () => {
    const el = setInsets(box("Test text with paddings"), 4, 2, 3, 5)!;
    expect(el).not.toBeNull();
    expect(insetsOf(el)).toEqual({ l: 4, t: 2, r: 3, b: 5 });
  });

  it("rejects invalid insets and drops the default", () => {
    expect(setInsets(box("x"), -1, 0, 0, 0)).toBeNull();
    expect(setInsets(box("x"), NaN, 0, 0, 0)).toBeNull();
    expect(setInsets(box("x", { insets: { l: 1, t: 1, r: 1, b: 1 } }), 4, 4, 4, 4)!.insets).toBeUndefined();
    expect(insetsOf(box("x"))).toEqual({ l: 4, t: 4, r: 4, b: 4 });
  });
});

describe("withRuns", () => {
  it("merges, drops empties and keeps paras in range", () => {
    const el = withRuns(box(""), [{ text: "a", bold: true }, { text: "" }, { text: "b", bold: true }, { text: "\nc" }], [{}, { level: 1 }, { level: 3 }]);
    expect(el.text).toBe("ab\nc");
    expect(el.runs).toEqual([{ text: "ab\n", bold: true }, { text: "c" }]);
    expect(el.paras).toEqual([{}, { level: 1 }]);
  });
});

describe("collab", () => {
  it("upsert ops relay runs and paragraph props, idempotently", () => {
    const el = { ...formatRange(box("Hello world"), 6, 11, { bold: true, url: "#slide:next" }), paras: [{ level: 1 }] };
    const doc = { slides: [{ id: "s", background: "#fff", elements: [box("old")] }] };
    const op = JSON.parse(JSON.stringify({ t: "upsert", si: "s", el }));
    const once = applyCollabOp(doc, op);
    expect(once.slides[0].elements[0]).toEqual(el);
    expect(applyCollabOp(once, op)).toEqual(once);
  });
});
