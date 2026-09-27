// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet models are loosely typed. */
// Sheet structure (M7): OnlyOffice SheetStructureTests.js (move rows/cols,
// insert rows, shifting cells), plus translateFormula checks drawn from
// copy-paste-tests.js (tagged in paste.parity.test.ts), replayed against
// ../formulaShift.ts. Scenarios are
// re-expressed in Grown's model (FortuneSheet celldata + StructureOp); no
// OnlyOffice code is reused.
import { describe, expect, it } from "vitest";
import { applyStructureOp, translateFormula, type StructureOp } from "../formulaShift";

type Cells = Record<string, string>; // "A1" → value or formula

function a1(ref: string): { r: number; c: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
  return { r: Number(m[2]) - 1, c: c - 1 };
}

function book(cells: Cells): any[] {
  const celldata = Object.entries(cells).map(([ref, text]) => {
    const { r, c } = a1(ref);
    return { r, c, v: text.startsWith("=") ? { f: text } : { v: text, m: text } };
  });
  return [{ id: "s1", name: "Sheet1", celldata }];
}

/** The edit text of a cell (formula or value), "" when empty. */
function text(sheets: any[], ref: string): string {
  const { r, c } = a1(ref);
  const cd = sheets[0].celldata.find((x: any) => x.r === r && x.c === c);
  return cd?.v?.f ?? (cd?.v?.v !== undefined ? String(cd.v.v) : "");
}

function column(sheets: any[], col: string, from: number, to: number): string[] {
  const out: string[] = [];
  for (let r = from; r <= to; r++) out.push(text(sheets, `${col}${r}`));
  return out;
}

function sumBlock(): Cells {
  return { A100: "1", A101: "2", A102: "3", A103: "4", A104: "5", A105: "=SUM(A100:A104)" };
}

describe("SheetStructureTests.js", () => {
  it('oo:cell/spreadsheet-calculation/SheetStructureTests.js#Move rows/cols', () => {
    // A 9×6 block of "rowNcolM" labels. Only the shift-drag variants are
    // structure moves (the dragged block is cut out and inserted before the
    // drop target); plain and Ctrl drags are cut/copy-paste over the target,
    // which is clipboard behaviour and not modelled by StructureOp.
    const cells: Cells = {};
    for (let r = 1; r <= 9; r++) {
      for (let c = 1; c <= 6; c++) cells[`${String.fromCharCode(64 + c)}${r}`] = `row${r}col${c}`;
    }
    const row2 = (s: any[]) => ["A", "B", "C", "D", "E", "F"].map((col) => text(s, `${col}2`));

    // Shift-drag column B so it lands at column D: B's cells now sit in D, C and D slide left.
    const cols = applyStructureOp(book(cells), { kind: "move", axis: "col", sheet: "Sheet1", index: 1, count: 1, to: 4 });
    expect(row2(cols)).toEqual(["row2col1", "row2col3", "row2col4", "row2col2", "row2col5", "row2col6"]);

    // Shift-drag row 2 so it lands at row 4.
    const rows = applyStructureOp(book(cells), { kind: "move", axis: "row", sheet: "Sheet1", index: 1, count: 1, to: 4 });
    expect(column(rows, "B", 1, 9)).toEqual([
      "row1col2",
      "row3col2",
      "row4col2",
      "row2col2",
      "row5col2",
      "row6col2",
      "row7col2",
      "row8col2",
      "row9col2",
    ]);

    // Moving back restores the original layout.
    const back = applyStructureOp(rows, { kind: "move", axis: "row", sheet: "Sheet1", index: 3, count: 1, to: 1 });
    expect(column(back, "B", 1, 9)).toEqual(column(book(cells), "B", 1, 9));
  });

  it('oo:cell/spreadsheet-calculation/SheetStructureTests.js#Shift and insert cells/row', () => {
    // Values 1..5 in A100:A104 with =SUM(A100:A104) in A105; insert rows at
    // different places and check both the cells and the rewritten formula.
    const cases: { index: number; count: number; values: string[]; formulaAt: string; formula: string }[] = [
      { index: 99, count: 1, values: ["", "1", "2", "3", "4", "5"], formulaAt: "A106", formula: "=SUM(A101:A105)" },
      { index: 101, count: 1, values: ["1", "2", "", "3", "4", "5"], formulaAt: "A106", formula: "=SUM(A100:A105)" },
      { index: 103, count: 1, values: ["1", "2", "3", "4", "", "5"], formulaAt: "A106", formula: "=SUM(A100:A105)" },
      { index: 104, count: 1, values: ["1", "2", "3", "4", "5", ""], formulaAt: "A106", formula: "=SUM(A100:A104)" },
      { index: 99, count: 3, values: ["", "", "", "1", "2", "3", "4", "5"], formulaAt: "A108", formula: "=SUM(A103:A107)" },
      { index: 104, count: 2, values: ["1", "2", "3", "4", "5", "", ""], formulaAt: "A107", formula: "=SUM(A100:A104)" },
    ];
    for (const tc of cases) {
      const op: StructureOp = { kind: "insert", axis: "row", sheet: "Sheet1", index: tc.index, count: tc.count };
      const out = applyStructureOp(book(sumBlock()), op);
      expect(column(out, "A", 100, 99 + tc.values.length), `insert ${tc.count} at ${tc.index}`).toEqual(tc.values);
      expect(text(out, tc.formulaAt), `formula after insert at ${tc.index}`).toBe(tc.formula);
    }
  });

  it('oo:cell/spreadsheet-calculation/SheetStructureTests.js#Shift/move cells after create a table', () => {
    // Grown has no Excel tables. What this case checks on the grid is that
    // formatting a range as a table without a header row inserts one header
    // cell above the range, shifting the column down, and that formulas
    // follow the shifted cells. That is an "insert cells, shift down" at the
    // table's first row; a range that already has a header shifts nothing.
    const header = (r1: number): StructureOp => ({
      kind: "insertCells",
      sheet: "Sheet1",
      rect: { c1: 0, r1, c2: 0, r2: r1 },
      shift: "down",
    });

    // Table over A100:A104, A100:A105 or A100:A103 → header at A100.
    const top = applyStructureOp(book(sumBlock()), header(99));
    expect(column(top, "A", 100, 105)).toEqual(["", "1", "2", "3", "4", "5"]);
    expect(text(top, "A106")).toBe("=SUM(A101:A105)");

    // Table over A102:A105 or A102:A103 → header at A102, inside the SUM range.
    const inside = applyStructureOp(book(sumBlock()), header(101));
    expect(column(inside, "A", 100, 105)).toEqual(["1", "2", "", "3", "4", "5"]);
    expect(text(inside, "A106")).toBe("=SUM(A100:A105)");

    // With a header row nothing moves.
    const titled = book(sumBlock());
    expect(column(titled, "A", 100, 105)).toEqual(["1", "2", "3", "4", "5", "=SUM(A100:A104)"]);
  });

  // Merge / unmerge / merge-across value retention (and merging over array
  // formulas) is merge behaviour, not structure shifting; formulaShift only
  // moves existing config.merge rectangles (covered in ../formulaShift.test.ts).
  it.skip("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Cells merge test", () => {
    // Pending: merge semantics (keep top-left value, clear the rest, array
    // formula cells) belong to a merge-ops module — later M7/M12 work.
  });
});

