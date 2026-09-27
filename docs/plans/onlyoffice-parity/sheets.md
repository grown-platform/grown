# OnlyOffice parity plan — Sheets

Status: plan written 2026-09-26. M0 (the parity harness and the first 91 ported tests) has landed; see §7. Wave 1: M1 (reference semantics and the recalc round-trip) is done; see §9. Wave 3: M3, M6 and M8 (filters, conditional formatting, data validation; §12) are done. Wave 4: M7 (autofill, series, sort, paste special, sheet structure; §13) is done. Wave 5: M9 (pivot tables; §15) is done. Wave 6: M10 (charts; §16) is done. Wave 7: M5 (dynamic arrays, tracing, goal seek; §17) and M12 (shortcuts, function wizard, comments; §18) are done. Wave 11: Excel tables (ListObjects, structured references; §20) are done, which closes the last portable gaps §19.4 listed.
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
| Charts | Dependency-free SVG renderer: column, bar, line, area (plain/stacked/100 %), combo with a secondary axis, scatter, pie, doughnut, histogram, waterfall; trendlines, data labels, axis options, legend placement. Stored in `grownCharts` on sheet 0, anchored on the grid (and listed in a panel); exported to and imported from xlsx (M10, §15). | `ChartDialog.tsx`, `ChartRenderer.tsx`, `ChartOverlay.tsx`, `chartData.ts`, `trendlines.ts`, `histogram.ts`, `chartAxis.ts`, `xlsx/xlsxCharts.ts` |
| Pivot | Pure TS pivot: one row field, optional column field, one value field, aggs sum/count/average/min/max, row+col totals. Rendered as an HTML table in a panel. (M9, §15: Excel-layout engine written onto the grid.) | `PivotDialog.tsx`, `pivotData.ts`, `PivotTableView.tsx`, `PivotPanel.tsx` |
| Conditional formatting | Dialog over fortune-sheet's `luckysheet_conditionformat_save`: single-colour "default" rules (greaterThan/lessThan/between/equal…), `colorGradation` (colour scale), `dataBar`. Plus Grown icon sets (arrows/traffic/signs) as a display overlay on `m`. | `ConditionalFormatDialog.tsx`, `iconSets.ts` |
| Data validation | Dialog over fortune-sheet `dataVerification`: dropdown, checkbox, number_decimal, text_length, text_content, date; operators (between, equal, …); prohibit input / hint. | `DataValidationDialog.tsx` |
| Data menu ops | Sort range / sort sheet (single key, header heuristic), randomize, toggle filter (fortune-sheet `filter_select`), split text to columns (delimiter autodetect), find & replace (case / whole-cell / regex, scope all/sheet/range). | `dataActions.ts`, `sheetOps.ts`, `FindReplaceDialog.tsx` |
| Named ranges | CRUD dialog storing `_namedRanges` on `sheet[0]`. Resolved by the Go engine since M1 (§9); fortune-sheet's client engine still does not know them. | `NamedRangesDialog.tsx` |
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

Limitations (these drove milestone M1/M5; M1 has since removed the reference-syntax ones, see §9):

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
| Number formats: General, Number, Currency, Accounting, Financial, Percent, Scientific, Date, Time, Date-time, Duration, Fraction, Text, Custom | Have (M6): 14 presets + Custom number format dialog; rendering by `numberFormat.ts` / `numfmt.go` | `SheetMenuBar.tsx` Format ▸ Number, `NumberFormatDialog.tsx` |
| Number-format parsing of typed input (`1,234.5`, `12%`, `$5`, `(3)`, dates, times, fractions, locale) | Have (M6): `parseInput` in `numberFormat.ts`, wired through the workbook hooks; separators are parameterised, the UI uses en-US | `numberFormatActions.ts` |
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
| Create pivot from range; row/column/value fields | Have (M9) — any number of each — `pivotEngine.ts` |
| Multiple row/col fields with subtotals, compact/outline/tabular layout, blank rows, grand totals on/off | Have (M9) |
| Page (report) filters, value filters, label filters, Top 10 | Have (M9) |
| Aggregations: sum/count/average/min/max | Have (M9): all eleven Excel functions |
| Show values as (% of total/row/column, difference from, running total, rank…) | Have (M9): all fifteen |
| Number format per value field, header rename | Have (M9) |
| Grouping (dates by month/quarter/year, numeric bins) | Have (M9), plus item groups |
| Calculated fields / items | Have (M9) |
| Refresh on source change, change data source | Have (M9) |
| Show details (drill-through) | Have (M9) |
| GETPIVOTDATA | Have (M9, Go) |
| Pivot placed on the grid (not a side panel), pivot styles | On the grid: Have (M9); pivot styles: Missing |

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

*Update (M12, §18):* all of the above except Ctrl+Shift+F/P are bound, from one table (`sheetShortcuts.ts`) that Help ▸ Keyboard shortcuts also lists.

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
5. **xlsx fidelity ceiling with SheetJS Community Edition** — charts, CF, DV and pivot definitions are not written by SheetJS CE; M11 covers what CE can, and `chartEx-serialize` stays n/a unless Grown writes OOXML directly. *Resolved differently in M11 (§14): Grown reads and writes the xlsx parts itself with JSZip, so CF, DV, styles, panes, print setup and protection round-trip; charts and pivots are still not written.*
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
| `number-format` | 172 | TEXT/DOLLAR/FIXED format codes and OnlyOffice locale output → M6 (done; see §11.3 for what passes and the re-keyed rest) |
| `array-lifting`, `whole-ref-arith` | 118 | scalar functions and range arithmetic over arrays outside ARRAYFORMULA → M5 |
| `direct-text-args`, `sum-of-text-result` | 103 | `SUM("10")` vs a text cell: single-cell references reach functions as values, so literal and reference cannot be told apart → M1 (reference values) |
| `semicolon-args` | 74 | `;` as argument separator → M1 (locale) |
| `validation` | 74 | per-function argument validation (SEQUENCE, AGGREGATE, DECIMAL, XIRR, …) |
| `date-1900` | 50 | serials ≤ 60 → M6 |
| `overflow` | 40 | results beyond Excel's range not `#NUM!` |
| `textsplit-array-delims`, `regex-args`, `roman-forms`, `convert-units` | 132 | TEXTBEFORE/AFTER/SPLIT array delimiters, Excel-365 REGEX* arguments, ROMAN forms 1–4, CONVERT unit table |
| others | ~200 | error-args in functions not yet guarded, booleans, blank cells, `#NULL!`, OnlyOffice-specific quirks (e.g. `UPPER(TRUE)` stays boolean, IMSUM always answers with `i`) |

## 9. M1 results (Wave 1, 2026-09-26)

M1 is done. The engine evaluates against the whole workbook, every M1 skip
in the parity runner is gone (only structured table references and the 1904
date system are still skipped: Grown has neither), and the editor applies
server-computed values.

### 9.1 What landed

| Piece | Where |
|---|---|
| Workbook view: every sheet's grid, results and spill state, plus defined names. Values read from a reference carry a `refInfo` (sheet + areas). | `formula_refs.go` |
| Tokenizer: `Sheet2!`, `'Quoted name'!` (with `''` escapes), Unicode sheet names, `_` in names, whitespace kept for intersection, `@` | `formula.go` (`tokenise`) |
| Parser: whole-column/row refs (`A:A`, `1:3`, `$A:$B`), `:` on any reference (`C2:C3:C2`, `(A1:A3):F1`, `A1:INDEX(...)`), union `(A1:B2,D4)`, intersection (space) with `#NULL!`, implicit intersection `@`, defined names (`_namedRanges`), `#REF!` for missing sheets and refs past XFD1048576, `;` as an argument separator, `#NAME?` for an unclosed call | `formula.go`, `formula_refs.go` |
| Recalculation: a workbook-wide topological sort over (sheet, cell). Cells reached only at run time (INDIRECT, OFFSET) are computed on demand, with a re-entry guard (`#CIRC!`). | `formula_deps.go`, `formula_refs.go` (`ensureFormula`) |
| Reference functions: ISREF, ISFORMULA, FORMULATEXT, CELL, OFFSET, AREAS, HYPERLINK, SINGLE. ROW, COLUMN, ROWS, COLUMNS, SHEET and SHEETS read the reference. INDEX, CHOOSE and IF return references. INDIRECT takes ranges, names, sheets and R1C1. ADDRESS gains R1C1 and `sheet_text`. | `formula_reffuncs.go`, `formula_lookup.go`, `formula_sheetmeta.go` |
| Empty cells are marked (`ISBLANK`, `ISNUMBER`, `""` in text). Operators broadcast over arrays in every formula (Excel 365). Arrays of different sizes pair with `#N/A`. | `formula.go`, `formula_arrayformula.go` |
| Spilled values persist with a `grownSpill` marker, so re-saving no longer turns the anchor into `#SPILL!` (a pre-existing bug) | `formula_refs.go` |
| Precedent/dependent tracing (one level per call; removing takes the outermost level) over the dependency graph. This is the engine side of a future trace UI. | `formula_trace.go` |
| `POST /api/v1/sheets/d/{id}/recalc` returns the computed formula and spill cells without saving (a plain handler, no proto change) | `recalc.go`, `internal/server/sheets_recalc.go` |
| Editor: after each autosave it applies the `/recalc` values that differ from fortune-sheet's. Renaming a tab rewrites `Sheet!` references in formulas and `_namedRanges`. | `SheetEditor.tsx`, `formulaRefs.ts` |
| Editor fixes found on the way: the autosave never fired while the editor was open (onChange was re-invoked on every presence tick and reset the debounce), and it saved each sheet's dense `data` matrix instead of `celldata`, so the server engine never saw edited cells | `SheetEditor.tsx`, `workbookJson.ts` |

Fixture schema additions: case-level and check-level `"sheets"` (the sheet
order). `PARITY_PENDING_REPORT=<file>` lists pending checks that now pass.

### 9.2 Ports

