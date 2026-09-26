// Self-tests for the headless Docs harness (not OnlyOffice ports).
import { describe, expect, it } from "vitest";
import {
  blockPaths,
  docText,
  htmlSnapshot,
  jsonSnapshot,
  makeEditor,
  marksAt,
  paragraphText,
  paragraphTexts,
  pressKey,
  selectedText,
  selectInParagraph,
  selectText,
  typeText,
} from "./harness";
import { parseChord } from "./keys";
import { MockMeasurer } from "./measurer";

describe("docs harness", () => {
  it("builds the app extension set without Yjs", () => {
    const e = makeEditor("<p>Hello</p>");
    const names = e.extensionManager.extensions.map((x) => x.name);
    expect(names).toContain("suggesting");
    expect(names).toContain("footnote");
    expect(names).toContain("history");
    expect(names).not.toContain("collaboration");
    expect(names).not.toContain("collaborationCursor");
  });

  it("loads HTML and reads paragraphs", () => {
    const e = makeEditor("<h1>Title</h1><p>One</p><ul><li><p>Two</p></li></ul>");
    expect(paragraphTexts(e)).toEqual(["Title", "One", "Two"]);
    expect(blockPaths(e)).toEqual([
      "heading1",
      "paragraph",
      "bulletList>listItem>paragraph",
    ]);
    expect(docText(e)).toBe("Title\nOne\nTwo");
  });

  it("types text at the caret and splits on newline", () => {
    const e = makeEditor("<p>Hello</p>");
    typeText(e, " world\nNext");
    expect(paragraphTexts(e)).toEqual(["Hello world", "Next"]);
  });

  it("runs input rules through typeText", () => {
    const e = makeEditor("<p></p>");
    typeText(e, "# Heading");
    expect(blockPaths(e)).toEqual(["heading1"]);
    expect(paragraphText(e, 0)).toBe("Heading");
  });

  it("selects by text and by paragraph offsets", () => {
    const e = makeEditor("<p>The quick brown fox</p><p>jumps</p>");
    selectText(e, "quick");
    expect(selectedText(e)).toBe("quick");
    selectInParagraph(e, 1, 1, 4);
    expect(selectedText(e)).toBe("ump");
  });

  it("dispatches key chords through the keymap", () => {
    const e = makeEditor("<p>Hello world</p>");
    selectText(e, "world");
    expect(pressKey(e, "Mod-b")).toBe(true);
    expect(marksAt(e, 0, 6)).toEqual(["bold"]);
    expect(marksAt(e, 0, 0)).toEqual([]);
    expect(htmlSnapshot(e)).toBe("<p>Hello <strong>world</strong></p>");
    expect(jsonSnapshot(e).content?.[0].type).toBe("paragraph");
  });

  it("types into Suggesting mode as insertions", () => {
    const e = makeEditor("<p>Hi</p>", { suggesting: true });
    typeText(e, "!");
    expect(paragraphText(e, 0)).toBe("Hi!");
    expect(marksAt(e, 0, 2)).toEqual(["insertion"]);
  });

  it("parses chords like a US-layout browser", () => {
    expect(parseChord("Mod-Shift-s")).toMatchObject({
      key: "S",
      keyCode: 83,
      ctrlKey: true,
      shiftKey: true,
    });
    expect(parseChord("Mod-Shift-8").key).toBe("*");
    expect(parseChord("Mod-.").code).toBe("Period");
    expect(parseChord("Shift-Enter")).toMatchObject({ key: "Enter", shiftKey: true });
  });
});

describe("MockMeasurer", () => {
  const m = new MockMeasurer({ charWidth: 10, lineHeight: 20 });
  it("wraps at word boundaries", () => {
    expect(m.textWidth("abcd")).toBe(40);
    expect(m.lineCount("", 100)).toBe(1);
    expect(m.lineCount("aaaa bbbb", 100)).toBe(1);
    expect(m.lineCount("aaaa bbbb cccc", 100)).toBe(2);
    expect(m.lineCount("a\nb", 100)).toBe(2);
    expect(m.lineCount("x".repeat(25), 100)).toBe(3);
    expect(m.paragraphHeight("aaaa bbbb cccc", 100)).toBe(40);
  });
});
