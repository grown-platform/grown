import { describe, it, expect } from "vitest";
import {
  parseCsv,
  parseManifest,
  normalizeResearchPath,
  normalizePortability,
  naCount,
  normalizeArea,
  splitTargets,
  parseMilestones,
  extractTags,
  matchTag,
  goMangle,
  tagsFromVitestJson,
  tagsFromPlaywrightJson,
  tagsFromGoJson,
  compareBaseline,
} from "./onlyoffice-parity-lib.mjs";

const HEADER = "onlyoffice_path,test_count,area,portability,target_grown_path,milestone";

describe("parseCsv", () => {
  it("handles quoted fields with commas, escaped quotes and newlines", () => {
    const rows = parseCsv('a,"b, c","say ""hi""",\r\n"x\ny",2,,\n\n');
    expect(rows.map((r) => r.fields)).toEqual([
      ["a", "b, c", 'say "hi"', ""],
      ["x\ny", "2", "", ""],
    ]);
    expect(rows[1].line).toBe(2);
  });

  it("keeps a final row without trailing newline", () => {
    expect(parseCsv("a,b\nc,d").map((r) => r.fields)).toEqual([["a", "b"], ["c", "d"]]);
  });
});

describe("parseManifest", () => {
  it("normalises rows and reports malformed ones", () => {
    const text = [
      HEADER,
      'tests/cell/x.js,3,formulas/math (sum),go (2) + n/a (1),"a.test.ts, b_test.go",M0 (2) + M1 (1)',
      "research/onlyoffice/sdkjs-tests-v9.3.1/tests/word/y.js,1,styles,vitest,-,-",
      "too,few,fields",
      "z.js,abc,area,high,,CC1",
    ].join("\n");
    const { rows, errors } = parseManifest(text, "t-tests.csv");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      researchPath: "sdkjs-tests-v9.3.1/tests/cell/x.js",
      testsPath: "cell/x.js",
      testCount: 3,
      area: "formulas",
      portability: "go",
      portable: true,
      targets: ["a.test.ts", "b_test.go"],
      milestones: ["M0", "M1"],
    });
    expect(rows[1].testsPath).toBe("word/y.js");
    expect(rows[1].targets).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/t-tests\.csv:4: expected 6 fields/);
    expect(errors[1]).toMatch(/:5: test_count/);
  });

  it("rejects a wrong header", () => {
    expect(parseManifest("a,b\n").errors[0]).toMatch(/header/);
  });
});

describe("normalisers", () => {
  it("research paths", () => {
    expect(normalizeResearchPath("tests/slide/a.js")).toBe("sdkjs-tests-v9.3.1/tests/slide/a.js");
    expect(normalizeResearchPath("research/onlyoffice/core/Files/")).toBe("core/Files");
    expect(normalizeResearchPath("sdkjs/pdf/test/base.js")).toBe("sdkjs/pdf/test/base.js");
  });

  it("portability keys on the first word", () => {
    expect(normalizePortability("High (as key-map table)")).toEqual({ value: "high", portable: true });
    expect(normalizePortability("N/A")).toEqual({ value: "n/a", portable: false });
    expect(normalizePortability("n/a (harness; write own)")).toEqual({ value: "n/a", portable: false });
    expect(normalizePortability("mixed (2 vitest / 3 n/a)").value).toBe("mixed");
    expect(normalizePortability("none").portable).toBe(false);
    expect(normalizePortability("helper").portable).toBe(false);
    expect(normalizePortability("")).toEqual({ value: "-", portable: false });
  });

  it("n/a cases of a mixed row", () => {
    expect(naCount("mixed (2 vitest / 3 n/a)")).toBe(3);
    expect(naCount("mixed (30 vitest / 4 playwright / 2 n/a: zoom, drag)")).toBe(2);
    expect(naCount("mixed (1 n/a ParaId / 2 N/A other)")).toBe(3);
    expect(naCount("high")).toBe(0);
    expect(naCount("n/a (harness)")).toBe(0);
  });

  it("areas", () => {
    expect(normalizeArea("formulas/semantics (operators; refs)")).toBe("formulas");
    expect(normalizeArea("shapes: gradient fill; outline")).toBe("shapes");
    expect(normalizeArea("shortcuts + slide/element/text editing")).toBe("shortcuts");
    expect(normalizeArea("common-api")).toBe("common-api");
    expect(normalizeArea("")).toBe("(none)");
  });

  it("targets and milestones", () => {
    expect(splitTargets("a.ts; b.ts (clipboard payload); -")).toEqual(["a.ts", "b.ts"]);
    expect(parseMilestones("M0 M2 M13")).toEqual(["M0", "M2", "M13"]);
    expect(parseMilestones("exception")).toEqual(["exception"]);
    expect(parseMilestones("-")).toEqual([]);
  });
});

describe("extractTags", () => {
  it("finds tags in titles, template strings, Go names and JSON", () => {
    const src = [
      'it("oo:cell/spreadsheet-calculation/formula-tests/FormulaTests.js#SUM", () => {});',
      "test(`oo:word/change-case/change-case.js#Sentence case`, async () => {});",
      't.Run("oo:slide/shortcuts/shortcuts.js#22", func(t *testing.T) {})',
      '{ "id": "oo:cell/a.js#x" }',
      "// [oo:cell/b.js#in brackets] trailing",
      "// oo:cell/c.js#to end of line  ",
      'it("oo:cell/a.js#x")',
      'it("oo:cell/a.js#")',
    ].join("\n");
    expect(extractTags(src).sort()).toEqual([
      "cell/a.js#x",
      "cell/b.js#in brackets",
      "cell/c.js#to end of line",
      "cell/spreadsheet-calculation/formula-tests/FormulaTests.js#SUM",
      "slide/shortcuts/shortcuts.js#22",
      "word/change-case/change-case.js#Sentence case",
    ]);
  });

  it("go mangles spaces", () => {
    expect(goMangle("word/x.js#Sentence case")).toBe("word/x.js#Sentence_case");
  });
});

