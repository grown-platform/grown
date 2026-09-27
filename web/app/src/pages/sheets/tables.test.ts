// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet cells are loosely typed. */
import { describe, expect, it } from "vitest";
import {
  autoExpand,
  calculatedColumnFill,
  convertToRange,
  createTable,
  guessHasHeaders,
  headerEdited,
  nextTableName,
  resizeTable,
  setTotalsFunction,
  setTotalsRow,
  stylePreview,
  tableCellLook,
  tableNameError,
  totalsFunctionOf,
  uniqueColumnNames,
  tableShape,
  type TableModel,
} from "./tables";
import { dropTableColumnsInFormula, renameTableInFormula, structuredToA1 } from "./structuredRefs";

type Grid = any[][];
const getter = (g: Grid) => (r: number, c: number) => g[r]?.[c] ?? null;
const text = (v: string) => ({ v, m: v });
const num = (v: number) => ({ v, m: String(v) });

/** Region | Qty | Price over rows 0..3. */
function sales(): Grid {
  return [
    [text("Region"), text("Qty"), text("Price")],
    [text("East"), num(2), num(10)],
    [text("West"), num(3), num(20)],
    [text("East"), num(5), num(1)],
  ];
}

function make(g: Grid, extra: Partial<Parameters<typeof createTable>[0]> = {}): TableModel {
  const res = createTable({ range: { r1: 0, c1: 0, r2: 3, c2: 2 }, hasHeaders: true, taken: [], allTables: [], sheetTables: [], get: getter(g), ...extra });
  if (typeof res === "string") throw new Error(res);
  return res.table;
}

describe("create", () => {
  it("names columns from the header row and picks Table1", () => {
    const t = make(sales());
    expect(t.name).toBe("Table1");
    expect(t.columns.map((c) => c.name)).toEqual(["Region", "Qty", "Price"]);
    expect(t.ref).toEqual({ r1: 0, c1: 0, r2: 3, c2: 2 });
    expect(t.style?.name).toBe("TableStyleMedium2");
    expect(t.autoFilter).toBe(true);
  });
  it("guesses headers, makes names unique and fills blanks", () => {
    expect(guessHasHeaders({ r1: 0, c1: 0, r2: 3, c2: 2 }, getter(sales()))).toBe(true);
    expect(guessHasHeaders({ r1: 1, c1: 1, r2: 3, c2: 2 }, getter(sales()))).toBe(false);
    expect(uniqueColumnNames(["Qty", "qty", "", "Qty"])).toEqual(["Qty", "qty2", "Column3", "Qty3"]);
    const g = sales();
    g[0][1] = num(2024);
    const res = createTable({ range: { r1: 0, c1: 0, r2: 3, c2: 2 }, hasHeaders: true, taken: [], allTables: [], sheetTables: [], get: getter(g) });
    if (typeof res === "string") throw new Error(res);
    // A numeric header becomes text.
    expect(res.table.columns[1].name).toBe("2024");
    expect(res.writes).toEqual([{ r: 0, c: 1, cell: { v: "2024", m: "2024", ct: { fa: "@", t: "s" } } }]);
  });
  it("refuses overlaps and skips taken names", () => {
    const t = make(sales());
    expect(createTable({ range: { r1: 2, c1: 2, r2: 5, c2: 4 }, hasHeaders: true, taken: ["Table1"], allTables: [t], sheetTables: [t], get: () => null })).toMatch(/overlap/);
    expect(nextTableName(["Table1", "table2"])).toBe("Table3");
  });
  it("validates names like Excel", () => {
    expect(tableNameError("Sales_2024", [])).toBeNull();
    expect(tableNameError("A1", [])).toMatch(/cell reference/);
    expect(tableNameError("R1C1", [])).toMatch(/cell reference/);
    expect(tableNameError("My Table", [])).toMatch(/spaces/);
    expect(tableNameError("1abc", [])).not.toBeNull();
    expect(tableNameError("sales", ["Sales"])).toMatch(/already/);
  });
});

