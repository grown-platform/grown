// Ports of OnlyOffice word/api/api.js (behaviour only). OnlyOffice drives its
// document model through API calls; the ports drive Grown's editor through
// the same user-level operations (typing, keys, list commands).
import { describe, expect, it } from "vitest";
import {
  blockPaths,
  makeEditor,
  paragraphTexts,
  pressKey,
  selectedText,
  selectInParagraph,
  selectAll,
  setCursor,
  paragraphPos,
  typeText,
} from "../harness";


describe("OnlyOffice api", () => {
  it("oo:word/api/api.js#Change numbering level", () => {
    // Two numbered items; the second is empty.
    const e = makeEditor("<ol><li><p>First</p></li><li><p></p></li></ol>");
    const OL = "orderedList>listItem>paragraph";
    expect(blockPaths(e)).toEqual([OL, OL]);

    // Enter in an empty top-level item ends the list.
    setCursor(e, paragraphPos(e, 1, 0));
    expect(pressKey(e, "Enter")).toBe(true);
    expect(blockPaths(e)).toEqual([OL, "paragraph"]);

    // Re-applying numbering rejoins the same list (same numbering).
    setCursor(e, paragraphPos(e, 1, 0));
    e.commands.toggleOrderedList();
    expect(blockPaths(e)).toEqual([OL, OL]);
    expect(e.state.doc.childCount).toBe(1);

    // Tab demotes it to level 2 …
    expect(pressKey(e, "Tab")).toBe(true);
    expect(blockPaths(e)).toEqual([OL, `${OL.replace(/>paragraph$/, "")}>${OL}`]);

    // … and Enter in the empty level-2 item promotes it back to level 1.
    expect(pressKey(e, "Enter")).toBe(true);
    expect(blockPaths(e)).toEqual([OL, OL]);
  });

  it.skip("oo:word/api/api.js#Test AddText/RemoveSelection", () => {
    // TODO(M1): typing over a selection and select-all text pass today; the
    // missing part is the API's "wrap with spaces" insert option (inserting
    // "123" inside "Text" as "Tex 123 t").
    const e = makeEditor("<p></p>");
    typeText(e, "Hello World!");
    selectAll(e);
    expect(selectedText(e)).toBe("Hello World!");
    typeText(e, "Test");
    expect(paragraphTexts(e)).toEqual(["Test"]);
    expect("wrapWithSpaces").toBe("implemented");
  });

  it.skip("oo:word/api/api.js#Test add/remove space before/after paragraph", () => {
    // TODO(M1): Grown's paragraph spacing is a single before|after toggle,
    // not numeric before/after values with add/remove + "has space" state.
  });

  it.skip("oo:word/api/api.js#Get text/selected text", () => {
    // TODO(M11): the plain-text half passes (below); the other half selects
    // part of an equation, which needs the math node.
    const e = makeEditor("<p>The quick brown fox jumps over the lazy dog</p>");
    selectInParagraph(e, 0, 4, 9);
    expect(selectedText(e)).toBe("quick");
    expect("math").toBe("implemented");
  });
});
