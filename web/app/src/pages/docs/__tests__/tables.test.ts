// Grown tests for Docs M4 tables: the grid resolver, the bad-table
// normaliser (paste / import), the border / margin / look encodings and
// CSS, and the table commands on a headless editor.
import { describe, expect, it } from "vitest";
import type { Editor, JSONContent } from "@tiptap/core";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import { makeEditor, makeSyncedEditors, paragraphTexts } from "./harness";
import {
  DEFAULT_LOOK,
  TABLE_TEMPLATES,
  borderCss,
  correctBadTable,
  columnWidthsOf,
  distributeEvenly,
  encodeLook,
  encodeMargins,
  encodeTableBorders,
  findTemplate,
  normalizeTable,
  normalizeTablesIn,
  parseLook,
  parseMargins,
  parseTableBorders,
  resolveFixedGrid,
  tableCss,
  tableCssRules,
} from "../tableModel";
import {
  applyCellBorders,
  applyTableStyle,
  autofitTable,
  currentTableAttrs,
  distributeColumns,
  distributeRows,
  insertTableSized,
  pmColumnWidths,
  setCellProps,
  setColumnWidth,
  setLookOption,
  setRowHeight,
  setTableBorders,
  setTableProps,
  splitTable,
  tableToText,
  textToTable,
  toggleRepeatHeader,
} from "../tables";

// --- helpers -----------------------------------------------------------------------------

const cell = (text = "", attrs: Record<string, unknown> = {}): JSONContent => ({
  type: "tableCell",
  attrs: { colspan: 1, rowspan: 1, colwidth: null, ...attrs },
  content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
});
const row = (...cells: JSONContent[]): JSONContent => ({ type: "tableRow", content: cells });
const table = (...rows: JSONContent[]): JSONContent => ({ type: "table", content: rows });

/** Grid of cell texts (a merged cell repeats in every slot it covers). */
function grid(t: JSONContent): string[][] {
  const rows = t.content ?? [];
  const out: string[][] = rows.map(() => []);
  rows.forEach((r, ri) => {
    let col = 0;
    for (const c of r.content ?? []) {
      while (out[ri][col] !== undefined) col++;
      const text = (c.content ?? []).map((p) => (p.content ?? []).map((x) => x.text).join("")).join("|");
      const cs = (c.attrs?.colspan as number) ?? 1;
      const rs = (c.attrs?.rowspan as number) ?? 1;
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) if (out[ri + dr]) out[ri + dr][col + dc] = text;
      col += cs;
    }
  });
  return out;
}

const tableHtml = (rows: string[][]) =>
  `<table><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td><p>${c}</p></td>`).join("")}</tr>`).join("")}</tbody></table>`;

/** Put the caret in cell (r, c) of the first table. */
function caretIn(e: Editor, r: number, c: number) {
  let tablePos = -1;
  e.state.doc.descendants((n, pos) => {
    if (tablePos < 0 && n.type.name === "table") tablePos = pos;
    return tablePos < 0;
  });
  const t = e.state.doc.nodeAt(tablePos)!;
  const map = TableMap.get(t);
  const cellPos = tablePos + 1 + map.map[r * map.width + c];
  e.commands.setTextSelection(cellPos + 2);
}

/** Select cells (r1, c1)..(r2, c2) of the first table. */
function selectCells(e: Editor, r1: number, c1: number, r2: number, c2: number) {
  let tablePos = -1;
  e.state.doc.descendants((n, pos) => {
    if (tablePos < 0 && n.type.name === "table") tablePos = pos;
    return tablePos < 0;
  });
  const t = e.state.doc.nodeAt(tablePos)!;
  const map = TableMap.get(t);
  const a = tablePos + 1 + map.map[r1 * map.width + c1];
  const b = tablePos + 1 + map.map[r2 * map.width + c2];
  e.view.dispatch(e.state.tr.setSelection(CellSelection.create(e.state.doc, a, b)));
}

const firstTable = (e: Editor) => {
  let t: JSONContent | null = null;
  for (const n of e.getJSON().content ?? []) if (!t && n.type === "table") t = n;
  return t!;
};
const cellAttrs = (e: Editor, r: number, c: number) => {
  let tablePos = -1;
  e.state.doc.descendants((n, pos) => {
    if (tablePos < 0 && n.type.name === "table") tablePos = pos;
    return tablePos < 0;
  });
  const t = e.state.doc.nodeAt(tablePos)!;
  const map = TableMap.get(t);
  return t.nodeAt(map.map[r * map.width + c])!.attrs;
};

