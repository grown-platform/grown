import { describe, expect, it } from "vitest";
import { newElement, newTable, type SlideElement } from "./model";
import {
  anchorOf,
  canSplit,
  cellFormat,
  cellTextEl,
  clearCells,
  colWidths,
  deleteCols,
  deleteRows,
  distributeCols,
  expandRange,
  insertCols,
  insertRows,
  isCovered,
  mergeCells,
  moveCell,
  newTableElement,
  parseCellId,
  resizeColumn,
  resizeRow,
  rowHeights,
  setBorders,
  setCellFill,
  setCellText,
  setLook,
  setTableStyle,
  splitCell,
  tableKey,
  type CellSel,
} from "./tableOps";
import { cellRole, findTableTemplate, MEDIUM_STYLE_2_ACCENT_1, NO_STYLE_TABLE_GRID, templateCell, tint } from "./tableStyles";
import { formatRange } from "./textOps";

function grid(rows: number, cols: number): SlideElement {
  const el = { ...newElement("table"), x: 0, y: 0, w: cols * 100, h: rows * 40 };
  const t = newTable(rows, cols);
  t.cells = t.cells.map((row, r) => row.map((_, c) => `${r}${c}`));
  return { ...el, table: t };
}

describe("table geometry", () => {
  it("scales relative widths/heights to the element box", () => {
    const el = grid(2, 3);
    expect(colWidths(el)).toEqual([100, 100, 100]);
    const w = { ...el, w: 600, table: { ...el.table!, colW: [1, 2, 3] } };
    expect(colWidths(w)).toEqual([100, 200, 300]);
    expect(rowHeights(el)).toEqual([40, 40]);
  });

  it("dragging an inner column line trades width; the right edge resizes the table", () => {
    const el = grid(2, 3);
    const a = resizeColumn(el, 1, 30);
    expect(colWidths(a)).toEqual([130, 70, 100]);
    expect(a.w).toBe(300);
    const b = resizeColumn(el, 3, 50);
    expect(b.w).toBe(350);
    expect(colWidths(b)).toEqual([100, 100, 150]);
    // clamped to the minimum cell size
    expect(colWidths(resizeColumn(el, 1, 500))[1]).toBe(12);
  });

  it("dragging a row line grows the table", () => {
    const el = resizeRow(grid(2, 2), 1, 20);
    expect(el.h).toBe(100);
    expect(rowHeights(el)).toEqual([60, 40]);
  });

  it("distributes columns evenly and drops colW when uniform", () => {
    const el = resizeColumn(grid(2, 3), 1, 30);
    const d = distributeCols(el);
    expect(d.table!.colW).toBeUndefined();
    expect(colWidths(d)).toEqual([100, 100, 100]);
  });
});

