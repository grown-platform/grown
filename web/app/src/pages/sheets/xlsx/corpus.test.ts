/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet workbooks are loosely typed. */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { importSpreadsheetFile } from "../sheetImport";
import { workbookToXlsx } from "./xlsxWrite";
import { readXlsx } from "./xlsxRead";
import * as XLSX from "xlsx";

// Local-only corpus: OnlyOffice's sample spreadsheets (AGPL; never committed)
// used purely as input, per the CC2 GROWN_CONVERSION_CORPUS pattern. Each file
// is imported, exported to xlsx and imported again; values, formulas, number
// formats, merges, rules and names must survive. Skips when the files are
// absent (CI).
//
//   GROWN_CONVERSION_CORPUS=/path/to/research/onlyoffice/core npx vitest run src/pages/sheets/xlsx/corpus.test.ts

const ROOT = resolve(process.env.GROWN_CONVERSION_CORPUS || join(__dirname, "../../../../../../research/onlyoffice/core"));
const EWS = "Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles";

const CASES: [string, string][] = [
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#Имя файла на русском и с пробелами.xlsx", `${EWS}/Имя файла на русском и с пробелами.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#Auto_color_as_index.xls", `${EWS}/Auto_color_as_index.xls`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#chart_7_full_1.xlsx", `${EWS}/chart_7_full_1.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#ChartsSheets.xlsx", `${EWS}/ChartsSheets.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#CSV_confuser_saved.csv", `${EWS}/CSV_confuser_saved.csv`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#CSV_confuser.csv", `${EWS}/CSV_confuser.csv`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#CSV_confuser.xlsx", `${EWS}/CSV_confuser.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#DataOfVarTypes.xlsx", `${EWS}/DataOfVarTypes.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#DeleteRowsComplex.xlsx", `${EWS}/DeleteRowsComplex.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#Fibonacci_chain.xlsx", `${EWS}/Fibonacci_chain.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#Format.xlsx", `${EWS}/Format.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#Formula_complex_dependencies.xlsx", `${EWS}/Formula_complex_dependencies.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#Function_2_params_all_comb.xlsx", `${EWS}/Function_2_params_all_comb.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#Hyperlinks.xlsx", `${EWS}/Hyperlinks.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#Loop.xlsx", `${EWS}/Loop.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#MathTwoArgsCeilingTemplate.xlsx", `${EWS}/MathTwoArgsCeilingTemplate.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#MathTwoArgsFloorTemplate.xlsx", `${EWS}/MathTwoArgsFloorTemplate.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#MathTwoArgsModTemplate.xlsx", `${EWS}/MathTwoArgsModTemplate.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#MathTwoArgsMRoundTemplate.xlsx", `${EWS}/MathTwoArgsMRoundTemplate.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#MathTwoArgsRoundDownTemplate.xlsx", `${EWS}/MathTwoArgsRoundDownTemplate.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#MathTwoArgsRoundTemplate.xlsx", `${EWS}/MathTwoArgsRoundTemplate.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#MathTwoArgsRoundUpTemplate.xlsx", `${EWS}/MathTwoArgsRoundUpTemplate.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#MathTwoArgsTemplate.xlsx", `${EWS}/MathTwoArgsTemplate.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#MergedAreas.xlsx", `${EWS}/MergedAreas.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#MergeWrongValueSetAsTopLeft.xlsx", `${EWS}/MergeWrongValueSetAsTopLeft.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#NameRanges_simple.xlsx", `${EWS}/NameRanges_simple.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#NumberFormat.xlsx", `${EWS}/NumberFormat.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#RangesReferencesOverDeletedRows.xlsx", `${EWS}/RangesReferencesOverDeletedRows.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#Shared_formulas.xlsx", `${EWS}/Shared_formulas.xlsx`],
  ["oo:core/Test/Applications/AVSOfficeEWSEditorTest/AVSOfficeEWSEditorTest/TestFiles#thick_box.xlsx", `${EWS}/thick_box.xlsx`],
  ["oo:core/OOXML/test/xlsx2xlsb/conversion.cpp#simple1.xlsx", "OOXML/test/ExampleFiles/xlsx2xlsb/simple1.xlsx"],
  ["oo:core/OOXML/test/xlsx2xlsb/conversion.cpp#simple2.xlsx", "OOXML/test/ExampleFiles/xlsx2xlsb/simple2.xlsx"],
  ["oo:core/OOXML/test/xlsx2xlsb/conversion.cpp#fmla.xlsx", "OOXML/test/ExampleFiles/xlsx2xlsb/fmla.xlsx"],
  ["oo:core/OOXML/test/xlsb2xlsx/conversion.cpp#simple1.xlsx", "OOXML/test/ExampleFiles/xlsb2xlsx/simple1.xlsx"],
  ["oo:core/OOXML/test/xlsb2xlsx/conversion.cpp#simple2.xlsx", "OOXML/test/ExampleFiles/xlsb2xlsx/simple2.xlsx"],
  ["oo:core/OOXML/test/xlsb2xlsx/conversion.cpp#fmla.xlsx", "OOXML/test/ExampleFiles/xlsb2xlsx/fmla.xlsx"],
];

