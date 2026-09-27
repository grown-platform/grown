# OnlyOffice parity plan — Docs (word processing)

Status: plan written 2026-09-26. M0 (test harness) has landed; see §6.4. M2 (clipboard, find/replace, autocorrect) has landed; see §6.7. M4 (tables) has landed; see §6.10. M5 (track changes v2) has landed; see §6.11. M11 (equations) has landed; see §6.12.

Scope rule (from the user): this plan is **additive**. Grown's editor stays
TipTap 2 on ProseMirror with Yjs collaboration; every milestone adds
extensions, nodes, marks, plugins, Yjs maps, backend endpoints, and tests on
top of what exists. Work that could not be done without a large refactor is
listed under "Flagged exceptions" with a justification and is *not* part of the
milestone plan.

License rule: OnlyOffice (`research/onlyoffice/`, gitignored) is AGPL-3.0;
Grown is MIT. Nothing under `research/onlyoffice/` may be copied into the
tracked tree. Test *cases* (inputs -> expected outputs) are re-expressed as
newly written vitest / Playwright tests with Grown's own fixtures and helpers.

Reference snapshot: sdkjs master `72b0421`, sdkjs tests tag v9.3.1.11,
web-apps master `9c0ca538` (see `research/onlyoffice/README.md`).
Grown baseline: `origin/main` at `c90064e` (the inventory was checked against
`git show origin/main:<path>`; the working tree at `96ca7c0` differs only by
the docs import feature, commits `c3e38aa` and `dac2186`).

---

## 1. How Grown Docs works today

### 1.1 Editor framework

* TipTap 2 (`@tiptap/react` 2.11, `@tiptap/starter-kit`, `@tiptap/pm`) on
  ProseMirror; UI in MUI Joy. Entry component:
  `web/app/src/pages/docs/DocEditor.tsx` (844 lines) builds the editor with
  `useEditor({ extensions: buildExtensions(...) })`.
* Extension set, `web/app/src/pages/docs/extensions.ts` (`buildExtensions`,
  line 556):
  * StarterKit with `history: false` (Yjs owns undo), Underline, TextStyle,
    Color, FontFamily, Highlight (multicolor), Link (autolink, linkOnPaste),
    TextAlign (heading/paragraph), TaskList/TaskItem (nested), Image,
    Subscript, Superscript, Table (resizable) + TableRow + TableHeader/TableCell
    extended with a `backgroundColor` attribute (`withCellBackground`, line 525).
  * Grown-written extensions in the same file: `FontSize` (textStyle attr,
    line 265), `LineHeight` (paragraph/heading attr, line 50),
    `ParagraphSpacing` (single `before|after` attr rendered as margins,
    line 116), `PageBreak` (block atom, CSS `break-after: page`, line 184),
    `ImagePaste` (paste/drop image files as data URLs, line 240),
    `CommentMark` (span with `data-comment-id`, line 314), `Footnote` and
    `Endnote` (inline atoms whose note text is a **string attribute**
    `content`; numbering is a CSS counter, lines 386/463).
  * `web/app/src/pages/docs/suggesting.ts`: `InsertionMark`, `DeletionMark`
    and the `Suggesting` extension (appendTransaction tags inserted text;
    `handleKeyDown` converts Backspace/Delete into deletion marks;
    `handleTextInput` strikes a selection and inserts after it; commands
    `acceptAllSuggestions`, `rejectAllSuggestions`,
    `acceptSuggestionRange`, `rejectSuggestionRange`).
  * `web/app/src/pages/docs/drawing.ts` + `DrawingDialog.tsx`: an Excalidraw
    scene stored as a block node rendered as `img.doc-drawing`.
  * `Collaboration` (Yjs) and `CollaborationCursor` (awareness).
* UI surfaces: `MenuBar.tsx` (File/Edit/View/Insert/Format/Tools/Help; several
  items still `disabled`: Show ruler, Show non-printing characters, Building
  blocks, Smart chips, Chart, Spelling and grammar, Citations, Line numbers,
  Translate, Voice typing, Preferences, Accessibility), `Toolbar.tsx`
  (style select p/h1-h3, 7 fonts, font size, B/I/U, text color, highlight,
  link, image-by-URL, alignment, line spacing, lists, indent, clear
  formatting, Editing/Viewing chip), `EditorContextMenu.tsx`,
  `CommandPalette.tsx` (Alt+/), `dialogs.tsx` (Download, Emoji, Special
  characters, Page setup, Find-and-replace = replace-all only), `Ruler.tsx`
  (drags set *page* margins and a global first-line indent, not per-paragraph
  indents), `Outline.tsx`, `Footnotes.tsx` / `Endnotes.tsx` (textarea per
  note), `Comments.tsx`, `Suggestions.tsx`, `VersionHistory.tsx`,
  `ShareDialog.tsx`, `ShortcutsDialog.tsx`, `TemplateGallery.tsx`,
  `Presence.tsx`, `MarginEditor.tsx` (header/footer), `SharedDoc.tsx`
  (token-based read/edit), `DocList.tsx`.

### 1.2 Document model

* One flat ProseMirror document per doc: `doc > block+`. No section, page,
  column, field, bookmark, content-control, or equation node types.
* "Pages" are visual only: `web/app/src/pages/docs/editorStyles.ts`
  (`editorPageSx`) draws a Letter-sized sheet with a repeating gradient every
  page height; `DocEditor.tsx` estimates `pageCount = scrollHeight / pageH` for
  the optional page-number overlay. Orientation and top/bottom margins are
  React state (not persisted in the doc); left/right come from the ruler.
* Header and footer are two named Yjs `XmlFragment`s (`header`, `footer`)
  bound by `MarginEditor.tsx`; one header/footer per document.
* Footnote/endnote text lives in a node attribute (plain string), so notes
  cannot contain formatting, links, or tracked changes.
* Comment anchors are stored server-side as absolute `anchor_from/anchor_to`
  integers (`internal/docs/repository.go:398`) plus the `CommentMark` in the
  doc; the integers drift after edits.
* Suggestions are marks on text only: there is no record of formatting
  changes, paragraph splits/merges, table edits, or per-change ids/dates.

### 1.3 Collaboration and persistence

* Client: `web/app/src/pages/docs/collab.ts` opens `y-websocket` to
  `/api/v1/docs/d/<id>/connect` (`api.ts:collabBase`).
* Server: `internal/docs/collab.go` — a hub with one room per doc, broadcast
  of Yjs sync/awareness messages, persistence of data-carrying updates via
  `Repository.AppendUpdate`, replay of the update log to new peers.
  Unit-tested in `internal/docs/collab_test.go`.
* Postgres repository `internal/docs/repository.go`: docs, share tokens,
  per-user grants, versions (client-rendered **HTML snapshots**, auto every
  3 min or named), threaded comments, update log. gRPC/REST service
  `internal/docs/service.go`, contract `proto/grown/v1/docs.proto`.

### 1.4 Import / export / print

* `web/app/src/pages/docs/export.ts`: txt and html client-side; docx, odt,
  rtf, epub, md, pdf via `POST /api/v1/docs/convert`
  (`internal/server/server.go:883`, `internal/docs/convert.go`) which runs
  **pandoc** on the editor's HTML (tectonic for PDF; both in `flake.nix` and
  the `Dockerfile`). Because the source is rendered HTML, page setup, header/
  footer, footnote text, comments and suggestions are lost or flattened.
* Import (origin/main `c3e38aa`, `dac2186`): `DocList.tsx` has an "Import"
  button (`data-testid="docs-import"`) accepting .docx/.odt/.rtf/.epub/.md/
  .markdown/.txt/.html/.htm. `api.ts:importDoc` POSTs the raw file to
  `POST /api/v1/docs/import?from=<fmt>` (`internal/server/server.go:
  serveDocsImport`), which runs pandoc `-t html --embed-resources`
  (`internal/docs/convert.go:ImportToHTML`, 16 MB limit, images become data
  URIs). The client then creates a doc and seeds the editor through the same
  `sessionStorage docseed:<id>` channel templates use. Fidelity is bounded by
  pandoc's HTML writer plus TipTap's HTML parser: styles by name, numbering
  definitions, sections, headers/footers, footnote bodies, comments, tracked
  changes, fields and floating images do not survive. Six Go unit tests cover
  the importer (`internal/docs/convert_import_test.go`).
* Since M6 (§6.9), `.docx` import and export go through a direct
  client-side reader/writer (`web/app/src/pages/docs/docx/`) that keeps
  styles, list definitions, headers/footers, notes, comments and tracked
  changes; the pandoc endpoints above are its fallback.
* Print: `window.print()`; page breaks rely on CSS `break-after`.

### 1.5 Test infrastructure

* vitest 2 (`web/app/vite.config.ts` -> `test: { globals, environment:
  "jsdom", setupFiles: ["./src/test-setup.ts"] }`, `test-setup.ts` loads
  jest-dom). 16 test files exist across the SPA; **none** under
  `web/app/src/pages/docs/`.
* Playwright (`web/e2e/playwright.config.ts`, serial, `storageState` from
  `auth.setup.ts`), `web/e2e/docs.spec.ts` has **4** tests: typed text
  persists across reload, footnote marker + panel, header persists,
  suggesting marks insertions. Helpers `createDoc/trashDoc` in
  `web/e2e/helpers.ts`; `openDoc/runCommand` are local to the spec.
* Go: `internal/docs/{collab,repository,grants,service}_test.go`, plus
  `convert_import_test.go` on origin/main (round-trip per format, HTML
  pass-through, supported/unsupported, oversize, garbage input).

---

## 2. Feature inventory — OnlyOffice document editor vs Grown

Sources for the OnlyOffice column: `web-apps/apps/documenteditor/main/app/view/*`
(65 views), `main/locale/en.json` (`DE.Views.*`, `Common.Views.*`), and
`sdkjs/word/Editor/*`. Status legend: **Have** / **Partial** / **Missing**.
Grown paths are relative to the repo root; `docs/` below means
`web/app/src/pages/docs/`.

### 2.1 Text (run) formatting

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Bold, italic, underline, strikethrough | Toolbar | Have | `docs/Toolbar.tsx`, `MenuBar.tsx` |
| Subscript / superscript | Toolbar | Have | StarterKit + `extension-subscript/superscript` |
| Font family | Toolbar `tipFontName` (system + theme fonts) | Partial | 7 hard-coded fonts `docs/Toolbar.tsx:681` |
| Font size (numeric, inc/dec) | Toolbar | Have | `FontSize` ext `docs/extensions.ts:265` |
| Font color, highlight | Toolbar | Have | Color + Highlight |
| Paragraph shading / run background | Toolbar `tipPrColor`, `api-run SetShd` | Partial (M1) | paragraph `shading` attr + highlight (`docs/paragraphFormat.ts`, `textOps.ts`); no toolbar control yet |
| Change case (sentence/lower/UPPER/Capitalize/tOGGLE) | Toolbar `mni*Case`, `Editor/ChangeCase.js` | Have (M1) | `docs/textCase.ts`, Format > Text > Change case; keeps run marks |
| Double strikethrough, small caps, all caps | ParagraphSettingsAdvanced `strDoubleStrike/strSmallCaps/strAllCaps` | Missing | — |
| Character spacing, position, ligatures/OpenType | ParagraphSettingsAdvanced | Missing | — |
| Clear formatting / reset char | Toolbar `tipClearStyle`, shortcut `ResetChar` | Have | Ctrl+\ clears formatting; Ctrl+Space resets character formatting (M1) |
| Copy / paste format (format painter) | Toolbar `tipCopyStyle`, shortcuts `CopyFormat/PasteFormat` | Partial (M1) | Ctrl+Alt+C / Ctrl+Alt+V; no toolbar painter / sticky mode |
| Text direction LTR/RTL | Toolbar `textDirLtr/Rtl` | Missing | — |
| Language of text / document | Statusbar `tipSetLang`, ReviewChanges `txtDocLang` | Missing | — |
| Drop cap | DropcapSettingsAdvanced | Missing | — |
| Symbol table (font, range, hex, recent) | Common SymbolTableDialog | Partial | fixed 50-char grid `docs/dialogs.tsx:133` |
| Hyperlink dialog (display text, tooltip, internal targets) | HyperlinkSettingsDialog | Partial | `window.prompt` URL only `docs/Toolbar.tsx:801` |

### 2.2 Paragraph formatting

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Alignment L/C/R/J | Toolbar | Have | TextAlign |
| Line spacing multiples | Toolbar `tipLineSpace` | Have | `LineHeight` ext |
| Line spacing exact / at least | ParagraphSettings `textExact/textAtLeast` | Have (M3) | `docs/paragraphProps.ts` `lineRule`; Paragraph settings dialog |
| Space before/after (numeric) | ParagraphSettings, `api.js` add/remove space test | Have (M1) | `docs/paragraphFormat.ts`; add/remove before/after + Custom spacing dialog |
| "Don't add interval between same-style paragraphs" | ParagraphSettings | Missing | — |
| Left/right indent, first-line, hanging (per paragraph) | ParagraphSettings `strIndent*`, `styles/paraPr.js` | Have (M3) | left (M1) + `indentRight` / `indentFirstLine`; ruler drags the selected paragraphs' indents |
| Tab stops (pos, alignment, leader) | ParagraphSettingsAdvanced `strTabs`, `document-calculation/paragraph/tabs.js` | Partial (M3) | stored, edited (dialog) and shown on the ruler; rendered as one CSS `tab-size` until pagination lays tabs out (M9) |
| Keep with next / keep lines / widow-orphan / page break before | ParagraphSettingsAdvanced, `keep-next.js` | Partial (M3) | attributes + CSS `break-*` / `widows` (print); on-screen pagination is M9 |
| Paragraph borders & fill | ParagraphSettingsAdvanced `strBorders` | Have (M3) | `borders` attribute per side; shading (M1) |
| Outline level | ParagraphSettingsAdvanced | Have (M3) | `outlineLevel` attribute; Outline pane lists such paragraphs |
| Non-printing characters | Toolbar `mniHiddenChars`, shortcut `ShowAll` | Missing | menu item disabled `docs/MenuBar.tsx:270` |
| Hyphenation (auto, caps, limit, zone) | HyphenationDialog, `text-hyphenator.js` | Missing | — |
| Line numbers | LineNumbersDialog | Missing | menu item disabled |

### 2.3 Styles

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Built-in paragraph styles (Normal, H1-H9, Title, Subtitle, Quote, List Paragraph, ...) | Toolbar `tipParagraphStyle`, `Styles/default-styles.js` | Have (M3) | `docs/styles.ts` BUILTIN_STYLES (H1-H6; Title, Subtitle, Quote, Intense Quote, No Spacing, List Paragraph, Caption) |
| Style gallery with previews | Toolbar | Have (M3) | `docs/StyleGallery.tsx` |
| New style from selection / update from selection / delete / restore | Toolbar `textStyleMenu*`, StyleTitleDialog, `styleApplicator.js` | Have (M3) | `docModel.ts` create/update/deleteStyle |
| Style inheritance (basedOn, next style, numbering in style) | `styles/paraPr.js`, `numberingApplicator.js` | Have (M3) | `compileStyle` / `compileParaPr`; Enter applies `next` |
| Character styles | sdkjs | Have (M3) | `charStyle` mark |
| Displayed style for mixed selection | `styles/displayStyle.js` | Have (M3) | `displayStyle` in `styles.ts` |

