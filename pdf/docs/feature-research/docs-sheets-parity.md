# grown Docs & Sheets — Feature Parity & Gap Analysis

_Reference targets: Google Docs / Sheets and Microsoft Word / Excel._
_Prepared 2026-07-15. Source of truth for "what exists" is the grown codebase itself (verified by direct reading), not docs or memory._

---

## 0. Architecture at a glance

| | Docs | Sheets |
|---|---|---|
| Editor core | **TipTap** (ProseMirror) `@tiptap/*` ^2.27 | **FortuneSheet** `@fortune-sheet/react` ^1.0.4 |
| Real-time collab | **Yjs + y-websocket**; server is a **custom Go relay hub** (`internal/docs/collab.go`), *not* Hocuspocus. CRDT, persists update log, replays on join. | **Custom op-broadcast Hub** (`internal/sheets/collab.go`). Stateless relay; durability via autosave. Presence-aware, permission-aware. |
| Formula/compute | n/a | **Go server-side engine** `internal/sheets/formula_*.go` — ~310 functions, recomputed on save. |
| Export pipeline | **pandoc** (`internal/docs/convert.go`), PDF via `--pdf-engine=tectonic` (LaTeX). Input is rendered HTML. | **SheetJS** (`xlsx`) client-side for xlsx/ods; csv/tsv/html in-browser; PDF reuses the Docs pandoc endpoint. |
| Import | **None** (export-only) | **None** (export-only; menu stub disabled) |

Two structural traits shared by both apps:
1. **The menus deliberately mirror Google's**, with unimplemented items present as *disabled stubs* for structural parity. Many "gaps" below are already stubbed placeholders.
2. **Export is HTML/values-round-trip, not native-model round-trip** — see the fidelity caveats in each Export section. This is the single biggest quality gap versus Google/MS.

---

# PART A — Inventory (what exists today)

## A1. Docs — existing features

**Text formatting:** bold, italic, underline, strikethrough, inline code, text color (22-swatch), highlight (multicolor 9-swatch), font family (7 fonts), font size (custom pt stepper 1–96, no preset dropdown), subscript, superscript, case transforms (UPPER/lower/Title), clear formatting. _(evidence: `extensions.ts`, `Toolbar.tsx`, `MenuBar.tsx`)_

**Paragraph/block:** headings H1–H6, alignment (left/center/right/justify), bullet/ordered/task lists (nested checklists), line spacing (custom `LineHeight` ext, presets), paragraph spacing before/after (custom `ParagraphSpacing`), blockquote, code block, horizontal rule, list indent/outdent + ruler indent markers.

**Tables:** insert (with header row), resizable columns, insert/delete rows & columns, merge/split cells, cell + header background color (custom `TableCellBg`/`TableHeaderBg`).

**Images:** insert by URL; paste/drop image files — **embedded as base64 data URLs** (no object-storage upload; `extensions.ts` explicitly notes "uploading to Drive is a follow-up"). CSS `max-width:100%` only — no resize handles, no wrap/align.

**Links:** insert/edit/remove, autolink, linkOnPaste.

**Drawing:** custom `Drawing` node holding an **Excalidraw** scene (lazy-loaded), stored as scene JSON + rendered SVG data-URL; double-click to re-edit.

**Comments:** threaded (top-level + replies), anchored to text ranges via custom `CommentMark`, resolve/reopen/delete, show/hide resolved, backend-persisted (`internal/docs/service.go`).

**Suggesting / track changes:** custom impl (`suggesting.ts`) — `InsertionMark` + `DeletionMark`, typing adds insertions, delete converts to strikethrough, per-range and bulk accept/reject, review panel, collaborative (rides the Yjs doc).

**Footnotes & endnotes:** both, as auto-numbering inline atom nodes with editable panels.

**Outline:** live heading-derived outline/navigation pane (no *inserted* in-document TOC node).

**Find & replace:** **replace-all only** — substring, case-sensitive; no incremental find/next/highlight, no regex.

