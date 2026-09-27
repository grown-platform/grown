import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { deckToPptx } from "./write";
import { readPptx } from "./read";
import type { DeckDoc, SlideElement } from "../model";
import {
  cellFormat,
  cellTextEl,
  colWidths,
  mergeCells,
  newTableElement,
  resizeColumn,
  resizeRow,
  rowHeights,
  setBorders,
  setCellFill,
  setCellText,
  setLook,
  setTableStyle,
} from "../tableOps";
import { effectiveStyle, elementRuns, formatRange } from "../textOps";
import { NO_STYLE_TABLE_GRID } from "../tableStyles";

// Tables through pptx (M5): style + options, merges, per-cell fills and
// borders, sizes and rich cell text survive export → import.

const deckOf = (els: SlideElement[]): DeckDoc => ({ slides: [{ id: "s1", background: "#ffffff", elements: els }] });

async function roundTrip(el: SlideElement): Promise<SlideElement> {
  const r = await readPptx(await deckToPptx(deckOf([el])));
  return r.deck.slides[0].elements[0];
}

async function slideXml(el: SlideElement): Promise<string> {
  const zip = await JSZip.loadAsync(await deckToPptx(deckOf([el])));
  return zip.file("ppt/slides/slide1.xml")!.async("string");
}

/** A styled 4×3 table with a merge, fills, borders, sizes and rich text. */
function sample(): SlideElement {
  let el: SlideElement = { ...newTableElement(4, 3), x: 100, y: 80 };
  const t = el.table!;
  t.cells = [
    ["Region", "Q1", "Q2"],
    ["North", "10", "12"],
    ["South", "7", "9"],
    ["Total", "17", "21"],
  ];
  el = setLook(el, "lastRow", true);
  el = mergeCells(el, { r0: 1, c0: 0, r1: 2, c1: 0 });
  el = setCellFill(el, { r0: 1, c0: 2, r1: 1, c1: 2 }, "#ffe599");
  el = setBorders(el, { r0: 1, c0: 1, r1: 2, c1: 2 }, "outer", { color: "#cc0000", width: 2, dash: "dash" });
  el = resizeColumn(el, 1, 40);
  el = resizeRow(el, 1, 20);
  const te = cellTextEl(el, 0, 1);
  el = setCellText(el, 0, 1, formatRange({ ...te, text: "Q1 sales" }, 3, 8, { italic: true, color: "#00ff00" }));
  const t2 = cellTextEl(el, 1, 1);
  el = setCellText(el, 1, 1, formatRange(t2, 0, 2, { url: "https://grown.example/q1" }));
  return el;
}

/** What a cell looks like: its text and the effective style of each run. */
function look(el: SlideElement, r: number, c: number) {
  const te = cellTextEl(el, r, c);
  return {
    text: te.text,
    runs: elementRuns(te).map((x) => ({ ...effectiveStyle(te, x), text: x.text })),
    align: te.align,
    valign: te.valign,
    format: cellFormat(el, r, c),
  };
}

const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 1));

describe("pptx tables", () => {
  it("writes the style id and options, merges and cell formatting", async () => {
    const xml = await slideXml(sample());
    expect(xml).toContain(`<a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId>`);
    expect(xml).toMatch(/<a:tblPr firstRow="1" bandRow="1" lastRow="1"/);
    expect(xml).toContain(`rowSpan="2"`);
    expect(xml).toContain(`vMerge="1"`);
    expect(xml).toContain(`<a:srgbClr val="FFE599"/>`);
    expect(xml).toMatch(/<a:lnR w="25400"[^>]*><a:solidFill><a:srgbClr val="CC0000"\/><\/a:solidFill><a:prstDash val="dash"\/>/);
    expect(xml).toContain(`<a:hlinkClick r:id=`);
  });

  it("round-trips a styled table with merges, fills, borders, sizes and rich text", async () => {
    const el = sample();
    const back = await roundTrip(el);
    const t = back.table!;
    expect(t.rows).toBe(4);
    expect(t.cols).toBe(3);
    expect(t.cells).toEqual(el.table!.cells);
    expect(t.merges).toEqual([{ r: 1, c: 0, rs: 2, cs: 1 }]);
    expect(t.style).toBe(el.table!.style);
    expect(t.look).toEqual({ header: true, banded: true, lastRow: true });
    near(colWidths(back), colWidths(el));
    near(rowHeights(back), rowHeights(el));
    expect(back.w).toBeCloseTo(el.w, 1);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 3; c++) {
        if (r === 2 && c === 0) continue; // covered by the merge
        expect(look(back, r, c), `cell ${r},${c}`).toEqual(look(el, r, c));
      }
  });

  it("is stable over a second round trip", async () => {
    const once = await roundTrip(sample());
    const twice = await roundTrip(once);
    expect(twice.table).toEqual(once.table);
  });

  it("keeps an unstyled table with mixed borders exact (No Style, No Grid)", async () => {
    let el: SlideElement = { ...newTableElement(2, 2), x: 10, y: 10 };
    el = setTableStyle(el, undefined);
    el = setBorders(el, { r0: 0, c0: 0, r1: 0, c1: 1 }, "bottom", { color: "#000000", width: 1 });
    const back = await roundTrip(el);
    expect(back.table!.style).toBe("{2D5ABB26-0587-4C30-8999-92F81FD0307C}");
    expect(cellFormat(back, 0, 0).borders.b).toEqual({ color: "#000000", width: 1 });
    expect(cellFormat(back, 0, 0).borders.t).toBeUndefined();
    expect(cellFormat(back, 1, 0).borders.t).toEqual({ color: "#000000", width: 1 });
  });

  it("keeps a table grid template", async () => {
    const el = setTableStyle({ ...newTableElement(2, 2), x: 0, y: 0 }, NO_STYLE_TABLE_GRID);
    const back = await roundTrip(el);
    expect(back.table!.style).toBe(NO_STYLE_TABLE_GRID);
    expect(cellFormat(back, 1, 1).borders.r).toEqual({ color: "#000000", width: 1 });
  });

  it("reads an unknown table style as plain cells with a warning", async () => {
    const el = { ...newTableElement(2, 2), x: 0, y: 0 };
    el.table!.style = "{00000000-0000-0000-0000-000000000000}";
    // The writer passes unknown ids through untouched.
    const r = await readPptx(await deckToPptx(deckOf([el])));
    expect(r.deck.slides[0].elements[0].table!.style).toBe("{2D5ABB26-0587-4C30-8999-92F81FD0307C}");
    expect(r.warnings.join()).toMatch(/table style/);
  });
});
