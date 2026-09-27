// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MOST_USED, findFunction, functionCatalog, parseSignature, searchFunctions } from "./functionCatalog";

const GO_DIR = join(__dirname, "../../../../../internal/sheets");

// Every name the Go engine registers: registerFunc("X", …), helper
// registrations reg("X", …) and the parser's special forms.
function goFunctionNames(): Set<string> {
  const names = new Set(["LAMBDA", "LET", "ARRAYFORMULA"]);
  for (const f of readdirSync(GO_DIR)) {
    if (!f.endsWith(".go") || f.endsWith("_test.go")) continue;
    const src = readFileSync(join(GO_DIR, f), "utf8");
    for (const m of src.matchAll(/registerFunc\("([A-Za-z0-9.]+)"/g)) names.add(m[1].toUpperCase());
    for (const m of src.matchAll(/^\s*reg\("([A-Za-z0-9.]+)"/gm)) names.add(m[1].toUpperCase());
  }
  return names;
}

describe("function catalog", () => {
  it("covers every function the engine evaluates, and nothing else", () => {
    const goNames = goFunctionNames();
    expect(goNames.size).toBeGreaterThan(450);
    const catalog = new Set(functionCatalog().map((f) => f.name));
    expect([...goNames].filter((n) => !catalog.has(n))).toEqual([]);
    expect([...catalog].filter((n) => !goNames.has(n))).toEqual([]);
    expect(functionCatalog().length).toBe(catalog.size); // no duplicates
  });

  it("parses signatures with optional, repeated and grouped arguments", () => {
    expect(parseSignature("NPER(rate, pmt, pv, [fv], [type])").args.map((a) => [a.name, !!a.optional])).toEqual([
      ["rate", false], ["pmt", false], ["pv", false], ["fv", true], ["type", true],
    ]);
    const sumifs = parseSignature("SUMIFS(sum_range, criteria_range1, criteria1, [criteria_range2, criteria2]...)").args;
    expect(sumifs.slice(3).every((a) => a.optional && a.repeat)).toBe(true);
    expect(sumifs[1].repeat).toBeFalsy();
    expect(parseSignature("PI()").args).toEqual([]);
    expect(() => parseSignature("BAD(a,,b)")).toThrow();
    for (const f of functionCatalog()) {
      expect(f.description.length, f.name).toBeGreaterThan(5);
      for (const a of f.args) expect(a.help, `${f.name} ${a.name}`).toBeTruthy();
    }
  });

  it("searches by name first, then description, within a category", () => {
    expect(searchFunctions("pmt")[0].name).toBe("PMT");
    expect(searchFunctions("periodic payment").map((f) => f.name)).toContain("PMT");
    expect(searchFunctions("", "Most used").map((f) => f.name)).toEqual(MOST_USED);
    expect(searchFunctions("", "Database").every((f) => f.category === "Database")).toBe(true);
    expect(findFunction("vlookup")?.category).toBe("Lookup & reference");
  });
});
