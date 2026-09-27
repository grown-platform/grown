// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet models are loosely typed. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyStructureOp,
  shiftFormula,
  shiftRect,
  structureFormulaEdits,
  structureModelPatches,
  translateFormula,
  type StructureOp,
} from "./formulaShift";

// Shared with internal/sheets/structure_test.go.
const fixture = JSON.parse(
  readFileSync(new URL("../../../../../internal/sheets/testdata/structure/shift.json", import.meta.url), "utf8"),
);

const byCell = (a: any, b: any) => a.r - b.r || a.c - b.c;

describe("shared fixture: shift", () => {
  for (const tc of fixture.shift) {
    it(tc.id, () => {
      expect(shiftFormula(tc.formula, tc.host, tc.op)).toBe(tc.expect);
    });
  }
});

describe("shared fixture: translate", () => {
  for (const tc of fixture.translate) {
    it(tc.id, () => {
      expect(translateFormula(tc.formula, tc.dr, tc.dc)).toBe(tc.expect);
    });
  }
});

describe("shared fixture: apply", () => {
  for (const tc of fixture.apply) {
    it(tc.id, () => {
      const before = JSON.stringify(tc.sheets);
      const out = applyStructureOp(tc.sheets, tc.op);
      expect(JSON.stringify(tc.sheets)).toBe(before); // pure
      for (const [idx, fields] of Object.entries<any>(tc.expect)) {
        for (const [key, want] of Object.entries<any>(fields)) {
          let got = out[Number(idx)][key];
          if (key === "celldata") got = [...got].sort(byCell);
          expect(got, `${idx}.${key}`).toEqual(want);
        }
      }
    });
  }
});

const S = "Sheet1";

describe("shiftRect", () => {
  it("insert rows before, inside and after", () => {
    const r = { c1: 0, r1: 2, c2: 1, r2: 4 };
    expect(shiftRect(r, { kind: "insert", axis: "row", sheet: S, index: 0, count: 2 })).toEqual({ c1: 0, r1: 4, c2: 1, r2: 6 });
    expect(shiftRect(r, { kind: "insert", axis: "row", sheet: S, index: 3, count: 1 })).toEqual({ c1: 0, r1: 2, c2: 1, r2: 5 });
    expect(shiftRect(r, { kind: "insert", axis: "row", sheet: S, index: 5, count: 1 })).toEqual(r);
  });
  it("delete removes or shrinks", () => {
    const r = { c1: 1, r1: 0, c2: 3, r2: 0 };
    expect(shiftRect(r, { kind: "delete", axis: "col", sheet: S, index: 1, count: 3 })).toBeNull();
    expect(shiftRect(r, { kind: "delete", axis: "col", sheet: S, index: 2, count: 5 })).toEqual({ c1: 1, r1: 0, c2: 1, r2: 0 });
  });
  it("cell shifts only touch rects inside the band", () => {
    const op: StructureOp = { kind: "insertCells", sheet: S, rect: { c1: 0, r1: 1, c2: 1, r2: 1 }, shift: "down" };
    expect(shiftRect({ c1: 0, r1: 3, c2: 1, r2: 3 }, op)).toEqual({ c1: 0, r1: 4, c2: 1, r2: 4 });
    expect(shiftRect({ c1: 0, r1: 3, c2: 2, r2: 3 }, op)).toEqual({ c1: 0, r1: 3, c2: 2, r2: 3 });
  });
  it("clamps at the sheet edge", () => {
    const r = { c1: 0, r1: 0, c2: 0, r2: 1048575 };
    expect(shiftRect(r, { kind: "insert", axis: "row", sheet: S, index: 5, count: 1 })?.r2).toBe(1048575);
  });
});

