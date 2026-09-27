import { describe, it, expect } from "vitest";
import type { DeckDoc } from "./model";
import { findMatches, matchesIn, replaceAll, replaceMatch } from "./findReplace";
import { formatRange } from "./textOps";

const text = (id: string, t: string) => ({ id, type: "text" as const, x: 0, y: 0, w: 1, h: 1, text: t });

function deck(): DeckDoc {
  return {
    slides: [
      {
        id: "s1",
        background: "#fff",
        notes: "Say Cat twice: cat",
        elements: [
          formatRange(text("a", "The cat sat"), 4, 7, { bold: true }),
          { id: "g", type: "group", x: 0, y: 0, w: 1, h: 1, children: [text("b", "concatenate")] },
        ],
      },
      {
        id: "s2",
        background: "#fff",
        elements: [
          {
            id: "tb",
            type: "table",
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            table: { rows: 1, cols: 2, cells: [["cat", "dog"]] },
          },
        ],
      },
    ],
  };
}

describe("find and replace", () => {
  it("matches case-insensitively by default, whole words on request", () => {
    expect(matchesIn("Cat cat concat", "cat")).toEqual([[0, 3], [4, 7], [11, 14]]);
    expect(matchesIn("Cat cat concat", "cat", { matchCase: true })).toEqual([[4, 7], [11, 14]]);
    expect(matchesIn("Cat cat concat", "cat", { wholeWord: true })).toEqual([[0, 3], [4, 7]]);
    expect(matchesIn("aaa", "aa")).toEqual([[0, 2]]);
    expect(matchesIn("x", "")).toEqual([]);
  });

  it("finds across slides, groups, tables and notes in order", () => {
    const ms = findMatches(deck(), "cat");
    expect(ms.map((m) => [m.slideIdx, m.where, m.elId ?? "", m.start])).toEqual([
      [0, "text", "a", 4],
      [0, "text", "b", 3],
      [0, "notes", "", 4],
      [0, "notes", "", 15],
      [1, "cell", "tb", 0],
    ]);
    expect(ms[1].topId).toBe("g");
    expect(findMatches(deck(), "cat", { notes: false })).toHaveLength(3);
  });

  it("replaces one match keeping the run formatting", () => {
    const d = deck();
    const m = findMatches(d, "cat")[0];
    const out = replaceMatch(d, m, "dog");
    const el = out.slides[0].elements[0];
    expect(el.text).toBe("The dog sat");
    expect(el.runs).toEqual([{ text: "The " }, { text: "dog", bold: true }, { text: " sat" }]);
  });

  it("replaces all, in text, groups, tables and notes", () => {
    const { doc, count } = replaceAll(deck(), "cat", "cow");
    expect(count).toBe(5);
    expect(doc.slides[0].elements[0].text).toBe("The cow sat");
    expect(doc.slides[0].elements[1].children![0].text).toBe("concowenate");
    expect(doc.slides[0].notes).toBe("Say cow twice: cow");
    expect(doc.slides[1].elements[0].table!.cells[0]).toEqual(["cow", "dog"]);
    expect(replaceAll(deck(), "zebra", "x").count).toBe(0);
  });
});