describe("rows and columns", () => {
  it("inserts a row above/below and grows the table", () => {
    const el = grid(2, 2);
    const a = insertRows(el, 1);
    expect(a.table!.rows).toBe(3);
    expect(a.table!.cells.map((r) => r.join(","))).toEqual(["00,01", ",", "10,11"]);
    expect(a.h).toBe(120);
    const top = insertRows(el, 0, 2);
    expect(top.table!.cells[0]).toEqual(["", ""]);
    expect(top.table!.rows).toBe(4);
  });

  it("inserts a column and widens the table", () => {
    const el = insertCols(grid(2, 2), 2);
    expect(el.table!.cols).toBe(3);
    expect(el.table!.cells[0]).toEqual(["00", "01", ""]);
    expect(el.w).toBe(300);
  });

  it("new rows copy the neighbouring row's formatting, not its text", () => {
    const el = setCellFill(grid(2, 2), { r0: 0, c0: 0, r1: 0, c1: 1 }, "#ff0000");
    const a = insertRows(el, 1);
    expect(a.table!.props![1][0]).toEqual({ fill: "#ff0000" });
    expect(a.table!.cells[1][0]).toBe("");
  });

  it("deletes rows and columns; deleting everything returns null", () => {
    const el = grid(3, 3);
    const a = deleteRows(el, 1, 1)!;
    expect(a.table!.cells.map((r) => r.join(","))).toEqual(["00,01,02", "20,21,22"]);
    expect(a.h).toBe(80);
    const b = deleteCols(el, 0, 1)!;
    expect(b.table!.cells[0]).toEqual(["02"]);
    expect(b.w).toBe(100);
    expect(deleteRows(el, 0, 2)).toBeNull();
    expect(deleteCols(el, 0, 2)).toBeNull();
  });

  it("merges grow when a row is inserted inside them and shrink on delete", () => {
    const m = mergeCells(grid(3, 3), { r0: 0, c0: 0, r1: 1, c1: 0 });
    const a = insertRows(m, 1);
    expect(a.table!.merges).toEqual([{ r: 0, c: 0, rs: 3, cs: 1 }]);
    const b = deleteRows(a, 0, 0)!;
    // the anchor row went: the merge keeps its content on the first surviving row
    expect(b.table!.merges).toEqual([{ r: 0, c: 0, rs: 2, cs: 1 }]);
    expect(b.table!.cells[0][0]).toBe("00\n10");
    const c = deleteCols(insertCols(m, 3), 1, 1)!;
    expect(c.table!.merges).toEqual([{ r: 0, c: 0, rs: 2, cs: 1 }]);
  });
});

describe("merge and split", () => {
  it("merges a range, joining non-empty contents as paragraphs", () => {
    const el = mergeCells(grid(3, 3), { r0: 0, c0: 0, r1: 1, c1: 1 });
    const t = el.table!;
    expect(t.merges).toEqual([{ r: 0, c: 0, rs: 2, cs: 2 }]);
    expect(t.cells[0][0]).toBe("00\n01\n10\n11");
    expect(t.cells[1][1]).toBe("");
    expect(isCovered(t, 1, 1)).toBe(true);
    expect(isCovered(t, 0, 0)).toBe(false);
    expect(anchorOf(t, 1, 0)).toEqual([0, 0]);
  });

  it("a range touching a merge grows to include all of it", () => {
    const el = mergeCells(grid(3, 3), { r0: 0, c0: 1, r1: 1, c1: 1 });
    expect(expandRange(el.table!, { r0: 1, c0: 0, r1: 1, c1: 1 })).toEqual({ r0: 0, c0: 0, r1: 1, c1: 1 });
  });

  it("splits a merged cell back into cells", () => {
    const m = mergeCells(grid(2, 4), { r0: 0, c0: 0, r1: 1, c1: 3 });
    expect(canSplit(m.table!, 0, 0, 2, 4)).toBe(true);
    expect(canSplit(m.table!, 0, 0, 1, 3)).toBe(false);
    expect(splitCell(m, 0, 0, 2, 4).table!.merges).toBeUndefined();
    expect(splitCell(m, 0, 0, 1, 2).table!.merges).toEqual([
      { r: 0, c: 0, rs: 2, cs: 2 },
      { r: 0, c: 2, rs: 2, cs: 2 },
    ]);
  });

  it("splits a single cell by adding grid columns/rows (others span them)", () => {
    const el = splitCell(grid(2, 2), 0, 1, 1, 2);
    const t = el.table!;
    expect(t.cols).toBe(3);
    expect(el.w).toBe(200);
    expect(colWidths(el)).toEqual([100, 50, 50]);
    expect(t.merges).toEqual([{ r: 1, c: 1, rs: 1, cs: 2 }]);
    const r = splitCell(grid(2, 2), 0, 0, 2, 1);
    expect(r.table!.rows).toBe(3);
    expect(r.table!.merges).toEqual([{ r: 0, c: 1, rs: 2, cs: 1 }]);
    expect(rowHeights(r)).toEqual([20, 20, 40]);
  });
});