describe("applyStructureOp on live (dense) sheets", () => {
  const sheets = () => [
    {
      id: "a",
      name: "Data",
      row: 5,
      column: 3,
      data: [
        [{ v: 1 }, null, null],
        [{ v: 2 }, null, null],
        [{ f: "=A1+A2", v: 3 }, null, null],
      ],
      config: {
        rowhidden: { "1": 0 },
        borderInfo: [
          { rangeType: "range", borderType: "border-all", range: [{ row: [0, 1], column: [0, 0] }] },
          { rangeType: "cell", value: { row_index: 2, col_index: 0, b: {} } },
        ],
      },
      dataVerification: { "2_0": { type: "number" } },
    },
    { id: "b", name: "Other", data: [[{ f: "=Data!A3*2" }]] },
  ];

  it("deletes a row: cells move up, matrix shrinks, formulas and borders follow", () => {
    const out = applyStructureOp(sheets(), { kind: "delete", axis: "row", sheet: "Data", index: 0, count: 1 });
    expect(out[0].data.length).toBe(2);
    expect(out[0].data[0][0]).toEqual({ v: 2 });
    expect(out[0].data[1][0]).toEqual({ f: "=#REF!+A1", v: 3 });
    expect(out[0].row).toBe(4);
    expect(out[0].config.rowhidden).toEqual({ "0": 0 });
    expect(out[0].config.borderInfo[0].range).toEqual([{ row: [0, 0], column: [0, 0] }]);
    expect(out[0].config.borderInfo[1].value).toMatchObject({ row_index: 1, col_index: 0 });
    expect(out[0].dataVerification).toEqual({ "1_0": { type: "number" } });
    expect(out[1].data[0][0].f).toBe("=Data!A2*2");
  });

  it("accepts the sheet id and leaves unknown sheets alone", () => {
    const out = applyStructureOp(sheets(), { kind: "insert", axis: "col", sheet: "a", index: 0, count: 1 });
    expect(out[0].data[2][1].f).toBe("=B1+B2");
    expect(out[0].column).toBe(4);
    const same = applyStructureOp(sheets(), { kind: "insert", axis: "col", sheet: "nope", index: 0, count: 1 });
    expect(same).toEqual(sheets());
  });

  it("insert cells right grows the matrix when needed", () => {
    const out = applyStructureOp(sheets(), {
      kind: "insertCells",
      sheet: "Data",
      rect: { c1: 0, r1: 0, c2: 2, r2: 0 },
      shift: "right",
    });
    expect(out[0].data[0].length).toBeGreaterThanOrEqual(4);
    expect(out[0].data[0][3]).toEqual({ v: 1 });
    expect(out[0].data[1][0]).toEqual({ v: 2 });
    expect(out[0].data[2][0].f).toBe("=D1+A2");
  });

  it("deleting a merged block's rows drops or shrinks the merge", () => {
    const wb = [
      {
        id: "m",
        name: "M",
        celldata: [
          { r: 0, c: 0, v: { v: "t", mc: { r: 0, c: 0, rs: 3, cs: 1 } } },
          { r: 1, c: 0, v: { mc: { r: 0, c: 0 } } },
          { r: 2, c: 0, v: { mc: { r: 0, c: 0 } } },
        ],
        config: { merge: { "0_0": { r: 0, c: 0, rs: 3, cs: 1 } } },
      },
    ];
    const shrink = applyStructureOp(wb, { kind: "delete", axis: "row", sheet: "M", index: 2, count: 1 });
    expect(shrink[0].config.merge).toEqual({ "0_0": { r: 0, c: 0, rs: 2, cs: 1 } });
    expect(shrink[0].celldata).toEqual([
      { r: 0, c: 0, v: { v: "t", mc: { r: 0, c: 0, rs: 2, cs: 1 } } },
      { r: 1, c: 0, v: { mc: { r: 0, c: 0 } } },
    ]);
    const gone = applyStructureOp(wb, { kind: "delete", axis: "row", sheet: "M", index: 1, count: 2 });
    expect(gone[0].config.merge).toEqual({});
    expect(gone[0].celldata).toEqual([{ r: 0, c: 0, v: { v: "t" } }]);
  });

  it("drops CF/DV rules and the filter whose ranges are deleted", () => {
    const wb = [
      {
        id: "x",
        name: "X",
        celldata: [],
        grownCF: [{ id: "1", ranges: [{ c1: 2, r1: 0, c2: 2, r2: 3 }], formula1: "=C1>1", base: { r: 0, c: 2 } }],
        grownDV: [{ id: "2", ranges: [{ c1: 2, r1: 0, c2: 2, r2: 0 }, { c1: 5, r1: 0, c2: 5, r2: 0 }], formula1: "5", formula2: "" }],
        grownFilter: { range: { r1: 0, c1: 2, r2: 5, c2: 2 }, columns: {} },
      },
    ];
    const out = applyStructureOp(wb, { kind: "delete", axis: "col", sheet: "X", index: 2, count: 1 });
    expect(out[0].grownCF).toEqual([]);
    expect(out[0].grownDV[0].ranges).toEqual([{ c1: 4, r1: 0, c2: 4, r2: 0 }]);
    expect(out[0].grownFilter).toBeNull();
  });
});

describe("structureFormulaEdits / structureModelPatches", () => {
  const before = [
    {
      id: "s1",
      name: "Sheet1",
      celldata: [
        { r: 0, c: 0, v: { f: "=B5" } },
        { r: 4, c: 1, v: { v: 1 } },
        { r: 9, c: 0, v: { f: "=SUM(A1:A2)" } },
      ],
      grownCF: [{ id: "cf", ranges: [{ c1: 0, r1: 5, c2: 0, r2: 6 }], formula1: "=A6>0" }],
      _namedRanges: [{ name: "n", range: "A7", sheetName: "Sheet1" }],
    },
    { id: "s2", name: "Sheet2", celldata: [{ r: 0, c: 0, v: { f: "=Sheet1!A10" } }, { r: 1, c: 0, v: { f: "=A10" } }] },
  ];
  const op: StructureOp = { kind: "insert", axis: "row", sheet: "Sheet1", index: 2, count: 3 };

  it("lists changed formulas at post-op positions", () => {
    expect(structureFormulaEdits(before, op)).toEqual([
      { sheetId: "s1", r: 0, c: 0, f: "=B8" },
      { sheetId: "s2", r: 0, c: 0, f: "=Sheet1!A13" },
    ]);
  });

  it("lists only the model fields that change", () => {
    expect(structureModelPatches(before, op)).toEqual([
      {
        sheetId: "s1",
        fields: {
          grownCF: [{ id: "cf", ranges: [{ c1: 0, r1: 8, c2: 0, r2: 9 }], formula1: "=A9>0" }],
          _namedRanges: [{ name: "n", range: "A10", sheetName: "Sheet1" }],
        },
      },
    ]);
  });

  it("uses the pre-op position to find a moved formula cell", () => {
    const edits = structureFormulaEdits(before, { kind: "delete", axis: "row", sheet: "Sheet1", index: 1, count: 1 });
    expect(edits).toContainEqual({ sheetId: "s1", r: 8, c: 0, f: "=SUM(A1:A1)" });
  });
});
