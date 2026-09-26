// Port of OnlyOffice word/styles/styleApplicator.js (behaviour only):
// compiled properties with direct formatting and a direct list, then
// "update style to match selection".
// Lengths are points in Grown (OnlyOffice uses millimetres); the numbers
// are kept as in the original cases.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { makeEditor, setBlockAttrs, setCursor, textblocks } from "../harness";
import { compiledProps, getDocModel, updateStyleFromSelection } from "../../docModel";
import type { LvlDef } from "../../numbering";
import { presetById } from "../../numbering";

const compiled = (e: Editor, i: number) => {
  const c = compiledProps(e, textblocks(e)[i].node);
  return { left: c.indLeft, right: c.indRight, first: c.indFirstLine, align: c.align };
};

describe("OnlyOffice style applicator", () => {
  it("oo:word/styles/styleApplicator.js#Style application and change from current selection", () => {
    const e = makeEditor("<p>First</p><p>Second</p>");
    const { sheet, numbering } = getDocModel(e);
    sheet.put({ id: "style1", name: "style1", type: "paragraph", basedOn: "Normal" });
    setBlockAttrs(e, 0, { styleId: "style1" });
    setBlockAttrs(e, 1, { styleId: "style1" });

    // A list whose level 0 indents the text 15 with a first line of +5.
    const lvls: LvlDef[] = presetById("num-decimal-dot")!.lvls();
    lvls[0] = { ...lvls[0], indLeft: 15, hanging: -5 };
    const num = numbering.createList(lvls);

    // Empty style: defaults.
    expect(compiled(e, 0)).toEqual({ left: 0, right: 0, first: 0, align: "left" });
    expect(compiled(e, 1)).toEqual({ left: 0, right: 0, first: 0, align: "left" });

    // Direct properties.
    setBlockAttrs(e, 0, { indent: 10, indentRight: 10, indentFirstLine: 20, textAlign: "center" });
    expect(compiled(e, 0)).toEqual({ left: 10, right: 10, first: 20, align: "center" });

    // Direct numbering: direct indents beat the list's; without direct
    // indents the list level's apply.
    setBlockAttrs(e, 0, { numId: num, numLvl: 0 });
    setBlockAttrs(e, 1, { numId: num, numLvl: 0 });
    expect(compiled(e, 0)).toEqual({ left: 10, right: 10, first: 20, align: "center" });
    expect(compiled(e, 1)).toEqual({ left: 15, right: 0, first: 5, align: "left" });

    // Update the style from the first paragraph: both paragraphs follow it.
    setCursor(e, textblocks(e)[0].pos);
    expect(updateStyleFromSelection(e, "style1")).toBe(true);
    expect(compiled(e, 0)).toEqual({ left: 10, right: 10, first: 20, align: "center" });
    expect(compiled(e, 1)).toEqual({ left: 10, right: 10, first: 20, align: "center" });
    // The first paragraph's direct formatting moved into the style.
    expect(textblocks(e)[0].node.attrs.indent).toBe(null);
    expect(sheet.get("style1")!.pPr).toMatchObject({ indLeft: 10, indRight: 10, indFirstLine: 20, align: "center", numId: num });
  });
});
