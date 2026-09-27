// @vitest-environment node
// Autofill and series fills (M7): OnlyOffice SerialTests.js and the
// "Autofill …" tests of SheetStructureTests.js, restated against ../autofill.
//
// Cells are written the way a user types them (numbers, "m/d/yyyy" dates,
// text) and results are compared as OnlyOffice's tests compare them: the
// cell's raw value as a string ("45174" for a date serial, "Test2" for
// text, "" for an empty cell). Undo/redo checks of the originals are UI
// plumbing and are not restated.
import { describe, expect, it } from "vitest";
import {
  autofillRange,
  defaultSeriesSettings,
  fillEdge,
  fillMenuOptions,
  fillSeries,
  seriesSettingsForMenu,
  type CellWrite,
  type FillCell,
  type FillDirection,
  type FillMode,
  type SeriesSettings,
} from "../autofill";
import type { CellRect } from "../cellRange";
import { DAY_NAMES, MONTH_NAMES, formatValue, parseInput } from "../numberFormat";

// ---------------------------------------------------------------------------
// A tiny sheet

/** A cell as typed: numbers and dates are parsed, the rest stays text. */
function typed(text: string): FillCell {
  if (text === "") return null;
  const p = parseInput(text, { year: 2000 });
  if (p) return { v: p.value, m: formatValue(p.value, p.format), ct: { fa: p.format, t: p.date ? "d" : "n" } };
  return { v: text, m: text, ct: { fa: "General", t: "g" } };
}

class Sheet {
  cells = new Map<string, FillCell>();
  get = (r: number, c: number): FillCell => this.cells.get(`${r},${c}`) ?? null;
  /** Types `rows` with its top-left corner at (r0, c0). */
  put(r0: number, c0: number, rows: string[][]): this {
    rows.forEach((row, i) => row.forEach((t, j) => this.cells.set(`${r0 + i},${c0 + j}`, typed(t))));
    return this;
  }
  set(r: number, c: number, cell: FillCell): this {
    this.cells.set(`${r},${c}`, cell);
    return this;
  }
  apply(writes: CellWrite[]): this {
    for (const w of writes) this.cells.set(`${w.r},${w.c}`, w.cell);
    return this;
  }
  /** Raw value text, as OnlyOffice's getValue() shows it in these tests. */
  val(r: number, c: number): string {
    const cell = this.get(r, c);
    if (cell == null || cell.v == null) return "";
    return String(cell.v);
  }
  /** Values of the block c1..c2 × r1..r2, row by row. */
  block(c1: number, r1: number, c2: number, r2: number): string[][] {
    const out: string[][] = [];
    for (let r = r1; r <= r2; r++) {
      const row: string[] = [];
      for (let c = c1; c <= c2; c++) row.push(this.val(r, c));
      out.push(row);
    }
    return out;
  }
}

/** Range in OnlyOffice argument order (c1, r1, c2, r2), normalised. */
function R(c1: number, r1: number, c2: number, r2: number): CellRect {
  return { c1: Math.min(c1, c2), r1: Math.min(r1, r2), c2: Math.max(c1, c2), r2: Math.max(r1, r2) };
}

/** Drag direction from a source block to an (unnormalised) fill-handle range. */
function dragDir(src: CellRect, c1: number, r1: number, c2: number, r2: number): FillDirection {
  if (c2 < c1) return "left";
  if (r2 < r1) return "up";
  return c2 > src.c2 ? "right" : "down";
}

function series(p: Partial<SeriesSettings>): SeriesSettings {
  return { seriesIn: "rows", type: "linear", dateUnit: "day", step: 1, stop: null, trend: false, ...p };
}

const col = (xs: string[]) => xs.map((x) => [x]);

/** Series dialog on a fresh sheet: data typed at (r0, c0), selection `sel`. */
function runSeries(data: string[][], at: [number, number], sel: CellRect, s: SeriesSettings): Sheet {
  const sh = new Sheet().put(at[0], at[1], data);
  return sh.apply(fillSeries(sh.get, sel, s));
}

/** The Series dialog opened on `sel` (defaults), tweaked, then applied. */
function runDialog(data: string[][], sel: CellRect, tweak: Partial<SeriesSettings>, at: [number, number] = [0, 0]): Sheet {
  const sh = new Sheet().put(at[0], at[1], data);
  const s = { ...defaultSeriesSettings(sh.get, sel), ...tweak };
  return sh.apply(fillSeries(sh.get, sel, s));
}

/** A drag of the fill handle from `src` to the OnlyOffice handle range (c1, r1, c2, r2). */
function drag(sh: Sheet, src: CellRect, h: [number, number, number, number], mode: FillMode = "auto"): Sheet {
  const dir = dragDir(src, ...h);
  return sh.apply(autofillRange(sh.get, src, R(...h), dir, { mode }));
}

/** "Series" chosen from the drag menu: the dialog's defaults applied over the dragged block. */
function dragSeries(sh: Sheet, src: CellRect, h: [number, number, number, number], tweak: Partial<SeriesSettings> = {}): Sheet {
  const dest = R(...h);
  const fh = { dest, direction: dragDir(src, ...h) };
  const s = { ...defaultSeriesSettings(sh.get, src, fh), ...tweak };
  return sh.apply(fillSeries(sh.get, dest, s));
}

// ===========================================================================
// SerialTests.js