describe("matchTag", () => {
  const { rows } = parseManifest(
    [
      HEADER,
      "sdkjs-tests-v9.3.1/tests/common/color-mods/color-mods.js,28,common-color,high,,CC1",
      "sdkjs-tests-v9.3.1/tests/word/js-api,5,api,high,,CC1",
      "sdkjs-tests-v9.3.1/tests/word/js-api/api-run.js,3,run,high,,CC1",
      "sdkjs-tests-v9.3.1/tests/visio/**/*.js,7,visio,medium,,CC6",
      "core/EpubFile/test/Files,11,conversion,medium,,CC2",
    ].join("\n"),
    "a-tests.csv",
  );
  const other = parseManifest(
    [HEADER, "tests/common/color-mods/color-mods.js,28,colour,High,,M1",
      "tests/cell/spreadsheet-calculation/formula-tests/FormulaTests.js,47,formulas,go,,M1"].join("\n"),
    "b-tests.csv",
  ).rows;
  const all = [...rows, ...other];
  const areasOf = (tag) => matchTag(tag, all).map((r) => `${r.file}:${r.areaRaw}`).sort();

  it("exact file matches in every plan that lists it", () => {
    expect(areasOf("common/color-mods/color-mods.js#tint")).toEqual(["a-tests.csv:common-color", "b-tests.csv:colour"]);
  });
  it("prefers the most specific row", () => {
    expect(areasOf("word/js-api/api-run.js#1")).toEqual(["a-tests.csv:run"]);
  });
  it("directory rows cover files in subfolders", () => {
    expect(areasOf("word/js-api/api/replace-text-smart.js#x")).toEqual(["a-tests.csv:api"]);
  });
  it("glob rows", () => {
    expect(areasOf("visio/serialize/sax-serialize.js#rect")).toEqual(["a-tests.csv:visio"]);
  });
  it("research-relative fallback for non-tests rows", () => {
    expect(areasOf("core/EpubFile/test/Files/book.epub#toc")).toEqual(["a-tests.csv:conversion"]);
  });
  it("same file name in a subfolder of the tag's directory", () => {
    expect(areasOf("cell/spreadsheet-calculation/FormulaTests.js#SUM")).toEqual(["b-tests.csv:formulas"]);
  });
  it("unmapped", () => {
    expect(matchTag("nope/x.js#y", all)).toEqual([]);
    expect(matchTag("word/js-api-other.js#y", all)).toEqual([]);
  });
});

describe("result files", () => {
  it("vitest json", () => {
    const r = tagsFromVitestJson({
      testResults: [{
        assertionResults: [
          { fullName: "sum oo:cell/a.js#SUM", status: "passed" },
          { fullName: "oo:cell/a.js#AVG", status: "failed" },
        ],
      }],
    });
    expect([...r.passed]).toEqual(["cell/a.js#SUM"]);
    expect(r.seen.size).toBe(2);
  });

  it("playwright json", () => {
    const r = tagsFromPlaywrightJson({
      suites: [{ title: "f.spec.ts", specs: [], suites: [{ title: "grp", specs: [
        { title: "oo:slide/s.js#1", ok: true },
        { title: "oo:slide/s.js#2", ok: false },
      ] }] }],
    });
    expect([...r.passed]).toEqual(["slide/s.js#1"]);
    expect(r.seen.size).toBe(2);
  });

  it("go test -json", () => {
    const text = [
      '{"Action":"run","Test":"TestParity/oo:word/x.js#Sentence_case"}',
      '{"Action":"pass","Test":"TestParity/oo:word/x.js#Sentence_case"}',
      '{"Action":"fail","Test":"TestParity/oo:cell/a.js#SUM"}',
      "not json",
    ].join("\n");
    const r = tagsFromGoJson(text);
    expect([...r.passed]).toEqual(["word/x.js#Sentence_case"]);
    expect(r.seen.has("cell/a.js#SUM")).toBe(true);
  });
});

describe("compareBaseline", () => {
  const base = { areas: { "a/x": { ported: 3, passing: 2 }, "a/y": { ported: 1, passing: null } }, total: { ported: 4, passing: 2 } };
  it("passes when equal or better; passing ignored when unknown", () => {
    const cur = { areas: { "a/x": { ported: 5, passing: null }, "a/y": { ported: 1, passing: null } }, total: { ported: 6, passing: null } };
    expect(compareBaseline(cur, base)).toEqual([]);
  });
  it("flags regressions and vanished areas", () => {
    const cur = { areas: { "a/x": { ported: 2, passing: 1 } }, total: { ported: 2, passing: 1 } };
    expect(compareBaseline(cur, base)).toEqual([
      "a/x: ported 3 -> 2",
      "a/x: passing 2 -> 1",
      "a/y: ported 1 -> 0",
      "TOTAL: ported 4 -> 2",
      "TOTAL: passing 2 -> 1",
    ]);
  });
});
