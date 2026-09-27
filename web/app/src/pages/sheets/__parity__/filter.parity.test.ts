// Ports of OnlyOffice's AutoFilter suites (behaviour only, clean-room):
//   cell/spreadsheet-calculation/autoFilterTests.js
//   cell/js-api/api-auto-filter.js
// against ../filterOps.ts. OnlyOffice's "hidden row" checks become checks on
// hiddenRows(); API property checks run against setAutoFilter()/apiFilters().

import { describe, expect, it } from "vitest";
import {
  apiFilters,
  columnValues,
  createFilter,
  filterColumnAt,
  hiddenRows,
  setAutoFilter,
  setColumnFilter,
  showAllData,
  valuesFilterFromItems,
  type ColumnFilter,
  type CustomCondition,
  type DateGrouping,
  type FilterHost,
  type FilterState,
  type ValueItem,
} from "../filterOps";
import { gridFromRows, typedCell, type Grid } from "../cellValue";

// The suite pins "today" to 15 May 2023 (a Monday).
const NOW = new Date(2023, 4, 15);

function col(rows: string[]): Grid {
  return gridFromRows(rows.map((r) => [r]));
}

function hidden(grid: Grid, state: FilterState | null): number[] {
  return [...hiddenRows(grid, state, { now: NOW })].sort((a, b) => a - b);
}

function autoFilterAtA1(grid: Grid): FilterState {
  const st = createFilter(grid, { r1: 0, c1: 0, r2: 0, c2: 0 });
  expect(st).not.toBeNull();
  return st!;
}

function dynamic(rows: string[], type: ColumnFilter & { type: "dynamic" }): number[] {
  const grid = col(rows);
  const st = autoFilterAtA1(grid);
  expect(st.range).toEqual({ r1: 0, c1: 0, r2: rows.length - 1, c2: 0 });
  return hidden(grid, setColumnFilter(st, 0, type));
}

const dyn = (d: string) => ({ type: "dynamic", dynamic: d }) as ColumnFilter & { type: "dynamic" };

/** Unchecks the listed display texts in a column's checklist, like the filter menu does. */
function hideTexts(grid: Grid, st: FilterState, colId: number, texts: string[]): FilterState {
  const items = columnValues(grid, st, colId, { now: NOW }).map((i) =>
    texts.includes(i.text) ? { ...i, visible: false } : i,
  );
  return setColumnFilter(st, colId, valuesFilterFromItems(items));
}

type DateSel = { y: number; m: number; d: number; hh: number; mm: number; visible: boolean; g: DateGrouping };

/** Sets visibility/grouping on date items matched by y/m/d/h/m (months 1-based). */
function pickDates(grid: Grid, st: FilterState, sel: DateSel[]): FilterState {
  const items: ValueItem[] = columnValues(grid, st, 0, { now: NOW }).map((i) => ({ ...i, visible: true }));
  for (const s of sel) {
    const it = items.find(
      (i) =>
        i.date && i.date.y === s.y && i.date.m === s.m && i.date.d === s.d && i.date.hh === s.hh && i.date.mm === s.mm,
    );
    if (it) {
      it.visible = s.visible;
      it.grouping = s.g;
    }
  }
  return setColumnFilter(st, 0, valuesFilterFromItems(items));
}