describe("SerialTests.js", () => {
  it("oo:cell/spreadsheet-calculation/SerialTests.js#Autofill linear progression - one filled row/column", () => {
    const one = [["1"]];
    const lin = series({ step: 2 });
    expect(runSeries(one, [0, 0], R(0, 0, 5, 0), lin).block(1, 0, 5, 0)).toEqual([["3", "5", "7", "9", "11"]]);
    expect(runSeries(one, [0, 0], R(0, 0, 0, 5), { ...lin, seriesIn: "columns" }).block(0, 1, 0, 5)).toEqual(col(["3", "5", "7", "9", "11"]));
    expect(runSeries(one, [0, 0], R(0, 0, 5, 0), { ...lin, stop: 7 }).block(1, 0, 5, 0)).toEqual([["3", "5", "7", "", ""]]);
    expect(runSeries(one, [0, 0], R(0, 0, 0, 5), { ...lin, stop: 7, seriesIn: "columns" }).block(0, 1, 0, 5)).toEqual(col(["3", "5", "7", "", ""]));
    // Trend with one number: step 1.
    expect(runSeries(one, [0, 0], R(0, 0, 5, 0), { ...lin, stop: 7, trend: true }).block(1, 0, 5, 0)).toEqual([["2", "3", "4", "5", "6"]]);
    expect(runSeries(one, [0, 0], R(0, 0, 0, 5), { ...lin, stop: 7, trend: true, seriesIn: "columns" }).block(0, 1, 0, 5)).toEqual(col(["2", "3", "4", "5", "6"]));
    // Negative step down to a negative stop value.
    const down = ["1", "0", "-1", "-2", "-3", "-4", "-5", "-6", "-7", "-8", "-9", "-10", ""];
    expect(runDialog(one, R(0, 0, 12, 0), { step: -1, stop: -10 }).block(0, 0, 12, 0)).toEqual([down]);
    expect(runDialog(one, R(0, 0, 0, 12), { step: -1, stop: -10 }).block(0, 0, 0, 12)).toEqual(col(down));
    // A stop value on the wrong side of the start writes nothing.
    expect(runDialog(one, R(0, 0, 2, 0), { step: -1, stop: 10 }).block(0, 0, 2, 0)).toEqual([["1", "", ""]]);
    expect(runDialog(one, R(0, 0, 0, 2), { step: -1, stop: 10 }).block(0, 0, 0, 2)).toEqual(col(["1", "", ""]));
    expect(runDialog(one, R(0, 0, 2, 0), { step: 1, stop: -10 }).block(0, 0, 2, 0)).toEqual([["1", "", ""]]);
    // A stop value equal to (or before) the start leaves the other cells alone.
    expect(runDialog([["1", "2"]], R(0, 0, 2, 0), { stop: 1 }).block(0, 0, 2, 0)).toEqual([["1", "2", ""]]);
    expect(runDialog(col(["1", "2"]), R(0, 0, 0, 2), { stop: 1 }).block(0, 0, 0, 2)).toEqual(col(["1", "2", ""]));
    expect(runDialog([["1", "2"]], R(0, 0, 2, 0), { stop: 0 }).block(0, 0, 2, 0)).toEqual([["1", "2", ""]]);
    // Fractional negative step lands exactly on 0.
    expect(runDialog(one, R(0, 0, 0, 5), { step: -0.2 }).block(0, 0, 0, 5)).toEqual(col(["1", "0.8", "0.6", "0.4", "0.2", "0"]));
    // "Series" from the drag menu fills the dragged block.
    let sh = dragSeries(new Sheet().put(0, 0, [["3"]]), R(0, 0, 0, 0), [0, 0, 3, 0], { step: -1, stop: 1 });
    expect(sh.block(0, 0, 3, 0)).toEqual([["3", "2", "1", ""]]);
    sh = dragSeries(new Sheet().put(0, 0, [["-2"]]), R(0, 0, 0, 0), [0, 0, 0, 3], { step: 1, stop: 0 });
    expect(sh.block(0, 0, 0, 3)).toEqual(col(["-2", "-1", "0", ""]));
    expect(runDialog([["-4"]], R(0, 0, 3, 0), { step: 1, stop: -2 }).block(0, 0, 3, 0)).toEqual([["-4", "-3", "-2", ""]]);
    // Dragged up/left from the cell: the block starts empty, nothing is filled.
    sh = dragSeries(new Sheet().put(3, 3, one), R(3, 3, 3, 3), [3, 3, 3, 0]);
    expect(sh.block(3, 0, 3, 3)).toEqual(col(["", "", "", "1"]));
    sh = dragSeries(new Sheet().put(3, 3, one), R(3, 3, 3, 3), [3, 3, 0, 3]);
    expect(sh.block(0, 3, 3, 3)).toEqual([["", "", "", "1"]]);
  });

  it("oo:cell/spreadsheet-calculation/SerialTests.js#Autofill growth progression - one filled row/column", () => {
    const one = [["1"]];
    const g = series({ type: "growth", step: 2 });
    expect(runSeries(one, [0, 0], R(0, 0, 5, 0), g).block(1, 0, 5, 0)).toEqual([["2", "4", "8", "16", "32"]]);
    expect(runSeries(one, [0, 0], R(0, 0, 0, 5), { ...g, seriesIn: "columns" }).block(0, 1, 0, 5)).toEqual(col(["2", "4", "8", "16", "32"]));
    expect(runSeries(one, [0, 0], R(0, 0, 0, 5), { ...g, seriesIn: "columns", stop: 10 }).block(0, 1, 0, 5)).toEqual(col(["2", "4", "8", "", ""]));
    expect(runSeries(one, [0, 0], R(0, 0, 5, 0), { ...g, stop: 10 }).block(1, 0, 5, 0)).toEqual([["2", "4", "8", "", ""]]);
    // Growth trend through one number stays flat.
    expect(runSeries(one, [0, 0], R(0, 0, 5, 0), { ...g, stop: 10, trend: true }).block(1, 0, 5, 0)).toEqual([["1", "1", "1", "1", "1"]]);
    expect(runSeries(one, [0, 0], R(0, 0, 0, 5), { ...g, seriesIn: "columns", trend: true }).block(0, 1, 0, 5)).toEqual(col(["1", "1", "1", "1", "1"]));
    // A growth step ≤ 0 or 1, or a stop value ≤ 0, writes nothing.
    for (const [step, stop, sel] of [
      [-1, -10, R(0, 0, 2, 0)],
      [-2, 10, R(0, 0, 0, 2)],
      [1, -10, R(0, 0, 2, 0)],
      [1, 10, R(0, 0, 0, 2)],
      [2, -10, R(0, 0, 2, 0)],
      [0, 10, R(0, 0, 0, 2)],
    ] as [number, number, CellRect][]) {
      const sh = runDialog(one, sel, { type: "growth", step, stop });
      expect(sh.block(sel.c1, sel.r1, sel.c2, sel.r2).flat()).toEqual(["1", "", ""]);
    }
    // A step below 1 counts down to the stop value.
    expect(runDialog(one, R(0, 0, 3, 0), { type: "growth", step: 0.5, stop: 0.25 }).block(0, 0, 3, 0)).toEqual([["1", "0.5", "0.25", ""]]);
    let sh = dragSeries(new Sheet().put(3, 3, one), R(3, 3, 3, 3), [3, 3, 3, 0], { type: "growth" });
    expect(sh.block(3, 0, 3, 3)).toEqual(col(["", "", "", "1"]));
    sh = dragSeries(new Sheet().put(3, 3, one), R(3, 3, 3, 3), [3, 3, 0, 3], { type: "growth" });
    expect(sh.block(0, 3, 3, 3)).toEqual([["", "", "", "1"]]);
  });

  it("oo:cell/spreadsheet-calculation/SerialTests.js#Autofill default mode", () => {
    const auto = series({ type: "autofill" });
    expect(runSeries([["1", "2"]], [0, 0], R(0, 0, 5, 0), auto).block(2, 0, 5, 0)).toEqual([["3", "4", "5", "6"]]);
    expect(runSeries(col(["1", "2"]), [0, 0], R(0, 0, 0, 5), { ...auto, seriesIn: "columns" }).block(0, 2, 0, 5)).toEqual(col(["3", "4", "5", "6"]));
    // "Series in" across the selection's short side: every line is one cell, nothing to fill.
    expect(runDialog([["1"]], R(0, 0, 0, 2), { seriesIn: "rows", type: "autofill" }).block(0, 0, 0, 2)).toEqual(col(["1", "", ""]));
    expect(runDialog([["1"]], R(0, 0, 2, 0), { seriesIn: "columns", type: "autofill" }).block(0, 0, 2, 0)).toEqual([["1", "", ""]]);
    const sh = dragSeries(new Sheet().put(0, 0, [["1"]]), R(0, 0, 0, 0), [0, 0, 0, 2], { seriesIn: "rows", type: "autofill" });
    expect(sh.block(0, 0, 0, 2)).toEqual(col(["1", "", ""]));
  });

  it("oo:cell/spreadsheet-calculation/SerialTests.js#Negative cases", () => {
    // A1 empty, A2 text.
    const data = col(["", "Test1"]);
    const base = series({ step: 1 });
    for (const type of ["linear", "growth"] as const) {
      expect(runSeries(data, [0, 0], R(0, 0, 5, 0), { ...base, type }).block(1, 0, 5, 0)).toEqual([["", "", "", "", ""]]);
      expect(runSeries(data, [0, 0], R(0, 0, 0, 5), { ...base, type, seriesIn: "columns" }).block(0, 1, 0, 5)).toEqual(col(["Test1", "", "", "", ""]));
    }
    expect(runSeries(data, [0, 0], R(0, 0, 5, 0), { ...base, type: "autofill" }).block(1, 0, 5, 0)).toEqual([["", "", "", "", ""]]);
    // Autofill repeats the (empty, "Test1") pattern, counting the text up.
    expect(runSeries(data, [0, 0], R(0, 0, 0, 5), { ...base, type: "autofill", seriesIn: "columns" }).block(0, 1, 0, 5)).toEqual(
      col(["Test1", "", "Test2", "", "Test3"]),
    );
    // A row that starts with text is not a linear series.
    expect(runSeries(data, [0, 0], R(0, 1, 5, 1), base).block(1, 0, 5, 0)).toEqual([["", "", "", "", ""]]);
  });

  it("oo:cell/spreadsheet-calculation/SerialTests.js#Autofill horizontal progression - multiple filled cells", () => {
    const starts = col(["1", "2", "3", "4", "5", "6"]);
    const sel = R(0, 0, 5, 5);
    const run = (s: Partial<SeriesSettings>) => runSeries(starts, [0, 0], sel, series(s)).block(1, 0, 5, 5);
    const linear = [1, 2, 3, 4, 5, 6].map((a) => [1, 2, 3, 4, 5].map((k) => String(a + k)));
    expect(run({ step: 1 })).toEqual(linear);
    expect(run({ type: "growth", step: 2 })).toEqual([1, 2, 3, 4, 5, 6].map((a) => [1, 2, 3, 4, 5].map((k) => String(a * 2 ** k))));
    expect(run({ step: 2, stop: 7 })).toEqual([
      ["3", "5", "7", "", ""],
      ["4", "6", "", "", ""],
      ["5", "7", "", "", ""],
      ["6", "", "", "", ""],
      ["7", "", "", "", ""],
      ["", "", "", "", ""],
    ]);
    expect(run({ type: "growth", step: 2, stop: 16 })).toEqual([
      ["2", "4", "8", "16", ""],
      ["4", "8", "16", "", ""],
      ["6", "12", "", "", ""],
      ["8", "16", "", "", ""],
      ["10", "", "", "", ""],
      ["12", "", "", "", ""],
    ]);
    expect(run({ step: 2, stop: 16, trend: true })).toEqual(linear);
    // Growth trend through a single number keeps it; e^ln(3) is not exactly 3.
    expect(run({ type: "growth", step: 2, stop: 16, trend: true })).toEqual(
      ["1", "2", "2.9999999999999996", "4", "5", "6"].map((v) => [v, v, v, v, v]),
    );
    const halves = [
      ["0.5", "0.25", "0.125", "0.0625", "0.03125"],
      ["1", "0.5", "0.25", "0.125", "0.0625"],
      ["1.5", "0.75", "0.375", "0.1875", "0.09375"],
      ["2", "1", "0.5", "0.25", "0.125"],
      ["2.5", "1.25", "0.625", "0.3125", "0.15625"],
      ["3", "1.5", "0.75", "0.375", "0.1875"],
    ];
    // Every cell filled: only the first cell of each row counts.
    const full = [0, 1, 2, 3, 4, 5].map((a) => [1, 2, 3, 4, 5, 6].map((k) => String(a + k)));
    expect(runSeries(full, [0, 0], sel, series({ type: "growth", step: 0.5 })).block(1, 0, 5, 5)).toEqual(halves);
    // Same away from A1.
    expect(runSeries(starts, [1, 2], R(2, 1, 7, 6), series({ type: "growth", step: 0.5 })).block(3, 1, 7, 6)).toEqual(halves);
  });

  it("oo:cell/spreadsheet-calculation/SerialTests.js#Autofill vertical progression - multiple filled cells", () => {
    const starts = [["1", "2", "3", "4", "5", "6"]];
    const sel = R(0, 0, 5, 5);
    const run = (s: Partial<SeriesSettings>) => runSeries(starts, [0, 0], sel, series({ seriesIn: "columns", ...s })).block(0, 1, 5, 5);
    const linear = [1, 2, 3, 4, 5].map((k) => [1, 2, 3, 4, 5, 6].map((a) => String(a + k)));
    expect(run({ step: 1 })).toEqual(linear);
    expect(run({ type: "growth", step: 2 })).toEqual([1, 2, 3, 4, 5].map((k) => [1, 2, 3, 4, 5, 6].map((a) => String(a * 2 ** k))));
    expect(run({ step: 2, stop: 10 })).toEqual([
      ["3", "4", "5", "6", "7", "8"],
      ["5", "6", "7", "8", "9", "10"],
      ["7", "8", "9", "10", "", ""],
      ["9", "10", "", "", "", ""],
      ["", "", "", "", "", ""],
    ]);
    expect(run({ type: "growth", step: 2, stop: 32 })).toEqual([
      ["2", "4", "6", "8", "10", "12"],
      ["4", "8", "12", "16", "20", "24"],
      ["8", "16", "24", "32", "", ""],
      ["16", "32", "", "", "", ""],
      ["32", "", "", "", "", ""],
    ]);
    expect(run({ step: 2, stop: 32, trend: true })).toEqual(linear);
    const flat = ["1", "2", "2.9999999999999996", "4", "5", "6"];
    expect(run({ type: "growth", step: 2, stop: 32, trend: true })).toEqual([flat, flat, flat, flat, flat]);
    const down = [
      ["0", "1", "2", "3", "4", "5"],
      ["-1", "0", "1", "2", "3", "4"],
      ["-2", "-1", "0", "1", "2", "3"],
      ["-3", "-2", "-1", "0", "1", "2"],
      ["-4", "-3", "-2", "-1", "0", "1"],
    ];
    const full = [0, 1, 2, 3, 4, 5].map(() => ["1", "2", "3", "4", "5", "6"]);
    expect(runSeries(full, [0, 0], sel, series({ seriesIn: "columns", step: -1 })).block(0, 1, 5, 5)).toEqual(down);
    expect(runSeries(starts, [1, 1], R(1, 1, 6, 6), series({ seriesIn: "columns", step: -1 })).block(1, 2, 6, 6)).toEqual(down);
  });

  it("oo:cell/spreadsheet-calculation/SerialTests.js#Autofill Date type - one filled row/column", () => {
    const d = [["09/04/2023"]];
    const date = (p: Partial<SeriesSettings>) => series({ type: "date", ...p });
    const rowCol = (s: Partial<SeriesSettings>, n: number, want: string[]) => {
      expect(runSeries(d, [0, 0], R(0, 0, n, 0), date(s)).block(1, 0, n, 0)).toEqual([want]);
      expect(runSeries(d, [0, 0], R(0, 0, 0, n), date({ ...s, seriesIn: "columns" })).block(0, 1, 0, n)).toEqual(col(want));
    };
    rowCol({ dateUnit: "day" }, 5, ["45174", "45175", "45176", "45177", "45178"]);
    // Weekdays skip Saturday 9 and Sunday 10 September.
    rowCol({ dateUnit: "weekday" }, 7, ["45174", "45175", "45176", "45177", "45180", "45181", "45182"]);
    rowCol({ dateUnit: "month", step: 2 }, 5, ["45234", "45295", "45355", "45416", "45477"]);
    rowCol({ dateUnit: "year" }, 5, ["45539", "45904", "46269", "46634", "47000"]);
    expect(runSeries(d, [0, 0], R(0, 0, 5, 0), date({ stop: 45176 })).block(1, 0, 5, 0)).toEqual([["45174", "45175", "45176", "", ""]]);
    expect(runSeries(d, [1, 1], R(1, 1, 1, 6), date({ stop: 45176, seriesIn: "columns" })).block(1, 2, 1, 6)).toEqual(
      col(["45174", "45175", "45176", "", ""]),
    );
    // 1900-01-01 (serial 1), where the 1900 date system has its fake 29 February.
    const y1900 = [["01/01/1900"]];
    const rc1900 = (s: Partial<SeriesSettings>, want: string[]) => {
      expect(runSeries(y1900, [0, 0], R(0, 0, 0, 3), date({ ...s, seriesIn: "columns" })).block(0, 1, 0, 3)).toEqual(col(want));
      expect(runSeries(y1900, [0, 0], R(0, 0, 3, 0), date(s)).block(1, 0, 3, 0)).toEqual([want]);
    };
    rc1900({ step: 2 }, ["3", "5", "7"]);
    rc1900({ step: 2, dateUnit: "weekday" }, ["3", "5", "9"]);
    expect(runSeries(y1900, [0, 0], R(0, 0, 0, 3), date({ step: 2, dateUnit: "month", seriesIn: "columns" })).block(0, 1, 0, 3)).toEqual(col(["61", "122", "183"]));
    expect(runSeries(y1900, [0, 0], R(0, 0, 3, 0), date({ step: 12, dateUnit: "month" })).block(1, 0, 3, 0)).toEqual([["367", "732", "1097"]]);
    expect(runSeries(y1900, [0, 0], R(0, 0, 0, 3), date({ step: 2, dateUnit: "year", seriesIn: "columns" })).block(0, 1, 0, 3)).toEqual(col(["732", "1462", "2193"]));
    expect(runSeries(y1900, [0, 0], R(0, 0, 3, 0), date({ dateUnit: "year" })).block(1, 0, 3, 0)).toEqual([["367", "732", "1097"]]);
    // Dialog defaults on a date, then tweaked.
    const dlg = (data: string[][], sel: CellRect, t: Partial<SeriesSettings>) => runDialog(data, sel, t).block(sel.c1, sel.r1, sel.c2, sel.r2).flat();
    expect(dlg([["01/01/2000"]], R(0, 0, 5, 0), { step: 0.2 })).toEqual(["36526", "36526.2", "36526.4", "36526.6", "36526.8", "36527"]);
    expect(dlg(y1900, R(0, 0, 0, 5), { step: 0.2, dateUnit: "weekday" })).toEqual(["1", "2", "2", "2", "2", "3"]);
    expect(dlg(y1900, R(0, 0, 0, 6), { dateUnit: "weekday" })).toEqual(["1", "2", "3", "4", "5", "6", "9"]);
    // Months and years cannot go backwards.
    expect(dlg(y1900, R(0, 0, 3, 0), { step: -1, dateUnit: "month" })).toEqual(["1", "#NUM!", "#NUM!", "#NUM!"]);
    expect(dlg(y1900, R(0, 0, 0, 3), { step: -1, dateUnit: "year" })).toEqual(["1", "#NUM!", "#NUM!", "#NUM!"]);
    expect(dlg(y1900, R(0, 0, 0, 6), { step: -1, dateUnit: "weekday" })).toEqual(["1", "-1", "-2", "-3", "-4", "-5", "-8"]);
    expect(dlg(y1900, R(0, 0, 5, 0), { step: -1, dateUnit: "day" })).toEqual(["1", "0", "-1", "-2", "-3", "-4"]);
    for (const dateUnit of ["month", "year", "weekday"] as const) {
      expect(dlg(y1900, R(0, 0, 0, 3), { step: -1, stop: -10, dateUnit })).toEqual(["1", "", "", ""]);
    }
    expect(dlg(y1900, R(0, 0, 5, 0), { step: -0.5 })).toEqual(["1", "0.5", "0", "0.5", "0", "0.5"]);
    // Only whole months (years) move the date.
    expect(dlg([["01/01/2000"]], R(0, 0, 5, 0), { step: 0.2, dateUnit: "month" })).toEqual(["36526", "36526", "36526", "36526", "36526", "36557"]);
    expect(dlg(y1900, R(0, 0, 0, 5), { step: 0.2, dateUnit: "year" })).toEqual(["1", "1", "1", "1", "1", "367"]);
    // Plain numbers: the default step is their slope (30.2, 365.3).
    expect(dlg([["1", "32", "61", "92"]], R(0, 0, 10, 0), { type: "date", dateUnit: "month" })).toEqual(
      ["1", "913", "1828", "2739", "3654", "4597", "5511", "6423", "7337", "8249", "9192"],
    );
    expect(dlg(col(["1", "367", "732", "1097"]), R(0, 0, 0, 4), { type: "date", dateUnit: "year" })).toEqual(
      ["1", "133316", "266629", "399943", "533622"],
    );
    expect(dlg([["01/14/2024"]], R(0, 0, 9, 0), { step: 1.2, dateUnit: "weekday" })).toEqual(
      ["45305", "45306", "45307", "45308", "45309", "45313", "45314", "45315", "45316", "45317"],
    );
    expect(dlg([["01/13/2024"]], R(0, 0, 0, 9), { step: 1.2, dateUnit: "weekday" })).toEqual(
      ["45304", "45306", "45307", "45308", "45309", "45313", "45314", "45315", "45316", "45317"],
    );
    expect(dlg([["01/01/2023"]], R(0, 0, 10, 0), { step: -2, dateUnit: "weekday" })).toEqual(
      ["44927", "44924", "44922", "44918", "44916", "44914", "44910", "44908", "44904", "44902", "44900"],
    );
  });

  const DATES = ["01/01/2023", "09/04/2023", "01/12/2023", "12/12/2023"];
  const DATE_STEPS: [Partial<SeriesSettings>, string[][]][] = [
    [
      { dateUnit: "day" },
      [
        ["44930", "44933", "44936", "44939", "44942", "44945"],
        ["45176", "45179", "45182", "45185", "45188", "45191"],
        ["44941", "44944", "44947", "44950", "44953", "44956"],
        ["45275", "45278", "45281", "45284", "45287", "45290"],
      ],
    ],
    [
      { dateUnit: "weekday" },
      [
        ["44930", "44935", "44938", "44943", "44946"],
        ["45176", "45181", "45184", "45189", "45194"],
        ["44943", "44946", "44951", "44956", "44959"],
        ["45275", "45280", "45285", "45288", "45293"],
      ],
    ],
    [
      { dateUnit: "month" },
      [
        ["45017", "45108", "45200", "45292", "45383"],
        ["45264", "45355", "45447", "45539", "45630"],
        ["45028", "45119", "45211", "45303", "45394"],
        ["45363", "45455", "45547", "45638", "45728"],
      ],
    ],
    [
      { dateUnit: "year" },
      [
        ["46023", "47119", "48214", "49310", "50406"],
        ["46269", "47365", "48461", "49556", "50652"],
        ["46034", "47130", "48225", "49321", "50417"],
        ["46368", "47464", "48560", "49655", "50751"],
      ],
    ],
  ];

  it("oo:cell/spreadsheet-calculation/SerialTests.js#Autofill Date type - Horizontal multiple cells", () => {
    for (const [s, want] of DATE_STEPS) {
      const sh = runSeries(col(DATES), [0, 0], R(0, 0, 5, 3), series({ type: "date", step: 3, ...s }));
      expect(sh.block(1, 0, 5, 3).map((row, i) => row.slice(0, want[i].length))).toEqual(want.map((w) => w.slice(0, 5)));
    }
  });

  it("oo:cell/spreadsheet-calculation/SerialTests.js#Autofill Date type - Vertical multiple cells", () => {
    for (const [s, want] of DATE_STEPS) {
      const sh = runSeries([DATES], [0, 0], R(0, 0, 3, 5), series({ type: "date", step: 3, seriesIn: "columns", ...s }));
      const n = want[0].length;
      expect(sh.block(0, 1, 3, n).slice(0, 5)).toEqual(want[0].slice(0, 5).map((_, k) => want.map((w) => w[k])));
    }
  });

  // Rows of the trend tests; `T` transposes them for the column variants.
  const T = (rows: string[][]) => {
    const n = Math.max(...rows.map((r) => r.length));
    return Array.from({ length: n }, (_, k) => rows.map((r) => r[k] ?? ""));
  };
  const TREND_DATA = [["4", "2", "0"], ["16", "8", "4"], ["2", "4", "8"], ["1", "2"], ["1"]];
  const LINEAR_FIT = [
    ["4", "2", "0", "-2", "-4", "-6", "-8"],
    ["15.333333333333334", "9.333333333333334", "3.333333333333334", "-2.666666666666666", "-8.666666666666666", "-14.666666666666666", "-20.666666666666664"],
    ["1.666666666666667", "4.666666666666667", "7.666666666666667", "10.666666666666668", "13.666666666666668", "16.666666666666668", "19.666666666666668"],
    ["1", "2", "3", "4", "5", "6", "7"],
    ["1", "2", "3", "4", "5", "6", "7"],
  ];
  // A zero has no logarithm: that line is left alone.
  const GROWTH_FIT = [
    ["4", "2", "0", "", "", "", ""],
    ["15.999999999999998", "7.999999999999998", "4", "2", "1", "0.49999999999999994", "0.25000000000000006"],
    ["2", "4", "7.999999999999998", "15.999999999999991", "31.999999999999986", "63.99999999999998", "127.99999999999986"],
    ["1", "2", "4", "7.999999999999998", "15.999999999999998", "32", "63.99999999999998"],
    ["1", "1", "1", "1", "1", "1", "1"],
  ];
  // One cell further from A1 the fit is computed on other x values.
  const LINEAR_FIT_SHIFTED = [
    LINEAR_FIT[0],
    ["15.333333333333336", "9.333333333333336", "3.3333333333333357", "-2.6666666666666643", "-8.666666666666664", "-14.666666666666664", "-20.666666666666664"],
    ...LINEAR_FIT.slice(2),
  ];
  const GROWTH_FIT_SHIFTED = [
    GROWTH_FIT[0],
    ["15.999999999999991", "7.999999999999995", "3.999999999999999", "1.9999999999999993", "0.9999999999999996", "0.49999999999999994", "0.24999999999999994"],
    ["2", "4", "7.999999999999995", "15.999999999999991", "31.999999999999986", "63.99999999999992", "127.99999999999986"],
    ["1", "2", "4", "8.000000000000002", "16.000000000000007", "31.999999999999986", "63.99999999999998"],
    GROWTH_FIT[4],
  ];

  /** Trend checks along rows (`v` false) or columns (`v` true, data transposed). */
  function trendChecks(v: boolean) {
    const orient = (rows: string[][]) => (v ? T(rows) : rows);
    const blk = (sh: Sheet, c1: number, r1: number, c2: number, r2: number) =>
      v ? sh.block(r1, c1, r2, c2) : sh.block(c1, r1, c2, r2);
    const sel = (c1: number, r1: number, c2: number, r2: number) => (v ? R(r1, c1, r2, c2) : R(c1, r1, c2, r2));
    const at = (r: number, c: number): [number, number] => (v ? [c, r] : [r, c]);
    const tr = (p: Partial<SeriesSettings>) => series({ trend: true, seriesIn: v ? "columns" : "rows", ...p });

    expect(blk(runSeries(orient([["4", "2", "0"]]), [0, 0], sel(0, 0, 6, 0), tr({})), 3, 0, 6, 0)).toEqual(orient([["-2", "-4", "-6", "-8"]]));
    expect(blk(runSeries(orient([["16", "8", "4"]]), [0, 0], sel(0, 0, 6, 0), tr({ type: "growth" })), 3, 0, 6, 0)).toEqual(
      orient([["2", "1", "0.49999999999999994", "0.25000000000000006"]]),
    );
    expect(blk(runSeries(orient(TREND_DATA), [0, 0], sel(0, 0, 6, 4), tr({})), 0, 0, 6, 4)).toEqual(orient(LINEAR_FIT));
    expect(blk(runSeries(orient(TREND_DATA), [0, 0], sel(0, 0, 6, 4), tr({ type: "growth" })), 0, 0, 6, 4)).toEqual(orient(GROWTH_FIT));
    expect(blk(runSeries(orient(TREND_DATA), at(0, 1), sel(1, 0, 7, 4), tr({})), 1, 0, 7, 4)).toEqual(orient(LINEAR_FIT_SHIFTED));
    expect(blk(runSeries(orient(TREND_DATA), at(0, 1), sel(1, 0, 7, 4), tr({ type: "growth" })), 1, 0, 7, 4)).toEqual(orient(GROWTH_FIT_SHIFTED));
    expect(blk(runSeries(orient(TREND_DATA), at(1, 1), sel(1, 1, 7, 5), tr({ type: "growth" })), 1, 1, 7, 5)).toEqual(orient(GROWTH_FIT_SHIFTED));
    // Growth from 0: no fit, nothing written …
    const zeros = [["0", "1"], ["0", "2"]];
    expect(blk(runSeries(orient(zeros), [0, 0], sel(0, 0, 3, 1), tr({ type: "growth" })), 2, 0, 3, 1)).toEqual(orient([["", ""], ["", ""]]));
    // … but "Growth trend" after a drag fills zeros.
    let sh = new Sheet().put(0, 0, orient(zeros));
    sh = drag(sh, sel(0, 0, 1, 1), v ? [0, 0, 1, 3] : [0, 0, 3, 1], "growthTrend");
    expect(blk(sh, 2, 0, 3, 1)).toEqual(orient([["0", "0"], ["0", "0"]]));
    // Leading empty cells are filled from the fit too.
    const gaps = [["", "1", "2"], ["", "", "3", "5"], ["", "2"]];
    expect(blk(runSeries(orient(gaps), [0, 0], sel(0, 0, 5, 2), tr({})), 0, 0, 5, 2)).toEqual(
      orient([["0", "1", "2", "3", "4", "5"], ["-1", "1", "3", "5", "7", "9"], ["1", "2", "3", "4", "5", "6"]]),
    );
    const ggaps = [["", "2", "4"], ["", "4", "8"], ["", "", v ? "2" : "1"]];
    expect(blk(runSeries(orient(ggaps), [0, 0], sel(0, 0, 5, 2), tr({ type: "growth" })), 0, 0, 5, 2)).toEqual(
      orient([
        ["1", "2", "4", "7.999999999999998", "15.999999999999998", "32"],
        ["2", "4", "7.999999999999998", "15.999999999999991", "31.999999999999986", "63.99999999999998"],
        v ? ["2", "2", "2", "2", "2", "2"] : ["1", "1", "1", "1", "1", "1"],
      ]),
    );
    // "Growth trend" after dragging negative numbers: zeros.
    sh = new Sheet().put(0, 0, orient([["-1", "-2"]]));
    sh = drag(sh, sel(0, 0, 1, 0), v ? [0, 0, 0, 3] : [0, 0, 3, 0], "growthTrend");
    expect(blk(sh, 0, 0, 3, 0)).toEqual(orient([["-1", "-2", "0", "0"]]));
  }

  it("oo:cell/spreadsheet-calculation/SerialTests.js#Fill -> Series. Trend. Horizontal - Multiple cells", () => {
    trendChecks(false);
  });

  it("oo:cell/spreadsheet-calculation/SerialTests.js#Fill -> Series. Trend. Vertical - Multiple cells", () => {
    trendChecks(true);
  });

  it("oo:cell/spreadsheet-calculation/SerialTests.js#Autofill Series. StopValue out of range", () => {
    // A single selected cell runs on past the selection up to the stop value.
    const one = [["1"]];
    expect(runSeries(one, [0, 0], R(0, 0, 0, 0), series({ stop: 10 })).block(0, 0, 10, 0)).toEqual([
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", ""],
    ]);
    expect(runSeries(one, [0, 0], R(0, 0, 0, 0), series({ type: "growth", step: 2, stop: 20 })).block(0, 0, 9, 0)).toEqual([
      ["1", "2", "4", "8", "16", "", "", "", "", ""],
    ]);
    expect(runSeries(one, [0, 0], R(0, 0, 0, 0), series({ step: 2, stop: 15, seriesIn: "columns" })).block(0, 0, 0, 9)).toEqual(
      col(["1", "3", "5", "7", "9", "11", "13", "15", "", ""]),
    );
    expect(runSeries(one, [0, 0], R(0, 0, 0, 0), series({ type: "growth", step: 3, stop: 100, seriesIn: "columns" })).block(0, 0, 0, 9)).toEqual(
      col(["1", "3", "9", "27", "81", "", "", "", "", ""]),
    );
    expect(runSeries(one, [2, 5], R(5, 2, 5, 2), series({ step: 0.5, stop: 6 })).block(5, 2, 16, 2)).toEqual([
      ["1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5", "5.5", "6", ""],
    ]);
    expect(runSeries(one, [2, 5], R(5, 2, 5, 2), series({ type: "growth", step: 10, stop: 10000, seriesIn: "columns" })).block(5, 2, 5, 7)).toEqual(
      col(["1", "10", "100", "1000", "10000", ""]),
    );
  });

  /** Drag-menu trend checks along a row (`v` false) or a column. */
  function contextMenuChecks(v: boolean) {
    const orient = (rows: string[][]) => (v ? T(rows) : rows);
    const blk = (sh: Sheet, c1: number, c2: number) => (v ? sh.block(0, c1, 0, c2) : sh.block(c1, 0, c2, 0));
    const src = (c1: number, c2: number) => (v ? R(0, c1, 0, c2) : R(c1, 0, c2, 0));
    const h = (c1: number, c2: number): [number, number, number, number] => (v ? [0, c1, 0, c2] : [c1, 0, c2, 0]);
    const put = (data: string[], at: number) => new Sheet().put(v ? at : 0, v ? 0 : at, orient([data]));
    const seriesIn = v ? "columns" : "rows";

    expect(blk(drag(put(["4", "2", "0"], 0), src(0, 2), h(0, 5), "linearTrend"), 3, 5)).toEqual(orient([["-2", "-4", "-6"]]));
    expect(blk(drag(put(["4", "2", "0"], 3), src(3, 5), h(5, 0), "linearTrend"), 0, 2)).toEqual(orient([["10", "8", "6"]]));
    expect(blk(drag(put(["2", "4", "8"], 0), src(0, 2), h(0, 5), "growthTrend"), 3, 5)).toEqual(
      orient([["15.999999999999991", "31.999999999999986", "63.99999999999998"]]),
    );
    expect(blk(drag(put(["2", "4", "8"], 3), src(3, 5), h(5, 0), "growthTrend"), 0, 2)).toEqual(
      orient([["0.2500000000000001", "0.5000000000000002", "1.0000000000000002"]]),
    );
    // "Series" with trend rewrites the whole dragged block; a trend option only adds the new cells.
    const trend = (type: "linear" | "growth") => ({ trend: true, type, seriesIn } as Partial<SeriesSettings>);
    if (!v) {
      expect(blk(dragSeries(put(["", "2", "4", ""], 0), src(0, 3), h(0, 5), trend("growth")), 0, 5)).toEqual([
        ["1", "2", "4", "7.999999999999998", "15.999999999999998", "32"],
      ]);
      expect(blk(drag(put(["", "2", "4", ""], 0), src(0, 3), h(0, 5), "growthTrend"), 0, 5)).toEqual([["", "2", "4", "", "15.999999999999998", "32"]]);
      const back = ["0.06250000000000008", "0.1250000000000002", "0.2500000000000003", "0.5000000000000004"];
      expect(blk(dragSeries(put(["", "2", "4", "8"], 4), src(4, 7), h(7, 0), trend("growth")), 0, 7)).toEqual([
        [...back, "1.0000000000000009", "2.0000000000000018", "4.000000000000001", "8.000000000000002"],
      ]);
      expect(blk(drag(put(["", "2", "4", "8"], 4), src(4, 7), h(7, 0), "growthTrend"), 0, 7)).toEqual([[...back, "", "2", "4", "8"]]);
    } else {
      expect(blk(dragSeries(put(["", "1", "2", ""], 0), src(0, 3), h(0, 5), trend("linear")), 0, 5)).toEqual(col(["0", "1", "2", "3", "4", "5"]));
      expect(blk(drag(put(["", "1", "2", ""], 0), src(0, 3), h(0, 5), "linearTrend"), 0, 5)).toEqual(col(["", "1", "2", "", "4", "5"]));
      expect(blk(dragSeries(put(["", "2", "3", "4"], 4), src(4, 7), h(7, 0), trend("linear")), 0, 7)).toEqual(
        col(["-3", "-2", "-1", "0", "1", "2", "3", "4"]),
      );
      expect(blk(drag(put(["", "2", "3", "4"], 4), src(4, 7), h(7, 0), "linearTrend"), 0, 7)).toEqual(col(["-3", "-2", "-1", "0", "", "2", "3", "4"]));
    }
  }

  it("oo:cell/spreadsheet-calculation/SerialTests.js#Autofill Series. Context menu. Horizontal", () => {
    contextMenuChecks(false);
  });

  it("oo:cell/spreadsheet-calculation/SerialTests.js#Autofill Series. Context menu. Vertical", () => {
    contextMenuChecks(true);
  });

  type Menu = Partial<Record<keyof ReturnType<typeof fillMenuOptions>, boolean>>;
  /** Menu flags: the listed ones on, the other options off. */
  const flags = (...on: (keyof Menu)[]) => {
    const m: Record<string, boolean | null> = {
      copyCells: true, fillSeries: false, fillFormattingOnly: null, fillWithoutFormatting: null, fillDays: false, fillWeekdays: false,
      fillMonths: false, fillYears: false, linearTrend: false, growthTrend: false, flashFill: null, series: false,
    };
    for (const k of on) m[k] = true;
    return m;
  };
  const NUMS = flags("fillSeries", "linearTrend", "growthTrend", "series");
  const DATE = flags("fillSeries", "fillDays", "fillWeekdays", "fillMonths", "fillYears", "series");

  it("oo:cell/spreadsheet-calculation/SerialTests.js#CSeriesSettings: method prepare for prepare data in UI", () => {
    type Case = {
      data: string[][];
      at?: [number, number];
      sel: [number, number, number, number];
      handle?: FillDirection;
      want?: Partial<SeriesSettings>;
      menu?: Record<string, boolean | null>;
    };
    const cases: Case[] = [
      { data: [["1", "3"]], sel: [0, 0, 3, 0], want: { seriesIn: "rows", type: "linear", step: 2 }, menu: NUMS },
      { data: [["1", "2"], ["-1", "-2"]], sel: [0, 0, 1, 3], want: { seriesIn: "columns", type: "linear", step: -2 } },
      { data: [["11/08/2023", "11/11/2023"]], sel: [0, 0, 3, 0], want: { seriesIn: "rows", type: "date", step: 3 }, menu: DATE },
      { data: [["11/08/2023", "11/11/2023"]], sel: [0, 0, 1, 3], want: { seriesIn: "columns", type: "date", step: 1 } },
      { data: [], sel: [0, 0, 3, 0], want: { seriesIn: "rows", type: "linear", step: 1 }, menu: flags() },
      { data: [], sel: [0, 0, 0, 3], want: { seriesIn: "columns", type: "linear", step: 1 }, menu: flags() },
      { data: [["Test"]], sel: [0, 0, 0, 3], want: { seriesIn: "columns", type: "linear", step: 1 }, menu: flags() },
      { data: [["Test1", "Test2"]], sel: [0, 0, 3, 0], want: { seriesIn: "rows", step: 1 }, menu: flags("fillSeries") },
      // After a drag of one cell: the drag direction decides "Series in".
      { data: [["1"]], sel: [0, 0, 0, 0], handle: "right", want: { seriesIn: "rows", step: 1 }, menu: flags("fillSeries", "series") },
      { data: [["1"]], sel: [0, 0, 0, 0], handle: "down", want: { seriesIn: "columns", step: 1 }, menu: flags("fillSeries", "series") },
      { data: [["Test"]], sel: [0, 0, 0, 0], handle: "down", menu: flags() },
      // Numbers with room to fill: the step is their slope; all filled: 1.
      { data: [["10", "100", "100"]], sel: [0, 0, 3, 0], want: { seriesIn: "rows", step: 45 }, menu: NUMS },
      { data: [["10", "100", "100"]], sel: [0, 0, 2, 0], want: { seriesIn: "rows", step: 1 }, menu: NUMS },
      { data: col(["10", "100", "100"]), at: [7, 0], sel: [0, 7, 0, 10], want: { seriesIn: "columns", step: 45 }, menu: NUMS },
      { data: col(["10", "100", "100"]), at: [7, 0], sel: [0, 7, 0, 9], want: { seriesIn: "columns", step: 1 }, menu: NUMS },
      { data: [["10", "", "100", "100"]], sel: [0, 0, 4, 0], want: { seriesIn: "rows", step: 32.14285714285714 }, menu: NUMS },
      { data: col(["10", "", "100", "100"]), at: [7, 0], sel: [0, 7, 0, 11], want: { seriesIn: "columns", step: 32.14285714285714 }, menu: NUMS },
      { data: [["0", "2"]], sel: [0, 0, 2, 0], want: { step: 2 }, menu: NUMS },
      { data: [["0", "2"]], sel: [0, 0, 1, 0], want: { step: 1 }, menu: NUMS },
      { data: col(["0", "2"]), sel: [0, 0, 0, 2], want: { seriesIn: "columns", step: 2 }, menu: NUMS },
      // An empty first cell: step 1.
      { data: [["", "1"]], sel: [0, 0, 2, 0], want: { seriesIn: "rows", step: 1 }, menu: flags("fillSeries", "series") },
      { data: col(["", "1"]), sel: [0, 0, 0, 2], want: { seriesIn: "columns", step: 1 }, menu: flags("fillSeries", "series") },
      { data: [["", "", "2", "4"]], sel: [0, 0, 4, 0], want: { seriesIn: "rows", step: 1 }, menu: NUMS },
      { data: col(["", "", "2", "4"]), sel: [0, 0, 0, 4], want: { seriesIn: "columns", step: 1 }, menu: NUMS },
      { data: [["1"]], sel: [0, 0, 0, 1], handle: "down", want: { seriesIn: "columns", step: 1 }, menu: flags("fillSeries", "series") },
      // Dates: days, or months/years when the day of month repeats.
      { data: [["01/01/1900", "02/01/1900", "03/01/1900", "04/01/1900", "05/01/1900"]], sel: [0, 0, 5, 0], want: { seriesIn: "rows", type: "date", dateUnit: "month", step: 1 }, menu: DATE },
      { data: col(["01/01/1900", "01/01/1901", "01/01/1902", "01/01/1903", "01/01/1904"]), sel: [0, 0, 0, 5], want: { seriesIn: "columns", type: "date", dateUnit: "year", step: 1 }, menu: DATE },
      { data: [["01/01/1900", "01/10/1900", "01/11/1900", "01/12/1900", "01/13/1900"]], sel: [0, 0, 5, 0], want: { type: "date", dateUnit: "day", step: 9 }, menu: DATE },
      { data: col(["02/01/2000", "", "02/29/2000"]), sel: [0, 0, 0, 3], want: { seriesIn: "columns", type: "date", dateUnit: "day", step: 14 } },
      { data: [["01/01/1900", "", "02/01/1900"]], sel: [0, 0, 3, 0], want: { type: "date", dateUnit: "day", step: 1 } },
      { data: [["01/01/2000", "03/01/2000", "01/01/2000"]], sel: [0, 0, 3, 0], want: { type: "date", dateUnit: "day", step: 60 } },
      { data: col(["01/01/2000", "01/01/2000", "03/01/2000", "05/01/2000"]), sel: [0, 0, 0, 4], want: { type: "date", dateUnit: "day", step: 0 } },
      { data: [["01/01/1900", "01/01/1902", "01/01/1904", "01/01/1906"]], sel: [0, 0, 4, 0], want: { type: "date", dateUnit: "year", step: 2 } },
      { data: col(["01/01/1900", "05/01/1901", "01/01/1902", "01/01/1903"]), sel: [0, 0, 0, 4], want: { type: "date", dateUnit: "month", step: 16 } },
      { data: [["02/01/1900", "02/01/1901", "06/01/1902", "08/01/1903"]], sel: [0, 0, 4, 0], want: { type: "date", dateUnit: "year", step: 1 } },
      { data: col(["01/01/1900", "01/05/1901", "01/01/1902", "01/01/1903"]), sel: [0, 0, 0, 4], want: { type: "date", dateUnit: "day", step: 370 } },
      { data: [["10/10/2000", "10/10/2001", "10/05/2002", "10/10/2003"]], sel: [0, 0, 4, 0], want: { type: "date", dateUnit: "day", step: 365 } },
      { data: col(["01/01/1903", "01/01/1902", "01/01/1901", "01/01/1900"]), sel: [0, 0, 0, 4], want: { type: "date", dateUnit: "year", step: -1 } },
      { data: [["10/10/2000", "10/10/2000", "10/05/2002", "10/10/2003"]], sel: [0, 0, 4, 0], want: { type: "date", dateUnit: "day", step: 0 } },
      { data: col(["01/01/1905", "01/01/1906", "01/01/1905", "01/01/1904"]), sel: [0, 0, 0, 4], want: { type: "date", dateUnit: "day", step: 365 } },
      // The first cell's format decides the type.
      { data: col(["01/01/1900", "2", "3"]), sel: [0, 0, 0, 3], want: { seriesIn: "columns", type: "date", step: 1 } },
      { data: [["1", "01/02/1900", "01/03/1900"]], sel: [0, 0, 3, 0], want: { seriesIn: "rows", type: "linear", step: 1 } },
      { data: col(["1", "-0.2"]), sel: [0, 0, 0, 2], want: { seriesIn: "columns", type: "linear", step: -1.2 } },
    ];
    for (const c of cases) {
      const sh = new Sheet().put(...(c.at ?? [0, 0]), c.data);
      const sel = R(...c.sel);
      const fh = c.handle ? { dest: sel, direction: c.handle } : undefined;
      const got = defaultSeriesSettings(sh.get, sel, fh);
      expect(got, JSON.stringify(c)).toMatchObject({ dateUnit: "day", stop: null, trend: false, ...c.want });
      if (c.menu) expect(fillMenuOptions(sh.get, sel, fh), JSON.stringify(c)).toEqual(c.menu);
    }
    // A formula in the first cell: step 1 and nothing to offer but copying.
    const sh = new Sheet().set(0, 0, { v: 2, m: "2", f: "=1+1", ct: { fa: "General", t: "n" } }).put(0, 1, [["4"]]);
    expect(defaultSeriesSettings(sh.get, R(0, 0, 3, 0))).toMatchObject({ seriesIn: "rows", type: "linear", step: 1 });
    expect(fillMenuOptions(sh.get, R(0, 0, 3, 0))).toEqual(flags());
  });

  it("oo:cell/spreadsheet-calculation/SerialTests.js#CSeriesSettings: init method for update type and trend step by chosen menu prop", () => {
    const menu = (data: string[][], src: CellRect, dest: CellRect, direction: FillDirection, choice: Parameters<typeof seriesSettingsForMenu>[3]) => {
      const sh = new Sheet().put(0, 0, data);
      return seriesSettingsForMenu(sh.get, src, { dest, direction }, choice);
    };
    expect(menu([["1", "2"]], R(0, 0, 3, 0), R(0, 0, 3, 0), "right", "linearTrend")).toMatchObject({ seriesIn: "rows", type: "linear", trend: true });
    expect(menu([["1", "2"]], R(0, 0, 3, 0), R(0, 0, 3, 0), "right", "growthTrend")).toMatchObject({ seriesIn: "rows", type: "growth", trend: true });
    expect(menu([["01/01/2000", "02/01/2000"]], R(0, 0, 1, 0), R(0, 0, 4, 0), "right", "fillMonths")).toMatchObject({
      seriesIn: "rows", type: "date", dateUnit: "month", trend: false, step: 1,
    });
    expect(menu(col(["01/01/2000", "03/01/2000"]), R(0, 0, 0, 1), R(0, 0, 0, 4), "down", "fillMonths")).toMatchObject({
      seriesIn: "columns", type: "date", dateUnit: "month", trend: false, step: 2,
    });
    expect(menu([["01/01/2000", "01/01/2002"]], R(0, 0, 1, 0), R(0, 0, 4, 0), "right", "fillYears")).toMatchObject({
      seriesIn: "rows", type: "date", dateUnit: "year", trend: false, step: 2,
    });
  });

  it("oo:cell/spreadsheet-calculation/SerialTests.js#applySeriesSettings", () => {
    type Op = FillMode | "dialog";
    type Box = [number, number, number, number];
    /** data typed at `at`, dragged from `src` to handle `h` with `op`; `check` block must equal `want`. */
    const cases: [string[][], [number, number], Box, Box, Op, Box, string[][]][] = [
      [[["2", "4"]], [0, 0], [0, 0, 1, 0], [0, 0, 4, 0], "linearTrend", [2, 0, 4, 0], [["6", "8", "10"]]],
      [[["2", "4"]], [0, 0], [0, 0, 1, 0], [0, 0, 4, 0], "growthTrend", [2, 0, 4, 0], [["7.999999999999998", "15.999999999999991", "31.999999999999986"]]],
      [[["2", "4"]], [0, 0], [0, 0, 1, 0], [0, 0, 4, 0], "copy", [2, 0, 4, 0], [["2", "4", "2"]]],
      [[["2", "4"]], [0, 0], [0, 0, 1, 0], [0, 0, 4, 0], "series", [2, 0, 4, 0], [["6", "8", "10"]]],
      // "Series" after a drag of a fully filled source: step 1 from the first cell.
      [[["2", "4"]], [0, 0], [0, 0, 1, 0], [0, 0, 4, 0], "dialog", [2, 0, 4, 0], [["4", "5", "6"]]],
      [[["2"]], [0, 0], [0, 0, 0, 0], [0, 0, 4, 0], "copy", [1, 0, 4, 0], [["2", "2", "2", "2"]]],
      [[["2"]], [0, 0], [0, 0, 0, 0], [0, 0, 4, 0], "series", [1, 0, 4, 0], [["3", "4", "5", "6"]]],
      [[["2"]], [0, 0], [0, 0, 0, 0], [0, 0, 4, 0], "dialog", [1, 0, 4, 0], [["3", "4", "5", "6"]]],
      [[["01/01/2000"]], [0, 0], [0, 0, 0, 0], [0, 0, 0, 4], "copy", [0, 1, 0, 4], col(["36526", "36526", "36526", "36526"])],
      [[["01/01/2000"]], [0, 0], [0, 0, 0, 0], [0, 0, 0, 4], "series", [0, 1, 0, 4], col(["36527", "36528", "36529", "36530"])],
      // Each column (row) of a multi-cell source is its own series.
      [[["1", "1", "Test1", "Test1", "01/01/2000", "01/01/2000"]], [0, 0], [0, 0, 5, 0], [0, 0, 5, 2], "series", [0, 1, 5, 2],
        [["2", "2", "Test2", "Test2", "36527", "36527"], ["3", "3", "Test3", "Test3", "36528", "36528"]]],
      [[["1", "1", "Test1", "Test1", "01/01/2000", "01/01/2000"]], [0, 0], [0, 0, 5, 0], [0, 0, 5, 2], "copy", [0, 1, 5, 2],
        [["1", "1", "Test1", "Test1", "36526", "36526"], ["1", "1", "Test1", "Test1", "36526", "36526"]]],
      [col(["1", "1", "Test1", "Test1", "01/01/2000", "01/01/2000"]), [0, 0], [0, 0, 0, 5], [0, 0, 2, 5], "series", [1, 0, 2, 5],
        [["2", "3"], ["2", "3"], ["Test2", "Test3"], ["Test2", "Test3"], ["36527", "36528"], ["36527", "36528"]]],
      [col(["1", "1", "Test1", "Test1", "01/01/2000", "01/01/2000"]), [0, 0], [0, 0, 0, 5], [0, 0, 2, 5], "copy", [1, 0, 2, 5],
        [["1", "1"], ["1", "1"], ["Test1", "Test1"], ["Test1", "Test1"], ["36526", "36526"], ["36526", "36526"]]],
      // Fill weekdays.
      [[["01/01/2000"]], [0, 0], [0, 0, 0, 0], [0, 0, 0, 7], "weekdays", [0, 1, 0, 7], col(["36528", "36529", "36530", "36531", "36532", "36535", "36536"])],
      [[["01/01/2000"]], [0, 0], [0, 0, 0, 0], [0, 0, 7, 0], "weekdays", [1, 0, 7, 0], [["36528", "36529", "36530", "36531", "36532", "36535", "36536"]]],
      [[["01/01/2000"]], [7, 0], [0, 7, 0, 7], [0, 7, 0, 0], "weekdays", [0, 0, 0, 6], col(["36517", "36518", "36521", "36522", "36523", "36524", "36525"])],
      [[["01/01/2000"]], [0, 7], [7, 0, 7, 0], [7, 0, 0, 0], "weekdays", [0, 0, 6, 0], [["36517", "36518", "36521", "36522", "36523", "36524", "36525"]]],
      [col(["01/01/2000", "01/03/2000"]), [0, 0], [0, 0, 0, 1], [0, 0, 0, 7], "weekdays", [0, 2, 0, 7], col(["36530", "36532", "36536", "36538", "36542", "36544"])],
      [col(["01/01/2000", "01/03/2000"]), [6, 0], [0, 6, 0, 7], [0, 7, 0, 0], "weekdays", [0, 0, 0, 5], col(["36510", "36514", "36516", "36518", "36522", "36524"])],
      [[["01/02/2000", "01/04/2000", "01/06/2000"]], [0, 0], [0, 0, 2, 0], [0, 0, 7, 0], "weekdays", [3, 0, 7, 0], [["36535", "36537", "36539", "36543", "36545"]]],
      [[["01/02/2000", "01/04/2000", "01/06/2000"]], [0, 5], [5, 0, 7, 0], [7, 0, 0, 0], "weekdays", [0, 0, 4, 0], [["36514", "36516", "36518", "36522", "36524"]]],
      [[["01/01/2000 12:00"]], [0, 0], [0, 0, 0, 0], [0, 0, 0, 7], "weekdays", [0, 1, 0, 7], col(["36528", "36529", "36530", "36531", "36532", "36535", "36536"])],
      [[["01/01/2000 12:00"]], [7, 0], [0, 7, 0, 7], [0, 7, 0, 0], "weekdays", [0, 0, 0, 6], col(["36517", "36518", "36521", "36522", "36523", "36524", "36525"])],
      [[["01/01/2000 12:00", "01/02/2000"]], [0, 0], [0, 0, 1, 0], [0, 0, 7, 0], "weekdays", [2, 0, 7, 0], [["36528", "36529", "36530", "36531", "36532", "36535"]]],
      [[["01/01/2000 12:00", "01/02/2000"]], [0, 6], [6, 0, 7, 0], [7, 0, 0, 0], "weekdays", [0, 0, 5, 0], [["36518", "36521", "36522", "36523", "36524", "36525"]]],
      // Near 1900-01-01: a date before the first one falls back to copying the source.
      [[["01/01/1900"]], [0, 0], [0, 0, 0, 0], [0, 0, 0, 7], "weekdays", [0, 1, 0, 7], col(["2", "3", "4", "5", "6", "9", "10"])],
      [[["01/01/1900"]], [0, 7], [7, 0, 7, 0], [7, 0, 0, 0], "weekdays", [0, 0, 6, 0], [["1", "1", "1", "1", "1", "1", "1"]]],
      [col(["01/01/1900", "01/03/1900"]), [0, 0], [0, 0, 0, 1], [0, 0, 0, 7], "weekdays", [0, 2, 0, 7], col(["5", "9", "11", "13", "17", "19"])],
      [[["01/04/1900", "01/06/1900"]], [0, 6], [6, 0, 7, 0], [7, 0, 0, 0], "weekdays", [0, 0, 5, 0], [["4", "6", "4", "6", "4", "2"]]],
      [col(["01/02/1900", "01/04/1900", "01/06/1900"]), [0, 0], [0, 0, 0, 2], [0, 0, 0, 7], "weekdays", [0, 3, 0, 7], col(["10", "12", "16", "18", "20"])],
      [[["01/09/1900", "01/11/1900", "01/13/1900"]], [0, 5], [5, 0, 7, 0], [7, 0, 0, 0], "weekdays", [0, 0, 4, 0], [["11", "13", "9", "3", "5"]]],
      // Uneven steps: copied.
      [col(["01/02/2000", "01/04/2000", "01/05/2000"]), [0, 0], [0, 0, 0, 2], [0, 0, 0, 7], "weekdays", [0, 3, 0, 7], col(["36527", "36529", "36530", "36527", "36529"])],
      [col(["01/02/2000", "01/04/2000", "01/05/2000"]), [5, 0], [0, 5, 0, 7], [0, 7, 0, 0], "weekdays", [0, 0, 0, 4], col(["36529", "36530", "36527", "36529", "36530"])],
      // Fill months.
      [[["01/01/2000"]], [0, 0], [0, 0, 0, 0], [0, 0, 0, 7], "months", [0, 1, 0, 7], col(["36557", "36586", "36617", "36647", "36678", "36708", "36739"])],
      [[["01/01/2000"]], [7, 0], [0, 7, 0, 7], [0, 7, 0, 0], "months", [0, 0, 0, 6], col(["36312", "36342", "36373", "36404", "36434", "36465", "36495"])],
      [[["01/01/2000", "03/01/2000"]], [0, 0], [0, 0, 1, 0], [0, 0, 7, 0], "months", [2, 0, 7, 0], [["36647", "36708", "36770", "36831", "36892", "36951"]]],
      [[["01/01/2000", "03/01/2000"]], [0, 6], [6, 0, 7, 0], [7, 0, 0, 0], "months", [0, 0, 5, 0], [["36161", "36220", "36281", "36342", "36404", "36465"]]],
      [col(["02/01/2000", "04/01/2000", "06/01/2000"]), [0, 0], [0, 0, 0, 2], [0, 0, 0, 7], "months", [0, 3, 0, 7], col(["36739", "36800", "36861", "36923", "36982"])],
      [col(["02/01/2000", "04/01/2000", "06/01/2000"]), [5, 0], [0, 5, 0, 7], [0, 7, 0, 0], "months", [0, 0, 0, 4], col(["36251", "36312", "36373", "36434", "36495"])],
      [[["01/01/2000", "03/01/2000", "06/01/2000"]], [0, 0], [0, 0, 2, 0], [0, 0, 7, 0], "months", [3, 0, 7, 0], [["36526", "36586", "36678", "36526", "36586"]]],
      [[["01/01/2000", "03/01/2000", "06/01/2000"]], [0, 5], [5, 0, 7, 0], [7, 0, 0, 0], "months", [0, 0, 4, 0], [["36586", "36678", "36526", "36586", "36678"]]],
      [col(["01/01/2000 12:00", "03/01/2000 13:00"]), [0, 0], [0, 0, 0, 1], [0, 0, 0, 7], "months", [0, 2, 0, 7], col(["36647", "36708", "36770", "36831", "36892", "36951"])],
      [col(["01/01/2000 12:00", "03/01/2000 13:00"]), [6, 0], [0, 6, 0, 7], [0, 7, 0, 0], "months", [0, 0, 0, 5], col(["36161", "36220", "36281", "36342", "36404", "36465"])],
      [[["02/01/2000 12:00", "04/01/2000", "06/01/2000 13:00"]], [0, 0], [0, 0, 2, 0], [0, 0, 7, 0], "months", [3, 0, 7, 0], [["36739", "36800", "36861", "36923", "36982"]]],
      [[["02/01/2000 12:00", "04/01/2000", "06/01/2000 13:00"]], [0, 5], [5, 0, 7, 0], [7, 0, 0, 0], "months", [0, 0, 4, 0], [["36251", "36312", "36373", "36434", "36495"]]],
      [[["01/01/1900"]], [0, 0], [0, 0, 0, 0], [0, 0, 0, 7], "months", [0, 1, 0, 7], col(["32", "61", "92", "122", "153", "183", "214"])],
      [[["01/01/1900"]], [7, 0], [0, 7, 0, 7], [0, 7, 0, 0], "months", [0, 0, 0, 6], col(["1", "1", "1", "1", "1", "1", "1"])],
      [[["02/01/1900", "04/01/1900"]], [0, 0], [0, 0, 1, 0], [0, 0, 7, 0], "months", [2, 0, 7, 0], [["153", "214", "275", "336", "398", "457"]]],
      [[["06/01/1900", "08/01/1900"]], [0, 6], [6, 0, 7, 0], [7, 0, 0, 0], "months", [0, 0, 5, 0], [["153", "214", "153", "214", "32", "92"]]],
      // Fill years.
      [[["01/01/2000"]], [0, 0], [0, 0, 0, 0], [0, 0, 0, 7], "years", [0, 1, 0, 7], col(["36892", "37257", "37622", "37987", "38353", "38718", "39083"])],
      [[["01/01/2000"]], [7, 0], [0, 7, 0, 7], [0, 7, 0, 0], "years", [0, 0, 0, 6], col(["33970", "34335", "34700", "35065", "35431", "35796", "36161"])],
      [[["01/01/2000", "01/01/2002"]], [0, 0], [0, 0, 1, 0], [0, 0, 7, 0], "years", [2, 0, 7, 0], [["37987", "38718", "39448", "40179", "40909", "41640"]]],
      [[["01/01/2000", "01/01/2002"]], [0, 6], [6, 0, 7, 0], [7, 0, 0, 0], "years", [0, 0, 5, 0], [["32143", "32874", "33604", "34335", "35065", "35796"]]],
      [col(["01/01/2000", "01/01/2025", "01/01/2050"]), [0, 0], [0, 0, 0, 2], [0, 0, 0, 7], "years", [0, 3, 0, 7], col(["63920", "73051", "82182", "91313", "100444"])],
      [col(["01/01/2000", "01/01/2025", "01/01/2050"]), [5, 0], [0, 5, 0, 7], [0, 7, 0, 0], "years", [0, 0, 0, 4], col(["45658", "1", "9133", "18264", "27395"])],
      [[["01/01/1900"]], [0, 0], [0, 0, 0, 0], [0, 0, 7, 0], "years", [1, 0, 7, 0], [["367", "732", "1097", "1462", "1828", "2193", "2558"]]],
      [[["01/01/1900"]], [0, 7], [7, 0, 7, 0], [7, 0, 0, 0], "years", [0, 0, 6, 0], [["1", "1", "1", "1", "1", "1", "1"]]],
      [col(["01/01/1900", "01/01/1902"]), [0, 0], [0, 0, 0, 1], [0, 0, 0, 7], "years", [0, 2, 0, 7], col(["1462", "2193", "2923", "3654", "4384", "5115"])],
      [col(["01/01/1900", "01/01/1902"]), [6, 0], [0, 6, 0, 7], [0, 7, 0, 0], "years", [0, 0, 0, 5], col(["1", "732", "1", "732", "1", "732"])],
      // "Fill series" on dates three months apart steps by months.
      [[["01/01/2000", "04/01/2000"]], [0, 0], [0, 0, 1, 0], [0, 0, 7, 0], "series", [2, 0, 7, 0], [["36708", "36800", "36892", "36982", "37073", "37165"]]],
      // Dates within one month (year): every cell moves on by a month (year).
      [col(["01/01/2000", "01/02/2000", "01/03/2000"]), [0, 0], [0, 0, 0, 2], [0, 0, 0, 8], "months", [0, 3, 0, 8], col(["36557", "36558", "36559", "36586", "36587", "36588"])],
      [col(["01/01/2000", "01/02/2000", "01/03/2000"]), [6, 0], [0, 6, 0, 8], [0, 8, 0, 0], "months", [0, 0, 0, 5], col(["36465", "36466", "36467", "36495", "36496", "36497"])],
      [[["01/01/2000", "01/02/2000", "01/03/2000"]], [0, 0], [0, 0, 2, 0], [0, 0, 8, 0], "years", [3, 0, 8, 0], [["36892", "36893", "36894", "37257", "37258", "37259"]]],
      [[["01/01/2000", "01/02/2000", "01/03/2000"]], [0, 6], [6, 0, 8, 0], [8, 0, 0, 0], "years", [0, 0, 5, 0], [["35796", "35797", "35798", "36161", "36162", "36163"]]],
      [col(["01/01/2000", "01/30/2000"]), [0, 0], [0, 0, 0, 1], [0, 0, 0, 8], "months", [0, 2, 0, 8], col(["36557", "36585", "36586", "36615", "36617", "36646", "36647"])],
      [col(["01/01/2000", "01/30/2000"]), [7, 0], [0, 7, 0, 8], [0, 8, 0, 0], "months", [0, 0, 0, 6], col(["36433", "36434", "36463", "36465", "36494", "36495", "36524"])],
      [[["01/01/2000", "01/31/2000"]], [0, 0], [0, 0, 1, 0], [0, 0, 8, 0], "months", [2, 0, 8, 0], [["36557", "36585", "36586", "36616", "36617", "36646", "36647"]]],
      [[["01/01/2000", "01/31/2000"]], [0, 7], [7, 0, 8, 0], [8, 0, 0, 0], "months", [0, 0, 6, 0], [["36433", "36434", "36464", "36465", "36494", "36495", "36525"]]],
      [col(["01/01/2000", "01/31/2000"]), [0, 0], [0, 0, 0, 1], [0, 0, 0, 8], "years", [0, 2, 0, 8], col(["36892", "36922", "37257", "37287", "37622", "37652", "37987"])],
      [col(["01/01/2000", "01/31/2000"]), [7, 0], [0, 7, 0, 8], [0, 8, 0, 0], "years", [0, 0, 0, 6], col(["35095", "35431", "35461", "35796", "35826", "36161", "36191"])],
      [[["01/01/2000", "02/01/2000"]], [0, 0], [0, 0, 1, 0], [0, 0, 8, 0], "years", [2, 0, 8, 0], [["36892", "36923", "37257", "37288", "37622", "37653", "37987"]]],
      [[["01/01/2000", "02/01/2000"]], [0, 7], [7, 0, 8, 0], [8, 0, 0, 0], "years", [0, 0, 6, 0], [["35096", "35431", "35462", "35796", "35827", "36161", "36192"]]],
      // Uneven days within the month: copied.
      ...(["months", "years"] as const).flatMap((op) => [
        [col(["01/12/2000", "01/13/2000", "01/15/2000"]), [0, 0], [0, 0, 0, 2], [0, 0, 0, 8], op, [0, 3, 0, 8], col(["36537", "36538", "36540", "36537", "36538", "36540"])],
        [col(["01/12/2000", "01/13/2000", "01/15/2000"]), [6, 0], [0, 6, 0, 8], [0, 8, 0, 0], op, [0, 0, 0, 5], col(["36537", "36538", "36540", "36537", "36538", "36540"])],
        [[["01/01/2000 12:00", "01/02/2000 13:00", "01/04/2000 14:00"]], [0, 0], [0, 0, 2, 0], [0, 0, 8, 0], op, [3, 0, 8, 0],
          [["36526.5", "36527.541666666664", "36529.583333333336", "36526.5", "36527.541666666664", "36529.583333333336"]]],
        [[["01/01/2000 12:00", "01/02/2000 13:00", "01/04/2000 14:00"]], [0, 6], [6, 0, 8, 0], [8, 0, 0, 0], op, [0, 0, 5, 0],
          [["36526.5", "36527.541666666664", "36529.583333333336", "36526.5", "36527.541666666664", "36529.583333333336"]]],
      ] as [string[][], [number, number], Box, Box, Op, Box, string[][]][]),
      // Same day, different times: whole dates, a month (year) per period.
      [col(["01/01/2000 12:00", "01/01/2000 13:00"]), [0, 0], [0, 0, 0, 1], [0, 0, 0, 8], "months", [0, 2, 0, 8], col(["36557", "36557", "36586", "36586", "36617", "36617", "36647"])],
      [col(["01/01/2000 12:00", "01/01/2000 13:00"]), [7, 0], [0, 7, 0, 8], [0, 8, 0, 0], "months", [0, 0, 0, 6], col(["36404", "36434", "36434", "36465", "36465", "36495", "36495"])],
      [col(["01/01/2000 12:00", "01/01/2000 13:00"]), [0, 0], [0, 0, 0, 1], [0, 0, 0, 8], "years", [0, 2, 0, 8], col(["36892", "36892", "37257", "37257", "37622", "37622", "37987"])],
      [col(["01/01/2000 12:00", "01/01/2000 13:00"]), [7, 0], [0, 7, 0, 8], [0, 8, 0, 0], "years", [0, 0, 0, 6], col(["35065", "35431", "35431", "35796", "35796", "36161", "36161"])],
      // 31 January 1900 plus months: end of February (the real one, not the fake 29th).
      [[["01/31/1900"]], [0, 0], [0, 0, 0, 0], [0, 0, 3, 0], "months", [1, 0, 3, 0], [["59", "91", "121"]]],
    ];
    for (const [data, at, src, h, op, check, want] of cases) {
      const sh = new Sheet().put(at[0], at[1], data);
      if (op === "dialog") dragSeries(sh, R(...src), h);
      else drag(sh, R(...src), h, op);
      expect(sh.block(...check), JSON.stringify({ data, op, h })).toEqual(want);
    }
    // Toolbar Series on a row with room: the step is the slope.
    expect(runDialog([["2", "4"]], R(0, 0, 4, 0), {}).block(2, 0, 4, 0)).toEqual([["6", "8", "10"]]);
    // "Series in" across the selection: each line is one cell, nothing to fill.
    expect(runDialog([["1"]], R(0, 0, 0, 3), { seriesIn: "rows" }).block(1, 0, 1, 0)).toEqual([[""]]);
    expect(runDialog([["1"]], R(0, 0, 3, 0), { seriesIn: "columns" }).block(0, 1, 0, 1)).toEqual([[""]]);
  });

  it('oo:cell/spreadsheet-calculation/SerialTests.js#Toolbar: Fill -> "Up/Down, Left/Right"', () => {
    // Merging the filled cells is the sheet's business (merges live in the
    // sheet config); the values are checked here.
    const edge = (at: [number, number], sel: CellRect, dir: FillDirection) => {
      const sh = new Sheet().put(at[0], at[1], [["1"]]);
      return sh.apply(fillEdge(sh.get, sel, dir));
    };
    expect(edge([0, 0], R(0, 0, 1, 3), "down").val(2, 0)).toBe("1");
    expect(edge([3, 0], R(0, 0, 1, 3), "up").val(1, 0)).toBe("1");
    expect(edge([0, 0], R(0, 0, 3, 1), "right").val(0, 2)).toBe("1");
    expect(edge([0, 3], R(0, 0, 3, 1), "left").val(0, 1)).toBe("1");
  });

  // Merged cells: Series steps over a merged block as one cell and merges
  // the filled cells alike. FortuneSheet keeps merges in the sheet config,
  // which these pure functions do not see yet.
  it.skip("oo:cell/spreadsheet-calculation/SerialTests.js#Series with merged cells", () => {});
});

