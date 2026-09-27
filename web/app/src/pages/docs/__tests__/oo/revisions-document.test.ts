// Port of OnlyOffice's document-content revision tests (behaviour only):
// word/revisions/document-content.js. A paragraph's review type is the
// review type of its paragraph mark (Grown: the `paraChange` attribute).
// Pressing Enter inserts a new paragraph mark for the first half of the
// split; the original mark stays with the second half. Accepting a deleted
// paragraph mark merges the paragraphs; rejecting an inserted one does too.
//
// Block-level content controls (M10) are `sdtBlock` nodes.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { allSdts, insertContentControl, selectContentControl } from "../../sdt";
import {
  makeEditor,
  paragraphPos,
  paragraphReviewTypes,
  paragraphTexts,
  pressKey,
  reviewText,
  selectAll,
  setCursor,
  textblocks,
  typeText,
  type ReviewType,
} from "../harness";

const pc = (type: "insert" | "delete") =>
  JSON.stringify({ type, id: `p-${type}`, author: "Someone", date: "2026-01-01T00:00:00Z" }).replace(/"/g, "&quot;");

const CC = (text: string) => `<div data-sdt-pr='{"type":"richText"}'><p>${text}</p></div>`;

/** Test / Text text (paragraph mark added) / Test text (mark removed) / empty. */
function initTestDocument(track: boolean): Editor {
  const e = makeEditor(
    `<p>Test</p><p data-para-change="${pc("insert")}">Text text</p><p data-para-change="${pc("delete")}">Test text</p><p></p>`,
  );
  e.commands.setSuggesting(track);
  return e;
}

describe("OnlyOffice revisions on the document content level", () => {
  it("oo:word/revisions/document-content.js#Test adding a new paragraph if track revisions is on", () => {
    const C: ReviewType = "common";
    const A: ReviewType = "add";
    const R: ReviewType = "remove";
    expect(paragraphReviewTypes(initTestDocument(false))).toEqual([C, A, R, C]);

    const check = (track: boolean, index: number, types: ReviewType[]) => {
      // Caret at the start, two characters in, and at the end.
      for (const where of ["start", "middle", "end"] as const) {
        const e = initTestDocument(track);
        const len = paragraphTexts(e)[index].length;
        setCursor(e, paragraphPos(e, index, where === "start" ? 0 : where === "middle" ? 2 : len));
        pressKey(e, "Enter");
        expect(paragraphReviewTypes(e), `${track ? "tracked" : "untracked"} Enter at ${where} of paragraph ${index}`).toEqual(types);
      }
    };

    check(false, 0, [C, C, A, R, C]);
    check(false, 1, [C, C, A, R, C]);
    check(false, 2, [C, A, C, R, C]);

    check(true, 0, [A, C, A, R, C]);
    check(true, 1, [C, A, A, R, C]);
    check(true, 2, [C, A, A, R, C]);
  });

  it("oo:word/revisions/document-content.js#Check replacing text in a block-level content control (bug 67071)", () => {
    const e = makeEditor(`${CC("Text")}<p></p>`);
    selectContentControl(e, allSdts(e.state.doc)[0].pos);
    e.commands.setSuggesting(true);
    typeText(e, "123");
    // grown-variant order: Grown puts a replacement's insertion before the
    // text it replaces (M5), OnlyOffice after it here.
    expect(reviewText(e, 0), "typing over the selected content").toEqual([
      ["add", "123"],
      ["remove", "Text"],
    ]);
    e.commands.acceptAllSuggestions();
    expect(allSdts(e.state.doc).length, "the control stays").toBe(1);
    expect(reviewText(e, 0)).toEqual([["common", "123"]]);
  });

  it("oo:word/revisions/document-content.js#Check accepting all changes when entire content of a block-level sdt was deleted", () => {
    const e = makeEditor(`${CC("Text")}<p></p>`);
    e.commands.setSuggesting(true);
    selectContentControl(e, allSdts(e.state.doc)[0].pos);
    pressKey(e, "Backspace");
    expect(reviewText(e, 0)).toEqual([["remove", "Text"]]);
    e.commands.acceptAllSuggestions();
    expect(allSdts(e.state.doc).length, "the emptied control is removed").toBe(0);
    expect(e.state.doc.childCount).toBe(1);
  });

  it("oo:word/revisions/document-content.js#Check accepting changes in the special case when entire document was deleted (including a block-level sdt) (bug 69615)", () => {
    for (const bySelection of [false, true]) {
      const e = makeEditor(`<p>Before</p>${CC("Inside content control")}<p>After</p>`);
      e.commands.setSuggesting(true);
      selectAll(e);
      pressKey(e, "Backspace");
      expect(paragraphTexts(e)).toEqual(["Before", "Inside content control", "After"]);
      expect(paragraphReviewTypes(e)).toEqual(["remove", "remove", "common"]);
      if (bySelection) {
        selectAll(e);
        const { from, to } = e.state.selection;
        e.commands.acceptSuggestionRange(from, to);
      } else e.commands.acceptAllSuggestions();
      expect(textblocks(e).length, bySelection ? "BySelection" : "All").toBe(1);
      expect(paragraphTexts(e)).toEqual([""]);
      expect(allSdts(e.state.doc).length).toBe(0);
      expect(e.state.doc.childCount).toBe(1);
      expect(e.state.doc.firstChild!.type.name).toBe("paragraph");
    }
  });

  it("oo:word/revisions/document-content.js#Check rejecting changes in the special case when entire document was added (including a block-level sdt)", () => {
    for (const bySelection of [false, true]) {
      const e = makeEditor("<p></p>", { suggesting: true });
      typeText(e, "Before\nAfter");
      // The control goes in between, and its text is typed under review.
      setCursor(e, textblocks(e)[0].pos + "Before".length);
      insertContentControl(e, "richText", { level: "block" });
      typeText(e, "Inside content control");
      expect(paragraphTexts(e)).toEqual(["Before", "Inside content control", "After"]);
      expect(paragraphReviewTypes(e)).toEqual(["add", "add", "common"]);
      selectAll(e);
      if (bySelection) {
        const { from, to } = e.state.selection;
        e.commands.rejectSuggestionRange(from, to);
      } else e.commands.rejectAllSuggestions();
      expect(textblocks(e).length, bySelection ? "BySelection" : "All").toBe(1);
      expect(paragraphTexts(e)).toEqual([""]);
      expect(allSdts(e.state.doc).length).toBe(0);
    }
  });
});