describe("totals row", () => {
  it("adds Total and a SUBTOTAL sum in the last column, and removes them", () => {
    const g = sales();
    const t = make(g);
    const on = setTotalsRow(t, true, getter(g));
    expect(on.insertRow).toBe(false);
    expect(on.table.ref.r2).toBe(4);
    expect(on.table.totalsRowCount).toBe(1);
    expect(on.writes).toEqual([
      { r: 4, c: 0, cell: { v: "Total", m: "Total", ct: { fa: "@", t: "s" } } },
      { r: 4, c: 2, cell: { f: "=SUBTOTAL(109,[Price])" } },
    ]);
    const qty = setTotalsFunction(on.table, 1, "average");
    expect(qty.writes).toEqual([{ r: 4, c: 1, cell: { f: "=SUBTOTAL(101,[Qty])" } }]);
    expect(totalsFunctionOf("=SUBTOTAL(101,[Qty])")).toBe("average");
    expect(totalsFunctionOf("=SUBTOTAL(9,[Qty])")).toBe("sum");
    const off = setTotalsRow(qty.table, false, getter(g));
    expect(off.table.ref.r2).toBe(3);
    expect(off.writes.map((w) => w.cell)).toEqual([null, null, null]);
    // A value under the table: the row has to be inserted.
    g[4] = [null, text("note")];
    expect(setTotalsRow(t, true, getter(g)).insertRow).toBe(true);
  });
  it("counts a text column", () => {
    const g = [[text("Name")], [text("a")], [text("b")]];
    const t = createTable({ range: { r1: 0, c1: 0, r2: 2, c2: 0 }, hasHeaders: true, taken: [], allTables: [], sheetTables: [], get: getter(g) });
    if (typeof t === "string") throw new Error(t);
    expect(setTotalsRow(t.table, true, getter(g)).writes).toEqual([{ r: 3, c: 0, cell: { f: "=SUBTOTAL(103,[Name])" } }]);
  });
});

describe("auto-expand and calculated columns", () => {
  it("grows on a row typed below and a column typed to the right", () => {
    const g = sales();
    let t = make(g);
    const calc = calculatedColumnFill({ ...t, ref: { ...t.ref, c2: 3 }, columns: [...t.columns, { id: 4, name: "Total" }] }, 1, 3, "=[@Qty]*[@Price]", getter(g));
    expect(calc?.writes).toEqual([
      { r: 2, c: 3, cell: { f: "=[@Qty]*[@Price]" } },
      { r: 3, c: 3, cell: { f: "=[@Qty]*[@Price]" } },
    ]);
    t = calc!.table;
    expect(t.columns[3].calculatedColumnFormula).toBe("=[@Qty]*[@Price]");
    g[4] = [text("North")];
    const down = autoExpand(t, 4, 0, getter(g));
    expect(down?.table.ref.r2).toBe(4);
    expect(down?.writes).toEqual([{ r: 4, c: 3, cell: { f: "=[@Qty]*[@Price]" } }]);
    g[0][4] = text("Notes");
    const right = autoExpand(down!.table, 0, 4, getter(g));
    expect(right?.table.columns.map((c) => c.name)).toEqual(["Region", "Qty", "Price", "Total", "Notes"]);
    expect(right?.writes).toEqual([]);
    const right2 = autoExpand(down!.table, 2, 4, getter(sales()));
    expect(right2?.table.columns[4].name).toBe("Column5");
    expect(right2?.writes).toEqual([{ r: 0, c: 4, cell: { v: "Column5", m: "Column5", ct: { fa: "@", t: "s" } } }]);
    expect(autoExpand(t, 6, 0, getter(g))).toBeNull();
  });
  it("fills a relative formula row by row, and not over other values", () => {
    const g = sales();
    const t = make(g);
    const res = calculatedColumnFill({ ...t, ref: { ...t.ref, c2: 3 }, columns: [...t.columns, { id: 4, name: "X" }] }, 2, 3, "=B3*C3", getter(g));
    expect(res?.table.columns[3].calculatedColumnFormula).toBe("=B2*C2");
    expect(res?.writes.map((w) => w.cell.f)).toEqual(["=B2*C2", "=B4*C4"]);
    expect(calculatedColumnFill(t, 1, 1, "=1+1", getter(g))).toBeNull(); // Qty has values
  });
});

