// Port of OnlyOffice's deleted-text recovery tests (behaviour only):
// word/unit-tests/deleted-text-recovery.js. OnlyOffice replays its change
// history and shows the text deleted since a history point as review
// "remove" runs. Grown keeps versions as snapshots, so the same question is
// a version diff (diff/index.ts diffVersions with show: "deleted"): the
// document at the earlier point against the current one, at character
// level, with inserted text shown plainly. "Undo recovered text" is showing
// the current version again, i.e. accepting the recovered deletions.
//
// The history-navigation cases (Going back and forth ×5, Complex 3,
// Complex 4) step backwards and forwards through the collaborative change
// history one point at a time. In Grown that history is the Yjs undo
// manager the editor gets from the Collaboration extension (every live doc
// is Yjs-bound): one history point is one capture group, i.e. the edits
// made without a pause longer than its 500 ms capture timeout. "Prev" is
// Undo and "Next" is Redo; the tests pause (end the capture group, as the
// timeout would) wherever the upstream case starts a new history point.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { yUndoPluginKey } from "y-prosemirror";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { docText, makeEditor, paragraphPos, pressKey, selectInParagraph, setCursor, typeText } from "../harness";
import { diffVersions } from "../../diff";
import { collectParts, resolveParts, reviewRuns, type ReviewType } from "../../changes";

/** recover diffs the document at `before` against the editor's current
 *  document and returns the result's textblocks. */
function recover(editor: Editor, before: PMNode): PMNode[] {
  const d = diffVersions(before, editor.state.doc, { author: "AnonymousUser", show: "deleted" });
  d.check();
  return blocks(d);
}

function blocks(d: PMNode): PMNode[] {
  const out: PMNode[] = [];
  d.descendants((n) => {
    if (n.isTextblock) {
      out.push(n);
      return false;
    }
    return true;
  });
  return out;
}

const runs = (b: PMNode): [ReviewType, string][] => reviewRuns(b);

/** hide is OnlyOffice's UndoRecoveredText: back to the current text. */
function hide(bs: PMNode[]): string[] {
  const doc = bs[0].type.schema.nodes.doc.create(null, bs);
  const tr = EditorState.create({ doc }).tr;
  resolveParts(tr, collectParts(doc), true);
  return blocks(tr.doc).map((b) => b.textContent);
}

/** backspace presses Backspace `n` times. Deleting one character is the
 *  browser's job in a contenteditable (not a keymap command), so a caret
 *  inside text removes the character before it directly; selections and
 *  paragraph starts go through the keymap (deleteSelection / joinBackward). */
function backspace(e: Editor, n: number) {
  for (let i = 0; i < n; i++) {
    const { selection } = e.state;
    if (selection.empty && selection.$from.parentOffset > 0) {
      const at = selection.from;
      const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset);
      const len = Array.from(before).pop()!.length;
      e.view.dispatch(e.state.tr.delete(at - len, at));
    } else pressKey(e, "Backspace");
  }
}

