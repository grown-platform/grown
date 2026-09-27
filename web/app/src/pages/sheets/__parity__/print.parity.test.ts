import { describe, expect, it } from "vitest";
import {
  defaultPrintSettings,
  insertPageBreak,
  movePageBreak,
  paginate,
  printableSizePx,
  removePageBreak,
  resetAllPageBreaks,
  type PrintSettings,
  type SheetGeometry,
} from "../printSettings";
import { widthToPx } from "../xlsx/ooxml";

// Ports of OnlyOffice's PrintTests.js onto printSettings.ts. The OnlyOffice
// suite opens a binary sample workbook (19 × 58 used cells, A4 landscape,
// 10 mm margins, fit to one page) and compares page geometry in its own
// pixel units; the ports rebuild the same shape of sheet and check the same
// behaviours (fit-to-page scale, pages once scaling is off, manual breaks
// ignored while fitting, print titles repeated, break editing with undo)
// against Grown's pagination. The page counts are Grown's for that sheet.

const MM = 1 / 25.4;
const base = (): PrintSettings => ({
  ...defaultPrintSettings(),
  paper: "a4",
  orientation: "landscape",
  margins: { top: 10 * MM, bottom: 10 * MM, left: 10 * MM, right: 10 * MM, header: 0, footer: 0 },
  fitToPage: true,
  fitToWidth: 1,
  fitToHeight: 1,
});

function sheet(widths: Record<number, number> = {}): SheetGeometry {
  return {
    colWidth: (c) => widths[c] ?? 64,
    rowHeight: () => 20,
    usedRange: { r1: 0, c1: 0, r2: 57, c2: 18 },
  };
}

class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(public state: T) {}
  apply(f: (s: T) => T) {
    this.past.push(this.state);
    this.future = [];
    this.state = f(this.state);
  }
  undo() {
    const p = this.past.pop();
    if (p) {
      this.future.push(this.state);
      this.state = p;
    }
  }
  redo() {
    const n = this.future.pop();
    if (n) {
      this.past.push(this.state);
      this.state = n;
    }
  }
}