/** A comparable signature of a workbook's content. */
function signature(sheets: any[]) {
  return sheets.map((s) => {
    const cells: Record<string, unknown> = {};
    for (const cd of s.celldata ?? []) {
      const v = cd.v ?? {};
      const val = v.ct?.t === "inlineStr" ? (v.ct.s ?? []).map((p: any) => p.v).join("") : v.v;
      if ((val === undefined || val === null || val === "") && !v.f) continue;
      cells[`${cd.r}_${cd.c}`] = [typeof val === "number" ? Number(val.toPrecision(12)) : val, v.f ?? null, v.ct?.fa ?? null];
    }
    return {
      name: s.name,
      cells,
      merges: Object.keys(s.config?.merge ?? {}).sort(),
      cf: (s.grownCF ?? []).length,
      dv: (s.grownDV ?? []).length,
      filter: !!s.grownFilter,
      hidden: [Object.keys(s.config?.rowhidden ?? {}).length, Object.keys(s.config?.colhidden ?? {}).length],
    };
  });
}

/**
 * An independent reader as the oracle: every value and formula SheetJS finds
 * must be what Grown's reader found.
 */
function crossCheck(bytes: Uint8Array, sheets: any[]) {
  const wb = XLSX.read(bytes, { type: "array", cellFormula: true });
  // Chart sheets are skipped on import (with a warning); worksheets keep their order.
  const names = sheets.map((s) => s.name);
  expect(names).toEqual(wb.SheetNames.filter((n) => names.includes(n)));
  sheets.forEach((sheet) => {
    const name = sheet.name;
    const ws: any = wb.Sheets[name];
    const mine = new Map<string, any>((sheet.celldata ?? []).map((cd: any) => [`${cd.r}_${cd.c}`, cd.v]));
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith("!")) continue;
      const x = ws[addr];
      const { r, c } = XLSX.utils.decode_cell(addr);
      const v = mine.get(`${r}_${c}`);
      const where = `${name}!${addr}`;
      if (x.f) expect(v?.f, where).toBe("=" + String(x.f).replace(/_xlfn\.|_xlws\./g, ""));
      if (x.t === "z" || v?.mc && !v.mc.rs) continue;
      const got = v?.ct?.t === "inlineStr" ? v.ct.s.map((p: any) => p.v).join("") : v?.v;
      if (x.t === "n") expect(Math.abs(Number(got) - x.v), where).toBeLessThan(1e-9 * Math.max(1, Math.abs(x.v)));
      else if (x.t === "b") expect(got, where).toBe(!!x.v);
      else if (x.t === "e") expect(got, where).toBe(x.w);
      else if (x.t === "s") expect(String(got ?? ""), where).toBe(String(x.v));
    }
  });
}

const results: { file: string; ok: boolean; note: string }[] = [];

describe("spreadsheet corpus (local only)", () => {
  for (const [tag, rel] of CASES) {
    const file = join(ROOT, rel);
    it.skipIf(!existsSync(file))(tag, async () => {
      try {
        const bytes = new Uint8Array(readFileSync(file));
        const first = await importSpreadsheetFile(bytes, basename(file), { userId: "corpus" });
        expect(first.sheets.length).toBeGreaterThan(0);
        const again = await readXlsx(await workbookToXlsx(first.sheets), { userId: "corpus" });
        expect(again.sheets.length).toBe(first.sheets.length);
        expect(signature(again.sheets)).toEqual(signature(first.sheets));
        expect(again.namedRanges.map((n) => `${n.name}=${n.sheetName}!${n.range}`)).toEqual(
          first.namedRanges.map((n) => `${n.name}=${n.sheetName}!${n.range}`),
        );
        if (/\.xlsx$/i.test(file)) crossCheck(bytes, first.sheets);
        const cells = first.sheets.reduce((n, s) => n + (s.celldata?.length ?? 0), 0);
        results.push({ file: rel, ok: true, note: `${first.sheets.length} sheets, ${cells} cells` });
      } catch (e) {
        results.push({ file: rel, ok: false, note: String((e as Error).message).slice(0, 200) });
        throw e;
      }
    });
  }
  afterAll(() => {
    if (!results.length) return;
    const pass = results.filter((r) => r.ok).length;
    console.log(`spreadsheet corpus: ${pass}/${results.length} files round-trip (${Math.round((100 * pass) / results.length)} %)`);
    for (const r of results) console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.file} — ${r.note}`);
  });
});