// ===========================================================================
// SheetStructureTests.js — fill-handle drags

/**
 * Drags `src` (typed along a row, or a column with `vertical`) away from it
 * by `n` cells — forwards, or backwards when `reverse` — and returns the new
 * cells in order of distance from the source.
 */
function dragLine(src: string[], n: number, vertical: boolean, reverse: boolean): string[] {
  const start = reverse ? n : 0;
  const sh = new Sheet().put(vertical ? start : 0, vertical ? 0 : start, vertical ? col(src) : [src]);
  const end = start + src.length - 1;
  const box = (a: number, b: number) => (vertical ? R(0, a, 0, b) : R(a, 0, b, 0));
  const dir: FillDirection = vertical ? (reverse ? "up" : "down") : reverse ? "left" : "right";
  sh.apply(autofillRange(sh.get, box(start, end), reverse ? box(0, end) : box(0, end + n), dir));
  const out: string[] = [];
  for (let k = 1; k <= n; k++) {
    const i = reverse ? start - k : end + k;
    out.push(vertical ? sh.val(i, 0) : sh.val(0, i));
  }
  return out;
}

/** Expects dragging `src` onwards (and, given `back`, backwards) to give `fwd` (`back`). */
function seq(vertical: boolean, src: string[], fwd: string[] | null, back?: string[]) {
  if (fwd) expect(dragLine(src, fwd.length, vertical, false), JSON.stringify(src)).toEqual(fwd);
  if (back) expect(dragLine(src, back.length, vertical, true), JSON.stringify(src) + " backwards").toEqual(back);
}

