// Port of OnlyOffice's current word / sentence plugin-API test (behaviour
// only): word/plugins/pluginsApi.js "Test CurrenWord/CurrentSentence".
// The other pluginsApi cases (add-in fields, editing restrictions) belong
// to M10/M13 and are not ported here.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { makeEditor, paragraphPos, paragraphText, setCursor } from "../harness";
import { addText } from "../../textOps";
import {
  getCurrentSentence,
  getCurrentWord,
  replaceCurrentSentence,
  replaceCurrentWord,
  selectCurrentSentence,
  selectCurrentWord,
} from "../../textUnits";

const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.    Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";
const FOX =
  "The quick brown fox jumps over the lazy dog. The five boxing wizards jump quickly. Eat more of those fresh french loafs and drink a tea!";

function withText(text: string): Editor {
  const e = makeEditor("<p></p>");
  addText(e, text);
  return e;
}
/** Caret at character offset `n` of the first paragraph. */
const at = (e: Editor, n: number) => setCursor(e, paragraphPos(e, 0, n));
const len = (e: Editor) => paragraphText(e, 0).length;

describe("OnlyOffice pluginsApi: current word / sentence", () => {
  it("oo:word/plugins/pluginsApi.js#Test CurrenWord/CurrentSentence", () => {
    let e = withText(LOREM);
    at(e, 0);
    expect(getCurrentWord(e)).toBe("Lorem");
    at(e, 6);
    expect(getCurrentWord(e)).toBe("ipsum"); // left edge
    at(e, 11);
    expect(getCurrentWord(e)).toBe("ipsum"); // right edge
    at(e, len(e));
    expect(getCurrentWord(e)).toBe(".");
    at(e, len(e) - 1);
    expect(getCurrentWord(e)).toBe("laborum");

    at(e, 0);
    expect(getCurrentSentence(e)).toBe(
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    );
    at(e, len(e));
    expect(getCurrentSentence(e)).toBe("");
    at(e, len(e) - 5);
    expect(getCurrentSentence(e)).toBe(
      "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
    );
    at(e, 123);
    expect(getCurrentSentence(e)).toBe(
      "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
    );

    e = withText("Test text");
    at(e, 2);
    expect(getCurrentWord(e)).toBe("Test");
    expect(getCurrentSentence(e)).toBe("Test text");
    // A PAGE field inside "Test" (M8): the field breaks the word but reads
    // as its result ("1") in the sentence.
    e.commands.insertField("PAGE");
    at(e, 0);
    expect(getCurrentWord(e)).toBe("Te");
    expect(getCurrentSentence(e)).toBe("Te1st text");

    e = withText("Test text");
    at(e, 0);
    replaceCurrentWord(e, "First");
    expect(paragraphText(e)).toBe("First text");
    at(e, 2);
    replaceCurrentWord(e, "Second");
    expect(paragraphText(e)).toBe("Second text");
    at(e, 3);
    replaceCurrentWord(e, "123", "afterCursor");
    expect(paragraphText(e)).toBe("Sec123 text");
    at(e, 3);
    replaceCurrentWord(e, "654", "beforeCursor");
    expect(paragraphText(e)).toBe("654123 text");

    e = withText(FOX);
    at(e, 16);
    expect(getCurrentSentence(e, "entirely")).toBe("The quick brown fox jumps over the lazy dog.");
    expect(getCurrentSentence(e, "afterCursor")).toBe("fox jumps over the lazy dog.");
    expect(getCurrentSentence(e, "beforeCursor")).toBe("The quick brown ");
    at(e, 16 + 28);
    expect(getCurrentSentence(e, "entirely")).toBe("The five boxing wizards jump quickly.");
    expect(getCurrentSentence(e, "afterCursor")).toBe("The five boxing wizards jump quickly.");
    expect(getCurrentSentence(e, "beforeCursor")).toBe("");
    at(e, len(e) - 1);
    expect(getCurrentSentence(e, "entirely")).toBe("Eat more of those fresh french loafs and drink a tea!");
    expect(getCurrentSentence(e, "afterCursor")).toBe("!");
    expect(getCurrentSentence(e, "beforeCursor")).toBe("Eat more of those fresh french loafs and drink a tea");

    at(e, 16);
    replaceCurrentSentence(e, "The slow yellow rabbit jumps over the fluffy cat!", "entirely");
    expect(getCurrentSentence(e)).toBe("The five boxing wizards jump quickly.");
    at(e, e.state.selection.head - paragraphPos(e, 0, 0) - 5);
    expect(getCurrentSentence(e)).toBe("The slow yellow rabbit jumps over the fluffy cat!");
    at(e, 58);
    replaceCurrentSentence(e, "The eight", "beforeCursor");
    expect(getCurrentSentence(e)).toBe("The eight boxing wizards jump quickly.");
    replaceCurrentSentence(e, " relaxing wizards jump slowly.", "afterCursor");
    at(e, e.state.selection.head - paragraphPos(e, 0, 0) - 5);
    expect(getCurrentSentence(e)).toBe("The eight relaxing wizards jump slowly.");

    e = withText(FOX);
    at(e, 64);
    replaceCurrentSentence(e, "The five boxing wizards jump quickly.", "entirely");
    expect(paragraphText(e)).toBe(FOX);
  });
});

describe("current word / sentence selection (Grown)", () => {
  it("selects the word and sentence at the caret", () => {
    const e = withText(FOX);
    at(e, 50);
    expect(selectCurrentWord(e)).toBe(true);
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("five");
    expect(selectCurrentSentence(e)).toBe(true);
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe(
      "The five boxing wizards jump quickly.",
    );
  });

  it("keeps run formatting when replacing the current word", () => {
    const e = makeEditor("<p><strong>bold</strong> text</p>");
    at(e, 2);
    replaceCurrentWord(e, "heavy");
    expect(e.getHTML()).toBe("<p><strong>heavy</strong> text</p>");
  });
});