describe("OnlyOffice deleted text recovery (as a version diff)", () => {
  it("oo:word/unit-tests/deleted-text-recovery.js#Delete one letter", () => {
    const e = makeEditor("<p>abc</p>");
    const before = e.state.doc;
    backspace(e, 1);
    expect(e.state.doc.textContent).toBe("ab");
    const [p] = recover(e, before);
    expect(p.textContent).toBe("abc");
    expect(runs(p)).toEqual([["common", "ab"], ["remove", "c"]]);
  });

  it("oo:word/unit-tests/deleted-text-recovery.js#Delete letter block (with selection)", () => {
    const e = makeEditor("<p>Hello World</p>");
    const before = e.state.doc;
    selectInParagraph(e, 0, 5, 11);
    backspace(e, 1);
    expect(e.state.doc.textContent).toBe("Hello");
    const [p] = recover(e, before);
    expect(p.textContent).toBe("Hello World");
    expect(runs(p)).toEqual([["common", "Hello"], ["remove", " World"]]);
  });

  it("oo:word/unit-tests/deleted-text-recovery.js#Delete many letter as one block", () => {
    const e = makeEditor("<p>Hello World</p>");
    const before = e.state.doc;
    setCursor(e, paragraphPos(e, 0, 5));
    backspace(e, 4);
    expect(e.state.doc.textContent).toBe("H World");
    const [p] = recover(e, before);
    expect(p.textContent).toBe("Hello World");
    expect(runs(p)).toEqual([["common", "H"], ["remove", "ello"], ["common", " World"]]);
  });

  it("oo:word/unit-tests/deleted-text-recovery.js#Delete letter blocks (from left to right)", () => {
    const e = makeEditor("<p>Hello World</p>");
    const before = e.state.doc;
    setCursor(e, paragraphPos(e, 0, 3));
    backspace(e, 2);
    expect(e.state.doc.textContent).toBe("Hlo World");
    setCursor(e, paragraphPos(e, 0, 7));
    backspace(e, 2);
    expect(e.state.doc.textContent).toBe("Hlo Wld");
    const [p] = recover(e, before);
    expect(p.textContent).toBe("Hello World");
    expect(runs(p)).toEqual([["common", "H"], ["remove", "el"], ["common", "lo W"], ["remove", "or"], ["common", "ld"]]);
  });

  it("oo:word/unit-tests/deleted-text-recovery.js#Delete letter blocks (from right to left)", () => {
    const e = makeEditor("<p>Hello World</p>");
    const before = e.state.doc;
    selectInParagraph(e, 0, 7, 9);
    backspace(e, 1);
    expect(e.state.doc.textContent).toBe("Hello Wld");
    selectInParagraph(e, 0, 1, 3);
    backspace(e, 1);
    expect(e.state.doc.textContent).toBe("Hlo Wld");
    const [p] = recover(e, before);
    expect(runs(p)).toEqual([["common", "H"], ["remove", "el"], ["common", "lo W"], ["remove", "or"], ["common", "ld"]]);
  });

  it("oo:word/unit-tests/deleted-text-recovery.js#Delete paragraph", () => {
    const e = makeEditor("<p>One</p><p>Two</p>");
    const before = e.state.doc;
    backspace(e, 4);
    expect(e.state.doc.childCount).toBe(1);
    const [p1, p2] = recover(e, before);
    expect(p2.textContent).toBe("Two");
    expect(runs(p1)).toEqual([["common", "One"]]);
    expect(runs(p2)).toEqual([["remove", "Two"]]);
    expect(hide([p1, p2])).toEqual(["One"]);
  });

  it("oo:word/unit-tests/deleted-text-recovery.js#Complex 1", () => {
    const e = makeEditor("<p></p>");
    typeText(e, "Hello hello");
    pressKey(e, "Enter");
    typeText(e, "Hello world 123");
    const before = e.state.doc;
    selectInParagraph(e, 1, 6, 12);
    backspace(e, 1);
    expect(e.state.doc.child(0).textContent).toBe("Hello hello");
    expect(e.state.doc.child(1).textContent).toBe("Hello 123");
    const [p1, p2] = recover(e, before);
    expect(p1.textContent).toBe("Hello hello");
    expect(p2.textContent).toBe("Hello world 123");
    expect(runs(p2)).toEqual([["common", "Hello "], ["remove", "world "], ["common", "123"]]);
    // Undo show deleted text.
    expect(hide([p1, p2])).toEqual(["Hello hello", "Hello 123"]);
  });

  it("oo:word/unit-tests/deleted-text-recovery.js#Complex 2", () => {
    const e = makeEditor("<p></p>");
    typeText(e, "Hello hello");
    const before = e.state.doc;
    setCursor(e, paragraphPos(e, 0, 9));
    backspace(e, 3);
    expect(e.state.doc.textContent).toBe("Hello lo");
    const [p] = recover(e, before);
    expect(p.textContent).toBe("Hello hello");
    expect(runs(p)).toEqual([["common", "Hello "], ["remove", "hel"], ["common", "lo"]]);
    expect(hide([p])).toEqual(["Hello lo"]);
  });

  it("oo:word/unit-tests/deleted-text-recovery.js#Split run", () => {
    const e = makeEditor("<p></p>");
    typeText(e, "Hello how are you");
    selectInParagraph(e, 0, 3, 11);
    e.commands.toggleBold();
    const before = e.state.doc;
    selectInParagraph(e, 0, 5, 9);
    backspace(e, 1);
    expect(e.state.doc.textContent).toBe("Hello are you");
    const [p] = recover(e, before);
    // grown-variant: a snapshot diff can't tell " how" (what was selected)
    // from "how " (the same characters one place later); like
    // diff-match-patch it recovers the later one. Same text, same runs.
    expect(runs(p)).toEqual([["common", "Hello "], ["remove", "how "], ["common", "are you"]]);
    // The bold run is split around the recovered text and keeps its formatting.
    const pieces: [string, boolean][] = [];
    p.forEach((n) => pieces.push([n.text ?? "", n.marks.some((m) => m.type.name === "bold")]));
    expect(pieces).toEqual([
      ["Hel", false],
      ["lo ", true],
      ["how ", true],
      ["a", true],
      ["re you", false],
    ]);
  });

  it("oo:word/unit-tests/deleted-text-recovery.js#Check is not show del text in context of one revision", () => {
    const e = makeEditor("<p></p>");
    const before = e.state.doc;
    typeText(e, "Hello");
    backspace(e, 5);
    typeText(e, "World");
    expect(e.state.doc.textContent).toBe("World");
    const [p] = recover(e, before);
    expect(p.textContent).toBe("World");
    expect(runs(p)).toEqual([["common", "World"]]);
  });
});