**Page layout:** margins (inches), orientation (portrait/landscape), draggable ruler, page breaks (custom node), page-number overlay, **headers/footers** (custom `MarginEditor` bound to named Yjs fragments, collaborative). Page size **fixed to US Letter**; pages are *visual guides* — true content reflow across pages is not implemented.

**Export:** docx, odt, rtf, epub, md, pdf (all via pandoc), plus txt & html (client-side). No native docx library — everything routes through pandoc-from-HTML.

**Collaboration:** Yjs real-time, presence/cursors (`CollaborationCursor`), avatar stack + status chip, **version history** (auto snapshots ≥3 min + named versions, list/preview/restore), sharing with anonymous tokens.

**Templates:** 6 built-in HTML templates + user-saved templates gallery.

**Other:** command palette (Alt+/), keyboard shortcuts + overlay, right-click context menu, word count, print, full-screen, emoji + special-character pickers, paste-without-formatting, make-a-copy/rename/trash/star.

## A2. Sheets — existing features

**Formula engine (~310 functions)** — server-side Go, `registerFunc` table:

| Category | ~Count | Category | ~Count |
|---|---|---|---|
| Math/trig | 55 | Engineering (base/bit/CONVERT) | 20 |
| Statistical | 47 | Lookup/reference (incl. XLOOKUP/XMATCH) | 14 |
| Text | 25 | Array-shaping (VSTACK/TEXTSPLIT/TAKE…) | 13 |
| Financial | 23 | Database (D-functions) | 10 |
| Logical/info | 21 | Extra/utility | 9 |
| Date/time | 21 | Regex/split | 6 |
| Core/basic | 19 | Lambda helpers (MAP/REDUCE/BYROW…) | 6 |
| | | Dynamic array (SEQUENCE/UNIQUE/SORT/FILTER) | 6 |
| | | Regression (LINEST/TREND/GROWTH) | 5 |
| | | Aggregate (SUBTOTAL/AGGREGATE) | 3 |
| | | Sheet meta / Sparkline / QUERY | 2/1/1 |

Advanced: **dynamic arrays + `#SPILL!`**, **LAMBDA/LET** (real closures), **QUERY** (SELECT/WHERE/GROUP BY/PIVOT/ORDER BY/LIMIT/LABEL/FORMAT), **ARRAYFORMULA**. (User-defined **named functions** = absent stub.)

**Charts:** column, bar, line, area, pie — hand-written **dependency-free SVG** (`ChartRenderer.tsx`), multi-series, gridlines/axes/legend. Persist under `grownCharts`.

**Pivot tables:** custom builder (`pivotData.ts`) — row/column/value fields, aggregations sum/count/avg/min/max, grand totals.

**Conditional formatting:** single-color rules (greater/less/equal/between/textContains), 2–3 color scales, data bars, and **icon sets** (custom emoji overlay — arrows/traffic-lights/signs, since FortuneSheet has none natively).

**Data validation:** dropdown list, checkbox, number, text-length, text-contains, date — with per-family operators.

**Named ranges:** present (workbook-meta stored, dialog).

**Find & replace:** match case, match entire cell, **regex** (with validation).

**Filters & sorting:** sort sheet/range A→Z / Z→A (header detection), toggle filter, randomize, split-text-to-columns.

**Freeze panes:** rows/columns/both up to selection + unfreeze.

**Cell formatting:** number formats (general/plain/number/percent/scientific/currency/date/time/datetime), bold/italic/underline/strike, h+v alignment, merge/unmerge, clear formatting; color & borders via FortuneSheet's own toolbar.

**Export:** xlsx, ods (SheetJS), csv, tsv, html (in-browser), pdf (pandoc). **Values-only** — see caveat below.

**Collaboration:** real-time op broadcast, presence/cursors with avatars + heartbeat, permission-aware (viewer ops dropped), sharing/ACL roles (viewer/commenter/editor).

