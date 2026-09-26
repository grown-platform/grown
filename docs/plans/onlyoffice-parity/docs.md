# OnlyOffice parity plan — Docs (word processing)

Status: plan written 2026-09-26. M0 (test harness) has landed; see §6.4.

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
| Paragraph shading / run background | Toolbar `tipPrColor`, `api-run SetShd` | Missing | — |
| Change case (sentence/lower/UPPER/Capitalize/tOGGLE) | Toolbar `mni*Case`, `Editor/ChangeCase.js` | Partial | `MenuBar.tsx:385` has UPPER/lower/Title only, and `transformSelection` re-inserts plain text, losing marks across runs |
| Double strikethrough, small caps, all caps | ParagraphSettingsAdvanced `strDoubleStrike/strSmallCaps/strAllCaps` | Missing | — |
| Character spacing, position, ligatures/OpenType | ParagraphSettingsAdvanced | Missing | — |
| Clear formatting / reset char | Toolbar `tipClearStyle`, shortcut `ResetChar` | Have | `clearNodes().unsetAllMarks()` |
| Copy / paste format (format painter) | Toolbar `tipCopyStyle`, shortcuts `CopyFormat/PasteFormat` | Missing | — |
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
| Line spacing exact / at least | ParagraphSettings `textExact/textAtLeast` | Missing | — |
| Space before/after (numeric) | ParagraphSettings, `api.js` add/remove space test | Partial | fixed 12px toggle `docs/MenuBar.tsx:488` |
| "Don't add interval between same-style paragraphs" | ParagraphSettings | Missing | — |
| Left/right indent, first-line, hanging (per paragraph) | ParagraphSettings `strIndent*`, `styles/paraPr.js` | Missing | Ruler sets page margins; indent buttons only sink/lift list items |
| Tab stops (pos, alignment, leader) | ParagraphSettingsAdvanced `strTabs`, `document-calculation/paragraph/tabs.js` | Missing | — |
| Keep with next / keep lines / widow-orphan / page break before | ParagraphSettingsAdvanced, `keep-next.js` | Missing | — |
| Paragraph borders & fill | ParagraphSettingsAdvanced `strBorders` | Missing | — |
| Outline level | ParagraphSettingsAdvanced | Partial | only via heading level |
| Non-printing characters | Toolbar `mniHiddenChars`, shortcut `ShowAll` | Missing | menu item disabled `docs/MenuBar.tsx:270` |
| Hyphenation (auto, caps, limit, zone) | HyphenationDialog, `text-hyphenator.js` | Missing | — |
| Line numbers | LineNumbersDialog | Missing | menu item disabled |

### 2.3 Styles

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Built-in paragraph styles (Normal, H1-H9, Title, Subtitle, Quote, List Paragraph, ...) | Toolbar `tipParagraphStyle`, `Styles/default-styles.js` | Partial | Normal + H1-H6 (`docs/Toolbar.tsx:756`, `MenuBar.tsx:401`) |
| Style gallery with previews | Toolbar | Missing | — |
| New style from selection / update from selection / delete / restore | Toolbar `textStyleMenu*`, StyleTitleDialog, `styleApplicator.js` | Missing | — |
| Style inheritance (basedOn, next style, numbering in style) | `styles/paraPr.js`, `numberingApplicator.js` | Missing | — |
| Character styles | sdkjs | Missing | — |
| Displayed style for mixed selection | `styles/displayStyle.js` | Missing | style select shows p/h1-h3 only |

### 2.4 Lists and numbering

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Bulleted / numbered / checklist | Toolbar | Have | StarterKit + TaskList |
| Nesting (indent/outdent) | Toolbar | Have | sink/liftListItem |
| Bullet library (8 markers), numbering library, multilevel templates (7) | Toolbar `tipMarkers*`, `tipMultiLevel*` | Missing | — |
| List settings (type, symbol, font, start at, restart, alignment, indent, follow with) | ListSettingsDialog, ListIndentsDialog | Missing | — |
| Continue numbering / start new list / set numbering value / join / separate | DocumentHolder `textContinueNumbering...`, NumberingValueDialog | Missing | — |
| Numbering through style; numbered headings | `numberingApplicator.js`, `numberingCalculation.js` | Missing | — |
| Autocorrect text to list (`* `, `- `, `> `, `1. `, `1.1.`, `1) `, `a. `, `A) `) | `numberingAutocorrect.js`, AutoCorrectDialog | Partial | StarterKit input rules: `-/+/* ` and `1. ` only |
| Change list level (keyboard) | Toolbar `textChangeLevel` | Have | Tab/Shift-Tab in TipTap lists |

