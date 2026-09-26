# OnlyOffice parity plan — Sheets

Status: plan written 2026-09-26. M0 (the parity harness and the first 91 ported tests) has landed; see §7.
Companion: `sheets-tests.csv` (one row per OnlyOffice test file).
Inventory baseline: **`origin/main` @ `c90064e`**. (The worktree used for reading was `96ca7c0`,
55 commits behind; for Sheets the only difference is `internal/sheets/formula_more{,2,3}.go`
+ tests — 49 extra functions, 37 extra Go tests — which are folded into every count below.)

Reference material (gitignored, AGPL-3.0 — read for *behaviour* only, never copy):
`research/onlyoffice/sdkjs-tests-v9.3.1/tests/cell/`, `…/tests/common/charts/`,
engine `research/onlyoffice/sdkjs/cell/`, UI `research/onlyoffice/web-apps/apps/spreadsheeteditor/`.

Scope rule (from the user): **improve what Grown already has.** Every milestone below is
additive on the current architecture (fortune-sheet grid + Go formula engine + FortuneSheet
JSON model). Anything that would need a rewrite is listed under "Flagged exceptions" with a
justification, not planned.

---

## 1. How Grown Sheets works today

### 1.1 Architecture at a glance

| Layer | What | Where |
|---|---|---|
| Grid / editor UI | `@fortune-sheet/react` 1.0.4 (MIT, Luckysheet lineage). Ships its own toolbar, formula bar, sheet tabs, context menus, undo/redo, autofill drag, copy/paste, freeze, merge, borders, number formats, hide rows/cols, basic filter, basic conditional formatting, data verification, hyperlinks, images, cell comments (`ps`), search, "quick formula" autosum. | `web/app/src/pages/sheets/SheetEditor.tsx` (mounts `<Workbook ref data onChange onOp>`) |
| Menus (Google-Sheets-shaped) | File · Edit · View · Insert · Format · Data · Tools · Extensions · Help. Items either call the fortune-sheet ref API or are present-but-disabled stubs. | `web/app/src/pages/sheets/SheetMenuBar.tsx` |
| Client-side formula evaluation (live typing) | fortune-sheet's built-in Luckysheet formula engine (~250 functions in its function table, `@fortune-sheet/formula-parser` 0.2.13 MIT). Used only for what the user sees while editing. | `node_modules/@fortune-sheet/core` |
| **Server-side formula engine (authoritative)** | Go recursive-descent evaluator; runs `RecomputeWorkbook` on **every `SaveSheet`** so persisted `v`/`m` carry computed results; 356 registered functions on origin/main. | `internal/sheets/formula.go` + `formula_*.go` (incl. `formula_more.go`, `formula_more2.go`, `formula_more3.go`) |
| Data model | FortuneSheet workbook JSON: `[{name,id,order,row,column,celldata:[{r,c,v:{v,m,f,ct,bl,…}}], config, frozen, filter_select, dataVerification, luckysheet_conditionformat_save, …}]` stored as `TEXT` in `grown.sheets_documents.data`. Grown-specific extras ride on `sheet[0]`: `grownCharts`, `grownPivots`, `grownIconSets`, `_namedRanges` (preserved through recompute via `FsSheet.Extra`). | `internal/storage/migrations/0011_sheets_documents.sql`, `internal/sheets/formula.go:36-190` |
| API | gRPC/gateway `grown.v1.SheetsService`: List/Create/Get/Rename/Trash/Save, ListSharedWithMe, GrantAccess/ListGrants/RevokeAccess. REST paths `/api/v1/sheets…` | `proto/grown/v1/sheets.proto`, `internal/sheets/service.go`, `web/app/src/pages/sheets/api.ts` |
| Collaboration | WebSocket hub relays fortune-sheet **ops** verbatim between peers + presence (cursor colour/selection). No OT/CRDT; persistence is a 1.5 s debounced full-workbook `PUT …/data` from each client (last writer wins). | `internal/sheets/collab.go`, `internal/server/server.go:2623`, `SheetEditor.tsx:168-301` |
| Sharing | Per-user object grants (viewer/editor), cross-org; list "mine" / "shared with me". | `ShareDialog.tsx`, `SheetList.tsx`, `internal/sheets/service.go:211-316` |
| Export | xlsx/ods via SheetJS (`xlsx` 0.18.5, **values only** — formulas/formats dropped), csv/tsv/html in-browser, pdf via `/api/v1/docs/convert` (HTML table → pandoc/tectonic). Import: **disabled menu item**. | `web/app/src/pages/sheets/export.ts` |
| Charts | Dependency-free SVG renderer: column, bar, line, area, pie; series from a range, header row / label column options. Stored in `grownCharts`, shown in a side panel (not anchored on the grid). | `ChartDialog.tsx`, `ChartRenderer.tsx`, `chartData.ts`, `ChartsPanel.tsx` |
| Pivot | Pure TS pivot: one row field, optional column field, one value field, aggs sum/count/average/min/max, row+col totals. Rendered as an HTML table in a panel. | `PivotDialog.tsx`, `pivotData.ts`, `PivotTableView.tsx`, `PivotPanel.tsx` |
| Conditional formatting | Dialog over fortune-sheet's `luckysheet_conditionformat_save`: single-colour "default" rules (greaterThan/lessThan/between/equal…), `colorGradation` (colour scale), `dataBar`. Plus Grown icon sets (arrows/traffic/signs) as a display overlay on `m`. | `ConditionalFormatDialog.tsx`, `iconSets.ts` |
| Data validation | Dialog over fortune-sheet `dataVerification`: dropdown, checkbox, number_decimal, text_length, text_content, date; operators (between, equal, …); prohibit input / hint. | `DataValidationDialog.tsx` |
| Data menu ops | Sort range / sort sheet (single key, header heuristic), randomize, toggle filter (fortune-sheet `filter_select`), split text to columns (delimiter autodetect), find & replace (case / whole-cell / regex, scope all/sheet/range). | `dataActions.ts`, `sheetOps.ts`, `FindReplaceDialog.tsx` |
| Named ranges | CRUD dialog storing `_namedRanges` on `sheet[0]`. **Not resolved by either formula engine** — names are bookkeeping only. | `NamedRangesDialog.tsx` |
| Templates | Blank, Monthly budget, To-do, Weekly schedule, Expense tracker. | `templates.ts`, `SheetList.tsx` |

### 1.2 The Go formula engine (`internal/sheets/formula*.go`, ≈16,560 lines incl. tests on origin/main)

Capabilities verified by reading the source:

* Tokeniser + recursive-descent parser: numbers, strings, booleans, `A1`/`$A$1` refs (the `$` is stripped; absolute markers are irrelevant to evaluation), `A1:B3` ranges, `+ - * / ^ &`, comparisons, unary minus, parentheses, array constants `{1,2;3,4}`.
* Dependency graph built by regex ref-extraction (`extractRefs`) → topological sort → `#CIRC!` on cycles. Evaluation order is per sheet.
* Dynamic arrays: results spill down/right, `#SPILL!` when blocked (`spill()`); `ARRAYFORMULA(...)` broadcasting; `LAMBDA`, `LET`, `LAMBDA(...)(args)` immediate call, `MAP/REDUCE/SCAN/BYROW/BYCOL/MAKEARRAY`.
* Criteria strings with wildcards (`parseCriteria`, `wildcardToRegexp`) for `*IF/*IFS`, database functions.
* Google-Sheets/Excel-365 functions the OnlyOffice engine lacks (21): `QUERY`, `GROUPBY`, `PIVOTBY`, `REGEXMATCH/EXTRACT/REPLACE`, `SPARKLINE`, `SPLIT`, `JOIN`, `FLATTEN`, `SORTN`, `COUNTUNIQUE`, `ISBETWEEN`, `ISEMAIL`, `ISURL`, `ENCODEURL`, `VALUETOTEXT`, `MAP/REDUCE/SCAN/BYROW/BYCOL/MAKEARRAY`.
* Added on origin/main since the worktree commit (`formula_more*.go`, 49): NORM family (8), CONFIDENCE(.NORM), FREQUENCY, GAUSS, PHI, KURT, SKEW(.P), MODE.MULT, PERCENTRANK.EXC/INC, QUARTILE.EXC, ERF/ERFC(.PRECISE), MMULT/MINVERSE/MDETERM/MUNIT, SERIESSUM, SUMX2MY2/SUMX2PY2/SUMXMY2, NETWORKDAYS.INTL/WORKDAY.INTL, ACCRINT, DISC, DOLLARDE/FR, DURATION/MDURATION, INTRATE, ISPMT, RECEIVED, TBILLEQ/PRICE/YIELD, GROUPBY, PIVOTBY, VALUETOTEXT.
* Workbook context: `SHEET()`/`SHEETS()` via `recomputeCtx(sheetIndex, names)`.

Limitations (these drive milestone M1/M5):

* **Single-sheet scope**: no `Sheet2!A1` cross-sheet references (`tokenise` has no `!` handling; `parseCellRef` regex is `^\$?[A-Z]+\$?\d+$`). Formulas referring to another tab evaluate to `#NAME?`.
* **No defined names in the evaluator** (`_namedRanges` is UI-only).
* No whole-column/row refs (`A:A`, `1:1`), no range union `,` / intersection ` ` operators, no 3-D refs, no structured table refs, no `OFFSET`, no external refs, no iterative calculation.
* Bare `A1:B2` outside a function argument returns `#VALUE!` except inside `ARRAYFORMULA`.
* Display string `m` for computed values is produced by `value.toStr()` — no number-format (`ct.fa`) application server-side; formatting of computed cells is left to fortune-sheet on the client.

Function inventory (origin/main): **356** registered names (`registerFunc`), of which 335 also exist in OnlyOffice (327 of those are covered by OnlyOffice tests) and 21 are Grown-only. OnlyOffice registers 502 names; **167** are absent from Grown (145 of them tested by OnlyOffice — see §3.1 per-file lists; 27 untested such as CUBE*, RTD, WEBSERVICE, BAHTTEXT).

### 1.3 Test infrastructure today

