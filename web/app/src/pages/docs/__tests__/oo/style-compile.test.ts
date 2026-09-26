// Port of OnlyOffice word/styles/paraPr.js (behaviour only): compiled
// paragraph indents from a style, and direct numbering switched off.
// Lengths are points in Grown (OnlyOffice uses millimetres); the numbers
// are kept as in the original cases.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { makeEditor, setBlockAttrs, textblocks } from "../harness";
import { compiledProps, getDocModel } from "../../docModel";

const compiled = (e: Editor, i: number) => {
  const c = compiledProps(e, textblocks(e)[i].node);
  return { left: c.indLeft, right: c.indRight, first: c.indFirstLine, align: c.align };
};

describe("OnlyOffice paragraph style (ParaPr)", () => {
  it("oo:word/styles/paraPr.js#Indents", () => {
    const e = makeEditor("<p></p>");
    const { sheet } = getDocModel(e);
    sheet.put({
      id: "Indented",
      name: "Indented",
      type: "paragraph",
      basedOn: "Normal",
      pPr: { indLeft: 10, indRight: 10, indFirstLine: 20 },
    });
    setBlockAttrs(e, 0, { styleId: "Indented" });
    expect(compiled(e, 0)).toMatchObject({ left: 10, right: 10, first: 20 });

    // Direct numbering "0" (numbering off) drops the left and first-line
    // indents a list would have set; the right indent stays.
    setBlockAttrs(e, 0, { numId: "0", numLvl: 0 });
    expect(compiled(e, 0)).toMatchObject({ left: 0, right: 10, first: 0 });
    // OnlyOffice also accepts the number 0; Grown stores ids as strings, so
    // both spellings are the same attribute value.
    setBlockAttrs(e, 0, { numId: String(0), numLvl: 0 });
    expect(compiled(e, 0)).toMatchObject({ left: 0, right: 10, first: 0 });
  });
});