// --- grid resolver -------------------------------------------------------------------------

describe("resolveFixedGrid", () => {
  it("keeps the grid when no cell has a width", () => {
    expect(resolveFixedGrid([10, 20], [{ cells: [{}, {}] }])).toEqual([10, 20]);
  });

  it("adds columns the grid lacks, at the average grid width", () => {
    expect(resolveFixedGrid([40, 60], [{ cells: [{}, {}, {}] }])).toEqual([40, 60, 50]);
    expect(resolveFixedGrid([], [{ cells: [{}, {}] }], 72)).toEqual([72, 72]);
  });

  it("honours gridBefore when placing cells", () => {
    expect(resolveFixedGrid([10, 10, 10], [{ before: 1, cells: [{ width: 25 }, { width: 35 }] }])).toEqual([10, 25, 35]);
  });

  it("widens the columns under a spanning cell in proportion, never shrinks them", () => {
    expect(resolveFixedGrid([20, 60], [{ cells: [{ span: 2, width: 160 }] }])).toEqual([40, 120]);
    expect(resolveFixedGrid([20, 60], [{ cells: [{ span: 2, width: 10 }] }])).toEqual([20, 60]);
  });

  it("a single-column width beats a spanning cell's share", () => {
    const r = resolveFixedGrid([50, 50], [{ cells: [{ width: 30 }, {}] }, { cells: [{ span: 2, width: 100 }] }]);
    expect(r[0] + r[1]).toBeCloseTo(100, 2);
    expect(r[0]).toBeCloseTo(37.5, 2);
  });

  it("ignores zero and negative widths", () => {
    expect(resolveFixedGrid([10, 10], [{ cells: [{ width: 0 }, { width: -5 }] }])).toEqual([10, 10]);
  });

  it("columnWidthsOf takes the widest colwidth per column across rows", () => {
    const t = table(row(cell("a", { colwidth: [50] }), cell("b")), row(cell("c", { colwidth: [80] }), cell("d", { colwidth: [30] })));
    expect(columnWidthsOf(t)).toEqual([80, 30]);
  });

  it("the editor's table view lays columns out on that grid", () => {
    const e = makeEditor(
      '<table><tbody><tr><td colwidth="50"><p>a</p></td><td><p>b</p></td></tr>' +
        '<tr><td colwidth="90"><p>c</p></td><td colwidth="40"><p>d</p></td></tr></tbody></table>',
    );
    const t = e.state.doc.firstChild!;
    expect(pmColumnWidths(t)).toEqual([90, 40]);
    const cols = e.view.dom.querySelectorAll("colgroup col");
    expect((cols[0] as HTMLElement).style.width).toBe("90px");
    expect((cols[1] as HTMLElement).style.width).toBe("40px");
    expect((e.view.dom.querySelector("table") as HTMLElement).style.width).toBe("130px");
  });
});

// --- normaliser ------------------------------------------------------------------------------

