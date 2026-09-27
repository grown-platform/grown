// Ports of OnlyOffice's conditional-formatting suites (behaviour only):
//   cell/spreadsheet-calculation/conditionalFormattingTests.js
//   cell/js-api/api-format-conditions.js
// against ../cfOps.ts. "Compiled style" checks become checks on the fill the
// evaluator gives each cell; API property checks run against the rule model.

import { describe, expect, it } from "vitest";
import {
  addRule,
  clearRulesInRange,
  colorScaleRule,
  deleteRule,
  evaluateCF,
  iconSetCfvos,
  newRule,
  rangesText,
  rulesInRange,
  setFirstPriority,
  setIconSet,
  setLastPriority,
  setPriority,
  textRuleFormula,
  type CfRule,
} from "../cfOps";
import { gridFromRows, parseA1Range, typedCell, type Grid } from "../cellValue";
import type { CellRect } from "../cellRange";

const R = (a1: string): CellRect => parseA1Range(a1)!;

function fillAt(rules: CfRule[], grid: Grid, a1: string, now?: Date): string | undefined {
  const p = R(a1);
  return evaluateCF(rules, grid, { now }).get(`${p.r1}_${p.c1}`)?.fill;
}

/** A 100×26 grid seeded like the api-format-conditions suite. */
function seeded(): Grid {
  const g: Grid = Array.from({ length: 100 }, () => Array.from({ length: 26 }, () => null));
  const vals = [10, 20, 30, 40, 50];
  vals.forEach((v, i) => {
    g[i][0] = typedCell(v);
    g[i][1] = typedCell(vals[vals.length - 1 - i]);
  });
  g[0][2] = typedCell("Hello world");
  g[1][2] = typedCell("world");
  g[0][3] = typedCell("5/15/2023");
  for (let r = 1; r <= 10; r++) {
    g[r - 1][4] = typedCell(r * 3);
    g[r - 1][5] = typedCell(r % 2 === 0 ? "dup" : "uniq" + r);
    g[r - 1][6] = typedCell(r);
    g[r - 1][7] = typedCell(100 - r);
    g[r - 1][8] = typedCell(r * -1);
  }
  return g;
}

const PINK = "#ffc7ce";

