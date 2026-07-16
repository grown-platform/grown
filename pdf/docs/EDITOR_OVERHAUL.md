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

### Wave 2 — Selection & object model
- [x] Multi-select (shift-click + marquee), group move/delete. `68d7ee1`
- [x] Z-order: bring to front / send to back / forward / backward. `68d7ee1`
- [x] Clipboard: Ctrl+C/X/V (incl. cross-page paste), keep Duplicate. `68d7ee1`
- [x] Alignment & distribute (left/center/right/top/middle/bottom, distribute h/v). `b4fdb15`
- [x] Snapping / alignment guides + optional grid. `b4fdb15`
- [x] Edge/corner resize handles on all sides (8 handles); aspect-lock (shift). `b4fdb15`
- [ ] Rotate annotations — DEFERRED to its own wave (touches export math; isolate the risk).

### Wave 3 — Page & document management
- [x] Thumbnail sidebar with drag-reorder, page context menu (duplicate/delete/rotate/insert). `5a8275e`
- [x] Fit-to-width / fit-page zoom; page-jump input. `5a8275e` (continuous-scroll still deferred — render rework)
- [x] Unify undo/redo to cover page ops. `5a8275e`
- [x] Page sizes/templates (A4, Legal, A3, Tabloid, custom; portrait/landscape); background grid/lines/dots. `253f470`
- [x] Merge/insert pages from another PDF; extract pages; delete range. `253f470`
- [x] Headers/footers, page numbers, Bates numbering, date stamps. `c666883`
- [ ] Continuous-scroll multi-page render — DEFERRED (render rework).

### Wave 4 — Forms & signing (Acrobat parity, on-brand for a signing product)
- [ ] AcroForm fields: text, checkbox, radio, dropdown, date. Create + fill.
- [ ] Signature / initials / date field tool in the editor (typed + drawn signature).
- [ ] Fill & Sign quick mode.
- [ ] Flatten-forms option on export.

### Wave 5 — Content & markup
- [ ] True annotation eraser (remove ink/marks, partial ink erase).
- [ ] Redaction tool (actually remove underlying content on export).
- [ ] Sticky-note comments / callouts; comment sidebar.
- [ ] Stamps (Approved/Draft/Confidential/custom image stamps).
- [ ] Rich text in text boxes: alignment, bullet/numbered lists, line spacing; custom font embedding (fontkit) for Unicode.
- [ ] Text search/find across pages (pdf.js text layer) + highlight-all.
- [ ] More shapes: rounded rect, polygon, polyline, cloud, callout; dashed strokes.

### Wave 6 — Export, persistence, polish
- [ ] Editable annotation sidecar (JSON) saved with doc → reopen keeps annotations editable.
- [ ] Autosave draft to localStorage (survive refresh) + "restore draft" prompt.
- [ ] Export options: flatten toggle, per-page export, PNG/JPEG export, PDF/A, compression, password/encrypt.
- [ ] Keyboard shortcut map + in-app shortcuts help overlay (`?`).
- [ ] Load-existing-document-by-id (open a Documents item into the editor).
- [ ] Accessibility pass (roles, focus, ARIA on toolbar).

### Later — Docs/Sheets parity (only if editor exhausted)
- [ ] See `docs/feature-research/docs-sheets-parity.md`; pick highest-value gaps.

---

## E2E coverage plan

Target file(s): `pdf/frontend/e2e/editor-*.spec.ts` (new `editor` project).
- **Edit an existing real PDF:** load `test/pdfs/sample-contract.pdf`, add text + highlight + signature/shape, reorder a page, download, and assert the exported PDF (re-parse bytes with pdf-lib in-test: page count, embedded objects) + visual screenshot.
- **Create a polished PDF from scratch:** new blank → multi-page → title/headings/body text, image/logo, shapes, a form field, header/footer + page numbers → download → re-parse & assert structure.
- Each new feature wave adds targeted specs. Keep specs resilient via data-testid hooks.

