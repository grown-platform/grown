// Grown tests for styles and numbering (M3) beyond the OnlyOffice ports:
// applying styles, next style on Enter, new/update/delete style, list
// keys, restart / continue / set value, Yjs persistence and export.
import { describe, expect, it } from "vitest";
import {
  blockPaths,
  makeEditor,
  makeSyncedEditors,
  numberingText,
  paragraphText,
  pressKey,
  selectAll,
  selectBlocks,
  setCursor,
  textblocks,
  typeText,
} from "./harness";
import {
  applyListPreset,
  applyStyle,
  continueNumbering,
  createStyleFromSelection,
  currentStyle,
  deleteStyle,
  exportBodyHtml,
  getDocModel,
  restartNumbering,
  setNumberingValue,
} from "../docModel";
import { styleCss } from "../styles";
import type { Editor } from "@tiptap/core";

const texts = (e: Editor) => textblocks(e).map((_, i) => numberingText(e, i));
const caretIn = (e: Editor, i: number, end = false) => {
  const b = textblocks(e)[i];
  setCursor(e, end ? b.pos + b.node.content.size : b.pos);
};

describe("styles", () => {
  it("existing headings map to the Heading styles and back", () => {
    const e = makeEditor("<h2>Heading</h2><p>Body</p>");
    caretIn(e, 0);
    expect(currentStyle(e)?.name).toBe("Heading 2");
    caretIn(e, 1);
    expect(currentStyle(e)?.name).toBe("Normal");
    applyStyle(e, "Heading3");
    expect(blockPaths(e)).toEqual(["heading2", "heading3"]);
    applyStyle(e, "Title");
    expect(blockPaths(e)).toEqual(["heading2", "paragraph"]);
    expect(e.getHTML()).toContain('<p data-style="Title">Body</p>');
    expect(currentStyle(e)?.name).toBe("Title");
    // Ctrl+Alt+2 still makes a heading, and toggles back to Normal.
    pressKey(e, "Mod-Alt-2");
    expect(blockPaths(e)).toEqual(["heading2", "heading2"]);
    expect(textblocks(e)[1].node.attrs.styleId).toBe(null);
    pressKey(e, "Mod-Alt-2");
    expect(blockPaths(e)).toEqual(["heading2", "paragraph"]);
  });

  it("Enter at the end of a Title or heading continues with Normal", () => {
    const e = makeEditor("<p>Doc title</p>");
    applyStyle(e, "Title");
    caretIn(e, 0, true);
    pressKey(e, "Enter");
    typeText(e, "Body");
    expect(currentStyle(e)?.id).toBe("Normal");
    expect(textblocks(e)[0].node.attrs.styleId).toBe("Title");
    applyStyle(e, "Heading1");
    caretIn(e, 1, true);
    pressKey(e, "Enter");
    expect(currentStyle(e)?.id).toBe("Normal");
  });

  it("new style from selection, update, delete", () => {
    const e = makeEditor("<p><strong>Callout</strong></p><p>Other</p>");
    caretIn(e, 0, true);
    e.commands.setParagraphProps({ indLeft: 24, shading: "#eeeeee" });
    const s = createStyleFromSelection(e, "Callout box")!;
    expect(s.id).toBe("Calloutbox");
    expect(s.pPr).toMatchObject({ indLeft: 24, shading: "#eeeeee" });
    expect(s.rPr).toMatchObject({ bold: true });
    // Direct props moved into the style.
    expect(textblocks(e)[0].node.attrs.indent).toBe(null);
    expect(currentStyle(e)?.name).toBe("Callout box");
    // Duplicate names are refused.
    expect(createStyleFromSelection(e, "callout box")).toBe(null);

    caretIn(e, 1);
    applyStyle(e, s.id);
    expect(textblocks(e)[1].node.attrs.styleId).toBe(s.id);
    const css = styleCss(getDocModel(e).sheet, ".x");
    expect(css).toContain('[data-style="Calloutbox"] { margin-left: 24pt');

    deleteStyle(e, s.id);
    expect(getDocModel(e).sheet.get(s.id)).toBeUndefined();
    expect(textblocks(e).map((b) => b.node.attrs.styleId)).toEqual([null, null]);
    // Built-ins cannot be deleted; deleting restores their defaults.
    deleteStyle(e, "Title");
    expect(getDocModel(e).sheet.get("Title")).toBeTruthy();
  });

  it("character styles apply as a mark", () => {
    const e = makeEditor("<p>Some strong text</p>");
    selectBlocks(e, 0, 0);
    applyStyle(e, "Strong");
    expect(e.getHTML()).toContain('<span data-cstyle="Strong">Some strong text</span>');
    expect(currentStyle(e)?.name).toBe("Strong");
  });

  it("styles and numbering persist through Yjs", () => {
    const { editors, sync } = makeSyncedEditors(2);
    const [a, b] = editors;
    typeText(a, "Report");
    applyStyle(a, "Title");
    pressKey(a, "Enter");
    typeText(a, "First");
    applyListPreset(a, "num-decimal-dot");
    pressKey(a, "Enter");
    typeText(a, "Second");
    getDocModel(a).sheet.put({ ...getDocModel(a).sheet.get("Title")!, rPr: { fontSize: 30 } });
    sync();
    expect(textblocks(b)[0].node.attrs.styleId).toBe("Title");
    expect(texts(b)).toEqual(["", "1.", "2."]);
    expect(getDocModel(b).sheet.get("Title")!.rPr).toEqual({ fontSize: 30 });
  });
});