### 2.4 Lists and numbering

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Bulleted / numbered / checklist | Toolbar | Have | StarterKit + TaskList |
| Nesting (indent/outdent) | Toolbar | Have | sink/liftListItem |
| Bullet library (8 markers), numbering library, multilevel templates (7) | Toolbar `tipMarkers*`, `tipMultiLevel*` | Have (M3) | `numbering.ts` LIST_LIBRARY, `ListMenu.tsx` |
| List settings (type, symbol, font, start at, restart, alignment, indent, follow with) | ListSettingsDialog, ListIndentsDialog | Have (M3) | List settings dialog (no per-level font / alignment UI yet) |
| Continue numbering / start new list / set numbering value / join / separate | DocumentHolder `textContinueNumbering...`, NumberingValueDialog | Have (M3) | restart / continue / set value (`docModel.ts`) |
| Numbering through style; numbered headings | `numberingApplicator.js`, `numberingCalculation.js` | Have (M3) | style `pPr.numId`, heading-linked multilevel lists |
| Autocorrect text to list (`* `, `- `, `> `, `1. `, `1.1.`, `1) `, `a. `, `A) `) | `numberingAutocorrect.js`, AutoCorrectDialog | Have (M3) | `1.1.`, `1)`, `1)1)`, `a.`, `A)`, `i.`, continue with `5.` / `e)`; `-/+/* ` and `1. ` stay TipTap lists, `> ` a quote |
| Change list level (keyboard) | Toolbar `textChangeLevel` | Have | Tab/Shift-Tab in TipTap lists |

### 2.5 Tables

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Insert table with size / custom / draw / erase | Toolbar, InsertTableDialog | Partial | M4: hover size picker (toolbar + Insert menu), `TableUI.tsx`; no draw/erase |
| Add/delete rows/cols, merge/split | TableSettings | Have | table extension commands |
| Cell background | TableSettings | Have | `TableCellBg` `docs/extensions.ts:543` |
| Border style/color per side, hidden borders | TableSettings `tip*`, Toolbar `mniHiddenBorders` | Have (M4) | table + cell borders, presets, `tables.ts` |
| Table style templates (grid/list/plain, banded, header/first/last) | TableSettings `txtTable_*` | Have (M4) | 10 Word-named templates + look switches, `tableModel.ts` |
| Column width / row height numeric, fixed layout grid | TableSettings `textCellSize`, `table-grid.js` | Have (M4) | `resolveFixedGrid`, `setColumnWidth`, `setRowHeight` |
| Distribute rows / columns | DocumentHolder | Have (M4) | `distributeRows/Columns` |
| Repeat header row on each page | TableSettings `strRepeatRow`, `table-header.js` | Partial (M4) | row attr + print CSS; on-screen repetition waits for M9 pagination |
| Cell margins, vertical alignment, table alignment/indent | TableSettingsAdvanced | Have (M4) | no table indent |
| Table position / wrap (inline vs flow) | TableSettingsAdvanced, `flowTablePosition.js` | Missing | — |
| Convert text to table / table to text | TextToTableDialog, TableToTextDialog | Have (M4) | `textToTable` / `tableToText` |
| Table formulas | TableFormulaDialog | Missing | — |
| Split table / nested tables | DocumentHolder `textNest` | Have (M4) | `splitTable` |
| Autofit to contents/window | TableSettingsAdvanced | Have (M4) | `autofitTable` |
| Bad-table correction (vMerge) on load | `correctBadTable.js` | Have (M4) | `correctBadTable` (docx) + `normalizeTable` (paste/import) |

### 2.6 Images, shapes, drawings, SmartArt, charts, text art

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Image from file / URL / storage | Toolbar `mniFrom*`, ImageSettings | Partial | URL prompt + paste/drop (data URL, `docs/extensions.ts:240`); no file picker, no Drive storage |
| Resize / crop / rotate / flip / actual size / fit margins | ImageSettings | Missing | — |
| Wrapping style (inline, square, tight, through, top-bottom, behind, in front) | ImageSettings `txt*` | Missing | inline only |
| Alignment, arrange (bring forward/back), group | Toolbar `capImg*` | Missing | — |
| Alt text | ImageSettingsAdvanced `textAlt` | Missing | — |
| Replace image / save as picture | DocumentHolder | Missing | — |
| Shapes (gallery, fill, line, shadow, edit points, merge shapes) | ShapeSettings, Toolbar `capShapesMerge` | Partial | freeform via Excalidraw `docs/DrawingDialog.tsx` only |
| Text box (horizontal/vertical) | Toolbar `tipInsertText` | Missing | — |
| SmartArt | Toolbar `capBtnInsSmartArt` | Missing | — |
| Charts (insert, edit data, type, axes, legend, trendlines) | ChartSettings, ExternalDiagramEditor | Missing | menu item disabled |
| Text Art | TextArtSettings | Missing | — |
| Insert spreadsheet (OLE) | Toolbar `mniInsertSSE` | Missing | — |

### 2.7 Headers and footers

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Edit header / footer | HeaderFooterTab | Partial | one global header + footer via Yjs fragments `docs/MarginEditor.tsx` |
| Different first page / odd-even | HeaderFooterSettings | Missing | — |
| Link to previous (per section) | HeaderFooterSettings `textSameAs` | Missing | — |
| Header from top / footer from bottom distances | HeaderFooterSettings | Missing | — |
| Page number field (position, format, start at) | HeaderFooterSettings, PageNumberingDlg | Partial | overlay labels toggle `docs/DocEditor.tsx:105`, not a field |
| Number of pages, date/time, other fields, image in header | HeaderFooterTab | Missing | — |

### 2.8 Sections, columns, page layout

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Page size presets + custom | PageSizeDialog | Missing | Letter only `docs/editorStyles.ts:676` |
| Orientation | Toolbar `capBtnPageOrient` | Have | global, not persisted in doc |
| Margins presets / custom / gutter / mirror | PageMarginsDialog | Partial | numeric T/B/L/R, global, not persisted |
| Sections + section breaks (next/continuous/odd/even) | Toolbar `textInsSectionBreak`, `Editor/sections` | Missing | — |
| Columns (1/2/3/left/right/custom, spacing, divider) + column break | CustomColumnsDialog, `api-section.js` | Missing | — |
| Page break | Toolbar | Have | `PageBreak` node (CSS only) |
| Blank page | Toolbar `capBtnBlankPage` | Missing | — |
| Page color, watermark | Toolbar, WatermarkSettingsDialog | Missing | — |
| True pagination (content reflow across pages) | `Editor/Layout/*`, document-calculation tests | Missing | page count is a height estimate |
| Page thumbnails, zoom, fit page/width | PageThumbnails, Statusbar | Missing | — |
| Rulers (toggle, paragraph indents, tab stops) | ViewTab `textRulers` | Partial | `docs/Ruler.tsx` drives page margins; toggle disabled |
| Print layout vs pageless | Google reference | Missing | — |

### 2.9 Footnotes and endnotes

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Insert footnote / endnote | Links `mniIns*` | Have | `docs/extensions.ts:386/463` |
| Auto numbering | sdkjs `Footnotes.js` | Have | CSS counters |
| Rich note body (formatting, links, cursor navigation) | sdkjs `FootEndNote.js` | Partial | plain textarea `docs/Footnotes.tsx` |
| Notes settings (format, start at, restart each page/section, location) | NoteSettingsDialog | Missing | — |
| Convert footnotes <-> endnotes, swap, delete all | Links `textConvertTo*`, NotesRemoveDialog | Missing | — |
| Go to footnote/endnote | Links | Have | click marker |

### 2.10 References: TOC, captions, cross-references, bookmarks, fields

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Outline / navigation pane | Navigation | Have | `docs/Outline.tsx` (no promote/demote/select) |
| Table of contents in document (levels, styles, page numbers, leader, update) | TableOfContentsSettings, `Editor/ComplexFields` | Missing | — |
| Table of figures | TableOfContentsSettings `textTitleTOF` | Missing | — |
| Captions (label, numbering, chapter) | CaptionDialog | Missing | — |
| Cross-references (heading, bookmark, footnote, caption, numbered item) | CrossReferenceDialog, `api/cross-ref.js` | Missing | — |
| Bookmarks (add, go to, get link) | BookmarksDialog, `Editor/Bookmarks.js` | Missing | — |
| Fields (insert, toggle codes, update all F9) | DocumentHolder `textFieldCodes`, shortcut `UpdateFields` | Missing | — |
| "Add text" (heading outline level for TOC) | Links `capBtnAddText` | Missing | — |

### 2.11 Track changes / review

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Track insertions / deletions | ReviewChanges `txtTurnon`, `revisions/*.js` | Have | `docs/suggesting.ts` (ids and dates since M5) |
| Accept / reject current, all; next / previous | ReviewChanges | Have (M5) | `docs/Suggestions.tsx`, commands in `suggesting.ts` |
| Tracked formatting changes | sdkjs `RevisionsChange.js` | Have (M5) | `formatChange` mark |
| Tracked paragraph split/merge, table and structural changes | `revisions/document-content.js` | Partial (M5) | paragraph marks and paragraph properties tracked; list wrapping, tables and block objects are not |
| Author, date, change type in balloons/popover | ReviewPopover | Have (M5) | `docs/ReviewPopover.tsx` |
| Display modes (Markup + balloons, only markup, Final, Original) | ReviewChanges `txtMarkup*` | Have (M5) | `review-<mode>` CSS; Original can't show old formatting |
| Track on for me / for everyone | ReviewChanges `txtOn/txtOnGlobal` | Have (M5) | `review` Yjs map + per-user default (`docs/review.ts`) |
| Review in header/footer/notes | shortcuts test | Partial (M5) | header/footer tracked; note bodies are strings (F1) |
| Compare documents / combine | ReviewChanges `txtCompare/txtCombine`, `Editor/Comparison.js`, `Merge.js` | Missing | — |

### 2.12 Comments

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Anchored comments, replies, resolve/reopen, delete | Common Comments | Have | `docs/Comments.tsx`, `internal/docs/repository.go:398` |
| Edit comment text | Comments `textEdit` | Missing | — |
| Sort (author/date/position) and filter | Comments `mni*` | Missing | — |
| Mentions (+user), notify | ReviewPopover `textMention` | Missing | — |
| Document-level comment (no anchor) | Comments `textAddCommentToDoc` | Missing | — |
| Delete/resolve all / mine | ReviewChanges `txtCommentRem*` | Missing | — |
| Comments inside header/footer/notes | sdkjs | Missing | — |
| Anchor stability under concurrent edits | sdkjs `Comments.js` | Partial | absolute ints drift; mark ids exist |

### 2.13 Compare / merge / mail merge

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Compare (from file/URL/storage, settings) | ReviewChanges, CompareSettingsDialog | Missing | — |
| Combine documents | `merge-documents/mergeDocuments.js` | Missing | — |
| Mail merge (data source, fields, preview, merge to docx/pdf/email) | MailMergeSettings, MailMergeEmailDlg | Missing | — |

### 2.14 Content controls and forms

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Content controls: plain text, rich text, picture, checkbox, combo, dropdown, date | Toolbar `capBtnInsControls`, ControlSettingsDialog, `content-control/*` | Missing | — |
| Control settings (title, tag, appearance, color, lock) | ControlSettingsDialog | Missing | — |
| Forms: text field (mask/regex/format/comb), checkbox, radio, combo, dropdown, image, email, phone, zip, credit card, date, signature, complex field | FormsTab, FormSettings, `forms/*.js` | Missing | Grown has a separate Forms app, not in-document fields |
| Required fields, roles/recipients, filling status, submit, save as PDF form | FormsTab, RolesManagerDlg, FillingStatusSettings | Missing | — |
| Custom XML data binding | `custom-xml/*`, `Editor/custom-xml` | Missing | — |
| Document protection (read-only / comments / forms / tracked, password) | ProtectDialog, DocProtection | Missing | — |
| Digital signatures, encryption | SignatureSettings, Protection, PasswordDialog | Missing | — |

### 2.15 Equations

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Insert equation (gallery, toolbar) | Toolbar `capBtnInsEquation` | Done (M11) | Insert ▸ Equation, toolbar Σ, Ctrl+Alt+=, equation panel templates (§6.12) |
| Unicode / LaTeX linear input with autocorrect | `math-autocorrection.js` (878 cases), `Editor/Math.js` | Done (M11) | `math/linear.ts`, `math/autocorrect.ts`, `math/latex.ts` |
| Equation context menu (fractions, brackets, limits, scripts, matrix, ...) | DocumentHolder `txt*` (approx. 60 items) | Partial (M11) | `math/EquationMenu.tsx`: linear/professional, display/inline, fraction kind, limit position, brackets, matrix rows/columns |
| MathML import | `math-ml.js` | Done (M11) | `math/mathml.ts` (also MathML export) |
| Change case inside math | `change-case.js` Math module | Done (M11) | equations are left unchanged |

### 2.16 Autocorrect

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Replace-as-you-type table (custom pairs) | AutoCorrectDialog `textReplaceType` | Have (M2) | `docs/autocorrect.ts`, `AutoCorrectDialog.tsx` |
| Capitalize first letter of sentence / of table cells, exceptions | AutoCorrectDialog, `as-you-type.js` | Have (M2) | `docs/autocorrect.ts` |
| Smart quotes, `--` -> em dash, hyperlink recognition, double-space period | AutoCorrectDialog | Have (M2) | `docs/autocorrect.ts`; hyperlinks via TipTap autolink |
| Automatic bulleted / numbered lists | AutoCorrectDialog | Partial | see 2.4 |
| Math autocorrect, recognized functions | AutoCorrectDialog | Missing | — |
| Markdown-style input rules (`**bold**`, `# heading`, `> quote`, `---`) | (Google-style) | Have | StarterKit input rules |

### 2.17 Find / replace / spelling

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Find with highlighting, result count, next/previous | Common SearchPanel | Have (M2) | `docs/search.ts`, `docs/FindBar.tsx` |
| Case sensitive, whole words, regex | SearchPanel | Have (M2) | `docs/search.ts` |
| Replace one / replace all | SearchPanel | Have (M2) | `docs/search.ts`; matches may span runs |
| Replace preserving run formatting ("smart") | `js-api/api/replace-text-smart.js` | Have (M2) | `smartReplace` / `replaceTextSmart` in `docs/search.ts` |
| Spell check (as you type, dictionary, language) | ReviewChanges `txtSpelling`, `Editor/SpellChecker` | Missing | menu item disabled |

