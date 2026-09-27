// Ports of OnlyOffice's data-validation suites (behaviour only):
//   cell/spreadsheet-calculation/DataValidationTests.js
//   cell/js-api/api-validation.js
// against ../validationOps.ts. Each test starts from an empty rule list.

import { describe, expect, it } from "vitest";
import {
  addValidation,
  checkCell,
  deleteValidation,
  modifyValidation,
  rulesIntersecting,
  validationAt,
  type DvAlertStyle,
  type DvOperator,
  type DvProps,
  type DvRule,
  type DvType,
  type FormulaInput,
} from "../validationOps";
import { parseA1Range, typedCell, type Grid } from "../cellValue";
import type { CellRect } from "../cellRange";

const R = (a1: string): CellRect => parseA1Range(a1)!;

// Excel API names → the model's.
const TYPES: Record<string, DvType> = {
  xlValidateInputOnly: "any",
  xlValidateWholeNumber: "whole",
  xlValidateDecimal: "decimal",
  xlValidateList: "list",
  xlValidateDate: "date",
  xlValidateTime: "time",
  xlValidateTextLength: "textLength",
  xlValidateCustom: "custom",
};
const STYLES: Record<string, DvAlertStyle> = {
  xlValidAlertStop: "stop",
  xlValidAlertWarning: "warning",
  xlValidAlertInformation: "information",
};
const OPS: Record<string, DvOperator> = {
  xlBetween: "between",
  xlNotBetween: "notBetween",
  xlEqual: "equal",
  xlNotEqual: "notEqual",
  xlGreater: "greaterThan",
  xlLess: "lessThan",
  xlGreaterEqual: "greaterThanOrEqual",
  xlLessEqual: "lessThanOrEqual",
};

function props(type: string, style: string, op?: string, f1?: FormulaInput, f2?: FormulaInput): DvProps {
  return {
    type: TYPES[type] ?? (type as DvType),
    errorStyle: STYLES[style],
    operator: op ? OPS[op] : undefined,
    formula1: f1,
    formula2: f2,
  };
}

/** Range.GetValidation().Add(...) on a rule list; returns the new list (unchanged on failure) and the result. */
function add(rules: DvRule[], a1: string, ...args: Parameters<typeof props>) {
  const res = addValidation(rules, R(a1), props(...args));
  return { rules: res ? res.rules : rules, res };
}

const inAny = (rules: DvRule[], a1: string) => {
  const p = R(a1);
  return validationAt(rules, p.r1, p.c1) !== null;
};
const exactRange = (rules: DvRule[], a1: string) => {
  const t = R(a1);
  return rules.find((r) => r.ranges.some((g) => g.r1 === t.r1 && g.c1 === t.c1 && g.r2 === t.r2 && g.c2 === t.c2)) ?? null;
};
const at = (rules: DvRule[], a1: string) => {
  const p = R(a1);
  return validationAt(rules, p.r1, p.c1);
};

describe("DataValidationTests.js", () => {
  it("oo:cell/spreadsheet-calculation/DataValidationTests.js#Data validation: custom formula manipulation", () => {
    let rules: DvRule[] = [];
    // Whole column B, a custom "unique in column" formula (with ; separators).
    const res = addValidation(rules, R("B1:B1048576"), { type: "custom", formula1: "=COUNTIF(B:B;B1)=1", showError: true });
    expect(res).not.toBeNull();
    rules = res!.rules;
    expect(rules.length).toBe(1);
    expect(validationAt(rules, 0, 0)).toBeNull();
    expect(validationAt(rules, 0, 1)).not.toBeNull();
    const grid: Grid = [[null, typedCell("test1")]];
    expect(checkCell(rules, 0, 1, { grid })).toBe(true);
    grid.push([null, typedCell("test1")]);
    expect(checkCell(rules, 1, 1, { grid })).toBe(false);
  });
});

