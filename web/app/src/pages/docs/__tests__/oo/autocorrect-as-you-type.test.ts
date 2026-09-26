// Ports of OnlyOffice's "as you type" autocorrect tests (behaviour only):
// word/text-autocorrection/as-you-type.js. OnlyOffice enters the text
// without triggering corrections and then presses Space; the ports do the
// same (addText, then a typed space), so only the last word is judged.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { makeEditor, paragraphText, setCursor, textblocks, typeText } from "../harness";
import { addText } from "../../textOps";
import type { AutoCorrectSettings } from "../../autocorrect";

function enterAndSpace(e: Editor, index: number, text: string): string {
  const b = textblocks(e)[index];
  // Clear the paragraph, put the caret in it, enter the text, press Space.
  e.view.dispatch(e.state.tr.delete(b.pos, b.pos + b.node.content.size));
  setCursor(e, textblocks(e)[index].pos);
  addText(e, text);
  typeText(e, " ");
  return paragraphText(e, index);
}

const set = (e: Editor, s: Partial<AutoCorrectSettings>) => e.commands.setAutoCorrect(s);

describe("OnlyOffice as-you-type autocorrect", () => {
  it("oo:word/text-autocorrection/as-you-type.js#Test: capitalize first letter of the sentence", () => {
    const e = makeEditor("<p></p>");
    set(e, { capitalizeSentences: true });
    expect(enterAndSpace(e, 0, "hello")).toBe("Hello ");
    expect(enterAndSpace(e, 0, "привет")).toBe("Привет ");
    expect(enterAndSpace(e, 0, "გამარჯობა")).toBe("გამარჯობა "); // Georgian has no capitals in running text
    expect(enterAndSpace(e, 0, "Hello world! hello")).toBe("Hello world! Hello ");
    expect(enterAndSpace(e, 0, "Hello world! hello world")).toBe("Hello world! hello world ");
  });

  it("oo:word/text-autocorrection/as-you-type.js#Test: capitalize first letter of the sentence in table and capitalize first letter of table cell", () => {
    const e = makeEditor(
      "<table><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr>" +
        "<tr><td><p></p></td><td><p></p></td><td><p></p></td></tr>" +
        "<tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></table>",
    );
    const cell = (text: string) => enterAndSpace(e, 0, text);

    set(e, { capitalizeCells: false, capitalizeSentences: false });
    expect(cell("hello")).toBe("hello ");
    expect(cell("привет")).toBe("привет ");
    expect(cell("Hello world! hello")).toBe("Hello world! hello ");
    expect(cell("Hello world! hello world")).toBe("Hello world! hello world ");

    set(e, { capitalizeCells: true, capitalizeSentences: true });
    expect(cell("hello")).toBe("Hello ");
    expect(cell("привет")).toBe("Привет ");
    expect(cell("Hello world! hello")).toBe("Hello world! Hello ");
    expect(cell("Hello world! hello world")).toBe("Hello world! hello world ");

    set(e, { capitalizeCells: false, capitalizeSentences: true });
    expect(cell("hello")).toBe("hello ");
    expect(cell("привет")).toBe("привет ");
    expect(cell("Hello world! hello")).toBe("Hello world! Hello ");
    expect(cell("Hello world! hello world")).toBe("Hello world! hello world ");

    set(e, { capitalizeCells: true, capitalizeSentences: false });
    expect(cell("hello")).toBe("Hello ");
    expect(cell("привет")).toBe("Привет ");
    expect(cell("Hello world! hello")).toBe("Hello world! hello ");
    expect(cell("Hello world! hello world")).toBe("Hello world! hello world ");
  });
});