| OnlyOffice file | Tags | Where |
|---|---|---|
| `formula-tests/FormulaTests.js` | 26 of 27 portable (Iterative calculation is all pending; API Calculation option is pending) | `testdata/parity/formula-semantics.json`, `formula_trace_test.go` (GetAllFormulas), `__parity__/formulaRefs.parity.test.ts` (rename sheet #1) |
| `formula-tests/informationTests.js` | +3: CELL, ISFORMULA, ISREF (17 / 17) | `formula-information.json` |
| `formula-tests/lookupAndReferenceTests.js` | +4: AREAS, FORMULATEXT, HYPERLINK, OFFSET (34 / 34) | `formula-lookup.json` |
| `FormulaTrace.js` | 6: DefName, Areas, Deletes, Merged cells, Mixed, Recursive formulas | `formula_trace_test.go` |
| `DependencyGraph.js` | 4: the `_broadcast*` cases | `formula_trace_test.go` |

The FormulaTests literal cases were extracted the same way as in Wave 0. The
structural ones (Cross, Parse intersection, Range union, Defined names
cycle, 3d_ref, long strings) were written from the suite's observed
behaviour. The OFFSET fixture keeps the whole sheet state, because the
extractor had kept only statically referenced cells. The custom-function and
async tests stay n/a.

Playwright: `web/e2e/sheets-refs.spec.ts` checks cross-sheet refs, quoted
names, defined names and `/recalc` through the API, and a tab rename in the
grid that rewrites formulas and the named range, persisted and recomputed.

### 9.3 Counts

Checks per suite after M1. Pending checks are marked `oo-diff`; skipped
checks use table references or 1904 dates.

| OnlyOffice file | Checks | Passing | Pending | Skipped |
|---|---|---|---|---|
| `FormulaTests.js` | 242 | 224 | 18 | 0 |
| `informationTests.js` | 969 | 870 | 54 | 45 |
| `lookupAndReferenceTests.js` | 2,383 | 1,761 | 568 | 54 |
| `logicalTests.js` | 363 | 321 | 31 | 11 |
| `dateTimeTests.js` | 1,674 | 1,294 | 237 | 143 |
| `databaseTests.js` | 548 | 419 | 106 | 23 |
| `mathematicTests.js` | 4,212 | 3,723 | 376 | 113 |
| `textAndDataTests.js` | 2,183 | 1,768 | 349 | 66 |
| `engineeringTests.js` | 3,175 | 2,907 | 152 | 116 |
| `financialTests.js` | 3,087 | 2,849 | 181 | 57 |
| **Total** | **18,836** | **16,136** | **2,072** | **628** |

Scoreboard `sheets/formulas`: 334 → 378 ported tags. On the Wave 0 suites
alone, passing checks went from 3,339 to 4,770 before the merge with M2/M4.

### 9.4 Backlog items closed, and what is left

Closed: `sheet-context`, `row-col-ref`, `indirect` (except TEXT-built
addresses), `address-r1c1-sheet`, `ref-returning`, `blank-cell` (except
HOUR and SORT order), `single-fn`, most of `omitted-arg`, and 40 of
`semicolon-args`.

New pending keys, which the M1 skips had hidden:

| Key | Checks | Note |
|---|---|---|
| `range-arg-first-cell`, `range-as-scalar` | 217 | A multi-cell range (often a whole column or row, or a two-cell name) in a scalar slot. OnlyOffice uses its first cell or implicit intersection; Grown's guarded functions answer `#VALUE!` or use the first cell inconsistently. → M5 |
| `ref-arg-semantics` | 32 | Function-level differences with referenced values (FACTDOUBLE(-1.5), legacy FLOOR signs, XIRR/XNPV validation, …) that show only now that names and cross-sheet refs resolve. → M2/M4 follow-up |
| `cell-format`, `cell-filename`, `cell-prefix` | 30 | CELL: the fixtures carry no number formats, and Grown workbooks have no file name |
| `ref-text` | 17 | OFFSET checks compare the reference's address text, not its value |
| `formulatext-quotes`, `invalid-formula-cell`, `sum-text-arg` | 13 | Suite quirks: `=SQRT("")` read back as `=SQRT(")`, and a one-argument TEXT cell that OnlyOffice cannot parse |
| `relative-names` | 3 | Names with relative references resolve from the using cell in OnlyOffice; Grown names are absolute |

Now possible but not done here: values carry their reference, so functions
can tell `SUM("10")` from a text cell (`direct-text-args`, 85 checks).
FormulaTrace's remaining six tests need the trace UI (M5).

## 10. M3 results (Wave 3, 2026-09-26)

M3a (distributions) and M3b (tests and descriptive statistics) are done.
All 155 `statisticalTests.js` tags are ported, and 151 of them pass. The
four FORECAST.ETS tags (M3c, optional) are pending as whole cases, because
Grown has no FORECAST.ETS functions yet.

### 10.1 What landed

| Piece | Where |
|---|---|
| Special functions: regularized incomplete gamma (series and continued fraction) and beta (Lentz continued fraction, symmetric branch), a Brent root finder. The prefactors x^a·e^−x/Γ(a) and x^a·y^b/B(a,b) are computed from Stirling's series for large shapes, so there is no cancellation of huge logarithms. The beta function takes 1 − x separately, so t and F tails stay exact. | `formula_stat_numerics.go` |
| Distributions, each in its Excel 2010 name and its legacy name: T (DIST, DIST.RT, DIST.2T, INV, INV.2T, TDIST, TINV), CHISQ / CHI, F, BETA, GAMMA, LOGNORM / LOGINV, WEIBULL, EXPON, POISSON, BINOM (plus DIST.RANGE, INV, CRITBINOM), HYPGEOM and NEGBINOM. Also GAMMA, GAMMALN(.PRECISE), FISHER and FISHERINV. Each maps over ranges inside ARRAYFORMULA. The inverses solve the smaller tail. | `formula_stat_dist.go` |
| T.TEST (paired, pooled, and Welch with fractional df), Z.TEST, F.TEST and CHISQ.TEST, with the legacy names TTEST, ZTEST, FTEST and CHITEST. Also CONFIDENCE.T, COVARIANCE.P/S, PROB, STEYX, PERMUTATIONA, VARA, VARPA and STDEVPA. | `formula_stat_tests.go` |
| LINEST, LOGEST, TREND and GROWTH rewritten. They now take several x variables, the `const` argument and the five-row `stats` output, and they drop collinear variables. The fit uses a centred modified Gram–Schmidt QR. | `formula_stat_regression.go` |
| Argument rules for the aggregates. Typed numeric text and typed booleans count, and other typed text is `#VALUE!`. Text, booleans and empty cells in references are skipped; the *A functions count text as 0. This applies to AVERAGE, MIN, MAX, COUNT, COUNTA, MEDIAN, MODE, STDEV/VAR, GEOMEAN, HARMEAN, AVEDEV, DEVSQ, SKEW, KURT, and the LARGE/SMALL/PERCENTILE/QUARTILE/TRIMMEAN families. | `formula_stat_args.go` |
| Fixes to existing functions. Empty cells no longer read as 0 in the statistical functions or in criteria. The k, percent and x arguments propagate errors. LARGE and SMALL round k up. The NORM family, GAUSS, PHI, STANDARDIZE and CONFIDENCE propagate errors and read TRUE/FALSE flags. NORM.S.INV keeps precision near 1. The paired functions (CORREL, RSQ, SLOPE, INTERCEPT, FORECAST) use deviations, so they neither overflow nor lose exact zeros. FREQUENCY ignores empty bins. | `formula_stat.go`, `formula_more.go`, `formula.go` (criteria) |
| Precision unit test, with reference values from a 60-digit evaluation | `formula_stat_dist_test.go` |
| Fixture | `testdata/parity/formula-statistical.json` |

Precision checks, against 60-digit references: `F.DIST` at F(10⁶, 10⁶)
and 10⁻¹⁵, the t tail with df = 10¹⁰, `CHIINV(1e-10, 1)`, and
`GAMMA.INV(1 − 1e-15, 1, 1)` all agree to 1e-12 relative or better. In
four such tail cases OnlyOffice's own answer is less precise (key
`oo-tail-precision`).

The facts were extracted with the M0 harness. The suite computes some
expected values with the engine's `Math.ln` and `Math.binomCoeff`, so the
harness now defines both.

### 10.2 Counts

| OnlyOffice file | Tags ported / passing | Checks | Passing | Pending (diff) | Skipped (tables/1904) | Pending (ETS cases) |
|---|---|---|---|---|---|---|
| `statisticalTests.js` | 155 / 151 | 6,330 | 5,829 | 178 | 181 | 142 |

Scoreboard `sheets/formulas`: 378 → 533 ported tags. One pending check in
`mathematicTests.js` now passes, and its marker was lifted.

### 10.3 Pending keys

| Key | Checks | Note |
|---|---|---|
| `mode-errors`, `mode-ties`, `array-result-padding` | 33 | MODE with no numbers or an undefined name: OnlyOffice gives `#VALUE!`, Grown gives `#N/A` / `#NAME?`. MODE breaks ties differently. MODE.MULT array-range padding. |
| `criteria-typed-input`, `criteria-semantics`, `criteria-range-type` | 60 | COUNTIF/COUNTIFS/AVERAGEIF. The suite types `' 123'`, `'$123'` and `'true'` into cells, which a typed-input converter would have to parse. Wildcards with `<>`, error and date-text criteria, array criteria, and non-reference ranges. |
| `kurt-error-code` | 12 | KURT: OnlyOffice gives `#NUM!` where Excel gives `#DIV/0!` |
| `single-element-array` | 11 | `{x}` evaluates as the scalar `x`. Keeping 1×1 array constants broke 11 checks in other suites, so that change was reverted. |
| `suite-state`, `suite-value` | 14 | Expected values that do not follow from the fixture cells, or that contradict Excel (`MEDIAN(-3.5,1.4,6.9,-4.5)` = 4.15) |
| `date-text-year`, `date-1900` | 10 | `"12/12"` without a year (the suite assumes 2025), and serials ≤ 60. → M6 |
| `single-cell-pairs`, `whole-column-errors`, `skew-edge`, `oo-quirk`, `percentrank-*`, `oo-inverse-limit`, `oo-tail-precision` | 29 | OnlyOffice-specific results; see the reasons in the fixture |
| `array-lifting`, `value-locale`, `frequency-bool`, `linest-collinear-stats` | 9 | → M5 / M6 |

Not done: FORECAST.ETS, FORECAST.ETS.CONFINT, FORECAST.ETS.SEASONALITY and
FORECAST.ETS.STAT (M3c, 142 checks).

## 11. M6 results (Wave 3, 2026-09-26)

M6 is done: a number-format engine renders format codes and reads typed
input, in TypeScript for the grid and in Go for TEXT() and computed cells,
both tested from the same fixtures.

### 11.1 What landed

| Piece | Where |
|---|---|
| Format-code renderer: General (11 characters, then `1.23457E+11`), `0 # ?`, grouping/scaling commas, `%`, scientific (engineering exponents, `\E` markers), fractions (convergents, fixed denominators), literals, `\x`, `"…"`, `_x`, `*x`, `@`, up to four sections, `[>100]` conditions, colours, dates, times, `[h] [mm] [ss]` elapsed, `.000` sub-seconds, month-vs-minute, `AM/PM`/`A/P`, `aaa`, localised names of General. Returns text runs (skip/fill marked) plus the section colour. | `web/app/src/pages/sheets/numberFormat.ts` (`formatRuns`, `formatValue`) |
| Typed-input parser: grouped numbers, decimals, `%` (prefix or suffix), currency symbols (prefix or suffix, `р.`), parenthesised and signed negatives, scientific, mixed and simple fractions (a date in General cells, a fraction in numeric cells), dates with month names, numeric dates, times incl. `55:34` elapsed and `AM/PM`, date-times; the 1900 leap-year bug; Date1904; culture separators. Picks the format the cell should get, keeping a compatible existing one. | `numberFormat.ts` (`parseInput`, `parseDatePDF`, `isValidDate` …) |
| Go port of both | `internal/sheets/numfmt.go` |
| TEXT() on the engine; DOLLAR/FIXED round on 15 digits; VALUE() and date-text arguments fall back to the typed-input parser (`"5-JUL"`, `"3/15/11"`, `"25:00"`, `"1 1/2"`, `"€5"`); the display text `m` of computed and spilled cells follows the cell's format (General otherwise) | `numfmt_cell.go`, `formula_text.go`, `formula_datetime.go` (`dtTextSerial`), `formula_refs.go` (`writeBack`) |
| Format ▸ Number: Automatic, Plain text, Number, Percent, Scientific, **Accounting**, **Financial**, Currency, Currency (rounded), Date, Time, Date time, **Duration**, **Fraction** (each with a live sample), and **Custom number format…** (code input, preview of the cell and samples, suggestions) | `SheetMenuBar.tsx`, `NumberFormatDialog.tsx`, `numberFormatActions.ts` |
| Typed input goes through `parseInput` (workbook `beforeUpdateCell`/`afterUpdateCell` hooks); numbers under a custom format get `m` from `numberFormat.ts` on load, on format change and on edit | `numberFormatActions.ts`, `normalize.ts`, `SheetEditor.tsx` |

