# PDF Editor Overhaul — Overnight Autonomous Build

**Branch:** `feat/pdf-editor-overhaul` · **PR:** [#32](https://code.pick.haus/grown/grown-workspace/pulls/32)
**Started:** 2026-07-15 evening · **Mandate:** build editor features + e2e tests for ~10h, self-paced, checkpoint continuously. Merging auto-deploys grown.haus + pick.haus.

This file is the **single source of truth + continuity anchor**. On every new turn/context: read this file, then `git log --oneline -15`, to know exactly where things stand and what to do next. Update the Progress Log after every wave.

---

## Operating rules

- **One feature branch** (`feat/pdf-editor-overhaul`), everything lands here → the giant PR.
- **Commit + push after every wave.** Never leave the tree broken between waves. `git push origin feat/pdf-editor-overhaul`.
- After each wave: `cd pdf/frontend && npx tsc -b && npm run lint` must pass. Then run relevant e2e.
- The editor is one file today: `pdf/frontend/src/features/editor/pages/EditorPage.tsx` (~1396 LOC). Extract modules as we go so features stay isolated & testable.
- pdf/.claude rules: no Claude attribution in commits; feature branches only (already on one).
- Keep the PR body / this doc's Progress Log current so the morning review is easy.

## Environment notes

- Editor route: `/editor` (client-side; `react-pdf` for render + `pdf-lib` for export). No backend needed to edit/download — good for e2e.
- **CDN worker gotcha:** `pdfjs.GlobalWorkerOptions.workerSrc` currently points at `unpkg.com` (EditorPage.tsx:53). Must self-host the worker for offline/CI e2e. (Wave 1)
- e2e: `pdf/frontend/playwright.config.ts` (projects: `api`, `chromium`). Vite dev server on :5173. Add an `editor` project.
- Typecheck: `npx tsc -b`. Lint: `npm run lint` (eslint). Build: `npm run build`.
- Test PDFs available: `pdf/test/pdfs/{sample-contract,nda-agreement,multi-party-agreement}.pdf`.

---

## Current capabilities (baseline, pre-overhaul)

Text boxes (font Helv/Times/Courier, size, color, bold/italic, inline edit, resize) · Images (png/jpeg) · Shapes (rect/ellipse/line/arrow w/ stroke/fill/opacity) · Freehand ink · Highlight/underline/strikethrough · Whiteout (white cover, not true erase) · Undo/redo (annotations only, depth 60) · Duplicate (no system clipboard) · Delete/select (single only) · Page ops (add blank/delete/move/rotate; full re-serialize) · Zoom 0.5–2.0 · Prev/next page · New blank (Letter only) · Upload/drag-drop existing PDF · Download + Save-to-backend (flattens annotations). Plain useState, normalized 0–1 coords, discriminated-union `Annotation` model.

Baseline gaps → become the backlog below.

---

## Backlog (ordered; check off as landed)

### Wave 1 — Enablement (prereqs for everything) ✅
- [x] Self-host pdf.js worker (bundled `?url` import, drop unpkg CDN) — unblocks offline/CI e2e. `e43dcd9`
- [x] Add `data-testid` hooks across the editor (tools `tool-*`, `editor-canvas`, `editor-textarea`, page nav, properties `props-*`/`text-*`/`shape-*`, header actions). See commit for full list.
- [x] Playwright `editor` project + 3 specs: `editor-smoke`, `editor-scratch` (from scratch, re-parses export), `editor-existing` (edit real PDF). All green (tsc/lint/e2e verified).
- [x] Added the missing eslint flat config (lint had never run).
- [ ] DEFERRED: extract modules (`editor/types.ts`, `pdfExport.ts`, `useHistory.ts`) — do opportunistically when a wave touches those areas, to avoid a risky big refactor up front.

**Test-hook cheat-sheet for future waves:** tools `tool-{select,text,draw,highlight,underline,strikethrough,rect,ellipse,line,arrow,whiteout,image}`; canvas `editor-canvas` (click/drag target) + `editor-textarea`; header `editor-{undo,redo,zoom-in,zoom-out,zoom-level,prev-page,next-page,page-indicator,download,save,docname,close}`; pages `page-{add,delete,up,down,rotate}`; props `props-{panel,duplicate,delete}`, `text-{font,bold,italic,color,size}`, `shape-{stroke-color,stroke-width,fill-color,opacity}`; empty state `editor-{dropzone,file-input,new-blank}`. e2e auth: `beforeEach` seeds `sessionStorage.lastLoginAttempt` via `addInitScript` to bypass the SSO redirect (editor needs no backend). Local port clash on :5173 → run with `PLAYWRIGHT_PORT=<free>`.

**GOTCHA (bit two waves):** adding buttons to the CANVAS HEADER (a `flex-wrap` toolbar) can wrap it to a second line, growing the header, shrinking the canvas viewport, so `editor-arrange.spec.ts (e)`'s drag point (~61% down the page) falls outside the clipped canvas and its mousedown misses `editor-canvas`. → Put new controls in the LEFT side cards (Tools/Arrange/Pages/Sign&Fill/Comments), not the header. For pdfjs text extraction use a raw `pdfjs.getDocument`, never a react-pdf `<Page>`, so you don't add `.react-pdf__Page` DOM that confuses existing locators.

### Wave 2 — Selection & object model
- [x] Multi-select (shift-click + marquee), group move/delete. `68d7ee1`
- [x] Z-order: bring to front / send to back / forward / backward. `68d7ee1`
- [x] Clipboard: Ctrl+C/X/V (incl. cross-page paste), keep Duplicate. `68d7ee1`
- [x] Alignment & distribute (left/center/right/top/middle/bottom, distribute h/v). `b4fdb15`
- [x] Snapping / alignment guides + optional grid. `b4fdb15`
- [x] Edge/corner resize handles on all sides (8 handles); aspect-lock (shift). `b4fdb15`
- [x] Rotate annotations (box/image/text/stamp; handle + numeric; center-anchor export). `5d60a75`

### Wave 3 — Page & document management
- [x] Thumbnail sidebar with drag-reorder, page context menu (duplicate/delete/rotate/insert). `5a8275e`
- [x] Fit-to-width / fit-page zoom; page-jump input. `5a8275e` (continuous-scroll still deferred — render rework)
- [x] Unify undo/redo to cover page ops. `5a8275e`
- [x] Page sizes/templates (A4, Legal, A3, Tabloid, custom; portrait/landscape); background grid/lines/dots. `253f470`
- [x] Merge/insert pages from another PDF; extract pages; delete range. `253f470`
- [x] Headers/footers, page numbers, Bates numbering, date stamps. `c666883`
- [ ] Continuous-scroll multi-page render — DEFERRED (render rework).

### Wave 4 — Forms & signing (Acrobat parity, on-brand for a signing product)
- [x] AcroForm fields: text, checkbox, radio, dropdown. Create + fill. `be5e8e4`
- [x] Flatten-forms option on export. `be5e8e4`
- [x] Signature / initials / date tool in the editor (typed + drawn + uploaded). `109f9f1`
- [x] Fill & Sign quick mode (+ vector check/cross/dot stamps). `109f9f1`

### Wave 5 — Content & markup
- [x] True annotation eraser (remove ink/marks, partial ink erase). `cbfc2f3`
- [x] Rich text in text boxes: alignment, bullet/numbered lists, line spacing. `cbfc2f3` (fontkit/Unicode embedding → Wave 5c)
- [x] More shapes: rounded rect, polygon, polyline; dashed strokes. `cbfc2f3` (cloud/callout optional, later)
- [x] Redaction tool (true content removal via page rasterize on export). `024d34e`
- [x] Sticky-note comments / callouts; comment sidebar. `fed2e1a`
- [x] Stamps (Approved/Draft/Confidential/custom image stamps). `fed2e1a`
- [x] Text search/find across pages (pdf.js text layer) + highlight-all. `b9ae4d1`
- [ ] Custom font embedding (fontkit) for Unicode text. ← Wave 6 (needs a bundled font; lower priority than persistence/export).

### Wave 6 — Export, persistence, polish
- [x] Autosave draft to IndexedDB (survive refresh) + "restore draft" prompt. `6786322`
- [x] Keyboard shortcut map + in-app shortcuts help overlay (`?`); arrow-key nudge. `6786322`
- [x] Export options: PNG/JPEG page export, document metadata (title/author/subject/keywords). `8ca7725` (pdf-lib has NO password/encryption or PDF/A — skipped, would need backend/native)
- [x] Editable annotation sidecar embedded IN the exported PDF → reopen keeps annotations editable (client-side round-trip). `94bb633`
- [x] Custom font embedding (fontkit) for Unicode text (Noto Sans, lazy, subset). `339efb6`
- [ ] Load-existing-document-by-id (open a Documents item into the editor) — needs backend fetch; lower priority.
- [ ] Accessibility pass (roles, focus, ARIA on toolbar) — polish.

### Wave 7+ — deferred editor polish (client-side, verifiable)
- [x] Annotation rotation. `5d60a75`
- [x] Wave 8: page crop (crop box → export), line/arrowhead endpoint styles, configurable highlight colors. `e15d977`
- [x] Wave 9: accessibility pass (roles/aria/focus on toolbar + dialogs). `eec987d`
- [ ] (deferred, higher risk/needs backend) continuous-scroll render; load-Documents-item-by-id. — EDITOR NOW ESSENTIALLY COMPLETE (9 waves, 59 e2e). Pivoting to Docs/Sheets.

### Later — Docs/Sheets parity (only if editor exhausted)
- [ ] See `docs/feature-research/docs-sheets-parity.md`; pick highest-value gaps. NOTE: Docs/Sheets e2e needs the full grown backend stack (Go+DB+auth) running — much harder to verify headless than the client-only PDF editor. Prefer editor work while it still has verifiable value; for Docs/Sheets, lean on tsc/build + targeted unit tests where e2e isn't feasible.

---

## E2E coverage plan

Target file(s): `pdf/frontend/e2e/editor-*.spec.ts` (new `editor` project).
- **Edit an existing real PDF:** load `test/pdfs/sample-contract.pdf`, add text + highlight + signature/shape, reorder a page, download, and assert the exported PDF (re-parse bytes with pdf-lib in-test: page count, embedded objects) + visual screenshot.
- **Create a polished PDF from scratch:** new blank → multi-page → title/headings/body text, image/logo, shapes, a form field, header/footer + page numbers → download → re-parse & assert structure.
- Each new feature wave adds targeted specs. Keep specs resilient via data-testid hooks.

---

## Progress Log (newest first)

- **2026-07-16** — Wave 9 DONE (`eec987d`): accessibility pass — toolbar role, aria-labels/aria-pressed, dialog role/aria-modal + focus-trap/Escape/restore (`useDialogA11y`), aria-live status, canvas role. Additive only. 59/59 e2e. **PDF EDITOR COMPLETE** (9 waves, 59 e2e, ~15 feature commits). Now PIVOTING to Docs/Sheets per the mandate — targeting the Go backend (formula engine, export) where `go test` gives verifiability, since Docs/Sheets UI e2e needs the full stack. This work still lands on PR #32 (one giant PR).
- **2026-07-16** — Wave 8 DONE (`e15d977`): page crop (per-page/all, non-destructive setCropBox on export, survives page ops), line/arrowhead endpoint styles (none/start/end/both), configurable highlight colors. Defaults byte-identical. Hooks: `page-crop`, `crop-*`, `line-arrow-*`, `highlight-color-*`. 57/57 e2e. Next: Wave 9 (a11y). After that the editor is deeply complete → consider Docs/Sheets (verify via Go `go test` on the formula/export backend, since Docs/Sheets UI e2e needs the full stack).
- **2026-07-16** — Wave 7 DONE (`5d60a75`): annotation rotation (box/image/text/stamp) — rotation handle (Shift-snap 15°) + numeric field, CSS/SVG transforms, center-anchor pdf-lib export gated on nonzero angle (unrotated byte-identical). Resize/hit-test stay axis-aligned (approx). Hooks: `rotate-handle`, `rotate-input`, `data-annot-rotation`. 54/54 e2e. Next: Wave 8 (page crop + line/arrowhead styles + highlight colors).
- **2026-07-16** — FINALIZE PASS: pdf `npm run build` ✓ (pre-existing bundle-size warning only), editor e2e 51/51 ✓, web/app tsc+build ✓. Base `app.spec` (chromium) fails ONLY on ECONNREFUSED /api/user/me — needs backend, pre-existing, NOT a regression (editor specs bypass auth via sessionStorage). PR #32 body updated with full feature list (33 files, +8200/-255, 36 commits). Continuing with deferred editor polish: annotation rotation next, then a11y, then Docs/Sheets parity if time.
- **2026-07-16** — Wave 6d DONE (`339efb6`): Unicode text export via `@pdf-lib/fontkit` + bundled Noto Sans (lazy vite assets, subset on export). WinAnsi text keeps Standard-14 (existing exports unchanged); non-WinAnsi embeds Noto. 51/51 e2e (Cyrillic/Greek extracted via pdf.js). **Editor backlog essentially COMPLETE** (remaining: load-by-id [needs backend], a11y polish, continuous-scroll [render rework], annotation rotation). NEXT: FINALIZE — run full pdf build + all e2e projects, verify web/app hamburger build, update PR #32 body with the full feature list, update memory. Then optional: Docs/Sheets parity items (see feature-research) or the deferred polish items.
- **2026-07-16** — Wave 6c DONE (`94bb633`): editable round-trip — "Save editable copy" embeds `grown-editor.json` (annotations/hf/meta/docName) via pdf-lib attach without flattening; on load pdf.js `getAttachments()` restores it as editable objects. Flattened Download stays sidecar-free. Hooks: `download-editable`, `editable-restored`. 49/49 e2e, 2x-stable. Next: Wave 6d (fontkit/Unicode font embedding) — needs a bundled font (watch bundle size); then final polish + PR finalize (update PR body with the full feature list).
- **2026-07-16** — Wave 6b DONE (`8ca7725`): PNG/JPEG page export (pdf.js render of the baked PDF, 1x/2x/3x, current/all), document metadata dialog (title/author/subject/keywords/creator) via pdf-lib setters + draft round-trip. Hooks: `export-image-*`, `metadata-*`, `meta-*`. 47/47 e2e. Next: Wave 6c (embedded editable sidecar → reopen keeps annotations editable) — the round-trip standout. Then fontkit/Unicode, then final polish + PR finalize.
- **2026-07-16** — Wave 6a DONE (`6786322`): autosave to IndexedDB (`draftDb.ts`) + restore prompt (cleared on new/close/open-other/save; IDB guarded), shortcuts help overlay (`?`), arrow-key nudge, Ctrl/Cmd+D duplicate. Hooks: `draft-status`, `restore-draft-*`, `shortcuts-*`. 45/45 e2e, 2x-stable. Next: Wave 6b (PNG/JPEG page export + document metadata), then 6c (embedded editable sidecar round-trip).
- **2026-07-16** — Wave 5d DONE (`b9ae4d1`): cross-page text search (Ctrl/Cmd+F) via pdf.js text content, match counter, next/prev across pages, case toggle, highlight-all overlay, per-page text cache. Read-only. Hooks: `editor-search-open`, `editor-search-input`, `search-*`. 42/42 e2e (verified). **Wave 5 COMPLETE** (fontkit moved to Wave 6). Recorded the header-wrap gotcha in the cheat-sheet. Next: Wave 6 (persistence/export/polish) — start 6a (autosave draft + restore, shortcuts help overlay).
- **2026-07-16** — Wave 5c DONE (`fed2e1a`): sticky-note comments (draggable markers + editable text) with a collapsible comment sidebar (jump-to/delete/count), preset stamps (APPROVED/DRAFT/CONFIDENTIAL/REVIEWED/FINAL/VOID + optional date) exported as vector, and custom image stamps. New `NoteAnnotation`/`StampAnnotation`. Hooks: `tool-note`, `tool-stamp`, `comment-*`, `note-*`, `stamp-*`. 39/39 e2e (verified). Next: Wave 5d (text search across pages + highlight-all; fontkit/Unicode font embedding) → then Wave 6 (export/persistence/polish).
- **2026-07-15** — Wave 5b DONE (`024d34e`): TRUE redaction — `tool-redact` marks; on export, marked pages are rasterized via pdf.js (2x) with black-filled rects and replaced by a flattened image, destroying the underlying text layer; non-redacted pages stay vector; pdf-lib fallback. `redact-notice`. 36/36 e2e, removal proven by pdf.js text extraction. Next: Wave 5c (sticky-note comments + sidebar, preset/custom stamps), then Wave 5d (text search, fontkit/Unicode).
- **2026-07-15** — Wave 5a DONE (`cbfc2f3`): true eraser (click/drag delete + partial ink-split), rounded rect + polygon + polyline + dashed strokes, richer text (align/lists/line-spacing). New `PolyAnnotation`; box gained `rx`/`dash`; text gained `align`/`list`/`lineSpacing`. Hooks: `tool-{eraser,rrect,polygon,polyline}`, `eraser-size`, `shape-{dash,corner-radius}`, `text-{align-*,list-*,line-spacing}`, `data-annot-kind`/`data-ink-points`/etc. 34/34 e2e (verified). Next: Wave 5b (redaction via rasterize, sticky-note comments + sidebar, preset/custom stamps).
- **2026-07-15** — Wave 4b DONE (`109f9f1`): signature/initials (Type/Draw/Upload → PNG image annotation), date stamp, Fill & Sign quick mode with vector check/cross/dot stamps. New `SignatureDialog.tsx`. Hooks: `tool-signature/initials/date`, `toggle-fillsign`, `sig-*`, `stamp-*`, `quick-*`. 30/30 e2e (verified). **Wave 4 COMPLETE.** Next: Wave 5 (markup: eraser, redaction, sticky notes, stamps, rich text/lists, text search, more shapes).
- **2026-07-15** — Wave 4a DONE (`be5e8e4`): interactive AcroForm fields (text/checkbox/radio/dropdown) as new `field` Annotation variants — reuse all Wave 2 infra (select/move/resize/align/z-order/clipboard/undo). In-editor fill; export creates REAL pdf-lib form fields with correct rect mapping + values; `flatten-forms` toggle. Hooks: `tool-field-*`, `field-*`, `flatten-forms`. 27/27 e2e, assertions introspect exported form. Next: Wave 4b (signature/initials/date tool + Fill & Sign).
- **2026-07-15** — Wave 3c DONE (`c666883`): headers/footers dialog (6 slots, tokens {page}/{pages}/{date}/{time}/{filename}/{bates}), Bates numbering, range targeting, live preview + baked export. `{date}`/`{time}` captured once on Apply. Config is doc-level (not in undo stack). Hooks: `headerfooter-open`, `hf-*`. 24/24 e2e (verified). **Wave 3 COMPLETE.** Next: Wave 4 (forms & signing) — the big on-brand wave for a signing product.
- **2026-07-15** — Wave 3b DONE (`253f470`): blank page templates (Letter/Legal/A4/A3/Tabloid/custom, orientation, lined/dotted/grid bg), import/merge pages from another PDF, extract range to download, delete-range. `PageEntry` gained `blankW/blankH/blankBg`; merge rebuilds an identity page map. Hooks: `page-import(-input)`, `page-extract`, `page-delete-range`, `blank-*`, `extract-*`, `delete-range*`. 21/21 e2e (verified). Next: Wave 3c (headers/footers/page-numbers/Bates/date stamps) OR jump to Wave 4 (forms & signing) — pick 3c (small, export-time) first, then Wave 4.
- **2026-07-15** — Wave 3a DONE (`5a8275e`): collapsible thumbnail sidebar (click-jump, drag-reorder, per-page menu), page-jump input, fit-width/fit-page zoom, and UNIFIED history `{annotations, pages, bytes}` so page ops are undoable with annotations. Hooks: `thumb-*`, `editor-page-jump`, `zoom-fit-width`, `zoom-fit-page`. 17/17 e2e (verified). Sidebar default-collapsed to avoid react-pdf DOM collision with existing specs. Next: Wave 3b (page sizes/templates, insert/merge/extract pages, headers/footers/page-numbers/Bates).
- **2026-07-15** — Wave 2b DONE (`b4fdb15`): align/distribute for multi-selection, 8-handle perimeter resize + Shift aspect-lock, snapping to edges/centers/page-midlines with magenta guides, snap toggle + grid overlay. New hooks: `align-*`, `distribute-*`, `resize-{nw,n,ne,e,se,s,sw,w}`, `toggle-snap`, `toggle-grid`, `snap-guide`, `editor-grid`, `data-annot-{x,y,w,h}`. 12/12 e2e green (verified). Moves are now absolute (group snaps as one). Next: Wave 3 (page & document management) — start with 3a (thumbnails, page-jump, fit zoom, unify page-op undo).
- **2026-07-15** — Wave 2a DONE (`68d7ee1`): multi-select (shift-click + marquee), group move/delete, z-order + shortcuts, internal clipboard (C/X/V cross-page). New hooks: `data-annot-id`/`data-annot-index`, `z-*`, `clip-*`, `arrange-panel`. Fixed StrictMode double-draw + focus-swallow bugs. 7/7 e2e green (verified). `selectedIds[]` is now the selection source of truth (`selectedId` derived). Next: Wave 2b (align/distribute, snapping/guides/grid, rotate + full resize handles).
- **2026-07-15** — Wave 1 (enablement) DONE (`e43dcd9`): self-hosted pdf.js worker, testids everywhere, Playwright `editor` project + 3 specs (smoke/scratch/existing) all green, eslint config added. Verified tsc/lint/e2e myself. Next: Wave 2 (selection & object model).
- **2026-07-15** — Research deliverables committed: competitor analysis (`7df4e11`) + Docs/Sheets parity (`pdf/docs/feature-research/`). Key: existing-text-edit / true redaction / OCR need backend; everything else client-side-doable. Docs/Sheets already strong — main gaps are import + export fidelity.
- **2026-07-15** — Scaffolding: branch + PR #32 created; hamburger services menu committed (`9fe7942`); roadmap doc added; competitor + Docs/Sheets research kicked off.