describe("rename, resize, convert", () => {
  it("renames a header with a unique name; blank becomes ColumnN", () => {
    const t = make(sales());
    expect(headerEdited(t, 1, "Units")?.table.columns[1].name).toBe("Units");
    const dup = headerEdited(t, 1, "Price");
    expect(dup?.to).toBe("Price2");
    expect(dup?.writes[0].cell.v).toBe("Price2");
    expect(headerEdited(t, 1, "")?.to).toBe("Column2");
    expect(renameTableInFormula("=SUM(Table1[Qty])+ROWS(Table1)+\"Table1\"", "Table1", "Sales")).toBe("=SUM(Sales[Qty])+ROWS(Sales)+\"Table1\"");
  });
  it("resizes keeping the header row", () => {
    const g = sales();
    g[0][3] = text("Extra");
    const t = make(g);
    const res = resizeTable(t, { r1: 0, c1: 0, r2: 5, c2: 3 }, getter(g), [t]);
    if (typeof res === "string") throw new Error(res);
    expect(res.table.columns.map((c) => c.name)).toEqual(["Region", "Qty", "Price", "Extra"]);
    expect(res.removed).toEqual([]);
    const smaller = resizeTable(t, { r1: 0, c1: 0, r2: 2, c2: 1 }, getter(g), [t]);
    if (typeof smaller === "string") throw new Error(smaller);
    expect(smaller.removed).toEqual(["Price"]);
    expect(dropTableColumnsInFormula("=SUM(Table1[Price])+Table1[@Qty]", { Table1: smaller.removed })).toBe("=SUM(#REF!)+Table1[@Qty]");
    expect(resizeTable(t, { r1: 1, c1: 0, r2: 3, c2: 2 }, getter(g), [t])).toMatch(/header/);
  });
  it("converts references to A1 and keeps the look as formatting", () => {
    const g = sales();
    const t = { ...make(g), ref: { r1: 0, c1: 0, r2: 3, c2: 3 }, columns: [...make(g).columns, { id: 4, name: "Total" }] };
    g[1][3] = { f: "=[@Qty]*[@Price]" };
    const sheets = [{ id: "s1", name: "Sheet1", data: g, grownTables: [t] }, { id: "s2", name: "Sheet2", data: [[{ f: "=SUM(Table1[Qty])+ROWS(Table1)" }]] }];
    const res = convertToRange(sheets, t, getter(g));
    expect(res.edits).toEqual([
      { sheetId: "s1", r: 1, c: 3, f: "=$B2*$C2" },
      { sheetId: "s2", r: 0, c: 0, f: "=SUM($B$2:$B$4)+ROWS($A$2:$D$4)" },
    ]);
    expect(res.formats[0]).toEqual({ r: 0, c: 0, bg: "#4472C4", fc: "#FFFFFF", bl: 1 });
    expect(structuredToA1("=Table1[[#Headers],[Qty]]", tableShape(t))).toBe("=$B$1");
  });
});

describe("style", () => {
  it("paints the header, bands and the totals row", () => {
    const t: TableModel = { ...make(sales()), ref: { r1: 0, c1: 0, r2: 4, c2: 2 }, totalsRowCount: 1 };
    expect(tableCellLook(t, 0, 0)).toMatchObject({ fill: "#4472C4", text: "#FFFFFF", bold: true });
    expect(tableCellLook(t, 1, 0)?.fill).toBe("#DAE3F3");
    expect(tableCellLook(t, 2, 0)?.fill).toBeUndefined();
    expect(tableCellLook(t, 4, 1)).toMatchObject({ bold: true, topDouble: true });
    expect(tableCellLook(t, 5, 0)).toBeNull();
    const noBands = { ...t, style: { ...t.style!, showRowStripes: false, showFirstColumn: true } };
    expect(tableCellLook(noBands, 1, 1)?.fill).toBeUndefined();
    expect(tableCellLook(noBands, 2, 0)?.bold).toBe(true);
    expect(stylePreview("TableStyleLight9")[0][0].fill).toBe("#4472C4");
    expect(stylePreview("TableStyleDark2")[1][1].text).toBe("#FFFFFF");
  });
});
