# OnlyOffice parity — cross-cutting plan (PDF, Forms, Visio, common, conversion, harness)

Status: planning (2026-09-26). CC0 (scoreboard) and CC1 (shared unit ports, see §5) have landed.
Baselined against `origin/main` **c90064e** (includes the merged PDF-editor overhaul PR #32 at 4850ecf and docs import via pandoc, c3e38aa / dac2186).
Editor-specific plans live in [docs.md](docs.md), [sheets.md](sheets.md), [slides.md](slides.md);
this file covers everything that is not one editor.

**Ground rule (from the user):** this plan is *additive*. It fills gaps on top of
Grown's current PDF / Forms / whiteboard / conversion architecture. It does not
propose rewrites. Where parity genuinely cannot be reached without a large
refactor, the item is a **flagged exception** with a justification, not a plan.

**License rule:** OnlyOffice is AGPL-3.0, Grown is MIT. Nothing under
`research/onlyoffice/` (gitignored) is ever copied into the tracked tree — not
code, not test files, not fixture documents. We read their tests to learn
*behaviour* (inputs → expected outputs) and write new tests in Grown's own
vitest / Playwright / `go test` harnesses.

---

## 1. What OnlyOffice has in this scope (reference inventory)

All paths relative to `research/onlyoffice/`. Counts were produced by grepping
the files (`QUnit.test(` for test cases, `assert.` for assertions).

### 1.1 PDF editor

| Piece | Where | Size | Notes |
|---|---|---|---|
| Engine | `sdkjs/pdf/src` | 67 JS files, ~107.8k lines | `annotations/` (14: circle, freeText, highlights, ink, line, link, polygon, polyLine, square, stamp, text + 9 stamp locales), `forms/` (11: text, checkbox, radio, combobox, listbox, pushbutton, signature, `formActions.js` = JavaScript field actions), `drawings/`, `engine/`, `history/`, `CollaborativeEditing.js`, `pdfSearch.js`, `thumbnails.js`, `previews.js` |
| UI | `web-apps/apps/pdfeditor` | 91 JS files | Tabs: Toolbar, FormsTab, InsTab, RedactTab, ViewTab; views for Chart/Image/Shape/Table/TextArt settings, FormSettings, PageThumbnails, Navigation, Print, Search |
| Toolbar surface | `…/view/Toolbar.js` | — | Annotate (text comment, callout, arrow/circle/rect/connected-lines, highlight/underline/strikeout, ink, stamp), *Edit text* of existing PDF content, page ops (rotate/delete/add), forms (prev/next/submit/save form), shape align/arrange/merge, columns, line spacing, RTL/LTR, co-auth save |
| Engine markers (files matching) | `sdkjs/pdf/src` | — | Redact 20, Encrypt/Password 10, Print 11, Thumbnail 9, CollaborativeEditing 7, Rotate 7, Search 5, convert(→docx) 16 |
| Tests | `sdkjs-tests-v9.3.1/tests/pdf` | `common/common.js` (harness, 0 tests) + `forms/actions.js`: **1 QUnit.test, 9 asserts** | The one test is a *calculate-action chain*: three text fields with JS `Calculate` triggers that increment each other; typing in field 2 must propagate to 1 and 3 in document order |
| In-tree manual harness | `sdkjs/pdf/test` | `base.js` (284 lines), `bookmarks.js` (94) + `index.html` | Browser viewer harness (tree/trackbar vendor libs); **0 automated tests** |

### 1.2 Forms (oform)

| Piece | Where | Size | Notes |
|---|---|---|---|
| Engine | `sdkjs-forms/` | 22 files | `oform/format/{Document,FieldMaster,FieldGroup,User,UserMaster}.js` + `changes/` (co-editing change classes), `oform/xml/` (XmlPackage/XmlContext), `Role.js`, `apiBuilder.js`, `apiPlugins.js`. Concepts: **roles** (UserMaster: role name + colour), **field groups** with weight, **field masters** bound to Word content controls |
| Tests (oform level) | `tests/oform/xml/oformXml.js` | **2 QUnit.test, 7 asserts, 5 sub-cases** | XML round-trip of `UserMaster` (empty / role / colour) and `FieldGroup` (weight, users, fields) |
| Tests (Word forms) | `tests/word/forms/forms.js` + `complexForm.js` | **13 QUnit.test, 185 asserts** | Text-form formats (digits/letters/mask/regex), GetAllForms, remove/delete in editing mode, required-forms check, mask correction, GetAllFormsData/SetAllFormsData, cursor positioning, fixed↔inline conversion, sub-forms in a complex form, mouse clicks, "all required filled", form→JSON |
| Tests (Word JS API forms) | `tests/word/js-api/api-text-form.js` | **5 QUnit.test, 19 asserts** | Builder-API text-form props |
| Runner entry | `tests/runAll.js` | — | `word/forms/forms.html`, `word/forms/complexForm.html`, `oform/xml/oformXml.html`, `word/js-api/js-api-forms.html` |

### 1.3 Visio / diagrams

| Piece | Where | Size | Notes |
|---|---|---|---|
| Engine | `sdkjs/visio` | 12 files, 21.9k lines | **View-only** `.vsdx`: `model/SerializeReader.js` (3.5k) / `SerializeWriter.js` (1.5k), `VisioDocument.js`, `ooxmlApi/convertFunctions.js` + `get-geometry-from-class.js` (Visio ShapeSheet → DrawingML geometry), `Drawing/HtmlPage.js` (5k, renderer) |
| Tests | `tests/visio` | 8 JS files | `serialize/sax-serialize.js`: **7 QUnit.test, 12 asserts** (open-from-zip, save-to-zip, compare part count, Altova-generated XML string compare, real-file XML compare) + **5 file round-trip tests** (`Example vsdx`, `Basic ShapesA_start`, `generatedVsdx2schema`, `Timeline_diagram_start`, `rows_test`) which each expand into per-part QUnit tests at runtime; `serialize/sax-serialize-files.js` embeds **13 base64 fixtures**, `api/test-files.js` embeds **14** (rectangle, triangle, circle, elliptical-arc variants, size & position); `draw-main`, `drawFile`, `api/api-test` are drag-and-drop **manual** browser harnesses (0 automated tests) |

### 1.4 Shared engine pieces (`sdkjs/common`, 174 JS files)

| Area | Files / lines | What it is | Tests |
|---|---|---|---|
| Fonts / shaping | `libfont/` 20 files, 26.4k lines (FreeType + HarfBuzz wasm, `hyphen`, `grapheme`, `glyphstring`) | Text shaping, hyphenation, font loading | `sdkjs/common/libfont/test/{shaper,hyphen}.js` — **manual harness, 0 QUnit** |
| Geometry | `geometry/geometry.js` (211) + `Drawings/` 45 files, 157.7k lines (Format/Geometry, Path, path-boolean, GroupShape, ChartSpace, ChartEx, OleObject, TextBody) | DrawingML shapes, preset geometry, boolean ops | `sdkjs/common/geometry/test/code.js` — manual, 0 QUnit |
| Charts | `Charts/` 6 files, 31.8k lines; `SerializeChart.js` 15k | Chart model + binary serialisation, ChartEx (waterfall/funnel/treemap…) | `tests/common/charts/chartEx-serialize.js`: **6 QUnit.test, 11 asserts** + dynamic per-XML-part tests over **3 embedded fixtures** |
| Colour mods | `Drawings/` (colour transforms) | DrawingML `lumMod/lumOff/satMod/tint/shade/gamma/hue…` | `tests/common/color-mods/color-mods.js`: **28 QUnit.test** covering 26 mod types + 2 combined; **137 data cases** (86 `test(rgb…)` lines + per-mod tables); 20.3k lines |
| Editor API base | `apiBase.js`, `api/` 9 files | `asc_getUrlType` (Http/Email/Unsafe/Invalid), macros (`asc_setMacros/getMacros/runMacros/runAutostartMacroses`) | `tests/common/api/api.js`: **2 QUnit.test** (browser + desktop), **75 URL classification cases** |
| Spellcheck | `spell/` 3 files, 1.4k; `spellcheckapi.js` 301 | Hunspell-wasm bridge, per-run language | none |
| Collaboration | `collaboration/` (679), `CollaborativeEditingBase.js` (1.5k), `collaborativeHistory.js` (1k), `docscoapi.js` (2k), `versionHistory.js` (168) | OT-style change lists, locks, co-auth chat, version history | none in `tests/` (covered indirectly by word/cell tests) |
| Plugins / macros | `plugins.js` (2.2k), `apiBase_plugins.js` (2.5k), `plugins/plugin_base*.js`, `macros.js` (596), `macro-recorder.js` (2.6k), `base-plugin-events.js`; UI `web-apps/…/controller/Plugins.js` (1.4k) | **55 `pluginMethod_*`** (AddContextMenuItem, AddToolbarMenuItem, AddOleObject, ConvertDocument, GetSelectedText, PasteHtml, InputText, ShowWindow, InstallPlugin, AI…) and 7 base events (`onClick`, `onDocumentContentReady`, `onTargetPositionChanged`…) | `tests/word/plugins/pluginsApi.js`: **5 QUnit.test, 53 asserts** |
| Number formats | `NumFormat.js` 10.4k | Excel format parser | (sheets plan) |
| Clipboard | `clipboard_base.js` 1.9k, `wordcopypaste.js` 14.6k | HTML/OOXML clipboard | (docs plan) |

### 1.5 File conversion (`core/`, C++)

| Piece | Where | Notes |
|---|---|---|
| Converter driver | `X2tConverter/src` (`ASCConverters.cpp`, `main.cpp`) | XML task file (`m_sFileFrom/To`, `m_nFormatFrom/To`, csv options, fonts dir, thumbnails). **118** `AVS_OFFICESTUDIO_FILE_*` format constants in `Common/OfficeFileFormats.h` |
| Format libs | `OOXML/`, `OdfFile/`, `MsBinaryFile/`, `RtfFile/`, `PdfFile/`, `DocxRenderer/` (pdf→docx), `EpubFile/`, `Fb2File/`, `HtmlFile2/`, `XpsFile/`, `DjVuFile/`, `HwpFile/`, `OFDFile/`, `TxtFile/` | Everything goes through an internal binary editor format (doct/xlst/pptt) |
| Test harnesses | `X2tConverter/test/{qmake,TestOOOXml2Odf,win32Test}`, `Test/Applications/StandardTester` (batch x2t round-trip tester), `OOXML/test/{xlsx2xlsb,xlsb2xlsx}/conversion.cpp`, `OdfFile/Test/test_odf/{entrance,motion,audio,interactions,columns}.cpp` | C++ / Qt; all AGPL, not runnable by us without building core |
| Fixture documents (**86** office files) | 34 xlsx, 11 epub, 10 fb2, 8 pptx, 6 xlsb, 6 odp, 4 docx, 3 pdf, 3 odt, 3 doc, 2 xlsm, 1 xls, 1 ppt | Locations: `Test/Applications/AVSOfficeEWSEditorTest/…/TestFiles` (28), `OdfFile/Test/test_odf/ExampleFiles` (13, odp↔pptx animation pairs), `EpubFile/test/Files` (11), `Fb2File/examples` (10), `OdfFile/Test/Test/ExampleFiles` (5), `OOXML/test/ExampleFiles/{xlsx2xlsb,xlsb2xlsx}` (12), number-format locale samples (3) |

### 1.6 Code style

`tests/code-style/check.py` — 4 checks over every `.js`: license header present, Latvian address present, no CRLF, trailing newline. Only the last two are portable ideas (Grown already lints via eslint/tsc; a `.editorconfig`/eol check is the analogue).

### 1.7 Suite totals (for the scoreboard)

`QUnit.test(` occurrences under `sdkjs-tests-v9.3.1/tests/`: **1513** total — cell 1073 · word 356 · slide 38 · common 36 · visio 7 · oform 2 · pdf 1. Cross-cutting scope in this file (common + pdf + oform + visio + word/forms + word/plugins + api-text-form) = **36 + 1 + 2 + 7 + 13 + 5 + 5 = 69 static tests**, plus ~220 table-driven data cases (137 colour, 75 URL, 5 oform) and 5 vsdx round-trip files that fan out at runtime.

---

## 2. What Grown has today (feature inventory)

Legend: **Have** = present and exercised · **Partial** = present but narrower than OnlyOffice · **Missing** = absent. Paths are relative to the repo root. "PR #32" = the PDF-editor overhaul (`feat/pdf-editor-overhaul`, **merged into main at 4850ecf**; 67 editor e2e; roadmap in `pdf/docs/EDITOR_OVERHAUL.md`).

### 2.1 PDF

| Capability | Status | Grown path / evidence |
|---|---|---|
| Render + navigate PDF | Have | `pdf/frontend` (react-pdf / pdfjs-dist 4.x); `web/app` also depends on `pdfjs-dist` |
| Annotations: ink, rect, circle, arrow, text, highlight, eraser, select | Have | `pdf/FEATURES.md` "Annotation overlay mode" (tibui `PDFEditor`), persisted via `documents.annotations` JSONB; server bake-in `internal/pdf/pdf/annotations.go` `BakeAnnotations` (pdfcpu) |
| Underline / strikethrough / whiteout / images / shapes with fill+opacity, multi-select, z-order, align/distribute, snapping, rotation | Have | `pdf/frontend/src/features/editor/pages/EditorPage.tsx` (`/editor`, 6,547 lines); `editor-markup`, `editor-selection`, `editor-arrange`, `editor-rotate` specs |
| Edit existing PDF text in place (overlay spans, pdf-lib regenerate) | Partial | `pdf/FEATURES.md` "In-place text editing"; no reflow (documented gap: "Multi-line text-block reflow") |
| Page ops (add/delete/move/rotate, merge/extract, page sizes, crop, headers/footers, Bates) | Have | `EditorPage.tsx`, `editor-pages*.spec.ts`, `editor-assemble.spec.ts`, `editor-headerfooter.spec.ts`, `editor-crop-styles.spec.ts` |
| AcroForm fields (text, checkbox, radio, dropdown) create + fill, flatten on export | Have | `editor-forms.spec.ts`, `editor-forms-advanced.spec.ts` |
| **Form field JS actions / calculated fields** (OnlyOffice `formActions.js`, the one `tests/pdf` case) | Have (CC3) | `pdf/frontend/src/features/editor/forms/formCalc.ts` (safe evaluator, no JS execution), `formPdf.ts` (`/AA`, `/CO`, AcroForm import); `forms-calc.unit.spec.ts`, `editor-forms-calc.spec.ts` |
| List box, push button, signature *field* type | Have (listbox/pushbutton, CC3); signature field Partial | `editor-forms-listbox.spec.ts`; signature/initials/date fields exist in the signing flow (`pdf/frontend/src/features/signing`, `PrepareDocumentPage.tsx`) |
| Comments / sticky notes, stamps (Approved/Draft/custom) | Have | `editor-comments-stamps.spec.ts` |
| Redaction (true content removal, page rasterised on export) | Have | `editor-redact.spec.ts` (the older `/documents/:id/edit` text-edit mode still only whiteouts — `pdf/FEATURES.md` "True text removal") |
| Text search across pages | Have | `editor-search.spec.ts` |
| Thumbnails sidebar, fit-width/fit-page zoom | Have | `EDITOR_OVERHAUL.md` Wave 3 |
| Unicode font embedding (fontkit + bundled Noto Sans) | Have | `editor-unicode.spec.ts`, `pdf/frontend/src/features/editor/fonts/` |
| Autosave drafts (IndexedDB), editable sidecar round-trip, PNG/JPEG export, metadata | Have | `draftDb.ts`, `editor-persist.spec.ts`, `editor-roundtrip.spec.ts`, `editor-export.spec.ts` |
| Accessibility pass on toolbar/dialogs | Have | `editor-a11y.spec.ts` |
| Digital signatures (PAdES, X.509, TSA, verify) | **Have — beyond OnlyOffice** | `internal/pdf/{crypto,sig,certs}`; 51 Go tests in `internal/pdf` |
| Co-editing a PDF (OnlyOffice `CollaborativeEditing.js`) | Missing | Editor is single-user client-side state; drafts autosave to IndexedDB (`draftDb.ts`) |
| Continuous-scroll multi-page render; open a Documents item by id in `/editor` | Missing (deferred in `EDITOR_OVERHAUL.md`) | — |
| PDF → DOCX conversion (OnlyOffice DocxRenderer) | Missing | — |
| Password / encryption, PDF/A, OCR | Missing (documented "needs backend/native") | `EDITOR_OVERHAUL.md` "Deliberately NOT done" |
| Print / print preview | Partial | browser print only |
| Tests | **76 Playwright** = 67 editor e2e over 25 `editor-*.spec.ts` + 5 `api.spec.ts` + 4 `app.spec.ts`; **51 Go** `func Test` in `internal/pdf` (8 files) | `pdf/frontend/playwright.config.ts` projects `api`, `chromium`, `editor` (run with `PLAYWRIGHT_PORT=<free>`) |

### 2.2 Forms

| Capability | Status | Grown path / evidence |
|---|---|---|
| Google-Forms-style builder, fill page, responses, quiz grading | Have | `web/app/src/pages/forms/{FormEditor,FormFill,FormList,FormResponses}.tsx` (3,837 lines total); `internal/forms` (104 funcs, **51 Go tests**: grading, proto round-trip, repository, auth guards) |
| Question types | Have (12) | `types.ts`: short_answer, paragraph, multiple_choice, checkboxes, dropdown, linear_scale, date, time, file_upload, **multiple_choice_grid, checkbox_grid, rating** (CC4); section divider via helper |
| Templates | Have | `helpers.ts` (template catalogue; `helpers.test.ts` **15 vitest cases**) |
| Grid questions (multiple-choice grid, checkbox grid), rating | Have (CC4) | `EditorParts.tsx` (`GridEditor`, `RatingEditor`), `FormFill.tsx` (`GridInput`, `RatingInput`), grid summary table in `FormResponses.tsx` |
| Answer validation (regex/length/number range — analogue of OnlyOffice text-form *format/mask*) | Have (CC4) | `web/app/src/pages/forms/validate.ts` + `internal/forms/validate.go` (client and server) |
| Conditional logic / go-to-section (analogue of OnlyOffice field groups + roles) | Have (CC4) | go-to-section per option + "after section" per section; `pagePath`/`VisitedQuestions` |
| Roles (who fills which field), field groups with weight | Missing | OnlyOffice-specific (oform); the Grown analogue is *signer roles* in `pdf/` (signers + field assignment) — Have there |
| Fillable *document* forms (content-control forms inside a Docs doc) | Missing here | Belongs to docs.md; the PDF editor's AcroForm work (PR #32) is the nearest thing |
| Export responses (csv/xlsx) | Partial | check `FormResponses.tsx` (summary counts present; file export not verified) |

### 2.3 Diagrams / Visio

| Capability | Status | Grown path / evidence |
|---|---|---|
| Whiteboard (freeform diagramming, shapes, arrows, text, libraries) | Have | `web/app/src/pages/whiteboard/WhiteboardEditor.tsx` (Excalidraw 0.18); `internal/whiteboards` (service + `collab.go` websocket hub + 3 repo tests); in-doc drawings `web/app/src/pages/docs/DrawingDialog.tsx` (Excalidraw → SVG) |
| Real-time co-editing of a board | Have | `internal/whiteboards/collab.go` (`Hub.Serve`, coder/websocket) |
| Sharing grants | Have | `ShareDialog.tsx`, `GrantBoardAccess/ListBoardGrants/RevokeBoardAccess` |
| **View `.vsdx`** (OnlyOffice's whole visio module) | Have (import, CC6) | `web/app/src/pages/whiteboard/vsdx.ts` → Excalidraw elements; see the CC6 status note in §5 |
| Export board to PNG/SVG | Have (CC6) | whiteboard File menu: PNG, SVG, `.excalidraw` (`web/app/src/pages/whiteboard/sceneIO.ts`) |
| Mermaid / text-to-diagram | Missing | — |

### 2.4 Shared pieces

| Capability | OnlyOffice | Grown status | Grown path / evidence |
|---|---|---|---|
| Real-time collaboration | Custom OT + locks (`docscoapi`, `CollaborativeEditingBase`) | Have (different model, CRDT) | Yjs + `y-websocket` in `web/app`; Go hubs `internal/{docs,sheets,slides,whiteboards,projects,chat}/collab.go` (coder/websocket) |
| Version history | `versionHistory.js` | Partial (Docs only) | `internal/docs/service.go` `SnapshotNow/ListVersions/GetVersion/RestoreVersion`; none for sheets/slides/whiteboards |
| Co-authoring chat | `CoAuthoringChatSendMessage` | Have (separate app) | `internal/chat` |
| Spellcheck | Hunspell wasm, per-language | Partial (browser-native only) | no `spellcheck`/`hunspell`/`nspell` in `web/app/src` or `internal` (except a game page); TipTap contenteditable inherits browser spellcheck |
| Fonts | Bundled FreeType/HarfBuzz, font list API, hyphenation | Partial | docs/slides expose ~7 web-safe families (`web/app/src/pages/docs/Toolbar.tsx`, `slides/model.ts`); PDF editor bundles Noto Sans (PR #32); no hyphenation |
| Charts | Full chart model + ChartEx | Missing in editors | no chart library in `web/app/package.json`; FortuneSheet has no chart plugin wired; slides have no chart element (see sheets.md / slides.md) |
| Colour transforms (lumMod etc.) | DrawingML colour mods | Have (library, CC1) | `web/app/src/lib/colorMods.ts`: all 28 §20.1.2.3 transforms + srgb/hsl/scheme resolution; not yet used by an importer |
| URL classification (`asc_getUrlType`) | Http/Email/Unsafe/Invalid | Have (CC1) | `web/app/src/lib/urlType.ts`, used by the Docs and Slides link prompts; Sheets has no link dialog yet |
| Plugins / macros | 55-method plugin API, macro recorder, VBA import | Missing | no plugin/macro/Apps-Script layer; webhooks exist only in `internal/projects/webhook.go`, `internal/live/webhooks.go` |
| Print | Native print pipeline | Partial | browser print / PDF export |
| Number formats | `NumFormat.js` | (sheets.md) | `internal/sheets` |

### 2.5 File conversion

| Path | Status | Grown path / evidence |
|---|---|---|
| Docs export docx/odt/rtf/epub/md/pdf | Have (server, pandoc) | `internal/docs/convert.go` `ConvertHTML` (pandoc; pdf via `--pdf-engine=tectonic`); pandoc pinned in `flake.nix`, `Dockerfile`, `nix/images.nix`; client-side txt/html/pdf in `web/app/src/pages/docs/export.ts` |
| Docs import docx/odt/rtf/epub/md/markdown/html/txt | Have (server, pandoc) | `internal/docs/convert.go` `ImportSupported` / `ImportToHTML` / `runPandocImport` (`--embed-resources`, 16 MiB cap); route `POST /api/v1/docs/import` in `internal/server/server.go`; UI `importDoc()` in `web/app/src/pages/docs/api.ts` + Import button in `DocList.tsx` (seeds the new doc via the `docseed:<id>` channel) |
| Sheets export xlsx/ods/csv/tsv/html/pdf | Have (client, SheetJS `xlsx` 0.18 Apache-2.0) | `web/app/src/pages/sheets/export.ts` |
| Sheets import xlsx/csv | Missing (verified on origin/main c90064e) | no `XLSX.read` in `web/app/src/pages/sheets` |
| Slides export pptx/pdf/txt/html/jpg/png/svg | Have (client, pptxgenjs MIT) | `web/app/src/pages/slides/export.ts` (ODP deliberately omitted) |
| Slides import pptx | Missing | — |
| PDF export from any editor | Have | client (jsPDF/pdf-lib) + pandoc/tectonic |
| Conversion tests | Partial (import only) | `internal/docs/convert_import_test.go`: **6 `func Test`** (round-trip via pandoc, HTML passthrough, `ImportSupported`, unsupported format, oversize, garbage); `ConvertHTML` (export side) has no tests; no corpus-driven fidelity tests | *(superseded by CC2, see §5 status note)*
| Legacy binary (doc/xls/ppt), xlsb, fb2, djvu, xps, hwp | Missing | — (pandoc reads doc? no — only docx/odt/rtf/epub/html/md) |

### 2.6 Test harness baseline (what a scoreboard would count today)

| Harness | Files | Cases | Runner / CI |
|---|---|---|---|
| `web/app` vitest | 16 `*.test.ts(x)` | 164 `it/test(` | `npm test` → `vitest run`, jsdom, `src/test-setup.ts`; CI `.forgejo/workflows/checks.yaml` job `frontend` (node:22-alpine: `npx tsc -b` + `npm test`) |
| `web/e2e` Playwright | 8 specs | 16 `test(` | CI only `npx playwright test --list` (no stack) |
| `pdf/frontend` Playwright | 27 specs (25 `editor-*` + `api` + `app`) | 76 (67 editor + 5 + 4) | `pdf/.forgejo/workflows/publish.yaml`; editor project needs `PLAYWRIGHT_PORT` |
| Go `internal/` | 237 `_test.go` | 1,606 `func Test` (pdf 51 · forms 51 · docs 31 · sheets 198 · whiteboards 3) | `go vet ./... && go test ./...` (CI job `go`) |
| Scripts precedent | `web/app/scripts/gen-games-pwa.mjs` | — | plain Node ESM, no deps — the pattern the parity script should follow |

---

## 3. Architecture recommendations (additive)

### 3.1 PDF (build on `pdf/frontend` + `internal/pdf`)

1. **Baseline is the merged `/editor` (PR #32).** It already delivers ~80 % of OnlyOffice's PDF-editor surface (annotations, forms, redaction, stamps, comments, search, page assembly, Unicode fonts) with 67 e2e. Every PDF item below is additive to `EditorPage.tsx` and its `editor-*.spec.ts` pattern; follow the `EDITOR_OVERHAUL.md` test-hook cheat-sheet (controls go in the left side cards, not the canvas header).
2. **Calculated / scripted form fields** (the only `tests/pdf` behaviour): add an optional `calc` expression to the AcroForm field model (`EditorPage.tsx` `Annotation` union) evaluated in *field creation order* after each edit — a tiny safe expression evaluator (no `eval`), not Acrobat JavaScript. Port the OnlyOffice case as `editor-forms-calc.spec.ts`: three fields with chained increments → assert propagated values. On export, write `/AA` `/C` (calculate) JS via pdf-lib low-level API so Acrobat also recalculates — best-effort.
3. **Listbox + push-button fields**: additive to the same union; pdf-lib supports `PDFOptionList` and `PDFButton`.
4. **Bake annotations server-side into the signed bytes** (already in `FEATURES.md` future list; `BakeAnnotations` exists): extend the pdfcpu renderer to the PR #32 annotation kinds so signed PDFs carry the markup. Go tests: golden page-count + text-extraction assertions.
5. **PDF → editable Docs** — *flagged exception*: OnlyOffice does this with a 100k-line C++ `DocxRenderer`. Nearest additive path is `pdftohtml`/`pdftotext` (poppler, GPL, exec'd like pandoc) → `ImportToHTML`; fidelity will be paragraph-level only. Size XL; recommend "Open as text in Docs" (S) instead.
6. **Co-editing a PDF** — *flagged exception*: would require moving editor state into a Yjs doc + hub like docs/sheets. Defer; autosave drafts (PR #32) cover the single-user case.
7. **Password / PDF/A** — server-side via `pdfcpu` (Apache-2.0: `pdfcpu encrypt`) is additive (M); PDF/A remains an exception (needs Ghostscript, AGPL — do not exec it).

### 3.2 Forms (build on `web/app/src/pages/forms` + `internal/forms`)

1. **Validation rules** on `FormQuestion` (`validation?: {kind: "regex"|"length"|"number"|"email"|"url", …}`) mirrored in Go grading/summary; this is the direct analogue of OnlyOffice text-form formats/masks (`forms.js` "Check text form formats", "Check correction of text mask"). Port those cases as vitest tests on a new `validate.ts` + Go table tests.
2. **Grid question types** (`multiple_choice_grid`, `checkbox_grid`) and `rating`; additive enum values, proto field additions are backward compatible.
3. **Sections + conditional navigation** (go-to-section per option) — analogue of OnlyOffice field groups. Store on the option; `FormFill.tsx` page flow.
4. **Required-set check + all-forms-data get/set** exist implicitly (`required`, response JSON); add explicit vitest cases mirroring "Check filling out the required forms", "GetAllFormsData/SetAllFormsData", "Check form to json conversion".
5. **Roles** (oform `UserMaster`) — do *not* build into Forms; Grown's PDF signer roles already cover the "who fills which field" need. Note it in the scoreboard as "covered elsewhere".

### 3.3 Diagrams (build on the Excalidraw whiteboard)

1. **`.vsdx` import into a whiteboard** (view-first): a client-side reader (JSZip is already transitively present via SheetJS/pptxgenjs; otherwise `fflate`, MIT) that parses `visio/pages/page*.xml` shapes (`<Shape>` with `PinX/PinY/Width/Height/Angle`, `<Text>`, `<Geom>` rows, `<Connect>`) into Excalidraw elements (rectangle/ellipse/line/arrow/text). Covers the OnlyOffice `api/test-files.js` fixtures conceptually (rectangle, triangle, circle, line shapes, size & position). Elliptical-arc and master-derived geometry are XL; treat "basic shapes + connectors + text" as the M milestone and *write our own* tiny vsdx fixtures with LibreOffice Draw or by hand — never copy theirs.
2. **Export board → PNG/SVG/`.excalidraw`** from the whiteboard page (Excalidraw utils already imported in `DrawingDialog.tsx`).
3. **Mermaid text-to-diagram** (MIT) as an Excalidraw insert — optional, S.
4. **Editing `.vsdx` / round-trip write** — *flagged exception*: OnlyOffice itself is view-only; skip.

### 3.4 Shared pieces

1. **URL classifier** `web/app/src/lib/urlType.ts` returning `http | email | unsafe | invalid`, used by docs/sheets/slides link dialogs and chat; port all 75 OnlyOffice URL cases as a vitest table (behaviour only — decide our own answers for the `//todo` rows, e.g. `mysite@ourearth.com` → `email`).
2. **Colour transforms** `web/app/src/lib/colorMods.ts` (`lumMod/lumOff/satMod/satOff/tint/shade/gamma/invGamma/hueMod/hueOff/alpha*/red*/green*/blue*/comp/inv/gray`) — needed as soon as pptx/xlsx *import* has to resolve theme colours; port the 26 mod types × representative cases (compute expected values from the DrawingML spec, not from their tables).
3. **Spellcheck**: keep browser-native; additively expose `spellcheck` toggle + language attr in docs/slides/forms editors (S). Server-side hunspell (`internal/spell`, hunspell dictionaries are LGPL/MPL, fine as data) is M and only worth it for the mobile/PWA case.
4. **Fonts**: bundle a small Noto set once under `web/app/public/fonts` (shared by docs/slides/pdf export) and a `fontList` helper; hyphenation via `hyphen` npm (MIT) in docs pagination — see docs.md.
5. **Version history** for sheets/slides/whiteboards: reuse the docs `versions` table shape (additive tables + RPCs), M each.
6. **Plugins / macros** — *flagged exception*: OnlyOffice's 55-method plugin API + macro recorder is a platform in itself. Additive substitute: (a) document-level **webhooks** (reuse `internal/projects/webhook.go` pattern) for "on save / on share"; (b) an **HTTP data API** already exists per app. Do not design an in-editor plugin sandbox now.
7. **Code style**: add `.editorconfig` (`end_of_line = lf`, `insert_final_newline = true`) and an eslint `eol-last` rule (S) — the portable subset of `check.py`.

### 3.5 File conversion (MIT-compatible strategy)

Principles: everything AGPL stays out of the build and out of the process tree. OnlyOffice `x2t`/`core` is **never** linked or exec'd. GPL tools are acceptable only as *separately-installed executables invoked over stdio* (as pandoc already is) — the GPL does not reach across an exec boundary and we do not distribute them inside the MIT tree (they are pulled in by Nix at image build). Prefer permissive libraries in-process.

| Need | Recommendation (additive to what exists) | License |
|---|---|---|
| Docs import | Already shipped (`ImportToHTML`, pandoc `--embed-resources`); add fidelity tests (headings/lists/tables/images survive docx→HTML→docx) and the corpus runner below | pandoc GPL-2+, exec'd |
| Docs export fidelity | Keep pandoc; add a pandoc **reference.docx** in `internal/docs/assets` for styles/margins (S) | — |
| Sheets import xlsx/ods/csv | `XLSX.read` (already a dependency) → FortuneSheet model; formulas preserved via `cellFormula` | Apache-2.0 |
| Sheets xlsx export with formulas/styles | extend `sheets/export.ts` (SheetJS community edition has no styles — accept, or add `exceljs` MIT for the export path only) | MIT |
| Slides import pptx | parse with `fflate`/JSZip + DOMParser → `DeckDoc` (text boxes, images, basic shapes) | MIT |
| ODP export | `pptxgenjs` cannot; use pandoc? no (no pptx→odp). Exception: leave omitted or exec LibreOffice headless (MPL-2.0) behind a feature flag in the Nix image (L) | MPL-2.0, exec'd |
| Legacy .doc/.xls/.ppt import | LibreOffice headless (same flag) → docx/xlsx/pptx → existing paths | MPL-2.0, exec'd |
| PDF text extraction / pdf→docs | pdfjs `getTextContent` (already bundled) client-side (S); poppler `pdftohtml` server-side (M) | Apache-2.0 / GPL exec |
| Encrypt PDF | `pdfcpu` (already in `internal/pdf`) | Apache-2.0 |

**Round-trip corpus from OnlyOffice fixtures — yes, locally only.** The 86 documents under `research/onlyoffice/core/**` are useful as *input data* for non-committed round-trip tests (reading an AGPL project's sample documents as test input is not copying code, and they never enter git because `research/` is ignored). Shape: Go tests in `internal/docs` / `internal/sheets` (and vitest for the client-side paths) that `t.Skip` unless `GROWN_CONVERSION_CORPUS` points at a directory (default probe `research/onlyoffice/core`), then for each `*.docx|*.odt|*.xlsx|*.pptx|*.odp` do import → export → re-import and assert invariants (paragraph/cell/slide counts, non-empty text, no error). Caveat on coverage: the corpus is xlsx-heavy (34) and thin for docx (4) / odt (3) / pptx (8) / odp (6, animation-focused) — supplement with self-authored fixtures under `internal/testdata/` (tracked, MIT). CI (no `research/`) sees the tests as skipped; the scoreboard reports the corpus row as "local-only".

---

## 4. Parity-tracking harness (scoreboard) — design

Goal: one command prints, per suite, *OnlyOffice tests · Grown ported · Grown passing · %*, works in CI where `research/` is absent, and is the single source of truth all four plans feed.

**Files**

- `docs/plans/onlyoffice-parity/*-tests.csv` — the manifest rows (this file's `common-tests.csv`, plus `docs-tests.csv`, `sheets-tests.csv`, `slides-tests.csv`). Columns: `onlyoffice_path,test_count,area,portability,target_grown_path,milestone`. `test_count` is the *snapshot* count taken when the row was written; `target_grown_path` is one or more files/globs in the Grown tree separated by `;` (quoted comma lists also accepted); `portability` is keyed on its first word case-insensitively (`High (as key-map table)` → `high`); `milestone` may hold several space-separated ids, `exception`, or `-`. The script normalises all of these (see README "Manifest CSVs").
- `docs/plans/onlyoffice-parity/baseline.json` — tracked, written by `--write-baseline`: `{area: {ported, passing}}`; `--check` fails CI if a number regresses.
- `web/app/scripts/onlyoffice-parity.mjs` — plain Node ESM, zero deps (same style as `gen-games-pwa.mjs`). Add `"parity": "node scripts/onlyoffice-parity.mjs"` to `web/app/package.json`.

**Counting rules (documented in the script header)**

| Side | How |
|---|---|
| OnlyOffice live | if `research/onlyoffice/<onlyoffice_path>` exists: count `QUnit.test(` in `.js`; for `core/**` rows count fixture documents by extension; otherwise use the CSV `test_count` and tag the column `(snapshot)` |
| Grown ported | for each `target_grown_path` glob: `*.test.ts(x)` → `^\s*(it|test)(\.each|\.skip|\.todo)?\(`; `*.spec.ts` → `^\s*test(\.skip)?\(`; `*_test.go` → `^func Test`; `t.Run("` counted as sub-cases in a separate column |
| Grown passing | optional: `--vitest-json <file>` (vitest `--reporter=json`), `--go-json <file>` (`go test -json`), `--pw-json <file>` (Playwright json reporter); matched by file path; without them the column prints `n/a` and "ported" is the score |
| Aggregation | by `area` (from the CSV) and by plan file; grand total line; `--json` emits the same for the CI artifact; `--md` emits a Markdown table for pasting into the plan READMEs |

**Degradation in CI**: `research/` absent → snapshot counts; result JSON absent → `n/a`; a `target_grown_path` that doesn't exist yet → ported 0 (not an error). Exit code non-zero only under `--check` when a baseline regresses or a CSV row is malformed.

**CI wiring (S)**: one extra step in `.forgejo/workflows/checks.yaml` `frontend` job: `node scripts/onlyoffice-parity.mjs --check --md >> $GITHUB_STEP_SUMMARY`. Vitest JSON can be produced in the same job (`npx vitest run --reporter=json --outputFile=/tmp/vitest.json`) and passed with `--vitest-json` so "passing" is real on the web side; Go JSON needs the `go` job — cross-job artifacts are a later nicety.

---

## 5. Milestones

Sizes: S ≤ 1 day · M ≤ 1 week · L 2–3 weeks · XL > 3 weeks. All additive to existing code.

| # | Milestone | Size | Deliverables / tests |
|---|---|---|---|
| CC0 | **Scoreboard harness** | S | `web/app/scripts/onlyoffice-parity.mjs`, `baseline.json`, CI step; consumes all four `*-tests.csv` |
| CC1 | **Shared unit ports**: `urlType.ts` (75 cases), `colorMods.ts` (26 mod types), `.editorconfig` + `eol-last` | M | vitest `web/app/src/lib/{urlType,colorMods}.test.ts`; wire `urlType` into link dialogs |
| CC2 | **Conversion tests + corpus**: Go tests for `ConvertHTML` (each export format, size limit, pandoc-missing skip) alongside the existing 6 import tests; import↔export fidelity tests; local corpus runner (`GROWN_CONVERSION_CORPUS`); self-authored fixtures in `internal/testdata` | M | `internal/docs/convert_test.go`, `internal/docs/corpus_test.go` (extends `convert_import_test.go`) |
| CC3 | **PDF: calculated fields + listbox/pushbutton** on the merged `/editor` | M | `pdf/frontend/e2e/editor-forms-calc.spec.ts` (port of `tests/pdf/forms/actions.js` behaviour), `editor-forms-listbox.spec.ts`; extend `BakeAnnotations` + Go tests |
| CC4 | **Forms: validation rules, grids, rating, sections/branching** | L | `web/app/src/pages/forms/validate.test.ts` (text-format/mask cases), Go grading tests for new types, e2e in `web/e2e/forms.spec.ts` |
| CC5 | **Sheets/Slides import** (xlsx/csv via SheetJS; pptx via zip+DOMParser) + corpus round-trip rows | L | vitest on parsers with tracked fixtures; corpus rows in scoreboard |
| CC6 | **Whiteboard: vsdx import (basic shapes, connectors, text) + PNG/SVG/.excalidraw export** | L | `web/app/src/pages/whiteboard/vsdx.test.ts` with hand-made vsdx fixtures (rectangle, triangle, circle, line, size & position — mirrors OnlyOffice `api/test-files.js` intent), e2e export test |
| CC7 | **Version history for sheets/slides/whiteboards**; spellcheck toggle + lang; shared Noto font bundle | M each | Go repo tests per app; vitest for font helper |
| CC8 | **Optional LibreOffice-headless exec** behind a feature flag (legacy .doc/.xls/.ppt import, ODP export) | L | Go tests skipped unless `soffice` present |
| — | Flagged exceptions (not planned): in-editor plugin/macro platform; PDF co-editing; PDF→DOCX fidelity conversion; PDF/A; vsdx write/edit | — | Rationale in §3 |

**CC1 status (done, 2026-09-26):**
- `web/app/src/lib/colorMods.ts` + `colorMods.test.ts`: all 28 ECMA-376 transforms (the "26 mod types" above plus `hue`/`sat`/`lum`), `resolveColor` for srgbClr/hslClr/schemeClr (default clrMap aliases) and `readColorMods` for pptx/xlsx XML. It's the one module Slides/Sheets import should use (slides.md now points here). 28 `oo:` tags, one per QUnit test: the full 137-row combined table plus sampled rows from each per-mod grid, compared within ±1 per channel. Checked locally against all 10,023 reference rows: 98.7% agree within ±1. The rest are all "saturate an achromatic grey" rows, where we keep plain HSL (hue 0°) and the reference has a darker blue channel. That divergence is documented in the test.
- `web/app/src/lib/urlType.ts` + `urlType.test.ts`: `http | email | internal | unsafe | invalid`. Both `api.js` QUnit tests are ported (browser + desktop via `isLocalFile`). The `//todo` rows use the answers the todo asks for (e.g. `mysite@ourearth.com` → email). Script schemes (`javascript:`, `data:`, `vbscript:`) are always invalid. `resolveLinkInput` is wired into the Docs toolbar, context menu and Insert menu and the Slides link action: bare hosts get `https://`, bare addresses get `mailto:`, invalid input is rejected, and unsafe input asks for confirmation.
- Code style: root `.editorconfig` (LF, final newline, UTF-8 only), `eol-last` in `pdf/frontend/eslint.config.js` (web/app has no eslint), and `web/app/src/codeStyle.test.ts` covering 2 of `check.py`'s 4 checks. The licence-header and address checks don't apply.

### CC2 status (Wave 1, 2026-09-26): done

- **Tests.** `internal/docs/convert_test.go` covers `ConvertHTML` for every export format (docx/odt/epub container checks, standalone RTF, gfm, and PDF when `tectonic` is on PATH), the 16 MiB cap on both sides, the pandoc-missing path, cancellation, and temp-file cleanup. It also runs HTML → {docx, odt, rtf, epub, md} → HTML fidelity over `internal/docs/testdata/fidelity.html` (headings, bold/italic/underline/strike, links, nested/ordered lists, tables, data-URI images, blockquote, code). Known pandoc losses are asserted as *expected losses*, so a pandoc upgrade that fixes one fails loudly. The losses: paragraph alignment is lost everywhere; odt turns underline into `<em>`; rtf flattens lists into bullet-glyph paragraphs, drops `<th>`, and loses blockquotes.
- **Corpus runner.** `internal/docs/corpus_test.go` walks `GROWN_CONVERSION_CORPUS`. Each file goes through import, export to docx/odt/md, and a docx re-import, and the test asserts words, headings, tables, list items, and embedded images all survive. Empty source documents are detected without pandoc. The test skips when the variable is unset (CI), and the same pipeline always runs over `testdata/corpus` (self-authored). Tags cover `OdfFile/Test/Test/ExampleFiles` (4 of 5; the pptx belongs to slides), `EpubFile/test/Files` (11), `TestOOOXml2Odf` (docx → odt), and `StandardTester` (the batch round trip). With these, **common/conversion has 17 ported**.
- **Corpus pass rate** against `research/onlyoffice/core` (fixture dirs only): **54/54 (100 %)**. That breaks down as docx 3, odt 3, epub 11, html 30, htm 3, md 4, and 10 of the 54 are legitimately empty libxml2/ODT edge cases. The first, naive run passed 36/54. Every one of those failures traced to the checker, not to `convert.go`: it counted non-embeddable relative/remote `<img>` as losses, flagged empty sources and empty `<li>`, and hit transient disk-full errors. Run it with `GROWN_CONVERSION_CORPUS=$PWD/research/onlyoffice/core go test ./internal/docs/ -run Corpus -parallel 1 -v`. The xlsx/xls/csv (`AVSOfficeEWSEditorTest`) and pptx/odp fixtures stay with CC5.
- **Bugs fixed in `convert.go`**, each with regression tests:
  1. pandoc ran without `--sandbox`. On import, `--embed-resources` inlined arbitrary server files (`<img src="/etc/passwd">`) into the returned HTML, export packed them into docx/odt/epub, and http(s) URLs were fetched server-side (SSRF). Fixed in both directions.
  2. RTF export was a headerless fragment, not an openable `.rtf`. It is now `--standalone`.
  3. `ConvertHTML` never enforced `maxConvertBytes`.
- **Open follow-ups (not fixed here).** ~~Markdown/txt import passes raw HTML such as `<script>` through~~ — fixed: every import now runs `internal/docs/import_sanitize.lua`, a pandoc Lua filter that drops raw HTML (bare `<u>`/`<sup>`-style tags excepted), `on*` attributes and `javascript:`/`vbscript:`/non-image `data:` URLs (`TestImportToHTMLSanitizesActiveContent`). `serveDocsConvert` and `serveDocsImport` silently truncate bodies over 16 MiB rather than returning 413.

### CC3 status (Wave 4, 2026-09-26): done

- **Evaluator.** `pdf/frontend/src/features/editor/forms/formCalc.ts` never runs PDF JavaScript. It tokenises the script, parses the patterns Acrobat writes into an AST and interprets that; any other statement is skipped. Supported: `AFSimple_Calculate` (SUM/PRD/AVG/MIN/MAX over a name array or comma list, hierarchical names expand), simplified field notation (`/** BVCALC … EVCALC **/`), and `event.value =` / `getField(x).value (+|-|*|/)?=` / `var` statements over + − × ÷ %, `AFMakeNumber`, `Number`, `parseFloat` and a few `Math.*` functions. Values that look numeric read as numbers, and `+` concatenates strings, as in Acrobat. A commit runs every calculate action once in `/CO` order. Writes to the field the user just committed are dropped: that's what the OnlyOffice chain test implies, and it's why `actions.js` passes (2→22→4, then 3→23→43).
- **Formats.** `AFNumber_Format`/`_Keystroke` (5 separator styles, 5 negative styles, currency before or after), `AFPercent_*`, `AFDate_FormatEx`/`AFDate_Format` (the 14 Acrobat presets), `AFParseDateEx`-style parsing. Keystroke filtering while typing; normalise and format on blur. Values that don't parse are kept and flagged.
- **Editor.** Text fields get Format and Calculate panels (sum/product/avg/min/max of fields, expression, read-only view of custom scripts) plus a calculation order. New **list box** (single/multi-select, filled on the canvas) and **push button** fields: reset form (native `/ResetForm`), hide/show (native `/Hide`), toggle (small JS). Submit is disabled with a message and exports no action. Buttons only act in Fill & Sign mode. Hidden and read-only flags.
- **Persistence.** The live export writes `/AA` C/F/K/V, `/AcroForm /CO`, button `/A` and the hidden flag. `/V` keeps the raw value while the appearance shows the formatted one, so a flattened export bakes the formatted, computed value (`$1,234.50`) and leaves hidden fields out. Opening any PDF that has an AcroForm now imports its text/checkbox/radio/dropdown/listbox/button fields, with their actions and `/CO`, as editable fields (`importAcroForm`; signature and multi-widget non-radio fields stay in the base PDF). The editable sidecar carries the raw scripts too.
- **Bug fixed on the way.** Export called `setFontSize` before `addToPage`, which throws without a `/DA`. The throw was swallowed, so every exported text/dropdown field had **no widget** (invisible in viewers). There's now a regression assert in `editor-forms-calc (b)`.
- **Tests.** 22 unit tests (`pdf/frontend/e2e/forms-calc.unit.spec.ts`, new browserless Playwright project `unit`) + 5 `editor-forms-calc` + 6 `editor-forms-listbox` e2e; `oo:pdf/forms/actions.js#Test calculate action` is tagged in both (the unit port and the UI run on an imported PDF). **No Go change:** `/editor` bakes client-side with pdf-lib, and `BakeAnnotations` only serves the tibui overlay/signing path, which has no form fields. So the plan's "extend BakeAnnotations" item wasn't needed.

### CC4 status (Wave 4, 2026-09-26): done

- **Model.** Additive `FormQuestion` fields: `validation {kind, op, value, value2, error_text}`, `text_format` + `mask`, `rows` + `limit_one_per_column` (grids; columns are `options`), `rating_icon` (levels = `scale_max`, 3–10), `after_section` (on section dividers), plus `FormSettings.after_first_section` and summary `grid_rows` / `answered_count` / `skipped_count`. Questions and settings are JSON columns, so there's **no DB migration**. Grid answers are row-keyed objects (`{"Mon": "AM"}` or `{"Mon": ["AM","PM"]}`), and grid answer keys are `row\x1fcolumn` entries in `correct_answers`. Only `gen/go/grown/v1/forms.pb.go` (protoc-gen-go v1.36.11, matching go.mod) and the forms swagger were regenerated. The gateway/grpc files didn't change.
- **Validation.** Google Forms' set: number (> ≥ < ≤ = ≠, between, not between, is number, whole number), text (contains, doesn't contain, email, URL), length (max/min), regex (contains, doesn't contain, matches, doesn't match), and checkbox (at least/at most/exactly), each with custom error text. Short answers also take an input format in the spirit of OnlyOffice text-form formats: digits, letters, phone `(999) 999-9999`, ZIP `99999`, credit card `9999 9999 9999 9999`, or a custom mask (`9` digit, `a` letter, `O` digit or letter, `X` any, `\c` literal). Typing into a masked field auto-inserts literals and rejects keystrokes that don't fit, and a submission must fill the mask completely. `validate.ts` and `validate.go` produce the same messages. The server re-checks everything in `SubmitFormResponse`. One gap: regexes RE2 can't compile (lookaround, backreferences) are only enforced client-side.
- **Sections and branching.** The respondent path follows the last go-to-section answer on a page, then the section's "After section N" (continue / go to section / submit), then the next page. Back retraces the pages the respondent actually visited. **Server bug fixed:** required questions used to be enforced on every section, so any branched form with a required question on a skipped section couldn't be submitted. Now only reached questions are checked, answers on skipped sections are dropped on both sides, and a loop back to a visited page ends the walk. The summary counts `skipped_count` per question, and the individual view shows "(skipped: section not reached)".
- **Grading.** Grids are gradable, with points split across keyed rows. A row counts as correct only when its column set matches exactly. Linear scale and rating stay ungradable.
- **Tests.** 53 vitest in `validate.test.ts`, which carries 8 `oo:` tags. From `word/forms/forms.js` it ports text form formats, format in text form, the full mask-correction table, required forms, GetAllForms and GetAllFormsData/SetAllFormsData. From `complexForm.js` it ports all-required-filled (as grid rows) and form-to-JSON. There are 9 new Go test funcs (60 total in `internal/forms`) covering masks, validation tables, grids, paths, `checkSubmission`, grid grading, summary skip counts and the proto round trip. `web/e2e/forms.spec.ts` has 4 e2e tests: it builds a branched form in the editor (Cat → Cats → submit, Dog → Dogs with a required grid) and fills it down both branches, including a grid "one response per row" error and a custom validation error. It then checks the stored answers, summary skip counts, grid summary and individual view, and that the API rejects invalid answers with 400. `common/forms` is at 8/20 ported. Not ported: `api-text-form.js` (builder-API border/background/lock props) and `oformXml.js` (UserMaster/FieldGroup XML), which have no Forms analogue. Roles are covered elsewhere (PDF signer roles).

### CC6 status (Wave 5, 2026-09-26): done

- **Reader.** `web/app/src/pages/whiteboard/vsdx.ts` is a pure, view-only `.vsdx` reader written from MS-VSDX (no OnlyOffice code). It returns Excalidraw element skeletons per page. It follows the package rels (document → pages/masters/theme, page → media) and reads shape transforms (Pin/LocPin/Width/Height/Angle/Flip, nested group frames), Geometry rows (MoveTo/LineTo/ArcTo/EllipticalArcTo/Ellipse/PolylineTo/NURBSTo/Spline*/Rel*, with curves sampled; NURBS is approximated by a Bézier through its control points), and fill/line cells (FillForegnd/FillPattern/LineColor/LineWeight/LinePattern/Rounding/Begin-/EndArrow, section NoFill/NoLine/NoShow). Master inheritance covers `Master`/`MasterShape`, cell/section/row merges and `Del`, plus group sub-shapes inherited from the master. Colours fall back through style sheets (Line/Fill/TextStyle chains), and themed colours resolve through `QuickStyle*Color` against the theme's accents and variation colours. Closed four-point boxes become rectangles, edge-midpoint quads become diamonds and centred `Ellipse` rows become ellipses. Everything else (triangles, polygons, arcs, open paths) becomes a closed or open `line`. Text is read with Character Size/Color, Paragraph HorzAlign and VerticalAlign. On recognised containers it becomes a label; elsewhere it becomes free text at the text block. 1-D shapes become lines, or arrows when they have arrowheads or `<Connects>` glue, and arrows are bound to the rectangle/ellipse/diamond they're glued to (glue to a group child falls back to its ancestors). Bitmap foreign shapes (png/jpeg/gif/svg/bmp) become images; EMF/WMF are skipped with a warning. Background pages are skipped unless a drawing has nothing else. `layoutVsdxPages` places pages side by side, each in a named frame when there's more than one.
- **UI.** Whiteboard home has **Import .vsdx**, which creates a board named after the file and imports into it. The editor has a **File** menu: *Import Visio (.vsdx)…* adds the drawing to the right of the current scene (autosave and collab pick it up like any edit), and *Export as PNG / SVG* and *Download .excalidraw* use Excalidraw's `exportToBlob`/`exportToSvg`/`serializeAsJSON` (`sceneIO.ts`).
- **Tests.** `vsdx.test.ts` has 25 vitest cases on fixtures built in code with jszip (`vsdxFixture.ts`; no sample files are committed). They cover the rectangle, triangle, circle, rect+circle, diamond, line, size/position/rotation with an off-centre LocPin, elliptical and circular arcs, a relative-coordinate square, colours, NoFill/pattern 0, a text label, free text, a glued connector, elbow geometry, master and group-master inheritance, style and theme fallback, images and multi-page frames. That's 10 `oo:` tags: `sax-serialize.js#Test api.OpenDocumentFromZip`, 7 `api/test-files.js` fixtures, and `api-test.js` `addSquarePolygon`/`colorizeRectange`. The local-only corpus block decodes every base64 package in `research/…/tests/visio/{api/test-files.js,serialize/sax-serialize-files.js}` (with `OO_RESEARCH=<repo>/research/onlyoffice` from a worktree). It is skipped in CI. All 23 samples pass: 19 parse, and the 4 bare-XML zips are rejected cleanly. `web/e2e/whiteboard-vsdx.spec.ts` imports a generated two-page drawing from home and checks the saved scene (types, labels, colours, arrow bindings, frames, text centring). It then exports SVG, PNG and .excalidraw and re-imports from the File menu. The manifest now counts `api/test-files.js` as its 14 embedded fixtures and `api-test.js` as its 2 scenario functions (both were 0), so **common/visio is 10/23**.
- **Not done.** The 5 serialize round-trip rows: we don't write `.vsdx` (a flagged exception). Also not done: gradients, shadows, per-run text formatting (only the first Character/Paragraph row is used), text rotation, line jumps and layers. Lines/polygons can't be arrow binding targets in Excalidraw 0.18, so connectors glued to triangles etc. keep their endpoints but aren't bound.

Suggested order: CC0 → CC1 → CC2 → CC3 → CC4 → CC6 → CC5 → CC7 → CC8. CC0–CC2 are pure additions with no UI risk and immediately make the scoreboard non-zero for the cross-cutting area.
