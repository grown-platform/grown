// Ports of OnlyOffice's range-sort suites (behaviour only, clean-room):
//   cell/js-api/api-range.js                              (SetSort, 31 cases)
//   cell/spreadsheet-calculation/SheetStructureTests.js   (sortRangeTest)
// against ../sortOps.ts. SetSort calls run through apiSetSort(); the engine's
// Range.sort(asc|desc, column 0) runs through sortGrid() with one value key.
// Note the API naming: "xlSortColumns" sorts by a column (rows move) and
// "xlSortRows" sorts by a row (columns move).

import { describe, expect, it } from "vitest";
import { apiSetSort, sortGrid, type ApiSortCall, type SortCell } from "../sortOps";
import { cellDisplay, parseA1Range, typedCell } from "../cellValue";

const API = "oo:cell/js-api/api-range.js#";
const STRUCT = "oo:cell/spreadsheet-calculation/SheetStructureTests.js#";

// Defined names the API suite registers before its cases run.
const NAMES: Record<string, string> = {
  super: "Sheet1!$A$1:$F$4",
  negativeIndexColumn: "Sheet1!$F$5:$I$14",
  negativeIndexRow: "Sheet1!$F$8:$H$13",
  outOfRangeColumn: "Sheet1!$H$5:$I$14",
  outOfRangeRow: "Sheet1!$F$11:$H$13",
};

/** A tiny mutable worksheet addressed in A1 notation. */
class Sheet {
  grid: SortCell[][] = [];

  set(values: Record<string, string>): this {
    for (const [addr, text] of Object.entries(values)) {
      const p = parseA1Range(addr)!;
      if (!this.grid[p.r1]) this.grid[p.r1] = [];
      this.grid[p.r1][p.c1] = (typedCell(text) as SortCell) ?? null;
    }
    return this;
  }

  get(addr: string): string {
    const p = parseA1Range(addr)!;
    return cellDisplay(this.grid[p.r1]?.[p.c1] ?? null);
  }

  /** Reads a block of display strings, row by row. */
  read(range: string): string[][] {
    const p = parseA1Range(range)!;
    const out: string[][] = [];
    for (let r = p.r1; r <= p.r2; r++) {
      const row: string[] = [];
      for (let c = p.c1; c <= p.c2; c++) row.push(this.get(`${String.fromCharCode(65 + c)}${r + 1}`));
      out.push(row);
    }
    return out;
  }

  sort(
    range: string,
    k1: string | null,
    o1: "xlAscending" | "xlDescending" | null,
    k2: string | null,
    o2: "xlAscending" | "xlDescending" | null,
    k3: string | null,
    o3: "xlAscending" | "xlDescending" | null,
    header: "xlYes" | "xlNo",
    orientation: "xlSortColumns" | "xlSortRows",
  ): this {
    const call: ApiSortCall = {
      range,
      key1: k1,
      order1: o1,
      key2: k2,
      order2: o2,
      key3: k3,
      order3: o3,
      header,
      orientation,
    };
    this.grid = apiSetSort(this.grid, call, NAMES);
    return this;
  }
}

/** Fills rows `r0..` of column letter `col` with `vals`. */
function column(col: string, vals: string[], r0 = 1): Record<string, string> {
  const o: Record<string, string> = {};
  vals.forEach((v, i) => (o[`${col}${r0 + i}`] = v));
  return o;
}

/** Fills row `row` from column A with `vals`. */
function row(rowNo: number, vals: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  vals.forEach((v, i) => (o[`${String.fromCharCode(65 + i)}${rowNo}`] = v));
  return o;
}

/** Builds a sheet from a table of rows starting at A1. */
function table(rows: string[][]): Sheet {
  const s = new Sheet();
  rows.forEach((r, i) => s.set(row(i + 1, r)));
  return s;
}