describe("sheets parity: print", () => {
  it("oo:cell/spreadsheet-calculation/PrintTests.js#Test: open print settings ", () => {
    const s = base();
    const avail = printableSizePx(s);
    let p = paginate(sheet(), s);
    expect(p.pages.length).toBe(1);
    expect(p.pages[0].range).toEqual({ r1: 0, c1: 0, r2: 57, c2: 18 });
    expect(p.pages[0].titleRows).toBeNull();
    expect(p.pages[0].titleCols).toBeNull();
    // One page: the scale that fits 58 rows of 20 px into the printable height.
    expect(p.scale).toBe(Math.floor((avail.h / (58 * 20)) * 100) / 100);
    const first = p.scale;

    // Wider first columns shrink the fitted page further (still one page).
    const wide = sheet({ 0: widthToPx(80), 1: widthToPx(50) });
    p = paginate(wide, s);
    expect(p.pages.length).toBe(1);
    expect(p.scale).toBeLessThan(first);
    expect(p.scale).toBe(Math.floor((avail.w / (widthToPx(80) + widthToPx(50) + 17 * 64)) * 100) / 100);

    // 100 % without fitting: two bands of columns × two bands of rows.
    p = paginate(wide, { ...s, fitToPage: false, scale: 100 });
    expect(p.pages.length).toBe(4);
    // A:D is 560 + 350 + 2 × 64 = 1038 px of the 1047 px printable width.
    expect(p.pages[0]).toMatchObject({ scale: 1, range: { r1: 0, c1: 0, r2: 34, c2: 3 } });
    expect(p.pages[1].range).toEqual({ r1: 35, c1: 0, r2: 57, c2: 3 });
    expect(p.pages[2].range).toEqual({ r1: 0, c1: 4, r2: 34, c2: 18 });
    // Across-then-down order swaps pages 2 and 3.
    const over = paginate(wide, { ...s, fitToPage: false, scale: 100, pageOrder: "overThenDown" });
    expect(over.pages[1].range).toEqual({ r1: 0, c1: 4, r2: 34, c2: 18 });
  });

  it("oo:cell/spreadsheet-calculation/PrintTests.js#Test: page break settings ", () => {
    // A manual break at C5 is ignored while the sheet is fitted to one page.
    let s = insertPageBreak(base(), 4, 2);
    expect(s.rowBreaks).toEqual([4]);
    expect(s.colBreaks).toEqual([2]);
    expect(paginate(sheet(), s).pages.length).toBe(1);
    // Without fitting (and at the scale it had), the breaks split the pages.
    s = { ...s, fitToPage: false, scale: 100 };
    const p = paginate(sheet(), s);
    expect(p.pages[0].range).toEqual({ r1: 0, c1: 0, r2: 3, c2: 1 });
    // Columns: A:B | C:R | S (automatic after 16 × 64 px) ; rows: 1:4 | 5:39 | 40:58.
    expect(p.pages.length).toBe(9);
    expect(p.pages.map((x) => x.range.c1).filter((v, i, a) => a.indexOf(v) === i)).toEqual([0, 2, 18]);
    expect(p.pages.map((x) => x.range.r1).filter((v, i, a) => a.indexOf(v) === i)).toEqual([0, 4, 39]);
    // Removing the break restores the automatic pagination.
    expect(paginate(sheet(), removePageBreak(s, 4, 2)).pages.length).toBe(4);
  });

  it("oo:cell/spreadsheet-calculation/PrintTests.js#Test: page break and titles settings ", () => {
    let s: PrintSettings = { ...base(), fitToPage: false, scale: 100, titleCols: [0, 3], titleRows: [0, 4] };
    s = insertPageBreak(s, 3, 1);
    const p = paginate(sheet(), s);
    // Titles take 4 × 64 px and 5 × 20 px of every later page.
    const avail = printableSizePx(s);
    const perPageCols = Math.floor((avail.w - 4 * 64) / 64);
    const perPageRows = Math.floor((avail.h - 5 * 20) / 20);
    expect(p.pages[0].range).toEqual({ r1: 0, c1: 0, r2: 2, c2: 0 });
    // The first band shows the title columns itself; later bands repeat them.
    for (const page of p.pages) {
      expect(page.titleCols).toEqual(page.range.c1 > 3 ? [0, 3] : null);
      expect(page.titleRows).toEqual(page.range.r1 > 4 ? [0, 4] : null);
    }
    const colBands = [...new Set(p.pages.map((x) => `${x.range.c1}-${x.range.c2}`))];
    const rowBands = [...new Set(p.pages.map((x) => `${x.range.r1}-${x.range.r2}`))];
    expect(colBands[1]).toBe(`1-${Math.min(18, perPageCols)}`);
    expect(rowBands[1]).toBe(`3-${Math.min(57, 2 + perPageRows)}`);
    expect(p.pages.length).toBe(colBands.length * rowBands.length);
    expect(p.pages.length).toBe(9);
  });

  it("oo:cell/spreadsheet-calculation/PrintTests.js#Test: page break manipulation ", () => {
    const h = new History<PrintSettings>(defaultPrintSettings());
    const none = (d: string) => {
      expect(h.state.colBreaks, d).toEqual([]);
      expect(h.state.rowBreaks, d).toEqual([]);
    };
    const check = (before: (d: string) => void, after: (d: string) => void, desc: string, skipLastUndo = false) => {
      after("after_" + desc);
      h.undo();
      before("undo_" + desc);
      h.redo();
      after("redo_" + desc);
      if (!skipLastUndo) h.undo();
    };
    const both = (c: number, r: number) => (d: string) => {
      expect(h.state.colBreaks, d).toEqual([c]);
      expect(h.state.rowBreaks, d).toEqual([r]);
    };
    const insert = (c: number, r: number) => h.apply((s) => insertPageBreak(s, r, c));
    const remove = (c: number, r: number) => h.apply((s) => removePageBreak(s, r, c));

    insert(1, 3);
    check(none, both(1, 3), "insert page break_col1row3");
    insert(5, 5);
    check(none, both(5, 5), "insert page break_col5row5");
    insert(1, 1);
    check(none, both(1, 1), "insert page break_col1row1");
    insert(0, 0);
    check(none, none, "insert page break_col0row0");
    insert(0, 1);
    check(none, (d) => {
      expect(h.state.colBreaks, d).toEqual([]);
      expect(h.state.rowBreaks, d).toEqual([1]);
    }, "insert page break_col0row1");
    insert(1, 0);
    check(none, (d) => {
      expect(h.state.colBreaks, d).toEqual([1]);
      expect(h.state.rowBreaks, d).toEqual([]);
    }, "insert page break_col1row0");
    insert(3, 3);
    check(none, both(3, 3), "insert page break_col3row3", true);

    // Removing where there is no break changes nothing.
    remove(4, 4);
    both(3, 3)("remove1");
    remove(3, 3);
    check(both(3, 3), none, "remove page break_col3row3");
    both(3, 3)("remove2");

    insert(5, 5);
    check(both(3, 3), (d) => {
      expect(h.state.colBreaks, d).toEqual([3, 5]);
      expect(h.state.rowBreaks, d).toEqual([3, 5]);
    }, "insert page break_col5row5", true);

    h.apply((s) => resetAllPageBreaks(s));
    check((d) => {
      expect(h.state.colBreaks, d).toEqual([3, 5]);
      expect(h.state.rowBreaks, d).toEqual([3, 5]);
    }, none, "remove all page breaks");

    insert(8, 8);
    check((d) => expect(h.state.colBreaks.length, d).toBe(2), (d) => {
      expect(h.state.colBreaks, d).toEqual([3, 5, 8]);
      expect(h.state.rowBreaks, d).toEqual([3, 5, 8]);
    }, "insert page break_col8row8", true);

    const all3 = (d: string) => {
      expect(h.state.colBreaks, d).toEqual([3, 5, 8]);
      expect(h.state.rowBreaks, d).toEqual([3, 5, 8]);
    };
    h.apply((s) => movePageBreak(s, "col", 3, 4));
    check(all3, (d) => {
      expect(h.state.colBreaks, d).toEqual([4, 5, 8]);
      expect(h.state.rowBreaks, d).toEqual([3, 5, 8]);
    }, "change page col break_from3to4");
    h.apply((s) => movePageBreak(s, "col", 3, 12));
    check(all3, (d) => {
      expect(h.state.colBreaks, d).toEqual([12]);
      expect(h.state.rowBreaks, d).toEqual([3, 5, 8]);
    }, "change page col break_from3to12");
    h.apply((s) => movePageBreak(s, "row", 3, 12));
    check(all3, (d) => {
      expect(h.state.colBreaks, d).toEqual([3, 5, 8]);
      expect(h.state.rowBreaks, d).toEqual([12]);
    }, "change page row break_from3to12");
    h.apply((s) => movePageBreak(s, "col", 8, 2));
    check(all3, (d) => {
      expect(h.state.colBreaks, d).toEqual([2]);
      expect(h.state.rowBreaks, d).toEqual([3, 5, 8]);
    }, "change page col break_from8to2");
    h.apply((s) => movePageBreak(s, "row", 8, 2));
    check(all3, (d) => {
      expect(h.state.colBreaks, d).toEqual([3, 5, 8]);
      expect(h.state.rowBreaks, d).toEqual([2]);
    }, "change page row break_from8to2");
  });
});
