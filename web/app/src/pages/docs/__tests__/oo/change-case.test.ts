// Ports of OnlyOffice word/change-case/change-case.js (behaviour only; the
// fixtures below are Grown's own sentences). Grown exposes change case as
// Format > Text > UPPERCASE / lowercase / Title Case, implemented by
// transformSelection() in editorActions.ts. Sentence case and tOGGLE cASE
// are not offered yet (Docs M1); equations don't exist yet (Docs M11).
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { toTitleCase, transformSelection } from "../../editorActions";
import {
  htmlSnapshot,
  makeEditor,
  paragraphPos,
  paragraphText,
  paragraphTexts,
  selectInParagraph,
  selectRange,
} from "../harness";

const upper = (e: Editor) => transformSelection(e, (s) => s.toUpperCase());
const lower = (e: Editor) => transformSelection(e, (s) => s.toLowerCase());
const title = (e: Editor) => transformSelection(e, toTitleCase);

// One paragraph of several sentences in each casing.
const SENTENCE =
  "The garden was quiet at dawn, and the bees were not awake. Small birds sang in the hedge. A gardener opened the gate, then closed it again.";
const UPPER = SENTENCE.toUpperCase();
const LOWER = SENTENCE.toLowerCase();
// Every word capitalised, rest lower-case.
const WORDS =
  "The Garden Was Quiet At Dawn, And The Bees Were Not Awake. Small Birds Sang In The Hedge. A Gardener Opened The Gate, Then Closed It Again.";
// Toggle of SENTENCE: each letter's case inverted.
const TOGGLED =
  "tHE GARDEN WAS QUIET AT DAWN, AND THE BEES WERE NOT AWAKE. sMALL BIRDS SANG IN THE HEDGE. a GARDENER OPENED THE GATE, THEN CLOSED IT AGAIN.";

/** Load one paragraph and select all of its text. */
function paragraphSelected(text: string): Editor {
  const e = makeEditor(`<p>${text}</p>`);
  selectInParagraph(e, 0, 0, text.length);
  return e;
}

describe("OnlyOffice change-case: whole paragraph", () => {
  it.skip("oo:word/change-case/change-case.js#Sentence case paragraph", () => {
    // TODO(M1): Grown has no Sentence case command.
    const e = paragraphSelected(LOWER);
    expect(paragraphText(e, 0)).toBe(SENTENCE);
  });

  it("oo:word/change-case/change-case.js#Upper case paragraph", () => {
    const e = paragraphSelected(SENTENCE);
    upper(e);
    expect(paragraphText(e, 0)).toBe(UPPER);
  });

  it("oo:word/change-case/change-case.js#Lower case paragraph", () => {
    const e = paragraphSelected(TOGGLED);
    lower(e);
    expect(paragraphText(e, 0)).toBe(LOWER);
  });

  it.skip("oo:word/change-case/change-case.js#Toggle case paragraph", () => {
    // TODO(M1): Grown has no tOGGLE cASE command.
    const e = paragraphSelected(SENTENCE);
    expect(paragraphText(e, 0)).toBe(TOGGLED);
  });

  it("oo:word/change-case/change-case.js#CapitalizeWords case paragraph", () => {
    const e = paragraphSelected(SENTENCE);
    title(e);
    expect(paragraphText(e, 0)).toBe(WORDS);
  });
});

describe("OnlyOffice change-case: partial selection", () => {
  it.skip("oo:word/change-case/change-case.js#Sentence case", () => {
    // TODO(M1): Grown has no Sentence case command. Expected: selecting
    // "red. apple" in "red. apples" gives "Red. Apple" — the first letter
    // of each sentence in the selection is raised.
    const e = makeEditor("<p>red. apples</p>");
    selectInParagraph(e, 0, 0, 10);
    expect(paragraphText(e, 0)).toBe("Red. Apples");
  });

  it("oo:word/change-case/change-case.js#Upper case", () => {
    const e = makeEditor("<p>Big blue. ocean</p>");
    selectInParagraph(e, 0, 4, 8); // "blue"
    upper(e);
    expect(paragraphText(e, 0)).toBe("Big BLUE. ocean");
  });

  it("oo:word/change-case/change-case.js#Lower case", () => {
    const e = makeEditor("<p>Big Blue. ocean</p>");
    selectInParagraph(e, 0, 4, 8); // "Blue"
    lower(e);
    expect(paragraphText(e, 0)).toBe("Big blue. ocean");
  });

  it.skip("oo:word/change-case/change-case.js#Toggle case", () => {
    // TODO(M1): Grown has no tOGGLE cASE command.
    const e = makeEditor("<p>Big Blue. ocean</p>");
    selectInParagraph(e, 0, 4, 8);
    expect(paragraphText(e, 0)).toBe("Big bLUE. ocean");
  });

  it("oo:word/change-case/change-case.js#CapitalizeWords case", () => {
    const e = makeEditor("<p>big blue. ocean</p>");
    selectInParagraph(e, 0, 0, 8); // "big blue"
    title(e);
    expect(paragraphText(e, 0)).toBe("Big Blue. ocean");
  });
});

describe("OnlyOffice change-case: equations", () => {
  // In OnlyOffice, change case leaves equation text untouched (letters in
  // math are variables, and "." may be a decimal point). Grown has no
  // equation node yet.
  it.skip("oo:word/change-case/change-case.js#Sentence case math", () => {
    // TODO(M11): needs the math node.
  });
  it.skip("oo:word/change-case/change-case.js#Upper case math", () => {
    // TODO(M11): needs the math node.
  });
  it.skip("oo:word/change-case/change-case.js#Lower case math", () => {
    // TODO(M11): needs the math node.
  });
  it.skip("oo:word/change-case/change-case.js#ToggleCase case math", () => {
    // TODO(M11): needs the math node.
  });
  it.skip("oo:word/change-case/change-case.js#CapitalizeWords case math", () => {
    // TODO(M11): needs the math node.
  });
});

// Grown-native regressions found while porting (not OnlyOffice cases; see
// "Semantic differences found" in docs/plans/onlyoffice-parity/docs.md).
// transformSelection re-inserts the selection as one plain string, so it
// loses per-run formatting and merges the selected paragraphs.
describe("change case keeps document structure (Grown)", () => {
  it.skip("keeps each run's formatting", () => {
    // TODO(M1): today all text takes the first run's marks.
    const e = makeEditor("<p><strong>big</strong> blue <em>sea</em></p>");
    selectInParagraph(e, 0, 0, 12);
    upper(e);
    expect(htmlSnapshot(e)).toBe("<p><strong>BIG</strong> BLUE <em>SEA</em></p>");
  });

  it.skip("keeps paragraphs separate", () => {
    // TODO(M1): today the two paragraphs become one with a newline.
    const e = makeEditor("<p>one</p><p>two</p>");
    selectRange(e, paragraphPos(e, 0, 0), paragraphPos(e, 1, 3));
    upper(e);
    expect(paragraphTexts(e)).toEqual(["ONE", "TWO"]);
  });
});
