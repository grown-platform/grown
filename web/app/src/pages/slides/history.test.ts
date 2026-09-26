import { describe, it, expect } from "vitest";
import {
  HISTORY_COALESCE_MS,
  HISTORY_LIMIT,
  emptyHistory,
  recordHistory,
  redoHistory,
  undoHistory,
  type History,
} from "./history";
import { upsertElement } from "./deckOps";
import type { DeckDoc, SlideElement } from "./model";

function docWithText(text: string): DeckDoc {
  const box: SlideElement = { id: "t", type: "text", x: 0, y: 0, w: 100, h: 40, text };
  return { slides: [{ id: "s", background: "#fff", elements: [box] }] };
}
const textOf = (d: DeckDoc) => d.slides[0].elements[0].text;

// Simulates the editor: snapshot the current doc, then apply the edit.
function edit(h: History, cur: DeckDoc, next: DeckDoc, now: number) {
  return { h: recordHistory(h, cur, now), doc: next };
}

describe("recordHistory", () => {
  it("records a snapshot and clears redo", () => {
    const h0: History = { past: [], future: ["x"], t: 0 };
    const h = recordHistory(h0, docWithText("a"), 1000);
    expect(h.past).toEqual([JSON.stringify(docWithText("a"))]);
    expect(h.future).toEqual([]);
    expect(h.t).toBe(1000);
    expect(h0.past).toEqual([]); // input untouched
  });

  it("coalesces edits within the window", () => {
    let h = recordHistory(emptyHistory(), docWithText("a"), 1000);
    h = recordHistory(h, docWithText("ab"), 1000 + HISTORY_COALESCE_MS);
    expect(h.past).toHaveLength(1);
    h = recordHistory(h, docWithText("abc"), 1000 + HISTORY_COALESCE_MS + 1);
    expect(h.past).toHaveLength(2);
  });

  it("caps the stack, dropping the oldest", () => {
    let h = emptyHistory();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++)
      h = recordHistory(h, docWithText(String(i)), (i + 1) * 1000);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(JSON.parse(h.past[0])).toEqual(docWithText("5"));
  });

  it("still advances the clock when there is no doc yet", () => {
    const h = recordHistory(emptyHistory(), null, 5000);
    expect(h.past).toEqual([]);
    expect(h.t).toBe(5000);
  });
});

describe("undo/redo", () => {
  it("returns null when there is nothing to undo or redo", () => {
    expect(undoHistory(emptyHistory(), docWithText(""))).toBeNull();
    expect(redoHistory(emptyHistory(), docWithText(""))).toBeNull();
    const h = recordHistory(emptyHistory(), docWithText(""), 1000);
    expect(undoHistory(h, null)).toBeNull();
  });

  it("walks back and forward through several steps", () => {
    let h = emptyHistory();
    let doc = docWithText("a");
    ({ h, doc } = edit(h, doc, docWithText("ab"), 1000));
    ({ h, doc } = edit(h, doc, docWithText("abc"), 2000));

    let r = undoHistory(h, doc)!;
    expect(textOf(r.doc)).toBe("ab");
    r = undoHistory(r.history, r.doc)!;
    expect(textOf(r.doc)).toBe("a");
    expect(undoHistory(r.history, r.doc)).toBeNull();

    r = redoHistory(r.history, r.doc)!;
    expect(textOf(r.doc)).toBe("ab");
    r = redoHistory(r.history, r.doc)!;
    expect(textOf(r.doc)).toBe("abc");
    expect(redoHistory(r.history, r.doc)).toBeNull();
  });

  it("a new edit after undo discards the redo branch", () => {
    let h = emptyHistory();
    let doc = docWithText("a");
    ({ h, doc } = edit(h, doc, docWithText("ab"), 1000));
    const u = undoHistory(h, doc)!;
    const e = edit(u.history, u.doc, docWithText("aX"), 3000);
    expect(redoHistory(e.h, e.doc)).toBeNull();
  });
});

describe("OnlyOffice parity", () => {
  // Typing "8888" into an empty text box, then Undo → "", Redo → "8888".
  // Grown commits the text box edit as one element upsert (history recorded
  // first); Undo/Redo are in the Edit menu and bound to Ctrl/Cmd+Z and
  // Ctrl/Cmd+Y / Ctrl/Cmd+Shift+Z on the canvas (keymap.ts).
  it("oo:slide/shortcuts/shortcuts.js#Check undo/redo", () => {
    const empty = docWithText("");
    const h = recordHistory(emptyHistory(), empty, 1000);
    const typed: DeckDoc = {
      slides: [upsertElement(empty.slides[0], { ...empty.slides[0].elements[0], text: "8888" })],
    };
    expect(textOf(typed)).toBe("8888");
    const undone = undoHistory(h, typed)!;
    expect(textOf(undone.doc)).toBe("");
    const redone = redoHistory(undone.history, undone.doc)!;
    expect(textOf(redone.doc)).toBe("8888");
  });
});
