// @vitest-environment node
// Excel tables: OnlyOffice SheetStructureTests.js table cases, the text side
// (the reference a selection inserts, the edit and saved forms of typed
// references, column renames), replayed against ../structuredRefs.ts and
// ../tables.ts. The values these references evaluate to are checked in Go
// (internal/sheets/formula_tables_test.go, same tags). Facts come from the
// suite's observed behaviour; no OnlyOffice code is reused.
import { describe, expect, it } from "vitest";
import {
  escapeColumn,
  normalizeStructuredRefs,
  parseStructSpec,
  structuredRefsValid,
  tableSelectionString,
  type TableShape,
} from "../structuredRefs";
import { createTable, headerEdited, renameColumnFormulas, setTotalsRow, type TableModel } from "../tables";

const rect = (c1: number, r1: number, c2: number, r2: number) => ({ c1, r1, c2, r2 });

/** OnlyOffice's A100:C103 table made without headers: a header row is inserted (A100:C104). */
function ooTable(headers = ["Column1", "Column2", "Column3"]): TableShape {
  return { name: "Table1", ref: rect(0, 99, 2, 103), headerRowCount: 1, totalsRowCount: 0, columns: headers.map((name) => ({ name })) };
}
const withTotals = (t: TableShape): TableShape => ({ ...t, ref: { ...t.ref, r2: t.ref.r2 + 1 }, totalsRowCount: 1 });

