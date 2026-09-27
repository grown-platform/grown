// @vitest-environment node
// Insert ▸ Function (M12): OnlyOffice SheetStructureTests.js "Array of
// arguments check after calling the wizard for the function", replayed
// against ../functionArgs.ts. The wizard reads the argument texts of a
// (possibly unfinished) call, and recomputes its result as arguments are
// entered. Behaviour only; no OnlyOffice code is reused.
import { describe, expect, it } from "vitest";
import { buildFunctionCall, parseFunctionCall } from "../functionArgs";

// A stand-in for the engine: SUM over numeric literals.
function evalSum(formula: string): string {
  const p = parseFunctionCall(formula);
  return String(p.args.filter((a) => a !== "").reduce((s, a) => s + Number(a), 0));
}

describe("function wizard arguments", () => {
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Array of arguments check after calling the wizard for the function", () => {
    const cases: [string, string[], null | "parentheses" | "operand"][] = [
      ["SUM(D1", ["D1"], "parentheses"],
      ["SUM(D1,", ["D1", ""], "operand"],
      ["SUM(D1,D2", ["D1", "D2"], "parentheses"],
      ["SUM(D1,D2)", ["D1", "D2"], null],
      ["SUM(D1:D2)", ["D1:D2"], null],
      ["SUM(D1:D2,)", ["D1:D2", ""], null],
      ["SUM(", [""], "operand"],
      ["SUM(1", ["1"], "parentheses"],
      ["SUM(1,D1", ["1", "D1"], "parentheses"],
      ['SUM(1,D1,"str",TRUE,def', ["1", "D1", '"str"', "TRUE", "def"], "parentheses"],
    ];
    for (const [text, args, error] of cases) {
      const p = parseFunctionCall(text);
      expect(p.name, text).toBe("SUM");
      expect(p.args.slice(0, args.length), text).toEqual(args);
      expect(p.error, text).toBe(error);
    }
    // Entering arguments one by one recomputes the call: first argument 1,
    // then a second argument 2, then the second argument cleared again.
    expect(evalSum(buildFunctionCall("SUM", ["1"]))).toBe("1");
    expect(evalSum(buildFunctionCall("SUM", ["1", "2"]))).toBe("3");
    expect(buildFunctionCall("SUM", ["1", ""])).toBe("=SUM(1)");
    expect(evalSum(buildFunctionCall("SUM", ["1", ""]))).toBe("1");
  });

  it("keeps separators inside strings, nested calls and array constants", () => {
    expect(parseFunctionCall('=IF(A1>0,"a,b",MAX(1,2))').args).toEqual(["A1>0", '"a,b"', "MAX(1,2)"]);
    expect(parseFunctionCall("=SUM({1,2;3,4},'My, sheet'!A1)").args).toEqual(["{1,2;3,4}", "'My, sheet'!A1"]);
    expect(parseFunctionCall("=A1+1").name).toBe("");
    expect(buildFunctionCall("pmt", ["0.05/12", "", "1000"])).toBe("=PMT(0.05/12,,1000)");
  });
});