describe("autoFilterTests.js", () => {
  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: simple tests', () => {
    const grid = gridFromRows([
      ["test1", "test2"],
      ["", "44851"],
      ["closed", ""],
      ["closed", ""],
      ["d", "44852"],
      ["closed", ""],
      ["", "44851"],
      ["", "44851"],
      ["closed", "44851"],
    ]);
    let st = autoFilterAtA1(grid);
    expect(st.range).toEqual({ r1: 0, c1: 0, r2: 8, c2: 1 });
    // The checklist is sorted with blanks last: "closed" comes first.
    expect(columnValues(grid, st, 0)[0].text).toBe("closed");
    st = hideTexts(grid, st, 0, ["closed"]);
    expect(hidden(grid, st)).toEqual([2, 3, 5, 8]);
    expect(columnValues(grid, st, 1)[0].text).toBe("44851");
    st = hideTexts(grid, st, 1, ["44851"]);
    expect(hidden(grid, st)).toEqual([1, 2, 3, 5, 6, 7, 8]);
    // Unhiding rows by hand does not change the criteria; re-applying hides them again.
    st = hideTexts(grid, st, 1, ["44851"]);
    expect(hidden(grid, st)).toEqual([1, 2, 3, 5, 6, 7, 8]);
  });

  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - Today', () => {
    expect(dynamic(["Dates", "45060", "45061", "45062"], dyn("today"))).toEqual([1, 3]);
  });
  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - Yesterday', () => {
    expect(dynamic(["Dates", "45059", "45060", "45061"], dyn("yesterday"))).toEqual([1, 3]);
  });
  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - Tomorrow', () => {
    expect(dynamic(["Dates", "45061", "45062", "45063"], dyn("tomorrow"))).toEqual([1, 3]);
  });
  const week = (start: number) => Array.from({ length: 9 }, (_, i) => String(start + i));
  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - This week', () => {
    // OnlyOffice leaves the following Sunday visible (a TODO in the suite); Excel hides it.
    expect(dynamic(["Dates", ...week(45059)], dyn("thisWeek"))).toEqual([1, 9]);
  });
  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - Next week', () => {
    expect(dynamic(["Dates", ...week(45066)], dyn("nextWeek"))).toEqual([1, 9]);
  });
  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - Last week', () => {
    expect(dynamic(["Dates", ...week(45052)], dyn("lastWeek"))).toEqual([1, 9]);
  });
  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - Last month', () => {
    expect(dynamic(["Dates", "45016", "45017", "45046", "45047"], dyn("lastMonth"))).toEqual([1, 4]);
  });
  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - This month', () => {
    expect(dynamic(["Dates", "45046", "45047", "45077", "45078"], dyn("thisMonth"))).toEqual([1, 4]);
  });
  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - Next month', () => {
    expect(dynamic(["Dates", "45077", "45078", "45107", "45108"], dyn("nextMonth"))).toEqual([1, 4]);
  });
  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - Next quarter', () => {
    expect(dynamic(["Dates", "45107", "45108", "45199", "45200"], dyn("nextQuarter"))).toEqual([1, 4]);
  });
  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - This quarter', () => {
    expect(dynamic(["Dates", "45016", "45017", "45107", "45108"], dyn("thisQuarter"))).toEqual([1, 4]);
  });
  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - Last quarter', () => {
    expect(dynamic(["Dates", "44926", "44927", "45016", "45017"], dyn("lastQuarter"))).toEqual([1, 4]);
  });
  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - This year', () => {
    expect(dynamic(["Dates", "44926", "44927", "45291", "45292"], dyn("thisYear"))).toEqual([1, 4]);
  });
  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - Next year', () => {
    expect(dynamic(["Dates", "45291", "45292", "45657", "45658"], dyn("nextYear"))).toEqual([1, 4]);
  });
  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - Last year', () => {
    expect(dynamic(["Dates", "44561", "44562", "44926", "44927"], dyn("lastYear"))).toEqual([1, 4]);
  });
  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - Year to date', () => {
    expect(dynamic(["Dates", "44926", "44927", "45061", "45062"], dyn("yearToDate"))).toEqual([1, 4]);
  });

  // "All dates in the period": month m (any year). Rows: serial list, expected hidden.
  const months: [string, string, string[], number[]][] = [
    ["January", "m1", ["36890", "36891", "36526", "36556", "36557", "36558"], [1, 2, 5, 6]],
    ["February", "m2", ["36556", "36557", "36584", "36586"], [1, 4]],
    ["March", "m3", ["36584", "36586", "36616", "36617"], [1, 4]],
    ["April", "m4", ["36616", "36617", "36646", "36647"], [1, 4]],
    ["May", "m5", ["36646", "36647", "36677", "36678"], [1, 4]],
    ["June", "m6", ["36677", "36678", "36707", "36708"], [1, 4]],
    ["July", "m7", ["36707", "36708", "36738", "36739"], [1, 4]],
    ["August", "m8", ["36738", "36739", "36769", "36770"], [1, 4]],
    ["September", "m9", ["36769", "36770", "36799", "36800"], [1, 4]],
    ["October", "m10", ["36799", "36800", "36830", "36831"], [1, 4]],
    ["November", "m11", ["36830", "36831", "36860", "36861"], [1, 4]],
    ["December", "m12", ["36860", "36861", "36891", "36526"], [1, 4]],
    ["Quarter 1", "q1", ["36891", "36526", "36616", "36617"], [1, 4]],
    ["Quarter 2", "q2", ["36616", "36617", "36707", "36708"], [1, 4]],
    ["Quarter 3", "q3", ["36707", "36708", "36799", "36800"], [1, 4]],
    ["Quarter 4", "q4", ["36799", "36800", "36891", "36526"], [1, 4]],
  ];
  const periodTests: Record<string, () => void> = {
    January: () => it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - All Dates in the Period -> January', () => check(0)),
    February: () => it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - All Dates in the Period -> February', () => check(1)),
    March: () => it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - All Dates in the Period -> March', () => check(2)),
    April: () => it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - All Dates in the Period -> April', () => check(3)),
    May: () => it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - All Dates in the Period -> May', () => check(4)),
    June: () => it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - All Dates in the Period -> June', () => check(5)),
    July: () => it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - All Dates in the Period -> July', () => check(6)),
    August: () => it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - All Dates in the Period -> August', () => check(7)),
    September: () => it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - All Dates in the Period -> September', () => check(8)),
    October: () => it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - All Dates in the Period -> October', () => check(9)),
    November: () => it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - All Dates in the Period -> November', () => check(10)),
    December: () => it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - All Dates in the Period -> December', () => check(11)),
    "Quarter 1": () => it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - All Dates in the Period -> Quarter 1', () => check(12)),
    "Quarter 2": () => it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - All Dates in the Period -> Quarter 2', () => check(13)),
    "Quarter 3": () => it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - All Dates in the Period -> Quarter 3', () => check(14)),
    "Quarter 4": () => it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date Filter - All Dates in the Period -> Quarter 4', () => check(15)),
  };
  function check(i: number) {
    const [, type, rows, exp] = months[i];
    expect(dynamic(["Dates", ...rows], dyn(type))).toEqual(exp);
  }
  for (const [name] of months) periodTests[name]();

  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Simple date filter apply', () => {
    const data = ["Dates", "20000", "test1", "50000", "2/11/1930", "test2", "2/4/2237", "3/4/2237", "8/20/1994", "6/16/1909"];
    const grid = col(data);
    let st = autoFilterAtA1(grid);
    expect(st.range).toEqual({ r1: 0, c1: 0, r2: 9, c2: 0 });
    st = hideTexts(grid, st, 0, ["20000", "test1", "2/11/1930"]);
    expect(hidden(grid, st)).toEqual([1, 2, 4]);
    // Clearing the column, then unchecking two other dates.
    st = setColumnFilter(st, 0, null);
    st = hideTexts(grid, st, 0, ["2/4/2237", "3/4/2237"]);
    expect(hidden(grid, st)).toEqual([6, 7]);
  });

  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date filter apply', () => {
    const data = [
      "Dates",
      "9/26/1902 2:24",
      "9/26/1902 2:52",
      "9/26/1902 3:07",
      "6/22/1905 0:00",
      "3/18/1908 0:00",
      "12/13/1910 0:00",
      "6/22/1905 2:24",
      "6/22/1905 4:48",
      "6/22/1905 7:12",
    ];
    const grid = col(data);
    const base = autoFilterAtA1(grid);
    expect(base.range).toEqual({ r1: 0, c1: 0, r2: 9, c2: 0 });
    const D = (y: number, m: number, d: number, hh: number, mm: number, visible: boolean, g: DateGrouping): DateSel => ({
      y, m, d, hh, mm, visible, g,
    });
    // 2:24 hidden at hour granularity; 2:52 kept by its own minute item.
    let st = pickDates(grid, base, [
      D(1902, 9, 26, 2, 24, false, "hour"),
      D(1902, 9, 26, 2, 52, true, "minute"),
      D(1902, 9, 26, 3, 7, true, "hour"),
    ]);
    expect(hidden(grid, st)).toEqual([1]);
    st = pickDates(grid, base, [
      D(1905, 6, 22, 7, 12, false, "year"),
      D(1905, 6, 22, 4, 48, false, "year"),
      D(1905, 6, 22, 2, 24, false, "year"),
      D(1905, 6, 22, 0, 0, false, "year"),
      D(1902, 9, 26, 3, 7, true, "year"),
      D(1902, 9, 26, 2, 52, true, "year"),
      D(1902, 9, 26, 2, 24, true, "year"),
    ]);
    expect(hidden(grid, st)).toEqual([4, 7, 8, 9]);
    st = pickDates(grid, base, [
      D(1910, 12, 13, 0, 0, true, "year"),
      D(1908, 3, 18, 0, 0, true, "year"),
      D(1905, 6, 22, 7, 12, false, "year"),
      D(1905, 6, 22, 4, 48, false, "year"),
      D(1905, 6, 22, 2, 24, false, "year"),
      D(1905, 6, 22, 0, 0, false, "year"),
      D(1902, 9, 26, 3, 7, true, "hour"),
      D(1902, 9, 26, 2, 52, false, "hour"),
      D(1902, 9, 26, 2, 24, false, "hour"),
    ]);
    expect(hidden(grid, st)).toEqual([1, 2, 4, 7, 8, 9]);
    st = pickDates(grid, base, [
      D(1905, 6, 22, 7, 12, true, "hour"),
      D(1905, 6, 22, 4, 48, false, "hour"),
      D(1905, 6, 22, 2, 24, false, "hour"),
      D(1905, 6, 22, 0, 0, false, "hour"),
      D(1902, 9, 26, 3, 7, true, "year"),
      D(1902, 9, 26, 2, 52, true, "year"),
      D(1902, 9, 26, 2, 24, true, "year"),
    ]);
    expect(hidden(grid, st)).toEqual([4, 7, 8]);
    st = pickDates(grid, base, [D(1908, 3, 18, 0, 0, false, "year")]);
    expect(hidden(grid, st)).toEqual([5]);
  });

  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Date filter apply - hour/minute :00 edge case', () => {
    const grid = col(["Dates", "10/22/2020 10:00", "10/22/2020 10:30", "10/22/2020 11:00", "10/22/2020 9:59"]);
    const base = autoFilterAtA1(grid);
    let st = pickDates(grid, base, [
      { y: 2020, m: 10, d: 22, hh: 10, mm: 0, visible: true, g: "hour" },
      { y: 2020, m: 10, d: 22, hh: 10, mm: 30, visible: true, g: "hour" },
      { y: 2020, m: 10, d: 22, hh: 11, mm: 0, visible: false, g: "hour" },
      { y: 2020, m: 10, d: 22, hh: 9, mm: 59, visible: false, g: "hour" },
    ]);
    expect(hidden(grid, st)).toEqual([3, 4]);
    st = pickDates(grid, base, [
      { y: 2020, m: 10, d: 22, hh: 10, mm: 0, visible: true, g: "minute" },
      { y: 2020, m: 10, d: 22, hh: 10, mm: 30, visible: false, g: "minute" },
      { y: 2020, m: 10, d: 22, hh: 11, mm: 0, visible: true, g: "minute" },
      { y: 2020, m: 10, d: 22, hh: 9, mm: 59, visible: false, g: "minute" },
    ]);
    expect(hidden(grid, st)).toEqual([2, 4]);
  });

  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Custom date filter apply', () => {
    const grid = col(["Dates", "20000", "test1", "50000", "2/11/1930", "test2", "2/4/2237", "6/2/1906", "8/20/1994", "6/16/1909"]);
    const base = autoFilterAtA1(grid);
    const run = (conds: CustomCondition[], and = false) =>
      hidden(grid, setColumnFilter(base, 0, { type: "custom", and, conditions: conds }));
    const all = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(run([{ op: "isLessThan", val: "8/20/1994" }])).toEqual([2, 3, 5, 6, 8]);
    expect(run([{ op: "isGreaterThan", val: "6500" }])).toEqual([2, 5, 7, 9]);
    expect(run([{ op: "isGreaterThanOrEqualTo", val: "6/16/1909" }])).toEqual([2, 5, 7]);
    expect(run([{ op: "isLessThanOrEqualTo", val: "6/16/1909" }])).toEqual([1, 2, 3, 4, 5, 6, 8]);
    const between: CustomCondition[] = [
      { op: "isGreaterThanOrEqualTo", val: "6/16/1909" },
      { op: "isLessThanOrEqualTo", val: "8/20/1994" },
    ];
    expect(run(between, true)).toEqual([2, 3, 5, 6, 7]);
    expect(run(between, false)).toEqual([2, 5]);
    expect(run([{ op: "equals", val: "20000" }])).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    // "equals" matches the shown text: a date matches its display, not its serial.
    expect(run([{ op: "equals", val: "8/20/1994" }])).toEqual([1, 2, 3, 4, 5, 6, 7, 9]);
    expect(run([{ op: "equals", val: "34566" }])).toEqual(all);
    expect(run([{ op: "doesNotEqual", val: "20000" }])).toEqual([1]);
    expect(run([{ op: "doesNotEqual", val: "8/20/1994" }])).toEqual([8]);
    expect(run([{ op: "doesNotEqual", val: "34566" }])).toEqual([8]);
    // Text operators only match text cells.
    expect(run([{ op: "beginsWith", val: "200" }])).toEqual(all);
    expect(run([{ op: "beginsWith", val: "8/20/1994" }])).toEqual(all);
    expect(run([{ op: "beginsWith", val: "tes" }])).toEqual([1, 3, 4, 6, 7, 8, 9]);
    expect(run([{ op: "endsWith", val: "000" }])).toEqual(all);
    expect(run([{ op: "endsWith", val: "20/1994" }])).toEqual(all);
    expect(run([{ op: "endsWith", val: "st2" }])).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
    expect(run([{ op: "doesNotBeginWith", val: "200" }])).toEqual([]);
    expect(run([{ op: "doesNotBeginWith", val: "8/20" }])).toEqual([]);
    expect(run([{ op: "doesNotBeginWith", val: "tes" }])).toEqual([2, 5]);
    expect(run([{ op: "contains", val: "200" }])).toEqual(all);
    expect(run([{ op: "contains", val: "8/20" }])).toEqual(all);
    expect(run([{ op: "contains", val: "es" }])).toEqual([1, 3, 4, 6, 7, 8, 9]);
    expect(run([{ op: "doesNotContain", val: "200" }])).toEqual([]);
    expect(run([{ op: "doesNotContain", val: "8/20" }])).toEqual([]);
    expect(run([{ op: "doesNotContain", val: "tes" }])).toEqual([2, 5]);
  });

  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Combine filter apply', () => {
    // The suite marks its own assertion TODO; checked here: mixed text/date/number
    // columns, keeping only June 2020 dates (month grouping) and the text rows.
    const grid = col([
      "Dates",
      "text1",
      "text1",
      "5/20/2020 0:00:00",
      "6/20/2020 0:00:00",
      "6/21/2020 0:00:00",
      "6/22/2020 0:00:00",
      "6/22/2020 10:00:00",
      "6/22/2020 11:00:00",
      "6/23/2020 11:10:00",
      "6/24/2020 11:15:00",
      "6/24/2020 11:20:10",
      "6/24/2020 11:20:20",
      "555",
    ]);
    const base = autoFilterAtA1(grid);
    expect(base.range).toEqual({ r1: 0, c1: 0, r2: 13, c2: 0 });
    const items = columnValues(grid, base, 0).map((i) => {
      if (i.date) return { ...i, grouping: "month" as DateGrouping, visible: i.date.m === 6 };
      return { ...i, visible: i.text !== "555" };
    });
    // Month grouping: the May item is unchecked, so May dates hide even though
    // the June items (same year) stay visible.
    const st = setColumnFilter(base, 0, valuesFilterFromItems(items));
    expect(hidden(grid, st)).toEqual([3, 13]);
  });

  it('oo:cell/spreadsheet-calculation/autoFilterTests.js#Test: Open filter options', () => {
    const af: FilterHost = { id: null, range: { r1: 1, c1: 1, r2: 5, c2: 5 } };
    const at = (hosts: FilterHost[], r: number, c: number, merges: { r1: number; c1: number; r2: number; c2: number }[] = []) =>
      filterColumnAt(hosts, { r, c }, merges);
    expect(at([af], 2, 1)).toBeNull();
    expect(at([af], 2, 2)).toBeNull();
    expect(at([af], 1, 1)).toEqual({ id: null, colId: 0 });
    expect(at([af], 1, 2)).toEqual({ id: null, colId: 1 });
    expect(at([af], 1, 3)).toEqual({ id: null, colId: 2 });
    expect(at([af], 2, 3)).toBeNull();
    expect(at([af], 1, 1, [{ r1: 1, c1: 0, r2: 1, c2: 1 }])).toBeNull();
    expect(at([af], 1, 4, [{ r1: 1, c1: 4, r2: 1, c2: 5 }])).toEqual({ id: null, colId: 3 });
    expect(at([af], 1, 6, [{ r1: 1, c1: 5, r2: 1, c2: 6 }])).toEqual({ id: null, colId: 4 });
    expect(at([af], 1, 1, [{ r1: 0, c1: 0, r2: 1, c2: 1 }])).toBeNull();
    // Hidden buttons do not stop the sheet AutoFilter menu.
    const afButtons = { ...af, buttons: [true, false, false, false, true] };
    expect(at([afButtons], 1, 2)).toEqual({ id: null, colId: 1 });
    expect(at([afButtons], 1, 2, [{ r1: 1, c1: 2, r2: 1, c2: 3 }])).toEqual({ id: null, colId: 1 });
    // Table filters.
    const t0: FilterHost = { id: 0, range: { r1: 1, c1: 1, r2: 5, c2: 5 }, isTable: true };
    expect(at([t0], 2, 1)).toBeNull();
    expect(at([t0], 1, 1)).toEqual({ id: 0, colId: 0 });
    expect(at([t0], 1, 2)).toEqual({ id: 0, colId: 1 });
    expect(at([t0], 1, 3)).toEqual({ id: 0, colId: 2 });
    expect(at([t0], 2, 3)).toBeNull();
    const t0b = { ...t0, buttons: [true, false, false, false, true] };
    expect(at([t0b], 1, 2)).toBeNull();
    expect(at([t0b], 1, 3)).toBeNull();
    expect(at([t0b], 1, 1)).toEqual({ id: 0, colId: 0 });
    const t0h = { ...t0, headerRow: false };
    expect(at([t0h], 1, 1)).toBeNull();
    expect(at([t0h], 2, 2)).toBeNull();
    const t1: FilterHost = { id: 1, range: { r1: 1, c1: 8, r2: 5, c2: 12 }, isTable: true };
    expect(at([t0, t1], 1, 8)).toEqual({ id: 1, colId: 0 });
    expect(at([t0, t1], 1, 9)).toEqual({ id: 1, colId: 1 });
  });
});

