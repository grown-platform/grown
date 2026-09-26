// Grown-native tests for find & replace (search.ts).
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { docText, makeEditor, selectedText, setCursor } from "./harness";
import { diffChunks, expandReplacement, findMatches, getSearchState } from "../search";

const texts = (e: Editor, q: string, o = {}) =>
  findMatches(e.state.doc, q, o).map((m) => e.state.doc.textBetween(m.from, m.to));

describe("findMatches", () => {
  it("is case-insensitive by default and honours match case", () => {
    const e = makeEditor("<p>Cat cat CAT</p>");
    expect(texts(e, "cat")).toEqual(["Cat", "cat", "CAT"]);
    expect(texts(e, "cat", { caseSensitive: true })).toEqual(["cat"]);
  });

  it("matches whole words only when asked", () => {
    const e = makeEditor("<p>cat concat cats cat.</p>");
    expect(texts(e, "cat")).toHaveLength(4);
    expect(texts(e, "cat", { wholeWord: true })).toEqual(["cat", "cat"]);
  });

  it("supports regular expressions and reports invalid ones as no match", () => {
    const e = makeEditor("<p>a1 b22 c333</p>");
    expect(texts(e, "[a-z]\\d+", { regex: true })).toEqual(["a1", "b22", "c333"]);
    expect(texts(e, "(", { regex: true })).toEqual([]);
    // Regex specials are literal outside regex mode.
    const f = makeEditor("<p>1+1 and 11</p>");
    expect(texts(f, "1+1")).toEqual(["1+1"]);
  });

  it("finds text across runs with different formatting but not across paragraphs", () => {
    const e = makeEditor("<p>Ex<strong>am</strong><em>ple</em></p><p>exam</p><p>ple</p>");
    expect(texts(e, "example")).toEqual(["Example"]);
    expect(texts(e, "exam\nple")).toEqual([]);
  });

  it("finds text in tables and lists", () => {
    const e = makeEditor(
      "<ul><li><p>one needle</p></li></ul><table><tr><td><p>needle</p></td></tr></table>",
    );
    expect(texts(e, "needle")).toHaveLength(2);
  });

  it("expands $1 / $& / $$ in regex replacements", () => {
    const m = /(\w+)@(\w+)/u.exec("joe@site") as RegExpExecArray;
    expect(expandReplacement("$2:$1 [$&] $$", m)).toBe("site:joe [joe@site] $");
    expect(expandReplacement("$1", undefined)).toBe("$1");
  });
});

describe("diffChunks", () => {
  it("keeps common prefix/suffix and aligns words", () => {
    expect(diffChunks("Example Test", "Sample Test")).toEqual([{ a: 0, b: 2, text: "S" }]);
    expect(diffChunks("a b c", "a b c")).toEqual([]);
    expect(diffChunks("one two three", "one 2 three")).toEqual([{ a: 4, b: 7, text: "2" }]);
  });
});

describe("Search extension", () => {
  it("highlights matches and steps through them with next/previous", () => {
    const e = makeEditor("<p>foo bar foo baz foo</p>", { cursor: "start" });
    e.commands.setSearch("foo");
    const s = getSearchState(e.state);
    expect(s.matches).toHaveLength(3);
    expect(e.view.dom.querySelectorAll(".search-match")).toHaveLength(3);
    expect(e.view.dom.querySelectorAll(".search-match-current")).toHaveLength(1);

    e.commands.findNext();
    expect(e.state.selection.from).toBe(s.matches[0].from);
    e.commands.findNext();
    expect(e.state.selection.from).toBe(s.matches[1].from);
    expect(getSearchState(e.state).current).toBe(1);
    e.commands.findPrevious();
    expect(e.state.selection.from).toBe(s.matches[0].from);
    e.commands.findPrevious(); // wraps
    expect(e.state.selection.from).toBe(s.matches[2].from);
    e.commands.findNext(); // wraps
    expect(e.state.selection.from).toBe(s.matches[0].from);

    e.commands.clearSearch();
    expect(e.view.dom.querySelectorAll(".search-match")).toHaveLength(0);
  });

  it("replaces the current match then moves on", () => {
    const e = makeEditor("<p>foo bar foo</p>", { cursor: "start" });
    e.commands.setSearch("foo");
    e.commands.replaceCurrent("qux"); // selects the first match
    expect(selectedText(e)).toBe("foo");
    e.commands.replaceCurrent("qux");
    expect(docText(e)).toBe("qux bar foo");
    expect(selectedText(e)).toBe("foo");
    expect(getSearchState(e.state).matches).toHaveLength(1);
    e.commands.replaceCurrent("qux");
    expect(docText(e)).toBe("qux bar qux");
    expect(getSearchState(e.state).matches).toHaveLength(0);
  });

  it("replaces all matches in one undo step, keeping formatting", () => {
    const e = makeEditor("<p><strong>red</strong> apple, red car</p><p>Red</p>");
    e.commands.setSearch("red");
    expect(getSearchState(e.state).matches).toHaveLength(3);
    expect(e.commands.replaceAllMatches("blue")).toBe(true);
    expect(e.getHTML()).toBe("<p><strong>blue</strong> apple, blue car</p><p>blue</p>");
    e.commands.undo();
    expect(docText(e)).toBe("red apple, red car\nRed");
  });

  it("replaces with regex groups", () => {
    const e = makeEditor("<p>2024-01-31 and 1999-12-01</p>");
    e.commands.setSearch("(\\d{4})-(\\d\\d)-(\\d\\d)", { regex: true });
    e.commands.replaceAllMatches("$3/$2/$1");
    expect(docText(e)).toBe("31/01/2024 and 01/12/1999");
  });

  it("recomputes matches as the document changes", () => {
    const e = makeEditor("<p>abc</p>");
    e.commands.setSearch("abc");
    expect(getSearchState(e.state).matches).toHaveLength(1);
    setCursor(e, 4);
    e.commands.insertContent(" abc");
    expect(getSearchState(e.state).matches).toHaveLength(2);
  });

  it("reports an invalid regular expression", () => {
    const e = makeEditor("<p>abc</p>");
    e.commands.setSearch("[", { regex: true });
    expect(getSearchState(e.state).error).toBeTruthy();
    expect(getSearchState(e.state).matches).toHaveLength(0);
  });
});
