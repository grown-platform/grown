// Grown-native tests for as-you-type AutoCorrect (autocorrect.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { docText, makeEditor, marksAt, paragraphText, pressKey, typeText } from "./harness";
import {
  DEFAULT_AUTOCORRECT,
  loadAutoCorrect,
  saveAutoCorrect,
  smartQuote,
  wordEndEdits,
} from "../autocorrect";

const typed = (text: string, html = "<p></p>") => {
  const e = makeEditor(html);
  typeText(e, text);
  return e;
};

describe("AutoCorrect while typing", () => {
  it("capitalises sentence starts but not after abbreviations or initials", () => {
    expect(docText(typed("hello there. how are you? fine "))).toBe("Hello there. How are you? Fine ");
    expect(docText(typed("see e.g. this and Mr. smith "))).toBe("See e.g. this and Mr. smith ");
    expect(docText(typed("by J. smith "))).toBe("By J. smith ");
    // Words that aren't plain words are left alone.
    expect(docText(typed("iPhone and www.example.com "))).toBe("iPhone and www.example.com ");
  });

  it("capitalises on Enter too", () => {
    const e = typed("first");
    pressKey(e, "Enter");
    expect(paragraphText(e, 0)).toBe("First");
  });

  it("turns straight quotes into smart quotes", () => {
    expect(docText(typed('He said "hi" and it\'s \'ok\' '))).toBe("He said “hi” and it’s ‘ok’ ");
    expect(smartQuote('"', undefined)).toBe("“");
    expect(smartQuote("'", "(")).toBe("‘");
  });

  it("turns -- into an em dash when the next character is typed", () => {
    expect(docText(typed("wait--what "))).toBe("Wait—what ");
    expect(docText(typed("a -- b"))).toBe("A — b");
    // "---" is left for the horizontal-rule input rule.
    const hr = typed("---");
    expect(hr.getJSON().content?.some((n) => n.type === "horizontalRule")).toBe(true);
  });

  it("applies the replacement list", () => {
    expect(docText(typed("Copyright (c) now "))).toBe("Copyright © now ");
    expect(docText(typed("Wait... "))).toBe("Wait… ");
    expect(docText(typed("Go -> there "))).toBe("Go → there ");
    const e = makeEditor("<p></p>");
    e.commands.setAutoCorrect({ replacements: [{ from: "teh", to: "the" }] });
    typeText(e, "Teh teh cat ");
    expect(docText(e)).toBe("Teh the cat ");
  });

  it("converts a double space into a period when enabled", () => {
    const e = makeEditor("<p></p>");
    typeText(e, "One  two");
    expect(docText(e)).toBe("One  two"); // off by default
    const f = makeEditor("<p></p>");
    f.commands.setAutoCorrect({ doubleSpacePeriod: true });
    typeText(f, "One  two ");
    expect(docText(f)).toBe("One. Two ");
  });

  it("can be switched off option by option", () => {
    const e = makeEditor("<p></p>");
    e.commands.setAutoCorrect({
      capitalizeSentences: false,
      smartQuotes: false,
      dashes: false,
      replaceText: false,
    });
    typeText(e, 'hello "x" a--b (c) ');
    expect(docText(e)).toBe('hello "x" a--b (c) ');
  });

  it("Backspace right after a correction restores what was typed", () => {
    const e = typed("(c)");
    expect(docText(e)).toBe("©");
    pressKey(e, "Backspace");
    expect(docText(e)).toBe("(c)");
    const f = makeEditor("<p></p>");
    f.commands.setAutoCorrect({ replacements: [{ from: "teh", to: "the" }] });
    typeText(f, "Teh teh ");
    expect(docText(f)).toBe("Teh the ");
    pressKey(f, "Backspace");
    expect(docText(f)).toBe("Teh teh ");
    const q = typed('"');
    pressKey(q, "Backspace");
    expect(docText(q)).toBe('"');
    // Only straight after: once something else is typed, Backspace is left
    // to the browser (a plain deletion).
    const g = typed("(c)x");
    expect(pressKey(g, "Backspace")).toBe(false);
    expect(docText(g)).toBe("©x");
  });

  it("keeps the formatting of corrected text and skips code", () => {
    const e = typed("x", "<p><strong>hello</strong></p>");
    // caret after "hello" (bold), typing "x" then space
    expect(docText(e)).toBe("hellox");
    typeText(e, " ");
    expect(paragraphText(e)).toBe("Hellox ");
    expect(marksAt(e, 0, 0)).toEqual(["bold"]);
    const c = makeEditor("<pre><code></code></pre>");
    typeText(c, 'say "hi" -- ok ');
    expect(docText(c)).toBe('say "hi" -- ok ');
  });
});

describe("wordEndEdits", () => {
  it("returns non-overlapping edits", () => {
    expect(wordEndEdits({ before: "ok. yes", firstInCell: false }, DEFAULT_AUTOCORRECT)).toEqual([
      { from: 4, to: 5, text: "Y" },
    ]);
    expect(wordEndEdits({ before: "No--", firstInCell: false }, DEFAULT_AUTOCORRECT)).toEqual([
      { from: 2, to: 4, text: "—" },
    ]);
    expect(wordEndEdits({ before: "(c", firstInCell: false }, DEFAULT_AUTOCORRECT)).toEqual([
      { from: 1, to: 2, text: "C" },
    ]);
  });
});

describe("AutoCorrect settings persistence", () => {
  let data: Map<string, string>;
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
  beforeEach(() => {
    data = new Map();
  });

  it("round-trips per user and fills in defaults", () => {
    expect(loadAutoCorrect("u1", store)).toEqual(DEFAULT_AUTOCORRECT);
    saveAutoCorrect("u1", { ...DEFAULT_AUTOCORRECT, smartQuotes: false }, store);
    expect(loadAutoCorrect("u1", store).smartQuotes).toBe(false);
    expect(loadAutoCorrect("u2", store).smartQuotes).toBe(true);
    store.setItem("grown.docs.autocorrect.v1:u3", "{not json");
    expect(loadAutoCorrect("u3", store)).toEqual(DEFAULT_AUTOCORRECT);
  });

  it("falls back to defaults when storage throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadAutoCorrect("u", broken)).toEqual(DEFAULT_AUTOCORRECT);
    expect(() => saveAutoCorrect("u", DEFAULT_AUTOCORRECT, broken)).not.toThrow();
  });
});
