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

### Wave 1 — Enablement (prereqs for everything) ✅/⬜
- [ ] Self-host pdf.js worker (bundle via vite, drop unpkg CDN) — unblocks offline/CI e2e.
- [ ] Add `data-testid` hooks across the editor (toolbar, canvas/overlay, page nav, properties panel, inputs, status). No stable hooks exist today.
- [ ] Extract modules from EditorPage: `editor/types.ts` (Annotation model), `editor/pdfExport.ts` (buildFinalPdf), `editor/useHistory.ts`. Keeps future waves isolated + unit-testable.
- [ ] Playwright `editor` project + first smoke spec (load blank, place text, download).

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

- **2026-07-15** — Scaffolding: branch + PR #32 created; hamburger services menu committed (`9fe7942`); roadmap doc added; competitor + Docs/Sheets research kicked off. Next: Wave 1.
