// Track changes v2 (M5), Grown-native cases: change ids and dates, grouped
// changes, formatting and paragraph-property changes, paragraph marks,
// accept/reject by change, navigation and collaboration.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import {
  makeEditor,
  makeSyncedEditors,
  paragraphPos,
  paragraphReviewTypes,
  paragraphTexts,
  pressKey,
  reviewHtml,
  reviewText,
  selectInParagraph,
  selectText,
  setCursor,
  textblocks,
  typeText,
} from "./harness";
import { collectChanges, describeChange, parsePropsChange, setReviewClock } from "../changes";
import * as Y from "yjs";
import { Editor as TiptapEditor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { marginExtensions } from "../margin";
import { Suggesting } from "../suggesting";
import { effectiveTracking, getTrackAll, governingEveryone, onTrackAll, setTrackAll } from "../review";

const DATE = "2026-09-26T10:00:00Z";

beforeEach(() => setReviewClock(() => new Date(DATE)));
afterEach(() => setReviewClock(null));

function marksOf(e: Editor, name: string) {
  const out: Record<string, unknown>[] = [];
  e.state.doc.descendants((n) => {
    for (const m of n.marks) if (m.type.name === name) out.push(m.attrs);
  });
  return out;
}

describe("track changes: records", () => {
  it("gives insertions and deletions an id, author and date", () => {
    const e = makeEditor("<p>Hello world</p>", { suggesting: true });
    typeText(e, "!");
    selectText(e, "world");
    pressKey(e, "Backspace");
    const ins = marksOf(e, "insertion");
    const del = marksOf(e, "deletion");
    expect(ins[0]).toMatchObject({ author: "Test user", date: DATE });
    expect(del[0]).toMatchObject({ author: "Test user", date: DATE });
    expect(ins[0].id).toMatch(/\w{6,}/);
    expect(del[0].id).toMatch(/\w{6,}/);
    expect(ins[0].id).not.toBe(del[0].id);
  });

  it("continues one insertion while typing and one deletion while deleting", () => {
    const e = makeEditor("<p>abcdef</p>", { suggesting: true });
    typeText(e, "XYZ");
    setCursor(e, paragraphPos(e, 0, 6));
    pressKey(e, "Backspace");
    pressKey(e, "Backspace");
    pressKey(e, "Backspace");
    const changes = collectChanges(e.state.doc);
    expect(changes.map((c) => [c.kind, c.inserted, c.deleted])).toEqual([
      ["delete", "", "def"],
      ["insert", "XYZ", ""],
    ]);
    // Backspace skips text that is already deleted.
    expect(reviewText(e)).toEqual([["common", "abc"], ["remove", "def"], ["add", "XYZ"]]);
    pressKey(e, "Backspace");
    expect(reviewText(e)).toEqual([["common", "ab"], ["remove", "cdef"], ["add", "XYZ"]]);
  });

  it("groups typing over a selection as one replace change", () => {
    const e = makeEditor("<p>The cat sat</p>", { suggesting: true });
    selectText(e, "cat");
    typeText(e, "dog");
    const [c] = collectChanges(e.state.doc);
    expect(c.kind).toBe("replace");
    expect(describeChange(c)).toBe('Replaced: "cat" with "dog"');
    expect(reviewText(e)).toEqual([["common", "The "], ["add", "dog"], ["remove", "cat"], ["common", " sat"]]);
    e.commands.rejectChange(c.id);
    expect(paragraphTexts(e)).toEqual(["The cat sat"]);
    expect(collectChanges(e.state.doc)).toEqual([]);
  });

  it("keeps someone else's insertion as a deletion, removes your own", () => {
    const e = makeEditor(`<p>${reviewHtml([{ text: "mine", type: "add" }, { text: "theirs", type: "add", author: "Bob" }])}</p>`, {
      suggesting: true,
    });
    selectInParagraph(e, 0, 2, 7);
    pressKey(e, "Delete");
    expect(paragraphTexts(e)).toEqual(["mitheirs"]);
    expect(reviewText(e)).toEqual([["add", "mi"], ["remove", "the"], ["add", "irs"]]);
    // Rejecting the deletion brings back Bob's insertion.
    const del = collectChanges(e.state.doc).find((c) => c.kind === "delete")!;
    e.commands.rejectChange(del.id);
    expect(reviewText(e)).toEqual([["add", "mitheirs"]]);
  });

  it("types plain text next to an insertion when tracking is off", () => {
    const e = makeEditor(`<p>${reviewHtml([{ text: "new", type: "add", author: "Bob" }])}</p>`);
    typeText(e, "er");
    expect(reviewText(e)).toEqual([["add", "new"], ["common", "er"]]);
  });

  it("types an insertion (not a deletion) inside deleted text", () => {
    const e = makeEditor(`<p>${reviewHtml([{ text: "gone", type: "remove", author: "Bob" }])}</p>`, { suggesting: true });
    setCursor(e, paragraphPos(e, 0, 2));
    typeText(e, "X");
    expect(reviewText(e)).toEqual([["remove", "go"], ["add", "X"], ["remove", "ne"]]);
  });
});

describe("track changes: formatting", () => {
  it("records the old formatting, rejects back to it and accepts", () => {
    const e = makeEditor("<p>Hello <em>world</em></p>", { suggesting: true });
    selectText(e, "lo wor");
    e.commands.toggleBold();
    const fc = marksOf(e, "formatChange");
    expect(fc.length).toBe(2);
    expect(JSON.parse(String(fc[0].old))).toEqual([]);
    expect(JSON.parse(String(fc[1].old))).toEqual([{ type: "italic" }]);
    const [c] = collectChanges(e.state.doc);
    expect(c.kind).toBe("format");
    expect(describeChange(c)).toBe('Formatted: "lo wor"');
    e.commands.rejectChange(c.id);
    expect(e.getHTML()).toBe("<p>Hello <em>world</em></p>");

    selectText(e, "Hello");
    e.commands.toggleUnderline();
    e.commands.acceptAllSuggestions();
    expect(e.getHTML()).toBe("<p><u>Hello</u> <em>world</em></p>");
  });

  it("drops the record when the formatting is changed back", () => {
    const e = makeEditor("<p>Hello</p>", { suggesting: true });
    selectText(e, "Hello");
    e.commands.toggleBold();
    expect(marksOf(e, "formatChange").length).toBe(1);
    e.commands.toggleBold();
    expect(marksOf(e, "formatChange").length).toBe(0);
  });

  it("does not track formatting of your own insertion", () => {
    const e = makeEditor("<p></p>", { suggesting: true });
    typeText(e, "new");
    selectText(e, "new");
    e.commands.toggleBold();
    expect(marksOf(e, "formatChange")).toEqual([]);
    expect(marksOf(e, "bold").length).toBe(1);
  });
});

describe("track changes: paragraphs", () => {
  it("tracks paragraph property changes and rejects them back", () => {
    const e = makeEditor("<p>Title</p><p>Body</p>", { suggesting: true });
    setCursor(e, paragraphPos(e, 0, 2));
    e.commands.setTextAlign("center");
    e.commands.toggleHeading({ level: 1 });
    const pc = parsePropsChange(textblocks(e)[0].node.attrs.propsChange);
    expect(pc).toMatchObject({ type: "paragraph", author: "Test user", date: DATE });
    expect(pc!.attrs.textAlign).toBeUndefined();
    const [c] = collectChanges(e.state.doc);
    expect(c.kind).toBe("paragraph");
    e.commands.rejectCurrentChange();
    expect(e.getHTML()).toBe("<p>Title</p><p>Body</p>");
  });

  it("marks a joined paragraph mark deleted; accept merges, reject keeps", () => {
    const e = makeEditor("<p>One</p><p>Two</p>", { suggesting: true });
    setCursor(e, paragraphPos(e, 1, 0));
    pressKey(e, "Backspace");
    expect(paragraphTexts(e)).toEqual(["One", "Two"]);
    expect(paragraphReviewTypes(e)).toEqual(["remove", "common"]);
    expect(describeChange(collectChanges(e.state.doc)[0])).toBe("Merged paragraphs");
    e.commands.acceptAllSuggestions();
    expect(paragraphTexts(e)).toEqual(["OneTwo"]);

    const f = makeEditor("<p>One</p><p>Two</p>", { suggesting: true });
    setCursor(f, paragraphPos(f, 0, 3));
    pressKey(f, "Delete");
    expect(paragraphReviewTypes(f)).toEqual(["remove", "common"]);
    f.commands.rejectAllSuggestions();
    expect(paragraphTexts(f)).toEqual(["One", "Two"]);
    expect(paragraphReviewTypes(f)).toEqual(["common", "common"]);
  });

  it("removes your own inserted paragraph mark outright", () => {
    const e = makeEditor("<p>OneTwo</p>", { suggesting: true });
    setCursor(e, paragraphPos(e, 0, 3));
    pressKey(e, "Enter");
    expect(paragraphReviewTypes(e)).toEqual(["add", "common"]);
    pressKey(e, "Backspace");
    expect(paragraphTexts(e)).toEqual(["OneTwo"]);
    expect(collectChanges(e.state.doc)).toEqual([]);
  });

  it("tracks Enter over a selection as a deletion plus a new paragraph", () => {
    const e = makeEditor("<p>Hello world</p>", { suggesting: true });
    selectText(e, " ");
    pressKey(e, "Enter");
    expect(paragraphTexts(e)).toEqual(["Hello", " world"]);
    expect(paragraphReviewTypes(e)).toEqual(["add", "common"]);
    expect(reviewText(e, 1)).toEqual([["remove", " "], ["common", "world"]]);
  });
});

describe("track changes: review commands", () => {
  it("navigates changes and accepts / rejects the current one", () => {
    const e = makeEditor(
      `<p>${reviewHtml([{ text: "A", type: "add" }, { text: " x " }, { text: "B", type: "remove", author: "Bob" }, { text: " y " }, { text: "C", type: "add" }])}</p>`,
    );
    setCursor(e, paragraphPos(e, 0, 2));
    expect(e.commands.nextChange()).toBe(true);
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("B");
    e.commands.nextChange();
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("C");
    e.commands.nextChange(); // wraps
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("A");
    e.commands.previousChange();
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("C");
    e.commands.rejectCurrentChange();
    e.commands.previousChange();
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("B");
    e.commands.acceptCurrentChange();
    expect(paragraphTexts(e)).toEqual(["A x  y "]);
    expect(collectChanges(e.state.doc).map((c) => c.inserted)).toEqual(["A"]);
  });

  it("reads id-less suggestions from older documents as one change per run", () => {
    const e = makeEditor(`<p>${reviewHtml([{ text: "ab", type: "add" }, { text: " " }, { text: "cd", type: "add" }])}</p>`);
    const changes = collectChanges(e.state.doc);
    expect(changes.map((c) => c.inserted)).toEqual(["ab", "cd"]);
    e.commands.acceptChange(changes[1].id);
    expect(reviewText(e)).toEqual([["add", "ab"], ["common", " cd"]]);
  });

  it("syncs change records through Yjs", () => {
    const { editors, sync } = makeSyncedEditors(2);
    const [a, b] = editors;
    typeText(a, "Hello");
    sync();
    a.commands.setSuggesting(true);
    typeText(a, " there");
    selectText(a, "Hello");
    a.commands.toggleBold();
    setCursor(a, paragraphPos(a, 0, 5));
    pressKey(a, "Enter");
    sync();
    expect(b.getJSON()).toEqual(a.getJSON());
    expect(collectChanges(b.state.doc).map((c) => c.kind).sort()).toEqual(["format", "insert", "insert"]);
    // Remote changes aren't re-tracked by a tracking peer.
    b.commands.setSuggesting(true);
    typeText(a, "!");
    sync();
    expect(b.getJSON()).toEqual(a.getJSON());
  });
});

describe("track changes: find and replace", () => {
  it("tracks replace all as replacements", () => {
    const e = makeEditor("<p>red fish, <strong>red</strong> boat</p>", { suggesting: true });
    e.commands.setSearch("red");
    e.commands.replaceAllMatches("blue");
    expect(reviewText(e)).toEqual([
      ["remove", "red"],
      ["add", "blue"],
      ["common", " fish, "],
      ["remove", "red"],
      ["add", "blue"],
      ["common", " boat"],
    ]);
    expect(collectChanges(e.state.doc).map((c) => c.kind)).toEqual(["replace", "replace"]);
    e.commands.acceptAllSuggestions();
    expect(e.getHTML()).toBe("<p>blue fish, <strong>blue</strong> boat</p>");
  });
});

describe("track changes: settings and header/footer", () => {
  it("resolves for-me / for-everyone / default by recency", () => {
    const ydoc = new Y.Doc();
    expect(getTrackAll(ydoc)).toBeNull();
    expect(effectiveTracking(null, null, false)).toBe(false);
    expect(effectiveTracking(null, null, true)).toBe(true);
    setTrackAll(ydoc, true, 100);
    const all = getTrackAll(ydoc);
    expect(all).toEqual({ on: true, at: 100 });
    expect(effectiveTracking(null, all, false)).toBe(true);
    // A later personal choice wins, until "for everyone" is set again.
    expect(effectiveTracking({ on: false, at: 200 }, all, false)).toBe(false);
    expect(governingEveryone({ on: false, at: 200 }, all)).toBeNull();
    setTrackAll(ydoc, true, 300);
    expect(effectiveTracking({ on: false, at: 200 }, getTrackAll(ydoc), false)).toBe(true);
    expect(governingEveryone({ on: false, at: 200 }, getTrackAll(ydoc))).toBe(true);
    // The setting syncs to other peers.
    const other = new Y.Doc();
    const seen: unknown[] = [];
    onTrackAll(other, (v) => seen.push(v));
    Y.applyUpdate(other, Y.encodeStateAsUpdate(ydoc));
    expect(getTrackAll(other)).toEqual({ on: true, at: 300 });
    expect(seen).toEqual([{ on: true, at: 300 }]);
  });

  it("tracks edits in a header fragment", () => {
    const ydoc = new Y.Doc();
    const element = document.createElement("div");
    document.body.appendChild(element);
    const header = new TiptapEditor({
      element,
      extensions: [
        ...marginExtensions(),
        Suggesting.configure({ user: { name: "Ann", color: "#123456" } }),
        Collaboration.configure({ document: ydoc, field: "header" }),
      ],
    });
    try {
      typeText(header, "Draft");
      header.commands.setSuggesting(true);
      typeText(header, " v2");
      selectText(header, "Draft");
      pressKey(header, "Backspace");
      expect(reviewText(header)).toEqual([["remove", "Draft"], ["add", " v2"]]);
      expect(collectChanges(header.state.doc).map((c) => c.author)).toEqual(["Ann", "Ann"]);
      // The records live in the shared fragment.
      const copy = new Y.Doc();
      Y.applyUpdate(copy, Y.encodeStateAsUpdate(ydoc));
      expect(copy.getXmlFragment("header").toString()).toContain("deletion");
      header.commands.acceptAllSuggestions();
      expect(paragraphTexts(header)).toEqual([" v2"]);
    } finally {
      header.destroy();
      element.remove();
    }
  });
});
