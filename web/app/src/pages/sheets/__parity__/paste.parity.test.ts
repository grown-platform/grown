// Ports of OnlyOffice's internal copy/paste tests (behaviour only, clean-room):
//   cell/spreadsheet-calculation/copy-paste-tests.js
// against ../pasteSpecial.ts with the real formula translation
// (../formulaShift.ts). A paste into a selection that is a whole multiple of
// the copied block repeats the block; several selected ranges are pasted one
// after the other.

import { describe, expect, it } from "vitest";
import { pasteSpecial, type Cell, type CopiedBlock } from "../pasteSpecial";
import { translateFormula } from "../formulaShift";
import { lettersToCol } from "../cellValue";
import { pasteTables, type TableModel } from "../tables";

type Sheet = Map<string, Cell>;
const key = (r: number, c: number) => `${r},${c}`;

function addr(a1: string): { r: number; c: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(a1)!;
  return { r: Number(m[2]) - 1, c: lettersToCol(m[1]) };
}

function copy(sheet: Sheet, from: string, to = from): CopiedBlock {
  const a = addr(from);
  const b = addr(to);
  const cells: Cell[][] = [];
  for (let r = a.r; r <= b.r; r++) {
    const row: Cell[] = [];
    for (let c = a.c; c <= b.c; c++) row.push(structuredClone(sheet.get(key(r, c)) ?? null));
    cells.push(row);
  }
  return { cells, r: a.r, c: a.c };
}

/** Pastes into each range of a (multi-range) selection. */
function paste(sheet: Sheet, block: CopiedBlock, ranges: string[]) {
  for (const range of ranges) {
    const [from, to = from] = range.split(":");
    const a = addr(from);
    const b = addr(to);
    const writes = pasteSpecial(block, a.r, a.c, (r, c) => sheet.get(key(r, c)) ?? null, {
      what: "all",
      translate: translateFormula,
      target: { rows: b.r - a.r + 1, cols: b.c - a.c + 1 },
    });
    for (const w of writes) sheet.set(key(w.r, w.c), w.cell);
  }
}

const value = (sheet: Sheet, a1: string) => {
  const { r, c } = addr(a1);
  return sheet.get(key(r, c))?.v;
};
const edit = (sheet: Sheet, a1: string) => {
  const { r, c } = addr(a1);
  const cell = sheet.get(key(r, c));
  return cell?.f ?? cell?.v;
};
const set = (sheet: Sheet, a1: string, cell: Cell) => {
  const { r, c } = addr(a1);
  sheet.set(key(r, c), cell);
};