describe("fills, borders, styles", () => {
  it("cell fill overrides the legacy fill", () => {
    const el = { ...setCellFill(grid(2, 2), { r0: 0, c0: 0, r1: 0, c1: 0 }, "#ff0000"), fill: "#eeeeee" };
    expect(cellFormat(el, 0, 0).fill).toBe("#ff0000");
    expect(cellFormat(el, 1, 1).fill).toBe("#eeeeee");
    expect(cellFormat(setCellFill(el, { r0: 0, c0: 0, r1: 0, c1: 0 }, null), 0, 0).fill).toBe("#eeeeee");
  });

  it("outer borders set the range edges and the neighbours' facing sides", () => {
    const line = { color: "#ff0000", width: 2 };
    const el = setBorders(grid(3, 3), { r0: 1, c0: 1, r1: 1, c1: 1 }, "outer", line);
    const p = el.table!.props!;
    expect(p[1][1]!.borders).toEqual({ t: line, r: line, b: line, l: line });
    expect(p[0][1]!.borders).toEqual({ b: line });
    expect(p[1][0]!.borders).toEqual({ r: line });
    expect(p[2][1]!.borders).toEqual({ t: line });
  });

  it("inner / inside-H presets set only the inner lines of a range", () => {
    const line = { color: "#000000", width: 1 };
    const el = setBorders(grid(2, 2), { r0: 0, c0: 0, r1: 1, c1: 1 }, "insideH", line);
    const p = el.table!.props!;
    expect(p[0][0]!.borders).toEqual({ b: line });
    expect(p[1][0]!.borders).toEqual({ t: line });
    const none = setBorders(grid(2, 2), { r0: 0, c0: 0, r1: 1, c1: 1 }, "none", line);
    expect(cellFormat(none, 0, 0).borders.t).toBeUndefined();
  });

  it("table style: header row and banded rows (Medium Style 2 - Accent 1)", () => {
    const el = newTableElement(4, 3);
    expect(el.table!.style).toBe(MEDIUM_STYLE_2_ACCENT_1);
    expect(cellFormat(el, 0, 0).fill).toBe("#4472c4");
    expect(cellFormat(el, 1, 0).fill).toBe(tint("#4472c4", 0.4));
    expect(cellFormat(el, 2, 0).fill).toBe(tint("#4472c4", 0.2));
    expect(cellTextEl(el, 0, 0)).toMatchObject({ bold: true, color: "#ffffff" });
    expect(cellTextEl(el, 1, 0).bold).toBeUndefined();
    const noHeader = setLook(el, "header", false);
    expect(cellFormat(noHeader, 0, 0).fill).toBe(tint("#4472c4", 0.4));
    expect(setTableStyle(el, undefined).table!.style).toBeUndefined();
  });

  it("cellRole counts bands after the header row", () => {
    expect(cellRole({ header: true, banded: true }, 5, 2, 1, 0).bandRow).toBe(true);
    expect(cellRole({ header: true, banded: true }, 5, 2, 2, 0).bandRow).toBe(false);
    expect(cellRole({ banded: true }, 5, 2, 0, 0).bandRow).toBe(true);
    const tpl = findTableTemplate(NO_STYLE_TABLE_GRID);
    expect(templateCell(tpl, {}, 2, 2, 0, 0).borders.t).toEqual({ color: "#000000", width: 1 });
  });
});