// Ways of writing a name, with the case the filled names take.
type Case = "cap" | "upper" | "lower";
const altCase = (w: string, upperFirst: boolean) =>
  [...w].map((ch, i) => ((i % 2 === 0) === upperFirst ? ch.toUpperCase() : ch.toLowerCase())).join("");
const WRITINGS: [(w: string) => string, Case][] = [
  [(w) => w, "cap"], // Sunday
  [(w) => w.toUpperCase(), "upper"], // SUNDAY
  [(w) => w.toLowerCase(), "lower"], // sunday
  [(w) => altCase(w, true), "cap"], // SuNdAy
  [(w) => w.slice(0, 2).toUpperCase() + altCase(w.slice(2), false), "upper"], // SUnDaY
  [(w) => altCase(w, false), "lower"], // sUnDaY
  [(w) => w.slice(0, 2).toLowerCase() + w.slice(2, 4).toUpperCase() + w.slice(4).toLowerCase(), "lower"], // suNDay
];
const inCase = (w: string, c: Case) => (c === "upper" ? w.toUpperCase() : c === "lower" ? w.toLowerCase() : w);
/** Full name ⇄ three-letter name. */
const otherForm = (w: string) => {
  const full = [...DAY_NAMES, ...MONTH_NAMES].find((n) => n === w || n.slice(0, 3) === w)!;
  return w === full ? full.slice(0, 3) : full;
};

