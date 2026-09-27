import { describe, expect, it } from "vitest";
import { evaluateCF, fromFortuneRules, moveRule, newRule, toFortuneRules, addRule } from "./cfOps";
import { gridFromRows } from "./cellValue";

describe("cfOps FortuneSheet bridge", () => {
  it("converts FortuneSheet rules and skips derived ones", () => {
    const rules = fromFortuneRules([
      {
        type: "default",
        cellrange: [{ row: [0, 4], column: [0, 0] }],
        format: { textColor: "#ff0000", cellColor: "rgb(255,255,0)" },
        conditionName: "greaterThan",
        conditionValue: ["5"],
      },
      { type: "colorGradation", cellrange: [{ row: [0, 4], column: [1, 1] }], format: ["rgb(248,105,107)", "rgb(99,190,123)"] },
      { type: "dataBar", cellrange: [{ row: [0, 4], column: [2, 2] }], format: ["rgb(255,255,255)", "rgb(99,142,198)"] },
      { type: "default", grownDerived: true, cellrange: [{ row: [0, 0], column: [0, 0] }], conditionName: "textContains" },
    ]);
    expect(rules.map((r) => r.type)).toEqual(["cellIs", "colorScale", "dataBar"]);
    expect(rules[0]).toMatchObject({ operator: "greaterThan", formula1: "5", style: { fill: "#ffff00", color: "#ff0000" } });
    expect(rules[1].colors).toEqual(["#f8696b", "#63be7b"]);
    expect(rules[2].bar?.color).toBe("#638ec6");
    expect(rules.map((r) => r.priority)).toEqual([1, 2, 3]);
  });

  it("derives FortuneSheet font-colour entries grouped per colour", () => {
    const g = gridFromRows([[1], [2], [3]]);
    const rule = newRule("cellIs", [{ r1: 0, c1: 0, r2: 2, c2: 0 }], {
      operator: "greaterThan",
      formula1: "1",
      style: { color: "#0000ff" },
    });
    const derived = toFortuneRules(evaluateCF([rule], g));
    expect(derived).toEqual([
      expect.objectContaining({
        grownDerived: true,
        conditionName: "textContains",
        cellrange: [{ row: [1, 2], column: [0, 0] }],
        format: { textColor: "#0000ff", cellColor: null },
      }),
    ]);
  });

  it("moves rules up and down", () => {
    const a = newRule("containsBlanks", []);
    const b = newRule("containsErrors", []);
    let rules = addRule(addRule([], a), b);
    rules = moveRule(rules, b.id, -1);
    expect(rules.map((r) => [r.id, r.priority])).toEqual([
      [b.id, 1],
      [a.id, 2],
    ]);
  });
});
