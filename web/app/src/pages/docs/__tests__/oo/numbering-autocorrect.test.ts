// Ports of OnlyOffice word/numbering/numberingAutocorrect.js (behaviour
// only): typing a list marker and a space at the start of a paragraph
// starts (or continues) a list.
//
// grown-variant: "* " and "- " start TipTap bulleted lists (shown as "•";
// OnlyOffice uses "·" and "–" bullets) and "> " starts a block quote, as in
// Google Docs, instead of a "Ø" bullet list. "1. " is TipTap's ordered list;
// "1.1. ", "1) ", "a. ", "A) " and friends are Word-model lists.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import {
  blockPaths,
  makeEditor,
  numberingText,
  paragraphText,
  setBlockAttrs,
  setCursor,
  textblocks,
  typeText,
} from "../harness";
import { getDocModel } from "../../docModel";
import { presetById } from "../../numbering";

function typed(text: string): Editor {
  const e = makeEditor("<p></p>");
  typeText(e, text);
  return e;
}

const hasDirectNumbering = (e: Editor, i = 0) => textblocks(e)[i].node.attrs.numId != null;

describe("OnlyOffice numbering autocorrect", () => {
  it("oo:word/numbering/numberingAutocorrect.js#Check autocorrect text to numbering in clear paragraph", () => {
    const check = (input: string, label: string) => {
      const e = typed(input);
      expect(paragraphText(e, 0), input).toBe("");
      expect(numberingText(e, 0), input).toBe(label);
    };
    // Bullets (grown-variant markers, see header).
    check("* ", "•");
    check("- ", "•");
    const quote = typed("> ");
    expect(blockPaths(quote)).toEqual(["blockquote>paragraph"]);

    for (let n = 1; n <= 9; n++) check(`${"1.".repeat(n)} `, "1.".repeat(n));
    for (let n = 1; n <= 9; n++) check(`${"1)".repeat(n)} `, "1)".repeat(n));
    check("a. ", "a.");
    check("a) ", "a)");
    check("A. ", "A.");
    check("A) ", "A)");
    // OnlyOffice leaves roman numerals as a TODO; Grown reads i / I as roman.
    check("i. ", "i.");
    check("I) ", "I)");
  });

  it("oo:word/numbering/numberingAutocorrect.js#Check not autocorrect text to numbering in clear paragraph", () => {
    const check = (input: string) => {
      const e = typed(input);
      expect(hasDirectNumbering(e), input).toBe(false);
      expect(numberingText(e, 0), input).toBe("");
      expect(paragraphText(e, 0), input).toBe(input);
    };
    check("a.a. ");
    check("a)a) ");
    check("A.A. ");
    check("A)A) ");
    check("I.I. ");
    check("I)I) ");
    check("i.i. ");
    check("i)i) ");
    check("1)1)1)1)1)1)1)1)1)1) ");
    check("1.1.1.1.1.1.1.1.1.1. ");
    check("1 ");
  });

  it("oo:word/numbering/numberingAutocorrect.js#Check autocorrect text to numbering", () => {
    const check = (presetId: string, input: string, label: string) => {
      const e = makeEditor("<p></p>".repeat(5));
      const numId = getDocModel(e).numbering.createList(presetById(presetId)!.lvls());
      for (let i = 0; i < 4; i++) setBlockAttrs(e, i, { numId, numLvl: 0 });
      setCursor(e, textblocks(e)[4].pos);
      typeText(e, input);
      expect(paragraphText(e, 4), input).toBe("");
      expect(numberingText(e, 4), input).toBe(label);
      // It joined the list above rather than starting a new one.
      expect(textblocks(e)[4].node.attrs.numId).toBe(numId);
    };
    check("num-decimal-dot", "5. ", "5.");
    check("num-decimal-paren", "5) ", "5)");
    check("num-upper-letter", "E. ", "E.");
    check("num-lower-letter-paren", "e) ", "e)");
    check("num-lower-letter-dot", "e. ", "e.");
    check("num-upper-roman", "V. ", "V.");
    check("num-lower-roman", "v. ", "v.");
  });
});