### 2.18 Keyboard shortcuts

OnlyOffice defines 107 shortcut actions (`sdkjs/word/apiDefines.js:223`,
`c_oAscDocumentShortcutType`); the test suite exercises 46 of them.

| Group | OnlyOffice | Grown | Note |
|---|---|---|---|
| Undo/redo, cut/copy/paste, paste text only, select all | 53-58, 67 | Have | TipTap defaults + `docs/editorActions.ts` |
| Bold/italic/underline/strike/sub/sup | 82-87 | Have | TipTap defaults |
| Heading 1-3 (Alt+1..3), bullets (Ctrl+Shift+L) | 88-91 | Have (grown-variant) | Ctrl+Alt+1-6 and Ctrl+Shift+8 (Google style); Ctrl+Shift+L stays align left |
| Increase/decrease font size | 93-94 | Have (M1) | Ctrl+Shift+. / Ctrl+Shift+, stepping 8…72 |
| Align L/C/R/J | 95-98 | Have | TextAlign defaults |
| Indent/unindent (Ctrl+M / Ctrl+Shift+M) | 100-101, 104-107 | Have (M1) | lists nest/lift, paragraphs indent; also Ctrl+] / Ctrl+[ |
| Page break (Ctrl+Enter), line break (Shift+Enter), column break | 42-43, 99 | Partial | page and line break (M1); column break M9 |
| Non-breaking space/hyphen, em/en dash, ©, ®, ™, ellipsis, € | 51-52, symbol shortcuts | Have (M1) | `docs/shortcuts.ts`; also Alt+X hex to character |
| Insert hyperlink (Ctrl+K), visit hyperlink | 65-66 | Partial | Ctrl+K opens prompt; visit via click |
| Insert footnote/endnote now, equation, page number | InsertFootnoteNow etc. | Partial | Ctrl+Alt+F / Ctrl+Alt+D notes (M1); equation M11, page number M9 |
| Copy/paste format (Ctrl+Alt+C/V) | 59-60 | Have (M1) | Ctrl+Shift+C stays Google's word count |
| Show non-printing (Ctrl+Shift+Num8), update fields (F9), save, print | 103, 18, 7-8 | Partial | print only |
| Navigation/selection by word/line/page/document, header/footer | 19-41, 68-81 | Have (browser) | native contenteditable |
| Reset char (Ctrl+Space) | 92 | Have (M1) | keeps links, comments and suggestions |
| Search menus (Alt+/), shortcuts (Ctrl+/), comment (Ctrl+Alt+M), history | Google style | Have | `docs/DocEditor.tsx:395` |

### 2.19 Import / export / print

OnlyOffice word formats (`sdkjs/common/commonDefines.js:468`): DOCX, DOC, ODT,
RTF, TXT, HTML, EPUB, FB2, MOBI, DOCM, DOTX, DOTM, FODT, OTT, OFORM, DOCXF,
MD, PDF, PDF/A, DJVU, XPS.

| Feature | Grown | Note |
|---|---|---|
| Export docx/odt/rtf/epub/md/pdf | Partial | pandoc from HTML (`internal/docs/convert.go`); loses page setup, header/footer, note bodies, comments, revisions, styles by name, numbering definitions |
| Export txt/html | Have | client-side `docs/export.ts` |
| Export fb2/mobi/dotx/ott/pdfa/xps | Missing | — |
| Import docx/odt/rtf/epub/md/txt/html | Partial | pandoc -> HTML -> new doc (`DocList.tsx` Import button, `api.ts:importDoc`, `internal/docs/convert.go:ImportToHTML`); same fidelity limits as export, always creates a new doc |
| Import doc/dotx/dotm/fodt/ott/fb2/mobi/xps/djvu/pdf | Missing | — |
| Open from Drive / open into existing doc | Missing | — |
| Print with preview, page range, print selection | Partial | `window.print()` only |
| Password-protected files | Missing | — |

### 2.20 Collaboration, history, sharing, misc UI

| Feature | OnlyOffice ref | Grown | Note |
|---|---|---|---|
| Real-time co-editing, cursors | Fast mode | Have | Yjs |
| Strict (save-to-sync) mode, element locks | ReviewChanges `strStrict` | n/a | not needed with CRDT |
| Version history with restore | Common History | Have | HTML snapshots `docs/VersionHistory.tsx` |
| Highlight deleted / detailed changes between versions | History `textHighlightDeleted` | Missing | — |
| Sharing / access rights | Header `tipAccessRights` | Have | `docs/ShareDialog.tsx` |
| Chat | Common Chat | n/a | separate Grown Chat app |
| Word count / statistics (pages, words, chars, paragraphs) | Statusbar | Partial | words only (alert) |
| Status bar (page x of y, zoom, language) | Statusbar | Missing | — |
| Dark document, interface theme | ViewTab | Missing | — |
| Text from file, date & time insert | Toolbar, DateTimeDialog | Missing | — |
| Plugins, macros (record, VBA convert) | Plugins, MacrosDialog, `plugins/pluginsApi.js` | Missing | — |
| Templates gallery | (Google) | Have | `docs/TemplateGallery.tsx` |
| Command palette | (Google) | Have | `docs/CommandPalette.tsx` |

---

## 3. Test inventory — OnlyOffice `tests/word/`

Counts were produced by grepping `QUnit.test(`, `QUnit.module(` and
`assert.<fn>(` in every file under
`research/onlyoffice/sdkjs-tests-v9.3.1/tests/word/` (67 `.js` files; 110 files
in total including 42 QUnit `.html` runner pages and a readme).

* Static `QUnit.test(` sites: **356**. Static assertion sites: **1,548**.
  Commented-out tests: 10 (3 in copypaste, 7 in math-ml). `QUnit.skip/only`: 1.
* `math-autocorrection/math-autocorrection.js` declares its tests inside a
  `Test(...)` helper that is invoked **846** times (plus 32 explicit tests and an
  unused `MultiLineTest` helper), so at runtime the suite has 878 tests.
  **Runtime total across `tests/word/`: 1,200** (356 - 2 helper definitions
  + 846 generated). All counts below are runtime counts.

Portability legend: **vitest** = pure model logic, re-expressible against a
headless TipTap editor in jsdom; **playwright** = needs real layout/mouse/
clipboard/UI; **n/a** = tests sdkjs-internal machinery (layout engine
geometry, text shaping, binary serialization, history internals) that has no
Grown equivalent and would not be built additively.

| OnlyOffice file | Tests | Asserts | Covers (behaviour) | Portability | Grown target | Milestone |
|---|---:|---:|---|---|---|---|
| api/api.js | 4 | 32 | AddText with/without wrapping spaces, RemoveSelection, GetSelectedText with paragraph separators; change numbering level; add/remove space before/after paragraph and the "have space" state; get text/selected text | vitest | `docs/__tests__/oo/api-text-ops.test.ts` | M1 |
| api/cross-ref.js | 1 | 5 | insert cross-reference to a block-level content control, field result text | vitest | `oo/cross-ref.test.ts` | M8 |
| api/textInput.js | 5 | 33 | EnterText / CorrectEnterText / composite (IME) input results; same in collaboration; with TextSpeaker; complex-script flag; inside a shape | mixed: 2 vitest (enter text + composition result), 3 n/a | `oo/text-input.test.ts` | M1 |
| change-case/change-case.js | 15 | 15 | Sentence/Upper/Lower/Toggle/Capitalize-words for whole paragraph and for a selection (10); same inside math (5) | vitest (10 in M1, 5 in M11) | `oo/change-case.test.ts` | M1 |
| common/common.js, document.js, editor.js, measurer.js | 0 | 8 | test harness (fake editor, measurer) | n/a (write own harness) | `docs/__tests__/harness.ts`, `measurer.ts` | M0 |
| content-control/block-level/cursorAndSelection.js | 1 | 33 | Backspace/Delete before/after a block-level content control, cursor placement | vitest | `oo/sdt-block-cursor.test.ts` | M10 |
| content-control/inline-level/checkbox.js | 1 | 22 | checkbox toggle text, toggle under track changes (add/remove review runs) | vitest | `oo/sdt-checkbox.test.ts` | M10 |
| content-control/inline-level/cursorAndSelection.js | 2 | 22 | placeholder behaviour on click/type; deleting a checkbox control | vitest | `oo/sdt-inline-cursor.test.ts` | M10 |
| content-control/inline-level/date-time.js | 1 | 6 | temporary (remove-on-edit) date control | vitest | `oo/sdt-date.test.ts` | M10 |
| copypaste/copy-paste-tests.js | 32 | 79 | paste plain text, HTML, internal format; copy HTML with JSON verification (simple/complex); list round-trips (simple, marked, numbered, multi-level); paste div/span styles, tables, ul, nested lists, images, bold/italic, underline/strike, links, nested elements, `<br>`, empty div, special chars, formula-as-text, mso styles; select-and-copy-back cases; Excel formula paste | mixed: 31 vitest (ProseMirror DOMParser/DOMSerializer), 1 n/a (internal binary) | `oo/copy-paste.test.ts` | M2 |
| custom-xml/custom-xml-common.js | 0 | 1 | harness | n/a | — | M10 |
| custom-xml/custom-xml-ooxml.js | 1 | 3 | rich-text control load/save via OOXML | n/a | — | none |
| custom-xml/custom-xml.js | 26 | 72 | block and inline controls bound to CustomXML (date, checkbox, combo, dropdown, picture, text) load/save, invalid date; XPath evaluation (11) | vitest (low priority) | `oo/custom-xml.test.ts` | M10 |
| document-calculation/floating-position/drawing.js | 2 | 22 | floating drawing positioning bugs | n/a (layout geometry) | — | none |
| document-calculation/keep-next.js | 2 | 16 | keepNext pushes paragraphs/tables to next page | vitest with mock measurer | `oo/pagination-keep-next.test.ts` | M9 |
| document-calculation/paragraph/line-height.js | 1 | 3 | line Y positions | n/a | — | none |
| document-calculation/paragraph/paragraph-lines.js | 6 | 65 | line breaking incl. CJK, narrow width, ligatures, combining marks | n/a (browser line breaking) | — | none |
| document-calculation/paragraph/paragraph-spacing.js | 1 | 9 | paragraph Y positions from spacing | n/a | — | none |
| document-calculation/paragraph/paragraph-wrap.js | 2 | 5 | wrap and first-line indent geometry | n/a | — | none |
| document-calculation/paragraph/tabs.js | 1 | 2 | left tab beyond right edge | n/a | — | none |
| document-calculation/table/correctBadTable.js | 1 | 4 | repair invalid vertical merges | vitest | `oo/table-normalize.test.ts` | M4 |
| document-calculation/table/flowTablePosition.js | 4 | 35 | flow table positions incl. inside tables, sections, header | n/a | — | none |
| document-calculation/table/pageBreak.js | 3 | 17 | table breaking across pages (border width, float, page-break-before) | vitest with mock measurer | `oo/pagination-table.test.ts` | M9 |
| document-calculation/table/table-flow.js | 1 | 7 | flow image beside table | n/a | — | none |
| document-calculation/table/table-grid.js | 6 | 18 | fixed-layout grid: shrink/expand columns from cell widths, max width across rows, auto cells, mixed, vMerge-continue ignored | vitest | `oo/table-grid.test.ts` | M4 |
| document-calculation/table/table-header.js | 1 | 19 | repeated header row on page break | vitest with mock measurer | `oo/pagination-table.test.ts` | M9 |
| document-calculation/text-hyphenator/hyphenation-service.js | 0 | 0 | harness | n/a | — | none |
| document-calculation/text-hyphenator/text-hyphenator.js | 6 | 4 | hyphenation: regular/edge cases, DoNotHyphenateCaps, ConsecutiveHyphenLimit, HyphenationZone | n/a (CSS hyphenation in Grown) | — | none |
| document-calculation/textShaper/textShaper.js | 1 | 13 | code point classification | n/a | — | none |
| forms/complexForm.js | 6 | 90 | complex form cursor/typing, fixed<->inline conversion, subforms, mouse clicks, all-required-filled, form-to-JSON | mixed: 2 vitest (required check, JSON), 4 playwright | `oo/forms-complex.test.ts`, `web/e2e/docs/oo-forms.spec.ts` | M10 |
| forms/forms.js | 7 | 95 | text-form formats (symbols/digits/letters/mask/regex), GetAllForms, remove/delete, format inside form, required filling, mask correction, GetAllFormsData/SetAllFormsData | vitest | `oo/forms.test.ts` | M10 |
| image-smartart-placeholder/smartartImagePlaceholders.js | 2 | 2 | SmartArt image placeholders | n/a | — | none |
| js-api/api-color.js | 3 | 34 | ApiColor class/auto/theme, RGB/hex, JSON | n/a (builder API) | — | M13 |
| js-api/api-document-content.js | 1 | 2 | GetText of document content | vitest | `oo/api-text-ops.test.ts` | M1 |
| js-api/api-drawing.js | 11 | 31 | flipH/V, stroke, relative width/height, horizontal/vertical position, name, select/unselect | vitest | `oo/drawing-attrs.test.ts` | M7 |
| js-api/api-inline-level-sdt.js | 2 | 6 | control border/background color | vitest | `oo/sdt-appearance.test.ts` | M10 |
| js-api/api-paragraph.js | 5 | 18 | ParaId, GetText, shading, GetRange, color | mixed: 4 vitest, 1 n/a (ParaId) | `oo/paragraph-props.test.ts` | M3 |
| js-api/api-range.js | 3 | 14 | range GetText/AddText, color, shading | vitest | `oo/api-text-ops.test.ts` | M1 |
| js-api/api-run.js | 3 | 13 | run GetText/AddText, color, shading | vitest | `oo/api-text-ops.test.ts` | M1 |
| js-api/api-section.js | 1 | 3 | columns count/spaces/widths | vitest | `oo/sections.test.ts` | M9 |
| js-api/api-table-cell.js | 1 | 5 | cell color | vitest | `oo/table-cell-props.test.ts` | M4 |
| js-api/api-text-form.js | 5 | 19 | placeholder, delete, border/background color, lock | vitest | `oo/forms.test.ts` | M10 |
| js-api/api/replace-text-smart.js | 2 | 7 | replace selection text while preserving per-run formatting; same with revisions on | vitest (1 in M2, 1 in M5) | `oo/replace-smart.test.ts` | M2 |
| js-api/common.js, js-api/forms.js | 0 | 0 | harness | n/a | — | — |
| math-autocorrection/common.js | 0 | 0 | harness | n/a | — | M11 |
| math-autocorrection/math-autocorrection.js | 878 | 131 static (generated at runtime) | Unicode linear input -> structure (degree, above/below, box/rect, underbar, brackets, fractions, horizontal brackets, radicals, operators, n-ary, functions, matrix, accents, binomial), LaTeX input, cursor positions after conversion, undo, bugs | vitest (table-driven) | `oo/math-autocorrect.test.ts` | M11 |
| math-ml/math-ml.js | 53 | 57 | Presentation MathML import: core attrs, token elements (mi/mn/mo/mtext/ms), mfrac, msqrt, mroot, merror, mpadded, mphantom, mfenced, menclose, sub/sup, under/over, mtable normalization | vitest | `oo/mathml-import.test.ts` | M11 |
| merge-documents/binaryTestDocuments.js | 0 | 0 | binary fixtures | n/a (write own fixtures) | — | M12 |
| merge-documents/mergeDocuments.js | 2 | 2 | combine two documents (word / symbol level) | vitest, rewritten with own HTML fixtures | `oo/combine-documents.test.ts` | M12 |
| numbering/numberingApplicator.js | 4 | 15 | numbering through style; numbered headings; apply by selection vs cursor; paragraphs with left indent | vitest | `oo/numbering-apply.test.ts` | M3 |
| numbering/numberingAutocorrect.js | 3 | 6 | `* `, `- `, `> `, `1. ` .. 9 levels, `1) `, `a. `, `a) `, `A. `, `A) ` -> list; non-triggers; continue previous numbering | vitest | `oo/numbering-autocorrect.test.ts` | M3 |
| numbering/numberingCalculation.js | 2 | 26 | numbering text from style; numbering collection | vitest | `oo/numbering-calc.test.ts` | M3 |
| plugins/pluginsApi.js | 5 | 53 | addin fields (body, header/footer), RemoveFieldWrapper, SetEditingRestrictions, current word/sentence | mixed: 1 vitest (current word/sentence, M2), 4 n/a | `oo/text-selection-units.test.ts` | M13 |
| revisions/document-content.js | 5 | 16 | new paragraph under tracking; replace text in block sdt; accept-all when sdt content deleted; accept/reject when whole document deleted/added | vitest (3 in M5, 2 after M10) | `oo/revisions-document.test.ts` | M5 |
| revisions/paragraph.js | 2 | 11 | select+type / delete+type / backspace+type in one run and across runs -> review runs | vitest | `oo/revisions-paragraph.test.ts` | M5 |
| shortcuts/events.js | 0 | 0 | key event helpers | n/a (write own) | `docs/__tests__/keys.ts` | M0 |
| shortcuts/shortcuts.js | 40 | 165 | page/line/column break; reset char; special chars; text props; select all; paragraph props; notes; UI events; equation; page number; bullets; copy/paste format; undo/redo; non-printing; save; update fields; delete word; move/select; shapes; header/footer; disable shortcuts; forms; tables; chart title; math; tab; hyperlink visit; unicode->char; drag-and-drop reset | mixed: 28 vitest (jsdom keydown through TipTap keymap), 6 playwright, 6 n/a | `oo/shortcuts.test.ts`, `web/e2e/docs/oo-shortcuts.spec.ts` | M1 |
| styles/displayStyle.js | 5 | 1 | which style the UI displays for cursor / multi-paragraph / multi-run / spaces selections | vitest | `oo/style-display.test.ts` | M3 |
| styles/paraPr.js | 1 | 12 | style indents compiled; numbering overrides indent | vitest | `oo/style-compile.test.ts` | M3 |
| styles/styleApplicator.js | 1 | 8 | direct props + numPr + "update style from selection" propagate | vitest | `oo/style-apply.test.ts` | M3 |
| text-autocorrection/as-you-type.js | 2 | 2 | capitalize first letter of sentence (multi-script, after `! `), of table cells, with both flags in all combinations | vitest | `oo/autocorrect-as-you-type.test.ts` | M2 |
| unit-tests/deleted-text-recovery.js | 17 | 116 | reconstruct deleted text from history as review runs | mixed: 5 vitest re-expressed as version-diff, 12 n/a | `oo/version-diff.test.ts` | M12 |
| unit-tests/paragraphContentPos.js | 1 | 18 | CParagraphContentPos internals | n/a | — | none |

Totals by portability (runtime tests): **vitest 1,131** (of which 936 are
equations: math-autocorrect 878 + MathML 53 + change-case math 5),
**playwright 10**, **n/a 59**. Excluding equations the portable core is
**205** tests.

Where a suite says "harness" the OnlyOffice file is a helper library; Grown
writes its own equivalents (`harness.ts`, `keys.ts`, `measurer.ts`).

---

## 4. Architecture notes — where the current model limits parity, and the additive answer

Everything below is layered on the existing schema; nothing existing is
removed or renamed. Each item names the extension point in the current code.

1. **Pagination** (blocks: page numbers, TOC page numbers, keep-with-next,
   repeated table headers, print fidelity). Add a `Pagination` ProseMirror
   plugin (`docs/pagination.ts`) that measures rendered block heights after
   each view update, computes page boundaries with a `Measurer` interface,
   and emits *decorations* (page gaps, page-number widgets, header/footer
   widgets). The DOM measurer runs in the browser; a deterministic
   `MockMeasurer` (fixed line height per block) runs in vitest so keep-next
   and table-break cases become unit tests. Print continues to use CSS
   `@page` + `break-*` derived from the same attributes. Existing
   `editorStyles.ts` gradient and `pageCount` estimate stay as the fallback
   when the plugin is off.
2. **Sections / columns / page setup** (blocks: per-section size,
   orientation, margins, columns, headers). Add a `sectionBreak` block atom
   (like the existing `PageBreak`) carrying `sectPr`-shaped attrs, plus a
   `docSettings` Yjs map for the final section. A pure `sections.ts` derives
   `[ {from,to,props} ]` from the doc; the pagination plugin and CSS consume
   it. No wrapper node, so Yjs history and existing docs are untouched.
3. **Headers/footers per section and variant.** Keep the two existing
   fragments as the "default" of section 0; add fragments named
   `hf:<sectionId>:<default|first|even>` and a `linkToPrevious` flag in the
   section attrs. `MarginEditor.tsx` already binds by fragment name.
4. **Fields** (page number, num pages, date, TOC, cross-refs, captions,
   bookmarks). Add an inline `field` node (`instr`, `cached`) and a `bookmark`
   inline atom; a `fields.ts` updater recomputes `cached` on demand (F9) and
   the pagination plugin overrides page-dependent results via decorations.
   TOC is a block node whose children are regenerated by the updater.
5. **Paragraph properties and styles.** Extend `paragraph`/`heading` with
   additive attrs (`indent`, `tabs`, `keepNext`, `keepLines`, `widowControl`,
   `pageBreakBefore`, `border`, `shading`, `styleId`, `outlineLevel`,
   `spacingRule`) via `addGlobalAttributes`, exactly as `LineHeight` and
   `ParagraphSpacing` do today. Style definitions live in a `styles` Yjs map;
   a pure `compileParaPr(styleId, direct)` resolver mirrors OnlyOffice's
   compiled-properties tests and feeds generated CSS classes. A `charStyle`
   mark adds character styles.
6. **Numbering.** Keep nested `bulletList/orderedList` nodes; add attrs
   (`numId`, `lvlOverride`, `start`, `numFmt`, `lvlText`, `restart`) and a
   `numbering` Yjs map of list definitions. A pure `numberingText(doc,pos)`
   resolver produces "1.", "a)", "1.1." strings for tests, CSS counters, and
   export.
7. **Tracked changes v2.** Extend `InsertionMark`/`DeletionMark` with `id`
   and `date` attrs; add a `formatChange` mark (old attrs snapshot) and a
   `paragraphChange` attr for split/merge/props; add a `changes.ts` reducer
   that groups marks by id into logical changes for the panel, navigation and
   display modes. `Suggesting.appendTransaction` is extended to detect mark
   and attr steps, not only text insertion.
8. **Footnote/endnote bodies.** Keep the `footnote` atom; add an optional
   `bodyId` attr pointing at a Yjs fragment `note:<id>` so bodies can be rich
   and collaborative. Old string `content` is migrated lazily on first open
   (read old attr, write fragment). See flagged exception F1.
9. **Comment anchors.** Treat `CommentMark.commentId` as the source of truth
   and keep the server integers as a hint; add a Yjs relative-position pair
   in a `comments` map so anchors survive concurrent edits.
10. **Clipboard.** Add `clipboardTextParser/clipboardParser/clipboardSerializer`
    props in a `Clipboard` extension to normalise pasted HTML (Word/mso
    styles, nested lists, `<br>` runs, tables) and to emit rich HTML + text on
    copy. Testable with jsdom `DataTransfer` stand-ins.
11. **Find/replace.** A `search.ts` module walks `doc.textBetween` across
    nodes (fixing the single-text-node limitation of `replaceAll`), returns
    ranges, and a decoration plugin highlights them; "smart replace" maps
    the replacement onto existing mark runs.
12. **Import/export.** Keep the existing pandoc paths (`ConvertHTML`,
    `ImportToHTML`, `POST /api/v1/docs/convert|import`) for odt/rtf/epub/md/
    txt/html/pdf. Add a direct DOCX reader/writer (`docs/docx/`, client-side
    on JSZip, or Go-side behind the same endpoints) that maps OOXML to the
    additive attrs above (styles, numbering, sections, headers/footers,
    footnotes, comments, revisions, fields) so .docx fidelity no longer
    depends on HTML. The importer keeps producing editor content that flows
    through the existing `docseed:<id>` seed channel; nothing about the
    endpoint contract changes, only `from=docx` gets a higher-fidelity path.
13. **Equations.** A `math` inline node storing a linear string plus a
    parsed tree; the linear-format parser (Unicode/LaTeX) is a pure module
    (`docs/math/linear.ts`), which is exactly what the 878 OnlyOffice cases
    exercise. Rendering can use MathML (Chromium/Firefox/Safari now support
    MathML Core) so no rendering library is required initially.
14. **Content controls / forms.** `sdt` inline and block nodes with `sdtPr`
    attrs, a `Forms` extension for navigation, validation (mask/regex/format
    as pure functions), and a `protection` doc setting enforced by a
    `filterTransaction` plugin.
15. **Headless test editor.** `buildExtensions` gains an optional
    `{ collab: false }` flag that omits `Collaboration`/`CollaborationCursor`
    and re-enables StarterKit history, so vitest can construct an `Editor`
    in jsdom without a Yjs provider. This is a one-line additive option.

### Flagged exceptions (not planned; would need more than additive work)

* **F1 — footnote bodies as node content.** The cleanest model is a
  `footnoteBody` block node inside a doc-level notes section, which changes
  the top-level `doc` content expression and requires a migration of stored
  Yjs docs. The plan instead uses per-note Yjs fragments (item 8), which is
  additive but keeps note bodies outside the main ProseMirror document (so
  find/replace and tracked changes must be taught about them explicitly).
* **F2 — canvas/own layout engine.** OnlyOffice lays out text itself
  (`sdkjs/word/Editor/Paragraph_Recalculate.js`, `Layout/*`), which is what
  its 38 document-calculation tests exercise. Reproducing that inside
  ProseMirror would mean replacing the contenteditable view; not proposed.
  Consequence: 29 layout tests stay n/a and pagination is measurement-based
  (item 1), which is what Google Docs' web client also does.
* **F3 — flat run/paragraph model with per-element locks.** OnlyOffice's
  collaboration (strict mode, element locks) does not apply to a CRDT model;
  no work planned, tests n/a.
* **F4 — Yjs update log as the only source of truth for versions.** Versions
  are HTML snapshots today; version *diffing* (M12) works on HTML/PM docs and
  does not require switching to Yjs snapshots. Switching would be a data
  migration and is not planned.

---

## 5. Phased implementation plan

Ordering rationale: M0-M3 give the test harness plus the three things every
other feature depends on (text operations, clipboard/find, paragraph
properties/styles/numbering). M4-M6 are the most-used missing capabilities
(tables, real track changes, DOCX round-trip). M7-M9 are visible page
features. M10-M13 are large, self-contained subsystems that port big blocks of
tests but are used by fewer people. Sizes: S < 1 week, M 1-2 weeks,
L 2-4 weeks, XL > 4 weeks.

| # | Milestone | Scope (additive) | Tests ported (runtime count) | Size | Depends on |
|---|---|---|---|---|---|
| M0 | Test harness | `buildExtensions({collab:false})`; `docs/__tests__/harness.ts` (`makeEditor(html)`, `typeText`, `pressKey`, `selectRange`, `paragraphText`, `reviewText` tuples, `numberingText`); `keys.ts`; `MockMeasurer`; `web/e2e/docs/helpers.ts` (move `openDoc/runCommand` out of `docs.spec.ts`); `scripts/oo-parity.mjs` count script; `docs-status.md` generator; CI job | 0 | S | — |
| M1 | Text operations, change case, spacing, shortcuts | AddText/RemoveSelection semantics and `getSelectedText` with separators; 5 change-case ops preserving marks per run; numeric space before/after + "has space" state; bind shortcuts: Ctrl+Enter page break, Ctrl+Shift+. / , font size, Ctrl+M / Ctrl+Shift+M indent, Ctrl+Space reset char, nbsp/nb-hyphen, em/en dash, ©/®/™/…/€ , Ctrl+Shift+L bullets, F9 stub; `ShortcutsDialog` reflects bound keys | api 4, api-document-content 1, api-range 3, api-run 3, change-case 10, textInput 2, shortcuts 28 (+6 e2e) = **57** | M | M0 |
| M2 | Clipboard, find/replace, as-you-type autocorrect | `Clipboard` extension (paste HTML normalisation incl. mso, lists, tables, images, `<br>`; copy HTML/text serialisation; paste text only); `search.ts` + highlight decorations, next/prev, case/whole-word/regex, replace one/all, smart replace preserving runs; autocorrect engine (capitalise sentence/cell with exceptions, smart quotes, `--` -> —, double-space period, custom pairs) + AutoCorrect dialog; current word/sentence selection helpers | copypaste 31, replace-text-smart 1, as-you-type 2, pluginsApi 1 = **35** | L | M0 |
| M3 | Paragraph properties, styles, numbering | Paragraph attrs (indent L/R/first/hanging, tabs, spacing rules exact/at-least, keep*, widow, page-break-before, borders, shading, outline level); ruler bound to selected paragraphs; Paragraph settings dialog; `styles` Yjs map, `compileParaPr`, style gallery, new/update/delete style, character styles, Title/Subtitle/Quote; displayed-style resolver for mixed selections; `numbering` map, list attrs, bullet/number/multilevel libraries, list settings, continue/restart/set value, numbering via style and numbered headings, autocorrect `1.1.`, `1)`, `a.`, `A)` | numberingApplicator 4, numberingAutocorrect 3, numberingCalculation 2, displayStyle 5, paraPr 1, styleApplicator 1, api-paragraph 4 = **20** | L | M1 |
| M4 | Tables | Insert-table size picker; borders per side + style/color; table style templates; cell margins/vertical align; numeric widths + fixed-layout grid resolver; distribute rows/cols; repeat header row attr; autofit; split table; convert text<->table; bad-table normaliser on paste/import; table settings sidebar | table-grid 6, correctBadTable 1, api-table-cell 1 = **8** | M | M2 |
| M5 | Track changes v2 | Change ids/dates; tracked formatting (`formatChange` mark) and paragraph split/merge/props; grouped change list, next/prev, accept/reject current; display modes Markup/Simple/Final/Original; review popover with date; "on for everyone" via Yjs map; tracking in header/footer fragments; smart replace under tracking | revisions/paragraph 2, revisions/document-content 3, replace-text-smart 1 = **6** (+2 after M10) | L | M1, M2 |
| M6 | DOCX import/export fidelity | `docs/docx/` reader + writer mapping styles, numbering, paragraph/run props, tables, images, headers/footers, footnotes, comments, revisions, fields, sections; `from=docx` on the existing `/api/v1/docs/import` uses the direct reader while odt/rtf/epub/md/txt/html keep the pandoc path (already on origin/main); "Open" from Drive and import into an existing doc; export switches docx to the direct writer, other formats stay on pandoc; fixture-based round-trip tests alongside `convert_import_test.go` | 0 OnlyOffice tests (their converter tests are in `core/`), but unblocks fidelity for every later milestone | L | M3, M4, M5 |
| M7 | Images, shapes, charts | Upload to Drive storage instead of data URLs; resize handles, crop, rotate/flip, actual size; wrapping styles via float/absolute CSS + `wrap` attr; alignment/arrange; alt text; replace/save image; text box node; basic shape node (rect/ellipse/line/arrow with text) alongside Excalidraw drawings; chart node reusing `pages/sheets/chartData.ts`; image settings sidebar | api-drawing 11 = **11** | L | M2 |
| M8 | References and fields | `field` + `bookmark` nodes; bookmarks dialog; hyperlink settings (internal targets, display, tooltip); captions with auto-numbering; cross-reference dialog; TOC / table of figures nodes with update; "add text" outline levels; F9 update fields | cross-ref 1 (+ shortcut cases UpdateFields/InsertHyperlink/VisitHyperlink) = **1** | M | M3 |
| M9 | Page layout, sections, pagination | `sectionBreak` atom + `sections.ts`; page size presets/custom, margins presets/gutter/mirror, orientation per section, persisted in doc; columns + column break; page color, watermark; `Pagination` plugin + `MockMeasurer`; headers/footers per section/first/even + link to previous; page number / num pages / date fields; line numbers; hyphenation options (CSS `hyphens`, `hyphenate-limit-*`); keep-with-next/lines/widow honoured; status bar (page x/y, words, zoom); page thumbnails; print preview with ranges; pageless toggle | keep-next 2, table pageBreak 3, table-header 1, api-section 1 = **7** | XL | M3, M4, M8 |
| M10 | Content controls, forms, protection | `sdt` inline/block nodes (plain, rich, checkbox, combo, dropdown, date, picture) with placeholder/cursor/deletion rules and settings dialog; forms mode (text field mask/regex/format/comb, radio, image, email/phone/zip/credit-card presets, required, roles, fixed/inline, complex); fill/submit + JSON export (bridge to Forms app); document protection modes + password; custom XML binding (last) | content-control 5, forms 7, complexForm 2 (+4 e2e), api-text-form 5, api-inline-level-sdt 2, revisions sdt 2, custom-xml 26 = **49** (+4 e2e) | XL | M5 |
| M11 | Equations | `math` node; Unicode/LaTeX linear parser (`docs/math/linear.ts`) with autocorrect on space/operator, cursor placement rules, undo; MathML importer; equation toolbar + context menu (fraction forms, brackets, limits, scripts, matrix, accents); change case in math; Ctrl+Alt+= shortcut | math-autocorrect 878, math-ml 53, change-case math 5 = **936** | XL | M2 |
| M12 | Compare, combine, version diff, mail merge | Document diff (paragraph + run level) producing tracked changes; Compare (file/URL/Drive) and Combine; version history "highlight deleted"/detailed changes using the same diff; mail merge (Sheets/CSV source, merge fields, preview, merge to docx/pdf/email via existing mail service) | mergeDocuments 2 (own fixtures), deleted-text-recovery 5 (as version diff) = **7** | L | M5, M6 |
| M13 | Spell check, language, plugins, misc | Spell check worker (hunspell dictionaries) + language per run/doc; symbol table (font/range/hex/recent); date & time insert; drop cap; text from file; non-printing characters toggle; dark document; document statistics dialog; a minimal scripting API (`docs/api/`) behind a feature flag for plugins/macros | pluginsApi 4, api-color 3 = **7** | M | M6 |

Cumulative portable total after M13: 1,131 vitest + 10 Playwright = 1,141 of
1,200 (95%); the remaining 59 are n/a by design (F2/F3).

---

## 6. Test-porting approach

### 6.1 Layout and naming

```
web/app/src/pages/docs/__tests__/
  harness.ts            makeEditor(html, opts) -> TipTap Editor (collab off), helpers
  keys.ts               pressKey("Mod-Shift-.") dispatching through the view keymap
  measurer.ts           MockMeasurer for pagination tests
  fixtures/             Grown-authored HTML/JSON fixtures (never OnlyOffice files)
  oo/<suite>.test.ts    one file per OnlyOffice suite (see docs-tests.csv target)
  <feature>.test.ts     Grown-native unit tests not tied to an OnlyOffice case
web/e2e/docs/
  helpers.ts            openDoc, runCommand, typeInto (moved from docs.spec.ts)
  oo-<suite>.spec.ts    Playwright ports
```

Each ported case is titled with a stable tag so tooling can find it. The
tag is `oo:<path>#<case>`, where `<path>` is relative to
`sdkjs-tests-v9.3.1/tests/` and `<case>` is the QUnit test name. Each
OnlyOffice `QUnit.test` gets exactly one distinct tag. This is the unified
convention shared with Sheets and Slides; it replaces the bracketed form in
earlier drafts of this plan.

```ts
it("oo:word/change-case/change-case.js#Sentence case paragraph", () => {...});
test("oo:word/shortcuts/shortcuts.js#Check save", async ({ page }) => {...});
```

Table-driven suites (math autocorrect) use one `it.each` per OnlyOffice input
string with the tag `oo:word/math-autocorrection/math-autocorrection.js#<input>`
so every generated case is individually countable.

Assertion shape follows the behaviour, not the code: paragraph text via
`paragraphText(editor, i)`, review runs as `[["add","1QQQ4"],["common","test"]]`
tuples, numbering as strings ("1.", "a)"), compiled paragraph props as plain
objects. Fixtures are written by hand from the described inputs.

### 6.2 Tracking ported / passing against the OnlyOffice total

* `docs/plans/onlyoffice-parity/docs-tests.csv` (this plan) is the
  denominator: 1,200 runtime tests across 67 files, with portability and
  milestone per file.
* `scripts/oo-parity.mjs` (M0):
  1. parses the CSV;
  2. greps `[oo:<path>#<name>]` tags in `web/app/src/pages/docs/__tests__/**`
     and `web/e2e/docs/**` to compute *ported* per file;
  3. reads the vitest JSON reporter (`vitest run --reporter=json`) and the
     Playwright JSON reporter to compute *passing* per file;
  4. writes `docs/plans/onlyoffice-parity/docs-status.md` with per-file and
     per-milestone `ported / passing / total` plus the n/a count, and prints a
     one-line summary for CI (`docs parity: 57/1200 ported, 55 passing`).
* CI runs the script after `npm test` in `web/app`; Playwright numbers are
  merged when the e2e job runs. Regressions (passing count decreases) fail
  the job.
* n/a cases are never silently dropped: they stay in the CSV with
  `portability = n/a` and count toward the denominator so the percentage is
  honest.

### 6.3 Rules

* Read OnlyOffice tests to learn the behaviour; write Grown tests from
  scratch with Grown fixtures. Do not paste their strings verbatim beyond the
  inputs/expected outputs needed to express the case.
* One OnlyOffice test may become several Grown tests (or one `it.each`); the
  tag maps them back to a single row for counting.
* A ported test that cannot pass yet is committed as `it.skip` with the tag
  and a `TODO(Mx)`; skipped counts as ported-not-passing.
* Playwright ports use the existing `createDoc/trashDoc` API helpers and the
  `storageState` project; keep them serial like `docs.spec.ts`.

### 6.4 M0 status (harness landed)

* `buildExtensions({ collab: false })` builds the app's extension set without
  Yjs or a websocket, keeping ProseMirror history for undo. The app's call
  (no `collab` key) is unchanged.
* `web/app/src/pages/docs/__tests__/`: `harness.ts` (`makeEditor`,
  `typeText` via `handleTextInput`, `selectRange` / `selectText` /
  `selectInParagraph`, `paragraphText(s)`, `marksAt`, `blockPaths`,
  `htmlSnapshot` / `jsonSnapshot`), `keys.ts` (`pressKey("Mod-Shift-8")`
  dispatches a real keydown on the view, so it goes through every plugin
  keymap), `measurer.ts` (`MockMeasurer`, a monospace grid for M9), and
  `harness.test.ts` (self-tests).
* `web/e2e/docs/helpers.ts`: `openDoc`, `runCommand`, `typeInto` (moved out
  of `docs.spec.ts`).
* Change case helpers (`transformSelection`, `toTitleCase`) moved from
  `MenuBar.tsx` to `editorActions.ts` so tests can call them.
* First ports, 29 tagged cases, 11 passing and 18 skipped:
  `oo/change-case.test.ts` (15: 6 pass, 4 skipped for M1, 5 math skipped for
  M11), `oo/shortcuts.test.ts` (10: 4 pass, 6 skipped),
  `oo/api-text-ops.test.ts` (4 from `word/api/api.js`: 1 pass, 3 skipped).

### 6.5 Semantic differences found

Places where Grown's behaviour differs from OnlyOffice's. Open items have a
skipped test with a `TODO(Mx)`; items closed in M1 keep their row with the
resolution. "grown-variant" marks a deliberate difference: Grown keeps its
Google Docs binding or model and the ported test asserts Grown's behaviour.

| Case | OnlyOffice | Grown | Status |
|---|---|---|---|
| change-case: Sentence case, Toggle case (4 cases) | Five change-case modes | Five modes, `changeCase()` in `textCase.ts` | Done (M1) |
| change-case (Grown regression tests) | Case change keeps each run's formatting and the paragraph boundaries | Text nodes are rewritten in place with their own marks; words and sentences are judged with the paragraph's text as context | Done (M1) |
| change-case math (5 cases) | Equation text is left unchanged | Equation text is left unchanged (math nodes are atoms) | Done (M11) |
| shortcuts: Check text property change | Increase/decrease font size step through 10, 11, 12, 14, 16 | Ctrl+Shift+. / Ctrl+Shift+, step through 8…28, 36, 48, 72. OnlyOffice's own chords (Ctrl+] / Ctrl+[) stay Google Docs indent | Done (M1), grown-variant chord |
| shortcuts: Check paragraph property change | Alignment shortcuts toggle back; Ctrl+M / Ctrl+Shift+M indent by 12.5 mm; Alt+1-3 headings | Center/right/justify toggle back to left. Ctrl+M / Ctrl+Shift+M (and Ctrl+] / Ctrl+[) indent by 36pt (0.5in) steps via a paragraph `indent` attribute, or nest list items. Headings stay Ctrl+Alt+1-6. Ctrl+Shift+L is align left and does not toggle to the previous alignment | Done (M1); grown-variant: headings chord, indent step, left-align toggle |
| shortcuts: Check toggle bullet list | Ctrl+Shift+L | Ctrl+Shift+8 (Google Docs / TipTap); Ctrl+Shift+L stays align left | grown-variant, listed in ShortcutsDialog |
| shortcuts: page break, reset char, special characters | Ctrl+Enter, Ctrl+Space, symbol keys | All bound. Non-breaking hyphen is stored as U+2011 (OnlyOffice reports it as "-" in plain text). Alt+- / Alt+Shift+- added for en/em dash on keyboards without a numpad | Done (M1) |
| shortcuts: Check remove symbols, move/select, sending events | Model-level caret movement | Native contenteditable behaviour; ported to Playwright. Word-wise movement/deletion follows the host OS (Option on macOS, which stops at word ends); page-wise movement is left out (Grown's pages are one scrolling surface) | Done (M1, Playwright) |
| shortcuts: Check undo/redo history | Undo stack of the document | In the app, Yjs `UndoManager` handles undo; the headless harness uses ProseMirror history with the same keys | Note only |
| shortcuts: Check save | Save callback | Docs save continuously; Ctrl+S is swallowed and reported through `editor.storage.docShortcuts.onSave` | Done (M1) |
| shortcuts: Check copy/paste format | Format painter data | Ctrl+Alt+C / Ctrl+Alt+V copy and apply character formatting (no sticky painter mode yet) | Done (M1); sticky mode with M7's "reset actions" |
| api.js: Test AddText/RemoveSelection | `AddTextWithPr` with the wrap-with-spaces option | `addText(editor, text, { wrapWithSpaces })` in `textOps.ts` | Done (M1) |
| api.js: Test add/remove space before/after paragraph | Numeric space before/after, a "has space" state, style-aware | Numeric points per side; unset sides follow the block type's default (Normal 0/9pt, headings their margins). Headings stand in for OnlyOffice's paragraph style until M3 styles | Done (M1) |
| api.js: Get text/selected text | Includes a selection that ends inside an equation | Plain-text half passes; equation half n/a (equations are atoms; partial selection happens in the equation panel) | n/a (M11) |
| api.js: Change numbering level | Enter in an empty list item ends the list at level 1 and outdents at deeper levels | Same behaviour (passes) | — |
| api-run / api-range: SetColor, SetShd | RGB, hex, theme and auto colours; range shading on a whole paragraph shades the paragraph | RGB/hex and auto (= none) pass. Grown has no document theme, so theme colours are n/a. Whole-paragraph ranges set a paragraph `shading` attribute, partial ranges a highlight | Done (M1); theme colours n/a |
| textInput.js: TextSpeaker, complex script, in-shape | Screen-reader hook, script runs, shape text | No equivalents (browser shapes text; no shapes until M7) | n/a |

### 6.6 M1 status (text operations, change case, spacing, shortcuts)

* **Change case**: `textCase.ts` (`changeCase`, `CASE_MODES`) with Sentence
  case, lowercase, UPPERCASE, Capitalize Each Word and tOGGLE cASE, keeping
  per-run marks and paragraph structure; Format > Text > Change case lists
  all five.
* **Text operations**: `textOps.ts` — `addText` (wrap with spaces),
  `getText` / `getSelectedText` with paragraph / line-break / tab / table
  cell and row separators, `correctEnteredText`, runs, text colour, run and
  paragraph shading, Alt+X `unicodeToChar`.
* **Paragraph format**: `paragraphFormat.ts` — numeric space before/after
  (points, per side, block-type defaults), add/remove space and
  `hasSpaceBefore/After`, a Custom spacing dialog, paragraph `indent`
  (36pt steps) and `shading` attributes. Format > Line & paragraph spacing
  shows Add/Remove space before/after from the current state.
* **Shortcuts**: `shortcuts.ts` (`DocShortcuts`, `TabCharacter`,
  `SHORTCUT_GROUPS`). `ShortcutsDialog` renders `SHORTCUT_GROUPS`, and
  `__tests__/shortcuts-dialog.test.ts` presses every listed editing chord so
  the dialog can't drift from the keymap. DocEditor binds the listed
  Ctrl+H, Ctrl+K and Ctrl+Shift+C.
* **Harness**: `compose` / `composeText` (IME composition),
  `makeSyncedEditors` (editors on separate Yjs docs, synced on demand;
  `buildExtensions({ collab: false, ydoc })`), `NumpadSubtract` in `keys.ts`.
* **Tests**: 66 tagged cases across the M1 suites (api 4, textInput 2,
  change-case 15, api-document-content 1, api-range 3, api-run 3, shortcuts
  38). Passing: 43 (39 vitest + 4 Playwright). Skipped with a later
  milestone: change-case math 5 (M11) and 18 shortcuts cases (M7–M13). Not
  tagged (n/a): shortcuts "Check disable shortcuts" and "Check reset
  drag'n'drop"; textInput TextSpeaker, complex-script and in-shape.
* **Playwright**: `web/e2e/docs/oo-shortcuts.spec.ts` (remove symbols,
  move/select, UI events, plus a Ctrl+Enter / Ctrl+Shift+. / Ctrl+Space /
  symbols check with a screenshot). The "Desktop Chrome" device reports a
  Windows platform, so app chords use Ctrl even on a macOS host while
  native caret movement follows the host.

### 6.7 M2 status (clipboard, find/replace, as-you-type autocorrect)

* **Clipboard**: `clipboard.ts` — the `ClipboardHandling` extension runs
  `normalizePastedHTML` on every HTML paste (Word/Excel/Google Docs: drops
  `<head>`/`<style>`/comments, `v:*`/`o:*` Office markup and `file:`/`cid:`
  images; turns `mso-list` paragraphs into nested `<ul>`/`<ol>` and drops
  the typed markers; page-break `<br>`s become page breaks; `mso-highlight`
  / background spans become highlights; colour/font set on a block moves to
  a span so it survives; strips `Mso*` classes, `lang`, `mso-*` CSS) and
  serialises copies as semantic HTML (page breaks go out as Word's
  page-break `<br>`) plus plain text (`sliceToText`: "\n" between blocks,
  "\t" between cells, "• " / "1. " / "☐ " list prefixes). Paste as plain
  text is ProseMirror's shift-paste (Ctrl+Shift+V) or `pastePlainText`;
  Edit > Paste / Paste without formatting now go through the same pipeline
  (`view.pasteHTML` / `pasteText`). `Image` accepts data URLs.
* **Find & replace**: `search.ts` — `findMatches` (per textblock, across
  runs; match case, whole words, regex), the `Search` extension (highlight
  decorations `.search-match` / `.search-match-current`, `setSearch`,
  `findNext` / `findPrevious` wrapping, `replaceCurrent`,
  `replaceAllMatches` in one undo step, `$1`/`$<name>` in regex mode) and
  `smartReplace` / `replaceTextSmart`, which keep each surviving
  character's formatting and give new characters the formatting of what
  they replace. `FindBar.tsx` is a floating bar (Ctrl+F find, Ctrl+H with
  replace, Enter / Shift+Enter, Esc) with an "n of m" count; it replaces
  the replace-all-only dialog.
* **AutoCorrect**: `autocorrect.ts` — as-you-type engine on
  `handleTextInput` (+ Enter): capitalise sentence starts (exceptions list,
  single-letter initials, no Georgian, not inside URLs/mixed-case words),
  first letter of table cells (own option), smart quotes, `--` → —,
  double-space period (off by default), replacement list (symbol entries
  such as `(c)`, `->`, `...` fire on their last character, word entries on
  a word end). Backspace straight after a correction restores the typed
  text. Code blocks and inline code are skipped. `AutoCorrectDialog.tsx`
  (Tools > AutoCorrect options…) toggles every option and edits the
  replacement list and exceptions; settings persist per user in
  localStorage (`grown.docs.autocorrect.v1:<user id>`).
* **Current word / sentence**: `textUnits.ts` — get / replace / select the
  word or sentence at the caret, whole or the part before / after it.
* **Tests**: 37 tagged cases, 34 passing, 3 skipped:
  `oo/copy-paste.test.ts` 32 (30 pass; the upstream-commented "Newton’s
  binom formula" and "footnote formula" cases are skipped for M11),
  `oo/replace-smart.test.ts` 2 (1 pass; "with revisions" passes since M5),
  `oo/autocorrect-as-you-type.test.ts` 2, `oo/text-selection-units.test.ts`
  1 (pluginsApi "CurrenWord/CurrentSentence"; its hidden PAGE-field
  sub-case waits for M8 fields). Grown-native: `search.test.ts`,
  `autocorrect.test.ts`, Word-list / Google Docs / plain-text cases in
  `copy-paste.test.ts`, selection cases in `text-selection-units.test.ts`.
  Playwright: `web/e2e/docs-find.spec.ts` (highlights, next/previous,
  whole word / match case, replace all; `--`, smart quotes, `(c)`,
  Backspace undo while typing).
* **Semantic differences**:

| Case | OnlyOffice | Grown | Status |
|---|---|---|---|
| copy-paste tag names | Several QUnit names contain double quotes | The scoreboard's tag syntax ends a case at a quote, so those tags drop the quotes (`#Test: callback tests paste plain text`) | Note only |
| copy-paste: paste into an empty document | Leaves the document's own empty paragraph after the pasted content | ProseMirror replaces the empty paragraph; no trailing paragraph | grown-variant |
| copy-paste: inline styles on paste | The test build stubs style processing, so `<span style="color:blue">` loses its colour | Colours, fonts and sizes on spans (and on blocks, moved to a span) are kept | grown-variant |
| copy-paste: copy back | Word-style HTML with inline `mso-*` CSS and a `docData` payload | Semantic HTML (`<h1>`, `<strong>`, `<ul><li><p>`) plus a `data-pm-slice` attribute, which is Grown's "internal format" | grown-variant |
| copy-paste: images | Loaded asynchronously, so the test document stays empty | `<img>` becomes an image node at once (data URLs allowed); images pointing at the copier's disk are dropped | grown-variant |
| replace-text-smart: runs | Adjacent runs with the same formatting stay separate runs | Adjacent text with equal marks is one run in ProseMirror, so `"e"` + `" Test"` read as `"e Test"` | Note only |
| replace-text-smart: with revisions | Smart replace under tracking | See §6.11 (word-level diff) | Done (M5), grown-variant |
| as-you-type: which text is judged | `EnterText` doesn't trigger corrections; only the final Space does | Same in the ports (`addText`, then a typed space); in the app every word end triggers | Done (M2) |
| autocorrect: dashes | Word turns spaced ` - ` / ` -- ` into an en dash and `--` between words into an em dash | `--` always becomes an em dash | grown-variant |
| pluginsApi: current word/sentence around a hidden field | A PAGE field inside "Test" splits the word | No field node | M8 |

TipTap 2 note: extension `storage` is shared by every editor built from the
same extension object, so per-editor state (AutoCorrect settings) lives in a
`WeakMap` keyed by editor instead.

### 6.8 M3 status (paragraph properties, styles, numbering)

* **Paragraph properties**: `paragraphProps.ts` — additive attributes on
  paragraphs/headings: `indentRight`, `indentFirstLine` (negative =
  hanging), `lineRule` (auto / exact / at least, with the M1 `lineHeight`
  value), `tabs` (`"72l,144c.,216r"`), `keepNext`, `keepLines`,
  `widowControl`, `pageBreakBefore` (stays with the first half of a split),
  `borders` (JSON per side) and `outlineLevel`. All values are strings or
  numbers so y-prosemirror compares them without churn; all render as
  inline CSS / data attributes and parse back from HTML.
  `setParagraphProps` / `setIndents` commands; `ParagraphDialogs.tsx`
  (Format > Paragraph settings…: indents & spacing, line & page breaks,
  borders & shading, tabs). The ruler binds to the selected paragraphs
  (triangles = paragraph indents, tab stops drawn, page margins drag from
  the shaded ends).
* **Styles**: `styles.ts` — a `styles` Yjs map holds custom styles and
  overrides of built-ins (Normal, No Spacing, Title, Subtitle, Heading
  1-6, Quote, Intense Quote, List Paragraph, Caption; character styles
  Emphasis, Strong, Subtle/Intense Emphasis, Book Title); nothing is seeded
  into existing docs. Paragraphs carry `styleId`; a heading without one is
  "Heading N", so existing headings are the Heading styles (a style based
  on Heading N makes a level-N heading node). `compileParaPr` resolves
  list level, style chain, "numbering off" and direct properties in Word's
  order; `styleCss` generates per-editor CSS; `displayStyle` implements
  OnlyOffice's mixed-selection rules. `StyleGallery.tsx` replaces the
  toolbar's style select (previews, update to match, new from selection,
  delete / restore); Enter applies a style's `next` style; Ctrl+Alt+0-6 and
  Format > Paragraph styles go through the style model.
* **Numbering**: `numbering.ts` — a `numbering` Yjs map with abstract lists
  (nine levels: format, level text, start, indents, linked style) and
  instances (start overrides); paragraphs join with `numId`/`numLvl` or via
  their style (`numId` "0" = off). Libraries: 8 bullets, 7 numberings,
  7 multilevel lists (3 heading-linked). `docModel.ts` wires it to TipTap:
  labels are node decorations (`.doc-num[data-num]`), apply / remove /
  restart / continue / set value / level (Tab, Shift+Tab, Enter on an empty
  item, Backspace at the start), and list autocorrect. TipTap's
  bullet/ordered lists are unchanged and still used by the toolbar buttons,
  `- `, `* ` and `1. `. `ListMenu.tsx` (toolbar list library) and the List
  settings / Set numbering value dialogs.
* **Export**: `exportBodyHtml` writes compiled style CSS inline, wraps
  styled paragraphs in `<div data-custom-style>` (pandoc maps it to a DOCX
  paragraph style; character styles likewise on spans) and writes list
  labels as text, so HTML/DOCX/ODT/PDF exports keep the look until M6's
  direct DOCX writer.
* **Tests**: 20 tagged cases, all passing: `oo/numbering-apply.test.ts` 4,
  `oo/numbering-autocorrect.test.ts` 3, `oo/numbering-calc.test.ts` 2,
  `oo/style-display.test.ts` 5, `oo/style-compile.test.ts` 1,
  `oo/style-apply.test.ts` 1, `oo/paragraph-props.test.ts` 4
  (api-paragraph; "ParaId" is n/a). Grown-native: paragraph-property
  cases in `oo/paragraph-props.test.ts` (render/parse round trip, Yjs
  sync) and `styles-numbering.test.ts` (heading mapping, next style,
  new/update/delete, character styles, list keys, restart/continue/set
  value, Yjs persistence of styles and lists, export). Playwright:
  `web/e2e/docs-styles.spec.ts` (gallery styles + autocorrect list +
  library multilevel list persist across reload; Paragraph settings
  dialog). The Docs M2 AutoCorrect no longer capitalises a lone letter or
  roman numeral typed as a list marker ("a.", "i)").
* **Not yet**: per-level list font / number alignment UI, "don't add
  space between paragraphs of the same style", real tab-stop layout and
  on-screen keep/page-break pagination (M9), Heading 7-9, undo of style /
  list-definition edits (the Yjs `UndoManager` tracks the document
  fragment only), a direct `text-align: left` overriding a centred style
  (TipTap stores left as the default and renders nothing).
* **Semantic differences**:

| Case | OnlyOffice | Grown | Status |
|---|---|---|---|
| numberingApplicator: Numbering for headings; selecting vs placing cursor | Nine heading levels | Heading 1-6 (TipTap headings); the cases check six levels | grown-variant |
| numberingApplicator: paragraphs with left indentation | A first line indented further gets a deeper level ("i.", then "b. c. d.") | Lists apply at level 0 and replace direct indents with the list's; stays 1) 2) 3) 4) | grown-variant |
| numberingAutocorrect: `* `, `- `, `> ` | Bullets "·", "–", "Ø" | `* ` / `- ` start TipTap bulleted lists ("•"); `> ` starts a block quote (Google Docs) | grown-variant |
| numberingAutocorrect: roman numerals | Commented out upstream (TODO) | `i. ` / `I) ` start roman lists; `v. ` continues one | Done (extra) |
| paraPr / styleApplicator lengths | Millimetres | Points; the case numbers are kept | Note only |
| styleApplicator: update from selection | Style takes the paragraph's properties; direct numbering equal to the style's counts as the style's | Same: the style captures direct paragraph props and numbering, which leave the paragraph; a paragraph whose direct list equals its style's follows the style's indents | Done (M3) |
| api-paragraph: SetShd / SetColor theme colours | Theme colours | No document theme | n/a |
| api-paragraph: ParaId | `w14:paraId` | No equivalent identity | n/a |


### 6.9 M6 status (direct DOCX import and export)

* **Where it lives: the client** (`web/app/src/pages/docs/docx/`, TypeScript
  on JSZip, no new dependency). Grown's document model exists only in the
  browser: the body is ProseMirror/TipTap, styles and list definitions are
  the `styles` / `numbering` Yjs maps (M3), headers/footers are named Yjs
  fragments, and the server stores opaque Yjs updates it never interprets.
  A Go reader could only have produced HTML (the lossy path pandoc already
  gives) or had to re-implement the TipTap schema and synthesise Yjs
  updates server-side. In the browser the reader builds the editor's own
  JSON and map entries, and the writer reads the live model, so styles by
  id, `basedOn`/`next`, list instances and M3 paragraph attributes survive
  both ways. The Go endpoints are unchanged and remain the fallback.
* **Modules**: `xml.ts` (namespace-prefix-agnostic lookups, units,
  colours), `props.ts` (pPr/rPr ⇄ `DirectParaProps`/`RunPr`/marks, CT_PPr /
  CT_RPr element order), `read.ts`, `write.ts`, `apply.ts` (apply an import
  to an editor: maps, body, header/footer via y-prosemirror, comment threads
  created through the comments API and marks re-pointed at server ids;
  collect an editor's model for export, anchoring server comments without
  marks from their stored range), `seed.ts` (hand-off from the Docs home to
  the editor, in memory plus sessionStorage when it fits). `margin.ts`
  shares the header/footer schema with `MarginEditor`. Images gained
  optional `width`/`height` attributes (only the width renders).
* **Reader maps**: paragraph and character styles (built-ins matched by
  Word's English name, so a localised `styleId` still becomes Heading 1;
  `docDefaults` and theme fonts folded into the root style; only styles
  that are used, their ancestors and list-linked styles are imported; table
  and numbering styles skipped), headings from the style chain (a custom
  style based on Heading 1 is a level-1 heading with its `styleId`),
  `abstractNum`/`num` (formats, level text, start, indents, alignment,
  suffix, legal, linked styles, `startOverride`, full `lvlOverride` as a
  derived list, `numStyleLink`, Symbol/Wingdings bullets to Unicode),
  numbering through styles, every M3 paragraph attribute, run marks (bold,
  italic, underline, strike, sub/superscript, colour, size, font, highlight
  and shading, character style), tables (grid widths, `gridSpan`, `vMerge`,
  `hMerge`, `tblHeader` rows as header cells, cell shading, `gridBefore`),
  inline and anchored DrawingML pictures and VML images (data URLs, Word
  size), text-box content (kept after its paragraph), the default (else
  first-page) header and footer, foot- and endnotes (text), comments with
  replies and resolved state (`commentsExtended`), `w:ins`/`w:del`/moves as
  insertion/deletion marks with author, external and bookmark hyperlinks,
  simple and complex fields (result text; HYPERLINK fields become links),
  content controls / smart tags / customXml (unwrapped), page breaks and
  page-starting section breaks, equations as text. `javascript:`,
  `vbscript:`, `data:` and `file:` links are dropped.
* **Writer** is the inverse, with elements in schema order: numeric Grown
  list/note ids keep their numbers, so docx → Grown → docx → Grown is
  stable. Grown-only constructs are written the nearest way: TipTap bullet
  / ordered lists as numbered paragraphs on generated definitions (nested
  lists one level down, `start` as a `startOverride`), task items with ☐/☒,
  block quotes as a 36pt indent, code blocks in Courier New, rules as a
  bottom border, Excalidraw drawings rasterised to PNG in the browser.
  Every table gets single 0.5pt grid borders (Grown has no border model
  yet; since M4 tables carry their own borders and styles, see §6.10). Output: content types, package/document rels, styles, numbering,
  foot/endnotes with separators (+ `settings.xml` footnotePr), comments +
  commentsExtended, header1/footer1, media, core/app properties, Letter
  page with 1in margins.
* **Wiring**: `api.ts:importFile` reads `.docx` directly and falls back to
  `POST /api/v1/docs/import?from=docx` (pandoc) if the reader throws;
  `DocList` hands the model to the editor through `seed.ts`, and
  `DocEditor` applies it and creates the comment threads.
  `export.ts:downloadDoc("docx")` uses the writer (with the document's
  comment threads) and falls back to `POST /api/v1/docs/convert?to=docx`.
  odt/rtf/epub/md/txt/html import and odt/rtf/epub/md/pdf export stay on
  pandoc.
* **Tests**: `__tests__/docx.test.ts` (18 vitest; fixtures built in code
  by `docx-fixture.ts`): reader mapping per area, script-URL rejection,
  non-docx rejection, package structure (every part parses, has a content
  type, every relationship target and `r:id`/`r:embed` resolves, `sectPr`
  last), schema element order (pPr, rPr, tcPr; cells end with a paragraph),
  **docx → Grown → docx → Grown model equality** (body JSON, styles map,
  numbering map, comments, header, footer), an editor-authored document
  (TipTap lists, task list, quote, code, rule, merged table), comment
  import through a fake API, export anchoring of unmarked comments, the
  pandoc fallback, and the seed hand-off. `__tests__/docx-corpus.test.ts`
  runs every `.docx` under `GROWN_CONVERSION_CORPUS` (skipped when unset):
  import keeps ≥ 98 % of the source's words, export parses, and the second
  import equals the first. Playwright `web/e2e/docs-docx.spec.ts` imports a
  generated .docx (styles, numbered + bullet list, merged/shaded table,
  header, comment) from the Docs home, checks the render and the comment
  thread, downloads it as .docx (direct writer: `commentsExtended.xml` is
  present) and imports the download with the same checks. The generated
  files were also read back by pandoc's docx reader (lists, merges,
  comments with replies, tracked changes and notes all recognised).
* **Corpus pass rate**: OnlyOffice's own `.docx` files
  (`research/onlyoffice`, 5 files): **4/4 (100 %)**, plus 1 correctly
  refused (`Fb2File/template/template.docx` has no main document part).
  The first run was 3/5; both failures were the checker (the template, and
  word counts split across runs). The CC2 corpus converted to .docx by
  pandoc (46 files: libxml2 HTML tests, EpubFile books up to 138k words,
  ODF examples, md, `internal/docs/testdata/corpus`): **46/46 (100 %)**,
  first run 40/46, all six checker issues (words split across `w:br` /
  runs, numeric entities). Run with
  `GROWN_CONVERSION_CORPUS=<dir> npx vitest run docx-corpus`.
* **OnlyOffice tests**: none (their converter tests live in `core/`, see
  §5), so the parity scoreboard is unchanged.
* **Dropped on import** (reported in `DocxImport.warnings`; each waits for
  the milestone that adds the model): bookmarks (M8), table borders and
  table styles (mapped since M4, §6.10), per-section page setup, first/even headers and
  section-level header variants (M9; the final section's page size is read
  into `DocxImport.page` but not applied), floating image position and
  wrap (M7), WMF/EMF/TIFF images, direct "not bold/italic" over a style,
  caps / small caps as direct formatting, formatting-change revisions and
  revision dates (both mapped since M5, §6.11), rich footnote bodies (F1),
  equations as math (M11).
* **Not yet** (rest of the M6 row): opening a `.docx` from Drive and
  importing into an existing document; a server-side OOXML schema
  validation step (checked here by structure tests and pandoc's reader,
  not by Word/LibreOffice, which aren't available to the test run).
* **Semantic differences**:

| Case | Word | Grown | Status |
|---|---|---|---|
| Comment authors | Kept per comment | Server comments belong to the importing user; the original author is appended to the text ("— Carol") when it differs | grown-variant |
| Numbering start when `w:start` is absent | 0 (ECMA-376) | 0, per the spec | Note only |
| Image in a paragraph | Inline in the run | Image is a block node, so the paragraph splits around it; paragraph alignment of an image-only paragraph is lost | Until M7 |
| Header/footer content | Any block content | Margin editor schema: paragraphs/headings with alignment and basic marks; tables flatten to paragraphs, images dropped, fields keep their result text (a PAGE field becomes a fixed number) | Until M8/M9 |
| Headings 7-9 | Built-in | Custom paragraph styles with an outline level (TipTap has h1-h6) | grown-variant |
| Direct `jc=left` over a centred style | Left | Not stored (M3 limitation) | Known gap |
| Export page setup | Section properties | Letter, 1in margins (orientation/margins are not persisted yet) | Until M9 |


### 6.10 M4 status (tables)

* **Model** (`tableModel.ts`, pure): additive attributes on TipTap's table
  nodes, all strings / numbers / booleans. Table: `tableStyle` (template
  id), `look` ("header banded firstCol lastRow lastCol bandedCols"; null =
  Word's default 04A0), `borders` (JSON per side incl. `insideH` /
  `insideV`, explicit "none"), `cellMargins` ("t r b l" pt), `layout`
  ("fixed" | null), `width` ("100%" | "<n>pt"), `align`. Row:
  `repeatHeader`, `height` (pt, at least). Cell: `backgroundColor` (M1),
  `borders`, `verticalAlign`, `margins`. Column widths stay TipTap's
  per-cell `colwidth`. Ten style templates named after Word's built-ins
  (Table Grid, Plain Table 1/3, Grid Table 1 Light, Grid Table 4 Accent
  1/2/6, List Table 3 Accent 5, Grid Table 5 Dark Accent 1, Normal Table)
  with header / total row / first / last column / banded rows and columns.
  Rendering is CSS: the table sets `--tbl-<side>` variables (template rule,
  overridden inline by direct borders), cells draw the outer or inside
  line by position (collapsed model); cell borders are inline, a cell's
  explicit "none" renders `hidden` so it wins. `GrownTableView` (TipTap's
  resizable view + the attributes) lays columns out on the widest width
  per column across rows, not only the first row.
* **Grid resolver**: `resolveFixedGrid(grid, rows)` — a column takes the
  widest explicit single-column cell width in any row, else its tblGrid
  width; merged-continuation cells are ignored; spanning cells wider than
  their columns widen them in proportion. The DOCX reader uses it for
  fixed-layout tables; `pmColumnWidths` is the same rule for the editor.
* **Normaliser**: `correctBadTable` (WordprocessingML vMerge: a
  continuation with no merge above becomes a restart; a row of only
  continuations is folded away) runs in the DOCX reader; `normalizeTable`
  (TipTap JSON: invalid spans reset, rowspans clipped at the table end,
  colspans clipped where they run into a merge from above, fully covered
  rows folded with their merges shortened, empty rows dropped, ragged rows
  padded, colwidth arrays fixed, empty cells filled) runs on paste
  (`transformPasted`, tables on an open slice edge are left to
  prosemirror-tables), on DOCX import and in `textToTable`.
* **Commands** (`tables.ts`): border presets (all / outer / inner / top /
  bottom / left / right / inside H / inside V / none) on the selected
  cells (outline of the selection, Word style) or the whole table; table
  style + look; cell props; column width / row height; distribute rows
  (average) and columns (keep the total); autofit to contents / window /
  fixed; repeat header row (rows from the top to the selection); split
  table (cuts merges across the split; caret in the new paragraph, as in
  Word); text → table (tabs, commas, semicolons, custom, or paragraphs in
  N columns; marks kept) and table → text.
* **UI** (`TableUI.tsx`): hover size picker in the toolbar and Insert menu;
  a right-hand **Table settings** panel (style gallery with previews and
  look switches, borders with scope / style / width / colour, vertical
  alignment, cell shading and margins, column width / row height,
  distribute, repeat header, fit contents / window / fixed, alignment,
  default cell margins, split, convert to text); Format > Table, the
  context menu (in a table) and the command palette reach the same
  commands; a Convert text to table dialog. CellSelection is now visible.
  HTML export carries the table stylesheet.
* **DOCX** (`docx/tables.ts`), both ways: `tblStyle` (Word id or name →
  template; a localised id such as "Gitternetztabelle4Akzent1" still
  matches by name), `tblLook`, `tblBorders` (incl. `nil`), `tblW` (pct /
  dxa), `jc`, `tblLayout`, `tblCellMar`, `trHeight`, `tblHeader` (repeat
  header row; header cells as before), `tcBorders`, `tcMar`, `vAlign`, and
  `w:style` definitions (with `tblStylePr` firstRow / lastRow / firstCol /
  lastCol / band1Horz / band1Vert) for the templates used. Unknown table
  styles keep their borders along `basedOn` (warning). A vertically merged
  cell writes its bottom border on its last part and reads it back from
  there. Unstyled tables still export Grown's light grid, with direct
  sides on top.
* **Tests**: 8 tagged cases, all passing: `oo/table-grid.test.ts` 6,
  `oo/table-normalize.test.ts` 1 (correctBadTable "bad vMerge"),
  `oo/table-cell-props.test.ts` 1 (api-table-cell "SetColor, GetColor";
  the theme-colour step is n/a). Grown-native: `tables.test.ts` (46:
  resolver, normaliser incl. overlapping merges / covered rows / nested
  tables / schema validity, encodings and CSS, every command, paste, Yjs
  sync), `docx-tables.test.ts` (8: reader mapping, unknown style, bad
  vMerge, ragged rows, merged borders, writer schema order + style
  definition, Grown → docx → Grown equality, legacy grid). Playwright:
  `web/e2e/docs-tables.spec.ts` (2 tests; styled table persisted across
  reload and through .docx export + import; text ↔ table, repeat header,
  split).
* **Not yet**: on-screen header-row repetition and table page breaks (M9
  pagination; print uses `display: table-header-group`), draw / erase
  table, table indent, text wrapping around tables (flow tables, n/a per
  F2), table formulas, per-cell text direction, a style editor for custom
  table styles (unknown docx styles keep only borders).
* **Semantic differences**:

| Case | OnlyOffice | Grown | Status |
|---|---|---|---|
| table-grid units | Millimetres, read from a laid-out table | Unitless pure resolver; the editor stores px | Note only |
| correctBadTable | Runs on the internal table model | Runs on the DOCX reader's vMerge rows; the editor has rowspans, where `normalizeTable` covers the same repairs | Note only |
| api-table-cell theme colour | Theme colours | No document theme | n/a |
| Table without style or borders (docx) | No borders (Normal Table) | Grown's light grid (legacy look); Normal Table is a template users can pick | grown-variant |
| Header cells | Only a row property | TipTap `<th>` cells; `tblHeader` rows import as header cells with repeat on | Note only |

### 6.11 M5 status (track changes v2)

* **Model** (`changes.ts`, pure; `suggesting.ts`, the extension). Every
  record carries `id`, `author` and `date` (ISO, seconds, as WordprocessingML
  stores it): `insertion` / `deletion` marks (new `id`/`date` attributes;
  old documents without ids read as one change per run), a `formatChange`
  mark whose `old` attribute is the JSON of the formatting marks before the
  change, and two paragraph/heading attributes (`TrackParagraphs`):
  `paraChange` (the paragraph *mark* — the break at the paragraph's end —
  was inserted or deleted, Word's model) and `propsChange` (the previous
  node type and attributes). All are strings, so they ride y-prosemirror and
  the update log like any attribute. `collectChanges` groups records by id
  into logical changes (insert / delete / replace / format / paragraph);
  `resolveParts` accepts or rejects them (rejecting a formatting change
  restores the old marks; accepting a deleted paragraph mark, or rejecting an
  inserted one, joins the paragraph with the next, which then carries the
  next paragraph's mark; tables and block objects stop a join).
* **Tracking**: typing is marked by `appendTransaction` (continuing an
  adjacent own insertion's id, including the paragraph mark just before);
  typing, pasting or Enter over a selection marks it deleted and inserts
  the new content at its start as one "replace" change; Backspace / Delete
  (and Ctrl/Alt+Backspace/Delete by word) mark text deleted, skip text that
  is already deleted, remove your own pending insertions outright and, at a
  paragraph boundary, mark the paragraph mark deleted; cut marks the
  selection deleted after copying; a drag-move inserts at the drop point
  and marks the source deleted (one "Moved" change). Enter records the first half's paragraph mark as inserted (the
  original mark stays with the second half; untracked, the new mark is
  plain). Mark steps on formatting marks record `formatChange` (dropped
  again when the formatting returns to the snapshot); attribute / block
  type steps on paragraphs record `propsChange` (not for paragraphs that
  are empty or entirely your own insertion). Remote (Yjs) transactions,
  undo/redo and `setContent` loads are never re-tracked; untracked typing
  next to or inside a change no longer inherits its mark. Tracking state is
  per editor (a WeakMap; TipTap 2 extension storage is shared).
* **Review UI**: `Suggestions.tsx` — track changes menu (On/Off for me,
  On/Off for me and everyone, "Track my changes by default"), display mode,
  previous / next with "n of m", accept / reject current, accept / reject
  all, and the grouped change list (kind, author, date, summary, per-change
  accept / reject) across the header, body and footer editors.
  `ReviewPopover.tsx` — a card under the change at the caret with author,
  date, summary and accept / reject. The toolbar mode chip gained
  "Suggesting"; Tools > Review, View > Changes and the command palette reach
  every command.
* **Display modes** are CSS on the page (`review-markup|simple|final|
  original`, `editorStyles.ts`): Markup shows insertions, strike-through
  deletions, a dotted underline for formatting changes, ¶ for tracked
  paragraph marks and a tint for paragraph-property changes; Simple markup
  and Final hide deletions and plain the rest (Simple adds a bar beside
  changed paragraphs); Original hides insertions and plains deletions. The
  mode is a per-user preference (localStorage).
* **On for everyone**: `review.ts` — `trackAll` in a `review` Yjs map
  (`{on, at}`); my per-document choice (`{on, at}`, localStorage) and the
  document setting are compared by time and the newer wins, so "for
  everyone" overrides earlier personal choices and a later personal choice
  overrides it (OnlyOffice's four options); with neither, the per-user
  default applies.
* **Header/footer**: the margin schema includes the review marks and
  paragraph attributes, `MarginEditor` runs `Suggesting` when tracking is
  on and registers its editor with the review panel and popover.
* **Smart replace** (`search.ts`): text already deleted is left out of the
  comparison and stays; under tracking replaced characters are marked
  deleted (own insertions removed), new characters are insertions placed
  after what they replace with its formatting, one change per replacement.
  Find & replace (one / all) goes through the same path.
* **DOCX** (`docx/read.ts`, `docx/write.ts`), both ways: `w:ins` / `w:del`
  (and moves on import) with author and date, `w:rPrChange` (old run
  properties ⇄ `formatChange.old`), `w:pPrChange` (old paragraph
  properties, style and numbering ⇄ `propsChange`) and paragraph-mark
  revisions in `w:pPr/w:rPr`, in the body and in headers/footers. The
  reader groups Word's per-run revisions into logical changes (adjacent,
  same author and date; a deletion next to an insertion is a replacement)
  and numbers ids in document order, so docx → Grown → docx → Grown is
  stable. The writer keeps schema order (rPrChange last in rPr; pPr's rPr
  before pPrChange) and unique revision ids.
* **Tests**: 7 tagged cases, 5 passing and 2 skipped:
  `oo/revisions-paragraph.test.ts` 2, `oo/revisions-document.test.ts` 5
  (new paragraph under tracking; entire document deleted / added, with a
  paragraph where OnlyOffice has a block content control; the two
  sdt-only cases skipped for M10), and `oo/replace-smart.test.ts` "Replace
  text with revisions" (un-skipped; grown-variant, below). Grown-native:
  `track-changes.test.ts` (20: ids/dates, grouping, other authors'
  insertions, drag-move, untracked typing, typing into deletions,
  formatting record /
  revert / own insertions, paragraph properties, paragraph-mark
  merge/split, Enter over a selection, navigation and current change,
  legacy id-less marks, Yjs sync without re-tracking, track settings,
  header fragment, replace all under tracking), `docx-revisions.test.ts`
  (4: reader mapping incl. header, writer XML and schema order, Grown →
  docx → Grown → docx → Grown equality, header revisions). Playwright:
  `web/e2e/docs-review.spec.ts` (tracking on for everyone from the panel,
  insertion / deletion / formatting / paragraph mark, change list, popover
  author and date, all four display modes, accept one / reject one, reload,
  next change + reject current, accept all).
* **Not yet**: tracked table structure (rows/cells), list wrapping and
  block objects (images, drawings, page breaks are deleted untracked when
  selected on their own), tracked changes inside footnote bodies (F1),
  Original mode showing the old formatting of a formatting change (CSS
  can't; needs decorations), balloons in the margin (the popover is the
  per-change view), move tracking (moves import as insert + delete), and
  per-user colours for deletions.
* **Semantic differences**:

| Case | OnlyOffice | Grown | Status |
|---|---|---|---|
| replace-text-smart: with revisions | Character-level diff, so "common" → "and another" becomes interleaved single-letter deletions and insertions ("c" / "and an" / "o" / "mmo" / …) | Word-level diff (M2's `diffChunks`): one deletion ("common") plus one insertion ("and another inserted"). Same review rules (deleted text skipped and kept, own insertions removed, other users' insertions kept under a deletion) | grown-variant |
| replace-text-smart: with revisions, tracking off | The upstream sub-case marks part of the new text as removed (its own TODO says the case is wrong without tracking) | New text is plain; deleted text stays deleted | grown-variant |
| document-content: block-level sdt | The "entire document" cases include a block content control | A middle paragraph stands in until M10; the sdt-only cases are skipped | Until M10 |
| Rejecting an inserted paragraph mark | The merged paragraph's properties follow Word's mark rules | The first paragraph keeps its type and attributes and takes the next paragraph's mark state (so a heading split by Enter stays a heading) | Note only |
| Review colours | Per-user colours for all change types | Insertions take the author's colour; deletions are red, formatting purple | Note only |

### 6.12 M11 status (equations)

* **Model** (`math/model.ts`): OMML-shaped JSON — a content is a list of
  runs (`sty` p/b/i/bi, `nor`, colour, highlight) and objects (`f` with
  bar/skw/lin/noBar, `sSup`, `sSub`, `sSubSup`, `sPre`, `rad`, `nary` with
  `limLoc` and hidden limits as `null`, `d` with begin/end/separator,
  `func`, `limLow`, `limUpp`, `acc`, `bar`, `box`, `borderBox`,
  `groupChr`, `m`, `eqArr`, `phant`); `normalize` keeps Word's shape (runs
  at both ends and between objects). The `math` node (`math/MathNode.ts`)
  is an inline atom with the model as a JSON string attribute `data` and a
  `display` flag (own centred line = Word's `m:oMathPara`), so it rides
  y-prosemirror and the update log like any attribute. It renders with
  KaTeX (MIT, now a direct dependency; already in the tree via mermaid);
  `getHTML()` writes `span[data-math]` with MathML inside and an `alttext`
  of the linear form; `renderText` is the linear form.
* **Linear format** (`math/linear.ts`): a UnicodeMath reader over *cells*
  (characters or built objects) with precedence sequence → fraction
  (right-associative) → ┴/┬ → scripts (same-kind chains right-associative,
  ^ after _ = sub-superscript) → prefix operators (√ ∛ ∜ □ ▭ ▁ ¯ ⏞ ⏟ ■ █
  n-ary) → atoms (letter/digit runs, bracket groups with Word's `|`
  pairing and `├…┤`, functions with U+2061, accents, primes, pre-scripts);
  `( )` used as an operand is grouping. The writer reproduces Word's /
  OnlyOffice's linear text (argument bracketing rules, 〖〗 for mixed n-ary
  and function arguments, spacing between adjacent objects).
* **Autocorrect** (`math/autocorrect.ts`, `MathInput`): `\word` + space
  (or + a closing character) → symbol (Word's math autocorrect list plus
  `\doubleX` / `\frakturX` / `\scriptX`), `->` `<=` … → → ≤ …; two spaces
  never convert; function name + space → function with the caret in its
  argument; name + ^/_ gets U+2061; a closing bracket builds up its
  content; `/` builds up the operand before it (so `1/2/3` is
  `((1/2)/3)`); an operator builds up since the last unmatched opening
  bracket; a space builds up around the last structure character (infix:
  the operand before and everything after; prefix: to the end; postfix
  accent: with its base; after ▒: the n-ary operand, else the whole
  n-ary); a bracket pair + space becomes a delimiter. The caret lands in
  an empty n-ary base or function argument. Each conversion is its own
  undo step; arrow keys move in and out of arguments.
* **LaTeX** (`math/latex.ts`): reader (fractions, binomials, roots,
  accents, braces/brackets incl. bare pairs, `\left…\middle…\right`,
  scripts and pre-scripts, `\below` / `\above`, n-ary with limits,
  functions incl. `\operatorname`, `\text`, `\mathrm` and the math
  alphabets, `matrix` / `pmatrix` / `bmatrix` / `cases` / `array` /
  `aligned`), the LaTeX linear view in Word's compact form, and a KaTeX
  writer (standard LaTeX; every fixture equation is checked to be valid
  KaTeX input).
* **MathML** (`math/mathml.ts`): Presentation MathML importer (token
  styles, mathvariant, colours, `mfrac` incl. bevelled / linethickness 0,
  roots, scripts, `munder`/`mover`/`munderover` → n-ary (movablelimits),
  group characters or limits, `mfenced`, `menclose`, `mphantom`,
  `mtable` with nested `mtr`/`mtd` normalised, `semantics`, function
  application) used for pasted HTML (`<math>`), and an exporter.
* **DOCX** (`math/omml.ts`, `docx/read.ts`, `docx/write.ts`): `m:oMath`
  → inline math node, `m:oMathPara` → display math node(s), and back
  (`xmlns:m` on every part root). Header/footer equations keep their
  linear text (the margin schema has no math node). Pasting from Word
  reads the OMML in its `msEquation` conditional comment and drops the
  picture fallback.
* **UI**: Insert ▸ Equation, the toolbar Σ button, the command palette and
  Ctrl+Alt+= (listed in the shortcuts dialog) insert an equation and open
  the **equation panel** (`math/EquationEditor.tsx`): linear input with
  autocorrect at the caret (editing elsewhere switches to free editing of
  the linear text; `\words` are corrected on Done), a LaTeX mode, template
  menus (fraction, script, radical, integral, large operator, bracket,
  function, accent, limit and log, matrix), display toggle, live KaTeX
  preview, Enter = Done (builds up the whole equation), Escape = Cancel
  (an empty new equation is removed). Clicking an equation reopens it.
  The context menu on an equation (`math/EquationMenu.tsx`) offers edit,
  linear / professional format, display / inline, stacked / skewed /
  linear fractions, limits under-over / as scripts, add / remove
  brackets, matrix rows and columns, delete.
* **Change case** leaves equations unchanged (they are atoms).
* **Tests**: `oo/math-autocorrect.test.ts` 878 tagged cases — the 846 cases
  OnlyOffice's `Test()` helper generates are data in
  `__tests__/fixtures/math-autocorrection.json` (input, mode, expected
  top-level elements; one literal tag per case, numbered in file order,
  extracted by a local script under `research/`), plus the 32 hand-written
  QUnit tests: **876 pass, 2 skipped**. `oo/mathml-import.test.ts` 46
  tagged (the 46 live QUnit tests of math-ml.js; the CSV's 53 counts 7
  commented-out ones): **44 pass, 2 skipped**. `oo/change-case.test.ts`:
  the 5 math cases now pass. `oo/shortcuts.test.ts` "Check insert
  equation" now passes. Grown-native `math.test.ts` (18: OMML read /
  write / .docx round trip / header fallback, Ctrl+Alt+=, HTML ⇄ MathML,
  pasted MathML and Word OMML, KaTeX, Yjs sync, KaTeX validity of every
  fixture equation, LaTeX round trip, templates, equation commands, free
  text words, undo, MathML round trip). Playwright
  `web/e2e/docs-math.spec.ts`: four equations typed in linear format
  (Ctrl+Alt+= and Insert ▸ Equation; fraction with a radical, a bracketed
  matrix, a display sum with limits, an integral made display from the
  context menu), rendering checks, reload, reopen, .docx download and
  re-import.
* **Skipped, by cause**:
  * n/a — per-character review info inside an equation
    (math-autocorrection "Check review info convert math; bug #67505"):
    tracked changes apply to the equation node as a whole.
  * Not modelled — equation line breaks and alignment (`m:brk`,
    `m:alnAt`): math-autocorrection "Save manual break"; shortcuts "Check
    handle tab in math".
  * In-place caret editing of equations in the document (Grown edits them
    in the equation panel): shortcuts "Check add new paragraph math" and
    "Test add new line to math".
  * Upstream test is broken: math-ml "mathvariant" asserts an undefined
    variable.
  * grown-variant: math-ml "Add mphantom" — the phantom imports as a
    phantom object, but its linear form is UnicodeMath's ⟡, not
    `\mphantom`.
  * copy-paste "Paste Newton's binom formula from word" stays skipped: it
    is commented out upstream and compares OnlyOffice's own copy HTML;
    Word equations do paste since M11. "Paste footnote formula" waits for
    rich footnote bodies (F1).
* **Not yet**: caret editing inside a rendered equation in the page (the
  panel shows the linear text), equation numbering and `#` labels, line
  breaks / alignment points, per-run styles beyond sty / nor / colour,
  equations in headers/footers and footnotes, a gallery of saved
  equations, ODT/RTF math (those exports go through pandoc, which reads
  the MathML).
* **Semantic differences**:

| Case | OnlyOffice / Word | Grown | Status |
|---|---|---|---|
| Where equations are edited | In place in the page | In the equation panel under the equation; the page shows KaTeX | grown-variant |
| Done / leaving the equation | Keeps partly built-up text | Done builds up the whole equation (Word's "Professional") | grown-variant |
| Phantom linear form | `\mphantom` | ⟡ (UnicodeMath) | grown-variant |
| Insert equation chord | Alt+= | Ctrl+Alt+= (Alt+= types ≠ on macOS) | grown-variant |

### Known flaky e2e (as of 2026-09-26)

- ~~`web/e2e/docs/oo-shortcuts.spec.ts` "Check sending event to interface"
  fails about 1 run in 3~~ — **fixed (M4 branch)**. Root cause was a real
  product race, not collab: the test presses Ctrl+K right after
  Shift+Home. The browser reports the new selection through the
  asynchronous `selectionchange` event, and the Ctrl+K handler ran first,
  so ProseMirror still held the collapsed caret (logged: DOM "Grown"
  selected, state 6..6); the blocking `window.prompt` then kept the pending
  event queued until after `setLink` had run on an empty selection.
  `links.ts:promptLink` (now shared by Ctrl+K, the toolbar, Insert > Link
  and the context menu) reads the DOM selection into the state
  (`syncSelectionFromDOM`) before prompting and links the captured range;
  it also runs `resolveLinkInput`, which the Ctrl+K path skipped. Before:
  3/10 and 2/10 failures with `--repeat-each 10`; after: 20/20 and 10/10
  on a production build (`__tests__/links.test.ts` reproduces the stale
  state in jsdom).
- Related: Grown's docs collab hub replays updates but never answers the
  y-protocol sync handshake, so `WebsocketProvider.synced` never becomes true.
  Nothing in the app reads it today. e2e waits for "connected" plus a short
  settle instead.
