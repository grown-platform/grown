// Port of OnlyOffice's document-content revision tests (behaviour only):
// word/revisions/document-content.js. A paragraph's review type is the
// review type of its paragraph mark (Grown: the `paraChange` attribute).
// Pressing Enter inserts a new paragraph mark for the first half of the
// split; the original mark stays with the second half. Accepting a deleted
// paragraph mark merges the paragraphs; rejecting an inserted one does too.
//
// Block-level content controls arrive in M10, so the two sdt-only cases are
// skipped and the "entire document" cases use a middle paragraph where
// OnlyOffice has a content control.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import {
  makeEditor,
  paragraphPos,
  paragraphReviewTypes,
  paragraphTexts,
  pressKey,
  selectAll,
  setCursor,
  textblocks,
  typeText,
  type ReviewType,
} from "../harness";

const pc = (type: "insert" | "delete") =>
  JSON.stringify({ type, id: `p-${type}`, author: "Someone", date: "2026-01-01T00:00:00Z" }).replace(/"/g, "&quot;");

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

  it.skip("oo:word/revisions/document-content.js#Check replacing text in a block-level content control (bug 67071)", () => {
    // TODO(M10): needs block-level content controls.
  });

  it.skip("oo:word/revisions/document-content.js#Check accepting all changes when entire content of a block-level sdt was deleted", () => {
    // TODO(M10): needs block-level content controls.
  });

  it("oo:word/revisions/document-content.js#Check accepting changes in the special case when entire document was deleted (including a block-level sdt) (bug 69615)", () => {
    for (const bySelection of [false, true]) {
      const e = makeEditor("<p>Before</p><p>Inside content control</p><p>After</p>");
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
      expect(e.state.doc.childCount).toBe(1);
      expect(e.state.doc.firstChild!.type.name).toBe("paragraph");
    }
  });

  it("oo:word/revisions/document-content.js#Check rejecting changes in the special case when entire document was added (including a block-level sdt)", () => {
    for (const bySelection of [false, true]) {
      const e = makeEditor("<p></p>", { suggesting: true });
      typeText(e, "Before\nInside content control\nAfter");
      expect(paragraphTexts(e)).toEqual(["Before", "Inside content control", "After"]);
      expect(paragraphReviewTypes(e)).toEqual(["add", "add", "common"]);
      selectAll(e);
      if (bySelection) {
        const { from, to } = e.state.selection;
        e.commands.rejectSuggestionRange(from, to);
      } else e.commands.rejectAllSuggestions();
      expect(textblocks(e).length, bySelection ? "BySelection" : "All").toBe(1);
      expect(paragraphTexts(e)).toEqual([""]);
    }
  });
});
