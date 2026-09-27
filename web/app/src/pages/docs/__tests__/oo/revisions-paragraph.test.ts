// Port of OnlyOffice's paragraph revision tests (behaviour only):
// word/revisions/paragraph.js. With track changes on, typing over a
// selection, or deleting it and then typing, removes the user's own pending
// insertion outright, marks other text deleted and inserts the new text as
// an insertion at the start of the selection (Delete leaves the caret after
// the deleted text, Backspace before it).
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { makeEditor, paragraphText, pressKey, reviewHtml, reviewText, selectInParagraph, typeText, type ReviewType } from "../harness";

function fill(runs: { text: string; type?: ReviewType }[]): Editor {
  return makeEditor(`<p>${reviewHtml(runs)}</p>`, { suggesting: true });
}

const fill1234test = () => fill([{ text: "1234", type: "add" }, { text: "test" }]);
const fillBefore1234after = () => fill([{ text: "Before" }, { text: "1234", type: "add" }, { text: "after" }]);

describe("OnlyOffice revisions in a paragraph", () => {
  it("oo:word/revisions/paragraph.js#Remove/replace text in a single run", () => {
    let e = fill1234test();
    expect(paragraphText(e)).toBe("1234test");
    expect(reviewText(e)).toEqual([["add", "1234"], ["common", "test"]]);

    // Select text. Enter text over selection.
    selectInParagraph(e, 0, 1, 3);
    typeText(e, "QQQ");
    expect(reviewText(e)).toEqual([["add", "1QQQ4"], ["common", "test"]]);

    // Select text. Press delete. Enter text.
    e = fill1234test();
    selectInParagraph(e, 0, 1, 3);
    pressKey(e, "Delete");
    typeText(e, "QQQ");
    expect(reviewText(e)).toEqual([["add", "1QQQ4"], ["common", "test"]]);

    // Select text. Press backspace. Enter text.
    e = fill1234test();
    selectInParagraph(e, 0, 1, 3);
    pressKey(e, "Backspace");
    typeText(e, "QQQ");
    expect(reviewText(e)).toEqual([["add", "1QQQ4"], ["common", "test"]]);
  });

  it("oo:word/revisions/paragraph.js#Remove/replace text in several runs", () => {
    let e = fill1234test();
    expect(paragraphText(e)).toBe("1234test");

    selectInParagraph(e, 0, 1, 6);
    typeText(e, "ABC");
    expect(reviewText(e)).toEqual([["add", "1ABC"], ["remove", "te"], ["common", "st"]]);

    e = fill1234test();
    selectInParagraph(e, 0, 1, 6);
    pressKey(e, "Delete");
    typeText(e, "ABC");
    expect(reviewText(e)).toEqual([["add", "1"], ["remove", "te"], ["add", "ABC"], ["common", "st"]]);

    e = fill1234test();
    selectInParagraph(e, 0, 1, 6);
    pressKey(e, "Backspace");
    typeText(e, "ABC");
    expect(reviewText(e)).toEqual([["add", "1ABC"], ["remove", "te"], ["common", "st"]]);

    e = fillBefore1234after();
    selectInParagraph(e, 0, 8, 12);
    typeText(e, "777");
    expect(reviewText(e)).toEqual([["common", "Before"], ["add", "12777"], ["remove", "af"], ["common", "ter"]]);

    e = fillBefore1234after();
    selectInParagraph(e, 0, 8, 12);
    pressKey(e, "Delete");
    typeText(e, "777");
    expect(reviewText(e)).toEqual([["common", "Before"], ["add", "12"], ["remove", "af"], ["add", "777"], ["common", "ter"]]);

    e = fillBefore1234after();
    selectInParagraph(e, 0, 8, 12);
    pressKey(e, "Backspace");
    typeText(e, "777");
    expect(reviewText(e)).toEqual([["common", "Before"], ["add", "12777"], ["remove", "af"], ["common", "ter"]]);
  });
});
