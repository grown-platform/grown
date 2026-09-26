# OnlyOffice parity — combined roadmap

The execution order across the four plans ([docs](docs.md), [sheets](sheets.md),
[slides](slides.md), [cross-cutting](cross-cutting.md)). Each milestone ID links back
to its plan, which holds the full scope and the list of tests it ports.

**Ground rules**
- **Additive only.** Improve what Grown has and fill in what's missing. No rewrites:
  TipTap/Yjs Docs, the fortune-sheet grid plus Go formula engine, the DOM Slides
  renderer, and the `/editor` PDF editor all stay. Anything that would need a rewrite
  is listed under *Flagged exceptions* in its plan and is not scheduled.
- **Clean room.** Use OnlyOffice (AGPL) only as a reference for *behavior*, via the
  local, gitignored `research/onlyoffice/`. Every test is written fresh in Grown's own
  harnesses (vitest, Playwright, `go test`) and tagged `oo:<path>#<case>` so the
  scoreboard can count it (convention in [README → Scoreboard](README.md#scoreboard)).
- Baseline: `origin/main` c90064e (2026-09-26).

## Where we stand

| Area | OnlyOffice cases | Portable | Grown tests today | Headline gaps |
|---|---|---|---|---|
| Sheets | 1,117 | ≈1,020 | 38 vitest · 198 Go · 2 e2e | cross-sheet/named/`A:A` refs, 167 functions, number formats, filters/CF/DV/pivot depth, xlsx import + formula export |
| Docs | 1,200 (356 static) | 1,141 | 0 vitest · 4 e2e | styles, numbering, paragraph props, tables, tracked formatting, sections/pagination, fields/TOC, forms, equations, direct DOCX |
| Slides | 71 | ≈60 | 24 Go · 0 vitest/e2e | pptx import + export fidelity, preset shapes, text formatting within a run, transitions/animations, masters |
| Cross-cutting | ≈69 + ≈220 table cases + 86 docs in the local corpus | most | PDF 76 e2e · forms 51 Go | conversion tests, calculated PDF fields, form validation/branching, vsdx view, parity scoreboard |

## Waves

Every milestone within a wave can run in parallel (the editors are independent).
Sizes follow each plan's own scale (S/M/L/XL).

### Wave 0 — Harness and scoreboard (start here)
Nothing is counted until this exists; no UI risk.
- **CC0** scoreboard `web/app/scripts/onlyoffice-parity.mjs` + `baseline.json` + CI step (S)
- **Sheets M0** Go fixture runner + `__parity__/`; ports ≈91 cases for functions that already exist (M)
- **Docs M0** TipTap test harness (`makeEditor`, `pressKey`, `MockMeasurer`) (S)
- **Slides M0** extract pure functions from `SlideCanvas`/`model.ts` + first tests (M)

### Wave 1 — Cheap, high-yield ports (the test count climbs fastest here)
- **Sheets M2** math/text/database function breadth — 139 cases (S)
- **Sheets M4** engineering + financial (complex numbers, Bessel, bonds) — 109 cases (M)
- **Sheets M1** cross-sheet refs, named ranges in formulas, `A:A`, recalc round-trip (M) — *the most user-visible Sheets gap*
- **Docs M1** text ops, change case, shortcuts — 57 cases (M)
- **CC1** `urlType` (75 cases) + `colorMods` (≈137 cases) shared ports (M)
- **CC2** conversion tests for the existing pandoc import/export + local corpus runner (M)

### Wave 2 — Round-trip fidelity (the most-requested behavior: "open my Office file")
- **Slides M1** pptx import + export fidelity (L)
- **Sheets M6** number formats (TS + Go, shared fixtures) — 57 cases (M)
- **Sheets M11** xlsx/ods/csv import, export with formulas/formats, print, protection (L; needs M6, M8)
- **Docs M2** clipboard, find/replace with highlights, autocorrect — 35 cases (L)
- **Docs M3** paragraph props, styles, numbering (L) — prerequisite for real DOCX fidelity
- **Docs M6** direct DOCX reader/writer; pandoc stays for the other formats (L; after M3)

### Wave 3 — Core editing depth
- **Sheets M3** statistics library — 151 cases (L)
- **Sheets M5** dynamic-array hardening, dependency API, goal seek (M)
- **Sheets M7** autofill/series/sort/paste-special/structure (L)
- **Sheets M8** filters, conditional formatting, data validation — 100 cases (L)
- **Docs M4** tables · **Docs M5** track changes v2 (M, L)
- **Slides M2** selection/arrange/group · **M3** preset geometry (ECMA-376 spec data) · **M4** text formatting (M, L, L)
- **CC3** PDF calculated fields + listbox/pushbutton (M)

### Wave 4 — Visible features
- **Sheets M9** pivots · **M10** charts (L, M)
- **Docs M7** images/shapes/charts · **M8** references/fields/TOC · **M9** page layout, sections, pagination (L, M, XL)
- **Slides M5–M9** tables, images, layouts/themes, transitions/animations, slideshow/presenter
- **CC4** form validation/grids/branching (L) · **CC6** whiteboard vsdx import + export (L)

### Wave 5 — Large self-contained subsystems
- **Docs M11** equations — 936 cases in one block (XL; big test count, fewer users)
- **Docs M10** content controls, forms, protection — 49 cases (XL)
- **Docs M12** compare/merge, version diff, mail merge (L)
- **Slides M10–M13** comments/history, charts/diagrams/media, export/print, shortcuts/a11y
- **Sheets M12** shortcuts and polish · **Docs M13** spell check/misc
- **CC5** (covered by Sheets M11 / Slides M1) · **CC7** version history for sheets/slides/whiteboards, spellcheck, fonts · **CC8** optional LibreOffice-headless

## Suggested first PR

Wave 0 as a single PR: the scoreboard script plus the three editor harnesses, with
Sheets M0's ≈91 ported formula cases as proof the pipeline works end to end. Semantic
differences it turns up between Grown's engine and OnlyOffice's (argument coercion,
error codes, date serials) become the first bug list.

## Tracking

- **Tag every ported case** `oo:<path>#<case>`: `<path>` is relative to
  `sdkjs-tests-v9.3.1/tests/` (`oo:cell/spreadsheet-calculation/formula-tests/FormulaTests.js#SUM`,
  `oo:word/change-case/change-case.js#Sentence case`, `oo:slide/shortcuts/shortcuts.js#22`);
  `<case>` ends at a closing quote, backtick, `]` or end of line. The tag goes in a
  vitest/Playwright title, a Go `t.Run` name, or a JSON/YAML fixture string value.
  This one convention replaces the per-plan variants.
- `cd web/app && npm run parity` prints OnlyOffice tests · ported · passing per plan/area
  against the `*-tests.csv` manifests (ported = distinct tags per OnlyOffice file;
  `--vitest-json/--go-json/--pw-json` fill in passing). Tags that match no row are
  listed as unmapped. See [README → Scoreboard](README.md#scoreboard) for all flags.
- CI runs `--check --md` in the `frontend` job and fails if ported/passing drops below
  [`baseline.json`](baseline.json). After a milestone lands, run
  `npm run parity -- --write-baseline` and commit the new baseline.
- When a milestone lands, update its rows' `target_grown_path` in the CSV if the files moved.
- Re-baseline this roadmap's numbers by running the scoreboard, not by hand.