describe("api-validation.js", () => {
  it("oo:cell/js-api/api-validation.js#Empty validation placeholder on a fresh cell", () => {
    expect(validationAt([], 0, 0)).toBeNull();
    expect(rulesIntersecting([], R("A1"))).toEqual([]);
  });

  it("oo:cell/js-api/api-validation.js#Add simple numeric between on A1:C3", () => {
    const { rules, res } = add([], "A1:C3", "xlValidateDecimal", "xlValidAlertWarning", "xlBetween", "5", "15");
    expect(res).not.toBeNull();
    expect(rules.length).toBe(1);
    expect(rules[0].ranges[0]).toEqual(R("A1:C3"));
    const grid: Grid = [[typedCell("10")]];
    expect(checkCell(rules, 0, 0, { grid })).toBe(true);
  });

  it("oo:cell/js-api/api-validation.js#Add with formulas: string, number, ApiRange", () => {
    let rules: DvRule[] = [];
    ({ rules } = add(rules, "D1:D2", "xlValidateList", "xlValidAlertStop", undefined, "A1:A3"));
    expect(at(rules, "D1")!.formula1).toBe("A1:A3");
    ({ rules } = add(rules, "E1:E1", "xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 5, 10));
    expect(at(rules, "E1")!.formula1).toBe("5");
    expect(at(rules, "E1")!.formula2).toBe("10");
    ({ rules } = add(rules, "G1:G2", "xlValidateList", "xlValidAlertWarning", undefined, { range: R("F1:F2") }));
    expect(at(rules, "G1")!.formula1).toBe("=$F$1:$F$2");
  });

  it("oo:cell/js-api/api-validation.js#Add fails when type is invalid", () => {
    const { rules, res } = add([], "A5:A6", "xlValidate__Bogus", "xlValidAlertStop", "xlBetween", 1, 2);
    expect(res).toBeNull();
    expect(rules.length).toBe(0);
  });

  it("oo:cell/js-api/api-validation.js#Add should not work on an area overlapping an existing validation (contains & intersects)", () => {
    let { rules } = add([], "D1:D5", "xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 1, 3);
    const inside = add(rules, "D2:D4", "xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 5, 6);
    expect(inside.res).toBeNull();
    expect(inside.rules.length).toBe(1);
    rules = inside.rules;
    const inter = add(rules, "C4:E7", "xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 7, 8);
    expect(inter.res).toBeNull();
    expect(inter.rules.length).toBe(1);
  });

  it("oo:cell/js-api/api-validation.js#Add allowed on disjoint area creates a second validation", () => {
    let { rules } = add([], "A1:A3", "xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 1, 2);
    ({ rules } = add(rules, "C1:C3", "xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 1, 2));
    expect(rules.length).toBe(2);
  });

  it("oo:cell/js-api/api-validation.js#Type, Operator, AlertStyle, flags and titles/messages, Parent, Value mapping", () => {
    const { rules } = add([], "H1:H3", "xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 1, 100);
    let v = at(rules, "H2")!;
    expect([v.type, v.operator, v.errorStyle]).toEqual(["whole", "between", "stop"]);
    expect([v.allowBlank, v.showInput, v.showError, v.showDropdown]).toEqual([true, true, true, true]);
    v = { ...v, allowBlank: false, showInput: false, showError: false, showDropdown: false };
    expect([v.allowBlank, v.showInput, v.showError, v.showDropdown]).toEqual([false, false, false, false]);
    v = { ...v, showDropdown: true, promptTitle: "Enter age", prompt: "1..100 only", errorTitle: "Bad age", error: "Must be 1..100" };
    expect([v.promptTitle, v.prompt, v.errorTitle, v.error]).toEqual(["Enter age", "1..100 only", "Bad age", "Must be 1..100"]);
    expect(v.showDropdown).toBe(true);
    expect(v.ranges).toEqual([R("H1:H3")]);
  });

  it("oo:cell/js-api/api-validation.js#Delete: range inside validation (remove the sub-area only)", () => {
    let { rules } = add([], "A5:C7", "xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 1, 10);
    rules = deleteValidation(rules, R("B6"));
    expect(rules.length).toBe(1);
    expect(inAny(rules, "B6")).toBe(false);
    expect(inAny(rules, "A5")).toBe(true);
    expect(inAny(rules, "C7")).toBe(true);
    // Every other cell of the block is still covered.
    for (const a of ["B5", "A6", "C6", "A7", "B7"]) expect(inAny(rules, a)).toBe(true);
  });

  it("oo:cell/js-api/api-validation.js#Delete: validation inside range (entire validation removed)", () => {
    let { rules } = add([], "C10:D12", "xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 1, 10);
    expect(rules.length).toBe(1);
    rules = deleteValidation(rules, R("A1:Z100"));
    expect(rules.length).toBe(0);
    expect(inAny(rules, "C11")).toBe(false);
  });

  it("oo:cell/js-api/api-validation.js#Delete: partial overlap (trim intersecting parts, keep the rest)", () => {
    let { rules } = add([], "A1:C3", "xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 1, 9);
    rules = deleteValidation(rules, R("B2:D4"));
    expect(inAny(rules, "A1")).toBe(true);
    expect(inAny(rules, "A3")).toBe(true);
    expect(inAny(rules, "C1")).toBe(true);
    expect(inAny(rules, "B2")).toBe(false);
    expect(inAny(rules, "C3")).toBe(false);
  });

  it("oo:cell/js-api/api-validation.js#Modify: inside case (like delete sub-area then add new validation)", () => {
    let { rules } = add([], "A5:C7", "xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 1, 10);
    const m = modifyValidation(rules, R("B6:B7"), props("xlValidateDecimal", "xlValidAlertWarning", "xlGreater", "5"));
    expect(m).not.toBeNull();
    rules = m!.rules;
    expect(exactRange(rules, "B6:B7")).not.toBeNull();
    expect(at(rules, "B6")!.type).toBe("decimal");
    expect(at(rules, "B7")!.operator).toBe("greaterThan");
    expect(at(rules, "A5")!.type).toBe("whole");
  });

  it("oo:cell/js-api/api-validation.js#Modify: merge multiple existing validations into a single one on a bigger area", () => {
    let { rules } = add([], "A10:A11", "xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 1, 5);
    ({ rules } = add(rules, "C10:C11", "xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 1, 5));
    expect(rulesIntersecting(rules, R("A10:C11")).length).toBeGreaterThanOrEqual(2);
    rules = modifyValidation(rules, R("A10:C11"), props("xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 2, 8))!.rules;
    expect(rules.length).toBe(1);
    expect(exactRange(rules, "A10:C11")).not.toBeNull();
  });

  it("oo:cell/js-api/api-validation.js#Modify: partial overlap — trims originals and adds new one on the modified area", () => {
    let { rules } = add([], "A1:C3", "xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 1, 9);
    rules = modifyValidation(rules, R("B2:D4"), props("xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 3, 7))!.rules;
    expect(exactRange(rules, "B2:D4")).not.toBeNull();
    expect(inAny(rules, "A1")).toBe(true);
    expect(at(rules, "B2")!.formula1).toBe("3");
    expect(at(rules, "C3")!.formula2).toBe("7");
    expect(at(rules, "A1")!.formula2).toBe("9");
  });

  it("oo:cell/js-api/api-validation.js#Delete on area without validations: no throw, no changes", () => {
    const { rules } = add([], "A1", "xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 1, 2);
    expect(deleteValidation(rules, R("Z1:Z2"))).toEqual(rules);
  });

  it("oo:cell/js-api/api-validation.js#Modify when there is no validation: returns null", () => {
    expect(modifyValidation([], R("Y1:Y2"), props("xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 1, 2))).toBeNull();
  });

  it("oo:cell/js-api/api-validation.js#xlValidateWholeNumber: Between 1 and 10 (numbers)", () => {
    const { rules } = add([], "J1:J3", "xlValidateWholeNumber", "xlValidAlertStop", "xlBetween", 1, 10);
    const v = at(rules, "J1")!;
    expect([v.type, v.operator, v.formula1, v.formula2]).toEqual(["whole", "between", "1", "10"]);
    expect(rules.length).toBe(1);
    expect(checkCell(rules, 0, 9, { grid: [[...Array(9).fill(null), typedCell(5)]] })).toBe(true);
    expect(checkCell(rules, 0, 9, { grid: [[...Array(9).fill(null), typedCell(5.5)]] })).toBe(false);
    expect(checkCell(rules, 0, 9, { grid: [[...Array(9).fill(null), typedCell(11)]] })).toBe(false);
  });

  it("oo:cell/js-api/api-validation.js#xlValidateDecimal: Greater than 0.5 (string/decimal)", () => {
    const { rules } = add([], "K1:K3", "xlValidateDecimal", "xlValidAlertWarning", "xlGreater", "0.5");
    const v = at(rules, "K1")!;
    expect([v.type, v.operator, v.formula1]).toEqual(["decimal", "greaterThan", "0.5"]);
    expect(rules.length).toBe(1);
    const row = (x: unknown) => [[...Array(10).fill(null), typedCell(x)]];
    expect(checkCell(rules, 0, 10, { grid: row(2) })).toBe(true);
    expect(checkCell(rules, 0, 10, { grid: row(0.25) })).toBe(false);
  });

  it("oo:cell/js-api/api-validation.js#xlValidateList: Array literal => stored as quoted list string, not empty", () => {
    const { rules } = add([], "L1:L3", "xlValidateList", "xlValidAlertWarning", "xlBetween", ["3", "4"]);
    const v = at(rules, "L1")!;
    expect(v.type).toBe("list");
    expect(v.formula1).toBe("3,4");
    const row = (x: unknown) => [[...Array(11).fill(null), typedCell(x)]];
    expect(checkCell(rules, 0, 11, { grid: row(4) })).toBe(true);
    expect(checkCell(rules, 0, 11, { grid: row(5) })).toBe(false);
  });

  it("oo:cell/js-api/api-validation.js#xlValidateList: ApiRange source => keeps reference (no quotes), no leading = in GetFormula1", () => {
    const { rules } = add([], "N1:N3", "xlValidateList", "xlValidAlertStop", "xlBetween", { range: R("M1:M2") });
    const v = at(rules, "N1")!;
    expect(v.type).toBe("list");
    expect(v.formula1).toBe("=$M$1:$M$2");
    const grid: Grid = [
      [...Array(12).fill(null), typedCell("AA"), typedCell("bb")],
      [...Array(12).fill(null), typedCell("BB")],
    ];
    expect(checkCell(rules, 0, 13, { grid })).toBe(true);
    grid[0][13] = typedCell("CC");
    expect(checkCell(rules, 0, 13, { grid })).toBe(false);
  });

  it("oo:cell/js-api/api-validation.js#xlValidateDate: Greater than 01/31/2027 => stored numerically (no '=' drift)", () => {
    const { rules } = add([], "O1:O3", "xlValidateDate", "xlValidAlertInformation", "xlGreater", "01/31/2027");
    const v = at(rules, "O1")!;
    expect([v.type, v.operator, v.errorStyle]).toEqual(["date", "greaterThan", "information"]);
    expect(v.formula1.startsWith("=")).toBe(false);
    expect(Number(v.formula1)).toBe(46418);
    const row = (x: unknown) => [[...Array(14).fill(null), typedCell(x)]];
    expect(checkCell(rules, 0, 14, { grid: row("2/1/2027") })).toBe(true);
    expect(checkCell(rules, 0, 14, { grid: row("1/31/2027") })).toBe(false);
  });

  it("oo:cell/js-api/api-validation.js#xlValidateTime: Between 12:00 and 13:00 => stored numerically (time serial)", () => {
    const { rules } = add([], "P1:P3", "xlValidateTime", "xlValidAlertWarning", "xlBetween", "12:00", "13:00");
    const v = at(rules, "P1")!;
    expect([v.type, v.operator]).toEqual(["time", "between"]);
    expect(Number(v.formula1)).toBe(0.5);
    expect(Number(v.formula2)).toBeCloseTo(13 / 24, 12);
    const row = (x: unknown) => [[...Array(15).fill(null), typedCell(x)]];
    expect(checkCell(rules, 0, 15, { grid: row("12:30") })).toBe(true);
    expect(checkCell(rules, 0, 15, { grid: row("14:00") })).toBe(false);
  });

  it("oo:cell/js-api/api-validation.js#xlValidateTextLength: Between 1 and 5", () => {
    const { rules } = add([], "Q1:Q3", "xlValidateTextLength", "xlValidAlertStop", "xlBetween", 1, 5);
    const v = at(rules, "Q1")!;
    expect([v.type, v.operator, v.formula1, v.formula2]).toEqual(["textLength", "between", "1", "5"]);
    const row = (x: unknown) => [[...Array(16).fill(null), typedCell(x)]];
    expect(checkCell(rules, 0, 16, { grid: row("abc") })).toBe(true);
    expect(checkCell(rules, 0, 16, { grid: row("abcdef") })).toBe(false);
  });
});