**Multiple sheets/tabs:** native (FortuneSheet). **Templates:** 5. **Sparklines:** in-cell `SPARKLINE` (line/bar/column/winloss).

---

# PART B — Gap analysis (prioritized)

Legend — **Value**: H/M/L business value. **Effort**: S (<1wk) / M (1–3wk) / L (>3wk). **Builds on**: whether it extends the existing library (TipTap / FortuneSheet / pandoc / formula engine) or needs **new infra**.

## B1. Docs gaps vs. Google Docs / Word

| Feature | Status in grown | Value | Effort | Builds on |
|---|---|---|---|---|
| **Import** (docx/odt/md/html → doc) | **Missing** (export-only) | **H** | M | pandoc reverse (`-f docx -t html`) — infra exists, needs upload+ingest path |
| **Incremental find / find-next / highlight-all** | Partial (replace-all only) | **H** | S–M | TipTap (ProseMirror search decorations) |
| **Find options: match-case, whole-word, regex** | Missing | M | S | TipTap |
| **Export fidelity** (comments, tracked changes, footnotes, headers/footers survive docx export) | Weak — HTML→pandoc loses comment threads, suggestions, note linkage | **H** | L | New serialization layer feeding pandoc / or native docx writer |
| **Inserted Table of Contents** (clickable, in-document, updatable) | Missing (outline pane only) | M | S–M | TipTap node + heading walk (outline logic already exists) |
| **Equations / math** (LaTeX/KaTeX) | Missing | M | M | TipTap + KaTeX (new dep) |
| **Named / custom paragraph styles** (define, apply, "update to match") | Missing (H1–H6 only) | M | M | TipTap marks/attrs + style registry |
| **Font-size preset dropdown** + more fonts | Partial (stepper only) | L | S | Toolbar only |
| **Strikethrough in toolbar** | Buried (Format menu only) | L | S | Toolbar only |
| **Image upload to object storage + resize/wrap/align** | Missing (base64 embed, no handles) | **H** | M | TipTap image node ext + Drive upload endpoint (**new infra**) |
| **Multi-column page layout** | Missing | L | M | TipTap (custom node) — CSS columns |
| **True page reflow / real pagination** | Missing (visual guides) | M | **L** | Hard in ProseMirror; likely needs pagination plugin/new infra |
| **A4 / Legal / custom page sizes** | Missing (Letter only) | M | S | `editorStyles.ts` page dims |
| **Spelling & grammar** | Disabled stub (browser only) | M | M–L | New infra (dictionary/service) or LanguageTool |
| **Smart chips / mentions / date chips** | Disabled stub | L | M | TipTap nodes + directory lookup |
| **Word count live (status-bar, selection)** | Partial (alert dialog only) | L | S | Editor state |
| **Citations / bibliography** | Disabled stub | L | M | New infra |
| **Slash "/" insert menu** | Missing | M | S–M | TipTap (suggestion util) |
| **Line numbers, translate, voice typing, accessibility prefs** | Disabled stubs | L | varies | Mixed |
| **Building blocks / templates inside doc (tables of contents, dropdowns)** | Disabled stub | L | M | TipTap nodes |

**Already strong in Docs (parity or near):** real-time collab + cursors, comments (threaded/resolve), suggesting/track-changes, footnotes/endnotes, headers/footers, version history, tables w/ cell shading, drawing (Excalidraw), templates, page margins/orientation/breaks/ruler, broad export format list.

## B2. Sheets gaps vs. Google Sheets / Excel