// The F8:H11 block shared by the out-of-range / negative-index cases.
const FH_BLOCK = [
  ["1", "4", "3"],
  ["2", "3", "4"],
  ["3", "2", "1"],
  ["4", "1", "2"],
];
function fhSheet(): Sheet {
  const s = new Sheet();
  FH_BLOCK.forEach((r, i) => s.set({ [`F${8 + i}`]: r[0], [`G${8 + i}`]: r[1], [`H${8 + i}`]: r[2] }));
  return s;
}

describe("api-range.js SetSort", () => {
  it(API + "SetSort: single cell, header yes, orientation column, ascending order", () => {
    const s = new Sheet().set({ A1: "Header" });
    s.sort("A1:A1", "A1", "xlAscending", null, null, null, null, "xlYes", "xlSortColumns");
    expect(s.get("A1")).toBe("Header");
  });

  it(API + "Multi-key sorting by A then C (A asc, C desc) with key2=null (row)", () => {
    // Values laid out across columns; rows 1-3 act as the keys.
    const s = table([
      ["2", "1", "2", "1", "2", "1"],
      ["b", "d", "a", "c", "z", "a"],
      ["3", "1", "5", "2", "2", "4"],
    ]);
    s.sort("A1:F3", "A1", "xlAscending", null, null, "A3", "xlDescending", "xlNo", "xlSortRows");
    expect(s.read("A1:F3")).toEqual([
      ["1", "1", "1", "2", "2", "2"],
      ["a", "c", "d", "a", "b", "z"],
      ["4", "2", "1", "5", "3", "2"],
    ]);
  });

  it(API + "SetSort: handles empty cells (row)", () => {
    const s = table([["", "2", "", "1"]]);
    s.sort("A1:D1", "A1", "xlAscending", null, null, null, null, "xlNo", "xlSortRows");
    expect(s.read("A1:D1")).toEqual([["1", "2", "", ""]]);
  });

  it(API + "SetSort: handles duplicate values (row)", () => {
    const s = table([["2", "2", "1", "1"]]);
    s.sort("A1:D1", "A1", "xlAscending", null, null, null, null, "xlNo", "xlSortRows");
    expect(s.read("A1:D1")).toEqual([["1", "1", "2", "2"]]);
  });

  it(API + "SetSort: handles mixed types (row)", () => {
    const s = table([["2", "apple", "1", "banana"]]);
    s.sort("A1:D1", "A1", "xlAscending", null, null, null, null, "xlNo", "xlSortRows");
    expect(s.read("A1:D1")).toEqual([["1", "2", "apple", "banana"]]);
  });

  it(API + "SetSort: handles single column (row)", () => {
    const s = new Sheet().set({ A1: "5" });
    s.sort("A1:A1", "A1", "xlDescending", null, null, null, null, "xlNo", "xlSortRows");
    expect(s.get("A1")).toBe("5");
  });

  it(API + "SetSort: handles all identical values (row)", () => {
    const s = table([["x", "x", "x", "x"]]);
    const before = s.grid[0].slice();
    s.sort("A1:D1", "A1", "xlAscending", null, null, null, null, "xlNo", "xlSortRows");
    expect(s.read("A1:D1")).toEqual([["x", "x", "x", "x"]]);
    // Stable: identical keys keep their original cells in place.
    expect(s.grid[0]).toEqual(before);
  });

  it(API + "SetSort: non-existent key row", () => {
    const s = table([["1", "2", "3"]]);
    s.sort("A1:C1", "A5", "xlAscending", null, null, null, null, "xlNo", "xlSortRows");
    expect(s.read("A1:C1")).toEqual([["1", "2", "3"]]);
  });

  it(API + "SetSort: with header column (row)", () => {
    const s = table([["Header", "3", "1", "2"]]);
    s.sort("A1:D1", "B1", "xlAscending", null, null, null, null, "xlYes", "xlSortRows");
    expect(s.read("A1:D1")).toEqual([["Header", "1", "2", "3"]]);
  });

  it(API + "SetSort: handles empty cells", () => {
    const s = new Sheet().set(column("A", ["", "2", "", "1"]));
    s.sort("A1:A4", "A1", "xlAscending", null, null, null, null, "xlNo", "xlSortColumns");
    expect(s.read("A1:A4").flat()).toEqual(["1", "2", "", ""]);
  });

  it(API + "SetSort: handles duplicate values", () => {
    const s = new Sheet().set(column("A", ["2", "2", "1", "1"]));
    s.sort("A1:A4", "A1", "xlAscending", null, null, null, null, "xlNo", "xlSortColumns");
    expect(s.read("A1:A4").flat()).toEqual(["1", "1", "2", "2"]);
  });

  it(API + "SetSort: handles mixed types", () => {
    const s = new Sheet().set(column("A", ["2", "apple", "1", "banana"]));
    s.sort("A1:A4", "A1", "xlAscending", null, null, null, null, "xlNo", "xlSortColumns");
    expect(s.read("A1:A4").flat()).toEqual(["1", "2", "apple", "banana"]);
  });

  it(API + "SetSort: handles single row", () => {
    const s = new Sheet().set({ A1: "5" });
    s.sort("A1:A1", "A1", "xlDescending", null, null, null, null, "xlNo", "xlSortColumns");
    expect(s.get("A1")).toBe("5");
  });

  it(API + "SetSort: handles all identical values", () => {
    const s = new Sheet().set(column("A", ["x", "x", "x", "x"]));
    s.sort("A1:A4", "A1", "xlAscending", null, null, null, null, "xlNo", "xlSortColumns");
    expect(s.read("A1:A4").flat()).toEqual(["x", "x", "x", "x"]);
  });

  it(API + "SetSort: non-existent key column", () => {
    const s = new Sheet().set(column("A", ["1", "2", "3"]));
    s.sort("A1:A3", "Z1", "xlAscending", null, null, null, null, "xlNo", "xlSortColumns");
    expect(s.read("A1:A3").flat()).toEqual(["1", "2", "3"]);
  });

  it(API + "SetSort: with header row", () => {
    const s = new Sheet().set(column("A", ["Header", "3", "1", "2"]));
    s.sort("A1:A4", "A2", "xlAscending", null, null, null, null, "xlYes", "xlSortColumns");
    expect(s.read("A1:A4").flat()).toEqual(["Header", "1", "2", "3"]);
  });

  it(API + "SetSort: orientation row (sort by row)", () => {
    const s = table([["1", "3", "2"]]);
    s.sort("A1:C1", "A1", "xlAscending", null, null, null, null, "xlNo", "xlSortRows");
    expect(s.read("A1:C1")).toEqual([["1", "2", "3"]]);
  });

  it(API + "Test asc_sortRanges", () => {
    const s = table([
      ["1", "4", "3"],
      ["2", "3", "4"],
      ["3", "2", "1"],
      ["4", "1", "2"],
    ]);
    s.sort("A1:C4", "A1", "xlDescending", null, null, null, null, "xlNo", "xlSortColumns");
    expect(s.read("A1:C4")).toEqual([
      ["4", "1", "2"],
      ["3", "2", "1"],
      ["2", "3", "4"],
      ["1", "4", "3"],
    ]);
  });

  it(API + "One column range sorting (A1:A5) asc/desc", () => {
    const s = new Sheet().set(column("A", ["5", "3", "4", "1", "2"]));
    s.sort("A1:A5", "A1", "xlAscending", null, null, null, null, "xlNo", "xlSortColumns");
    expect(s.read("A1:A5").flat()).toEqual(["1", "2", "3", "4", "5"]);
    s.sort("A1:A5", "A1", "xlDescending", null, null, null, null, "xlNo", "xlSortColumns");
    expect(s.read("A1:A5").flat()).toEqual(["5", "4", "3", "2", "1"]);
    // A lone cell next to the data, keyed on a column it does not contain: nothing moves.
    s.sort("B1", "A1", "xlDescending", null, null, null, null, "xlNo", "xlSortColumns");
    expect(s.read("A1:A5").flat()).toEqual(["5", "4", "3", "2", "1"]);
  });

  it(API + "Two-column range sorting by first key (A)", () => {
    const s = table([
      ["3", "a"],
      ["1", "c"],
      ["2", "b"],
      ["4", "d"],
    ]);
    s.sort("A1:B4", "A1", "xlAscending", null, null, null, null, "xlNo", "xlSortColumns");
    expect(s.read("A1:B4")).toEqual([
      ["1", "c"],
      ["2", "b"],
      ["3", "a"],
      ["4", "d"],
    ]);
  });

  it(API + "Two-column range sorting by second key (B)", () => {
    const s = table([
      ["3", "a"],
      ["1", "c"],
      ["2", "b"],
      ["4", "d"],
    ]);
    s.sort("A1:B4", "B1", "xlAscending", null, null, null, null, "xlNo", "xlSortColumns");
    expect(s.read("A1:B4")).toEqual([
      ["3", "a"],
      ["2", "b"],
      ["1", "c"],
      ["4", "d"],
    ]);
  });

  it(API + "Invalid sort range (single cell) is a no-op", () => {
    const s = new Sheet().set({ A1: "42" });
    s.sort("A1:A1", "A1", "xlAscending", null, null, null, null, "xlNo", "xlSortColumns");
    expect(s.get("A1")).toBe("42");
  });

  it(API + "No sort when key does not intersect sort range", () => {
    const s = table([
      ["5", "w", "10"],
      ["3", "y", "20"],
      ["4", "x", "30"],
      ["1", "z", "40"],
    ]);
    const before = s.read("A1:C4");
    s.sort("A1:B4", "C1", "xlAscending", null, null, null, null, "xlNo", "xlSortColumns");
    expect(s.read("A1:C4")).toEqual(before);
  });

  it(API + "Multi-key sorting by A then B (A asc, B desc)", () => {
    const s = table([
      ["2", "b"],
      ["1", "d"],
      ["2", "a"],
      ["1", "c"],
      ["3", "e"],
    ]);
    s.sort("A1:B5", "A1", "xlAscending", "B1", "xlDescending", null, null, "xlNo", "xlSortColumns");
    expect(s.read("A1:B5")).toEqual([
      ["1", "d"],
      ["1", "c"],
      ["2", "b"],
      ["2", "a"],
      ["3", "e"],
    ]);
  });

  it(API + "Multi-key sorting by A then B then C (A asc, B asc, C desc)", () => {
    const s = table([
      ["2", "b", "3"],
      ["1", "d", "1"],
      ["2", "a", "5"],
      ["1", "c", "2"],
      ["3", "e", "9"],
      ["2", "a", "1"],
      ["2", "b", "2"],
      ["1", "c", "1"],
    ]);
    s.sort("A1:C8", "A1", "xlAscending", "B1", "xlAscending", "C1", "xlDescending", "xlNo", "xlSortColumns");
    expect(s.read("A1:C8")).toEqual([
      ["1", "c", "2"],
      ["1", "c", "1"],
      ["1", "d", "1"],
      ["2", "a", "5"],
      ["2", "a", "1"],
      ["2", "b", "3"],
      ["2", "b", "2"],
      ["3", "e", "9"],
    ]);
  });

  it(API + "Multi-key sorting by A then C (A asc, C desc) with key2=null", () => {
    const s = table([
      ["2", "b", "3"],
      ["1", "d", "1"],
      ["2", "a", "5"],
      ["1", "c", "2"],
      ["2", "z", "2"],
      ["1", "a", "4"],
    ]);
    s.sort("A1:C6", "A1", "xlAscending", null, null, "C1", "xlDescending", "xlNo", "xlSortColumns");
    expect(s.read("A1:C6")).toEqual([
      ["1", "a", "4"],
      ["1", "c", "2"],
      ["1", "d", "1"],
      ["2", "a", "5"],
      ["2", "b", "3"],
      ["2", "z", "2"],
    ]);
  });

  it(API + "SetSort: A1:C4, sort by 'super' defined name, headers no, orientation column, should sort by A", () => {
    const s = table([
      ["1", "4", "3"],
      ["2", "3", "4"],
      ["3", "2", "1"],
      ["4", "1", "2"],
    ]);
    // The name spans A1:F4; as a key it stands for its first column, A.
    s.sort("A1:C4", "super", "xlDescending", null, null, null, null, "xlNo", "xlSortColumns");
    expect(s.read("A1:C4")).toEqual([
      ["4", "1", "2"],
      ["3", "2", "1"],
      ["2", "3", "4"],
      ["1", "4", "3"],
    ]);
  });

  it(API + "SetSort: negativeIndexColumn", () => {
    // Key column F lies left of the G:H range.
    const s = fhSheet();
    s.sort("G8:H11", "negativeIndexColumn", "xlDescending", null, null, null, null, "xlNo", "xlSortColumns");
    expect(s.read("F8:H11")).toEqual(FH_BLOCK);
  });

  it(API + "SetSort: negativeIndexRow", () => {
    // Key row 8 lies above the 9:11 range.
    const s = fhSheet();
    s.sort("F9:H11", "negativeIndexRow", "xlDescending", null, null, null, null, "xlNo", "xlSortRows");
    expect(s.read("F8:H11")).toEqual(FH_BLOCK);
  });

  it(API + "SetSort: outOfRangeColumn", () => {
    // Key column H lies right of the F:G range.
    const s = fhSheet();
    s.sort("F8:G11", "outOfRangeColumn", "xlDescending", null, null, null, null, "xlNo", "xlSortColumns");
    expect(s.read("F8:H11")).toEqual(FH_BLOCK);
  });

  it(API + "SetSort: outOfRangeRow", () => {
    // Key row 11 lies below the 8:10 range.
    const s = fhSheet();
    s.sort("F8:H10", "outOfRangeRow", "xlDescending", null, null, null, null, "xlNo", "xlSortRows");
    expect(s.read("F8:H11")).toEqual(FH_BLOCK);
  });
});