/**
 * Day/month names: `src` and `want` are written capitalised. Every writing
 * of the source (all caps, alternating case …) is tried, and again with
 * every name in its other form (full ⇄ short).
 */
function names(vertical: boolean, src: string[], fwd: string[], back?: string[]) {
  for (const form of [(w: string) => w, otherForm]) {
    for (const [write, c] of WRITINGS) {
      const s = src.map((w) => write(form(w)));
      const expectCase = (ws: string[]) => ws.map((w) => inCase(form(w), c));
      seq(vertical, s, expectCase(fwd), back && expectCase(back));
    }
  }
}

const DAYS9 = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Monday"];
const DAYS9_EVEN = ["Sunday", "Tuesday", "Thursday", "Saturday", "Monday", "Wednesday", "Friday", "Sunday", "Tuesday"];
const DAYS9_ODD = ["Monday", "Wednesday", "Friday", "Sunday", "Tuesday", "Thursday", "Saturday", "Monday", "Wednesday"];
const MONTHS14 = ["December", ...MONTH_NAMES, "January"];
const MONTHS10_EVEN = ["December", "February", "April", "June", "August", "October", "December", "February", "April", "June"];
const MONTHS10_ODD = ["January", "March", "May", "July", "September", "November", "January", "March", "May", "July"];

