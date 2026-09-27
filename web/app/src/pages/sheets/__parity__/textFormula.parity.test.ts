import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { closeParens, dropUnaryPlus, entryToFormula } from "../textFormula";

// Shared with Go (internal/sheets/text_formula_test.go), which evaluates each
// formula; here the typed input → formula text part.
const fixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../../../../internal/sheets/testdata/structure/text-to-formula.json"), "utf8"),
) as { cases: { id: string; entries: { input: string; formula: string | null }[] }[] };

const byId = (id: string) => fixture.cases.find((c) => c.id === id)!;

function check(id: string) {
  for (const e of byId(id).entries) expect(entryToFormula(e.input), e.input).toBe(e.formula);
}

describe("text to formula (SheetStructureTests)", () => {
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Text to formula tests", () => {
    check("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Text to formula tests");
  });
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Unar operator removing tests", () => {
    check("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Unar operator removing tests");
  });
  it("keeps text and numbers", () => {
    expect(entryToFormula("- buy milk")).toBeNull();
    expect(entryToFormula("-")).toBeNull();
    expect(entryToFormula("-5%")).toBeNull();
    expect(entryToFormula("hello")).toBeNull();
    expect(dropUnaryPlus("=1E+5+ +2")).toBe("=1E+5+ 2");
    expect(closeParens('=CONCAT("(",A1')).toBe('=CONCAT("(",A1)');
  });
});