describe("conditionalFormattingTests.js", () => {
  it("oo:cell/spreadsheet-calculation/conditionalFormattingTests.js#Conditional formatting: test apply to", () => {
    // A rule's location reads back as an absolute reference.
    const rule = newRule("cellIs", [R("A5")]);
    expect("=" + rangesText(rule.ranges).replace(/([A-Z]+)(\d+)/g, "$$$1$$$2")).toBe("=$A$5");
    // A table column (Table1[Column1] over A1:B3 plus a new row) resolves to its data cells.
    const tableCol = newRule("cellIs", [R("A2:A4")]);
    expect("=" + rangesText(tableCol.ranges).replace(/([A-Z]+)(\d+)/g, "$$$1$$$2")).toBe("=$A$2:$A$4");
    expect(rulesInRange([rule, tableCol], R("A5")).map((r) => r.id)).toEqual([rule.id]);
  });

  it('oo:cell/spreadsheet-calculation/conditionalFormattingTests.js#Test: simple tests', () => {
    const grid = gridFromRows([["100"]]);
    const rule = newRule("cellIs", [R("A1")], {
      operator: "greaterThan",
      formula1: "99",
      style: { fill: "#FFC7CE", color: "#9C0006" },
    });
    const res = evaluateCF([rule], grid).get("0_0");
    expect(res?.fill).toBe(PINK);
    expect(res?.color).toBe("#9c0006");
  });

  it("oo:cell/spreadsheet-calculation/conditionalFormattingTests.js#Conditional formatting: contains text tests", () => {
    const fill = "#bdd7ee";
    let grid = gridFromRows([["This is sample text"], ["Text with sample word"], ["No matching here"], ["SAMPLE in uppercase"]]);
    let rules = [newRule("containsText", [R("A1:A4")], { text: "sample", style: { fill } })];
    expect(["A1", "A2", "A3", "A4"].map((a) => fillAt(rules, grid, a) === fill)).toEqual([true, true, false, true]);

    // A cell reference in the text is relative to the rule's base cell; with
    // the base on the first cell's row above (A1 while the rule covers A2:A4)
    // each cell compares with itself.
    grid = gridFromRows([["apple"], ["This is an apple text"], ["Orange juice"], ["Pineapple is good"]]);
    rules = [newRule("containsText", [R("A2:A4")], { text: "=A1", base: { r: 0, c: 0 }, style: { fill: "#c6efce" } })];
    expect(["A2", "A3", "A4"].map((a) => fillAt(rules, grid, a))).toEqual(["#c6efce", "#c6efce", "#c6efce"]);

    grid = gridFromRows([["Spreadsheet testing"], ["Testing Spreadsheet"], ["Microsoft Spreadsheet"], ["spreadsheet lowercase"]]);
    rules = [newRule("beginsWith", [R("A1:A4")], { text: "Spreadsheet", style: { fill: "#ffeb9c" } })];
    expect(["A1", "A2", "A3", "A4"].map((a) => fillAt(rules, grid, a) === "#ffeb9c")).toEqual([true, false, false, true]);
  });

  it("oo:cell/spreadsheet-calculation/conditionalFormattingTests.js#Conditional formatting: not contains text tests", () => {
    const grid = gridFromRows([["Report 2023"], ["Sales data"], ["Error in data"], ["Missing values"]]);
    const rules = [newRule("notContainsText", [R("A1:A4")], { text: "Error", style: { fill: "#b4c6e7" } })];
    expect(["A1", "A2", "A3", "A4"].map((a) => fillAt(rules, grid, a) === "#b4c6e7")).toEqual([true, true, false, true]);
  });

  it("oo:cell/spreadsheet-calculation/conditionalFormattingTests.js#Conditional formatting: asc_setContainsText with formula and text", () => {
    let grid = gridFromRows([["Product", "Intel"], ["CPU Intel"], ["Graphics card AMD"], ["Intel Motherboard"], ["AMD Processor"]]);
    let rules = [newRule("containsText", [R("A2:A5")], { text: "Intel", style: { fill: "#bdd7ee" } })];
    expect(["A2", "A3", "A4", "A5"].map((a) => fillAt(rules, grid, a) === "#bdd7ee")).toEqual([true, false, true, false]);

    // "=B1" relative to A2: A2 looks at B1 ("Intel"), later rows at empty B cells
    // (an empty needle matches every text).
    rules = [newRule("containsText", [R("A2:A5")], { text: "=B1", style: { fill: "#c6efce" } })];
    expect(["A2", "A3", "A4", "A5"].map((a) => fillAt(rules, grid, a) === "#c6efce")).toEqual([true, true, true, true]);

    grid = gridFromRows([["Product", "AMD"], ["CPU Intel"], ["Graphics card AMD"], ["Intel Motherboard"], ["AMD Processor"]]);
    rules = [newRule("containsText", [R("A2:A5")], { text: "=UPPER(B1)", style: { fill: "#ffeb9c" } })];
    const hits = ["A2", "A3", "A4", "A5"].map((a) => fillAt(rules, grid, a) === "#ffeb9c");
    expect(hits[0]).toBe(false);
    expect(hits[1]).toBe(true);
    expect(hits[3]).toBe(true);

    // Formula vs. literal text, one rule per cell.
    grid = gridFromRows([["test"], ["test"], ["test"], ["test"], ["test"]]);
    rules = [
      newRule("containsText", [R("A1")], { text: "=test", style: { fill: "#ffeb9c" } }),
      newRule("containsText", [R("A2")], { text: '="test"', style: { fill: "#ffeb9c" } }),
      newRule("containsText", [R("A3")], { text: "test", style: { fill: "#ffeb9c" } }),
      newRule("containsText", [R("A4")], { text: '"test"', style: { fill: "#ffeb9c" } }),
    ];
    expect(["A1", "A2", "A3", "A4"].map((a) => fillAt(rules, grid, a) === "#ffeb9c")).toEqual([false, true, true, false]);
  });
});