describe("rich cell text", () => {
  it("a cell edits as a text element and keeps runs and overrides", () => {
    const el = newTableElement(2, 2);
    const te = cellTextEl(el, 1, 1);
    expect(te.id).toBe(`${el.id}:1:1`);
    expect(parseCellId(te.id)).toEqual({ tableId: el.id, r: 1, c: 1 });
    const edited = formatRange({ ...te, text: "Hello world" }, 0, 5, { bold: true });
    const next = setCellText(el, 1, 1, edited);
    expect(next.table!.cells[1][1]).toBe("Hello world");
    expect(next.table!.props![1][1]!.runs).toEqual([{ text: "Hello", bold: true }, { text: " world" }]);
    expect(cellTextEl(next, 1, 1).runs).toEqual([{ text: "Hello", bold: true }, { text: " world" }]);
  });

  it("un-bolding a header cell stores an explicit override", () => {
    const el = newTableElement(2, 2);
    const te = cellTextEl(el, 0, 0);
    const next = setCellText(el, 0, 0, { ...te, text: "H", bold: undefined });
    expect(next.table!.props![0][0]!.style).toEqual({ bold: false });
    expect(cellTextEl(next, 0, 0).bold).toBe(false);
  });

  it("clearCells empties text but keeps fills", () => {
    const el = setCellFill(grid(2, 2), { r0: 0, c0: 0, r1: 0, c1: 0 }, "#00ff00");
    const c = clearCells(el, { r0: 0, c0: 0, r1: 1, c1: 1 });
    expect(c.table!.cells.flat().every((s) => s === "")).toBe(true);
    expect(c.table!.props![0][0]!.fill).toBe("#00ff00");
  });
});

describe("cell keyboard navigation", () => {
  // OnlyOffice's test walks a 4×4 table: right ×3, left ×2, down, up, Tab ×2,
  // Shift+Tab ×2, then Enter on the table selects the first cell's text,
  // and Enter over a multi-cell selection removes it.
  it("oo:slide/shortcuts/shortcuts.js#Check main actions with shapes (table cell navigation)", () => {
    const t = newTable(4, 4);
    let sel: CellSel = { r: 0, c: 0, r2: 0, c2: 0 };
    const at = () => [sel.r2, sel.c2];
    const press = (key: string, shift = false) => {
      const res = tableKey(t, sel, key, shift);
      if (res?.type === "select") sel = res.sel;
      return res;
    };
    press("ArrowRight");
    expect(at()).toEqual([0, 1]);
    press("ArrowRight");
    expect(at()).toEqual([0, 2]);
    press("ArrowRight");
    expect(at()).toEqual([0, 3]);
    press("ArrowLeft");
    expect(at()).toEqual([0, 2]);
    press("ArrowLeft");
    expect(at()).toEqual([0, 1]);
    press("ArrowDown");
    expect(at()).toEqual([1, 1]);
    press("ArrowUp");
    expect(at()).toEqual([0, 1]);
    press("Tab");
    expect(at()).toEqual([0, 2]);
    press("Tab");
    expect(at()).toEqual([0, 3]);
    press("Tab", true);
    expect(at()).toEqual([0, 2]);
    press("Tab", true);
    expect(at()).toEqual([0, 1]);
    // Enter on a selected table (no active cell) edits the first cell, all selected.
    expect(tableKey(t, null, "Enter", false)).toEqual({ type: "edit", r: 0, c: 0, sel: "all" });
    // Enter over several cells clears them and puts the caret at the start.
    const multi = { r: 0, c: 0, r2: 0, c2: 2 };
    expect(tableKey(t, multi, "Enter", false)).toEqual({
      type: "edit",
      r: 0,
      c: 0,
      sel: "start",
      clear: { r0: 0, c0: 0, r1: 0, c1: 2 },
    });
  });

  it("Tab on the last cell adds a row; arrows skip over merged cells", () => {
    const t = newTable(2, 2);
    expect(tableKey(t, { r: 1, c: 1, r2: 1, c2: 1 }, "Tab", false)).toEqual({
      type: "addRow",
      sel: { r: 2, c: 0, r2: 2, c2: 0 },
    });
    const m = mergeCells({ ...newElement("table"), table: newTable(2, 3) }, { r0: 0, c0: 0, r1: 0, c1: 1 }).table!;
    expect(moveCell(m, 0, 0, "right")).toEqual([0, 2]);
    expect(moveCell(m, 1, 1, "up")).toEqual([0, 0]);
    expect(moveCell(m, 0, 2, "left")).toEqual([0, 0]);
    expect(tableKey(t, { r: 0, c: 0, r2: 0, c2: 0 }, "ArrowRight", true)).toEqual({
      type: "select",
      sel: { r: 0, c: 0, r2: 0, c2: 1 },
    });
  });
});