### 11.2 Ports

The facts were extracted like Wave 0 (a local recording harness, not
committed): format code + value → text, and text (+ cell format, culture) →
value, format and kind. The shared fixtures are
`internal/sheets/testdata/numfmt/{format,parse}.json`; the Go runner is
`numfmt_test.go` and the vitest runner
`__parity__/numberFormat.parity.test.ts`. OnlyOffice's formatRecognition
matrix is one QUnit.test run once per cell format, so it is one tag.

| OnlyOffice file | Tags | Checks | Pending |
|---|---|---|---|
| `NumFormatParse.js` | 40 / 40 | 996 | 4 |
| `testsForFWB.html.js` | 13 / 13 | 210 | 9 |
| `CellFormatTests.js` | 4 / 4 | 32,277 | 3 |

Pending keys (all `oo-diff`, Grown follows Excel): `serial-zero` (OnlyOffice
shows serials below 1 as 1899-12-31 in upper-case codes), `question-mark`
(`?` printed as 0), `frac-placeholders` (`##.##0` drops a digit),
`fraction-sign`, `overflow-hash` (long results become `#`s), `elapsed-ampm`
(`[hh]` as a clock hour next to AM/PM).

### 11.3 Formula-suite effect

The 166 `number-format` checks from Wave 1: 30 now pass (TEXT codes, comma
runs, `aaa`, `mmmmm`, DOLLAR/FIXED precision, `FIXED(…,"abc")`), and the other
136 are re-keyed to what they really test: `number-format-locale` (109:
OnlyOffice runs them in fi/nl/es/ru/fr/de/it/sv/zh/el/hu/tr/pl/cs/ko with
localised format letters, day names and separators), `arraytotext-args` (23),
`sum-of-text-result` (2) and `fixed-decimals` (2). The date-text fallback
lifts 22 more checks (DAY/YEAR/DAYS/WEEKDAY/NETWORKDAYS/ACCRINT … on text
dates, INDIRECT of TEXT), of which 7 are re-pended as `current-year`: their
expected values were recorded in 2026 for date text without a year. Net: 52
formula checks move from pending to passing.

### 11.4 Found on the way (not fixed here)

- The grid moves its selection back to A1 shortly after opening a sheet, after
  every edit, and when the editor re-renders (for example when a dialog
  opens). This is on main too; the number-format dialog keeps its own copy of
  the selection, and the e2e waits for the jump.
- FortuneSheet 1.0.4 aligns every cell left (`ht` defaults to left), numbers
  included.
- The engine's `DATE(1900,2,29)` is 61, not 60 (the `date-1900` backlog); the
  renderer itself shows serial 60 as 29-Feb-1900.
- Locale-aware formatting (separators, localised codes and names) needs a
  workbook locale first; the parser and renderer take separators as a
  parameter so that can be added without new code paths.

E2e: `web/e2e/sheets-numfmt.spec.ts` checks a thirteen-format sheet cell by
cell through the grid's screen-reader text, typing six kinds of input, a
preset and the custom dialog, and the saved values and formats.


## 12. M8 results (Wave 3, 2026-09-26)

M8 is done: filters, conditional formatting and data validation have their
own rule models with Excel/OnlyOffice semantics, the editor paints and
enforces them, and all 100 OnlyOffice cases listed for M8 are ported and pass.

### 12.1 What landed

| Piece | Where |
|---|---|
| AutoFilter model: current-region detection, value checklists (blanks, date groups year → second), custom conditions (=, ≠, >, ≥, <, ≤, begins/ends/contains and negations, `?`/`*` wildcards) joined by AND/OR, top/bottom N items or %, above/below average, 30 relative date periods, fill/font colour. Hidden rows are recomputed from the criteria (header never hidden); sort by a column keeps the header. An Excel-API view (`setAutoFilter`/`apiFilters`) for the API suite. | `filterOps.ts` |
| Conditional formatting: cell value (8 operators, constants, references or formulas), text contains/not/begins/ends (literal or `=formula`), dates occurring (10 periods), blanks/errors, duplicate/unique, top/bottom N/%, above/below average (with ≥ and standard deviations), custom formula, 2- and 3-colour scales (min/max/number/percent/percentile/formula stops), data bars (auto/min/max stops, axis automatic/midpoint/none, direction, negative colour, border, gradient/solid, min/max length, bar only), 20 icon sets with ≥/> thresholds, reverse and icon only. Priority order with per-property precedence and stop-if-true; move up/down, first/last/explicit priority, clear from a range. | `cfOps.ts` |
| Formula rules are evaluated on the client, against the same cell values the grid paints (FortuneSheet's values, into which the Go engine's `/recalc` results are written back). The evaluator shifts relative references per cell from the rule's base cell and covers whole rows/columns, other sheets, named ranges, operators and ~70 functions (COUNTIF, SEARCH, ISERROR, AND/OR, dates, …); anything else is `#NAME?`, which never matches. | `sheetFormula.ts`, `cellValue.ts` |
| Data validation: any, whole number, decimal, list (items or a range/formula), date, time, text length, custom formula, checkbox; operators; ignore blank; input title/message; error alert stop/warning/information. Range algebra: add fails over existing validation, delete trims (splits) rules, modify carves the area out of every rule it touches and adds the new rule. "Circle invalid data". | `validationOps.ts`, `cellRange.ts` (`rectSubtract`) |
| Editor glue: models persist per sheet (`grownFilter`, `grownCF`, `grownDV`, `grownCircleInvalid`) through applyOp patches that are also sent to collaborators. FortuneSheet's own fields are derived: font-colour CF entries (`luckysheet_conditionformat_save`, marked `grownDerived`), per-cell `dataVerification` (dropdowns, checkboxes, hints), `filter_select`/`filter`/`rowhidden`. Fills, colour scales, data bars, icons and invalid-data circles are painted from the `beforeRenderCell`/`afterRenderCell` hooks; typed input is checked in `beforeUpdateCell` (stop rejects with a notice, warning asks, information tells). Older FortuneSheet-native rules, and rules made with FortuneSheet's toolbar dialogs, are converted into the models. | `sheetDataTools.ts`, `SheetEditor.tsx`, `SheetNotice.tsx` |
| UI: Data ▸ Filter by values or condition… (column, sort A→Z/Z→A, values/condition/top 10/average & dates/colour tabs, clear column, remove filter); the conditional formatting rules manager rebuilt on `cfOps` (all rule types, applies-to ranges, priority arrows, stop if true); the data validation dialog rebuilt on `validationOps` (apply-to range, all types, messages, alert style, circle invalid data); Data ▸ Circle invalid data; Format ▸ Icon set now adds an icon-set rule. | `FilterDialog.tsx`, `ConditionalFormatDialog.tsx`, `DataValidationDialog.tsx`, `SheetMenuBar.tsx` |

### 12.2 Ports

| OnlyOffice file | Tags ported / passing | Where |
|---|---|---|
| `autoFilterTests.js` | 39 / 39 | `__parity__/filter.parity.test.ts` |
| `api-auto-filter.js` | 16 / 16 | `__parity__/filter.parity.test.ts` |
| `conditionalFormattingTests.js` | 5 / 5 | `__parity__/condFormat.parity.test.ts` |
| `api-format-conditions.js` | 17 / 17 | `__parity__/condFormat.parity.test.ts` |
| `DataValidationTests.js` | 1 / 1 | `__parity__/validation.parity.test.ts` |
| `api-validation.js` | 22 / 22 | `__parity__/validation.parity.test.ts` |

Notes on the ports:

- The date filters' commented-out OnlyOffice assertions (the day after a
  week/month/quarter/year still visible) are checked the Excel way: hidden.
- "equals" on a filter matches the shown text, so `8/20/1994` matches a date
  cell and `34566` does not; "does not equal" also treats a numeric match as
  equal. Text operators only match text cells. This is what the suite records.
- OnlyOffice anchors a text rule's `=A1` to the active cell when the rule is
  created; Grown rules carry an explicit `base` (default: the range's
  top-left), and the port sets it where the suite relied on the selection.
- The API suites share one sheet between tests; the ports start each test
  from an empty model, so counts are absolute rather than relative.
- The Excel API classes themselves (ApiRange, ApiFormatCondition, …) are not
  modelled; the ports check the same properties on Grown's rule objects.

E2e: `web/e2e/sheets-data.spec.ts` adds a 3-colour scale, a data bar, a list
validation and a "greater than 50" filter through the menus, checks the saved
model and hidden rows, that an off-list value is rejected with a notice, and
after a reload that navigation skips the filtered rows and the rules are
still listed.

### 12.3 Not done / follow-ups

- Formula rules use the client evaluator; functions it lacks never match.
  Routing them through the Go engine (for example as extra cells in the
  `/recalc` workbook) would give full coverage at the cost of a round trip.
- CF number formats, bold/italic/underline and borders are stored but not
  painted (FortuneSheet has no hook for them).
- Remove duplicates and row/column grouping (listed under M8 in §5) are not
  done; neither has OnlyOffice tests in the M8 suites.
- Validation of formula input is checked by value only through "Circle invalid
  data" (the typed text is a formula, not its result).
- The selection jump to A1 (§11.4) also affects these dialogs; they take the
  range from an editable "Apply to range" field, and the e2e waits for it.


## 13. M7 results (Wave 4, 2026-09-26)

M7 is done: fill (drag handle, Ctrl+D/R, Fill ▸ Series), a multi-key sort
dialog, paste special and row/column/cell structure changes, each a pure
module with the OnlyOffice cases ported, wired into the editor and checked
end to end. 111 tags are ported and 104 pass.

### 13.1 What landed