describe("copy-paste-tests.js (formula translation on paste)", () => {
  /** Paste a copied block (top-left at src) tiled over a target rect; returns cell → formula. */
  function paste(
    copied: { ref: string; f: string }[],
    target: { c1: number; r1: number; c2: number; r2: number },
  ): Record<string, string> {
    const srcTop = Math.min(...copied.map((x) => a1(x.ref).r));
    const srcLeft = Math.min(...copied.map((x) => a1(x.ref).c));
    const h = Math.max(...copied.map((x) => a1(x.ref).r)) - srcTop + 1;
    const out: Record<string, string> = {};
    for (let r = target.r1; r <= target.r2; r++) {
      for (let c = target.c1; c <= target.c2; c++) {
        const src = copied.find((x) => {
          const p = a1(x.ref);
          return p.r - srcTop === (r - target.r1) % h && p.c - srcLeft === 0;
        })!;
        const p = a1(src.ref);
        out[`${String.fromCharCode(65 + c)}${r + 1}`] = translateFormula(src.f, r - p.r, c - p.c);
      }
    }
    return out;
  }

  // The oo: tags for these copy-paste cases live in paste.parity.test.ts;
  // here they only pin translateFormula on its own.
  it("paste translation: relative refs follow the destination (copy-paste formula tests)", () => {
    // A formula without references pastes unchanged anywhere.
    const sin = paste([{ ref: "A1", f: "=SIN(1)" }], { c1: 1, r1: 5, c2: 1, r2: 8 });
    expect(Object.values(sin)).toEqual(["=SIN(1)", "=SIN(1)", "=SIN(1)", "=SIN(1)"]);
    expect(translateFormula("=SIN(1)", 1, 0)).toBe("=SIN(1)");

    // A1:A2 hold =SIN(A2) / =SIN(A3); pasted tiled over C2:C7, D6:D9 and E6:E7
    // the relative refs follow each destination cell.
    const copied = [
      { ref: "A1", f: "=SIN(A2)" },
      { ref: "A2", f: "=SIN(A3)" },
    ];
    expect(paste(copied, { c1: 2, r1: 1, c2: 2, r2: 6 })).toEqual({
      C2: "=SIN(C3)",
      C3: "=SIN(C4)",
      C4: "=SIN(C5)",
      C5: "=SIN(C6)",
      C6: "=SIN(C7)",
      C7: "=SIN(C8)",
    });
    expect(paste(copied, { c1: 3, r1: 5, c2: 3, r2: 8 })).toEqual({
      D6: "=SIN(D7)",
      D7: "=SIN(D8)",
      D8: "=SIN(D9)",
      D9: "=SIN(D10)",
    });
    expect(paste(copied, { c1: 4, r1: 5, c2: 4, r2: 6 })).toEqual({ E6: "=SIN(E7)", E7: "=SIN(E8)" });
  });

  it("paste translation: stacked unary operators survive verbatim", () => {
    // Formulas made of stacked unary operators survive a copy one row down verbatim.
    for (const f of ["+++1", '++++"STR"', "++++FALSE", "+SUM(+++1)+++1", "+++-SIN(+-+1-+-+1)+-+1+-+1"]) {
      expect(translateFormula(f, 1, 0)).toBe(f);
    }
  });
});