describe("SheetStructureTests.js sortRangeTest", () => {
  /** Sorts a single column of typed values by itself and returns the display texts. */
  function sortColumn(values: string[], ascending: boolean): string[] {
    const grid: SortCell[][] = values.map((v) => [(typedCell(v) as SortCell) ?? null]);
    const out = sortGrid(grid, { c1: 0, r1: 0, c2: 0, r2: values.length - 1 }, { keys: [{ index: 0, ascending }] });
    return out.map((r) => cellDisplay(r[0]));
  }
  /** Ascending then descending on the result, as the engine test chains them. */
  function both(values: string[]): [string[], string[]] {
    const asc = sortColumn(values, true);
    return [asc, sortColumn(asc, false)];
  }

  it(STRUCT + "sortRangeTest", () => {
    // Accented Latin letters sit right after their base letter.
    const accents = ["a", "h", "f", "é", "e", "d", "c", "b", "á", "g"];
    expect(sortColumn(accents, true)).toEqual(["a", "á", "b", "c", "d", "e", "é", "f", "g", "h"]);
    expect(sortColumn(accents, false)).toEqual(["h", "g", "f", "é", "e", "d", "c", "b", "á", "a"]);

    // Numbers precede text; text ignores case.
    let [asc, desc] = both(["1", "g", "2", "é", "TEST3", "á", "c", "Test2", "test1", "a"]);
    expect(asc).toEqual(["1", "2", "a", "á", "c", "é", "g", "test1", "Test2", "TEST3"]);
    expect(desc).toEqual(["TEST3", "Test2", "test1", "g", "é", "c", "á", "a", "2", "1"]);

    // Negative numbers, case-only ties kept in input order, then Cyrillic, then Hangul.
    expect(
      sortColumn(
        ["-2", "Test2", "test1", "g", "é", "12345", "á", "a", "안세요", "녕하", "TEST0", "하", "TEST2", "аА", "é", "1", "2", "АА", "аа", "-1"],
        true,
      ),
    ).toEqual(["-2", "-1", "1", "2", "12345", "a", "á", "é", "é", "g", "TEST0", "test1", "Test2", "TEST2", "аА", "АА", "аа", "녕하", "안세요", "하"]);

    // Script order: Cyrillic, Arabic, Japanese.
    [asc, desc] = both(["أ", "А", "あ"]);
    expect(asc).toEqual(["А", "أ", "あ"]);
    expect(desc).toEqual(["あ", "أ", "А"]);

    // Plain A before acute, grave, diaeresis; other scripts afterwards.
    let expected = ["A", "A", "A", "A", "A", "A", "Á", "À", "Ä", "А", "أ", "あ"];
    [asc, desc] = both(["A", "A", "A", "Ä", "A", "À", "A", "Á", "A", "أ", "А", "あ"]);
    expect(asc).toEqual(expected);
    expect(desc).toEqual([...expected].reverse());

    // "City" in several languages.
    expected = ["Cidade", "City", "Ciudad", "Kota", "Stadt", "Város", "Ville", "Город", "مدينة", "शहर", "শহর", "城市"];
    [asc, desc] = both(["City", "城市", "शहर", "Ciudad", "Ville", "مدينة", "শহর", "Город", "Cidade", "Kota", "Város", "Stadt"]);
    expect(asc).toEqual(expected);
    expect(desc).toEqual([...expected].reverse());

    // Same words behind a numeric prefix stay text.
    const pre = (xs: string[]) => xs.map((x) => "123" + x);
    [asc, desc] = both(pre(["City", "城市", "शहर", "Ciudad", "Ville", "مدينة", "শহর", "Город", "Cidade", "Kota", "Város", "Stadt"]));
    expect(asc).toEqual(pre(expected));
    expect(desc).toEqual(pre(expected).reverse());

    // Underscore before digits before letters; "2e2de2" is text, not a number.
    expected = ["__z", "_d", "2e2de2", "2e3de2", "3e2de2", "3e2de3", "dd23dd", "edasd", "f", "SDY", "SiM`Gl23", "zxc"];
    [asc, desc] = both(["2e2de2", "zxc", "f", "_d", "edasd", "SiM`Gl23", "dd23dd", "3e2de2", "SDY", "3e2de3", "2e3de2", "__z"]);
    expect(asc).toEqual(expected);
    expect(desc).toEqual([...expected].reverse());

    // Case-only variants are ties: order is untouched in both directions.
    const english = ["Test1", "TEST1", "tESt1", "TesT1"];
    expect(both(english)).toEqual([english, english]);
    const hungarian = ["Köszönöm1", "KÖSZÖNÖM1", "köSzÖnÖm1", "KöszönöM1"];
    expect(both(hungarian)).toEqual([hungarian, hungarian]);

    // Hungarian vowels.
    expected = ["a", "á", "é", "í", "ó", "ö", "ő", "ú", "ü", "ű", "ZZ"];
    [asc, desc] = both(["ZZ", "á", "é", "í", "ó", "ö", "ő", "ú", "ü", "ű", "a"]);
    expect(asc).toEqual(expected);
    expect(desc).toEqual([...expected].reverse());

    // Turkish letters: upper/lower pairs tie and keep their order either way.
    [asc, desc] = both(["C", "Ç", "ç", "Ğ", "ğ", "Ö", "ö", "Ş", "ş", "Ü", "ü"]);
    expect(asc).toEqual(["C", "Ç", "ç", "Ğ", "ğ", "Ö", "ö", "Ş", "ş", "Ü", "ü"]);
    expect(desc).toEqual(["Ü", "ü", "Ş", "ş", "Ö", "ö", "Ğ", "ğ", "Ç", "ç", "C"]);

    [asc, desc] = both(["ALİ", "MURAT", "İSMAİL"]);
    expect(asc).toEqual(["ALİ", "İSMAİL", "MURAT"]);
    expect(desc).toEqual(["MURAT", "İSMAİL", "ALİ"]);

    [asc, desc] = both(["Évad", "Óculos", "Äpfel", "Şehir"]);
    expect(asc).toEqual(["Äpfel", "Évad", "Óculos", "Şehir"]);
    expect(desc).toEqual(["Şehir", "Óculos", "Évad", "Äpfel"]);
  });
});