| Piece | Where |
|---|---|
| Autofill: weekday and month names (full and short, case kept, trailing `.` or spaces), even/odd and reverse steps, "Item 1" counters, numbers (copy one, extend the trend of several), dates by day or the detected month/year step, formulas moved with their offset. Fill ▸ Series: rows/columns, linear, growth, date (day, weekday, month with month-end clamping, year), AutoFill, step, stop value (also below the start or with negative steps), trend (least squares / exponential fit). Fill edge for Ctrl+D/R and Fill up/left. | `autofill.ts` |
| Sort: stable, several keys, top-to-bottom or left-to-right, header row/column, case-sensitive option, Excel order (numbers, text, booleans, errors, blanks last), fill/font-colour keys, header detection. Formulas in moved rows keep their relative references. The OnlyOffice `SetSort` API semantics (key cells, defined names, out-of-range keys) are modelled for the API suite. | `sortOps.ts` |
| Paste special: all / formulas / values / formats, operations add/subtract/multiply/divide (a formula on either side becomes `=(a)+(b)`, text is left alone, `#DIV/0!`), skip blanks, transpose, and the block repeats over a selection that is a whole multiple of it. Formulas move by the paste offset. | `pasteSpecial.ts` |
| Formula references: `translateFormula` (relative parts move, `$` parts stay, off-sheet → `#REF!`); `shiftFormula` for insert/delete/move of rows and columns and insert/delete of cells with a shift (qualified refs only on their sheet, absolute refs shift too, deleted refs → `#REF!`, ranges shrink or grow); `applyStructureOp` for a whole workbook: cells, `config.merge`, row/column sizes and hidden flags, `grownCF`/`grownDV`/`grownFilter` ranges and their formulas, `_namedRanges`. | `formulaShift.ts` |
| Server side: the same in Go, sharing `testdata/structure/shift.json` with vitest, and `POST /api/v1/sheets/d/{id}/structure {"op": …}` (edit rights; applies the op, recomputes and saves, returns the workbook) | `internal/sheets/structure.go`, `internal/server/sheets_structure.go` |
| Delimited text parsing (qualifiers, doubled quotes, line breaks in fields, `\r\n`/`\r`), change case (lower, upper, toggle, capitalize words, sentence) across rich-text runs | `csvText.ts`, `textCase.ts` |
| Editor: Edit ▸ Paste special (values only Ctrl+Shift+V, format only, formula only, transposed, dialog), Edit ▸ Fill (down Ctrl+D, right Ctrl+R, up, left, Series… dialog), Edit ▸ Move (row up/down, column left/right), Edit ▸ Delete (rows/columns of the selection, cells shift up/left), Insert ▸ Cells (shift right/down), Format ▸ Change case, Data ▸ Advanced range sorting options… (multi-key dialog); Sort range/sheet A→Z/Z→A use the new sort. After a fill-handle drag Grown's autofill replaces FortuneSheet's (read from its `dropCellCache`). Row/column inserts and deletes, from the menus or FortuneSheet's own header menus (`insertRowCol`/`deleteRowCol` ops), rewrite every formula in the workbook from its pre-op text and shift the rule models and named ranges; move and cell shifts rewrite the affected sheets in one `updateSheet`. Each action is one undo step (`batchCallApis`). | `editActions.ts`, `FillSeriesDialog.tsx`, `SortDialog.tsx`, `PasteSpecialDialog.tsx`, `SheetMenuBar.tsx`, `SheetEditor.tsx`, `dataActions.ts` |

### 13.2 Ports

| OnlyOffice file | Tags ported / passing | Where |
|---|---|---|
| `SerialTests.js` | 19 / 18 | `__parity__/autofill.parity.test.ts` |
| `SheetStructureTests.js` (46 autofill, sortRangeTest, move/shift ×3, merge) | 51 / 49 | `__parity__/autofill.parity.test.ts`, `sort.parity.test.ts`, `structure.parity.test.ts` |
| `js-api/api-range.js` | 31 / 31 | `__parity__/sort.parity.test.ts` |
| `copy-paste-tests.js` | 9 / 5 | `__parity__/paste.parity.test.ts`, `csv.parity.test.ts` |
| `CellSettingsTests.js` | 1 / 1 | `__parity__/textCase.parity.test.ts` |

Skipped (ported, pending): SerialTests "Series with merged cells" (merges live
in the sheet config the pure functions don't see); SheetStructureTests
"Autofill - format Date, Date & Time and Time." (asserts OnlyOffice's own
floating-point time steps) and "Cells merge test" (merge value rules, not
structure); copy-paste "tables" (Grown has no Excel tables) and the three
`asc_PasteData` callback tests (OnlyOffice API plumbing; FortuneSheet owns the
clipboard paste). The "Shift/move cells after create a table" case is
modelled as a header cell inserted with a downward shift.

E2e: `web/e2e/sheets-structure.spec.ts` drags the fill handle over A1:D2
(weekdays by two, months, 1/3 → odd numbers, "Item n"), fills a formula down
with Ctrl+D, runs a growth series with a stop value from the dialog, sorts a
table by Group then Score descending with its formula column following, and
pastes values transposed and with Ctrl+Shift+V; a second test inserts and
deletes a row and checks formulas on both sheets, the named range and the CF
range; a third calls the structure API.

### 13.3 Not done / follow-ups

- The 18 DynamicArraysTests undo/redo and paste-collision cases need the M5
  spill work first; they are not ported here.
- A fill-handle drag is two undo steps (FortuneSheet's fill, then Grown's).
  FortuneSheet's post-drag fill-options menu still offers its own choices.
- Paste special uses the block last copied in this editor (Ctrl+C/Ctrl+X),
  not the system clipboard; pasting leaves the selection where it was
  (FortuneSheet's `setSelection` mutates its argument, which breaks when React
  replays the update on frozen state).
- Chart and pivot source ranges are not shifted by structure changes; partly
  overlapping CF/DV ranges and merges are left alone by cell shifts.
- The structure endpoint does not notify open editors (they see the change on
  reload); the editor itself applies structure changes locally and relays
  them as ordinary ops.
- CSV import (File ▸ Import) is M11; the parser is ready for it.


## 14. M11 results (Wave 5, 2026-09-26)

M11 is done: xlsx import and export with formats, rules, print setup and
protection; ods/xls/csv import and ods/csv export; a print settings model
rendered with CSS paged media plus a page-break preview on the grid; protected
sheets and ranges enforced in the editor and on the server; View ▸ Show
formulas/gridlines/headings, zoom and page breaks. All 11 OnlyOffice tags
listed for M11 are ported and pass, and the local corpus round-trips 36/36
files.

### 14.1 Library choice

The repo already had SheetJS CE 0.18.5 (Apache-2.0, the last npm release;
newer builds only ship from cdn.sheetjs.com) and JSZip 3.10 (MIT/GPLv3 dual,
used under MIT). SheetJS CE drops styles, conditional formats, validation,
panes, print setup and protection when it writes, and reads few of them. So
the .xlsx path is Grown's own reader and writer over JSZip + DOMParser, written
from ECMA-376 Part 1 §18 (about 2,700 lines). ExcelJS (MIT) was considered: it
covers most of this, but it adds roughly 1 MB (minified) to the bundle, has its own model to
map anyway, and can't express the Grown-specific parts (per-user protected
ranges, the cfOps rule set). SheetJS stays for the formats it reads well
(.ods, .xls, .xlsb, where it keeps values, formulas, number formats, merges,
sizes and names) and for .ods export.

### 14.2 What landed