describe("sheets parity: copy and paste", () => {
  it('oo:cell/spreadsheet-calculation/copy-paste-tests.js#simple tests', () => {
    const sheet: Sheet = new Map();
    set(sheet, "A1", { v: -4, m: "-4", ct: { fa: "General", t: "n" } });
    const block = copy(sheet, "A1");
    paste(sheet, block, ["A2"]);
    expect(value(sheet, "A2")).toBe(value(sheet, "A1"));
    paste(sheet, block, ["A6", "B6:B9"]);
    for (const a of ["A6", "B6", "B7", "B8", "B9"]) expect(value(sheet, a)).toBe(-4);
  });

  it('oo:cell/spreadsheet-calculation/copy-paste-tests.js#formula tests', () => {
    const sheet: Sheet = new Map();
    set(sheet, "A1", { f: "=SIN(1)", v: 0.841, ct: { fa: "General", t: "n" } });
    let block = copy(sheet, "A1");
    paste(sheet, block, ["A2"]);
    expect(edit(sheet, "A2")).toBe(edit(sheet, "A1"));
    paste(sheet, block, ["A6", "B6:B9"]);
    for (const a of ["A6", "B6", "B7", "B8", "B9"]) expect(edit(sheet, a)).toBe("=SIN(1)");

    // Relative references move with the paste; a two-row block repeats.
    set(sheet, "A1", { f: "=SIN(A2)", v: 0 });
    set(sheet, "A2", { f: "=SIN(A3)", v: 0 });
    block = copy(sheet, "A1", "A2");
    paste(sheet, block, ["C2:C7", "D6:D9", "E6:E7"]);
    for (let r = 2; r <= 7; r++) expect(edit(sheet, `C${r}`)).toBe(`=SIN(C${r + 1})`);
    for (let r = 6; r <= 9; r++) expect(edit(sheet, `D${r}`)).toBe(`=SIN(D${r + 1})`);
    for (let r = 6; r <= 7; r++) expect(edit(sheet, `E${r}`)).toBe(`=SIN(E${r + 1})`);
  });

  it('oo:cell/spreadsheet-calculation/copy-paste-tests.js#comment tests', () => {
    // FortuneSheet keeps a cell's note in `ps`; a paste carries it along.
    const sheet: Sheet = new Map();
    set(sheet, "E10", { v: -4, m: "-4", ps: { value: "test" } });
    const block = copy(sheet, "E10");
    paste(sheet, block, ["A2"]);
    expect(value(sheet, "A2")).toBe(value(sheet, "E10"));
    expect(sheet.get(key(9, 4))?.ps?.value).toBe("test");
    paste(sheet, block, ["A6", "B6:B9"]);
    for (const a of ["A6", "B6", "B7", "B8", "B9"]) {
      expect(value(sheet, a)).toBe(-4);
      const { r, c } = addr(a);
      expect(sheet.get(key(r, c))?.ps?.value).toBe("test");
    }
    expect(sheet.get(key(9, 1))?.ps).toBeUndefined();
  });

  it('oo:cell/spreadsheet-calculation/copy-paste-tests.js#tables', () => {
    // A table on D6:D9; D6:D10 is copied, so the table travels with the block.
    const table: TableModel = {
      id: 1,
      name: "Table1",
      displayName: "Table1",
      ref: { c1: 3, r1: 5, c2: 3, r2: 8 },
      headerRowCount: 1,
      totalsRowCount: 0,
      totalsRowShown: false,
      insertRow: false,
      autoFilter: true,
      columns: [{ id: 1, name: "Column1" }],
      style: { name: "TableStyleMedium2", showFirstColumn: false, showLastColumn: false, showRowStripes: true, showColumnStripes: false },
    };
    const src = { c1: 3, r1: 5, c2: 3, r2: 9 };
    const tables = [table];
    const names = () => tables.map((t) => t.name);
    tables.push(...pasteTables([table], src, [{ c1: 4, r1: 10, c2: 4, r2: 10 }], names(), tables));
    expect(tables[tables.length - 1].ref.r1).toBe(10);
    expect(tables[tables.length - 1].ref.c1).toBe(4);
    tables.push(...pasteTables([table], src, [{ c1: 5, r1: 10, c2: 5, r2: 10 }, { c1: 6, r1: 10, c2: 6, r2: 10 }], names(), tables));
    expect(tables[tables.length - 2].ref.r1).toBe(10);
    expect(tables[tables.length - 2].ref.c1).toBe(5);
    expect(tables[tables.length - 1].ref.r1).toBe(10);
    expect(tables[tables.length - 1].ref.c1).toBe(6);
    // Each copy gets its own name and id.
    expect(new Set(tables.map((t) => t.name)).size).toBe(4);
    expect(new Set(tables.map((t) => t.id)).size).toBe(4);
  });

  it('oo:cell/spreadsheet-calculation/copy-paste-tests.js#formulas with unar operators', () => {
    for (const f of ["=+++1", '=++++"STR"', "=++++FALSE", "=+SUM(+++1)+++1", "=+++-SIN(+-+1-+-+1)+-+1+-+1"]) {
      const sheet: Sheet = new Map();
      set(sheet, "A1", { f, v: 1 });
      paste(sheet, copy(sheet, "A1"), ["A2"]);
      expect(edit(sheet, "A2")).toBe(f);
    }
  });

  // OnlyOffice's asc_PasteData completion callbacks; the clipboard paste itself belongs to FortuneSheet.
  it.skip('oo:cell/spreadsheet-calculation/copy-paste-tests.js#callback tests paste text', () => {});
  it.skip('oo:cell/spreadsheet-calculation/copy-paste-tests.js#callback tests paste HTML', () => {});
  it.skip('oo:cell/spreadsheet-calculation/copy-paste-tests.js#callback tests paste Binary', () => {});
});
