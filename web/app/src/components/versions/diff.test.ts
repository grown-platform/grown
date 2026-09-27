import { describe, expect, it } from "vitest";
import {
  cellText,
  columnName,
  diffDecks,
  diffScenes,
  diffWorkbooks,
  summarizeDeckDiff,
  summarizeSceneDiff,
  summarizeWorkbookDiff,
  workbookSheets,
} from "./diff";

const wb = (sheets: unknown[]) => JSON.stringify(sheets);

describe("workbookSheets", () => {
  it("reads sparse celldata and dense data, skipping blanks", () => {
    const [a, b] = workbookSheets(
      wb([
        { id: "s1", name: "One", celldata: [{ r: 0, c: 0, v: { v: 1, m: "1" } }, { r: 2, c: 3, v: {} }] },
        { id: "s2", name: "Two", data: [[null, { v: "x" }], [], [{ v: 5 }]] },
      ]),
    );
    expect(a.cells.size).toBe(1);
    expect([a.rows, a.cols]).toEqual([1, 1]);
    expect([...b.cells.keys()]).toEqual(["0,1", "2,0"]);
    expect([b.rows, b.cols]).toEqual([3, 2]);
  });
  it("treats garbage as an empty workbook", () => {
    expect(workbookSheets("not json")).toEqual([]);
    expect(workbookSheets(null)).toEqual([]);
    expect(workbookSheets('{"a":1}')).toEqual([]);
  });
});

describe("cellText", () => {
  it("prefers formatted text, then value, rich text, formula", () => {
    expect(cellText({ v: 0.5, m: "50%" })).toBe("50%");
    expect(cellText({ v: 3 })).toBe("3");
    expect(cellText({ ct: { t: "inlineStr", s: [{ v: "a" }, { v: "b" }] } })).toBe("ab");
    expect(cellText({ f: "=A1" })).toBe("=A1");
    expect(cellText("raw")).toBe("raw");
    expect(cellText(null)).toBe("");
  });
});

describe("diffWorkbooks", () => {
  const older = wb([
    { id: "s1", name: "Sheet1", celldata: [
      { r: 0, c: 0, v: { v: 1 } },
      { r: 0, c: 1, v: { v: 2 } },
      { r: 1, c: 0, v: { v: 3 } },
    ] },
    { id: "s2", name: "Gone", celldata: [{ r: 0, c: 0, v: { v: "x" } }] },
  ]);
  const newer = wb([
    { id: "s1", name: "Renamed", celldata: [
      { r: 0, c: 0, v: { v: 1 } }, // same
      { r: 0, c: 1, v: { v: 20 } }, // changed
      { r: 1, c: 0, v: { v: 3, bl: 1 } }, // formatting changed
      { r: 5, c: 5, v: { v: "new" } }, // added
    ] },
    { id: "s3", name: "New", celldata: [{ r: 0, c: 0, v: { v: 1 } }, { r: 0, c: 1, v: { v: 2 } }] },
  ]);

  it("counts added, changed and removed cells per sheet", () => {
    const d = diffWorkbooks(older, newer);
    expect([...(d.changed.get("s1") ?? [])].sort()).toEqual(["0,1", "1,0", "5,5"]);
    expect(d.changed.get("s3")?.size).toBe(2);
    // 3 in s1 + 2 in the new sheet + 1 in the removed sheet
    expect(d.cellsChanged).toBe(6);
    expect(d.sheetsAdded).toEqual(["New"]);
    expect(d.sheetsRemoved).toEqual(["Gone"]);
    expect(d.sheetsRenamed).toEqual([{ from: "Sheet1", to: "Renamed" }]);
    expect(summarizeWorkbookDiff(d)).toBe(
      "6 cells changed, 1 sheet added, 1 sheet removed, 1 sheet renamed",
    );
  });

  it("counts a deleted cell", () => {
    const d = diffWorkbooks(
      wb([{ id: "s", celldata: [{ r: 0, c: 0, v: { v: 1 } }] }]),
      wb([{ id: "s", celldata: [] }]),
    );
    expect(d.cellsChanged).toBe(1);
    expect(d.changed.get("s")?.has("0,0")).toBe(true);
  });

  it("identical workbooks have no changes", () => {
    const d = diffWorkbooks(older, older);
    expect(d.cellsChanged).toBe(0);
    expect(summarizeWorkbookDiff(d)).toBe("No cell changes");
  });

  it("with no older version every cell is new but no sheet is 'added'", () => {
    const d = diffWorkbooks(null, newer);
    expect(d.cellsChanged).toBe(6);
    expect(d.sheetsAdded).toEqual([]);
  });
});

describe("diffDecks", () => {
  const deck = (slides: unknown[]) => JSON.stringify({ slides });
  const a = deck([
    { id: "1", elements: [] },
    { id: "2", elements: [{ id: "t", text: "hi" }] },
    { id: "3", elements: [] },
  ]);
  it("reports changed, added, removed and reordered slides", () => {
    const d = diffDecks(
      a,
      deck([
        { id: "2", elements: [{ id: "t", text: "hello" }] },
        { id: "1", elements: [] },
        { id: "4", elements: [] },
      ]),
    );
    expect([...d.changed]).toEqual(["2"]);
    expect(d.added).toBe(1);
    expect([...d.addedIds]).toEqual(["4"]);
    expect(d.removed).toBe(1);
    expect(d.reordered).toBe(true);
    expect(summarizeDeckDiff(d)).toBe(
      "1 slide changed, 1 slide added, 1 slide removed, slides reordered",
    );
  });
  it("no changes", () => {
    const d = diffDecks(a, a);
    expect(summarizeDeckDiff(d)).toBe("No slide changes");
    expect(d.reordered).toBe(false);
  });
  it("deleting a slide is not a reorder", () => {
    const d = diffDecks(a, deck([{ id: "1", elements: [] }, { id: "3", elements: [] }]));
    expect(d.reordered).toBe(false);
    expect(d.removed).toBe(1);
  });
});

describe("diffScenes", () => {
  const scene = (elements: unknown[]) => JSON.stringify({ elements, files: {} });
  it("ignores version bumps and deleted elements", () => {
    const d = diffScenes(
      scene([
        { id: "a", x: 1, version: 1, versionNonce: 5 },
        { id: "b", x: 1 },
        { id: "c", x: 1 },
      ]),
      scene([
        { id: "a", x: 1, version: 7, versionNonce: 9, updated: 3 }, // same drawing
        { id: "b", x: 2 }, // moved
        { id: "c", x: 1, isDeleted: true }, // deleted
        { id: "d", x: 0 }, // new
      ]),
    );
    expect(d).toEqual({ added: 1, removed: 1, changed: 1 });
    expect(summarizeSceneDiff(d)).toBe("1 element added, 1 element changed, 1 element removed");
    expect(summarizeSceneDiff({ added: 0, removed: 0, changed: 0 })).toBe("No drawing changes");
  });
});

describe("columnName", () => {
  it("letters columns like a spreadsheet", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });
});