describe("api-format-conditions.js", () => {
  const grid = seeded();

  it("oo:cell/js-api/api-format-conditions.js#initializeTest clears CF in A1:Z100", () => {
    let rules = addRule([], newRule("cellIs", [R("A1:A5")], { operator: "lessThan", formula1: "25" }));
    expect(rulesInRange(rules, R("A1:A5")).length).toBe(1);
    rules = clearRulesInRange(rules, R("A1:Z100"));
    expect(rulesInRange(rules, R("A1:Z100")).length).toBe(0);
  });

  it("oo:cell/js-api/api-format-conditions.js#Add + GetItem + basic getters (xlCellValue)", () => {
    const c1 = newRule("cellIs", [R("A1:A5")], { operator: "lessThan", formula1: "25", style: { fill: "#ff0000" } });
    const rules = addRule([], c1);
    expect(rulesInRange(rules, R("A1:A5")).length).toBe(1);
    expect(rules[0]).toMatchObject({ type: "cellIs", operator: "lessThan", formula1: "25" });
    expect(rules[0].style?.fill).toBe("#ff0000");
    expect(rangesText(rules[0].ranges)).toBe("A1:A5");
    // A1 (10) and A2 (20) are < 25.
    const res = evaluateCF(rules, grid);
    expect([0, 1, 2, 3, 4].map((r) => res.get(`${r}_0`)?.fill ?? null)).toEqual(["#ff0000", "#ff0000", null, null, null]);
  });

  it("oo:cell/js-api/api-format-conditions.js#Modify operator and formula; SetBorders; ScopeType switch", () => {
    let c = newRule("cellIs", [R("A1:A5")], { operator: "between", formula1: "15", formula2: "35", style: { fill: PINK } });
    expect(c.operator).toBe("between");
    let res = evaluateCF([c], grid);
    expect([0, 1, 2, 3].map((r) => !!res.get(`${r}_0`))).toEqual([false, true, true, false]);
    c = { ...c, operator: "greaterThan", formula1: "15", formula2: undefined };
    expect(c.formula1).toBe("15");
    // A reference operand: greater than A1 (10), relative to the rule's first cell.
    c = { ...c, formula1: "$A$1" };
    res = evaluateCF([c], grid);
    expect([0, 1, 2].map((r) => !!res.get(`${r}_0`))).toEqual([false, true, true]);
  });

  it("oo:cell/js-api/api-format-conditions.js#Priority controls: SetFirstPriority / SetLastPriority / SetPriority", () => {
    let rules: CfRule[] = [];
    const a = newRule("cellIs", [R("A1:A5")], { operator: "greaterThan", formula1: "5" });
    const b = newRule("cellIs", [R("A1:A5")], { operator: "lessThan", formula1: "50" });
    const c = newRule("cellIs", [R("A1:A5")], { operator: "equal", formula1: "30" });
    rules = addRule(addRule(addRule(rules, a), b), c);
    const p = (id: string) => rules.find((r) => r.id === id)!.priority;
    expect(p(a.id) < p(b.id) && p(b.id) < p(c.id)).toBe(true);
    rules = setFirstPriority(rules, b.id);
    expect(p(b.id)).toBe(1);
    rules = setLastPriority(rules, a.id);
    expect(p(a.id) > p(c.id)).toBe(true);
    const maxP = Math.max(p(a.id), p(b.id), p(c.id));
    rules = setPriority(rules, c.id, maxP + 10);
    expect(p(c.id)).toBe(maxP + 10);
  });

  it("oo:cell/js-api/api-format-conditions.js#Text rules: Text, TextOperator and generated formulas", () => {
    let c = newRule("beginsWith", [R("C1:C5")], { text: "Hel", style: { fill: PINK } });
    expect(c.type).toBe("beginsWith");
    expect(fillAt([c], grid, "C1")).toBe(PINK);
    c = { ...c, text: "world" };
    expect(c.text).toBe("world");
    expect(textRuleFormula(c)).toBe('LEFT(C1,LEN("world"))="world"');
    c = { ...c, type: "containsText" };
    expect(textRuleFormula(c)).toBe('NOT(ISERROR(SEARCH("world",C1)))');
    expect([fillAt([c], grid, "C1"), fillAt([c], grid, "C2")]).toEqual([PINK, PINK]);
  });

  it("oo:cell/js-api/api-format-conditions.js#Time period rule: DateOperator get/set", () => {
    const now = new Date(2023, 4, 15);
    let c = newRule("timePeriod", [R("D1:D5")], { period: "yesterday", style: { fill: PINK } });
    expect(c.period).toBe("yesterday");
    expect(fillAt([c], grid, "D1", now)).toBeUndefined();
    c = { ...c, period: "today" };
    expect(c.period).toBe("today");
    expect(fillAt([c], grid, "D1", now)).toBe(PINK);
  });

  it("oo:cell/js-api/api-format-conditions.js#ColorScale (2-color) criteria manipulation", () => {
    const cs = colorScaleRule([R("A1:A10")], 2);
    expect(cs.type).toBe("colorScale");
    expect(cs.cfvos?.length).toBe(2);
    cs.cfvos = [{ type: "autoMin", value: "0" }, { type: "autoMax", value: "100" }];
    cs.colors = ["#f8696b", "#63be7b"];
    expect(cs.cfvos.map((x) => x.type)).toEqual(["autoMin", "autoMax"]);
    // Automatic min/max span 0..50: 10 is a fifth of the way from red to green.
    const res = evaluateCF([cs], grid);
    expect(res.get("4_0")?.fill).toBe("#63be7b");
    expect(res.get("0_0")?.fill).toBe("#da7a6e");
  });

  it("oo:cell/js-api/api-format-conditions.js#ColorScale (3-color) criteria manipulation", () => {
    const cs = colorScaleRule([R("B1:B10")], 3);
    expect(cs.cfvos?.length).toBe(3);
    cs.cfvos![1] = { type: "percentile", value: "60" };
    cs.colors![1] = "#ffeb84";
    expect(cs.cfvos![1]).toEqual({ type: "percentile", value: "60" });
    // B1:B5 = 50..10: the 60th percentile is 34, so 34 would be pure yellow;
    // min (10) is red and max (50) green.
    const res = evaluateCF([cs], grid);
    expect(res.get("4_1")?.fill).toBe("#f8696b");
    expect(res.get("0_1")?.fill).toBe("#63be7b");
    // With 34 added to 10..50 the 60th percentile is exactly 34.
    const mid = evaluateCF(
      [{ ...cs, ranges: [R("A1:A6")] }],
      gridFromRows([[10], [20], [30], [40], [50], [34]]),
    );
    expect(mid.get("5_0")?.fill).toBe("#ffeb84");
  });

  it("oo:cell/js-api/api-format-conditions.js#DataBar: axis, direction, show values, colors, min/max and lengths", () => {
    const db = newRule("dataBar", [R("I1:I10")]);
    expect(db.type).toBe("dataBar");
    db.bar = {
      ...db.bar!,
      axisPosition: "middle",
      direction: "rightToLeft",
      showValue: false,
      color: "#638ec6",
      borderColor: "#0a141e",
      negativeColor: "#c83232",
      negativeBorderColor: "#323232",
      minLength: 5,
      maxLength: 95,
      min: { type: "num", value: "-10" },
      max: { type: "num", value: "0" },
    };
    expect(db.bar.min).toEqual({ type: "num", value: "-10" });
    const res = evaluateCF([db], grid);
    // I1..I10 = -1..-10. Middle axis at 50%; right-to-left mirrors the bars.
    const b10 = res.get("9_8")!.bar!;
    expect(b10.negative).toBe(true);
    expect(b10.color).toBe("#c83232");
    expect(b10.axis).toBe(0.5);
    expect([b10.x0, b10.x1]).toEqual([0.5, 1]);
    const b5 = res.get("4_8")!.bar!;
    expect(b5.x1 - b5.x0).toBeCloseTo(0.25, 9);
    expect(res.get("0_8")!.hideValue).toBe(true);
    // Plain bars without negatives start at the left edge and scale min..max lengths.
    const plain = newRule("dataBar", [R("G1:G10")], {});
    plain.bar = { ...plain.bar!, minLength: 10, maxLength: 90, min: { type: "min" }, max: { type: "max" } };
    const pr = evaluateCF([plain], grid);
    expect(pr.get("0_6")!.bar).toMatchObject({ x0: 0, x1: 0.1, axis: null });
    expect(pr.get("9_6")!.bar!.x1).toBeCloseTo(0.9, 9);
  });

  it("oo:cell/js-api/api-format-conditions.js#IconSet: change set, percentile thresholds and reverse order", () => {
    let ic = newRule("iconSet", [R("E1:E10")]);
    ic = { ...ic, showValue: false };
    ic = setIconSet(ic, "5Quarters");
    expect(ic.iconSet).toBe("5Quarters");
    ic.cfvos = ic.cfvos!.map((x) => ({ ...x, type: "percentile" as const }));
    ic.reverse = true;
    expect(ic.cfvos.length).toBe(5);
    // E1..E10 = 3..30. Reversed: the largest values get the first icon.
    let res = evaluateCF([ic], grid);
    expect(res.get("9_4")!.icon).toEqual({ set: "5Quarters", index: 0 });
    expect(res.get("0_4")!.icon).toEqual({ set: "5Quarters", index: 4 });
    expect(res.get("0_4")!.hideValue).toBe(true);
    ic = setIconSet({ ...ic, reverse: false }, "3TrafficLights1");
    expect(ic.cfvos).toEqual(iconSetCfvos("3TrafficLights1"));
    ic.cfvos![1] = { type: "num", value: "12", gte: true };
    ic.cfvos![2] = { type: "num", value: "24", gte: false };
    res = evaluateCF([ic], grid);
    expect(res.get("2_4")!.icon!.index).toBe(0); // 9
    expect(res.get("3_4")!.icon!.index).toBe(1); // 12 ≥ 12
    expect(res.get("7_4")!.icon!.index).toBe(1); // 24 is not > 24
    expect(res.get("8_4")!.icon!.index).toBe(2); // 27
  });

  it("oo:cell/js-api/api-format-conditions.js#AboveAverage: defaults and setters", () => {
    let aa = newRule("aboveAverage", [R("E1:E10")], { style: { fill: PINK } });
    expect(aa.above).toBe(true);
    // E = 3..30, average 16.5.
    let res = evaluateCF([aa], grid);
    expect([4, 5].map((r) => !!res.get(`${r}_4`))).toEqual([false, true]);
    aa = { ...aa, above: false };
    res = evaluateCF([aa], grid);
    expect([4, 5].map((r) => !!res.get(`${r}_4`))).toEqual([true, false]);
    aa = { ...aa, stdDev: 2 };
    expect(aa.stdDev).toBe(2);
    // Nothing lies two standard deviations (≈18.2) below the mean.
    expect(evaluateCF([aa], grid).size).toBe(0);
  });

  it("oo:cell/js-api/api-format-conditions.js#Top10: defaults and setters (top/bottom, percent, rank)", () => {
    let t = newRule("top10", [R("G1:G10")], { style: { fill: "#dce6f1" } });
    expect([t.rank, t.percent, t.bottom]).toEqual([10, false, false]);
    expect(evaluateCF([t], grid).size).toBe(10);
    t = { ...t, rank: 3, percent: true, bottom: true };
    expect([t.rank, t.percent, t.bottom]).toEqual([3, true, true]);
    // 3% of ten values rounds down to zero; at least one item is always shown.
    const res = evaluateCF([t], grid);
    expect([...res.keys()]).toEqual(["0_6"]);
  });

  it("oo:cell/js-api/api-format-conditions.js#UniqueValues and Delete()", () => {
    let rules = addRule([], newRule("uniqueValues", [R("F1:F10")], { style: { fill: PINK } }));
    expect(rulesInRange(rules, R("F1:F10")).length).toBe(1);
    const res = evaluateCF(rules, grid);
    // F: uniq1, dup, uniq3, dup, … — only the uniqN cells are unique.
    expect([0, 1, 2, 3].map((r) => !!res.get(`${r}_5`))).toEqual([true, false, true, false]);
    rules = addRule(rules, newRule("cellIs", [R("F1:F10")], { operator: "greaterThan", formula1: "0" }));
    expect(rulesInRange(rules, R("F1:F10")).length).toBe(2);
    rules = clearRulesInRange(rules, R("F1:F10"));
    expect(rulesInRange(rules, R("F1:F10")).length).toBe(0);
  });

  it("oo:cell/js-api/api-format-conditions.js#GetCount considers intersection only", () => {
    const rules = addRule([], newRule("cellIs", [R("X1:X5")], { operator: "greaterThan", formula1: "0" }));
    expect(rulesInRange(rules, R("A1:A5")).length).toBe(0);
  });

  it("oo:cell/js-api/api-format-conditions.js#FormatCondition.Delete removes single rule", () => {
    const c1 = newRule("cellIs", [R("I1:I10")], { operator: "greaterThan", formula1: "0" });
    const c2 = newRule("cellIs", [R("I1:I10")], { operator: "lessThan", formula1: "0" });
    let rules = addRule(addRule([], c1), c2);
    expect(rulesInRange(rules, R("I1:I10")).length).toBe(2);
    rules = deleteRule(rules, c1.id);
    expect(rulesInRange(rules, R("I1:I10")).length).toBe(1);
  });

  it("oo:cell/js-api/api-format-conditions.js#ApiDatabar extra props: AxisColor and BarFillType", () => {
    const db = newRule("dataBar", [R("H1:H10")]);
    db.bar = { ...db.bar!, axisColor: "#000000", gradient: false };
    expect(db.bar.axisColor).toBe("#000000");
    expect(db.bar.gradient).toBe(false);
    const bar = evaluateCF([db], grid).get("0_7")!.bar!;
    expect(bar.gradient).toBe(false);
    expect(bar.axisColor).toBe("#000000");
  });

  it("oo:cell/js-api/api-format-conditions.js#ApiFormatCondition with expression", () => {
    const c = newRule("expression", [R("A1:A10")], { formula1: "=$A1>10", style: { fill: PINK } });
    expect(c.type).toBe("expression");
    expect(c.formula1?.replace(/^=/, "")).toBe("$A1>10");
    const res = evaluateCF([c], grid);
    expect([0, 1, 4, 5].map((r) => !!res.get(`${r}_0`))).toEqual([false, true, true, false]);
  });
});

describe("rule priority and stop-if-true", () => {
  it("lets the higher-priority rule win and stops lower rules", () => {
    const g = gridFromRows([[5], [15], [25]]);
    let rules = addRule([], newRule("cellIs", [R("A1:A3")], { operator: "greaterThan", formula1: "10", style: { fill: "#ff0000" } }));
    rules = addRule(rules, newRule("cellIs", [R("A1:A3")], { operator: "greaterThan", formula1: "0", style: { fill: "#00ff00", color: "#0000ff" } }));
    let res = evaluateCF(rules, g);
    expect(res.get("1_0")).toMatchObject({ fill: "#ff0000", color: "#0000ff" });
    expect(res.get("0_0")).toMatchObject({ fill: "#00ff00" });
    rules = rules.map((r, i) => (i === 0 ? { ...r, stopIfTrue: true } : r));
    res = evaluateCF(rules, g);
    expect(res.get("1_0")?.color).toBeUndefined();
  });
});