describe("api-auto-filter.js", () => {
  const values = (xs: unknown[]) => gridFromRows(xs.map((x) => [x]));
  const A1_A10 = { r1: 0, c1: 0, r2: 9, c2: 0 };

  it("oo:cell/js-api/api-auto-filter.js#AutoFilter filters length after Clear", () => {
    const st = setAutoFilter([], null, { r1: 0, c1: 0, r2: 0, c2: 0 });
    expect(apiFilters(st).length).toBe(0);
  });

  it("oo:cell/js-api/api-auto-filter.js#ApiAutoFilter check properties", () => {
    const g = values([10, 20, 2, 5, 4, 7]);
    const st = setAutoFilter(g, null, A1_A10, 1, [2, 5], "xlFilterValues");
    const f = apiFilters(st);
    expect(f.length).toBe(1);
    expect(f[0]).toMatchObject({ Criteria1: "=2", Operator: "xlOr", Criteria2: "=5", On: true });
  });

  it("oo:cell/js-api/api-auto-filter.js#Remove AutoFilter when Field is null", () => {
    const g = values([1, 2, 3, 4, 5]);
    let st = setAutoFilter(g, null, { r1: 0, c1: 0, r2: 4, c2: 1 }, 1, [2, 5], "xlFilterValues");
    expect(st).not.toBeNull();
    st = setAutoFilter(g, st, { r1: 0, c1: 0, r2: 4, c2: 1 }, null);
    expect(st).toBeNull();
    expect(apiFilters(st).length).toBe(0);
  });

  it("oo:cell/js-api/api-auto-filter.js#xlFilterValues with 3+ items keeps xlFilterValues", () => {
    const g = values([null, "2", "5", "7", "9"]);
    const st = setAutoFilter(g, null, A1_A10, 1, ["2", "5", "7"], "xlFilterValues");
    const f = apiFilters(st);
    expect(f.length).toBe(1);
    expect((f[0].Criteria1 as string[]).sort()).toEqual(["2", "5", "7"]);
    expect(f[0]).toMatchObject({ Criteria2: null, Operator: "xlFilterValues", On: true });
    expect(hidden(g, st)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].filter((r) => ![1, 2, 3].includes(r)));
  });

  it("oo:cell/js-api/api-auto-filter.js#xlFilterValues with 2 items converts to xlOr custom filter", () => {
    const g = values([10, 20, 2, 5, 4, 7]);
    const st = setAutoFilter(g, null, A1_A10, 1, [2, 5], "xlFilterValues");
    expect(apiFilters(st)[0]).toMatchObject({ Operator: "xlOr", Criteria1: "=2", Criteria2: "=5", On: true });
    // 20, 4 and 7 hide; 2 and 5 stay (the header row is never hidden).
    expect(hidden(g, st).filter((r) => r <= 5)).toEqual([1, 4, 5]);
  });

  it("oo:cell/js-api/api-auto-filter.js#Custom filter xlOr preserves signs and criteria", () => {
    const g = values([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const st = setAutoFilter(g, null, A1_A10, 1, ">3", "xlOr", "<=5");
    expect(apiFilters(st)[0]).toMatchObject({ Operator: "xlOr", Criteria1: ">3", Criteria2: "<=5", On: true });
    // Every number is either > 3 or ≤ 5.
    expect(hidden(g, st).filter((r) => r <= 8)).toEqual([]);
  });

  it("oo:cell/js-api/api-auto-filter.js#Custom filter xlAnd", () => {
    const g = values([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const st = setAutoFilter(g, null, A1_A10, 1, ">=2", "xlAnd", "<8");
    expect(apiFilters(st)[0]).toMatchObject({ Operator: "xlAnd", Criteria1: ">=2", Criteria2: "<8", On: true });
    expect(hidden(g, st).filter((r) => r <= 8)).toEqual([7, 8]);
  });

  it("oo:cell/js-api/api-auto-filter.js#Top10 items filter", () => {
    const g = values([10, 20, 30, 40, 50, 60]);
    const st = setAutoFilter(g, null, A1_A10, 1, "3", "xlTop10Items");
    expect(apiFilters(st)[0]).toMatchObject({ Operator: "xlTop10Items", Criteria1: 3, Criteria2: null, On: true });
    // Data rows are 20..60: the top three are 40, 50, 60.
    expect(hidden(g, st).filter((r) => r <= 5)).toEqual([1, 2]);
  });

  it("oo:cell/js-api/api-auto-filter.js#Bottom10 percent filter", () => {
    const g = values([10, 20, 30, 40, 50, 60]);
    const st = setAutoFilter(g, null, A1_A10, 1, "50", "xlBottom10Percent");
    expect(apiFilters(st)[0]).toMatchObject({ Operator: "xlBottom10Percent", Criteria1: 50, On: true });
    expect(hidden(g, st).filter((r) => r <= 5)).toEqual([3, 4, 5]);
  });

  it("oo:cell/js-api/api-auto-filter.js#Dynamic filter AboveAverage", () => {
    const g = values([1, 2, 3, 100]);
    const st = setAutoFilter(g, null, A1_A10, 1, "xlFilterAboveAverage", "xlFilterDynamic");
    expect(apiFilters(st)[0]).toMatchObject({
      Operator: "xlFilterDynamic",
      Criteria1: "xlFilterAboveAverage",
      Criteria2: null,
      On: true,
    });
    expect(hidden(g, st).filter((r) => r <= 3)).toEqual([1, 2]);
  });

  it("oo:cell/js-api/api-auto-filter.js#Color filter CellColor (Criteria1 null by API)", () => {
    const g: Grid = [
      [{ ...typedCell("x"), bg: "#ffff00" }],
      [{ ...typedCell("y"), bg: "#00ff00" }],
      [{ ...typedCell("z"), bg: "#ffff00" }],
    ];
    const st = setAutoFilter(g, null, { r1: 0, c1: 0, r2: 4, c2: 0 }, 1, { r: 255, g: 255, b: 0 }, "xlFilterCellColor");
    expect(apiFilters(st)[0]).toMatchObject({ Operator: "xlFilterCellColor", Criteria1: null, Criteria2: null, On: true });
    // Row 2 (green) and the empty rows hide; the yellow row stays.
    expect(hidden(g, st)).toEqual([1, 3, 4]);
  });

  it("oo:cell/js-api/api-auto-filter.js#Clear specific column filter when Criteria1 is null", () => {
    const g = values([10, 20, 2, 5, 4, 7]);
    let st = setAutoFilter(g, null, A1_A10, 1, ">3", "xlOr", "<=7");
    expect(apiFilters(st).length).toBe(1);
    st = setAutoFilter(g, st, A1_A10, 1, null);
    expect(st).not.toBeNull();
    expect(apiFilters(st).length).toBe(1);
    expect(apiFilters(st)[0].On).toBe(false);
    expect(hidden(g, st)).toEqual([]);
  });

  it("oo:cell/js-api/api-auto-filter.js#Invalid Field does not add AutoFilter", () => {
    const g = values([1, 2, 3]);
    let st: FilterState | null = null;
    expect(() => {
      st = setAutoFilter(g, null, { r1: 0, c1: 0, r2: 4, c2: 1 }, "foo", ">1", "xlOr");
    }).toThrow();
    expect(st).toBeNull();
    expect(apiFilters(st).length).toBe(0);
  });

  it("oo:cell/js-api/api-auto-filter.js#Field out of range does not add AutoFilter", () => {
    const g = values([1, 2, 3]);
    let st: FilterState | null = null;
    expect(() => {
      st = setAutoFilter(g, null, { r1: 0, c1: 0, r2: 4, c2: 1 }, 3, ">1", "xlOr");
    }).toThrow();
    expect(st).toBeNull();
  });

  it("oo:cell/js-api/api-auto-filter.js#ApplyFilter recalculates visibility on new data", () => {
    let g = values([1, 2, 2, 4, 5, "", ""]);
    const st = setAutoFilter(g, null, A1_A10, 1, ">2", "xlOr");
    expect(st).not.toBeNull();
    const h1 = hidden(g, st);
    expect(h1.includes(0)).toBe(false);
    expect([1, 2].every((r) => h1.includes(r))).toBe(true);
    expect([3, 4].some((r) => h1.includes(r))).toBe(false);
    // New data; re-applying the same criteria re-evaluates every row.
    g = values([1, 2, 2, 4, 5, 2, 3]);
    const h2 = hidden(g, st);
    expect(h2.includes(0)).toBe(false);
    expect(h2.filter((r) => r <= 6)).toEqual([1, 2, 5]);
  });

  it("oo:cell/js-api/api-auto-filter.js#ShowAllData makes all rows visible but keeps AutoFilter", () => {
    const g = values([1, 2, 3, 4, 5]);
    let st = setAutoFilter(g, null, A1_A10, 1, "<1", "xlOr");
    expect(hidden(g, st).filter((r) => r <= 4)).toEqual([1, 2, 3, 4]);
    st = showAllData(st!);
    expect(hidden(g, st)).toEqual([]);
    expect(st.range).toEqual(A1_A10);
  });
});