describe("SheetStructureTests.js", () => {
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Asc horizontal sequence: Days of the weeks", () => {
    names(false, ["Sunday"], ["Monday", "Tuesday", "Wednesday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Reverse horizontal sequence: Days of the weeks", () => {
    names(false, ["Sunday"], [], ["Saturday", "Friday", "Thursday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Asc horizontal even sequence: Days of the weeks", () => {
    names(false, ["Sunday", "Tuesday"], ["Thursday", "Saturday", "Monday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Asc horizontal odd sequence: Days of the weeks", () => {
    names(false, ["Monday", "Wednesday"], ["Friday", "Sunday", "Tuesday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Reverse horizontal even sequence: Days of the weeks", () => {
    names(false, ["Friday", "Sunday"], [], ["Wednesday", "Monday", "Saturday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Reverse horizontal odd sequence: Days of the weeks", () => {
    names(false, ["Thursday", "Saturday"], [], ["Tuesday", "Sunday", "Friday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Asc horizontal sequence of full and short names: Days of the weeks", () => {
    names(false, ["Sunday", "Sun"], ["Monday", "Mon", "Tuesday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Reverse horizontal sequence of full and short names: Days of the weeks", () => {
    names(false, ["Sunday", "Sun"], [], ["Sat", "Saturday", "Fri"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Asc vertical sequence: Days of the weeks", () => {
    names(true, ["Sunday"], ["Monday", "Tuesday", "Wednesday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Reverse vertical sequence: Days of the weeks", () => {
    names(true, ["Sunday"], [], ["Saturday", "Friday", "Thursday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Asc vertical even sequence: Days of the weeks", () => {
    names(true, ["Sunday", "Tuesday"], ["Thursday", "Saturday", "Monday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Asc vertical odd sequence: Days of the weeks", () => {
    names(true, ["Monday", "Wednesday"], ["Friday", "Sunday", "Tuesday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Asc vertical sequence of full and short names: Days of the weeks", () => {
    names(true, ["Sunday", "Sun"], ["Monday", "Mon", "Tuesday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Reverse vertical sequence of full and short names: Days of the weeks", () => {
    names(true, ["Sun", "Sunday"], [], ["Saturday", "Sat", "Friday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Reverse vertical even sequence: Days of the weeks", () => {
    names(true, ["Friday", "Sunday"], [], ["Wednesday", "Monday", "Saturday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Reverse vertical odd sequence: Days of the weeks", () => {
    names(true, ["Thursday", "Saturday"], [], ["Tuesday", "Sunday", "Friday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Horizontal sequence. Range 9 cells : Days of the weeks", () => {
    names(false, DAYS9, ["Tuesday", "Wednesday", "Thursday"], ["Saturday", "Friday", "Thursday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Horizontal Even sequence. Range 9 cells : Days of the weeks", () => {
    names(false, DAYS9_EVEN, ["Thursday", "Saturday", "Monday"], ["Friday", "Wednesday", "Monday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Horizontal Odd sequence. Range 9 cells : Days of the weeks", () => {
    names(false, DAYS9_ODD, ["Friday", "Sunday", "Tuesday"], ["Saturday", "Thursday", "Tuesday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Vertical sequence. Range 9 cells: Days of the weeks", () => {
    names(true, DAYS9, ["Tuesday", "Wednesday", "Thursday"], ["Saturday", "Friday", "Thursday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Vertical even sequence. Range 9 cell: Days of the weeks", () => {
    names(true, DAYS9_EVEN, ["Thursday", "Saturday", "Monday"], ["Friday", "Wednesday", "Monday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Vertical odd sequence. Range 9 cells: Days of the weeks", () => {
    names(true, DAYS9_ODD, ["Friday", "Sunday", "Tuesday"], ["Saturday", "Thursday", "Tuesday"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Horizontal sequence. Months", () => {
    names(false, ["January"], ["February", "March", "April"], ["December", "November", "October"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Vertical sequence. Months", () => {
    names(true, ["January"], ["February", "March", "April"], ["December", "November", "October"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Horizontal even sequence. Months", () => {
    names(false, ["December", "February"], ["April", "June", "August"], ["October", "August", "June"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Vertical even sequence.  Months", () => {
    names(true, ["December", "February"], ["April", "June", "August"], ["October", "August", "June"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Horizontal odd sequence. Months", () => {
    names(false, ["January", "March"], ["May", "July", "September"], ["November", "September", "July"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Vertical odd sequence. Months", () => {
    names(true, ["January", "March"], ["May", "July", "September"], ["November", "September", "July"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Horizontal sequence of full and short names. Months", () => {
    names(false, ["January", "Jan"], ["February", "Feb", "March"], ["Dec", "December", "Nov"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Vertical sequence of full and short names. Months", () => {
    names(true, ["January", "Jan"], ["February", "Feb", "March"], ["Dec", "December", "Nov"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Horizontal sequence: Range 14 cells. Months", () => {
    names(false, MONTHS14, ["February", "March", "April"], ["November", "October", "September"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Vertical sequence: Range 14 cells.  Months", () => {
    names(true, MONTHS14, ["February", "March", "April"], ["November", "October", "September"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Horizontal even sequence: Range 10 cells. Months", () => {
    names(false, MONTHS10_EVEN, ["August", "October", "December"], ["October", "August", "June"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Vertical even sequence: Range 10 cells.  Months", () => {
    names(true, MONTHS10_EVEN, ["August", "October", "December"], ["October", "August", "June"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Horizontal odd sequence: Range 10 cells. Months", () => {
    names(false, MONTHS10_ODD, ["September", "November", "January"], ["November", "September", "July"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Vertical odd sequence: Range 10 cells.  Months", () => {
    names(true, MONTHS10_ODD, ["September", "November", "January"], ["November", "September", "July"]);
  });
  // "May" is a full and a short month name at once: its neighbour decides.
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Horizontal sequence: May check previous cell in range. Months", () => {
    names(false, ["March", "May"], ["July", "September", "November"], ["January", "November", "September"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Vertical sequence: May check previous cell in range. Months", () => {
    names(true, ["March", "May"], ["July", "September", "November"], ["January", "November", "September"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Horizontal sequence: May check next cell in range. Months", () => {
    names(false, ["May", "June"], ["July", "August", "September"], ["April", "March", "February"]);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Vertical sequence: May check next cell in range. Months", () => {
    names(true, ["May", "June"], ["July", "August", "September"], ["April", "March", "February"]);
  });

  /** Numbers, text with numbers and dates, dragged along a row or a column. */
  function mixedSequences(v: boolean) {
    // One number is copied; two extend their step.
    seq(v, ["-1"], ["-1"], ["-1"]);
    seq(v, ["-1", "0"], ["1", "2", "3"], ["-2", "-3", "-4"]);
    seq(v, ["1", "3"], ["5", "7", "9"], ["-1", "-3", "-5"]);
    seq(v, ["2", "4"], ["6", "8", "10"], ["0", "-2", "-4"]);
    // Text is copied; a number at its end counts, keeping leading zeros and never going negative.
    seq(v, ["Test"], ["Test"], ["Test"]);
    seq(v, ["Test01"], ["Test02", "Test03", "Test04"], ["Test00", "Test01", "Test02"]);
    seq(v, ["Test1"], ["Test2", "Test3", "Test4"], ["Test0", "Test1", "Test2"]);
    seq(v, ["Test1", "Test3"], ["Test5", "Test7", "Test9"], ["Test1", "Test3", "Test5"]);
    seq(v, ["Test2", "Test4"], ["Test6", "Test8", "Test10"], ["Test0", "Test2", "Test4"]);
    seq(v, ["Test1", "T1"], ["Test2", "T2", "Test3", "T3"], ["T0", "Test0", "T1"]);
    // Dates step by days.
    seq(v, ["01/01/2000"], ["36527", "36528", "36529"], ["36525", "36524", "36523"]);
    seq(v, ["01/01/2000", "01/02/2000"], ["36528", "36529", "36530"], ["36525", "36524", "36523"]);
    seq(v, ["01/02/2000", "01/04/2000"], ["36531", "36533", "36535"], ["36525", "36523", "36521"]);
    seq(v, ["01/01/2000", "01/03/2000"], ["36530", "36532", "36534"], ["36524", "36522", "36520"]);
  }

  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Horizontal sequence.", () => {
    mixedSequences(false);
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - Vertical sequence.", () => {
    mixedSequences(true);
  });

  /** Names written with spaces around them or a trailing dot. */
  function decoratedNames(v: boolean) {
    const days6 = ["tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const daysBack = ["sunday", "saturday", "friday", "thursday", "wednesday", "tuesday", "monday"];
    const short = (ws: string[]) => ws.map((w) => w.slice(0, 3));
    seq(v, ["monday "], days6, daysBack);
    seq(v, ["monday ", "tuesday"], days6.slice(1), daysBack);
    seq(v, [" monday ", "tuesday "], days6.slice(1), daysBack);
    seq(v, ["mon."], short(days6), short(daysBack));
    seq(v, ["mon.", "tue"], short(days6.slice(1)), short(daysBack));
    seq(v, ["mon ", "tue"], short(days6.slice(1)), short(daysBack));
    seq(v, [" mon ", "tue "], short(days6.slice(1)), short(daysBack));
    const months = ["february", "march", "april", "may", "june", "july", "august"];
    const monthsBack = ["december", "november", "october", "september", "august", "july", "june"];
    seq(v, ["january "], months.slice(0, 6), monthsBack);
    seq(v, ["january ", "february"], months.slice(1), monthsBack);
    seq(v, [" january ", "february"], months.slice(1), monthsBack);
    seq(v, ["jan."], short(months.slice(0, 6)), short(monthsBack));
    seq(v, ["jan.", "feb"], short(months.slice(1)), short(monthsBack));
    // Not a name: copied.
    seq(v, ["mon.day"], ["mon.day", "mon.day"], ["mon.day", "mon.day"]);
  }

  it('oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill: Days of week and months with spaces and dot - Horizontal sequence', () => {
    decoratedNames(false);
  });
  it('oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill: Days of week and months with spaces and dot - Vertical sequence.', () => {
    decoratedNames(true);
  });

  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill: test toolbar down/up/left/right", () => {
    const sh = new Sheet().put(0, 0, [["1", "Test", "Test1", "01/01/2000"]]);
    // Fill down copies the top row as it is: no counting.
    for (let c = 0; c < 4; c++) sh.apply(fillEdge(sh.get, R(c, 0, c, 3), "down"));
    expect(sh.block(0, 0, 3, 3)).toEqual([0, 1, 2, 3].map(() => ["1", "Test", "Test1", "36526"]));
    sh.apply(fillEdge(sh.get, R(2, 0, 4, 0), "right"));
    expect(sh.block(2, 0, 4, 0)).toEqual([["Test1", "Test1", "Test1"]]);
  });

  // Encodes OnlyOffice's own arithmetic for date-time and time steps: the
  // expected serials carry its accumulated rounding (36872.62500000001,
  // 1.0833333333333401 …) and some OnlyOffice-specific choices (12:00, 13:00,
  // 12:00 filling a constant 36872.5, negative times allowed before 1900).
  // Grown steps dates by whole days/months, times by their exact step, and
  // copies irregular dates; see autofill.test.ts.
  it.skip("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Autofill - format Date, Date & Time and Time.", () => {});
});
