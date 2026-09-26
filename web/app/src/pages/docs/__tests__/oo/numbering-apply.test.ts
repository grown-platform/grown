// Ports of OnlyOffice word/numbering/numberingApplicator.js (behaviour
// only): applying library lists to paragraphs, styles and headings.
//
// OnlyOffice's deprecated (type, subtype) presets map to Grown's library:
//   (2,7) heading 1. / 1.1.        -> ml-headings-legal
//   (2,4) Article I. / Section I.01 -> ml-headings-article
//   (2,6) I. / A. / 1. / a)         -> ml-headings-outline
//   (2,2) 1. / 1.1. (not headings)  -> ml-legal
//   (1,5) a)                        -> num-lower-letter-paren
//   (1,2) 1)                        -> num-decimal-paren
//   (2,-1) none                     -> removeNumbering
// Grown has Heading 1-6 (TipTap headings), so the nine-heading cases check
// six levels (grown-variant).
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import {
  makeEditor,
  numberingText,
  selectAll,
  selectBlocks,
  setBlockAttrs,
  setCursor,
  textblocks,
} from "../harness";
import { applyListPreset, getDocModel, removeNumbering } from "../../docModel";
import { effectiveNumPr, presetById } from "../../numbering";
import { headingStyleId, paragraphStyleId } from "../../styles";

const texts = (e: Editor) => textblocks(e).map((_, i) => numberingText(e, i));

function headingsDoc(levels: number[]): Editor {
  return makeEditor(levels.map((l) => `<h${l}>Heading ${l - 1}</h${l}>`).join(""));
}

/** Caret at the start of textblock `i`. */
const caretIn = (e: Editor, i: number) => setCursor(e, textblocks(e)[i].pos);

describe("OnlyOffice numbering applicator", () => {
  it("oo:word/numbering/numberingApplicator.js#Apply numbering through style", () => {
    const e = makeEditor("<p>First</p><p>Second</p><p>Third</p>");
    const { sheet, numbering } = getDocModel(e);
    sheet.put({ id: "style1", name: "style1", type: "paragraph", basedOn: "Normal" });
    for (let i = 0; i < 3; i++) setBlockAttrs(e, i, { styleId: "style1" });
    expect(texts(e)).toEqual(["", "", ""]);

    const lvls = presetById("ml-legal")!.lvls();
    lvls[0].pStyle = "style1";
    const num = numbering.createList(lvls);
    sheet.put({ ...sheet.get("style1")!, pPr: { numId: num, numLvl: 0 } });
    expect(texts(e)).toEqual(["1.", "2.", "3."]);

    // Caret in the second paragraph, apply a) b) c): the list changes format.
    caretIn(e, 1);
    applyListPreset(e, "num-lower-letter-paren");
    expect(texts(e)).toEqual(["a)", "b)", "c)"]);
  });

  it("oo:word/numbering/numberingApplicator.js#Numbering for headings", () => {
    const e = headingsDoc([1, 2, 3, 4, 5, 6]);
    const { sheet, numbering } = getDocModel(e);
    const check = (expected: string[]) => {
      textblocks(e).forEach((b, i) => {
        const styleId = headingStyleId(i + 1);
        const style = sheet.get(styleId)!;
        expect(style.pPr?.numId, `style numbering, heading ${i + 1}`).toBeTruthy();
        const np = effectiveNumPr(sheet, numbering, b.node)!;
        expect(np).toEqual({ numId: style.pPr!.numId, lvl: i });
        expect(numbering.level(np.numId, i)!.pStyle).toBe(styleId);
        expect(numberingText(e, i)).toBe(expected[i]);
      });
    };

    selectAll(e);
    applyListPreset(e, "ml-headings-article");
    check(["Article I.", "Section I.01", "(a)", "(i)", "1)", "a)"]);

    applyListPreset(e, "ml-headings-legal");
    check(["1.", "1.1.", "1.1.1.", "1.1.1.1.", "1.1.1.1.1.", "1.1.1.1.1.1."]);

    // Cancel numbering: the headings keep their style, which keeps its list.
    removeNumbering(e);
    textblocks(e).forEach((b, i) => {
      expect(numberingText(e, i)).toBe("");
      expect(paragraphStyleId(sheet, b.node)).toBe(headingStyleId(i + 1));
      expect(sheet.get(headingStyleId(i + 1))!.pPr?.numId).toBeTruthy();
    });

    // Re-apply to the list with cancelled numbering.
    selectAll(e);
    applyListPreset(e, "ml-headings-legal");
    check(["1.", "1.1.", "1.1.1.", "1.1.1.1.", "1.1.1.1.1.", "1.1.1.1.1.1."]);
  });

  it("oo:word/numbering/numberingApplicator.js#Applying numbering by selecting vs. placing cursor", () => {
    const e = headingsDoc([1, 2, 3, 4, 1, 2, 3, 4]);
    expect(textblocks(e)).toHaveLength(8);
    selectAll(e);
    applyListPreset(e, "ml-headings-article");
    expect(texts(e)).toEqual([
      "Article I.", "Section I.01", "(a)", "(i)",
      "Article II.", "Section II.01", "(a)", "(i)",
    ]);

    // Caret in one heading: the heading list is redefined.
    caretIn(e, 1);
    applyListPreset(e, "ml-headings-legal");
    expect(texts(e)).toEqual(["1.", "1.1.", "1.1.1.", "1.1.1.1.", "2.", "2.1.", "2.1.1.", "2.1.1.1."]);

    // A heading list applied to a selection reaches every heading.
    selectBlocks(e, 0, 3);
    applyListPreset(e, "ml-headings-outline");
    expect(texts(e)).toEqual(["I.", "A.", "1.", "a)", "II.", "A.", "1.", "a)"]);

    // A list without headings applies to the selected paragraphs only.
    selectBlocks(e, 0, 3);
    applyListPreset(e, "ml-legal");
    expect(texts(e)).toEqual(["1.", "1.1.", "1.1.1.", "1.1.1.1.", "I.", "A.", "1.", "a)"]);
  });

  it("oo:word/numbering/numberingApplicator.js#Applying numbering by selecting to paragraphs with left indentation", () => {
    const doc = () => {
      const e = makeEditor([0, 1, 2, 3].map((i) => `<p>Paragraph ${i}</p>`).join(""));
      for (let i = 0; i < 4; i++) setBlockAttrs(e, i, { indent: 14, indentFirstLine: 42 });
      return e;
    };
    let e = doc();
    selectAll(e);
    applyListPreset(e, "num-decimal-paren");
    expect(texts(e)).toEqual(["1)", "2)", "3)", "4)"]);

    // grown-variant: OnlyOffice infers a deeper level for a paragraph whose
    // first line is indented further ("i.", then "b. c. d."); Grown applies
    // the list at level 0 and drops the direct indents in favour of the
    // list's, so the numbering stays 1) 2) 3) 4).
    e = doc();
    setBlockAttrs(e, 0, { indent: 14, indentFirstLine: 71 });
    selectAll(e);
    applyListPreset(e, "num-decimal-paren");
    expect(texts(e)).toEqual(["1)", "2)", "3)", "4)"]);
    expect(textblocks(e)[0].node.attrs.indentFirstLine).toBe(null);
  });
});
