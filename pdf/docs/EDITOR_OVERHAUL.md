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
- [ ] Multi-select (shift-click + marquee), group move/delete.
- [ ] Z-order: bring to front / send to back / forward / backward.
- [ ] Clipboard: Ctrl+C/X/V (incl. cross-page paste), keep Duplicate.
- [ ] Alignment & distribute (left/center/right/top/middle/bottom, distribute h/v).
- [ ] Snapping / alignment guides + optional grid.
- [ ] Rotate annotations; edge/corner resize handles on all sides; aspect-lock (shift).

### Wave 3 — Page & document management
- [ ] Thumbnail sidebar with drag-reorder, page context menu (duplicate/delete/rotate/insert).
- [ ] Fit-to-width / fit-page zoom; page-jump input; continuous-scroll toggle.
- [ ] Page sizes/templates (A4, Legal, A3, custom; portrait/landscape); background grid/lines/dots.
- [ ] Unify undo/redo to cover page ops.
- [ ] Merge/insert pages from another PDF; extract/split pages; delete range.
- [ ] Headers/footers, page numbers, Bates numbering, date stamps.

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

- **2026-07-15** — Wave 1 (enablement) DONE (`e43dcd9`): self-hosted pdf.js worker, testids everywhere, Playwright `editor` project + 3 specs (smoke/scratch/existing) all green, eslint config added. Verified tsc/lint/e2e myself. Next: Wave 2 (selection & object model).
- **2026-07-15** — Research deliverables committed: competitor analysis (`7df4e11`) + Docs/Sheets parity (`pdf/docs/feature-research/`). Key: existing-text-edit / true redaction / OCR need backend; everything else client-side-doable. Docs/Sheets already strong — main gaps are import + export fidelity.
- **2026-07-15** — Scaffolding: branch + PR #32 created; hamburger services menu committed (`9fe7942`); roadmap doc added; competitor + Docs/Sheets research kicked off.