### 2.5 Tables

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Insert table with size / custom / draw / erase | Toolbar, InsertTableDialog | Partial | fixed 3x3 `docs/MenuBar.tsx:299` |
| Add/delete rows/cols, merge/split | TableSettings | Have | table extension commands |
| Cell background | TableSettings | Have | `TableCellBg` `docs/extensions.ts:543` |
| Border style/color per side, hidden borders | TableSettings `tip*`, Toolbar `mniHiddenBorders` | Missing | — |
| Table style templates (grid/list/plain, banded, header/first/last) | TableSettings `txtTable_*` | Missing | — |
| Column width / row height numeric, fixed layout grid | TableSettings `textCellSize`, `table-grid.js` | Partial | drag resize only |
| Distribute rows / columns | DocumentHolder | Missing | — |
| Repeat header row on each page | TableSettings `strRepeatRow`, `table-header.js` | Missing | — |
| Cell margins, vertical alignment, table alignment/indent | TableSettingsAdvanced | Missing | — |
| Table position / wrap (inline vs flow) | TableSettingsAdvanced, `flowTablePosition.js` | Missing | — |
| Convert text to table / table to text | TextToTableDialog, TableToTextDialog | Missing | — |
| Table formulas | TableFormulaDialog | Missing | — |
| Split table / nested tables | DocumentHolder `textNest` | Partial | nesting allowed by schema, no split |
| Autofit to contents/window | TableSettingsAdvanced | Missing | — |
| Bad-table correction (vMerge) on load | `correctBadTable.js` | Missing | — |

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
| Track insertions / deletions | ReviewChanges `txtTurnon`, `revisions/*.js` | Have | `docs/suggesting.ts` |
| Accept / reject current, all; next / previous | ReviewChanges | Partial | per-run + all in `docs/Suggestions.tsx`; no navigation |
| Tracked formatting changes | sdkjs `RevisionsChange.js` | Missing | — |
| Tracked paragraph split/merge, table and structural changes | `revisions/document-content.js` | Missing | typing Enter in suggesting mode is applied directly |
| Author, date, change type in balloons/popover | ReviewPopover | Partial | author only, no date |
| Display modes (Markup + balloons, only markup, Final, Original) | ReviewChanges `txtMarkup*` | Missing | — |
| Track on for me / for everyone | ReviewChanges `txtOn/txtOnGlobal` | Partial | local toggle only |
| Review in header/footer/notes | shortcuts test | Missing | — |
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
| Insert equation (gallery, toolbar) | Toolbar `capBtnInsEquation` | Missing | — |
| Unicode / LaTeX linear input with autocorrect | `math-autocorrection.js` (878 cases), `Editor/Math.js` | Missing | — |
| Equation context menu (fractions, brackets, limits, scripts, matrix, ...) | DocumentHolder `txt*` (approx. 60 items) | Missing | — |
| MathML import | `math-ml.js` | Missing | — |
| Change case inside math | `change-case.js` Math module | Missing | — |

### 2.16 Autocorrect

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Replace-as-you-type table (custom pairs) | AutoCorrectDialog `textReplaceType` | Missing | — |
| Capitalize first letter of sentence / of table cells, exceptions | AutoCorrectDialog, `as-you-type.js` | Missing | — |
| Smart quotes, `--` -> em dash, hyperlink recognition, double-space period | AutoCorrectDialog | Partial | autolink only |
| Automatic bulleted / numbered lists | AutoCorrectDialog | Partial | see 2.4 |
| Math autocorrect, recognized functions | AutoCorrectDialog | Missing | — |
| Markdown-style input rules (`**bold**`, `# heading`, `> quote`, `---`) | (Google-style) | Have | StarterKit input rules |

### 2.17 Find / replace / spelling

| Feature | OnlyOffice ref | Grown | Where / note |
|---|---|---|---|
| Find with highlighting, result count, next/previous | Common SearchPanel | Missing | — |
| Case sensitive, whole words, regex | SearchPanel | Missing | — |
| Replace one / replace all | SearchPanel | Partial | replace-all only; matches must lie inside a single text node (`docs/editorActions.ts:606`) |
| Replace preserving run formatting ("smart") | `js-api/api/replace-text-smart.js` | Missing | — |
| Spell check (as you type, dictionary, language) | ReviewChanges `txtSpelling`, `Editor/SpellChecker` | Missing | menu item disabled |

### 2.18 Keyboard shortcuts

OnlyOffice defines 107 shortcut actions (`sdkjs/word/apiDefines.js:223`,
`c_oAscDocumentShortcutType`); the test suite exercises 46 of them.