/** yEditor is an editor bound to a fresh Yjs document, as in the app, so
 *  history is Yjs's (capture groups), with `html` as the first point. */
function yEditor(html: string): Editor {
  const e = makeEditor("<p></p>", { ydoc: new Y.Doc() });
  if (html) {
    e.commands.setContent(html);
    pause(e);
    e.commands.focus("end");
  }
  return e;
}

/** pause waits longer than the undo manager's capture timeout, so the next
 *  edit starts a new history point. */
function pause(e: Editor) {
  yUndoPluginKey.getState(e.state)!.undoManager.stopCapturing();
}

const prev = (e: Editor, n = 1) => {
  for (let i = 0; i < n; i++) expect(e.commands.undo()).toBe(true);
};
const next = (e: Editor, n = 1) => {
  for (let i = 0; i < n; i++) expect(e.commands.redo()).toBe(true);
};

describe("OnlyOffice deleted text recovery: going through history points", () => {
  it("oo:word/unit-tests/deleted-text-recovery.js#Going back and forth through history - one letter", () => {
    const e = yEditor("<p>abc</p>");
    backspace(e, 1);
    expect(docText(e)).toBe("ab");
    prev(e);
    expect(docText(e)).toBe("abc");
    next(e);
    expect(docText(e)).toBe("ab");
  });

  it("oo:word/unit-tests/deleted-text-recovery.js#Going back and forth through history - letter block", () => {
    const e = yEditor("<p>Hello World</p>");
    backspace(e, 6);
    expect(docText(e)).toBe("Hello");
    prev(e);
    expect(docText(e)).toBe("Hello World");
    next(e);
    expect(docText(e)).toBe("Hello");
  });

  it("oo:word/unit-tests/deleted-text-recovery.js#Going back and forth through history - letter blocks (deleted from left to right)", () => {
    const e = yEditor("<p>Hello World</p>");
    setCursor(e, paragraphPos(e, 0, 3));
    backspace(e, 2);
    expect(docText(e)).toBe("Hlo World");
    setCursor(e, paragraphPos(e, 0, 7));
    backspace(e, 2);
    expect(docText(e)).toBe("Hlo Wld");
    // Both deletions were made without a pause: one history point.
    prev(e);
    expect(docText(e)).toBe("Hello World");
    next(e);
    expect(docText(e)).toBe("Hlo Wld");
  });

  it("oo:word/unit-tests/deleted-text-recovery.js#Going back and forth through history - letter blocks (from right to left)", () => {
    const e = yEditor("<p>Hello World</p>");
    selectInParagraph(e, 0, 7, 9);
    backspace(e, 1);
    expect(docText(e)).toBe("Hello Wld");
    selectInParagraph(e, 0, 1, 3);
    backspace(e, 1);
    expect(docText(e)).toBe("Hlo Wld");
    prev(e);
    expect(docText(e)).toBe("Hello World");
    next(e);
    expect(docText(e)).toBe("Hlo Wld");
  });

  it("oo:word/unit-tests/deleted-text-recovery.js#Going back and forth through history - paragraph", () => {
    const e = yEditor("<p>One</p>");
    backspace(e, 5);
    expect(docText(e)).toBe("");
    prev(e);
    expect(docText(e)).toBe("One");
    next(e);
    expect(docText(e)).toBe("");
  });

  it("oo:word/unit-tests/deleted-text-recovery.js#Complex 3", () => {
    const e = yEditor("");
    typeText(e, "Hello");
    pause(e);
    typeText(e, " hello");
    expect(docText(e)).toBe("Hello hello");
    prev(e);
    expect(docText(e)).toBe("Hello");
  });

  it("oo:word/unit-tests/deleted-text-recovery.js#Complex 4", () => {
    const e = yEditor("");
    // Points: "Hello3" | delete "3" | " word" | delete "word"+space | " world".
    typeText(e, "Hello3");
    pause(e);
    backspace(e, 1);
    pause(e);
    typeText(e, " word");
    pause(e);
    backspace(e, 5);
    pause(e);
    typeText(e, " world");
    expect(docText(e)).toBe("Hello world");
    prev(e);
    expect(docText(e)).toBe("Hello");
    prev(e);
    expect(docText(e)).toBe("Hello word");
    prev(e, 2);
    expect(docText(e)).toBe("Hello3");
    next(e, 3);
    expect(docText(e)).toBe("Hello");
    prev(e);
    expect(docText(e)).toBe("Hello word");
  });
});
