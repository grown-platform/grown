# Sheets parity tests (client side)

Client-side ports of OnlyOffice spreadsheet test suites. The plan is in
`docs/plans/onlyoffice-parity/sheets.md` §6. Formula and engine behaviour is
checked in Go instead, by `internal/sheets/parity_test.go` over
`internal/sheets/testdata/parity/*.json`.

Conventions:

- Put one `*.parity.test.ts` file per Grown module under test, for example
  `numberFormat.parity.test.ts`, `autofill.parity.test.ts` or
  `filter.parity.test.ts`. vitest picks them up with the rest of the suite
  (`cd web/app && npx vitest run`, or `npx vitest run __parity__`).
- Name every ported OnlyOffice `QUnit.test` with its tag,
  `it("oo:<path under sdkjs tests/>#<test title>", …)`, for example
  `oo:cell/spreadsheet-calculation/tests.js#Asc.Range.union`. The parity
  scoreboard counts distinct tags. One `it` may group several assertions of the
  same OnlyOffice test.
- Clean room: OnlyOffice is AGPL. Read its tests only to learn the behaviour
  (inputs → expected results), then write the cases here in your own words.
  Never copy test code or comments.
- Known gaps: use `it.skip("oo:…", …)` with a comment that gives the reason and
  the milestone that will close it, so the case counts as ported but pending.

Current files:

| File | OnlyOffice suite | Module |
|---|---|---|
| `range.parity.test.ts` | `cell/spreadsheet-calculation/tests.js` (Asc.round, Asc.Range, intersection, union) | `../cellRange.ts` |
| `formulaRefs.parity.test.ts` | `cell/spreadsheet-calculation/formula-tests/FormulaTests.js` (rename sheet #1) | `../formulaRefs.ts` |
| `filter.parity.test.ts` | `cell/spreadsheet-calculation/autoFilterTests.js`, `cell/js-api/api-auto-filter.js` | `../filterOps.ts` |
| `condFormat.parity.test.ts` | `cell/spreadsheet-calculation/conditionalFormattingTests.js`, `cell/js-api/api-format-conditions.js` | `../cfOps.ts` |
| `validation.parity.test.ts` | `cell/spreadsheet-calculation/DataValidationTests.js`, `cell/js-api/api-validation.js` | `../validationOps.ts` |
| `autofill.parity.test.ts` | `SerialTests.js`, `SheetStructureTests.js` (autofill) | `../autofill.ts` |
| `sort.parity.test.ts` | `js-api/api-range.js`, `SheetStructureTests.js` (sortRangeTest) | `../sortOps.ts` |
| `structure.parity.test.ts` | `SheetStructureTests.js` (move/shift) | `../formulaShift.ts` |
| `paste.parity.test.ts`, `csv.parity.test.ts` | `copy-paste-tests.js` | `../pasteSpecial.ts`, `../csvText.ts` |
| `textCase.parity.test.ts` | `CellSettingsTests.js` | `../textCase.ts` |
| `charts.parity.test.ts` | `ChartsDrawTest.js` | `../trendlines.ts`, `../histogram.ts`, `../chartAxis.ts`, `../chartData.ts` |
| `numberFormat.parity.test.ts` | `NumFormatParse.js`, `testsForFWB.html.js`, `CellFormatTests.js` (fixtures in `internal/sheets/testdata/numfmt/`, shared with the Go port) | `../numberFormat.ts` |

Pivots (M9) are added separately.