describe("normalizeTable", () => {
  it("leaves a valid table alone", () => {
    const t = table(row(cell("a"), cell("b")), row(cell("c"), cell("d")));
    const r = normalizeTable(t);
    expect(r.fixes).toEqual([]);
    expect(r.table).toEqual(t);
  });

  it("pads ragged rows with empty cells", () => {
    const r = normalizeTable(table(row(cell("a"), cell("b"), cell("c")), row(cell("d")), row()));
    expect(r.fixes).toContain("ragged rows");
    expect(r.fixes).toContain("empty row");
    expect(grid(r.table!)).toEqual([
      ["a", "b", "c"],
      ["d", "", ""],
    ]);
  });

  it("pads with header cells in a header row", () => {
    const r = normalizeTable(table(row({ ...cell("h"), type: "tableHeader" }), row(cell("a"), cell("b"))));
    expect(r.table!.content![0].content!.map((c) => c.type)).toEqual(["tableHeader", "tableHeader"]);
  });

  it("resets invalid spans", () => {
    const r = normalizeTable(table(row(cell("a", { colspan: 0 }), cell("b", { rowspan: 1.5 })), row(cell("c"), cell("d"))));
    expect(r.fixes).toContain("invalid span");
    expect(grid(r.table!)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("clips a rowspan that runs past the last row", () => {
    const r = normalizeTable(table(row(cell("a", { rowspan: 5 }), cell("b")), row(cell("c"))));
    expect(r.fixes).toContain("rowspan past the last row");
    expect(r.table!.content![0].content![0].attrs!.rowspan).toBe(2);
    expect(grid(r.table!)).toEqual([
      ["a", "b"],
      ["a", "c"],
    ]);
  });

  it("clips a colspan that runs into a cell merged from above", () => {
    // Row 2 starts at column 0, but column 1 is covered by "b".
    const t = table(row(cell("a"), cell("b", { rowspan: 2 }), cell("x")), row(cell("c", { colspan: 3 })));
    const r = normalizeTable(t);
    expect(r.fixes).toContain("overlapping merge");
    expect(grid(r.table!)).toEqual([
      ["a", "b", "x"],
      ["c", "b", ""],
    ]);
  });

  it("folds a row covered entirely by merges from above (the bad vMerge case)", () => {
    const t = table(row(cell("a", { rowspan: 3 }), cell("b", { rowspan: 3 })), row(), row(), row(cell("c"), cell("d")));
    const r = normalizeTable(t);
    expect(r.fixes).toContain("row covered by merged cells");
    expect(r.table!.content).toHaveLength(2);
    expect(r.table!.content![0].content!.map((c) => c.attrs!.rowspan)).toEqual([1, 1]);
    expect(grid(r.table!)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("repairs colwidth arrays that don't match their colspan", () => {
    const r = normalizeTable(table(row(cell("a", { colspan: 2, colwidth: [40] }), cell("b", { colwidth: ["x"] })), row(cell("c"), cell("d"), cell("e"))));
    expect(r.fixes).toContain("column widths");
    expect(r.table!.content![0].content![0].attrs!.colwidth).toEqual([40, 40]);
    expect(r.table!.content![0].content![1].attrs!.colwidth).toBeNull();
  });

  it("gives empty cells a paragraph and drops stray content", () => {
    const t = table(row({ type: "tableCell", attrs: { colspan: 1, rowspan: 1 } }, { type: "paragraph" }), { type: "paragraph" });
    const r = normalizeTable(t);
    expect(r.fixes).toEqual(expect.arrayContaining(["empty cell", "content outside cells", "content outside rows"]));
    expect(r.table!.content![0].content![0].content).toEqual([{ type: "paragraph" }]);
  });

  it("returns null for a table with no rows left", () => {
    expect(normalizeTable(table(row(), row())).table).toBeNull();
    expect(normalizeTable(table()).table).toBeNull();
  });

  it("does not modify its input", () => {
    const t = table(row(cell("a")), row(cell("b"), cell("c")));
    const before = JSON.stringify(t);
    normalizeTable(t);
    expect(JSON.stringify(t)).toBe(before);
  });

  it("normalizeTablesIn repairs nested tables and removes empty ones", () => {
    const inner = table(row(cell("x"), cell("y")), row(cell("z")));
    const outer: JSONContent = {
      type: "doc",
      content: [table(row({ ...cell(), content: [inner] })), table(row())],
    };
    const fixes: string[] = [];
    const out = normalizeTablesIn(outer, fixes);
    expect(out.content).toHaveLength(1);
    expect(grid(out.content![0].content![0].content![0].content![0])).toEqual([
      ["x", "y"],
      ["z", ""],
    ]);
    expect(fixes).toContain("ragged rows");
  });

  it("the result is a table ProseMirror accepts as-is", () => {
    const e = makeEditor("<p></p>");
    const r = normalizeTable(table(row(cell("a", { rowspan: 9 }), cell("b")), row(), row(cell("c", { colspan: 4 }))));
    const node = e.schema.nodeFromJSON(r.table!);
    node.check();
    const map = TableMap.get(node);
    expect(map.problems ?? null).toBeNull();
  });
});

describe("correctBadTable", () => {
  it("turns a continuation under a different span into a new merge", () => {
    const rows = correctBadTable([
      { cells: [{ span: 2, vMerge: "restart" }, { span: 1, vMerge: null }] },
      { cells: [{ span: 1, vMerge: "continue" }, { span: 1, vMerge: null }, { span: 1, vMerge: null }] },
    ]);
    expect(rows[1].cells[0].vMerge).toBe("restart");
  });

  it("keeps a valid continuation and a row with only some continuations", () => {
    const rows = correctBadTable([
      { cells: [{ span: 1, vMerge: "restart" }, { span: 1, vMerge: null }] },
      { cells: [{ span: 1, vMerge: "continue" }, { span: 1, vMerge: null }] },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[1].cells[0].vMerge).toBe("continue");
  });

  it("respects gridBefore", () => {
    const rows = correctBadTable([
      { cells: [{ span: 1, vMerge: null }, { span: 1, vMerge: "restart" }] },
      { before: 1, cells: [{ span: 1, vMerge: "continue" }] },
    ]);
    expect(rows).toHaveLength(1);
  });
});

// --- encodings and CSS -------------------------------------------------------------------------

describe("table attribute encodings", () => {
  it("borders round-trip, including explicit none", () => {
    const raw = encodeTableBorders({
      top: { width: 1.5, style: "double", color: "#ff0000" },
      insideV: { width: 0, style: "none", color: "#000000" },
    });
    expect(raw).toBe('{"insideV":"none","top":"1.5 double #ff0000"}');
    expect(parseTableBorders(raw)).toEqual({
      top: { width: 1.5, style: "double", color: "#ff0000" },
      insideV: { width: 0, style: "none", color: "#000000" },
    });
    expect(parseTableBorders("{bad")).toEqual({});
    expect(encodeTableBorders({})).toBeNull();
  });

  it("margins round-trip and reject junk", () => {
    expect(encodeMargins({ top: 1, right: 5.4, bottom: 0, left: 5.4 })).toBe("1 5.4 0 5.4");
    expect(parseMargins("1 5.4 0 5.4")).toEqual({ top: 1, right: 5.4, bottom: 0, left: 5.4 });
    expect(parseMargins("1 2 3")).toBeNull();
    expect(parseMargins("a b c d")).toBeNull();
  });

  it("look defaults to Word's (header, first column, banded rows)", () => {
    expect(parseLook(null)).toEqual(DEFAULT_LOOK);
    expect(encodeLook(parseLook("banded lastRow"))).toBe("banded lastRow");
    expect(encodeLook(parseLook(""))).toBe("");
  });

  it("templates are found by Word id or name", () => {
    expect(findTemplate("Grid Table 4 - Accent 1")?.id).toBe("GridTable4-Accent1");
    expect(findTemplate("tablegrid")?.name).toBe("Table Grid");
    expect(findTemplate("Fancy")).toBeNull();
    expect(new Set(TABLE_TEMPLATES.map((t) => t.id)).size).toBe(TABLE_TEMPLATES.length);
  });

  it("CSS: legacy defaults, a rule per template, bands after the header", () => {
    const rules = tableCssRules(".ProseMirror");
    expect(rules[".ProseMirror table"]["--tbl-top"]).toBe("1px solid #ccced1");
    for (const t of TABLE_TEMPLATES) expect(rules[`.ProseMirror table[data-table-style="${t.id}"]`]).toBeDefined();
    const band = Object.keys(rules).find((k) => k.includes("GridTable4-Accent1") && k.includes('[data-look~="header"] > tbody > tr:nth-child(even)'));
    expect(band && rules[band]["background-color"]).toBe("#d9e2f3");
    expect(tableCss()).toMatch(/table\[data-table-style="TableGrid"\]\{--tbl-top:0\.5pt solid #000000/);
  });

  it("distributeEvenly keeps the total", () => {
    expect(distributeEvenly(10, 3)).toEqual([4, 3, 3]);
    expect(distributeEvenly(9, 3)).toEqual([3, 3, 3]);
  });
});

// --- commands on an editor -------------------------------------------------------------------------

describe("table commands", () => {
  it("insertTableSized builds rows x cols", () => {
    const e = makeEditor("<p></p>");
    insertTableSized(e, 4, 5);
    const map = TableMap.get(e.state.doc.firstChild!);
    expect([map.height, map.width]).toEqual([4, 5]);
  });

  it("table style, look, borders, margins, layout and alignment render and persist in HTML", () => {
    const e = makeEditor(tableHtml([["a", "b"], ["c", "d"]]));
    caretIn(e, 0, 0);
    applyTableStyle(e, "GridTable4-Accent1");
    setLookOption(e, "firstCol", false);
    setTableBorders(e, "outer", { width: 2.25, style: "double", color: "#c00000" });
    setTableProps(e, { cellMargins: encodeMargins({ top: 2, right: 6, bottom: 2, left: 6 }), layout: "fixed", align: "center" });
    const el = e.view.dom.querySelector("table") as HTMLElement;
    expect(el.getAttribute("data-table-style")).toBe("GridTable4-Accent1");
    expect(el.getAttribute("data-look")).toBe("header banded");
    expect(el.style.getPropertyValue("--tbl-top")).toBe("2.25pt double #c00000");
    expect(el.style.getPropertyValue("--tbl-pad")).toBe("2pt 6pt 2pt 6pt");
    expect(el.style.tableLayout).toBe("fixed");
    expect(el.style.marginLeft).toBe("auto");

    const html = e.getHTML();
    const e2 = makeEditor(html);
    expect(e2.state.doc.firstChild!.attrs).toMatchObject({
      tableStyle: "GridTable4-Accent1",
      look: "header banded",
      layout: "fixed",
      align: "center",
      cellMargins: "2 6 2 6",
    });
    expect(parseTableBorders(e2.state.doc.firstChild!.attrs.borders).left).toEqual({ width: 2.25, style: "double", color: "#c00000" });
  });

  it("cell borders: outer / inner / sides follow the selection outline", () => {
    const e = makeEditor(tableHtml([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]));
    const red = { width: 1, style: "solid" as const, color: "#ff0000" };
    selectCells(e, 0, 0, 1, 1);
    applyCellBorders(e, "outer", red);
    const b = (r: number, c: number) => Object.keys(parseTableBorders(cellAttrs(e, r, c).borders)).sort();
    expect(b(0, 0)).toEqual(["left", "top"]);
    expect(b(0, 1)).toEqual(["right", "top"]);
    expect(b(1, 0)).toEqual(["bottom", "left"]);
    expect(b(1, 1)).toEqual(["bottom", "right"]);
    expect(b(2, 2)).toEqual([]);

    const e2 = makeEditor(tableHtml([["a", "b"], ["c", "d"]]));
    selectCells(e2, 0, 0, 1, 1);
    applyCellBorders(e2, "insideV", red);
    const b2 = (r: number, c: number) => Object.keys(parseTableBorders(cellAttrs(e2, r, c).borders)).sort();
    expect(b2(0, 0)).toEqual(["right"]);
    expect(b2(0, 1)).toEqual(["left"]);

    applyCellBorders(e2, "none", red);
    expect(parseTableBorders(cellAttrs(e2, 0, 0).borders).top?.style).toBe("none");
    // Explicit none renders as "hidden", which wins over the neighbours'
    // borders in the collapsed model (jsdom's CSS parser drops the value,
    // so check the CSS itself).
    expect(borderCss(parseTableBorders(cellAttrs(e2, 0, 0).borders).top!, "hidden")).toBe("hidden");
  });

  it("vertical alignment and cell margins render on the cell", () => {
    const e = makeEditor(tableHtml([["a", "b"]]));
    caretIn(e, 0, 1);
    setCellProps(e, { verticalAlign: "middle", margins: "0 12 0 12" });
    const td = e.view.dom.querySelectorAll("td")[1] as HTMLElement;
    expect(td.style.verticalAlign).toBe("middle");
    expect([td.style.paddingTop, td.style.paddingRight]).toEqual(["0pt", "12pt"]);
    const e2 = makeEditor(e.getHTML());
    expect(cellAttrs(e2, 0, 1)).toMatchObject({ verticalAlign: "middle", margins: "0 12 0 12" });
  });

  it("setColumnWidth sets every cell in the column; setRowHeight the row", () => {
    const e = makeEditor(tableHtml([["a", "b"], ["c", "d"]]));
    caretIn(e, 1, 1);
    setColumnWidth(e, 144);
    expect(cellAttrs(e, 0, 1).colwidth).toEqual([144]);
    expect(cellAttrs(e, 1, 1).colwidth).toEqual([144]);
    // Unset columns get their measured width (100px headless).
    expect(cellAttrs(e, 0, 0).colwidth).toBeNull();
    setRowHeight(e, 30);
    expect(e.state.doc.firstChild!.child(1).attrs.height).toBe(30);
    expect((e.view.dom.querySelectorAll("tr")[1] as HTMLElement).style.height).toBe("30pt");
  });

  it("distributeColumns evens out widths and keeps the total", () => {
    const e = makeEditor(
      '<table><tbody><tr><td colwidth="100"><p>a</p></td><td colwidth="50"><p>b</p></td><td colwidth="30"><p>c</p></td></tr></tbody></table>',
    );
    caretIn(e, 0, 0);
    expect(distributeColumns(e)).toBe(true);
    expect(pmColumnWidths(e.state.doc.firstChild!)).toEqual([60, 60, 60]);
    // Only the selected columns.
    const e2 = makeEditor(
      '<table><tbody><tr><td colwidth="100"><p>a</p></td><td colwidth="50"><p>b</p></td><td colwidth="30"><p>c</p></td></tr></tbody></table>',
    );
    selectCells(e2, 0, 1, 0, 2);
    distributeColumns(e2);
    expect(pmColumnWidths(e2.state.doc.firstChild!)).toEqual([100, 40, 40]);
  });

  it("distributeRows gives rows their average height", () => {
    const e = makeEditor(tableHtml([["a"], ["b"], ["c"]]));
    caretIn(e, 0, 0);
    expect(distributeRows(e, () => [10, 20, 60])).toBe(true);
    expect([0, 1, 2].map((i) => e.state.doc.firstChild!.child(i).attrs.height)).toEqual([30, 30, 30]);
    // Nothing measured (headless) and no heights: nothing to do.
    const e2 = makeEditor(tableHtml([["a"], ["b"]]));
    caretIn(e2, 0, 0);
    expect(distributeRows(e2)).toBe(false);
  });

  it("autofit: window = 100% with no fixed widths; contents clears widths; fixed freezes them", () => {
    const e = makeEditor('<table><tbody><tr><td colwidth="80"><p>a</p></td><td><p>b</p></td></tr></tbody></table>');
    caretIn(e, 0, 0);
    autofitTable(e, "window");
    expect(currentTableAttrs(e)).toMatchObject({ width: "100%", layout: null });
    expect(pmColumnWidths(e.state.doc.firstChild!)).toEqual([null, null]);
    expect((e.view.dom.querySelector("table") as HTMLElement).style.width).toBe("100%");
    autofitTable(e, "fixed");
    expect(currentTableAttrs(e)).toMatchObject({ width: null, layout: "fixed" });
    expect(pmColumnWidths(e.state.doc.firstChild!)).toEqual([100, 100]);
    autofitTable(e, "contents");
    expect(currentTableAttrs(e)).toMatchObject({ width: null, layout: null });
    expect(pmColumnWidths(e.state.doc.firstChild!)).toEqual([null, null]);
  });

  it("repeat header row marks the rows from the top to the selection", () => {
    const e = makeEditor(tableHtml([["h1"], ["h2"], ["a"], ["b"]]));
    caretIn(e, 1, 0);
    toggleRepeatHeader(e);
    const flags = () => [0, 1, 2, 3].map((i) => e.state.doc.firstChild!.child(i).attrs.repeatHeader);
    expect(flags()).toEqual([true, true, false, false]);
    expect(e.view.dom.querySelectorAll("tr[data-repeat-header]")).toHaveLength(2);
    toggleRepeatHeader(e);
    expect(flags()).toEqual([true, false, false, false]);
  });

  it("splitTable cuts merges that cross the split", () => {
    const e = makeEditor(
      '<table><tbody><tr><td rowspan="3"><p>m</p></td><td><p>a</p></td></tr><tr><td><p>b</p></td></tr><tr><td><p>c</p></td></tr></tbody></table>',
    );
    caretIn(e, 1, 1);
    expect(splitTable(e)).toBe(true);
    const doc = e.getJSON().content!;
    expect(doc.map((n) => n.type)).toEqual(["table", "paragraph", "table"]);
    expect(grid(doc[0])).toEqual([["m", "a"]]);
    expect(grid(doc[2])).toEqual([
      ["", "b"],
      ["", "c"],
    ]);
    expect(doc[2].content![0].content![0].attrs!.rowspan).toBe(2);
    // The caret is in the new paragraph between the halves (as in Word).
    expect(e.state.selection.$from.node(1)).toBe(e.state.doc.child(1));
  });

  it("splitTable at the first row puts a paragraph before the table", () => {
    const e = makeEditor(tableHtml([["a"], ["b"]]));
    caretIn(e, 0, 0);
    splitTable(e);
    expect(e.getJSON().content!.map((n) => n.type)).toEqual(["paragraph", "table"]);
  });

  it("textToTable splits paragraphs at the separator, keeping marks and padding ragged rows", () => {
    // Tabs don't survive HTML parsing, so build the paragraphs as JSON.
    const e = makeEditor("<p></p>");
    const p = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
    const text = (t: string, bold = false): JSONContent => ({ type: "text", text: t, ...(bold ? { marks: [{ type: "bold" }] } : {}) });
    e.commands.setContent({ type: "doc", content: [p(text("Name\tAge")), p(text("Ada", true), text("\t36\tLondon")), p(text("Grace"))] });
    e.commands.selectAll();
    expect(textToTable(e, "tab")).toBe(true);
    const t = firstTable(e);
    expect(grid(t)).toEqual([
      ["Name", "Age", ""],
      ["Ada", "36", "London"],
      ["Grace", "", ""],
    ]);
    expect(t.content![1].content![0].content![0].content![0].marks).toEqual([{ type: "bold" }]);
  });

  it("textToTable with commas, a custom separator and paragraphs", () => {
    const e = makeEditor("<p>a,b</p><p>c,d</p>");
    e.commands.selectAll();
    textToTable(e, "comma");
    expect(grid(firstTable(e))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    const e2 = makeEditor("<p>a|b</p>");
    e2.commands.selectAll();
    textToTable(e2, { custom: "|" });
    expect(grid(firstTable(e2))).toEqual([["a", "b"]]);
    const e3 = makeEditor("<p>1</p><p>2</p><p>3</p>");
    e3.commands.selectAll();
    textToTable(e3, "paragraph", 2);
    expect(grid(firstTable(e3))).toEqual([
      ["1", "2"],
      ["3", ""],
    ]);
  });

  it("tableToText joins cells with the separator; merged slots are empty", () => {
    const e = makeEditor(
      '<table><tbody><tr><td colspan="2"><p>wide</p></td><td><p><em>x</em></p><p>y</p></td></tr><tr><td><p>a</p></td><td><p>b</p></td><td><p>c</p></td></tr></tbody></table>',
    );
    caretIn(e, 1, 0);
    expect(tableToText(e)).toBe(true);
    expect(paragraphTexts(e)).toEqual(["wide\tx y", "a\tb\tc"]);
    expect(e.getJSON().content![0].content!.find((n) => n.text === "x")?.marks).toEqual([{ type: "italic" }]);
    // table -> text -> table gives the same grid back (the merge becomes an
    // empty cell).
    e.commands.selectAll();
    textToTable(e, "tab");
    expect(grid(firstTable(e))).toEqual([
      ["wide", "x y", ""],
      ["a", "b", "c"],
    ]);
  });

  it("pasting a ragged table normalises it", () => {
    const e = makeEditor("<p></p>");
    e.view.pasteHTML('<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td></tr><tr><td rowspan="7">e</td><td>f</td></tr></table>');
    const t = firstTable(e);
    expect(grid(t)).toEqual([
      ["a", "b", "c"],
      ["d", "", ""],
      ["e", "f", ""],
    ]);
    expect(t.content![2].content![0].attrs!.rowspan).toBe(1);
  });

  it("table attributes sync between collaborators", () => {
    const { editors, sync } = makeSyncedEditors(2);
    const [a, b] = editors;
    a.commands.setContent(tableHtml([["x", "y"], ["z", "w"]]));
    sync();
    caretIn(a, 0, 0);
    applyTableStyle(a, "PlainTable1");
    setCellProps(a, { verticalAlign: "bottom", borders: encodeTableBorders({ top: { width: 1, style: "dashed", color: "#00ff00" } }) });
    toggleRepeatHeader(a);
    sync();
    const t = b.state.doc.firstChild!;
    expect(t.attrs.tableStyle).toBe("PlainTable1");
    expect(t.child(0).attrs.repeatHeader).toBe(true);
    expect(t.child(0).child(0).attrs.verticalAlign).toBe("bottom");
    expect(parseTableBorders(t.child(0).child(0).attrs.borders).top?.style).toBe("dashed");
  });
});
