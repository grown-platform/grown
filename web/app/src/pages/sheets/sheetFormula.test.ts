import { describe, expect, it } from "vitest";
import { evaluateFormula, formulaIsTrue, matchesCriteria, percentileInc } from "./sheetFormula";
import { gridFromRows, parseInput, partsToSerial, serialToParts } from "./cellValue";

describe("cellValue dates", () => {
  it("round-trips 1900-system serials, including the fake 29 Feb 1900", () => {
    expect(partsToSerial(1900, 1, 1)).toBe(1);
    expect(partsToSerial(1900, 2, 28)).toBe(59);
    expect(partsToSerial(1900, 2, 29)).toBe(60);
    expect(partsToSerial(1900, 3, 1)).toBe(61);
    expect(partsToSerial(2023, 5, 15)).toBe(45061);
    expect(serialToParts(45061)).toMatchObject({ y: 2023, m: 5, d: 15, dow: 1 });
    expect(serialToParts(60)).toMatchObject({ y: 1900, m: 2, d: 29 });
    expect(serialToParts(1)).toMatchObject({ y: 1900, m: 1, d: 1 });
  });
  it("parses typed input", () => {
    expect(parseInput("1,234.5")).toMatchObject({ v: 1234.5, t: "n" });
    expect(parseInput("50%")).toMatchObject({ v: 0.5, t: "n" });
    expect(parseInput("8/20/1994")).toMatchObject({ v: 34566, t: "d" });
    expect(parseInput("12:00")).toMatchObject({ v: 0.5, t: "d" });
    expect(parseInput("9/26/1902 2:24").v).toBeCloseTo(1000.1, 9);
    expect(parseInput("TRUE")).toMatchObject({ v: true, t: "b" });
    expect(parseInput("hello")).toMatchObject({ v: "hello", t: "s" });
  });
});

describe("sheetFormula", () => {
  const grid = gridFromRows([
    [10, "apple", "x"],
    [20, "banana", "x"],
    [30, "Cherry pie", "y"],
    [null, "", ""],
  ]);
  const ev = (f: string, dr = 0, dc = 0) => evaluateFormula(f, { grid, dr, dc, row: dr, col: dc });

  it("evaluates operators and precedence", () => {
    expect(ev("=1+2*3")).toBe(7);
    expect(ev("=(1+2)*3")).toBe(9);
    expect(ev("=2^3^2")).toBe(64);
    expect(ev("=-A1+5")).toBe(-5);
    expect(ev('="a"&"b"&1')).toBe("ab1");
    expect(ev("=A1>5")).toBe(true);
    expect(ev('=B1="APPLE"')).toBe(true);
    expect(ev("=50%")).toBe(0.5);
    expect(ev("=1/0")).toEqual({ error: "#DIV/0!" });
  });

  it("shifts relative references per cell and keeps absolute parts", () => {
    expect(ev("=A1", 1)).toBe(20);
    expect(ev("=$A$1", 2)).toBe(10);
    expect(ev("=$A1", 2, 1)).toBe(30);
    expect(ev("=A$1", 2)).toBe(10);
    expect(ev("=A1", -1)).toEqual({ error: "#REF!" });
  });

  it("supports common functions and whole-column ranges", () => {
    expect(ev("=SUM(A:A)")).toBe(60);
    expect(ev("=AVERAGE(A1:A3)")).toBe(20);
    expect(ev('=COUNTIF(C:C;"x")')).toBe(2);
    expect(ev('=COUNTIF(B1:B3,"*an*")')).toBe(1);
    expect(ev('=NOT(ISERROR(SEARCH("pie",B3)))')).toBe(true);
    expect(ev('=LEFT(B3,LEN("cherry"))="cherry"')).toBe(true);
    expect(ev("=UPPER(B1)")).toBe("APPLE");
    expect(ev("=IF(A1>15,\"big\",\"small\")", 1)).toBe("big");
    expect(ev("=ISBLANK(A4)")).toBe(true);
    expect(ev("=MOD(ROW(),2)=0", 1)).toBe(true);
    expect(ev("=nosuchname")).toEqual({ error: "#NAME?" });
    expect(ev("=NOSUCHFN(1)")).toEqual({ error: "#NAME?" });
  });

  it("evaluates cross-sheet references and names", () => {
    const other = gridFromRows([[5], [6]]);
    const ctx = { grid, sheets: { "My Sheet": other }, names: { Limit: "'My Sheet'!$A$2" } };
    expect(evaluateFormula("='My Sheet'!A1+A1", ctx)).toBe(15);
    expect(evaluateFormula("=A1>Limit", ctx)).toBe(true);
  });

  it("formulaIsTrue treats errors and text as false", () => {
    expect(formulaIsTrue("=1", { grid })).toBe(true);
    expect(formulaIsTrue('="x"', { grid })).toBe(false);
    expect(formulaIsTrue("=1/0", { grid })).toBe(false);
    expect(formulaIsTrue("=(", { grid })).toBe(false);
  });

  it("matches COUNTIF criteria", () => {
    expect(matchesCriteria(5, ">3")).toBe(true);
    expect(matchesCriteria("abc", "a*")).toBe(true);
    expect(matchesCriteria("abc", "<>a*")).toBe(false);
    expect(matchesCriteria(null, "")).toBe(true);
    expect(matchesCriteria(3, 3)).toBe(true);
  });

  it("computes PERCENTILE.INC", () => {
    expect(percentileInc([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentileInc([10, 20, 30, 40], 0.6)).toBeCloseTo(28, 9);
  });
});