| Feature | Status in grown | Value | Effort | Builds on |
|---|---|---|---|---|
| **Import** (xlsx/csv → sheet, incl. formulas) | **Missing** (disabled stub) | **H** | M | SheetJS `XLSX.read` (dep present) + formula translation |
| **Export fidelity** (formulas, number formats, styles, charts survive xlsx) | Weak — **values-only** (`v`/`m`); formulas, formats, merges, charts, cond-formatting all dropped | **H** | M–L | Richer SheetJS mapping from FortuneSheet model |
| **Cell comments / notes** | **Missing** (disabled stubs, no backend) | **H** | M | New backend store + FortuneSheet `ps` field |
| **More chart types** (scatter, combo, histogram, radar, scorecard, waterfall, gauge, bubble) | Missing (5 types only) | M | M | Extend custom SVG `ChartRenderer` (per-type work) |
| **Pivot: filters, multiple value/row fields, "show as %", calculated fields** | Partial (single row/col/value) | M | M | Extend `pivotData.ts` |
| **Protect sheets / ranges** | Disabled stub | M | M | Backend ACL at range level (**new infra**) |
| **Slicers** (interactive filter controls for charts/pivots) | Disabled stub | M | M | New UI + wire to filter state |
| **Filter views** (per-user saved filters) | Missing | M | M | New infra (per-user state) |
| **Alternating colors / table styles / themes** | Disabled stub | L | S | FortuneSheet styling |
| **Text wrapping & rotation** | Disabled stubs | M | S | FortuneSheet cell attrs |
| **Named functions** (user-defined LAMBDA names) | Disabled stub | L | M | Formula engine registry extension |
| **Insert: images / drawings / links / checkboxes-as-insert / dropdown-as-insert / emoji** | Disabled stubs | L–M | S–M each | FortuneSheet + Docs drawing reuse |
| **Data connectors / import ranges / IMPORTRANGE** | Missing | M | M–L | New infra (cross-sheet/external fetch) |
| **Column stats / "Analyze data" / smart fill** | Disabled stubs | L | M | New compute |
| **Apps Script / Macros / add-ons** | Disabled stubs | L | **L** | New scripting runtime (**major infra**) |
| **Form-linked data collection** | Missing | L | L | New infra |
| **Timeline / other views** | Missing | L | M | New views |

**Already strong in Sheets (parity or beyond):** the **~310-function engine with dynamic arrays, LAMBDA/LET, QUERY, regression** rivals Google's breadth; conditional formatting (incl. icon sets), data validation (6 types), named ranges, freeze panes, filters/sort, find/replace-with-regex, pivot tables, custom charts, real-time collab + presence, multi-sheet tabs, sparklines, number formats.

---

## B3. Cross-cutting themes (highest leverage)

1. **Import is missing in both apps.** Users can't bring existing docx/xlsx in — a hard blocker for adoption. Both have the pipeline half-built (pandoc can reverse; SheetJS can `read`).
2. **Export is lossy in both.** Docs round-trips through HTML→pandoc (drops comments/suggestions/notes); Sheets exports **values only** (drops formulas/formats/charts). Fixing fidelity is higher-value than adding new formats.
3. **Object storage for embedded media** (Docs images are base64) is shared infra worth building once.
4. **Cell comments in Sheets** is the most conspicuous collaboration gap given Docs already has full threaded comments.
5. Many gaps are **already stubbed in the menus** — low-friction to light up incrementally (wrapping, rotation, more number/chart options, slash menu, TOC insert, page sizes).

---

## Top 8 highest-value gaps (Docs + Sheets combined)

1. **Import (docx → Docs, xlsx/csv → Sheets)** — H value, M effort; blocks migration. Builds on pandoc-reverse / SheetJS `read`.
2. **Sheets export fidelity (formulas + formats + charts, not just values)** — H, M–L; SheetJS mapping.
3. **Docs export fidelity (comments/suggestions/footnotes survive docx/pdf)** — H, L; new serialization feeding pandoc or a native docx writer.
4. **Cell comments/notes in Sheets** — H, M; new backend + reuse Docs comment UX.
5. **Docs image upload to object storage + resize/wrap/align** — H, M; new upload endpoint (reusable infra).
6. **Incremental find + find-next/highlight (+ options) in Docs** — H, S–M; ProseMirror search.
7. **Inserted, updatable Table of Contents in Docs** — M–H, S–M; outline logic already exists.
8. **More Sheets chart types (scatter/combo/histogram/scorecard)** — M, M; extend the custom SVG renderer.