| Harness | Location | Cases |
|---|---|---|
| vitest (jsdom) | `web/app/src/pages/sheets/sheetOps.test.ts` (22), `chartData.test.ts` (6), `iconSets.test.ts` (5), `pivotData.test.ts` (5) | 38 |
| Go `go test` | `internal/sheets/*_test.go` — `formula_test.go` (65 `Test*` funcs, helper `eval(t, expr, cells...)` + `mustNum/mustStr/mustErr/mustBool`), plus per-family files (formula_more 18, array shape 13, formula_more2 11, lambda 10, query 9, library 8, formula_more3 8, spill 7, regex 7, extra 7, arrayformula 7, database 5, regression 5, sparkline 5, aggregate 4, arrayconst 4, sheetmeta 2, repository 2, grants 1) | 198 |
| Playwright | `web/e2e/sheets.spec.ts` — 2 tests: JSON-API save → server recompute → read back values (SUM, LAMBDA, SEQUENCE, UPPER, TEXTSPLIT spill); reopen sheet in UI and see `42`. Helpers `createSheet/saveSheet/getSheetData/workbookWithCells` in `web/e2e/helpers.ts`. | 2 |

Run: `cd web/app && npx vitest run`, `go test ./internal/sheets/`, `cd web/e2e && npx playwright test sheets` (needs the process-compose dev stack, see `web/e2e/README.md`).

---

## 2. OnlyOffice spreadsheet feature inventory vs Grown

Legend: **Have** = works end-to-end in Grown · **Partial** = exists but materially narrower · **Missing** = absent or a disabled menu stub. "OO" = OnlyOffice. Grown file paths are relative to the repo root; `SheetMenuBar.tsx` items marked *stub* are `<MenuItem disabled>` today.

### 2.1 Formulas & calculation (OO: `sdkjs/cell/model/FormulaObjects/*`, 502 functions; UI `FormulaTab.js`, `FormulaDialog.js`, `FormulaWizard.js`, `WatchDialog.js`, `NameManagerDlg.js`)