describe("numbering", () => {
  it("Enter continues the list, Enter on an empty item ends it; Tab changes level", () => {
    const e = makeEditor("<p>One</p>");
    applyListPreset(e, "ml-outline");
    caretIn(e, 0, true);
    pressKey(e, "Enter");
    typeText(e, "Two");
    pressKey(e, "Enter");
    caretIn(e, 2);
    expect(pressKey(e, "Tab")).toBe(true);
    typeText(e, "Two-a");
    expect(texts(e)).toEqual(["1.", "2.", "a."]);
    pressKey(e, "Shift-Tab");
    expect(texts(e)).toEqual(["1.", "2.", "3."]);
    pressKey(e, "Enter");
    pressKey(e, "Enter");
    expect(texts(e)).toEqual(["1.", "2.", "3.", ""]);
    // Backspace at the start of a numbered paragraph removes the number.
    caretIn(e, 2);
    pressKey(e, "Backspace");
    expect(texts(e)).toEqual(["1.", "2.", "", ""]);
    expect(paragraphText(e, 2)).toBe("Two-a");
  });

  it("restart, set value, continue", () => {
    const e = makeEditor("<p>a</p><p>b</p><p>c</p><p>d</p>");
    selectAll(e);
    applyListPreset(e, "num-decimal-dot");
    expect(texts(e)).toEqual(["1.", "2.", "3.", "4."]);
    caretIn(e, 2);
    restartNumbering(e);
    expect(texts(e)).toEqual(["1.", "2.", "1.", "2."]);
    setNumberingValue(e, 7);
    expect(texts(e)).toEqual(["1.", "2.", "7.", "8."]);
    continueNumbering(e);
    expect(texts(e)).toEqual(["1.", "2.", "3.", "4."]);
  });

  it("a caret after a list continues it when applying the same format", () => {
    const e = makeEditor("<p>a</p><p>b</p>");
    caretIn(e, 0);
    applyListPreset(e, "num-upper-roman");
    caretIn(e, 1);
    applyListPreset(e, "num-upper-roman");
    expect(texts(e)).toEqual(["I.", "II."]);
  });

  it("export writes labels and styles as plain HTML", () => {
    const e = makeEditor("<p>Report</p><p>First</p><p>Second</p>");
    caretIn(e, 0);
    applyStyle(e, "Title");
    selectBlocks(e, 1, 2);
    applyListPreset(e, "num-decimal-paren");
    const html = exportBodyHtml(e);
    expect(html).toContain('<div data-custom-style="Title"><p data-style="Title" style="');
    expect(html).toContain("font-size: 26pt");
    expect(html).toMatch(/<span class="list-label">1\) <\/span>First/);
    expect(html).toMatch(/<span class="list-label">2\) <\/span>Second/);
  });
});
