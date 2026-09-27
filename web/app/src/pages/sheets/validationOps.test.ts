import { describe, expect, it } from "vitest";
import {
  fromFortuneVerification,
  inputDecision,
  invalidCells,
  makeRule,
  setValidation,
  toFortuneVerification,
} from "./validationOps";
import { gridFromRows } from "./cellValue";

const rect = (r1: number, c1: number, r2: number, c2: number) => ({ r1, c1, r2, c2 });

describe("validationOps", () => {
  it("derives FortuneSheet entries per cell", () => {
    const list = makeRule([rect(0, 0, 1, 0)], { type: "list", formula1: "=$D$1:$D$3", prompt: "Pick one" });
    const whole = makeRule([rect(0, 1, 0, 1)], { type: "whole", operator: "greaterThan", formula1: 3 });
    const time = makeRule([rect(0, 2, 0, 2)], { type: "time", formula1: "9:00", formula2: "17:00" });
    const map = toFortuneVerification([list, whole, time]);
    expect(Object.keys(map).sort()).toEqual(["0_0", "0_1", "0_2", "1_0"]);
    expect(map["0_0"]).toMatchObject({ type: "dropdown", value1: "D1:D3", hintShow: true, hintValue: "Pick one", prohibitInput: false });
    expect(map["0_1"]).toMatchObject({ type: "number_integer", type2: "moreThanThe", value1: "3" });
    expect(map["0_2"]).toMatchObject({ type: "grown" });
  });

  it("converts legacy per-cell entries into range rules", () => {
    const item = { type: "dropdown", type2: "", value1: "Low,High", prohibitInput: true, hintShow: false };
    const rules = fromFortuneVerification({
      "0_0": { ...item, rangeTxt: "A1:B2" },
      "0_1": { ...item, rangeTxt: "A1:B2" },
      "1_0": { ...item, rangeTxt: "A1:B2" },
      "1_1": { ...item, rangeTxt: "A1:B2" },
      "5_5": { type: "number_decimal", type2: "between", value1: "1", value2: "9", prohibitInput: false },
      "9_9": { type: "dropdown", grownRule: "x" },
    });
    expect(rules.length).toBe(2);
    expect(rules[0]).toMatchObject({ type: "list", formula1: "Low,High", errorStyle: "stop", ranges: [rect(0, 0, 1, 1)] });
    expect(rules[1]).toMatchObject({ type: "decimal", formula1: "1", formula2: "9", errorStyle: "warning" });
  });

  it("circles invalid data and maps alert styles", () => {
    const grid = gridFromRows([[1], [20], [null], ["x"]]);
    const { rules } = setValidation([], rect(0, 0, 3, 0), { type: "whole", operator: "lessThan", formula1: 10 });
    expect(invalidCells(rules, { grid })).toEqual([
      { r: 1, c: 0 },
      { r: 3, c: 0 },
    ]);
    const r = rules[0];
    expect(inputDecision(r, true)).toBe("accept");
    expect(inputDecision(r, false)).toBe("reject");
    expect(inputDecision({ ...r, errorStyle: "warning" }, false)).toBe("confirm");
    expect(inputDecision({ ...r, errorStyle: "information" }, false)).toBe("inform");
    expect(inputDecision({ ...r, showError: false }, false)).toBe("accept");
  });
});