| Feature | Grown | Where / note |
|---|---|---|
| Function library | **Partial** — 356 vs OO 502 (335 shared, 167 OO-only, 21 Grown-only) | `internal/sheets/formula_*.go` |
| Operators (`+ - * / ^ & = <> < <= > >=`, unary, `%` postfix) | **Partial** — all except `%` postfix; range union/intersection operators missing | `formula.go:888-1080` |
| Relative/absolute refs `$A$1` | Have (evaluation); copy-adjust handled by fortune-sheet client | `formula.go:367` |
| Cross-sheet refs `Sheet1!A1`, `'My Sheet'!A1:B2` | **Missing** | see §5 M1 |
| 3-D refs `Sheet1:Sheet3!A1` | Missing | flagged exception |
| Whole column/row refs `A:A`, `1:1` | Missing | M1 |
| Defined names (workbook/sheet scope) resolved in formulas | **Missing** (dialog only) | `NamedRangesDialog.tsx`, M1 |
| Dynamic arrays / spill / `#SPILL!` | Have | `formula.go:224-700`, `formula_spill_test.go` |
| Legacy CSE array formulas `{=…}` | Partial (ARRAYFORMULA only) | `formula_arrayformula.go` |
| LAMBDA / LET / MAP / REDUCE / SCAN / BYROW / BYCOL / MAKEARRAY | Have | `formula_lambda.go` |
| Error values `#DIV/0! #VALUE! #REF! #NAME? #NUM! #N/A #NULL! #SPILL! #CALC!` | Partial (no `#NULL!`, `#CIRC!` instead of Excel's circular-warning) | `formula.go:255-265` |
| Iterative calculation (circular refs) | Missing | flagged exception |
| Calculation mode auto/manual, recalc F9 | Missing (always recompute on save) | — |
| Formula autocomplete + argument tooltips | Have (fortune-sheet cell editor) | — |
| Function wizard / Insert ▸ Function | Missing (stub) | `SheetMenuBar.tsx` Insert |
| Show formulas toggle (Ctrl+`) | Missing | — |
| Trace precedents/dependents, remove arrows | Missing | — |
| Watch window | Missing | — |
| Formula bar | Have (fortune-sheet) | — |
| Custom (plugin) functions, async functions | Missing | flagged N/A |
| External references / IMPORTRANGE | Missing | flagged (M11 optional) |
| Goal seek / Solver (what-if) | Missing | M5 (goal seek only) |
| Text-to-formula parsing (locale separators, `=` prefix, unary cleanup) | Partial (server regexp) | `formula.go:749` |

### 2.2 Cell formatting (OO Home tab: `Toolbar.js`, `CellSettings.js`, `FormatCells` dialog; `NumFormatParse`, `CellFormatTests`, `testsForFWB`)

| Feature | Grown | Note |
|---|---|---|
| Font family/size/colour, fill, bold/italic/underline/strikethrough | Have (fortune-sheet toolbar; Format menu wires `bl/it/un/cl`) | `SheetMenuBar.tsx` Format |
| Subscript/superscript | Missing | — |
| Borders (all/outer/inner/top/bottom/left/right/diagonal, style, colour) | Have (toolbar) | fortune-sheet `border` |
| Horizontal/vertical alignment, wrap, clip/overflow, rotation | Have (toolbar; Format ▸ Wrapping/Rotation menu items are stubs) | — |
| Merge (all / across / centre) + unmerge | Partial (merge-all + unmerge) | `SheetMenuBar.tsx` |
| Number formats: General, Number, Currency, Accounting, Financial, Percent, Scientific, Date, Time, Date-time, Duration, Fraction, Text, Custom | Partial — menu presets for 10 of them; no Accounting/Financial/Duration/Fraction/Custom dialog | `SheetMenuBar.tsx` Format ▸ Number |
| Number-format parsing of typed input (`1,234.5`, `12%`, `$5`, `(3)`, dates, times, fractions, locale) | Partial (fortune-sheet client heuristics; no Grown tests) | M6 |
| Increase/decrease decimals | Have (toolbar) | — |
| Format painter / clear formatting | Have | — |
| Cell styles gallery / table styles | Missing | — |
| Row height / column width (custom, auto-fit) | Have (context menu) | — |
| Hide/show rows, columns, sheets | Have (context menu / tabs) | — |
| Alternating colours | Missing (stub) | — |
| Theme / tab colour / RTL sheet | Missing | — |
| Text case change (upper/lower/sentence) | Missing | OO `CellSettingsTests` |
| Hyperlinks (cell, sheet-internal, external) | Have (toolbar `link`; `HYPERLINK()` function missing) | — |

### 2.3 Conditional formatting (OO `ConditionalFormatting.js` 3,285 lines; `FormatRulesManagerDlg.js`, `FormatRulesEditDlg.js`)

| Rule type | Grown |
|---|---|
| Cell value greater/less/between/equal/not equal etc. | Have (`default` rule) |
| Text contains / not contains / begins / ends | Missing |
| Date occurring (yesterday/today/last 7 days/…) | Missing |
| Blank / not blank / error / no error | Missing |
| Duplicate / unique values | Missing |
| Top/bottom N, N %, above/below average | Missing |
| Custom formula rule | Missing |
| 2- and 3-colour scales (min/mid/max by number/percent/percentile/formula) | Partial (`colorGradation`, endpoints only) |
| Data bars (axis, direction, gradient/solid, negative colour, min/max types) | Partial (`dataBar` basic) |
| Icon sets (3/4/5 sets, thresholds, reverse, show icon only) | Partial (3 styles, fixed thirds, display overlay) — `iconSets.ts` |
| Rule manager (priority order, stop-if-true, applies-to editing) | Partial (list + delete) — `ConditionalFormatDialog.tsx` |

### 2.4 Data validation (OO `DataValidation.js`, `DataValidationDialog.js`)

| Feature | Grown |
|---|---|
| Whole number / decimal / list / date / time / text length / custom formula | Partial — decimal, list (dropdown), date, text length, text contains, checkbox; **no whole-number, time, custom formula** — `DataValidationDialog.tsx` |
| Operators between/not between/=/≠/>/</≥/≤ | Have |
| Input message, error alert (stop/warning/info), ignore blank | Partial (hint text + prohibit input only) |
| In-cell dropdown, checkbox | Have |
| Overlap semantics when adding/deleting/modifying ranges | Missing (per-cell map; no range algebra) |
| Circle invalid data | Missing |

### 2.5 Sort, filter, tables, data tools (OO `autofilters.js` 6,946 lines, `SortDialog.js`, `SortOptionsDialog.js`, `AutoFilterDialog.js`, `RemoveDuplicatesDialog.js`, `AdvancedSeparatorDialog.js`, `DataTab.js`, `Slicer.js`)

| Feature | Grown |
|---|---|
| Sort range A→Z / Z→A by column | Have — `dataActions.ts` |
| Multi-key sort dialog, sort by row (orientation), sort by cell/font colour, case-sensitive option, header row option | Missing |
| Sort sheet keeping header | Partial (heuristic header) |
| AutoFilter with value checklist | Have (fortune-sheet `filter_select`) |
| Text/number/date filters (contains, begins, >, between…), Top 10, above/below average, colour filters, custom AND/OR | Missing |
| Clear / reapply filter, filter buttons on tables | Partial |
| Filter views (named sheet views) | Missing (stub) |
| Slicers | Missing (stub) |
| Remove duplicates | Missing (Data cleanup stub) |
| Text to columns (delimiters, fixed width, quote char) | Partial (auto-detected single delimiter) — `splitTextToColumns` |
| Group / ungroup rows & columns (outline) | Missing (stub) |
| Format as table (structured refs, header/total row, banded rows, table styles) | Missing |
| Data from text/CSV / XML import | Missing (File ▸ Import stub) |
| Randomize range | Have |

### 2.6 Pivot tables (OO `PivotTables.js` 22,893 lines; `CreatePivotDialog`, `PivotSettings*`, `FieldSettingsDialog`, `ValueFieldSettingsDialog`, `PivotGroupDialog`, `PivotCalculatedItemsDialog`, `PivotShowDetailDialog`)

| Feature | Grown |
|---|---|
| Create pivot from range; row/column/value fields | Partial — exactly 1 row, ≤1 column, 1 value — `pivotData.ts` |
| Multiple row/col fields with subtotals, compact/outline/tabular layout, blank rows, grand totals on/off | Missing |
| Page (report) filters, value filters, label filters, Top 10 | Missing |
| Aggregations: sum/count/average/min/max | Have (dialog); product, countNums, stdDev(p), var(p) Missing in the dialog — though formula-level `GROUPBY`/`PIVOTBY` on origin/main already support more aggregations and could back the dialog |
| Show values as (% of total/row/column, difference from, running total, rank…) | Missing |
| Number format per value field, header rename | Missing |
| Grouping (dates by month/quarter/year, numeric bins) | Missing |
| Calculated fields / items | Missing |
| Refresh on source change, change data source | Partial (recomputed on render from stored range) |
| Show details (drill-through) | Missing |
| GETPIVOTDATA | Missing |
| Pivot placed on the grid (not a side panel), pivot styles | Missing |

### 2.7 Charts & sparklines (OO `ChartsDrawTest`, `common/charts`, `ChartWizardDialog`, `ChartTypeDialog`, `ChartDataDialog`, `ChartSettings*`, `CreateSparklineDialog`, `SparklineTab`)

| Feature | Grown |
|---|---|
| Column, bar, line, area, pie | Have — `ChartRenderer.tsx` |
| Scatter, bubble, doughnut, radar, stock, combo, stacked/100 % variants, 3-D | Missing |
| chartEx: histogram (binning), waterfall, treemap, sunburst, funnel, box & whisker | Missing |
| Trendlines (linear/log/power/exp/polynomial/moving-average) with equation and R² | Missing |
| Titles, legends, data labels, axis min/max/units, gridlines, series colours | Partial (title + palette) |
| Chart anchored on the grid, resize/move | Missing (charts live in a panel) |
| Edit data range after creation | Missing (delete + recreate) |
| Sparklines (line/column/win-loss) in cells | Partial — `SPARKLINE()` formula only, no sparkline group UI |
| xlsx chart serialisation (c:chart / cx:chart XML) | Missing (export drops charts) |

### 2.8 Named ranges, protection, sheets, view (OO `NameManagerDlg`, `WorkbookProtection.js`, `protectRange.js`, `ProtectDialog`, `ProtectedRangesManagerDlg`, `NamedSheetViews.js`, `ViewTab.js`)

| Feature | Grown |
|---|---|
| Named ranges CRUD, scope, paste name | Partial (workbook-level list; no scope, not usable in formulas) |
| Print area as a name | Missing |
| Protect workbook structure / protect sheet with options | Missing (stub) |
| Protected ranges with allowed users | Missing (stub) — could reuse `object_grants` roles |
| Locked cells / hidden formulas | Missing |
| Freeze rows/columns/panes | Have — `SheetMenuBar.tsx` View ▸ Freeze |
| Zoom | Missing (stub) |
| Gridlines / headings / formula bar toggles | Missing (Show submenu stub) |
| Hidden sheets list, sheet tab colour, move/copy sheet, sheet list dialog | Partial (fortune-sheet tab menu: add/delete/rename/hide/copy/reorder) |
| Dark theme / interface theme | Have (app-wide) |
| Sheet views (named filter views) | Missing |
| Full screen | Have |

### 2.9 Editing, clipboard, autofill (OO `clipboard.js` 5,498 lines, `SerialTests`, `SheetStructureTests`, `SpecialPasteDialog`, `FillSeriesDialog`, `CellRangeDialog`)

| Feature | Grown |
|---|---|
| Undo/redo | Have |
| Cut/copy/paste (cells, formats, formulas adjust) | Have (fortune-sheet) |
| Paste special: values / formats / formulas / transposed / column widths / validation / CF / paste link | Missing (stub) |
| Paste from text/CSV/HTML (delimiter detection, quoted fields) | Partial (fortune-sheet HTML paste) |
| Autofill by drag (numbers, dates, weekdays, months, text+number) | Partial (fortune-sheet `autoFillCell`; weekday/month sequences and even/odd steps untested) |
| Fill ▸ Series dialog (linear/growth/date units/trend/stop value) | Missing |
| Fill down/right (Ctrl+D / Ctrl+R) | Missing |
| Insert/delete cells with shift right/down; insert/delete rows/cols | Partial (rows/cols only; cells stub) |
| Move rows/columns (drag or menu) | Missing (stub) |
| Find & replace with options, Go to (cell range) | Have / Missing |
| Comments (threaded, resolve, mentions) | Partial (fortune-sheet single-note `ps`; Insert ▸ Comment stub; no threads) |
| Images / shapes / text boxes / text art / signatures | Partial (image insert only) |
| Symbols, date/time insert (Ctrl+; Ctrl+Shift+;) | Missing |
| Spellcheck | Missing |
| Macros / plugins | Missing (stub) |

### 2.10 Collaboration, history, sharing (OO `CollaborativeEditing.js`, `History.js`, `UndoRedo.js`; LeftMenu chat/comments)

| Feature | Grown |
|---|---|
| Live co-editing with presence | Partial — op relay, no conflict resolution, last-writer-wins persistence — `collab.go` |
| Fast vs strict co-editing modes, cell locks | Missing |
| Version history / restore | Missing (stub) |
| In-editor chat | Missing (Grown has a separate Chat app) |
| Share with users/roles | Have — `ShareDialog.tsx` |

### 2.11 Import / export (OO via `core/` x2t; `Serialize.js`, `open-oox-in-browser`, `stax-reader`)

| Feature | Grown |
|---|---|
| Export xlsx | Partial (values only; no formulas, formats, merges, CF, DV, charts, freeze) — `export.ts` |
| Export ods | Partial (values only) |
| Export csv/tsv (current sheet) | Have |
| Export html | Have (all sheets) |
| Export pdf | Partial (unstyled HTML table → pdf) |
| Import xlsx/xls/ods/csv/tsv | Missing (stub) |
| Drive open of `.xlsx` in the editor | Missing (`EditorPlaceholder.tsx`, per `docs/TODO-feature-gaps.md:67`) |

### 2.12 Print & page layout (OO `PrintTests`, `PrintSettings.js`, `PageMarginsDialog`, `PrintTitlesDialog`, `HeaderFooterDialog`, `ScaleDialog`, page-break preview)

| Feature | Grown |
|---|---|
| Print | Partial (`window.print()` of the DOM) |
| Page setup (orientation, size, margins, scale/fit-to), print area, print titles, manual page breaks, headers/footers, gridlines/headings, page-break preview | Missing |

### 2.13 Keyboard shortcuts (OO `Shortcuts.js`, tests `shortcuts/shortcuts.js` — 37 shortcut types exercised)

Have (fortune-sheet or Grown): Ctrl+Z/Y, Ctrl+B/I/U, Ctrl+X/C/V, Ctrl+H (Grown), arrows/Tab/Enter/Shift-select, F2 edit, Delete, Ctrl+A.
Missing: Ctrl+Shift+1…6 number formats, Ctrl+; / Ctrl+Shift+; date/time, Alt+= autosum, Ctrl+` show formulas, Ctrl+PgUp/PgDn sheet switch, F4 reference cycling, F9/Shift+F9 recalc, Ctrl+Shift+F/P font dialogs, Alt+Shift+5 strikethrough (menu shows it but nothing binds it), Ctrl+D / Ctrl+R fill, Ctrl+K link, Ctrl+Alt+M comment, Shift+F11 new sheet (label only), Ctrl+/ shortcut help (menu label only), sub/superscript.

---

## 3. OnlyOffice test inventory

Counts are from `grep -cE '^\s*(QUnit\.)?test\('` and assertion-site greps over
`research/onlyoffice/sdkjs-tests-v9.3.1/tests/cell/**` and `tests/common/charts/**`.
Totals: **54 .js files, 1,117 test cases, ~69,500 assertion sites** (formula suite alone:
544 cases, 60,561 assertions). Full per-file table in `sheets-tests.csv`.

Portability classes:
* **vitest** — pure logic; port as table-driven cases against a Grown TS module.
* **go** — formula/engine semantics; port as fixtures run by `go test ./internal/sheets/` (the authoritative engine is Go; see §6 for how the same fixtures also feed Playwright).
* **playwright** — needs the real grid/UI or the full stack (API save → recompute → reopen).
* **n/a** — tests sdkjs-internal plumbing (sparse memory, XML reader, plugin API) with no Grown analogue.

### 3.1 `cell/spreadsheet-calculation/formula-tests/` (11 files, 544 tests, 60,561 asserts) — **go** (+ playwright samples)

Every test is `QUnit.test("Test: \"FUNC\"")` building a `parserFormula(expr, "A2", ws)`, calling `parse()` then `calculate().getValue()` and comparing to an expected number/string/error with tolerance `1e-9`; most also run `testArrayFormula(FUNC)` to check element-wise behaviour over ranges and array-formula refs. Pure input→output; ideal fixture material.

| File | Tests | Asserts | Functions tested | Grown has | Missing in Grown |
|---|---|---|---|---|---|
| `FormulaTests.js` | 47 | 1,659 | operators & semantics (see below) | — | — |
| `logicalTests.js` | 9 | 835 | AND FALSE IF IFERROR IFNA IFS NOT OR SWITCH TRUE XOR (9 titles) | 9/9 | — |
| `informationTests.js` | 17 | 2,026 | CELL ERROR.TYPE ISBLANK ISERR ISERROR ISEVEN ISFORMULA ISLOGICAL ISNA ISNONTEXT ISNUMBER ISODD ISREF ISTEXT N NA TYPE | 14/17 | CELL ISFORMULA ISREF |
| `databaseTests.js` | 12 | 1,330 | DAVERAGE DCOUNT DCOUNTA DGET DMAX DMIN DPRODUCT DSTDEV DSTDEVP DSUM DVAR DVARP | 10/12 | DSTDEVP DVARP |
| `dateTimeTests.js` | 24 | 3,896 | DATE DATEDIF DATEVALUE DAY DAYS DAYS360 EDATE EOMONTH HOUR ISOWEEKNUM MINUTE MONTH NETWORKDAYS NETWORKDAYS.INTL SECOND TIME TIMEVALUE WEEKDAY WEEKNUM WORKDAY WORKDAY.INTL YEAR YEARFRAC | 23/23 | — |
| `textAndDataTests.js` | 45 | 4,969 | 43 text functions incl. TEXT, TEXTSPLIT/BEFORE/AFTER, ARRAYTOTEXT, VALUETOTEXT, NUMBERVALUE, DOLLAR, FIXED, UNICHAR… | 34/43 | ASC FINDB LEFTB LENB MIDB REPLACEB RIGHTB SEARCHB REGEXTEST |
| `lookupAndReferenceTests.js` | 34 | 6,390 | ADDRESS AREAS CHOOSE CHOOSECOLS CHOOSEROWS COLUMN COLUMNS DROP EXPAND FILTER HLOOKUP HSTACK HYPERLINK INDEX INDIRECT LOOKUP MATCH OFFSET ROW ROWS SORT SORTBY TAKE TOCOL TOROW TRANSPOSE UNIQUE VLOOKUP VSTACK WRAPCOLS WRAPROWS XLOOKUP XMATCH | 30/33 | AREAS HYPERLINK OFFSET |
| `mathematicTests.js` | 92 | 9,799 | 80 math/trig functions | 71/80 | ACOT ACOTH CEILING.PRECISE COTH CSCH ECMA.CEILING FLOOR.PRECISE ISO.CEILING SECH |
| `statisticalTests.js` | 155 | 15,671 | 151 statistical functions (3 titles are typos: QUARTILE1, STDEV2, TREND2) | 77/151 | 71 — all distributions except NORM (BETA/BINOM/CHISQ/EXPON/F/GAMMA/HYPGEOM/LOGNORM/NEGBINOM/POISSON/T/WEIBULL, legacy + dotted), CONFIDENCE.T, COVARIANCE.P/S, CRITBINOM, FISHER/FISHERINV, FORECAST.ETS(.CONFINT/.SEASONALITY/.STAT), GAMMA/GAMMALN(.PRECISE), PERMUTATIONA, PROB, STDEVPA, STEYX, tests (CHISQ.TEST F.TEST T.TEST Z.TEST + legacy CHITEST FTEST TTEST ZTEST), VARA VARPA |
| `engineeringTests.js` | 54 | 6,852 | 54 engineering functions | 24/54 | BESSELI/J/K/Y, COMPLEX, all 25 IM* complex-number functions (IMABS IMAGINARY IMARGUMENT IMCONJUGATE IMCOS IMCOSH IMCOT IMCSC IMCSCH IMDIV IMEXP IMLN IMLOG10 IMLOG2 IMPOWER IMPRODUCT IMREAL IMSEC IMSECH IMSIN IMSINH IMSQRT IMSUB IMSUM IMTAN) |
| `financialTests.js` | 55 | 7,134 | 55 financial functions | 35/55 | ACCRINTM AMORDEGRC AMORLINC COUPDAYBS COUPDAYS COUPDAYSNC COUPNCD COUPNUM COUPPCD ODDFPRICE ODDFYIELD ODDLPRICE ODDLYIELD PRICE PRICEDISC PRICEMAT VDB YIELD YIELDDISC YIELDMAT |

`FormulaTests.js` (47) is the semantics suite: Iterative calculation; Absolute reference; Cross (sheet) refs; Defined-names cycle; Parse intersection; Range union operator; Arithmetical operations; Concatenation; `"s"&5`; String+Number coercion; Pow; `10-3`; rename sheet (#1: refs follow renames); wrong ref → `#REF!`; each comparison operator; reference argument; GetAllFormulas; long-string splitting (2); custom-function tests (16 — plugin API, **n/a**); async formulas (3 — **n/a**); `3d_ref_tests`; API calculation option (manual/auto). Portable now: ~24; after M1: 28; n/a: 19.

OnlyOffice functions with **no test** at all (27): BAHTTEXT BINOM.INV CUBE* (7) DBCS ERROR.TYPE FALSE FILTERXML FORMULATEXT GETPIVOTDATA IMPORTRANGE JIS NA NOW PHONETIC PI QUERYSTRING RAND RTD SINGLE TODAY TRUE WEBSERVICE.

### 3.2 `cell/spreadsheet-calculation/` engine & model suites (28 files, 447 tests)

| File | Tests | Asserts | Covers | Portability |
|---|---|---|---|---|
| `DynamicArraysTests.js` | 80 | 1,930 | spill/expand/blocked `#SPILL!`, metadata + undo/redo, replace/resize spill, paste & autofill collisions, copy worksheet with arrays, `A:A` refs, 48 "FUNC with dynamic arrays" element-wise lifting tests (SIN…UNICODE, TYPE), SEQUENCE multiplication table, FILTER/SORT/SORTBY/HSTACK/VSTACK/UNIQUE scenarios, IF with array condition, Ctrl+Enter offset | go (values, lifting, spill) + playwright (undo/redo, paste collisions) |
| `SheetStructureTests.js` | 65 | 1,369 | 45× autofill sequences (weekdays/months, full/short names, even/odd steps, 9- and 14-cell ranges, reverse, date/time formats, toolbar fill up/down/left/right), move rows/cols, shift & insert cells, tables (selection, values, special chars, column renames), formula wizard argument arrays, autocomplete, array formula, sortRange, cells merge, text-to-formula, unary-operator removal, assemble formulas, formulas calc, workbook dependencies, all-selection, selection in formulas | vitest (autofill sequences, sort, text-to-formula) + go (calc/deps) + playwright (structure) |
| `SerialTests.js` | 19 | 681 | Fill ▸ Series: linear/growth progression, default mode, negative cases, horizontal/vertical multi-cell, date units (day/weekday/month/year), trend, stop value, context-menu variants, series settings prepare/init/apply, toolbar fill, merged cells | vitest (new `autofill.ts`) |
| `autoFilterTests.js` | 39 | 209 | add/remove autofilter on ranges, hidden-row results for value/text/number/custom (AND/OR) filters, top10, above average, sort inside filter, insert/delete rows with filter, tables | vitest (new `filterOps.ts`) + playwright |
| `NumFormatParse.js` | 40 | 188 | `FormatParser`: leap years, valid day/date (1900 bug, 1899-12-31 base, pre-1900 invalid, PDF dates), strcmp, locale numbers, thousands/decimal/parenthesised negatives, percentages, currencies, invalid patterns, fractions, dates (month names, month-year, day-month), times, Date1904, `CellFormat.format` number/elapsed, format recognition, European mixed fractions | vitest (new `numberFormat.ts`) |
| `testsForFWB.html.js` | 13 | 211 | Number-format *rendering*: General (15-digit, `1.23457E+11`), `0`/`#`, `\` and `"` literals, `@` text, scientific, `0,00`, `00/00`, dates, month-vs-minute disambiguation, milliseconds, `;;;` hiding, conditional sections `[>100]…` | vitest (`numberFormat.ts`) |
| `CellFormatTests.js` | 4 | 26 | format string parse + 3 format-output groups | vitest (`numberFormat.ts`) |
| `whatIfAnalysisTests.js` | 16 | 463 | Goal seek (PMT, custom formulas, FV, LOOKUP, DEVSQ, BESSEL, pause/resume/step, bug #65864) — 10; Solver simplex (6) | go (goal seek); solver n/a (XL) |
| `FormulaTrace.js` | 16 | 805 | precedents/dependents (base, external, defined names, areas, shared, tables, deletes, merged, mixed, recursive, perf ×2, interface) | go (dependency-graph API, partial) |
| `DependencyGraph.js` | 11 | 146 | BroadcastHelper (simple/sparse/insert-delete/curElems/generated) + `_broadcast*` cells/ranges | go (dependency semantics: insert/delete shifts; broadcast internals n/a) |
| `ExternalReference.js` | 8 | 261 | relative-from-absolute, IMPORTRANGE, add/remove/parse/change/access external refs, short links, read+init | n/a (IMPORTRANGE across Grown sheets is a flagged optional) |
| `copy-paste-tests.js` | 9 | 82 | paste values/formulas (relative adjust), comments, tables, unary operators, paste text/HTML/binary callbacks, **`parseText` CSV parsing** | vitest (CSV parse) + playwright (paste) |
| `PivotTests.js` | 23 | 8 sites via helpers (71 `checkHistoryOperation`, 32 `checkPivotFieldItems`, 3 `checkReportValues`) | validations, layout (compact/outline/tabular), layout values, subtotal, blank rows, page-filter layout, field properties, field subtotal, data values, header rename, field manipulation, value manipulation, refresh, data source, value/label/top10 filters, reIndex, num format, misc, show-as, show details | vitest (`pivotData.ts` extended) |
| `PivotTests2.js` | 18 | 39 | refresh keeps formats/values, dataField reindex, source changes, remove field, GETPIVOTDATA (1-arg, 2-arg), API builder, calculated items (refresh/add/remove/modify/getFieldIndexByCell/errors/names/canChange), change headers/labels | vitest + go (GETPIVOTDATA) |
| `conditionalFormattingTests.js` | 5 | 37 | apply-to ranges, simple rules, contains / not-contains text, containsText with formula+text | vitest (new `condFormat.ts`) |
| `DataValidationTests.js` | 1 | 7 | custom-formula validation manipulation (ranges shift on insert/delete) | vitest (new `validationOps.ts`) |
| `ProtectTests.js` | 1 | 8 | valid protected-range title names | vitest |
| `UserProtectedRangesTest.js` | 4 | 86 | create / change / change_protect user-protected ranges | vitest + playwright |
| `SheetViewTests.js` | 1 | 12 | "show formulas" view option | playwright |
| `CellSettingsTests.js` | 1 | 6 | changeTextCase (upper/lower/sentence/toggle) | vitest |
| `PrintTests.js` | 4 | 138 | print settings open, page-break settings, page breaks + print titles, page-break manipulation | vitest (page-break model) + playwright |
| `SheetMemoryTest.js` | 13 | 242 | sparse `SheetMemory` binary storage (checkIndex, clone, set/get, delete/insert/copy ranges, clear) | n/a (sdkjs internal storage) |
| `stax-reader.js` | 12 | 13 | StAX XML reader | n/a |
| `benchmark-range-iterator.js` | 2 | 22 | range-iterator benchmark + proof | n/a |
| `tests.js` | 11 | 113 | `Asc` utils (typeOf, lastIndexOf, search, floor/ceil/round, Range, Range.intersection, Range.union, HandlersList, DependencyGraph.startListeningRange) | vitest for Range/intersection/union/round (4); rest n/a |
| `open-oox-in-browser.js` | 1 | 2 | open an xlsx (tables) in-browser | playwright (import) |
| `PivotTests2Files.js` | 0 | — | base64 fixture data | helper |

### 3.3 `cell/js-api/` (plugin/API suites, 99 tests) and `cell/shortcuts/` (38 tests)

| File | Tests | Asserts | Covers | Portability |
|---|---|---|---|---|
| `api-range.js` | 31 | 194 | `SetSort`: single-cell, header yes/no, orientation row/column, multi-key (A asc + C desc, 3 keys), empty cells, duplicates, mixed types, identical values, non-existent key, negative/out-of-range index, `asc_sortRanges` | vitest (`sheetOps.ts` `sortGridRows` → multi-key/orientation) |
| `api-format-conditions.js` | 17 | 89 | CF rule API: text/operator rules + generated formulas, date-period, 2-/3-colour scale criteria, data-bar axis/direction/show-values/min-max, icon-set change/percentile thresholds/reverse, above-average, top10 (percent/rank/bottom), unique values, delete, GetCount intersection, expression rule | vitest (`condFormat.ts`) |
| `api-validation.js` | 22 | 85 | DV add/delete/modify with overlap semantics (inside/contains/partial), per-type storage (whole number, decimal, list literal vs range, date serial, time serial, text length), getters/setters, edge cases | vitest (`validationOps.ts`) |
| `api-auto-filter.js` | 16 | 83 | filter model: xlFilterValues 2-vs-3 items, custom AND/OR with signs, top10 items, bottom10 percent, above average, colour filter, clear column, invalid field, apply/recalculate visibility, ShowAllData | vitest (`filterOps.ts`) |
| `api-drawing.js` | 10 | 47 | shape fill/outline/name/select/flip | n/a |
| `api-worksheet.js` | 3 | 17 | selected shapes/drawings by name | n/a |
| `common.js` | 0 | — | harness | helper |
| `shortcuts/shortcuts.js` | 38 | 251 | cell-editor shortcuts (text movement, delete parts, save/move, formatting, enter text, disable, select all, undo/redo, F4 ref switch, catch events); graphic-object shortcuts (13 — n/a); table hotkeys (dropdown menu, movement, reset, removing, filling, formatting, undo/redo, focus editor, show formulas, Opera preventDefault, Alt+= sum, sheet switch, refresh connections, table info, recalc) | playwright (≈24), n/a (14 graphic) |
| `shortcuts/{constants,events,measurer,workbook}.js` | 0 | — | harness | helper |

### 3.4 `common/charts/` (3 tests) and `ChartsDrawTest.js` (16 tests, 1,095 asserts)

* `chartEx-serialize.js` — 3 generated tests comparing xlsx chartEx XML round-trips against Altova-generated strings; `chartEx-serialize-files*.js` are base64 fixtures. **n/a** until Grown writes charts to xlsx.
* `ChartsDrawTest.js` — base chart draw; trendline equations (linear, logarithmic, power, exponential, polynomial), moving-average results, R², interception, bezier line builder, axis boundaries, histogram aggregation/binning/min-max/scale, RoundValues. **vitest** (`chartData.ts` → new `trendlines.ts`, `histogram.ts`, axis-tick helper).

---

## 4. Architecture recommendation

**Keep and extend the existing Go engine; keep fortune-sheet as the grid. Do not adopt a third-party engine.**

Why this is the right call (independent of the scope rule):

1. **Licensing.** HyperFormula is GPL-3.0 / commercial — incompatible with Grown's MIT distribution. OnlyOffice's own engine is AGPL. formulajs is MIT but is a scalar function bag with no parser, dependency graph, spill, LAMBDA or error propagation; adopting it would mean a *second* engine to reconcile, and its numerics (jStat) are easy to re-derive.
2. **Grown's engine is already ahead of the "library" options on the hard parts**: dependency graph + topo sort, cycle detection, dynamic-array spill with `#SPILL!`, LAMBDA/LET, array constants, criteria wildcards, QUERY/GROUPBY/PIVOTBY, and 356 functions (49 of them added in the last 55 commits, showing the additive path already works). What is missing is breadth (167 functions, mostly closed-form numerics) and reference syntax (cross-sheet, names, `A:A`) — both are additive.
3. **Server authority is a feature.** Because `SaveSheet` recomputes, the persisted JSON is correct for exports, Drive previews, integrations and Playwright tests without a browser engine. All parity tests for formulas therefore target Go, and can be replayed through the JSON API in Playwright.
4. **Test-portability.** OnlyOffice's 544 formula tests are literally `(expr, cells) → value`. A Go fixture runner ports them at near-zero marginal cost per function once the numerics exist.

Numerics sources for new functions must be MIT/BSD/public-domain references (jStat, formulajs, Cephes, NIST DTMF, Boost's documented algorithms, Excel's published definitions) — never OnlyOffice's implementations.

Known risk to record (not fixed here): **two engines**. fortune-sheet evaluates client-side while typing; Go recomputes on save. For any function Go has and fortune-sheet lacks (QUERY, LAMBDA, SORTBY…) the user sees `#NAME?` until the debounced save lands and the sheet is reopened or the server value is pushed back. Mitigation inside the current architecture (M1 "recalc round-trip"): after `SaveSheet` returns, the client re-reads computed cells and applies them via `setCellValuesByRange`; add a `POST /sheets/d/{id}/recalc` that returns computed `celldata` without persisting. This is additive.

---

## 5. Phased implementation plan

Sizes: **S** ≤ 2 dev-days · **M** ≤ 1 week · **L** 2–3 weeks · **XL** > 3 weeks. Ordered by leverage (tests unlocked per unit of work, user impact). Each milestone lists the OnlyOffice files it ports (counts = test cases).

| # | Milestone | Scope (additive) | Ports (tests) | Size | Depends on |
|---|---|---|---|---|---|
| **M0** | Parity harness | Fixture schema, Go fixture runner `internal/sheets/parity_test.go`, vitest `__parity__/` folder, Playwright `web/e2e/parity/`, `scripts/parity-status.sh`, `sheets-status.md` generator; tag convention `oo:<file>#<title>`. Port the already-implemented subset (logical 9, information 14 of 17, database 10 of 12, dateTime 24 of 24, lookup 30 of 34) to prove the pipeline and surface semantic diffs early. | logicalTests 9 · informationTests 14 · databaseTests 10 · dateTimeTests 24 · lookupAndReferenceTests 30 · tests.js 4 | **M** | — |
| **M1** | Formula reference semantics + recalc round-trip | `Sheet1!A1` / `'Quoted Name'!A1:B2` cross-sheet refs (tokeniser `!`, quoted idents, `Evaluator` gets a workbook view; `RecomputeWorkbook` already iterates all sheets — order sheets by a workbook-wide topo sort); defined names from `_namedRanges` resolved in `parseIdentOrFunc`; whole-column/row refs; range union `,`/intersection ` ` inside args; `#REF!` on deleted refs; `#NULL!`; sheet-rename fix-ups in `f` strings (client, `dataActions.ts`); `ISREF ISFORMULA CELL FORMULATEXT OFFSET AREAS HYPERLINK INDIRECT` (sheet-qualified); `/recalc` endpoint + client apply. | FormulaTests 28 · informationTests +3 · lookupAndReferenceTests +3 (→ +1 remaining is playwright) · FormulaTrace 6 (defined names, areas, deletes, merged, mixed, recursive) · DependencyGraph 4 | **M** | M0 |
| **M2** | Function breadth: math, text, database | 9 math (ACOT/ACOTH/COTH/CSCH/SECH, CEILING.PRECISE/FLOOR.PRECISE/ISO.CEILING/ECMA.CEILING), 9 text (byte variants FINDB/LEFTB/LENB/MIDB/REPLACEB/RIGHTB/SEARCHB, ASC, REGEXTEST), DSTDEVP/DVARP, `%` postfix operator. (Matrix functions, SERIESSUM, SUMX2*, NETWORKDAYS.INTL/WORKDAY.INTL already landed on origin/main.) | mathematicTests 92 · textAndDataTests 45 · databaseTests +2 | **S** | M0 |
| **M3** | Statistical library | M3a distributions (T/CHISQ/F/BETA/GAMMA/LOGNORM/WEIBULL/EXPON/POISSON/BINOM/HYPGEOM/NEGBINOM incl. legacy + `.DIST/.INV/.RT/.2T` variants, BINOM.DIST.RANGE, CRITBINOM, GAMMA, GAMMALN(.PRECISE), FISHER/FISHERINV); M3b tests & descriptive (T.TEST/Z.TEST/F.TEST/CHISQ.TEST + legacy TTEST/ZTEST/FTEST/CHITEST, CONFIDENCE.T, COVARIANCE.P/S, PROB, STEYX, PERMUTATIONA, VARA/VARPA/STDEVPA); M3c FORECAST.ETS family (AAA exponential smoothing — optional, XL on its own). NORM family, CONFIDENCE(.NORM), FREQUENCY, KURT, SKEW, MODE.MULT, PERCENTRANK, QUARTILE.EXC, GAUSS, PHI already landed on origin/main. Numerics from jStat/Cephes (MIT/BSD). | statisticalTests 155 (151 after M3a+b, 4 ETS deferred) | **L** (+XL optional) | M0 |
| **M4** | Engineering & financial libraries | Complex-number type + 25 `IM*`, `COMPLEX`, BESSELI/J/K/Y (ERF/ERFC landed); bond/coupon maths (COUPDAYBS/COUPDAYS/COUPDAYSNC/COUPNCD/COUPNUM/COUPPCD, PRICE/PRICEDISC/PRICEMAT, YIELD/YIELDDISC/YIELDMAT, ODDF*/ODDL*, ACCRINTM), AMORDEGRC/AMORLINC, VDB. Day-count basis helper (0–4) shared with YEARFRAC/DURATION. | engineeringTests 54 · financialTests 55 | **M** | M0 |
| **M5** | Dynamic arrays hardening, dependency tracking, goal seek | Element-wise lifting of every scalar function over arrays (48 "with dynamic arrays" cases), `A:A` with arrays, spill resize/replace, `FILTER` size tracking, `IF` with array condition, insert/delete-shift of formula refs server-side helper (used by client on structural ops), precedents/dependents API (`GET …/deps?cell=`) for a future trace UI, Goal Seek (secant/bisection over a single input cell) exposed as `POST …/goalseek`. | DynamicArraysTests 62 (18 undo/redo+paste-collision → playwright in M7) · FormulaTrace +6 · DependencyGraph +3 · whatIfAnalysis 10 | **M** | M1 |
| **M6** | Number formats | New pure module `web/app/src/pages/sheets/numberFormat.ts`: parse typed input (locale numbers, %, currency, parenthesised negatives, fractions, dates incl. month names, times, 1900-leap bug, Date1904) and render `ct.fa` format strings (General 11-digit/sci rules, `0 # , .`, literals, `@`, `;;;` sections, conditions, elapsed `[h]:mm`, milliseconds, month-vs-minute). Wire into: Format ▸ Number (add Accounting, Financial, Duration, Fraction, Custom dialog), and Go `TEXT()` + computed-cell `m` (port the renderer to Go as `internal/sheets/numfmt.go`, tested from the same fixtures). | NumFormatParse 40 · testsForFWB 13 · CellFormatTests 4 · textAndDataTests TEXT/DOLLAR/FIXED subsets already counted in M2 | **M** | M0 |
| **M7** | Autofill, series, sort, paste, structure | `autofill.ts` (weekday/month sequences full/short, even/odd steps, reverse, mixed text+number, dates by unit, linear/growth/trend, stop value) + Fill ▸ Series dialog + Ctrl+D/Ctrl+R; `sortGridRows` → multi-key, orientation, header flag, case option, colour keys + Sort dialog; CSV `parseText` (quotes, delimiters, escaped quotes) into paste-from-text & Import; Paste special (values/formats/formulas/transposed); Insert/delete *cells* with shift; move rows/cols; text case change. Playwright for undo/redo + paste collisions with spills. | SerialTests 19 · SheetStructureTests 52 (45 autofill + sort + merge + text-to-formula + move/shift) · api-range 31 · copy-paste 9 · CellSettingsTests 1 · DynamicArraysTests +18 · shortcuts ≈8 | **L** | M0, M5 (spill collisions) |
| **M8** | Filters, conditional formatting, data validation | `filterOps.ts` model (value list, text/number/date operators, custom AND/OR, top10 items/percent, above/below average, colour) applied via fortune-sheet hidden rows, filter dropdown UI extension, remove duplicates, group/ungroup rows/cols (collapse via hidden rows + outline stripe); `condFormat.ts` rule evaluator (text contains/begins/ends, date periods, blank/error, duplicate/unique, top/bottom N/%, above/below avg, formula rules, 3-colour scale with percentile/formula stops, data-bar axis/direction/negative, icon sets 3/4/5 with thresholds + reverse, priority + stop-if-true) producing fortune-sheet CF entries; `validationOps.ts` (whole number, time, custom formula, error alert styles, range algebra for add/delete/modify overlap, circle invalid). | autoFilterTests 39 · api-auto-filter 16 · conditionalFormattingTests 5 · api-format-conditions 17 · DataValidationTests 1 · api-validation 22 | **L** | M1 (formula rules use the engine via `/recalc`) |
| **M9** | Pivot tables | Extend `pivotData.ts`: multiple row/column fields, subtotals + grand totals toggles, compact/outline/tabular layouts, blank rows, page filters, value/label/top10 filters, all Excel aggregations, show-values-as, per-field number format (M6), header rename, date/number grouping, calculated items, refresh on source edit, show-details; `GETPIVOTDATA` in Go over stored pivot results; render pivot on the grid (write cells into a target range, like Google) in addition to the panel. | PivotTests 23 · PivotTests2 18 | **L** | M6 |
| **M10** | Charts | `trendlines.ts` (linear/log/power/exp/poly/moving average, equation + R²), `histogram.ts` (binning, overflow/underflow, auto bins), axis tick/`RoundValues` helper; new chart types scatter, doughnut, stacked/100 %, combo, histogram, waterfall; data labels, axis ranges, legend position; edit data range; anchor charts on the grid (fortune-sheet `images`-style overlay); sparkline groups UI over `SPARKLINE()`. | ChartsDrawTest 16 | **M** | M0 |
| **M11** | Import/export, print, protection, views | File ▸ Import xlsx/ods/csv via SheetJS → FortuneSheet JSON (values, formulas, formats, merges, freeze, col widths) + Drive `.xlsx` open; export xlsx with formulas/formats/merges/freeze/CF/DV (SheetJS CE limits noted); print settings model (orientation, margins, scale, print area, titles, manual page breaks → CSS paged media + page-break preview); Protect sheets & ranges (model field + `canWrite` enforcement in `collab.go`/`SaveSheet` for protected cells, allowed users via `object_grants`); View ▸ Show formulas/gridlines/headings, zoom; Sheet views. | open-oox-in-browser 1 · PrintTests 4 · ProtectTests 1 · UserProtectedRangesTest 4 · SheetViewTests 1 · chartEx-serialize 0 (deferred) | **L** | M6, M8 |
| **M12** | Shortcuts & polish | Bind the 37 tested shortcut types missing in Grown (number-format Ctrl+Shift+1…6, Ctrl+; Ctrl+Shift+;, Alt+=, Ctrl+`, Ctrl+PgUp/PgDn, F4, F9, Ctrl+K, Ctrl+Alt+M, Shift+F11, Ctrl+/, sub/superscript, strikethrough); real Help ▸ Keyboard shortcuts dialog (reuse `docs/ShortcutsDialog.tsx` pattern); Insert ▸ Function wizard; threaded comments on cells (reuse Docs `Comments.tsx` model). | shortcuts 24 · SheetStructureTests remaining playwright cases | **M** | M7 |

Cumulative portable target: **≈ 1,020 of 1,117** OnlyOffice cases (the rest are n/a: SheetMemory 13, stax 12, benchmark 2, utils 7, api-drawing 10, api-worksheet 3, graphic shortcuts 14, ExternalReference 8, custom/async formula tests 19, chartEx 3, solver 6).

### Flagged exceptions (not planned; would need non-additive work)

1. **Iterative calculation & `#CIRC!` semantics** — Excel/OO converge circular refs up to N iterations; Grown marks the cycle `#CIRC!`. Supporting iteration requires replacing topo-sort evaluation with a fixed-point loop; 1 FormulaTests case. Defer.
2. **External references / IMPORTRANGE to other workbooks** (`ExternalReference.js`, 8) — needs a cross-document data-fetch + cache layer and permission model. Optional later as `IMPORTRANGE(sheetId, range)` over Grown sheets only.
3. **OnlyOffice plugin/custom-function and async-formula tests** (FormulaTests 19, api-drawing 10, api-worksheet 3) — test an API Grown does not expose. N/A.
4. **Collaborative editing fidelity** — `collab.go` is a relay; OnlyOffice's lock/OT tests and "undo/redo under co-editing" cases cannot be ported without a CRDT (e.g. Yjs, already used by Docs). Out of scope here; note that Docs' Yjs stack exists if it is ever wanted.
5. **xlsx fidelity ceiling with SheetJS Community Edition** — charts, CF, DV and pivot definitions are not written by SheetJS CE; M11 covers what CE can, and `chartEx-serialize` stays n/a unless Grown writes OOXML directly.
6. **Solver** (simplex, 6 tests) — sizable optimisation library; goal seek is planned, solver is not.
7. **Two formula engines** (client fortune-sheet vs server Go) — divergence is mitigated, not removed, by the M1 recalc round-trip. Replacing fortune-sheet's evaluator would be a rewrite of its core; not planned.

---

## 6. Test-porting approach

### 6.1 Layout

```
internal/sheets/
  parity_test.go                      # fixture runner: loads testdata/parity/*.json, evaluates, asserts
  testdata/parity/
    formula-logical.json              # one file per OnlyOffice formula test file (11)
    formula-mathematic.json
    …
    dynamic-arrays.json
    formula-semantics.json            # FormulaTests.js
    goal-seek.json
web/app/src/pages/sheets/__parity__/
  README.md                           # conventions (this section, condensed)
  numberFormat.parity.test.ts         # NumFormatParse + testsForFWB + CellFormatTests
  autofill.parity.test.ts             # SerialTests + SheetStructureTests autofill
  sort.parity.test.ts                 # api-range + SheetStructureTests sortRange
  filter.parity.test.ts               # autoFilterTests + api-auto-filter
  condFormat.parity.test.ts           # conditionalFormattingTests + api-format-conditions
  validation.parity.test.ts           # DataValidationTests + api-validation
  pivot.parity.test.ts                # PivotTests + PivotTests2
  charts.parity.test.ts               # ChartsDrawTest
  csv.parity.test.ts                  # copy-paste parseText
  range.parity.test.ts                # tests.js Range utils, ProtectTests names, CellSettings text case
web/e2e/parity/
  sheets-formulas.spec.ts             # replays a sampled subset of internal/sheets/testdata/parity via the JSON API
  sheets-structure.spec.ts            # undo/redo, paste collisions, move rows, shift cells
  sheets-shortcuts.spec.ts            # keyboard bindings
  sheets-print-protect.spec.ts
```

Fixtures live under `internal/sheets/testdata/` (Go convention) and are the single source of truth for formula cases; vitest/Playwright import them by relative path. Fixtures are **hand-written from observed behaviour**, never generated by scraping OnlyOffice source.

### 6.2 Fixture schema (formula suites)

```json
{ "suite": "formula-tests/mathematicTests.js",
  "cases": [
    { "id": "ABS#1", "cells": { "A1": -3, "A2": "=A1*2" }, "formula": "=ABS(A2)", "expect": 6 },
    { "id": "ABS#err", "formula": "=ABS(\"x\")", "expect": { "error": "#VALUE!" } },
    { "id": "SEQUENCE#spill", "formula": "=SEQUENCE(2,2)", "expect": [[1,2],[3,4]] },
    { "id": "NORM.DIST#1", "formula": "=NORM.DIST(1,0,1,TRUE)", "expect": 0.841344746, "tol": 1e-9 },
    { "id": "CELL#pending", "formula": "=CELL(\"type\",A1)", "expect": "v", "skip": "M1" }
  ] }
```

`expect` is number | string | boolean | `{error}` | 2-D array; `tol` defaults to `1e-9`; `now` may pin the clock; `sheets` may define a multi-sheet workbook for cross-sheet cases; `skip: "<milestone>"` records a known gap (counted as *ported, pending*, not as failing).

### 6.3 Naming & tagging

* Every ported case name starts with `oo:` followed by the OnlyOffice path relative to `tests/cell/` (or `tests/common/`) and the original test title: `oo:spreadsheet-calculation/formula-tests/mathematicTests.js#ABS`. In Go fixtures this is the `id` plus the file's `suite`; in vitest `it("oo:…", …)`; in Playwright `test("oo:…", …)`.
* Behaviour Grown intentionally differs on (Google-Sheets semantics chosen over Excel's) is tagged `oo-diff:` with a one-line reason in the case.
* N/A cases are not written; they are listed in `sheets-tests.csv` with `portability=n/a` so the denominator is explicit.

### 6.4 Tracking the count

* `scripts/parity-status.sh` (to be added in M0) runs `go test ./internal/sheets/ -run Parity -json`, `npx vitest run __parity__ --reporter=json`, and `npx playwright test parity --reporter=json --list` (or full run when the stack is up), then counts per OnlyOffice file: `total` (from `sheets-tests.csv`), `ported` (cases carrying the `oo:` tag), `passing`, `pending` (skipped with milestone tag), `na`.
* Output is written to `docs/plans/onlyoffice-parity/sheets-status.md` as a table plus the headline `ported/passing/total = x/y/1117`; the CSV stays the denominator and is updated only when the OnlyOffice snapshot is refreshed.
* Definition of done per milestone: every OnlyOffice case listed for it is either passing or tagged `oo-diff:`; CI runs the Go + vitest parity suites on every PR, Playwright parity nightly.

---

## 7. M0 results (2026-09-26)

M0 is the Go fixture harness plus the first formula ports. The vitest
`__parity__/` folder and the `tests.js` range utilities landed with it.
Playwright parity and the status scripts belong to the cross-cutting scoreboard
(CC0) and are not part of this milestone.

### 7.1 What landed

| Piece | Where |
|---|---|
| Fixture runner (`TestParity`) | `internal/sheets/parity_test.go`. The file header documents the schema. |
| Formula fixtures | `internal/sheets/testdata/parity/formula-{logical,information,database,datetime,lookup}.json` |
| vitest parity folder | `web/app/src/pages/sheets/__parity__/` (README plus `range.parity.test.ts`) |
| Range utilities under test | `web/app/src/pages/sheets/cellRange.ts` (normalize/contains/intersection/union, `roundCoord`) |

**Tag convention.** This overrides §6.3 and follows the combined roadmap. The
tag is `oo:<path relative to sdkjs-tests-v9.3.1/tests/>#<QUnit title>`, for
example `oo:cell/spreadsheet-calculation/formula-tests/logicalTests.js#AND`.
In Go it is the case `id` and also the `t.Run` name. In vitest it is the
`it()` title. Each OnlyOffice `QUnit.test` gets exactly one tag, and a tag
groups all of that test's assertions as ordered *checks*.

**Schema, compared with §6.2.** A case holds `cells` (the typed-input sheet
state), an optional default `at`, `names`, and an ordered `checks` list. Each
check can carry `set` (cell edits that persist to later checks), `formula`,
`at`, `array` (evaluated as `ARRAYFORMULA(...)`), `expect`, `elements`
(`[row, col, value]` of an array result), `tol`, `invalid`, `date1904`, and
`pending`. A case passes when all of its non-pending checks pass. A case whose
checks are all skipped is reported as skipped. The runner also skips checks
whose features belong to a later milestone:

- M1 (808 checks): cross-sheet refs, defined names, structured table refs, and `A:A`/`1:1`.
- 1904 date system (104 checks).

The fixtures still carry the `Sheet2!…` cells and the `names` those checks need,
so M1 only has to lift the skip.

**How the facts were collected.** A local extraction harness produced the
expected values. It is not committed and lives in the session scratchpad
(`ooextract/`). It runs the AGPL suites against recording mocks and keeps only
facts: the formula text, the cell inputs set before each assertion, and the
expected value. The fixture structure, grouping, and pending reasons are
Grown's own. No OnlyOffice code, comments, or file structure is copied.

This deviates from §6.1, which says fixtures are "hand-written, never
generated". Please review and either accept the approach or ask for the
harness to be dropped.

Two quirks of the suites are reproduced faithfully:

- A formula parsed with a plain string position (such as `"A2"`) has no cell
  context, so `ROW()` is 1. Only `CCellWithFormula` positions become `at`.
- An element read outside an array result is empty text.

### 7.2 Counts

| OnlyOffice file | Tags ported | Tags passing | Checks | Passing | Pending (diff) | Skipped (M1/1904) |
|---|---|---|---|---|---|---|
| `logicalTests.js` | 9 / 9 | 9 | 354 | 268 | 29 | 57 |
| `informationTests.js` | 14 / 17 (no CELL, ISFORMULA, ISREF) | 13 (SHEET all-pending) | 679 | 444 | 61 | 174 |
| `databaseTests.js` | 10 / 12 (no DSTDEVP, DVARP) | 10 | 447 | 220 | 138 | 89 |
| `dateTimeTests.js` | 24 / 24 | 24 | 1,650 | 1,090 | 246 | 314 |
| `lookupAndReferenceTests.js` | 30 / 34 (no AREAS, FORMULATEXT, HYPERLINK, OFFSET) | 30 | 2,189 | 1,231 | 680 | 278 |
| `tests.js` (vitest) | 4 / 11 (round, Range, intersection, union) | 4 | — | — | — | — |
| **Total** | **91** | **90** | **5,319** | **3,253** | **1,154** | **912** |

### 7.3 Engine fixes made in M0

Each fix is small and has its own unit test in `formula_test.go`.

1. **Error literals.** `#N/A`, `#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#NUM!`, `#NULL!`, `#SPILL!`, `#CALC!` and `#GETTING_DATA` are now tokenised in formulas and array constants. Before, the tokenizer dropped `#`, so `=IFERROR(#N/A,1)` returned `#NAME?`. This fixed about 100 checks. (`TestErrorLiterals`)
2. **Date text in date functions.** YEAR, MONTH, DAY, HOUR, EDATE, DATEDIF, DAYS and the other date functions now read date and time text the same way DATEVALUE and TIMEVALUE do, so `=MONTH("2021-10-01")` returns 10. Before, they returned `#VALUE!`. (`TestDateFunctionsAcceptDateText`)
3. **Serial overflow after 2192.** `timeToSerial` used `time.Sub`, which saturates at about 292 years. As a result, `DATE(9999,12,31)` returned 106752 instead of 2958465, and every date after 2192 was wrong. (`TestDateSerialFarFuture`)
4. **`DATE` past 9999-12-31 now returns `#NUM!`.** (`TestDatePastYear9999IsNum`)

### 7.4 Semantic differences found (bug backlog)

Every failing check is marked `"pending": "oo-diff/<key>: …"`. The keys below
are the first bug backlog. Counts are checks. The milestone column is a
suggestion.

| Key | Checks | Functions (top) | Example: want → Grown | Suggested home |
|---|---|---|---|---|
| `lookup-approx` | 214 | XMATCH, LOOKUP, HLOOKUP, VLOOKUP, XLOOKUP, MATCH | Several patterns: approximate/binary search over unsorted or mixed data, an error cell inside the range aborting an exact match (`HLOOKUP("SANDRA",E301:Q302,2,FALSE)`: 9 → `#VALUE!`), wildcard and search modes, and the LOOKUP array form (`LOOKUP("C",{"a","b","c","d";1,2,3,4})`: 3 → "c") | M2-sized follow-up |
| `omitted-arg` | 206 | XLOOKUP, WEEKDAY, INDEX, H/VLOOKUP, ADDRESS, D* | `DAYS(,)`: 0 → `#VALUE!`. The parser has no "omitted argument" value. | M1 (parser) |
| `array-lifting` | 99 | SORTBY, CHOOSE, WORKDAY.INTL, VLOOKUP, DATEDIF, YEAR/MONTH | `N({12,24})` and `DATEDIF(C2:C6,25,"D")` return a scalar. OnlyOffice lifts scalar functions over array arguments. | M5 |
| `dynarray-validation` | 94 | FILTER, SORT, EXPAND, SORTBY, TAKE, CHOOSE, WRAP* | `FILTER({1;2;3;4},{"FALSE";0;1;1})` accepts text booleans. Mismatched shapes are not `#VALUE!`. Sizes over the limit are not `#NUM!`. | M5 |
| `date-1900` | 86 | MONTH, YEAR, EDATE, DAY, WEEKNUM, EOMONTH | `DAY(1)`: 1 → 31, `DATE(1900,1,1)`: 1 → 2. Serials 0 to 60 are off by one because there is no 1900-01-00 and no fictitious 1900-02-29. | M6 (number/date model) |
| `db-criteria` | 77 | DGET, DSUM, DPRODUCT, DCOUNT(A), DMAX | `DMIN(A4:E10,"Age",G1:G2)`: 8 → 0. A blank criteria cell reads as 0 instead of "match anything". | M2 |
| `error-args` | 77 | SORTBY, ADDRESS, DROP, D*, VSTACK | `DROP(1,#N/A)`: `#N/A` → `#VALUE!`. The error argument is ignored or replaced. | M2 |
| `range-as-scalar` | 55 | NETWORKDAYS, WORKDAY.INTL, V/HLOOKUP, SORT, EDATE | `TAKE(1,A1:B5)`: `#VALUE!` → 1. A multi-cell range in a scalar slot silently uses its first cell. | M5 |
| `sheet-context` | 32 | SHEET, SHEETS | `SHEET()`: 4 → 1. The evaluator has no workbook context in the fixture and does not validate arguments. | M1 |
| `bool-as-number` | 22 | EDATE, NETWORKDAYS, EOMONTH, SORT, FILTER | `EDATE(TRUE,1)`: `#VALUE!` → 32 | M2 |
| `date-text` | 22 | DATEVALUE, TIMEVALUE, DAY, YEAR, DAYS | `DAY("5-JUL")`, `"5/5/11"`, `"Mar-15-2011"`, `"25:00"`, and the ISO/US order in `"03-26-2006"` | M6 |
| `address-r1c1-sheet` | 22 | ADDRESS | `ADDRESS(2,3,2,FALSE)`: `"R2C[3]"` → `"C$2"`. R1C1 style and `sheet_text` are unsupported. | M1 |
| `logical-text` | 20 | AND, OR, XOR, NOT | `NOT("")`: `#VALUE!` → TRUE. Text is coerced, where OnlyOffice rejects or ignores it. | M2 |
| `row-col-ref` | 20 | ROW, COLUMN | `ROW(B6)`: 6 → 1. `rangeVal` carries no origin. | M1 |
| `holiday-text` | 19 | WORKDAY(.INTL), NETWORKDAYS(.INTL) | Holidays given as `{"5-1-2018","5-3-2018"}` are ignored. | M2 |
| `db-field` | 16 | D* | Boolean, array or out-of-range field arguments, and criteria chosen through `IF(...)` | M2 |
| `num-vs-value-error` | 14 | WRAPROWS, WRAPCOLS, *.INTL | `WRAPROWS(1,0)`: `#NUM!` → `#VALUE!` | M2 |
| `blank-cell` | 14 | ISBLANK, ISNUMBER, IFERROR, IFNA | `ISBLANK("")`: FALSE → TRUE, and `IFERROR(blank,…)`: "" → 0. The engine has no distinct empty value. | M1/M5 |
| `indirect` | 11 | INDIRECT | R1C1 text, `"Sheet2!A1"`, `"TestName"`, and `TEXT(...)`-built addresses | M1 |
| `info-arrays` | 9 | TYPE, IS* | `TYPE({1,2,3})`: 64 → 2, and `ISLOGICAL({FALSE,TRUE})` | M2 |
| `overflow` | 8 | MONTH, SECOND, ISERR, ISEVEN | `MONTH(1E+308)` and `9.99E+307*10` do not produce `#NUM!` | M2 |
| `switch-types` | 4 | SWITCH | `SWITCH(TRUE,1,100,…)` matches 1 = TRUE | M2 |
| `semicolon-args` | 4 | CHOOSECOLS, CHOOSEROWS | `CHOOSECOLS(A1:C6;-1;1)` uses `;` as the list separator | M1 (locale) |
| `ref-returning` | 3 | ROWS, CHOOSE | `ROWS(INDIRECT("A100:A101"))` and `SUM(A102:CHOOSE(2,…))`: functions return values, not references | M1 |
| `text-as-date` | 3 | DATEVALUE, NETWORKDAYS | `DATEVALUE(40777)`: `#VALUE!` → 40777 | M2 |
| `single-fn` | 2 | WEEKDAY | `SINGLE()` (the implicit-intersection `@`) is missing | M5 |
| `yearfrac-precision` | 1 | YEARFRAC | Basis 1 across many years uses a different average year length | M4 |

The four largest themes cover more than half of the backlog (about 610 of 1,154 checks):

- Omitted arguments.
- Lookup search semantics.
- Array lifting.
- The missing empty value (blank criteria cells, `ISBLANK`, `""` outputs).

Each theme is a cross-cutting engine change, not a per-function fix.

---

## 8. M2 + M4 results (Wave 1, 2026-09-26)

M2 (math/text/database breadth) and M4 (engineering and financial) are
done: every OnlyOffice tag in the four suites passes, with the remaining
differences marked pending check by check.

### 8.1 What landed

| Piece | Where |
|---|---|
| Math: ACOT, ACOTH, COTH, CSCH, SECH, CEILING.PRECISE, ISO.CEILING, FLOOR.PRECISE, ECMA.CEILING | `formula_math2.go` |
| Text: FINDB, LEFTB, LENB, MIDB, REPLACEB, RIGHTB, SEARCHB, ASC, REGEXTEST (LEN/LEFT/RIGHT/MID now share the byte variants' argument handling) | `formula_text2.go` |
| Database: DSTDEVP, DVARP | `formula_database2.go` |
| `%` postfix operator; omitted arguments (`f(1,,3)`) read as 0 / ""; Excel number-to-text (15 digits, `1E+307`) | `formula.go` (tokenizer `'%'`, `parsePercent`, `parseArgList`, `toStr`), `formula_operators.go` |
| Complex type, COMPLEX + 25 IM* functions | `formula_complex.go` |
| BESSELI/J/K/Y | `formula_bessel.go` |
| Day-count basis helper (0–4) and coupon schedule | `formula_daycount.go` |
| COUPDAYBS/COUPDAYS/COUPDAYSNC/COUPNCD/COUPNUM/COUPPCD, PRICE, YIELD, PRICEDISC, YIELDDISC, PRICEMAT, YIELDMAT, ACCRINTM, ODDFPRICE, ODDFYIELD, ODDLPRICE, ODDLYIELD (ACCRINT and DURATION/MDURATION rewritten on the same helpers) | `formula_bond.go`, `formula_more2.go` |
| VDB, AMORLINC, AMORDEGRC | `formula_depreciation.go` |
| Argument guards for the older scalar financial/engineering functions (error pass-through, multi-cell range → `#VALUE!`) | `formula_validate.go` |
| Fixtures | `testdata/parity/formula-{math,text,engineering,financial}.json`, `formula-database.json` (+DSTDEVP, DVARP) |

No client function list exists (formula autocomplete comes from
fortune-sheet), so nothing needed registering outside `registerFunc`.

Harness additions: a check may set `"complex": true` (complex text compared
part by part within `tol`: the suites print full double precision, Grown
prints 15 digits like Excel), and `PARITY_INCLUDE_PENDING=1` with
`PARITY_REPORT` reports pending checks that now pass.

### 8.2 Counts

| OnlyOffice file | Tags ported / passing | Checks | Passing | Pending (diff) | Skipped (M1) |
|---|---|---|---|---|---|
| `mathematicTests.js` | 92 / 92 | 4,120 | 3,044 | 366 | 710 |
| `textAndDataTests.js` | 44 / 44 (T(123) has no literal assertion) | 2,139 | 1,397 | 368 | 374 |
| `engineeringTests.js` | 54 / 54 | 3,121 | 2,396 | 81 | 644 |
| `financialTests.js` | 55 / 55 | 3,032 | 2,516 | 154 | 362 |
| `databaseTests.js` | 12 / 12 (+DSTDEVP, DVARP) | 536 | 268 | 161 | 107 |

Scoreboard: `sheets/formulas` ported 87 → 334; total 135 → 382.

### 8.3 Wave 0 backlog items fixed here

Error arguments now propagate through ROUND, ABS, LEFT/RIGHT/MID/LEN and
the guarded financial/engineering functions (`error-args`); omitted
arguments no longer give `#VALUE!` (69 Wave 0 `omitted-arg` checks now
pass; 16 lookup checks where OnlyOffice *rejects* an empty argument are
now pending as `omitted-arg-rejected`). Also: ROUND family on the 15-digit
decimal value, `POWER(0,-1)`/`LOG(x,1)`/`COT(0)`/`CSC(0)` → `#DIV/0!`,
GCD/LCM validation, date text in math functions and VALUE, CEILING with a
negative number and positive significance, AGGREGATE 14–19 with
error-ignoring options, IPMT/CUMIPMT beginning-of-period interest, DB month
truncation, DDB fractional periods, and a panic on `DEC2BIN(1,1E+10)`.

### 8.4 Remaining differences (pending keys, new suites)

| Key | Checks | Note / home |
|---|---|---|
| `number-format` | 172 | TEXT/DOLLAR/FIXED format codes and OnlyOffice locale output → M6 |
| `array-lifting`, `whole-ref-arith` | 118 | scalar functions and range arithmetic over arrays outside ARRAYFORMULA → M5 |
| `direct-text-args`, `sum-of-text-result` | 103 | `SUM("10")` vs a text cell: single-cell references reach functions as values, so literal and reference cannot be told apart → M1 (reference values) |
| `semicolon-args` | 74 | `;` as argument separator → M1 (locale) |
| `validation` | 74 | per-function argument validation (SEQUENCE, AGGREGATE, DECIMAL, XIRR, …) |
| `date-1900` | 50 | serials ≤ 60 → M6 |
| `overflow` | 40 | results beyond Excel's range not `#NUM!` |
| `textsplit-array-delims`, `regex-args`, `roman-forms`, `convert-units` | 132 | TEXTBEFORE/AFTER/SPLIT array delimiters, Excel-365 REGEX* arguments, ROMAN forms 1–4, CONVERT unit table |
| others | ~200 | error-args in functions not yet guarded, booleans, blank cells, `#NULL!`, OnlyOffice-specific quirks (e.g. `UPPER(TRUE)` stays boolean, IMSUM always answers with `i`) |
