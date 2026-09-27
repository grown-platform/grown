// Port of OnlyOffice word/content-control/block-level/cursorAndSelection.js
// (behaviour only): a paragraph between two block-level content controls.
// Backspace at its start / Delete at its end moves the caret into the
// neighbouring control instead of joining; an empty paragraph is removed;
// under track changes the paragraph mark between them is marked deleted.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { makeEditor, paragraphReviewTypes, paragraphTexts, pressKey, setCursor, textblocks } from "../harness";

const cc = (texts: string[]) => `<div data-sdt-pr='{"type":"richText"}'>${texts.map((t) => `<p>${t}</p>`).join("")}</div>`;

function blockIndex(e: Editor, text: string): number {
  return paragraphTexts(e).indexOf(text);
}
/** The caret sits at the end (or start) of the textblock with `text`. */
function caretAt(e: Editor, text: string, end: boolean): boolean {
  const b = textblocks(e)[blockIndex(e, text)];
  if (!b) return false;
  const want = end ? b.pos + b.node.content.size : b.pos;
  return e.state.selection.empty && e.state.selection.from === want;
}
/** The middle paragraph (between the controls), if still there. */
function middle(e: Editor): { node: import("@tiptap/pm/model").Node; pos: number } | null {
  let out: { node: import("@tiptap/pm/model").Node; pos: number } | null = null;
  e.state.doc.forEach((n, pos) => {
    if (n.type.name === "paragraph" && out == null && pos > 0 && n !== e.state.doc.lastChild) out = { node: n, pos };
  });
  return out;
}

describe("OnlyOffice block-level content controls: cursor and selection", () => {
  it("oo:word/content-control/block-level/cursorAndSelection.js#Test remove/delete after/before content control", () => {
    const build = (mid: string, attrs = "") =>
      makeEditor(`${cc(["Text1", "Text2"])}<p${attrs}>${mid}</p>${cc(["Text3", "Text4"])}<p></p>`);
    let e = build("123");
    expect(e.state.doc.childCount).toBe(4);

    setCursor(e, middle(e)!.pos + 1);
    pressKey(e, "Backspace");
    expect(e.state.doc.childCount, "Backspace at the start: nothing joins").toBe(4);
    expect(middle(e)?.node.textContent).toBe("123");
    expect(caretAt(e, "Text2", true), "caret at the end of the first control").toBe(true);

    setCursor(e, middle(e)!.pos + 1 + 3);
    pressKey(e, "Delete");
    expect(e.state.doc.childCount).toBe(4);
    expect(middle(e)?.node.textContent).toBe("123");
    expect(caretAt(e, "Text3", false), "caret at the start of the second control").toBe(true);

    // An empty paragraph between them is removed.
    e = build("");
    setCursor(e, middle(e)!.pos + 1);
    pressKey(e, "Backspace");
    expect(e.state.doc.childCount).toBe(3);
    expect(caretAt(e, "Text2", true)).toBe(true);

    e = build("");
    setCursor(e, middle(e)!.pos + 1);
    pressKey(e, "Delete");
    expect(e.state.doc.childCount).toBe(3);
    expect(caretAt(e, "Text3", false)).toBe(true);

    // With track changes on.
    e = build("");
    e.commands.setSuggesting(true);
    setCursor(e, middle(e)!.pos + 1);
    pressKey(e, "Backspace");
    expect(e.state.doc.childCount, "tracked Backspace keeps the paragraph").toBe(4);
    expect(middle(e)).not.toBeNull();
    expect(caretAt(e, "Text2", true)).toBe(true);
    expect(paragraphReviewTypes(e)[blockIndex(e, "Text2")], "the first control's last paragraph mark is deleted").toBe("remove");

    setCursor(e, middle(e)!.pos + 1);
    pressKey(e, "Delete");
    expect(e.state.doc.childCount).toBe(4);
    expect(caretAt(e, "Text3", false)).toBe(true);
    const midIndex = textblocks(e).findIndex((b) => b.pos === middle(e)!.pos + 1);
    expect(paragraphReviewTypes(e)[midIndex], "the middle paragraph mark is deleted").toBe("remove");

    // A paragraph added under review (by this user) goes outright.
    const added = JSON.stringify({ type: "insert", id: "p1", author: "Test user", date: "2026-01-01T00:00:00Z" }).replace(/"/g, "&quot;");
    e = build("", ` data-para-change="${added}"`);
    e.commands.setSuggesting(true);
    expect(paragraphReviewTypes(e)[2]).toBe("add");
    setCursor(e, middle(e)!.pos + 1);
    pressKey(e, "Delete");
    expect(e.state.doc.childCount).toBe(3);
    expect(caretAt(e, "Text3", false)).toBe(true);
  });
});
