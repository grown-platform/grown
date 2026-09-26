// Ports of OnlyOffice word/styles/displayStyle.js (behaviour only): which
// style name the toolbar shows for a caret or a selection that mixes
// paragraph styles and character (run) styles.
import { beforeEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import {
  makeEditor,
  paragraphPos,
  selectBlocks,
  selectRange,
  setBlockAttrs,
  setCursor,
} from "../harness";
import { currentStyle, getDocModel } from "../../docModel";

let e: Editor;

/** Builds paragraphs of runs; each run is [text, charStyle | null]. */
function build(paras: [string, string | null][][]): Editor {
  const ed = makeEditor("<p></p>");
  // JSON, not HTML, so runs of spaces survive parsing.
  ed.commands.setContent({
    type: "doc",
    content: paras.map((runs) => ({
      type: "paragraph",
      content: runs.map(([text, s]) => ({
        type: "text",
        text,
        ...(s ? { marks: [{ type: "charStyle", attrs: { styleId: s } }] } : {}),
      })),
    })),
  });
  const { sheet } = getDocModel(ed);
  for (const id of ["ParaStyle1", "ParaStyle2"])
    sheet.put({ id, name: id, type: "paragraph", basedOn: "Normal" });
  for (const id of ["RunStyle1", "RunStyle2"]) sheet.put({ id, name: id, type: "character" });
  return ed;
}

/** Re-applies a character style to [start, end) of paragraph `p`. */
function setRunStyle(p: number, start: number, end: number, id: string | null) {
  const from = paragraphPos(e, p, start);
  const to = paragraphPos(e, p, end);
  const type = e.schema.marks.charStyle;
  const tr = e.state.tr.removeMark(from, to, type);
  if (id) tr.addMark(from, to, type.create({ styleId: id }));
  e.view.dispatch(tr);
}

const pStyle = (p: number, id: string | null) => setBlockAttrs(e, p, { styleId: id });
const shown = () => currentStyle(e)?.name ?? "";
/** Caret at char `off` of paragraph `p`. */
const caret = (p: number, off: number) => setCursor(e, paragraphPos(e, p, off));
/** Selection from (p1, o1) to (p2, o2). */
const sel = (p1: number, o1: number, p2: number, o2: number) =>
  selectRange(e, paragraphPos(e, p1, o1), paragraphPos(e, p2, o2));

beforeEach(() => {
  e = undefined as unknown as Editor;
});

describe("OnlyOffice display style: cursor", () => {
  it("oo:word/styles/displayStyle.js#Run with/without style in paragraph", () => {
    e = build([[["Word!", null]]]);
    pStyle(0, "ParaStyle1");
    setRunStyle(0, 0, 5, "RunStyle1");
    caret(0, 4);
    expect(shown()).toBe("RunStyle1");
    setRunStyle(0, 0, 5, null);
    caret(0, 4);
    expect(shown()).toBe("ParaStyle1");
    pStyle(0, null);
    caret(0, 4);
    expect(shown()).toBe("Normal");
  });
});

describe("OnlyOffice display style: selection", () => {
  it("oo:word/styles/displayStyle.js#Two different paragraphs", () => {
    e = build([[["Word!", null]], [["Hello!", null]]]);
    selectBlocks(e, 0, 1);
    expect(shown()).toBe("Normal");
    pStyle(0, "ParaStyle1");
    pStyle(1, "ParaStyle1");
    selectBlocks(e, 0, 1);
    expect(shown()).toBe("ParaStyle1");
    pStyle(1, "ParaStyle2");
    selectBlocks(e, 0, 1);
    expect(shown()).toBe("");

    setRunStyle(0, 0, 5, "RunStyle1");
    setRunStyle(1, 0, 6, "RunStyle2");
    sel(1, 1, 1, 6); // partial selection of the second run
    expect(shown()).toBe("RunStyle2");

    setRunStyle(0, 0, 5, null);
    setRunStyle(1, 0, 6, null);
    sel(1, 1, 1, 6);
    expect(shown()).toBe("ParaStyle2");

    selectBlocks(e, 1, 1);
    expect(shown()).toBe("ParaStyle2");

    sel(0, 1, 1, 6); // both paragraphs, by keyboard
    expect(shown()).toBe("");
  });

  it("oo:word/styles/displayStyle.js#Different runs in one paragraph", () => {
    e = build([[["Word!", "RunStyle1"], ["Hello!", "RunStyle1"]]]);
    pStyle(0, "ParaStyle1");
    sel(0, 5, 0, 11);
    expect(shown()).toBe("RunStyle1");
    sel(0, 0, 0, 11);
    expect(shown()).toBe("RunStyle1");

    setRunStyle(0, 5, 11, "RunStyle2");
    sel(0, 5, 0, 11);
    expect(shown()).toBe("RunStyle2");
    sel(0, 0, 0, 11);
    expect(shown()).toBe("ParaStyle1");
  });

  it("oo:word/styles/displayStyle.js#Multiple runs with same style in different paragraphs", () => {
    e = build([
      [["Word!", "RunStyle1"], ["NextWord", "RunStyle2"]],
      [["Hello!", "RunStyle2"]],
    ]);
    pStyle(0, "ParaStyle1");
    pStyle(1, "ParaStyle2");
    sel(0, 5, 1, 6);
    expect(shown()).toBe("RunStyle2");
    sel(0, 0, 1, 6);
    expect(shown()).toBe("");
    pStyle(1, "ParaStyle1");
    sel(0, 0, 1, 6);
    expect(shown()).toBe("ParaStyle1");
    pStyle(0, null);
    pStyle(1, null);
    sel(0, 0, 1, 6);
    expect(shown()).toBe("Normal");
  });

  it("oo:word/styles/displayStyle.js#Combination of spaces and text", () => {
    // "Word!" + 3 spaces (no style) + 3 spaces (RunStyle2) + 3 spaces
    // (RunStyle1) + "Hello!", all runs except the first spaces RunStyle1.
    e = build([
      [
        ["Word!", "RunStyle1"],
        ["   ", null],
        ["   ", "RunStyle2"],
        ["   ", "RunStyle1"],
        ["Hello!", "RunStyle1"],
      ],
    ]);
    pStyle(0, "ParaStyle1");
    const END = 20;
    // Growing a selection leftwards from the end.
    sel(0, 14, 0, END);
    expect(shown()).toBe("RunStyle1");
    sel(0, 11, 0, END);
    expect(shown()).toBe("RunStyle1");
    sel(0, 8, 0, END);
    expect(shown()).toBe("RunStyle1");
    sel(0, 5, 0, END);
    expect(shown()).toBe("RunStyle1");
    sel(0, 0, 0, END);
    expect(shown()).toBe("RunStyle1");

    // Only spaces: the first run's style, else the paragraph's.
    sel(0, 11, 0, 14);
    expect(shown()).toBe("RunStyle1");
    sel(0, 8, 0, 14);
    expect(shown()).toBe("RunStyle2");
    sel(0, 5, 0, 14);
    expect(shown()).toBe("ParaStyle1");
    sel(0, 0, 0, 14);
    expect(shown()).toBe("RunStyle1");

    sel(0, 8, 0, 11);
    expect(shown()).toBe("RunStyle2");
    sel(0, 5, 0, 11);
    expect(shown()).toBe("ParaStyle1");
    sel(0, 0, 0, 11);
    expect(shown()).toBe("RunStyle1");

    sel(0, 5, 0, 8);
    expect(shown()).toBe("ParaStyle1");
    sel(0, 0, 0, 8);
    expect(shown()).toBe("RunStyle1");

    // Caret: the style of the character before it.
    caret(0, 1);
    expect(shown()).toBe("RunStyle1");
    caret(0, 6);
    expect(shown()).toBe("ParaStyle1");
    caret(0, 9);
    expect(shown()).toBe("RunStyle2");
    caret(0, 12);
    expect(shown()).toBe("RunStyle1");
    caret(0, 15);
    expect(shown()).toBe("RunStyle1");
  });
});