| Group | OnlyOffice | Grown | Note |
|---|---|---|---|
| Undo/redo, cut/copy/paste, paste text only, select all | 53-58, 67 | Have | TipTap defaults + `docs/editorActions.ts` |
| Bold/italic/underline/strike/sub/sup | 82-87 | Have | TipTap defaults |
| Heading 1-3 (Alt+1..3), bullets (Ctrl+Shift+L) | 88-91 | Partial | Grown uses Ctrl+Alt+1-6 (Google style), listed in `docs/ShortcutsDialog.tsx` |
| Increase/decrease font size | 93-94 | Partial | listed in ShortcutsDialog but not bound (only menu items) |
| Align L/C/R/J | 95-98 | Have | TextAlign defaults |
| Indent/unindent (Ctrl+M / Ctrl+Shift+M) | 100-101, 104-107 | Partial | list items only |
| Page break (Ctrl+Enter), line break (Shift+Enter), column break | 42-43, 99 | Partial | line break yes; page/column break no |
| Non-breaking space/hyphen, em/en dash, ©, ®, ™, ellipsis, € | 51-52, symbol shortcuts | Missing | — |
| Insert hyperlink (Ctrl+K), visit hyperlink | 65-66 | Partial | Ctrl+K opens prompt; visit via click |
| Insert footnote/endnote now, equation, page number | InsertFootnoteNow etc. | Missing | — |
| Copy/paste format (Ctrl+Shift+C/V) | 59-60 | Missing | — |
| Show non-printing (Ctrl+Shift+Num8), update fields (F9), save, print | 103, 18, 7-8 | Partial | print only |
| Navigation/selection by word/line/page/document, header/footer | 19-41, 68-81 | Have (browser) | native contenteditable |
| Reset char (Ctrl+Space) | 92 | Missing | clear formatting has no key |
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

Places where Grown's behaviour differs from OnlyOffice's. Each one has a
skipped test with a `TODO(Mx)`.

| Case | OnlyOffice | Grown today | Plan |
|---|---|---|---|
| change-case: Sentence case, Toggle case (4 cases) | Five change-case modes | Only UPPERCASE, lowercase, Title Case | M1 |
| change-case (Grown regression tests) | Case change keeps each run's formatting and the paragraph boundaries | `transformSelection` re-inserts the selection as one string. All text takes the first run's marks (`<strong>big</strong> blue` becomes all bold), and a multi-paragraph selection collapses into one paragraph with a newline | M1: map text nodes in place |
| change-case math (5 cases) | Equation text is left unchanged | No equation node | M11 |
| shortcuts: Check text property change | The increase/decrease font size shortcuts step through 10, 11, 12, 14, 16 | Bold, italic, underline, strike, superscript and subscript toggles all pass. Font size has no key binding (menu only) and steps by 1pt | M1 |
| shortcuts: Check paragraph property change | Pressing an alignment shortcut again switches back to left; Ctrl+M / Ctrl+Shift+M indent by 12.5 mm | Headings pass (Grown binds them to Ctrl+Alt+1-3, not Alt+1-3). Alignment shortcuts only set the alignment and never toggle it off. Ctrl+M is not bound (Tab indents list items only) | M1 (M3 for numeric indent) |
| shortcuts: Check toggle bullet list | Ctrl+Shift+L | Ctrl+Shift+8 (Google Docs / TipTap). The behaviour matches, so this case passes with Grown's key | ShortcutsDialog documents it |
| shortcuts: page break, reset char, special characters | Ctrl+Enter, Ctrl+Space, and symbol keys (nbsp, ©, €, ®, ™, –, —, ‑, …) | Not bound. A page break is available from the Insert menu only | M1 |
| shortcuts: Check remove symbols | Backspace/Delete, and with Ctrl a whole word | Handled natively by the browser's contenteditable, so jsdom can't test it | Playwright port (M1) |
| shortcuts: Check undo/redo history | Undo stack of the document | In the app, Yjs `UndoManager` handles undo; the headless harness uses ProseMirror history with the same keys | Note only |
| api.js: Test AddText/RemoveSelection | `AddTextWithPr` with the wrap-with-spaces option (`Tex 123 t`) | Typing over a selection works; there is no wrap-with-spaces insert | M1 |
| api.js: Test add/remove space before/after paragraph | Numeric space before/after, a "has space" state, style-aware | A single before-or-after toggle | M1 |
| api.js: Get text/selected text | Includes a selection that ends inside an equation | Plain-text half passes; no equation node | M11 |
| api.js: Change numbering level | Enter in an empty list item ends the list at level 1 and outdents at deeper levels | Same behaviour (passes) | — |