---

## Progress Log (newest first)

- **2026-07-15** — Wave 3c DONE (`c666883`): headers/footers dialog (6 slots, tokens {page}/{pages}/{date}/{time}/{filename}/{bates}), Bates numbering, range targeting, live preview + baked export. `{date}`/`{time}` captured once on Apply. Config is doc-level (not in undo stack). Hooks: `headerfooter-open`, `hf-*`. 24/24 e2e (verified). **Wave 3 COMPLETE.** Next: Wave 4 (forms & signing) — the big on-brand wave for a signing product.
- **2026-07-15** — Wave 3b DONE (`253f470`): blank page templates (Letter/Legal/A4/A3/Tabloid/custom, orientation, lined/dotted/grid bg), import/merge pages from another PDF, extract range to download, delete-range. `PageEntry` gained `blankW/blankH/blankBg`; merge rebuilds an identity page map. Hooks: `page-import(-input)`, `page-extract`, `page-delete-range`, `blank-*`, `extract-*`, `delete-range*`. 21/21 e2e (verified). Next: Wave 3c (headers/footers/page-numbers/Bates/date stamps) OR jump to Wave 4 (forms & signing) — pick 3c (small, export-time) first, then Wave 4.
- **2026-07-15** — Wave 3a DONE (`5a8275e`): collapsible thumbnail sidebar (click-jump, drag-reorder, per-page menu), page-jump input, fit-width/fit-page zoom, and UNIFIED history `{annotations, pages, bytes}` so page ops are undoable with annotations. Hooks: `thumb-*`, `editor-page-jump`, `zoom-fit-width`, `zoom-fit-page`. 17/17 e2e (verified). Sidebar default-collapsed to avoid react-pdf DOM collision with existing specs. Next: Wave 3b (page sizes/templates, insert/merge/extract pages, headers/footers/page-numbers/Bates).
- **2026-07-15** — Wave 2b DONE (`b4fdb15`): align/distribute for multi-selection, 8-handle perimeter resize + Shift aspect-lock, snapping to edges/centers/page-midlines with magenta guides, snap toggle + grid overlay. New hooks: `align-*`, `distribute-*`, `resize-{nw,n,ne,e,se,s,sw,w}`, `toggle-snap`, `toggle-grid`, `snap-guide`, `editor-grid`, `data-annot-{x,y,w,h}`. 12/12 e2e green (verified). Moves are now absolute (group snaps as one). Next: Wave 3 (page & document management) — start with 3a (thumbnails, page-jump, fit zoom, unify page-op undo).
- **2026-07-15** — Wave 2a DONE (`68d7ee1`): multi-select (shift-click + marquee), group move/delete, z-order + shortcuts, internal clipboard (C/X/V cross-page). New hooks: `data-annot-id`/`data-annot-index`, `z-*`, `clip-*`, `arrange-panel`. Fixed StrictMode double-draw + focus-swallow bugs. 7/7 e2e green (verified). `selectedIds[]` is now the selection source of truth (`selectedId` derived). Next: Wave 2b (align/distribute, snapping/guides/grid, rotate + full resize handles).
- **2026-07-15** — Wave 1 (enablement) DONE (`e43dcd9`): self-hosted pdf.js worker, testids everywhere, Playwright `editor` project + 3 specs (smoke/scratch/existing) all green, eslint config added. Verified tsc/lint/e2e myself. Next: Wave 2 (selection & object model).
- **2026-07-15** — Research deliverables committed: competitor analysis (`7df4e11`) + Docs/Sheets parity (`pdf/docs/feature-research/`). Key: existing-text-edit / true redaction / OCR need backend; everything else client-side-doable. Docs/Sheets already strong — main gaps are import + export fidelity.
- **2026-07-15** — Scaffolding: branch + PR #32 created; hamburger services menu committed (`9fe7942`); roadmap doc added; competitor + Docs/Sheets research kicked off.