describe("OnlyOffice SheetStructureTests.js — tables", () => {
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Table selection for formula", () => {
    // Creating the table from A100:C103 with "My table has headers" off.
    const made = createTable({ range: rect(0, 99, 2, 102), hasHeaders: false, taken: [], allTables: [], sheetTables: [], get: () => null });
    if (typeof made === "string") throw new Error(made);
    expect(made.insertHeaderRow).toBe(true);
    expect(made.table.ref).toEqual(rect(0, 99, 2, 103));
    expect(made.table.columns.map((c) => c.name)).toEqual(["Column1", "Column2", "Column3"]);
    let t = ooTable();
    const name = t.name;
    const far = { r: 10, c: 10 };
    expect(tableSelectionString(t, far, rect(0, 1, 0, 1))).toBeNull();
    expect(tableSelectionString(t, far, rect(0, 100, 0, 100))).toBeNull();
    expect(tableSelectionString(t, far, rect(0, 100, 0, 103))).toBe(`${name}[Column1]`);
    expect(tableSelectionString(t, far, rect(0, 100, 1, 103))).toBe(`${name}[[Column1]:[Column2]]`);
    expect(tableSelectionString(t, far, rect(0, 100, 2, 103))).toBe(name);
    expect(tableSelectionString(t, far, rect(0, 99, 1, 103))).toBe(`${name}[[#All],[Column1]:[Column2]]`);
    expect(tableSelectionString(t, far, rect(0, 99, 2, 103))).toBe(`${name}[#All]`);
    expect(tableSelectionString(t, far, rect(0, 99, 2, 99))).toBe(`${name}[#Headers]`);
    // Totals row on.
    t = withTotals(t);
    expect(t.totalsRowCount).toBe(1);
    expect(tableSelectionString(t, far, rect(0, 100, 2, 104))).toBe(`${name}[[#Data],[#Totals]]`);
    expect(tableSelectionString(t, far, rect(0, 100, 1, 104))).toBe(`${name}[[#Data],[#Totals],[Column1]:[Column2]]`);
    expect(tableSelectionString(t, far, rect(0, 99, 0, 104))).toBe(`${name}[[#All],[Column1]]`);
    expect(tableSelectionString(t, far, rect(0, 99, 1, 104))).toBe(`${name}[[#All],[Column1]:[Column2]]`);
    expect(tableSelectionString(t, far, rect(0, 99, 1, 103))).toBe(`${name}[[#Headers],[#Data],[Column1]:[Column2]]`);
    // One data row in the active cell's own row: @.
    const row = { r: 101, c: 4 };
    expect(tableSelectionString(t, row, rect(0, 101, 2, 101))).toBe(`${name}[@]`);
    expect(tableSelectionString(t, row, rect(0, 101, 1, 101))).toBe(`${name}[@[Column1]:[Column2]]`);
    expect(tableSelectionString(t, row, rect(0, 101, 0, 101))).toBe(`${name}[@Column1]`);
    const hdr = { r: 99, c: 4 };
    expect(tableSelectionString(t, hdr, rect(0, 99, 2, 99))).toBe(`${name}[#Headers]`);
    expect(tableSelectionString(t, hdr, rect(0, 99, 2, 103))).toBe(`${name}[[#Headers],[#Data]]`);
  });

  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Table values/values for edit tests", () => {
    const T = "Table1";
    // [typed, value for edit, saved formula]
    const cases: [string, string, string][] = [
      [`${T}[@]`, `${T}[@]`, `${T}[#This Row]`],
      [`${T}[#This Row]`, `${T}[@]`, `${T}[#This Row]`],
      [`${T}[[#This Row]]`, `${T}[@]`, `${T}[#This Row]`],
      [`${T}[@Column1]`, `${T}[@Column1]`, `${T}[[#This Row],[Column1]]`],
      [`${T}[[#This Row],[Column1]]`, `${T}[@Column1]`, `${T}[[#This Row],[Column1]]`],
      [`${T}[[Column1]:[Column2]]`, `${T}[[Column1]:[Column2]]`, `${T}[[Column1]:[Column2]]`],
      [`${T}[[Column1]:[Column3]]`, `${T}[[Column1]:[Column3]]`, `${T}[[Column1]:[Column3]]`],
      [`${T}[@[Column1]:[Column2]]`, `${T}[@[Column1]:[Column2]]`, `${T}[[#This Row],[Column1]:[Column2]]`],
      [`${T}[[#This Row],[Column1]:[Column2]]`, `${T}[@[Column1]:[Column2]]`, `${T}[[#This Row],[Column1]:[Column2]]`],
      [`${T}[@[Column1]]`, `${T}[@Column1]`, `${T}[[#This Row],[Column1]]`],
      [`${T}[#Headers]`, `${T}[#Headers]`, `${T}[#Headers]`],
      [`${T}[[#Headers]]`, `${T}[#Headers]`, `${T}[#Headers]`],
      [`${T}[[#Headers],[Column2]]`, `${T}[[#Headers],[Column2]]`, `${T}[[#Headers],[Column2]]`],
      [`${T}[[#Headers],[Column2]:[Column3]]`, `${T}[[#Headers],[Column2]:[Column3]]`, `${T}[[#Headers],[Column2]:[Column3]]`],
      [`${T}[#All]`, `${T}[#All]`, `${T}[#All]`],
      [`${T}[[#All]]`, `${T}[#All]`, `${T}[#All]`],
      [`${T}[#Data]`, `${T}[#Data]`, `${T}[#Data]`],
      [`${T}[[#Data]]`, `${T}[#Data]`, `${T}[#Data]`],
      [`${T}[[#Totals]]`, `${T}[#Totals]`, `${T}[#Totals]`],
      [`${T}[[#Data],[#Totals]]`, `${T}[[#Data],[#Totals]]`, `${T}[[#Data],[#Totals]]`],
      [`${T}[[#Headers],[#Data]]`, `${T}[[#Headers],[#Data]]`, `${T}[[#Headers],[#Data]]`],
      // Excel swaps these to [#Headers],[#Data]; OnlyOffice (and Grown) keep the order typed.
      [`${T}[[#Data],[#Headers]]`, `${T}[[#Data],[#Headers]]`, `${T}[[#Data],[#Headers]]`],
      [`${T}[[Column1]]`, `${T}[Column1]`, `${T}[Column1]`],
    ];
    for (const [typed, edit, file] of cases) {
      expect(normalizeStructuredRefs("=" + typed, "edit"), typed).toBe("=" + edit);
      expect(normalizeStructuredRefs(typed, "file"), typed).toBe(file);
    }
    // Refused: #This Row with another specifier.
    for (const bad of [`${T}[[#This Row],[#Data]]`, `${T}[[#This Row],[#All]]`]) {
      expect(structuredRefsValid("=" + bad), bad).toBe(false);
    }
    // Short forms inside the table parse as table references.
    for (const f of ["[]", "[Column1]", "[[Column1]:[Column2]]", "[@]", "[@Column1]", "[@[Column1]:[Column2]]"]) {
      expect(parseStructSpec(f.slice(1, -1)), f).not.toBeNull();
    }
    // Saved inside the table, the short form gains the table name.
    expect(normalizeStructuredRefs("=[@Column1]*2", "file", T)).toBe(`=${T}[[#This Row],[Column1]]*2`);
  });

  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Table special characters tests", () => {
    const headers = ["With a single ' quote", "With a double '' quote", "With a special ' @ & ? * / |  # '' [ ] characters"];
    // Made from A100:C103 with headers: A100:C103, then the totals row.
    const t: TableShape = { name: "Table1", ref: rect(0, 99, 2, 103), headerRowCount: 1, totalsRowCount: 1, columns: headers.map((name) => ({ name })) };
    const esc = (s: string) => s.replace(/(['#@[\]])/g, "'$1");
    expect(escapeColumn(headers[2])).toBe(esc(headers[2]));
    expect(normalizeStructuredRefs("=Table1[#All]", "edit")).toBe("=Table1[#All]");
    headers.forEach((h, i) => {
      // Header cell selected (it is the active cell).
      expect(tableSelectionString(t, { r: 99, c: i }, rect(i, 99, i, 99))).toBe(`Table1[[#Headers],[${esc(h)}]]`);
      // The data rows of one column.
      expect(tableSelectionString(t, { r: 100, c: i }, rect(i, 100, i, 102))).toBe(`Table1[${esc(h)}]`);
    });
    expect(tableSelectionString(t, { r: 100, c: 0 }, rect(0, 100, 1, 102))).toBe(`Table1[[${esc(headers[0])}]:[${esc(headers[1])}]]`);
    expect(tableSelectionString(t, { r: 100, c: 1 }, rect(1, 100, 2, 102))).toBe(`Table1[[${esc(headers[1])}]:[${esc(headers[2])}]]`);
    // And those strings parse back to the same columns.
    const sp = parseStructSpec(`[${esc(headers[1])}]:[${esc(headers[2])}]`);
    expect(sp?.col1).toBe(headers[1]);
    expect(sp?.col2).toBe(headers[2]);
  });

  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Table column names changes tests", () => {
    // Table A100:C103 over A101:C103 = 1 (header row detected as empty → Column1…), totals on.
    let table: TableModel = {
      id: 1,
      name: "Table1",
      displayName: "Table1",
      ref: rect(0, 99, 2, 102),
      headerRowCount: 1,
      totalsRowCount: 0,
      totalsRowShown: false,
      insertRow: false,
      autoFilter: true,
      columns: ["Column1", "Column2", "Column3"].map((name, i) => ({ id: i + 1, name })),
      style: null,
    };
    table = setTotalsRow(table, true, () => ({ v: 1 })).table;
    expect(table.ref.r2).toBe(103);
    const T = "Table1";
    // Cells (0-based row 101) and what was typed there.
    const typed: Record<string, string> = {
      U: `=${T}[@Column1]`,
      Z: `=${T}[[#This Row],[Column1]]`,
      AE: `=${T}[@[Column1]:[Column2]]`,
      AJ: `=${T}[[#This Row],[Column1]:[Column2]]`,
      AO: `=${T}[[#This Row],[Column1]:[Column2]]`,
      AT: `=${T}[@[Column1]]`,
      BI: `=${T}[[#Headers],[Column1]]`,
      BN: `=${T}[[#Headers],[Column1]:[Column2]]`,
    };
    const col = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const data: any[][] = [];
    for (const [c, f] of Object.entries(typed)) (data[101] ??= [])[col(c)] = { f: normalizeStructuredRefs(f, "edit") };
    const stored = (c: string) => data[101][col(c)].f as string;
    expect(stored("U")).toBe(`=${T}[@Column1]`);
    expect(normalizeStructuredRefs(stored("U"), "file")).toBe(`=${T}[[#This Row],[Column1]]`);
    expect(stored("Z")).toBe(`=${T}[@Column1]`);
    expect(stored("AE")).toBe(`=${T}[@[Column1]:[Column2]]`);
    // The first header becomes CLCLCL.
    const res = headerEdited(table, 0, "CLCLCL");
    expect(res?.from).toBe("Column1");
    expect(res?.to).toBe("CLCLCL");
    const sheets = [{ id: "s1", name: "Sheet1", data, grownTables: [res!.table] }];
    for (const e of renameColumnFormulas(sheets, T, res!.from, res!.to)) data[e.r][e.c] = { f: e.f };
    const N = "CLCLCL";
    const want: Record<string, [string, string]> = {
      U: [`=${T}[@${N}]`, `=${T}[[#This Row],[${N}]]`],
      Z: [`=${T}[@${N}]`, `=${T}[[#This Row],[${N}]]`],
      AE: [`=${T}[@[${N}]:[Column2]]`, `=${T}[[#This Row],[${N}]:[Column2]]`],
      AJ: [`=${T}[@[${N}]:[Column2]]`, `=${T}[[#This Row],[${N}]:[Column2]]`],
      AO: [`=${T}[@[${N}]:[Column2]]`, `=${T}[[#This Row],[${N}]:[Column2]]`],
      AT: [`=${T}[@${N}]`, `=${T}[[#This Row],[${N}]]`],
      BI: [`=${T}[[#Headers],[${N}]]`, `=${T}[[#Headers],[${N}]]`],
      BN: [`=${T}[[#Headers],[${N}]:[Column2]]`, `=${T}[[#Headers],[${N}]:[Column2]]`],
    };
    for (const [c, [edit, file]] of Object.entries(want)) {
      expect(stored(c), c).toBe(edit);
      expect(normalizeStructuredRefs(stored(c), "file"), c).toBe(file);
    }
  });
});