| Piece | Where |
|---|---|
| OOXML helpers: escaping, DOM access by local name, A1/sqref, ARGB/theme+tint/indexed colours, width↔px and pt↔px, part paths and relationships | `xlsx/ooxml.ts` |
| Styles: built-in number formats 0–49, fonts/fills/borders/alignment/rotation/wrap/locking both ways, dxfs, `borderInfo` flattening (cell entries and border-all/outside/inside/horizontal/vertical/side/none ranges) | `xlsx/xlsxStyles.ts` |
| Rules: every cfOps rule type ↔ `conditionalFormatting` (cellIs, text rules with Excel's formulas, time periods, blanks/errors, duplicate/unique, top10, above average with std dev, expression, colour scales, data bars, 20 icon sets with gte/reverse/showValue); validationOps ↔ `dataValidations` (checkboxes export as a TRUE/FALSE list); filterOps ↔ `autoFilter` (value lists with date groups, custom and wildcard conditions, top 10, dynamic, sort state) | `xlsx/xlsxRules.ts` |
| Tables (ListObjects) read and written back as table parts, kept on the sheet as `grownTables` | `xlsx/xlsxTables.ts` |
| Writer: values, formulas (with `_xlfn.`/`_xlws.` prefixes, `fullCalcOnLoad`), rich text, merges, frozen panes, sizes, hidden rows/columns/sheets, tab colours, named ranges, CF, DV, autofilter + `_FilterDatabase`, tables, hyperlinks, comments (with the VML Excel needs), page setup, print area/titles, manual breaks, header/footer, sheet view options, `sheetProtection` + unlocked cells; Grown's per-user protected ranges ride in a namespaced `extLst` entry Excel ignores | `xlsx/xlsxWrite.ts` |
| Reader: the inverse, plus shared-formula expansion (via `translateFormula`), inline strings, `t="d"`, the 1904 date system, chart sheets skipped with a warning | `xlsx/xlsxRead.ts` |
| Import: kind detection, csv/tsv via `csvText.ts` (typed or as text), SheetJS for ods/xls/xlsb, and the merge modes (new spreadsheet, insert sheets with unique names and renamed references, replace spreadsheet, replace current sheet, append rows, replace at the selected cell) | `sheetImport.ts`, `ImportDialog.tsx` |
| Export: File ▸ Download xlsx uses the writer; ods keeps formulas, number formats, merges and widths | `export.ts` |
| Drive: "Open in Sheets" on an .xlsx/.xls/.ods/.csv imports it into a new spreadsheet | `EditorPlaceholder.tsx` |
| Print model: paper, orientation, margins (presets), scale or fit to N×M pages, print area, repeated rows/columns, gridlines, headings, centring, page order, header/footer codes, manual breaks with insert/remove/reset/move; pagination with Excel's rules (manual breaks ignored while fitting) | `printSettings.ts` |
| Print rendering: one `@page`-sized block per page, CSS zoom for the scale, repeated titles, merges clipped per page, borders, cell styles; the same document is the preview (pages drawn as paper on screen) and what is printed through a hidden iframe | `printRender.ts`, `PrintDialog.tsx` |
| Protection model and checks (cells, formats, structure, row/column sizing, moves), structure ops move/shrink/drop protected ranges | `protection.ts`, `formulaShift.ts` |
| Editor glue: typed input and paste refused on protected cells with a notice; relayed ops touching them are dropped and the cells restored; blocked row/column inserts/deletes undone; formulas painted when shown; page-break lines (dashed automatic, solid manual) and a grey outside-print-area wash; headings blanked through the header hooks | `viewTools.ts`, `SheetEditor.tsx`, `ProtectDialog.tsx`, `SheetMenuBar.tsx` |
| Server: `EnforceProtection` in `SaveSheet` undoes edits of protected cells (formula values recomputed by the engine are not edits), changes to protection items the caller may not manage, deleted protected sheets and size/merge changes on a locked sheet; `OpGuard` drops such ops in the collaboration hub; the structure endpoint refuses ops on sheets with cells the caller may not edit, and shifts `grownProtection` with the cells | `internal/sheets/protection.go`, `collab.go`, `service.go`, `structure.go`, `internal/server/server.go`, `sheets_structure.go` |

Who may edit protected cells: the spreadsheet owner, the user who set the
protection, and the users it lists (picked from the directory roster, the same
source as sharing). There is no password (Excel's hashes are not imported), and
no DB migration: the model lives in the workbook JSON.

### 14.3 Ports

| OnlyOffice file | Tags ported / passing | Where |
|---|---|---|
| `ProtectTests.js` | 1 / 1 | `__parity__/protect.parity.test.ts` |
| `UserProtectedRangesTest.js` | 4 / 4 | `__parity__/protect.parity.test.ts` |
| `PrintTests.js` | 4 / 4 | `__parity__/print.parity.test.ts` |
| `SheetViewTests.js` | 1 / 1 | `__parity__/view.parity.test.ts` |
| `open-oox-in-browser.js` | 1 / 1 | `__parity__/view.parity.test.ts` |

Notes:

- The suite has two tests titled "Test: change"; the second (range
  manipulation) is tagged `#Test: change (range manipulation)`.
- OnlyOffice appends a range whose deletion is undone at the end of its list;
  the manipulation checks look ranges up by name rather than position.
- PrintTests opens a binary sample workbook and compares OnlyOffice's pixel
  geometry. The ports rebuild a sheet of the same shape (19 × 58, A4
  landscape, 10 mm margins, fit to one page) and check the same behaviours
  with Grown's page counts: the fit scale, pages once scaling is off, manual
  breaks ignored while fitting, repeated titles, and the break editing
  sequence (insert/remove/reset/move with undo/redo) exactly.
- SheetViewTests' doubled column width is Grown's `viewColumnWidth`, used by
  print output; the grid keeps its widths while formulas are shown.
- open-oox-in-browser's table part is read and written back byte for byte
  (minus the `xr:uid` revision attributes, which Grown doesn't keep).

Other tests: `xlsx/xlsxRoundTrip.test.ts` (15: every feature built in code →
xlsx → read back), `m11.test.ts` (import modes, csv typing, print rendering,
op blocking), `printProtectShift.test.ts`; Go `protection_test.go` (cell
checks, save enforcement, item merging, deleted sheets, locked config, op
guard, structure, and a DB-backed `SaveSheet` test that skips without
`GROWN_TEST_DSN`).

### 14.4 Corpus (local only)

`xlsx/corpus.test.ts` walks `GROWN_CONVERSION_CORPUS` (CC2's pattern): each
file is imported, written to xlsx and read again, and the values, formulas,
number formats, merges, rule counts, hidden rows/columns and names must match.
For .xlsx the first read is also checked against SheetJS as an independent
oracle (every value and formula SheetJS sees). Result against
`research/onlyoffice/core`: **36/36 files (100 %)**: the 30
`AVSOfficeEWSEditorTest/TestFiles` spreadsheets (27 xlsx, 1 xls, 2 csv) and the
6 `OOXML/test/ExampleFiles/xls*` files. Chart sheets in three of them are
skipped with a warning. The 28 xlsx/xls files of the directory row and the six
`conversion.cpp` files carry `oo:core/…` tags (34, taking common/conversion
from 25 to 59 ported); the two CSVs are checked untagged. Run:

    GROWN_CONVERSION_CORPUS=/path/to/research/onlyoffice/core npx vitest run src/pages/sheets/xlsx/corpus.test.ts

E2e: `web/e2e/sheets-xlsx.spec.ts` imports an .xlsx written the way Excel
writes one (styles, currency and date formats, a merge with wrap and borders,
a frozen row, a cellIs rule, a list validation, a named range, a formula),
checks the saved model, exports it, checks the parts and re-imports it as a new
spreadsheet; a second test drives Show formulas (Ctrl+`), gridlines, zoom,
the print dialog (fit to page → 1 page, repeated rows, footer codes in the
preview), Insert ▸ Page break and a protected range.

### 14.5 Not done / follow-ups

- Charts, pivots, images and sparklines are not written to or read from xlsx
  (`chartEx-serialize` stays n/a); theme fonts, gradient fills and patterns
  are approximated by a colour; data-bar and icon-set `x14` extensions
  (negative colours, custom icons) are not read.
- Named sheet views (OnlyOffice `NamedSheetViews`) are not modelled; the
  M11 SheetViewTests case is show formulas only.
- An import that replaces the workbook reloads the editor locally; other open
  editors see it after a reload.
- Hidden headings leave blank header strips (FortuneSheet 1.0.4 mis-places
  its overlays with a zero-width header); FortuneSheet's own zoom control in
  the footer does not persist zoom on the sheet.
- Protection is enforced for org members saving through `SaveSheet` and for
  relayed ops. The client cannot tell which of its saved edits the server
  undid until it reloads. Toolbar formatting of protected cells is undone
  through the op check, not refused up front.
- Print uses the browser's print dialog; PDF export still goes through the
  HTML-table convert endpoint rather than the print renderer.


## 15. M9 results (Wave 5, 2026-09-26)

M9 is done: pivot tables are computed the way Excel lays them out and are
written onto the grid, like Excel and Google Sheets; GETPIVOTDATA reads them
in the Go engine. All 41 OnlyOffice cases listed for M9 are ported and pass.

### 15.1 What landed

| Piece | Where |
|---|---|
| Model: several row, column and page fields; data fields with all eleven summary functions (sum, count, average, max, min, product, count numbers, stdev/stdevp, var/varp), fifteen show-values-as kinds with base field/item, a number format (M6 codes) and a caption; per-field caption, subtotals (automatic, none or a list of functions), subtotals at top/bottom, compact/outline/tabular form, blank row after items, show items with no data, sort (by label or by a data field), item order kept across refreshes, item captions; label, value and top-10 filters applied in order (value filters per parent item, as Excel does); date (years…days), number (interval) and item grouping as extra fields; calculated fields (formulas over field sums) and calculated items (formulas over items, solved in order, per-cell formulas); layout, grand totals, headers, Values position, page wrap/order; captions for Row Labels, Column Labels, Values and Grand Total. `remapFields` follows columns by name when the source changes. | `pivotModel.ts`, `pivotCalc.ts` |
| Engine: page and field filters, item trees, lines per axis (headers, subtotals top/bottom, blank rows, grand totals, the Values pseudo-field anywhere in either axis), aggregation with Excel's blank/error rules, show-values-as, the report grid (page block, caption rows, row label columns per field form, classic drop-zone layout), GETPIVOTDATA entries, drill-down records, and per-cell field/rename metadata. | `pivotEngine.ts` |
| On the grid: a pivot has an anchor (a new sheet or a chosen cell); its report is written there and rewritten after every edit where cells differ (source edits refresh it; stray changes are put back). Typing into a pivot is refused, except over a caption or item label, which renames it. It never overwrites other data or protected cells (the M11 protection model): the write is refused with a notice. On the server the written cells are ordinary edits: `EnforceProtection` keeps them for the owner and the users a protected range lists, and the stored `output` (a first-sheet key) is never reverted (`TestPivotOutputUnderProtection`). Columns are widened to fit. The written report (`output`) is stored with the pivot. | `pivotGrid.ts`, `usePivotTools.tsx`, `SheetEditor.tsx` (hook + guard + refresh call) |
| UI: Insert ▸ Pivot table opens the editor (data range, insert to a new/existing sheet, rows, columns, values with function/show-as/format/name, filters, per-field order/sort-by/totals/group/filter, calculated fields and items, layout options, live preview). Pivots (n) lists them with edit, delete, refresh all, show details (click a value, or for the selected grid cell) and copy the GETPIVOTDATA formula for the selected cell. | `PivotDialog.tsx`, `PivotPanel.tsx`, `PivotTableView.tsx` |
| GETPIVOTDATA(data_field, pivot_table, [field, item]…): over `grownPivots[].output`; data field by caption or source field; pairs in any order; items by value, caption, date serial, group number, or `<`/`>` for a group's outer buckets; page fields; `#REF!` for a cell the report does not show, 0 for an empty one; and the older two-argument form `GETPIVOTDATA(pivot_table, "East Sum of Price")`. | `internal/sheets/formula_pivot.go` |

### 15.2 Ports

| OnlyOffice file | Tags ported / passing | Where |
|---|---|---|
| `PivotTests.js` | 23 / 23 | `__parity__/pivot.parity.test.ts` (291 recorded reports in `pivot.fixtures.json`) |
| `PivotTests2.js` | 18 / 18 | `__parity__/pivot2.parity.test.ts` (16), `internal/sheets/formula_pivot_test.go` (GETPIVOTDATA, TWO ARGS; also in vitest for the generated formula) |

Notes on the ports:

- PivotTests builds pivots through OnlyOffice's API; the ports describe the
  same pivots as Grown configs and compare the report text cell by cell. The
  undo/redo/XML round trips and style checks the suite runs around each step
  are OnlyOffice history plumbing and are not ported. The top-10 case runs
  disabled in OnlyOffice; its recorded report passes here.
- PivotTests2 opens xlsx workbooks. A local recording script (not committed)
  read their pivot definitions, caches and rendered cells into facts: each
  pivot as a Grown config, its source cells and Excel's report
  (`pivot2.fixtures.json`), and for GETPIVOTDATA each sheet's cells,
  formulas with Excel's results and the pivots' stored reports
  (`internal/sheets/testdata/pivot/getpivotdata.json`). All 38 pivots in
  those workbooks render as Excel rendered them. The fill/number-format flags
  the refresh cases compare come from OnlyOffice pivot styles, which Grown
  lacks; value-field formats are checked instead.
- Semantics taken from the recorded reports: value filters are evaluated per
  parent item and each axis is built from the records that pass that axis's
  filters (so a row item can show with blank values when a column filter
  removed its data); % running total's whole is the base field's total at its
  own level and the running end below it; `% of` shows `#NULL!` for an empty
  cell; a lone numeric item shows in its field's number format only when every
  value of the field is a number in that one format.
- GETPIVOTDATA formula generation: one pair (an item row whose subtotal is
  shown below it) is left out; Grown writes no entry for the empty cells of
  such rows.

E2e: `web/e2e/sheets-pivot.spec.ts` builds a pivot in the dialog (two row
fields, a column field, % of grand total) at Sheet1!H1, checks the written
cells, edits a source cell and checks the refreshed percentages, refreshes
from the panel, checks that typing into the pivot is refused, and evaluates
`GETPIVOTDATA` on the server.

### 15.3 Not done / follow-ups

- Pivot styles (banding, style gallery) and per-area pivot formats are not
  modelled; header rows get a light fill.
- Pivots are not written to or read from xlsx yet (M11 follow-up; the
  recording script's reader could become the importer).
- Collapsing items (+/- buttons) and the per-field "repeat item labels"
  option are not modelled.
- Pivot configs live on the first sheet (`grownPivots`) and reach other open
  editors on reload; the written cells reach them live as ops. Every editor
  refreshes pivots after edits, so two editors may write the same cells.
- Pivot source ranges are not shifted by row/column inserts (like charts, §13.3).
- A refresh that grows into other data is refused with a notice rather than
  asking to overwrite.

## 16. M10 results (Wave 6, 2026-09-26)

M10 is done: new chart types, trendlines, histograms, axis scaling, a chart
editor, charts anchored on the grid that move with row/column inserts, a
sparkline group dialog, and charts in xlsx. All 16 `ChartsDrawTest` tags are
ported and pass (with the differences noted below).

### 16.1 What landed

| Piece | Where |
|---|---|
| Trendlines: linear, logarithmic, power, exponential, polynomial (order 2–6, Householder QR so exact fits of degree 6 stay accurate), moving average over category slots (gaps allowed) or scatter points; fixed intercept (linear, exponential, polynomial); R² in the fit's linear space; equation and R² labels; forward/backward forecast; the drawn curve clipped to the value axis (on a log axis a line that dips to ≤ 0 stops at max(top/10³, 0.01) or the axis minimum) | `trendlines.ts` |
| Histogram: category aggregation (sum per label), Scott's-rule automatic bin width (two significant digits), bin width or count, overflow/underflow bins with the spreadsheet rules for when they apply, right- or left-closed bins, bin labels | `histogram.ts` |
| Axis scaling: 0-based unless the data sits above 5/6 of its max, 1/2/5 × 10ⁿ major units for about one tick per 44 px, 5 % headroom, fixed min/max/unit, log axes, `roundValue` | `chartAxis.ts` |
| Chart model: types column, bar, line, area, combo, scatter, pie, doughnut, histogram, waterfall; stacking none/stacked/100 %; series in rows; legend position; data labels (chart or series); axis title/min/max/unit/number format/log base (x, y, secondary y); per-series colour, combo kind, secondary axis, trendline; histogram options; waterfall totals; doughnut hole; `sheetId`; grid `anchor` (cell + offset + size). Series colours are the Office theme accents 1–6, then shaded (lumMod via `lib/colorMods.ts`). Every field is optional, so older charts load. | `chartData.ts` |
| Renderer: all types above in SVG; bars with a rounded data end, 2 px lines, gaps for blank cells, waterfall connectors and increase/decrease/total legend, histogram bins as categories, category labels thinned to fit, value labels through the M6 number formats, per-mark tooltips | `ChartRenderer.tsx` |
| Chart editor (insert and edit): type, stacking, data range (typed or "Use selection"), headers/labels/series in rows, histogram and waterfall options; title, legend, data labels, axes; per series colour, combo kind, secondary axis, labels, trendline (type, order, period, equation, R², intercept, forecast) with a live preview | `ChartDialog.tsx` |
| Charts on the grid: each anchored chart of the active sheet is drawn inside FortuneSheet's cell area (so it scrolls with the cells) at the pixel position of its anchor cell, computed like FortuneSheet's own layout (size + 1 px per row/column, zoom, hidden rows/columns); drag to move, corner to resize, double-click or pencil to edit, Delete to remove. The charts panel lists every chart and can place a chart on or take it off the grid. | `ChartOverlay.tsx`, `chartAnchor.ts`, `ChartsPanel.tsx` |
| Structure ops: row/column inserts, deletes and moves shift chart source ranges and anchors on the chart's sheet (a deleted anchor row/column parks the chart at the deletion); cell shifts move ranges only. Charts ride on sheet 0 in the live grid as well as in the saved JSON, so the editor's structure fix-up (and collaborators, through the relayed op) see them. Go twin for the structure endpoint. | `formulaShift.ts` (`shiftCharts`), `internal/sheets/structure.go` (`shiftChartList`), `SheetEditor.tsx` |
| Sparkline groups: Insert ▸ Sparklines writes one `SPARKLINE()` per data row (or column) into a location range, in a colour, and keeps the group on the sheet (`grownSparklines`, shifted by structure ops) to list or remove it | `SparklineDialog.tsx`, `sparklines.ts` |
| xlsx: a drawing part per sheet with a `oneCellAnchor` per chart and a `c:chartSpace` part per chart (bar/line/area/scatter/pie/doughnut groups; combo as two groups with a second value axis crossing at max; title, legend, data labels, axis scaling/title/number format, colours, trendlines). The full Grown definition rides in a `c:extLst` entry, so Grown round-trips exactly; other workbooks' charts are rebuilt from the chart XML (series references → range, header/label flags, orientation) and their one- or two-cell anchors. Checked by opening an export in LibreOffice. | `xlsx/xlsxCharts.ts`, `xlsxWrite.ts`, `xlsxRead.ts` |

### 16.2 Ports

| OnlyOffice file | Tags ported / passing | Where |
|---|---|---|
| `ChartsDrawTest.js` | 16 / 16 | `__parity__/charts.parity.test.ts` |
| `common/charts/chartEx-serialize.js` | 0 (n/a: Grown writes c:chart, not cx:chart) | — |

Notes (`oo-diff` in the file):

- "Base Charts Draw" compares OnlyOffice's path commands for 24 chart types;
  the port lays out the same 2 × 3 data (one blank cell) for every 2-D type
  Grown draws and checks categories, series, stacked totals and 100 %
  stacks. 3-D types are n/a.
- "Line Builder approximated bezier": OnlyOffice returns Bézier control
  points; the port checks where the drawn curve starts and ends for all 32
  cases (log-axis clipping included). "Line Builder boundaries" checks the
  curve's extent for the same cases.
- R² for exponential and power fits: Grown reports R² of ln y (the
  spreadsheet convention, equal to the squared correlation in the fit's
  space); OnlyOffice's expected values differ for four rows. With a fixed
  intercept Grown reports 1 − SSres/SStot of the line drawn; OnlyOffice
  reports the free fit's value. Coefficients match in every case.
- Two polynomial coefficients are written truncated in the suite (231822,
  275562); the least-squares values are 231822.5 and 275562.5.
- Histogram aggregation min: the value-axis minimum is the smallest single
  value, the maximum the largest sum (as the suite expects).

Other tests: `chartsM10.test.ts` (axis scaling, equation labels, layout,
waterfall, theme colours, structure shifts, anchor geometry),
`chartRender.test.tsx` (every type draws its marks; combo with a secondary
axis and trendline; legend and labels; sparkline formulas),
`xlsx/xlsxCharts.test.ts` (parts written, Grown round trip, charts rebuilt
without the Grown entry, series in rows); Go `structure_charts_test.go`.

E2e: `web/e2e/sheets-charts.spec.ts` inserts a combo chart (secondary-axis
line, linear trendline with equation and R²) from the dialog, checks it on
the grid, inserts a row above it (anchor row 0 → 1, range A1:C7 → A2:C8, the
box moves down one row), reloads, then deletes it with the Delete key; a
second test lays out four chart types for a screenshot.

### 16.3 Not done / follow-ups

- Bubble, radar, stock, 3-D, treemap, sunburst, funnel and box & whisker
  charts; error bars; per-point colours outside pie/doughnut; smoothed lines.
- Histogram and waterfall are exported as clustered columns (Excel writes
  them as `cx:chart` chartEx parts); Grown reads its own back exactly through
  the extension entry, and `chartEx-serialize` stays n/a.
- Charts on the grid are not drawn in frozen panes' fixed area, are not
  printed or exported to PDF, and don't resize with their cells (they are
  one-cell anchored; two-cell anchors are read as a size).
- Sparklines are still `SPARKLINE()`'s text glyphs; the group dialog does not
  draw pixel sparklines (that needs a cell-render hook).
- Moving or resizing a chart is saved like other chart edits (not a
  FortuneSheet undo step).

## 17. M5 results (Wave 7, 2026-09-27)

M5 is done: scalar functions lift over arrays and ranges, spills resize,
block and unblock correctly in the engine and in the editor (undo, paste and
fill included), cells can be traced with arrows, and Goal Seek runs on the
server engine. All 80 DynamicArraysTests tags, 13 of the 16 FormulaTrace tags,
2 more DependencyGraph tags and the 11 goal-seek tags are ported.

### 17.1 What landed

| Piece | Where |
|---|---|
| Lifting: an array or multi-cell range passed where a function takes one value runs the function per element and spills (math, trig, text, date, IS*, statistical transforms, the SUMIF/COUNTIF(S) criteria). Different sizes pad with #N/A. IF/IFERROR/IFNA lift only on an array condition. Analysis ToolPak functions take arrays, but a range meets the formula's row or column. `A:A` covers the sheet's rows, so `=SIN(A:A)` fills the column; a whole-column array anchored below row 1 is #SPILL!. FILTER checks its include flags (text TRUE/FALSE counts, other text is #VALUE!, errors pass through). Spilled cells keep booleans and errors. | `formula_lift.go`, `formula.go`, `formula_arrayformula.go`, `formula_logical.go`, `formula_array.go`, `formula_refs.go` |
| Spill state across saves: an array that grows, shrinks, is blocked or unblocked leaves the right cells (the `grownSpill` marker); `/recalc` reports each anchor's `spillRows`/`spillCols` | `formula_refs.go`, `recalc.go`, `spill_persist_test.go` |
| xlsx formula text: `@` ↔ `_xlfn.SINGLE()` (except a range in a one-value argument) and `_xlfn.` prefixes for newer functions | `formula_storage.go` |
| Editor: server values are applied with `applyOp`, so they are not undo steps (Ctrl+Z undoes the user's own edit, not a spill); spill output no array covers any more (deleted, shrunk or blocked) is cleared; the recalc also runs when only stale spill output is left. The typed-input reading is written the same way, so a typed value is one undo step. | `SheetEditor.tsx` (`applyServerValues`), `formulaRefs.ts` (`recalcWrites`), `numberFormatActions.ts`, `sheetDataTools.ts` (`writeCellsQuietly`) |
| Tracing: `traceSession` levels over the dependency graph, now with argument kinds: a multi-cell range passed alone where a function takes one value is drawn to the cell implicit intersection reads (unless the formula spills); whole columns/rows are labelled `A:A` / `3:3`. `GET /api/v1/sheets/d/{id}/deps?cell=B2&levels=N` (stored workbook) and `POST …/deps` (the editor's live workbook) return the arrows per level. | `formula_trace.go`, `internal/server/sheets_whatif.go` |
| Trace UI: Tools ▸ Trace precedents / Trace dependents (each click one more level from the active cell) / Remove arrows. Blue arrows with a dot at the source, a box around a source range, a dashed arrow to a sheet icon for another sheet; drawn in FortuneSheet's cell area like the charts, redrawn after edits. | `TraceOverlay.tsx`, `SheetEditor.tsx`, `SheetMenuBar.tsx` |
| Goal seek: Newton steps on a numeric slope (halved while they make things worse), falling back to an outward search from the start value until the target is bracketed, then safeguarded Newton/bisection; brackets that close on a jump (1/x at 0) are dropped and the search goes on; a found value is shortened to the fewest significant digits that are no worse (2000, not 1999.9999999998). Paused/stepped one attempt at a time for the suite. `POST /api/v1/sheets/d/{id}/goalseek` evaluates copies of the posted workbook (only what the formula needs); nothing is saved. | `goalseek.go`, `internal/server/sheets_whatif.go` |
| Goal seek UI: Data ▸ What-if analysis ▸ Goal seek… (set cell = active cell, to value, by changing cell); the status step shows the result, OK writes the value as an ordinary edit, Cancel leaves the sheet alone. Errors (a formula in the changing cell, a value in the set cell) are shown in the dialog. | `GoalSeekDialog.tsx` |
| Rich text kept: `ct.s` (the runs of a multi-line or rich-text cell) was dropped by every server save; the cell type keeps unknown fields now | `formula.go` (`FsCellType`) |

### 17.2 Ports

| OnlyOffice file | Tags | Where |
|---|---|---|
| `DynamicArraysTests.js` | 62 engine cases, all passing (1,270 of 1,290 checks; 20 pending: `bare-ref-info`, `single-element-array`, `self-ref-spill`) | `dynarray_parity_test.go`, `testdata/dynarray/dynamic-arrays.json` |
| `DynamicArraysTests.js` | the 18 edit / undo-redo / paste / fill / copy-sheet / array-entry cases, through the grid | `web/e2e/sheets-dynarray.spec.ts` |
| `FormulaTrace.js` | +7: Base dependents, Dependents, External dependencies, Base precedents, Precedents, Shared tests, Formulas tests (13 of 16; Tables and the two performance tests are n/a) | `formula_trace_m5_test.go` |
| `DependencyGraph.js` | +2: DependencyGraph generated (every pair of 3×3 listening boxes against every pair of changed boxes), BroadcastHelper generated (coverage sums through dependents queries) | `formula_trace_m5_test.go` |
| `whatIfAnalysisTests.js` | 11 goal-seek tags (PMT, S = v·t, arithmetic, financials, FV, LOOKUP, math, DEVSQ, BESSEL, Bug #65864, pause/resume/step); 234 checks, 9 pending | `goalseek_test.go`, `testdata/goalseek/goal-seek.json` |

Notes and differences (`oo-diff` in the fixtures and tests):

- The DynamicArraysTests UI cases also assert OnlyOffice's xlsx rich-value
  metadata (vm/cm indexes) for each state. Grown keeps no such metadata in the
  workbook; the ports check the states it encodes (expanded, #SPILL!,
  deleted). Paste uses the grid's own Ctrl+C / Ctrl+V; OnlyOffice's autofill
  is Ctrl+D (fill down) here; its three "clean" options are one clear here.
- "Array formula display with undo/redo": Ctrl+Shift+Enter enters
  `=ARRAYFORMULA(…)` (Google Sheets), not the legacy `{=…}` braces.
- FormulaTrace "Formulas tests": `=SIN(A:A)` spills in Grown, so its arrow
  goes to the column (OnlyOffice draws an implicit-intersection arrow);
  `=@SIN(A:A)` and `NPV(A:A;1)` draw to the same-row cell as OnlyOffice does.
- Goal seek finds a root in five cases where OnlyOffice gives up (PMT from a
  negative term, `a+b/c` across the pole, and LOOKUP's step function, where
  any input in [3, 4) works: Grown stops at 3.75, OnlyOffice at 3.45).
- The M0 extraction harness was not needed for the goal-seek and trace facts;
  a small local script read the goal-seek inputs and expected numbers.

### 17.3 Not done / follow-ups

- Rich-value metadata in xlsx: a dynamic array exported to xlsx is written as
  a normal formula (Excel opens it as an implicit-intersection formula).
- Solver (the other five whatIfAnalysis tests) stays a flagged exception.
- A trace follows edits by re-querying the server after each autosave; arrows
  are not drawn in frozen panes' fixed area and go only one sheet deep in the
  picture (other sheets show as an icon with the address in its tooltip).
- Legacy multi-cell CSE arrays (a selection filled by one array formula) are
  entered as one spilling `ARRAYFORMULA`.

## 18. M12 results (Wave 7, 2026-09-27)

M12 is done: the tested shortcut types are bound from one table, Help ▸
Keyboard shortcuts is generated from it, Insert ▸ Function opens a wizard with
categories, search, argument help and a live result, and cells carry threaded
comments. 23 shortcuts tags and 8 more SheetStructureTests tags are ported
(3 more are counted now that their tags are fixed).

### 18.1 What landed

| Piece | Where |
|---|---|
| Binding table (id, group, label, combos, grid/editor context) and matcher (physical keys, so Ctrl+Shift+1 matches; Ctrl = ⌘); one capture-phase handler in the editor that reads the live selection when a command runs (the focus cell comes from FortuneSheet's `afterSelectionChange`, since `getSelection()` has none). Ctrl/⌘+arrows while typing move the caret instead of FortuneSheet's grid selection. | `sheetShortcuts.ts`, `SheetEditor.tsx` |
| Bindings: Ctrl+Shift+1…6 and Ctrl+Shift+\` number formats; Ctrl+B/I/U (I and U were not bound), Ctrl+5 / Alt+Shift+5 strikethrough, Ctrl+. / Ctrl+, super/subscript, Ctrl+] / Ctrl+[ font size steps, Ctrl+\\ clear formatting; Ctrl+; / Ctrl+Shift+; date and time (a value in the grid, text in the editor); Alt+= AutoSum; F4 reference cycling in the formula editor; Ctrl+\` show formulas; F9 / Shift+F9 recalculate (server round trip); Shift+F3 insert function; Ctrl+PgUp/PgDn (and Ctrl+Shift+) sheets; Ctrl+K link; Ctrl+Alt+M comment; Shift+F11 sheet; Alt+F5 refresh pivots; Ctrl+/ shortcuts; Alt+↓ the cell's dropdown list; Shift+F10 the context menu; Backspace clears the active cell and edits it (Delete clears the selection); Shift+Enter / Tab / Shift+Tab save and move up / right / left; Ctrl+Enter enters into every selected cell (formulas moved relatively); Ctrl+Shift+Enter array entry; Ctrl+A the data region first, then the sheet (tables: rows, table, sheet). | `sheetShortcuts.ts`, `SheetEditor.tsx`, `selectAll.ts`, `cellScript.ts` (sub/superscript cells are painted from `beforeRenderCell`; FortuneSheet has no vertical alignment), `LinkDialog.tsx` |
| AutoSum: one cell opens the editor with `=SUM(<proposal>)` (the numbers above, else to the left, blanks between included, a SUM cell ends the run); a selection gets totals: a leading header is left out, an empty last cell/row/column takes the totals (with a corner total), otherwise the row below; a selection of empty cells copies its first proposal along; dates and numbers stored as text are not summed | `autoSum.ts` |
| Typed input: `+5+5`, `-A1`, `+SIN({1,2}` become formulas (a unary + before a number is dropped, open parentheses are closed); text with spaces stays text | `textFormula.ts`, `numberFormatActions.ts` |
| Help ▸ Keyboard shortcuts: grouped, searchable, ⌘/⌥/⇧ on a Mac, generated from the table | `SheetShortcutsDialog.tsx` |
| Insert ▸ Function (Shift+F3, also Help ▸ Function list): 509 functions (every name the Go engine registers, checked by a test) with category, signature, description and argument help in Grown's own words; category and search; one field per argument (repeating groups grow); live result evaluated by the server engine in the target cell; opened on a formula cell it shows that call's arguments | `functionCatalog.ts`, `functionArgs.ts`, `FunctionWizard.tsx` |
| Threaded comments: `grownComments` per sheet (threads with replies, edit/delete own comments, resolve/reopen); the red corner triangle; the thread card beside the selected cell; View ▸ Comments panel (by sheet, open/resolved, jump to cell); threads move with row/column inserts, deletes and moves (client and server); xlsx export writes a thread as the cell's note and import turns notes into threads. The model mirrors the Docs comment shape (author, body, replies, resolved), stored in the workbook rather than the Docs comments table. | `cellComments.ts`, `SheetComments.tsx`, `CellCommentsLayer.tsx`, `formulaShift.ts`, `internal/sheets/structure.go`, `xlsx/xlsxWrite.ts`, `xlsx/xlsxRead.ts` |

### 18.2 Ports

| OnlyOffice file | Tags ported / passing | Where |
|---|---|---|
| `shortcuts/shortcuts.js` | 23 / 23 (cell editor 10, table hotkeys 13); n/a: the 13 graphic-object tests, Opera's NumLock/ScrollLock, table (ListObject) info | `web/e2e/sheets-shortcuts.spec.ts`, `sheetShortcuts.test.ts` (F4) |
| `SheetStructureTests.js` | +8: Array of arguments check after calling the wizard for the function, autoCompleteFormula (127 checks, 8 pending), Text to formula tests, Unar operator removing tests, Assemble formulas test, Formulas calc test, All selection test, Array formula; the three move/shift tags now carry their inner titles (the scoreboard ends a tag at a quote, so they counted as one) | `__parity__/functionWizard.parity.test.ts`, `__parity__/autoSum.parity.test.ts`, `__parity__/textFormula.parity.test.ts` + `text_formula_test.go`, `__parity__/selectAll.parity.test.ts`, `web/e2e/sheets-analysis.spec.ts` |

Not ported (n/a): SheetStructureTests "Selection in formulas test"
(Ctrl-click range picking while a formula is edited is FortuneSheet's),
"Workbook dependencies tests" and the four "Table …" tests (structured table
references). Differences: Ctrl+Shift+1 is `#,##0.00` (Excel/Google) where
OnlyOffice uses `0.00`; font sizes step from FortuneSheet's default 10;
OnlyOffice's `-{1,2}` → `=-{-1,-2}` rewrite is not reproduced; AutoSum writes
totals in three places OnlyOffice leaves empty (see the fixture's PENDING).
The same copy-paste and change-case tags also had the quote problem and were
renamed.

E2e: `sheets-shortcuts.spec.ts` (24 tests), `sheets-dynarray.spec.ts` (18),
`sheets-analysis.spec.ts` (trace arrows with the deps API, goal seek, the
function wizard, a comment thread, links, Ctrl+A, typed formulas, array entry,
AutoSum over a selection). Screenshots: `sheets-m5-trace-arrows.png`,
`sheets-m12-function-wizard.png`, `sheets-m12-comment-thread.png`,
`sheets-m5-goal-seek.png` (written to `GROWN_SHOT_DIR`).

### 18.3 Not done / follow-ups

- Ctrl+Shift+F / Ctrl+Shift+P (font dialogs) are not bound; Grown has no
  font dialog.
- Superscript/subscript apply to the whole cell (FortuneSheet's editor has
  no per-run vertical alignment) and are not written to xlsx.
- Comments reach other open editors through the relayed op but are not
  mentioned in notifications; there are no @-mentions.
- The function catalog's descriptions are English only.
- Ctrl+Z inside the cell editor is the browser's own text undo (it groups a
  typing burst), not a per-character undo.


## 19. Parity sweep (Wave 10, 2026-09-27)

A sweep over the Sheets rows whose Portable count was above their Ported
count, plus the cheapest real-behaviour gaps among the pending formula
checks. Scoreboard (`npm run parity`), before → after:

| Area | Portable | Ported |
|---|---|---|
| `sheets/sort-filter` | 86 → 86 | 55 → **86** |
| `sheets/editing` | 93 → 92 | 85 → **88** |
| `sheets/formulas` | 667 → 635 | 633 → **634** |
| `sheets/shortcuts` | 38 → 24 | 23 → 23 |
| `sheets/utils` | 11 → 4 | 4 → 4 |

### 19.1 Tags that were ported but not counted

- `api-range.js` (31 SetSort cases) and SheetStructureTests `sortRangeTest`
  were ported in M7 but built their tags at runtime (`API + "…"`), which the
  scoreboard cannot see. They are literal now.
- The two SheetStructureTests "Days of week and months with spaces and ".""
  autofill tags ended at the quote and counted as one; they say `dot` now.
- textAndDataTests `T(123)` is ported (`T` of a number is empty text).

### 19.2 Behaviour fixed

| Gap | Fix | Where |
|---|---|---|
| Ctrl/⌘+click while pointing at cells in a formula replaced the last reference | It adds another one (`=SUM(A1,B1)`), as in Excel; a plain click still replaces. Ports SheetStructureTests "Selection in formulas test" (e2e). | `SheetEditor.tsx`, `sheetShortcuts.ts` (`addsReferenceOnCtrlClick`), `web/e2e/sheets-analysis.spec.ts` |
| AND/OR/XOR/NOT coerced any text | Text and blanks in references/arrays are skipped; typed `"TRUE"`/`"FALSE"` count, other typed text is `#VALUE!`; no logical value at all is `#VALUE!` | `formula_logical.go` (`lgLogicals`) |
| SWITCH matched across types (`TRUE` = 1, 1 = `"1"`) | Typed equality; an empty cell equals 0, `""` and FALSE | `formula_logical.go` (`lgEqual`) |
| SUM/SUMSQ/PRODUCT counted booleans from ranges and arrays, ignored bad typed text | They read arguments like AVERAGE (formula_stat_args.go); PRODUCT skips an empty argument | `formula.go`, `formula_math.go` |
| An error typed as a scalar argument became `#VALUE!` (CHOOSE, DROP, TAKE, EXPAND, INDEX, SORTBY, FILTER, BASE, DECIMAL, ARABIC, MDETERM, MUNIT, SEQUENCE, RANDARRAY, SERIESSUM, NPV, XNPV, XIRR, MIRR, FVSCHEDULE, D* field/criteria) | The error is the result | `formula_validate.go` (`guardErrorArgs`) |
| XLOOKUP/XMATCH: `,,` for if_not_found answered 0; TRUE matched 1; errors in the lookup array were returned; bad modes, 2-D lookup arrays and short return arrays were accepted; a multi-column return array gave one cell | One finder (`xlFind`) with Excel's rules; XLOOKUP returns the whole row/column | `formula_lookup.go` |
| Empty optional arguments read as 0 | INDEX row/column (whole column/row of an array), ADDRESS sheet name, TAKE/DROP/EXPAND counts, the pad of EXPAND/WRAPROWS/WRAPCOLS/TEXTSPLIT take their defaults | `formula_lookup.go`, `formula_array_shape.go` |

290 pending checks in `testdata/parity/*.json` now pass and lost their
markers (`error-args`, `logical-text`, `switch-types`, `direct-text-args`,
`sum-of-text-result`, `bool-in-array`, `omitted-arg`, most XLOOKUP/XMATCH
`lookup-approx`): 2,063 → 1,780 pending. Seven checks became pending, each a
documented OnlyOffice-vs-Excel difference:

- `oo-diff/xor-range` (2): OnlyOffice's XOR over `A101:A103` (5, 6, text) is
  TRUE; Excel's odd-count rule gives FALSE (two TRUE values, text skipped).
- `oo-diff/binary-unsorted` (5): XMATCH search_mode ±2 over unsorted data
  holding an error. Excel leaves a binary search over unsorted data
  undefined; Grown searches linearly in the same direction, OnlyOffice's
  bisection finds nothing. They passed before only because Grown returned
  the error cell.

Left alone as documented choices: MODE ties (Grown = Excel's first mode),
legacy PERCENTRANK interpolation, `FIXED` decimals, `SQRT()` argument count
(`#N/A`, not a parse error), OnlyOffice's boolean passthrough in text
functions, the 1900 date quirk.

### 19.3 Rows reclassified (not applicable)

A portable row can now declare its not-applicable cases in the portability
note (`go (27) + n/a (20 …)`); the scoreboard leaves them out of Portable
(README "Manifest CSVs"). The notes were corrected to the real counts:

| File | n/a cases | Why |
|---|---|---|
| `FormulaTests.js` | 20 (was 19) | 14 custom-function + 3 custom async-function tests (plugin API) and 3 async-formula tests |
| `whatIfAnalysisTests.js` | 5 (was 6) | Solver (flagged exception); the file has 16 live tests, 11 goal seek |
| `FormulaTrace.js` | 2 (was 4) | the two performance timings; "Tables tests" stays portable (it needs Excel tables) |
| `DependencyGraph.js` | 5 (was 4) | BroadcastHelper simple/sparse/Insert Delete/curElems/curElems next: the sweep-line helper's internal state |
| `SheetStructureTests.js` | 1 | "Workbook dependencies tests": listener counts of the dependency graph |
| `shortcuts.js` | 14 | 12 graphic-object tests, slicer, Opera NumLock/ScrollLock (unchanged; now counted) |
| `tests.js` | 7 | `Asc` typeOf/lastIndexOf/search/floor/ceil, HandlersList, startListeningRange (unchanged; now counted) |

The docs `shortcuts.js` note lost its stale `6 n/a` (those cases were
ported later).

### 19.4 What is left

Every remaining portable Sheets gap needs Excel tables (ListObjects with
structured references), which Grown only round-trips through xlsx
(`xlsxTables.ts`, no UI, no `Table1[Col]` in the engine):
SheetStructureTests "Table selection for formula", "Table values/values
for edit tests", "Table special characters tests", "Table column names
changes tests"; FormulaTrace "Tables tests"; shortcuts "Change format table
info". That is a feature of its own, not a sweep item. *Done in Wave 11 (§20).*


## 20. Excel tables (Wave 11, 2026-09-27)

Tables (ListObjects) are a model, an engine feature and an editor feature
now. All six table-blocked tags of §19.4 are ported and pass, and so is the
copy-paste "tables" case M7 had skipped.

### 20.1 What landed

| Piece | Where |
|---|---|
| Model: per sheet `grownTables` (the TableModel the xlsx reader/writer already used): name, range, header row, totals row, columns with names, a totals function (or label, or custom formula) and a calculated-column formula, style name plus banded rows/columns and first/last column, filter button. Operations: create (current region from one cell, "My table has headers" guessed; without headers a header row of Column1… is inserted above, shifting the range down), unique names (TableN) and Excel's name rules, total row on/off (Total label, SUBTOTAL 109 in the last column, a count for text; the row below is shifted down when occupied), per-column totals functions (SUBTOTAL 101–110), header edits rename columns (unique, blank → ColumnN), resize (header row fixed), auto-expand when typing directly below (no totals row) or right, calculated columns (a formula in one data cell fills an empty column, or replaces the column's formula; typing a value ends it), convert to range (references become A1, the style stays as formatting), delete, paste copies of whole tables. The style palette for the 60 built-in TableStyle names is derived from the Office theme colours. | `tables.ts` |
| Structured-reference text: tokenizer (quote escapes), parser with Excel's specifier rules (one of #All/#Data/#Headers/#Totals/#This Row, or #Headers+#Data, #Data+#Totals), the edit form (`[@Col]`, `[@]`) and the saved form (`Table1[[#This Row],[Col]]`), table/column renames, #REF! for removed columns/tables, the reference a selection inside a table stands for, and conversion to A1 | `structuredRefs.ts` |
| Go engine: tables load from `grownTables`; `Table1[Col]`, `Table1[[#Headers],[Col]]`, `[@Col]`, `Table1[#All]/[#Data]/[#Totals]/[#This Row]`, `Table1[[C1]:[C3]]`, the bare table name, `Sheet1!Table1[..]` and the unqualified forms inside a table resolve to ordinary areas, so every reference-aware function, the dependency graph (with the formula's own row for `@`) and trace arrows see them. Unknown table/column or a bad specifier is `#NAME?`, #This Row outside the data rows `#VALUE!`, a missing header/totals row `#REF!`. | `internal/sheets/formula_tables.go`, `formula.go`, `formula_deps.go`, `formula_trace.go` |
| SUBTOTAL skips rows a filter hid (1–11 and 101–111), rows hidden by hand (101–111) and nested SUBTOTAL/AGGREGATE cells, so a filtered table's total row follows the filter | `formula_aggregate.go`, `formula_refs.go` (`loadHiddenRows`) |
| Structure ops (M7), client and server: a table's range moves with its cells; a column inserted inside becomes ColumnN (written into the header), a deleted column goes and references to it become #REF!, a moved column keeps its name; a table whose header row or every data row is deleted goes (references → #REF!). Shared fixture cases in `testdata/structure/shift.json`. | `formulaShift.ts` (`shiftTableList`), `internal/sheets/structure_tables.go`, `editActions.ts` |
| xlsx: cell, calculated-column and custom totals formulas are written in the saved form and read back in the edit form (own table name dropped inside a table, as Excel shows it); styles, totals, calculatedColumnFormula round-trip | `xlsx/xlsxTables.ts`, `xlsxRead.ts`, `xlsxWrite.ts` |
| Editor: Insert ▸ Table (Ctrl+L; Ctrl+T where the browser lets it through) and Format ▸ Format as table with the style gallery; Data ▸ Table properties (rename, resize, total row and per-column totals, banded rows/columns, first/last column, filter button, style, convert to range, delete); Ctrl+Shift+R toggles the total row; edits follow the table (afterUpdateCell); typed references take the edit form. The style is painted from the M8 render hooks, under conditional formatting (cell fills win). The header filter buttons are the M8 filter model (`grownFilter.table`) and open Grown's filter dialog for their column. The name box shows the table's name when its data (or all of it) is selected and lists tables and named ranges; the name manager lists tables. | `tableTools.ts`, `TableDialogs.tsx`, `TableNameBox.tsx`, `SheetEditor.tsx`, `SheetMenuBar.tsx`, `NamedRangesDialog.tsx`, `sheetShortcuts.ts` |

### 20.2 Ports

| OnlyOffice file | Tags | Where |
|---|---|---|
| `SheetStructureTests.js` | +4: Table selection for formula, Table values/values for edit tests, Table special characters tests, Table column names changes tests (text side in vitest, values in Go, same tags) | `__parity__/tables.parity.test.ts`, `internal/sheets/formula_tables_test.go` |
| `FormulaTrace.js` | +1: Tables tests | `formula_tables_test.go` |
| `shortcuts/shortcuts.js` | +1: Change format table info (Ctrl+Shift+R) | `web/e2e/sheets-tables.spec.ts` |
| `copy-paste-tests.js` | tables (was skipped) | `__parity__/paste.parity.test.ts` |

OnlyOffice labels its total row "Summary"; Grown writes Excel's "Total"
(the Go port sets OnlyOffice's label as a fact). OnlyOffice's plain
`=Table1` in a single cell is a pre-dynamic-array formula read by implicit
intersection; the trace port writes it `=@Table1`, since `=Table1` spills
in Grown (Excel 365).

The formula suites' 711 `Table1[…]` checks, skipped since M0, now run: the
fixtures record the Table1 range each check ran against (`"tables"`) and
the table cells the suite typed (a local extraction step, not committed).
690 pass; 21 carry existing oo-diff keys (`date-1900`,
`direct-text-args`, `single-cell-pairs`, `num-vs-value-error`,
`range-as-scalar`, `dynarray-validation`, `ref-text`, `validation`,
`suite-state`).

Scoreboard: `sheets/editing` 88 → 92 (of 92 portable), `sheets/formulas`
634 → 635, `sheets/shortcuts` 23 → 24 (of 24).

Tests: Go `formula_tables_test.go` (parser, tokenizer, evaluation, calculated
columns in dependency order, SUBTOTAL and hidden rows, the ports), the
structure fixture; vitest `tables.test.ts`, `tables.parity.test.ts`, the xlsx
round trip. E2e `web/e2e/sheets-tables.spec.ts` (4): the full editor flow
(insert with the gallery, grow right and down, calculated column, total
row, server values of structured references, Ctrl+A → name box, column and
table renames followed by formulas, banded columns, name manager), the
OnlyOffice shortcut case, a header filter button, and the engine and a
column delete through the JSON API.

### 20.3 Not done / follow-ups

- Pointing at cells while typing a formula still inserts A1 text;
  `tableSelectionString` (ported and tested) is not yet wired into
  FortuneSheet's range picking. FortuneSheet's function autocomplete also
  reacts inside brackets (typing `[@Price` offers PRICE).
- One filter per sheet (FortuneSheet has one `filter_select`): the first
  table with a filter button owns the header buttons; a plain sheet filter
  keeps them.
- Pasting a copied table into the grid does not yet create the copy
  (`pasteTables` is the model side); FortuneSheet owns the clipboard paste.
- Table styles are approximations of Office's built-in ones; custom table
  styles (`tableStyles` in styles.xml) are not read. A dark style's body text
  colour is painted by Grown, other data cells keep FortuneSheet's text.
- The client-side CF formula evaluator (`sheetFormula.ts`) does not know
  structured references (they never match in a CF formula rule).
- Pivot sources are ranges; a table name as a pivot source is not offered.
